// Browser-level audit for the library popovers. Start Chrome with a remote
// debugging port, then run this file against the currently loaded app.
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
  const request = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) request.reject(new Error(message.error.message));
  else request.resolve(message.result);
});
const send = (method, params = {}) => {
  const id = ++nextId;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
};
const evaluate = async (expression) => {
  const response = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.text);
  return response.result.value;
};

await send("Page.enable");
// Exercise the full motion path even when the host Mac is configured to reduce
// motion. The reduced-motion fallback is covered by the static motion gate.
await send("Emulation.setEmulatedMedia", {
  features: [
    { name: "prefers-reduced-motion", value: "no-preference" },
    { name: "prefers-color-scheme", value: "light" },
  ],
});
// Use the LAN endpoint for browser geometry. Public-path version and MIME
// checks belong to deploy.sh; Chrome for Testing can reject the private
// Tailscale certificate even while Safari and curl trust it.
await send("Page.navigate", { url: `http://anujrpi.local:4311/?audit=${Date.now()}` });
await new Promise((resolve) => setTimeout(resolve, 3500));
const result = await evaluate(`(async () => {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const root = document.documentElement;
  [...document.querySelectorAll('button')]
    .find((button) => button.textContent.trim().includes('Library'))?.click();
  for (let attempt = 0; attempt < 30 && !document.querySelector('#rr-filter-btn'); attempt += 1) {
    await wait(100);
  }
  if (!document.querySelector('#rr-filter-btn')) throw new Error('Library controls did not appear');
  const sample = async (theme) => {
    if (theme === 'system') delete root.dataset.rrTheme;
    else root.dataset.rrTheme = theme;
    document.querySelector('#rr-sort-btn').click();
    await wait(80);
    const menu = document.querySelector('#rr-sort-menu');
    const style = getComputedStyle(menu);
    const sort = { background: style.backgroundColor, color: style.color };
    document.querySelector('#rr-sort-btn').click();
    document.querySelector('#rr-filter-btn').click();
    await wait(380);
    const panel = document.querySelector('.catalog .filters');
    const rect = panel.getBoundingClientRect();
    const filter = {
      left: rect.left, right: rect.right, width: rect.width, viewport: innerWidth,
      rootOpen: root.classList.contains('rr-filters-open'),
      display: getComputedStyle(panel).display,
    };
    document.querySelector('#rr-filter-btn').click();
    return { sort, filter };
  };
  root.dataset.rrTheme = 'light';
  document.querySelector('#rr-settings-link').click();
  for (let attempt = 0; attempt < 40 && !document.querySelector('#rr-settings-overlay')?.contentDocument?.querySelector('#close'); attempt += 1) {
    await wait(100);
  }
  const overlay = document.querySelector('#rr-settings-overlay');
  if (!overlay?.contentDocument?.querySelector('#close')) throw new Error('Settings did not open');
  overlay.contentDocument.querySelector('#close').click();
  const settings = {
    closingImmediately: overlay.classList.contains('rr-settings-closing'),
    presentImmediately: overlay.isConnected,
  };
  await wait(120);
  const exitStyle = getComputedStyle(overlay);
  settings.closingDuringExit = overlay.classList.contains('rr-settings-closing');
  settings.presentDuringExit = overlay.isConnected;
  settings.animationDuringExit = exitStyle.animationName;
  settings.transformDuringExit = exitStyle.transform;
  await wait(500);
  settings.removedAfterExit = !document.querySelector('#rr-settings-overlay');

  return { light: await sample('light'), systemLight: await sample('system'), dark: await sample('dark'), settings };
})()`);

for (const theme of ["light", "systemLight", "dark"]) {
  const entry = result[theme];
  const bounded = entry.filter.left >= 13 && entry.filter.right <= entry.filter.viewport - 13;
  console.log(`${theme}: sort ${entry.sort.background} / ${entry.sort.color}`);
  console.log(`${theme}: filter ${entry.filter.left.toFixed(1)}..${entry.filter.right.toFixed(1)} of ${entry.filter.viewport} ${bounded ? "PASS" : "FAIL"}`);
  if (!bounded) process.exitCode = 1;
}
const lightMenuMatches = result.light.sort.background === 'rgba(255, 255, 255, 0.97)'
  && result.light.sort.color === 'rgb(28, 28, 30)'
  && result.systemLight.sort.background === 'rgba(255, 255, 255, 0.97)'
  && result.systemLight.sort.color === 'rgb(28, 28, 30)';
console.log(`light menu palette: ${lightMenuMatches ? "PASS" : "FAIL"}`);
if (!lightMenuMatches) process.exitCode = 1;

const settingsExitPass = result.settings.presentImmediately
  && result.settings.closingDuringExit
  && result.settings.presentDuringExit
  && (result.settings.animationDuringExit === 'rr-settings-spring-out'
    || result.settings.transformDuringExit !== 'none')
  && result.settings.removedAfterExit;
console.log(`settings exit: ${settingsExitPass ? "PASS" : "FAIL"} (${JSON.stringify(result.settings)})`);
if (!settingsExitPass) process.exitCode = 1;
socket.close();
