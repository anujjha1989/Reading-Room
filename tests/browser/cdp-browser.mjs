import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const DEFAULT_CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function retry(task, { attempts = 80, interval = 100 } = {}) {
  let failure;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try { return await task(); } catch (error) { failure = error; }
    await delay(interval);
  }
  throw failure;
}

export async function launchBrowser({ port = 9333, viewport = { width: 430, height: 932 } } = {}) {
  const executable = process.env.READING_ROOM_CHROME || DEFAULT_CHROME;
  const profile = await mkdtemp(path.join(tmpdir(), "reading-room-browser-"));
  const artifacts = process.env.READING_ROOM_E2E_ARTIFACTS
    || path.join(tmpdir(), "reading-room-e2e");
  await mkdir(artifacts, { recursive: true });
  const child = spawn(executable, [
    "--headless=new",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    `--window-size=${viewport.width},${viewport.height}`,
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-default-apps",
    "--disable-extensions",
    "--disable-sync",
    // CDP's element.click() is not a trusted user gesture. The production UI
    // starts audio from a real tap, so let the test exercise the post-gesture
    // narration state instead of failing at Chromium's autoplay boundary.
    "--autoplay-policy=no-user-gesture-required",
    "--hide-scrollbars",
    "--no-first-run",
    "about:blank",
  ], { stdio: "ignore" });

  const pages = await retry(async () => {
    const response = await fetch(`http://127.0.0.1:${port}/json`);
    if (!response.ok) throw new Error(`Chromium debugging endpoint returned ${response.status}`);
    const entries = await response.json();
    if (!entries.length) throw new Error("Chromium has no inspectable page");
    return entries;
  });
  const page = pages.find((entry) => entry.type === "page") || pages[0];
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });

  let nextId = 0;
  const pending = new Map();
  const events = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const request = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) request.reject(new Error(message.error.message));
      else request.resolve(message.result);
      return;
    }
    for (const listener of events.get(message.method) || []) listener(message.params || {});
  });

  const send = (method, params = {}) => {
    const id = ++nextId;
    socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
  };
  const on = (method, listener) => {
    const listeners = events.get(method) || [];
    listeners.push(listener);
    events.set(method, listeners);
  };
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      const detail = result.exceptionDetails.exception?.description
        || result.exceptionDetails.text
        || "Browser evaluation failed";
      throw new Error(detail);
    }
    return result.result.value;
  };
  const waitFor = async (expression, options = {}) => retry(async () => {
    const value = await evaluate(expression);
    if (!value) throw new Error(`Timed out waiting for: ${expression}`);
    return value;
  }, options);
  const screenshot = async (name) => {
    const { data } = await send("Page.captureScreenshot", { format: "png", fromSurface: true });
    const target = path.join(artifacts, name);
    await writeFile(target, Buffer.from(data, "base64"));
    return target;
  };

  await Promise.all([
    send("Page.enable"),
    send("Runtime.enable"),
    send("Log.enable"),
    send("Emulation.setDeviceMetricsOverride", {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: 2,
      mobile: true,
      screenWidth: viewport.width,
      screenHeight: viewport.height,
    }),
    send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 }),
  ]);

  return {
    artifacts,
    send,
    on,
    evaluate,
    waitFor,
    screenshot,
    async goto(url) {
      await send("Page.navigate", { url });
      await waitFor(`document.readyState === 'complete'`, { attempts: 120 });
    },
    async close() {
      try { socket.close(); } catch {}
      if (child.exitCode === null) {
        child.kill("SIGTERM");
        await Promise.race([
          new Promise((resolve) => child.once("exit", resolve)),
          delay(2_000),
        ]);
      }
      await retry(() => rm(profile, { recursive: true, force: true }), {
        attempts: 10,
        interval: 100,
      });
    },
  };
}
