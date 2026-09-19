// Small Chrome DevTools helper for checking the rendered reader, not just its
// source. Start Chrome with --remote-debugging-port=9222, then run this file.

const pages = await fetch("http://127.0.0.1:9222/json").then((response) => response.json());
const page = pages.find((item) => item.type === "page" && item.url.includes("anujrpi"));
if (!page) throw new Error("Reading Room page not found in Chrome");

const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

let nextId = 0;
const pending = new Map();
socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (!message.id || !pending.has(message.id)) return;
  const { resolve, reject } = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) reject(new Error(message.error.message)); else resolve(message.result);
});

function send(method, params = {}) {
  const id = ++nextId;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

async function evaluate(expression) {
  const response = await send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.text);
  return response.result.value;
}

await send("Runtime.enable");
await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
if (process.argv.includes("--open-reader")) {
  await evaluate(`(() => {
    const button = [...document.querySelectorAll('.shelf-book')]
      .find((item) => item.textContent.includes('William Trevor'));
    if (!button) return false;
    button.click();
    return true;
  })()`);
  await new Promise((resolve) => setTimeout(resolve, 2500));
}

if (process.argv.includes("--click-menu")) {
  await evaluate(`(() => {
    const button = document.querySelector('.rr-react-sheet-trigger');
    if (!button) return false;
    button.click();
    return true;
  })()`);
  await new Promise((resolve) => setTimeout(resolve, 300));
}

if (process.argv.includes("--tap-menu")) {
  const point = await evaluate(`(() => {
    const button = document.querySelector('.rr-react-sheet-trigger');
    if (!button) return null;
    const rect = button.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  if (!point) throw new Error("Reading settings trigger not found");
  await send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: point.x, y: point.y, radiusX: 2, radiusY: 2, force: 1, id: 1 }],
  });
  await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await new Promise((resolve) => setTimeout(resolve, 450));
}

const result = await evaluate(`(() => {
  const trigger = document.querySelector('.rr-react-sheet-trigger');
  const sheet = document.querySelector('[role="dialog"][aria-label="Reading menu"]');
  const style = trigger ? getComputedStyle(trigger) : null;
  return ({
  url: location.href,
  title: document.title,
  ready: document.documentElement.dataset.rrLibraryReady,
  bookCount: document.querySelectorAll('.book').length,
  reader: !!document.querySelector('.reader-shell'),
  readerTheme: document.querySelector('.reader-shell')?.className || null,
  rootClasses: document.documentElement.className,
  themeMetas: [...document.querySelectorAll('meta[name="theme-color"]')]
    .map((meta) => ({ content: meta.content, media: meta.media || null })),
  statusBarMetas: [...document.querySelectorAll('meta[name="apple-mobile-web-app-status-bar-style"]')]
    .map((meta) => meta.content),
  trigger: trigger ? {
    rect: trigger.getBoundingClientRect().toJSON(),
    display: style.display,
    color: style.color,
    background: style.backgroundColor,
    pointerEvents: style.pointerEvents,
  } : null,
  sheet: sheet ? {
    rect: sheet.getBoundingClientRect().toJSON(),
    text: sheet.textContent.trim().replace(/\\s+/g, ' '),
  } : null,
  buttons: [...document.querySelectorAll('button')].slice(0, 30).map((button) => ({
    text: button.textContent.trim().replace(/\\s+/g, ' '),
    label: button.getAttribute('aria-label'),
    className: button.className,
  })),
  });
})()`);
console.log(JSON.stringify(result, null, 2));
socket.close();
