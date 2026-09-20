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
    root.dataset.rrTheme = theme;
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
    const filter = { left: rect.left, right: rect.right, width: rect.width, viewport: innerWidth };
    document.querySelector('#rr-filter-btn').click();
    return { sort, filter };
  };
  return { version: document.documentElement.innerHTML.includes('v111'), light: await sample('light'), dark: await sample('dark') };
})()`);

for (const theme of ["light", "dark"]) {
  const entry = result[theme];
  const bounded = entry.filter.left >= 13 && entry.filter.right <= entry.filter.viewport - 13;
  console.log(`${theme}: sort ${entry.sort.background} / ${entry.sort.color}`);
  console.log(`${theme}: filter ${entry.filter.left.toFixed(1)}..${entry.filter.right.toFixed(1)} of ${entry.filter.viewport} ${bounded ? "PASS" : "FAIL"}`);
  if (!bounded) process.exitCode = 1;
}
socket.close();
