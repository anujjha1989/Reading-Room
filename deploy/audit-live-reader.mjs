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
if (process.argv.includes("--seed-legacy")) {
  await evaluate(`localStorage.setItem('rr-react-sheet', 'legacy')`);
}
if (process.argv.includes("--reload")) {
  await send("Page.enable");
  await send("Page.navigate", {
    url: `http://anujrpi.local:4311/?audit=${Date.now()}`,
  });
  await new Promise((resolve) => setTimeout(resolve, 3500));
}
if (process.argv.includes("--pages")) {
  await evaluate(`localStorage.setItem('reading-room-reader-mode', 'pages')`);
}
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

if (process.argv.includes("--tap-panel-backs")) {
  const touchElement = async (selector) => {
    const target = await evaluate(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const hit = document.elementFromPoint(x, y);
      return { x, y, hitLabel: hit?.getAttribute?.('aria-label') || null };
    })()`);
    if (!target) throw new Error(`touch target not found: ${selector}`);
    await send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: target.x, y: target.y, radiusX: 2, radiusY: 2, force: 1, id: 1 }],
    });
    await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await new Promise((resolve) => setTimeout(resolve, 350));
    return target.hitLabel;
  };
  const panelBacks = {};
  for (const [tile, panel, key] of [["Search", "Search inside book", "search"], ["Marks", "Bookmarks", "bookmarks"]]) {
    await evaluate(`(() => {
      const sheet = document.querySelector('section[role="dialog"][data-book-theme]');
      [...sheet.querySelectorAll('button')].find((button) =>
        [...button.querySelectorAll('span')].some((span) => span.textContent.trim() === ${JSON.stringify(tile)})
      )?.click();
    })()`);
    await new Promise((resolve) => setTimeout(resolve, 250));
    const hitLabel = await touchElement(`aside[aria-label="${panel}"] button[aria-label="Back to reading menu"]`);
    panelBacks[key] = {
      hitLabel,
      panelClosed: !await evaluate(`!!document.querySelector('aside[aria-label="${panel}"]')`),
      menuOpen: await evaluate(`document.documentElement.classList.contains('rr-react-sheet-open')`),
    };
  }
  await evaluate(`window.__rrPanelBackAudit = ${JSON.stringify(panelBacks)}`);
}

if (process.argv.includes("--exercise-menu")) {
  const audit = await evaluate(`(async () => {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const clickText = (root, text) => {
      const button = [...root.querySelectorAll('button')]
        .find((item) => [...item.querySelectorAll('span')]
          .some((span) => span.textContent.trim().replace(/\\s+/g, ' ') === text));
      if (!button) throw new Error('button not found: ' + text);
      button.click();
    };
    const sheet = () => document.querySelector('section[role="dialog"][data-book-theme]');
    const result = {};

    clickText(sheet(), 'Search'); await wait(100);
    result.searchBack = !!document.querySelector('.reader-panel button[aria-label="Back to reading menu"]');
    document.querySelector('.reader-panel button[aria-label="Back to reading menu"]')?.click(); await wait(100);

    clickText(sheet(), 'Marks'); await wait(100);
    result.bookmarksBack = !!document.querySelector('.reader-panel button[aria-label="Back to reading menu"]');
    document.querySelector('.reader-panel button[aria-label="Back to reading menu"]')?.click(); await wait(100);

    clickText(sheet(), 'Text'); await wait(100);
    sheet().querySelector('button[title="Dark"]')?.click(); await wait(150);
    const darkSheet = sheet();
    const darkStyle = getComputedStyle(darkSheet);
    result.darkSheet = {
      bookTheme: darkSheet.getAttribute('data-book-theme'),
      color: darkStyle.color,
      background: darkStyle.backgroundColor,
    };
    [...darkSheet.querySelectorAll('button')]
      .find((button) => button.textContent.trim() === 'Scroll')?.click();
    await wait(1400);
    darkSheet.querySelector('button[aria-label="Back to reading menu"]')?.click(); await wait(100);

    clickText(sheet(), 'Aloud'); await wait(100);
    result.aloudText = sheet().textContent.trim().replace(/\\s+/g, ' ');
    const startedAt = performance.now();
    clickText(sheet(), 'Start reading');
    for (let tries = 0; tries < 80 && !sheet().textContent.includes('Stop reading'); tries += 1) {
      await wait(100);
    }
    result.readAloudStartupMs = Math.round(performance.now() - startedAt);
    result.readAloudControls = {
      previous: !!sheet().querySelector('button[aria-label="Previous sentence"]'),
      pause: !!sheet().querySelector('button[aria-label="Pause reading"]'),
      next: !!sheet().querySelector('button[aria-label="Next sentence"]'),
      sleepMinus: !!sheet().querySelector('button[aria-label="Subtract 30 minutes"]'),
      sleepPlus: !!sheet().querySelector('button[aria-label="Add 30 minutes"]'),
      follow: (() => {
        const button = document.querySelector('.rr-read-follow');
        if (!button) return null;
        const style = getComputedStyle(button);
        return {
          label: button.getAttribute('aria-label'),
          visible: style.opacity === '1' && style.pointerEvents !== 'none',
          backdrop: style.backdropFilter || style.webkitBackdropFilter,
        };
      })(),
    };
    const highlightedContext = () => {
      const frames = [...document.querySelectorAll('.epub-viewer iframe')];
      for (const frame of frames) {
        try {
          const registry = frame.contentWindow?.CSS?.highlights;
          const highlight = registry?.get('rr-reading');
          const range = highlight && [...highlight][0];
          if (range) {
            let host = frame.parentElement;
            while (host) {
              const style = getComputedStyle(host);
              if (/(auto|scroll)/.test(style.overflowY) && host.scrollHeight > host.clientHeight + 4) break;
              host = host.parentElement;
            }
            host ||= document.scrollingElement;
            const frameTop = frame.getBoundingClientRect().top;
            const rangeTop = range.getBoundingClientRect().top;
            return {
              top: frameTop + rangeTop,
              frameTop,
              rangeTop,
              hostTop: host === document.scrollingElement ? 0 : host.getBoundingClientRect().top,
              hostScrollTop: host.scrollTop,
              hostScrollHeight: host.scrollHeight,
              hostClientHeight: host.clientHeight,
              host,
              hostName: host === document.scrollingElement ? 'document' : host.tagName + '.' + host.className,
            };
          }
        } catch (error) {}
      }
      return null;
    };
    const follow = document.querySelector('.rr-read-follow');
    const initialContext = highlightedContext();
    if (follow && initialContext) {
      const initialHighlightTop = initialContext.top;
      const scroller = initialContext.host;
      const room = scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop;
      const displacement = Math.min(600, Math.max(180, room));
      scroller.scrollTop += displacement;
      await wait(80);
      const displacedTop = highlightedContext()?.top ?? null;
      const displacedContext = highlightedContext();
      follow.click();
      await wait(220);
      const restoredTop = highlightedContext()?.top ?? null;
      const restoredContext = highlightedContext();
      result.followAction = {
        initialHighlightTop,
        scrollHost: initialContext.hostName,
        displacement,
        displacedTop,
        restoredTop,
        displacedContext,
        restoredContext,
        movedTowardTop: displacedTop != null && restoredTop != null
          && Math.abs(restoredTop - 20) < Math.abs(displacedTop - 20),
      };
    }
    [...sheet().querySelectorAll('button')]
      .find((button) => button.textContent.includes('Stop reading'))?.click();
    return result;
  })()`);
  await evaluate(`window.__rrAuditResult = ${JSON.stringify(audit)}`);
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
  exercise: window.__rrAuditResult || null,
  panelBacks: window.__rrPanelBackAudit || null,
  trigger: trigger ? {
    rect: trigger.getBoundingClientRect().toJSON(),
    hit: (() => {
      const rect = trigger.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return { tag: hit?.tagName || null, className: hit?.className || null, label: hit?.getAttribute?.('aria-label') || null };
    })(),
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
