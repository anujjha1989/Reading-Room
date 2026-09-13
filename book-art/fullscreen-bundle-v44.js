// The Reading Room — full-page reading.
//
// Companion to fullscreen-fix.css, which carries the reasoning. This file sets
// classes on <html> and wires up the gestures:
//
//   ≡              opens/closes the controls sheet
//   Hide toolbars  (in the sheet) hides the strip and footer
//   centre tap     the same toggle, without opening anything
//
// Nothing here moves a node the app rendered. The controls are relocated by
// CSS; every element this adds is appended to <body>, which React does not
// manage, so a re-render can never trip over it.
(function () {
  "use strict";

  var root = document.documentElement;
  var HIDE_KEY = "reading-room-hide-chrome";

  var hidden = false;
  try { hidden = localStorage.getItem(HIDE_KEY) === "1"; } catch (e) { /* private mode */ }

  function shell() { return document.querySelector(".reader-shell"); }
  function sheetOpen() { return root.classList.contains("rr-sheet-open"); }
  function closeSheet() {
    root.classList.remove("rr-sheet-open");
    var settings = document.querySelector(".reader-settings");
    if (settings) settings.open = false;
    try { window.dispatchEvent(new Event("rr-close-reading-menu")); } catch (e) { /* old browser */ }
    schedule();
  }
  function openSheet() { root.classList.add("rr-sheet-open"); schedule(); }

  function setHidden(value) {
    hidden = !!value;
    try { localStorage.setItem(HIDE_KEY, hidden ? "1" : "0"); } catch (e) { /* private mode */ }
    if (hidden) closeSheet();
    root.classList.toggle("rr-hide-chrome", hidden);
    schedule();
  }

  // iOS reads this when adding to the home screen; keep it present even if a
  // hydration pass rewrites the head from the RSC payload.
  function ensureStandaloneMeta() {
    if (document.querySelector('meta[name="apple-mobile-web-app-capable"]')) return;
    var m = document.createElement("meta");
    m.setAttribute("name", "apple-mobile-web-app-capable");
    m.setAttribute("content", "yes");
    document.head.appendChild(m);
  }

  // --- The buttons ----------------------------------------------------------
  // All on <body>: outside React's tree, and outside `.reader-actions`, whose
  // transform would otherwise become their containing block and carry them
  // off-screen whenever the sheet closes.
  var btn = null, closeBtn = null, hideBtn = null;

  function make(className, label, text, onClick) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = className;
    b.setAttribute("aria-label", label);
    b.textContent = text;
    b.addEventListener("click", function (event) {
      event.preventDefault();
      event.stopPropagation();
      onClick();
    });
    document.body.appendChild(b);
    return b;
  }

  function ensureButtons() {
    if (!btn || !btn.isConnected) {
      btn = make("rr-sheet-btn", "Reading controls", "≡", function () {
        if (sheetOpen()) closeSheet();
        else { setHidden(false); openSheet(); }
        btn.setAttribute("aria-expanded", String(sheetOpen()));
      });
      btn.setAttribute("aria-expanded", "false");
    }
    if (!closeBtn || !closeBtn.isConnected) {
      // Forwards to the app's own close button rather than reimplementing it —
      // a real click, which React's delegated handler picks up normally.
      closeBtn = make("rr-close-btn", "Close book", "×", function () {
        var real = document.querySelector(".reader-actions .reader-close");
        if (real) real.click();
      });
    }
    if (!hideBtn || !hideBtn.isConnected) {
      // The dependable way to get a full page: an ordinary button in the host
      // document, which works whatever the book's own touch handling does.
      hideBtn = make("rr-hide-btn", "Hide toolbars", "Hide toolbars", function () {
        closeSheet();
        setHidden(true);
      });
    }
    // Only claim the app's close button as a duplicate once ours is actually
    // standing in for it; if this file never runs, the original stays visible.
    root.classList.toggle(
      "rr-has-close",
      !!(closeBtn && closeBtn.isConnected && document.querySelector(".reader-actions .reader-close"))
    );
  }

  // --- Centre tap -----------------------------------------------------------
  // Not `click`: the paginator handles touchstart/touchend and pointerdown/
  // pointerup, and on iOS a touch handler that calls preventDefault means
  // Safari never synthesises a click at all. So this detects a tap itself —
  // down and up close together in space and time — which also lets it tell a
  // tap apart from a swipe (a page turn) and from a long press (a selection).
  //
  // The middle band toggles controls; the outer bands turn pages in Pages
  // mode. All coordinates are measured against the visible host viewport.
  var down = null;
  var SLOP = 12;      // px of movement still counted as a tap, not a swipe
  var MAX_MS = 400;   // longer than this is a press, not a tap

  // Opt-in, on-device diagnostics only. No book content, storage or network.
  var debugEnabled = /(?:\?|&)tapdebug=1(?:&|$)/.test(window.location ? window.location.search : "");
  var debugPanel = null, debugLines = [];
  function debug(message) {
    if (!debugEnabled) return;
    debugLines.push(message);
    debugLines = debugLines.slice(-7);
    if (!debugPanel && document.body) {
      debugPanel = document.createElement("pre");
      debugPanel.style.cssText = "position:fixed;bottom:65px;left:8px;right:8px;z-index:2147483647;background:#111e;color:#fff;font:11px/1.4 monospace;padding:8px;white-space:pre-wrap;pointer-events:none;margin:0";
      document.body.appendChild(debugPanel);
    }
    if (debugPanel) debugPanel.textContent = "Touch diagnostic v10 (local only)\n" + debugLines.join("\n");
  }

  var INTERACTIVE = { a: 1, button: 1, input: 1, select: 1, textarea: 1, summary: 1, label: 1 };
  function overInteractive(node) {
    for (var n = node; n && n.nodeType === 1; n = n.parentNode) {
      if (INTERACTIVE[(n.tagName || "").toLowerCase()] || n.isContentEditable || (n.getAttribute && n.getAttribute("role") === "button")) return true;
    }
    return false;
  }

  function point(event) {
    if (event.changedTouches && event.changedTouches.length) return event.changedTouches[0];
    if (event.touches && event.touches.length) return event.touches[0];
    return event;
  }

  function onUp(event, tag) {
    var start = down;
    down = null;
    if (Date.now() - lastActed < 350) return;   // same tap, another event family

    if (!start) { debug(event.type + ": no start/cancelled"); return; }
    if (!shell()) return;

    var p = point(event);
    debug(event.type + " " + tag + " raw=" + Math.round(p.clientX) + "," + Math.round(p.clientY));
    if (Math.abs(p.clientX - start.x) > SLOP || Math.abs(p.clientY - start.y) > SLOP) { debug("Ignored: movement"); return; }
    if (Date.now() - start.t > MAX_MS) { debug("Ignored: long press"); return; }
    if (overInteractive(event.target)) { debug("Ignored: interactive element"); return; }

    var view = (event.target.ownerDocument && event.target.ownerDocument.defaultView) || event.view || window;
    var stage = document.querySelector(".epub-stage");
    if (!stage) { debug("No reading stage"); return; }
    var box = stage.getBoundingClientRect();
    var x = p.clientX, y = p.clientY;
    // EPUB iframes can be many columns wide and translated left. Map the
    // pointer into the host viewport instead of dividing by that huge width.
    try {
      var frame = view.frameElement;
      if (frame) {
        var rect = frame.getBoundingClientRect();
        x = rect.left + x * (frame.clientWidth ? rect.width / frame.clientWidth : 1);
        y = rect.top + y * (frame.clientHeight ? rect.height / frame.clientHeight : 1);
      }
    } catch (e) { debug("Frame access failed"); return; }
    var left = Math.max(0, box.left), right = Math.min(window.innerWidth, box.right);
    var top = Math.max(0, box.top), bottom = Math.min(window.innerHeight, box.bottom);
    debug("mapped=" + Math.round(x) + "," + Math.round(y) + " area=" + [left,right,top,bottom].map(Math.round).join(","));
    if (right <= left || x < left || x > right || y < top || y > bottom) { debug("Ignored: outside visible area"); return; }
    var fraction = (x - left) / (right - left);

    try {
      var sel = view.getSelection && view.getSelection();
      if (sel && String(sel).length) { debug("Ignored: text selection"); return; }
    } catch (e) { /* ignore */ }

    lastActed = Date.now();
    debug("Action: " + (fraction >= 0.3 && fraction <= 0.7 ? "centre" : pagesMode() ? fraction < 0.3 ? "previous" : "next" : "scroll mode"));
    if (sheetOpen()) return;
    if (fraction >= 0.3 && fraction <= 0.7) {
      // Safari follows a touch with a compatibility click inside the ebook.
      // Read Aloud must not mistake that click for "read from here".
      window.__rrControlTapAt = Date.now();
      setHidden(!hidden);
    }
    else if (pagesMode()) turnPage(fraction < 0.3 ? -1 : 1);
  }

  function pagesMode() {
    var buttons = document.querySelectorAll(".reader-modes button");
    for (var i = 0; i < buttons.length; i++) {
      if (buttons[i].textContent.trim() === "Pages") return buttons[i].getAttribute("aria-pressed") === "true";
    }
    return false;
  }

  // WebKit suppresses callbacks inside sandboxed ebook frames without
  // allow-scripts. Keep that security boundary; use native host-page buttons.
  var tapLayer = null, textModeButton = null, textMode = false, scrollWrapper = null;
  function syncTapLayer() {
    var touchDevice = navigator.maxTouchPoints > 0;
    var stage = document.querySelector(".epub-stage");
    var scrollHost = !pagesMode() && document.querySelector(".epub-container, .pdf-scroll, .comic-scroll");
    var enabled = touchDevice && !!shell() && !!stage && (pagesMode() || !!scrollHost);
    if (!enabled) {
      if (tapLayer) tapLayer.style.display = "none";
      if (textModeButton) textModeButton.style.display = "none";
      return;
    }
    if (!tapLayer) {
      tapLayer = document.createElement("div");
      tapLayer.setAttribute("aria-label", "Page tap controls");
      tapLayer.style.cssText = "position:fixed;z-index:110;display:flex;background:transparent;touch-action:pan-y";
      ["Previous page", "Show or hide reading controls", "Next page"].forEach(function (label, i) {
        var button = document.createElement("button");
        button.type = "button";
        button.setAttribute("aria-label", label);
        button.style.cssText = "display:block;flex:0 0 " + (i === 1 ? "40%" : "30%") + ";height:100%;padding:0;margin:0;border:0;border-radius:0;background:transparent;box-shadow:none;color:transparent;touch-action:pan-y;-webkit-tap-highlight-color:transparent";
        button.addEventListener("click", function (event) {
          event.preventDefault();
          event.stopPropagation();
          if (Date.now() - lastActed < 350) return;
          lastActed = Date.now();
          debug("Host tap: " + label);
          if (i === 1) {
            window.__rrControlTapAt = Date.now();
            setHidden(!hidden);
          }
          else turnPage(i === 0 ? -1 : 1);
          syncTapLayer();
        });
        tapLayer.appendChild(button);
      });
      // Preserve horizontal swipe navigation; suppress the click after a swipe.
      var swipe = null;
      tapLayer.addEventListener("touchstart", function (event) {
        swipe = event.touches.length === 1 ? {x:event.touches[0].clientX,y:event.touches[0].clientY,t:Date.now()} : null;
      }, {passive:true});
      tapLayer.addEventListener("touchend", function (event) {
        event.stopPropagation();
        if (!swipe) { lastActed = Date.now(); return; }
        if (Date.now() - swipe.t > MAX_MS) { swipe = null; lastActed = Date.now(); return; }
        var dx = event.changedTouches[0].clientX - swipe.x;
        var dy = event.changedTouches[0].clientY - swipe.y;
        swipe = null;
        if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.35) {
          event.preventDefault();
          lastActed = Date.now();
          turnPage(dx < 0 ? 1 : -1);
        } else if (Math.abs(dx) > SLOP || Math.abs(dy) > SLOP) lastActed = Date.now();
      }, {passive:false});
      tapLayer.addEventListener("touchcancel", function () { swipe = null; });
      document.body.appendChild(tapLayer);
      textModeButton = make("rr-text-mode", "Select text or follow book links", "Select text / follow links", function () {
        textMode = !textMode;
        closeSheet();
        syncTapLayer();
      });
      textModeButton.style.cssText = "position:fixed;top:calc(98px + env(safe-area-inset-top));left:50%;transform:translateX(-50%);z-index:122;padding:10px 18px;border:1px solid #777;border-radius:20px;background:var(--paper,#fffdf7);color:var(--ink,#1e2422);font:14px sans-serif";
    }
    var textModeLabel = textMode ? "Enable page taps" : "Select text / follow links";
    if (textModeButton.textContent !== textModeLabel) textModeButton.textContent = textModeLabel;
    textModeButton.setAttribute("aria-label", textModeButton.textContent);
    textModeButton.style.display = sheetOpen() ? "block" : "none";
    var box = stage.getBoundingClientRect();
    var left = Math.max(0, box.left), top = Math.max(0, box.top);
    var width = Math.min(window.innerWidth, box.right) - left;
    var height = Math.min(window.innerHeight, box.bottom) - top;
    // In Scroll mode the transparent buttons live INSIDE the native scroller.
    // A zero-height sticky wrapper preserves text layout and iOS momentum.
    if (scrollHost) {
      if (!scrollWrapper || scrollWrapper.parentNode !== scrollHost) {
        if (scrollWrapper) scrollWrapper.remove();
        scrollWrapper = document.createElement("div");
        scrollWrapper.style.cssText = "position:sticky;top:0;left:0;height:0;width:100%;z-index:110;overflow:visible";
        scrollHost.prepend(scrollWrapper);
      }
      if (tapLayer.parentNode !== scrollWrapper) scrollWrapper.appendChild(tapLayer);
      tapLayer.style.position = "absolute";
      left = 0; top = 0; width = scrollHost.clientWidth; height = scrollHost.clientHeight;
    } else {
      if (tapLayer.parentNode !== document.body) document.body.appendChild(tapLayer);
      if (scrollWrapper) { scrollWrapper.remove(); scrollWrapper = null; }
      tapLayer.style.position = "fixed";
    }
    tapLayer.style.left = left + "px";
    tapLayer.style.top = top + "px";
    tapLayer.style.width = Math.max(0, width) + "px";
    tapLayer.style.height = Math.max(0, height) + "px";
    tapLayer.style.display = !textMode && !sheetOpen() && width > 0 && height > 0 ? "flex" : "none";
  }

  function turnPage(direction) {
    if (!pagesMode()) {
      var scroller = document.querySelector(".epub-container, .pdf-scroll, .comic-scroll");
      if (scroller) {
        var atBoundary = direction < 0 ? scroller.scrollTop <= 1 : scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2;
        if (!atBoundary) { scroller.scrollBy({top:direction * scroller.clientHeight * 0.9,behavior:"smooth"}); return; }
      }
    }
    var buttons = document.querySelectorAll(".reader-footer button");
    var button = buttons[direction < 0 ? 0 : buttons.length - 1];
    if (button && !button.disabled) button.click();
  }

  function volumeKey(event) {
    if (!shell() || !pagesMode() || sheetOpen() || overInteractive(event.target)) return;
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    var direction = event.key === "AudioVolumeDown" || event.key === "VolumeDown" ? 1
      : event.key === "AudioVolumeUp" || event.key === "VolumeUp" ? -1 : 0;
    if (!direction) return;
    // Leave volume entirely to the device while read-aloud is active,
    // including pauses between utterances and a manually paused session.
    var speed = document.querySelector(".rr-rate");
    var listen = document.querySelector(".rr-listen");
    if ((speed && !speed.hidden) || (listen && listen.getAttribute("aria-pressed") === "true") ||
        (window.speechSynthesis && (window.speechSynthesis.speaking || window.speechSynthesis.pending || window.speechSynthesis.paused))) return;
    event.preventDefault();
    event.stopPropagation();
    if (!event.repeat) turnPage(direction);
  }

  // Safari may cancel pointer events when the ebook engine handles touch.
  // Track touch independently: a pointercancel must not erase a valid touch.
  // Book iframe events do not bubble to the host, so bind each document too.
  var lastActed = 0;

  function bindTo(target, tag) {
    if (!target || target.__rrTapBound) return 0;
    target.__rrTapBound = 1;
    ["touch", "pointer", "mouse"].forEach(function (family) {
      var start = null;
      var suffix = family === "touch" ? ["start", "end", "cancel", "move"] : ["down", "up", "cancel", "move"];
      target.addEventListener(family + suffix[0], function (event) {
        if (event.isPrimary === false || (event.button != null && event.button !== 0) ||
            (event.touches && event.touches.length !== 1)) { start = null; return; }
        var p = point(event);
        start = { x: p.clientX, y: p.clientY, t: Date.now() };
        debug(family + " start " + tag);
      }, {capture: true, passive: true});
      target.addEventListener(family + suffix[3], function (event) {
        if (!start) return;
        var p = point(event);
        if ((event.touches && event.touches.length !== 1) || Math.abs(p.clientX - start.x) > SLOP || Math.abs(p.clientY - start.y) > SLOP) start = null;
      }, {capture: true, passive: true});
      target.addEventListener(family + suffix[1], function (event) {
        down = start;
        start = null;
        onUp(event, tag);
      }, {capture: true, passive: true});
      target.addEventListener(family + suffix[2], function () { start = null; debug(family + " cancelled"); }, {capture: true, passive: true});
    });
    target.addEventListener("keydown", volumeKey, true);
    debug("Bound " + tag);
    return 1;
  }

  function mkDown(tag) {
    return function (event) {
      if (event.isPrimary === false || (event.button != null && event.button !== 0) || (event.touches && event.touches.length !== 1)) { down = null; return; }
      var p = point(event);
      down = { x: p.clientX, y: p.clientY, t: Date.now() };
      };
  }

  function mkUp(tag) {
    return function (event) { onUp(event, tag); };
  }

  // foliate attaches its shadow root with {mode: "closed"}, so the book's
  // iframe cannot be reached by traversal — `renderer.getContents()` is the
  // only way in. epub.js instead renders into same-origin iframes in the light
  // DOM. Events inside a book document never reach the host page, so each one
  // needs its own listener; the host-side elements are bound too in case the
  // gesture is being handled by an overlay above the iframe instead.
  function documents() {
    var out = [];
    var view = document.querySelector("foliate-view");
    if (view && view.renderer && typeof view.renderer.getContents === "function") {
      try {
        var contents = view.renderer.getContents() || [];
        for (var i = 0; i < contents.length; i += 1) if (contents[i] && contents[i].doc) out.push(contents[i].doc);
      } catch (e) { /* not ready */ }
    }
    var frames = document.querySelectorAll(".epub-viewer iframe");
    for (var j = 0; j < frames.length; j += 1) {
      try { if (frames[j].contentDocument && frames[j].contentDocument.body) out.push(frames[j].contentDocument); }
      catch (e) { /* cross-origin */ }
    }
    return out;
  }

  function bindTaps() {
    bindTo(document.querySelector(".epub-stage"), "stg");
    var docs = documents();
    for (var i = 0; i < docs.length; i += 1) {
    bindTo(docs[i], "doc");
    }
  }

  // Close only through explicit controls, not outside taps. The font-settings
  // close button lives on body, outside React's sheet: a document capture
  // listener would otherwise close the entire sheet before its click runs.

  document.addEventListener("keydown", function (event) {
    if (event.key !== "Escape") return;
    if (sheetOpen()) closeSheet();
    else if (hidden) setHidden(false);
  });
  document.addEventListener("keydown", volumeKey, true);

  // --- Keep <html> in step with whatever the reader is doing ----------------
  var queued = false;
  var lastSize = "", lastViewer = null;
  function refreshLayout() {
    var viewer = document.querySelector(".epub-viewer");
    if (!viewer) return;
    var rect = viewer.getBoundingClientRect();
    var size = Math.round(rect.width) + ":" + Math.round(rect.height);
    if (size !== lastSize || viewer !== lastViewer) {
      lastSize = size; lastViewer = viewer;
      // epub.js already listens for window resize and preserves its location.
      // Toolbar/grid changes do not naturally generate that event.
      if (rect.width > 0 && rect.height > 0) window.dispatchEvent(new Event("resize"));
    }
    var light = shell() && shell().classList.contains("reader-theme-light");
    documents().forEach(function (doc) {
      if (!doc.head) return;
      var style = doc.getElementById("rr-light-reading");
      if (!style) { style = doc.createElement("style"); style.id = "rr-light-reading"; doc.head.appendChild(style); }
      // The engine injects :root background rules with !important. Match a
      // higher specificity so its later theme refresh cannot restore cream.
      var css = light ? ':root:root,:root body{background:#ffffff!important;background-image:none!important;color:#202123!important;color-scheme:light!important}body{font-family:ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif!important;padding-top:12px!important;padding-bottom:12px!important}p,li,blockquote,div,span{font-family:inherit!important;text-align:start!important}p{font-size:1em!important}a{color:#0969da!important}' : '';
      if (style.textContent !== css) style.textContent = css;
    });
  }
  var panelCloseButton = null, fontCloseButton = null;
  function syncPanelCloseButtons() {
    if (!panelCloseButton) {
      panelCloseButton = make("rr-panel-close", "Close reading controls", "×", closeSheet);
      fontCloseButton = make("rr-panel-close", "Close font settings", "×", function () {
        var settings = document.querySelector(".reader-settings");
        if (settings) settings.open = false;
        schedule();
      });
    }
    var controls = document.querySelector(".reader-actions");
    var settings = document.querySelector(".reader-settings[open] > div");
    function position(button, panel, parent) {
      button.style.display = "none";
      if (!shell() || !sheetOpen() || !panel) return;
      var rect = panel.getBoundingClientRect();
      var bounds = parent ? parent.getBoundingClientRect() : rect;
      var top = Math.max(rect.top + 4, bounds.top + (parent ? 48 : 4), 4);
      if (rect.width < 48 || Math.min(rect.bottom, bounds.bottom, window.innerHeight) < top + 44) return;
      button.style.top = top + "px";
      button.style.left = (Math.min(rect.right, window.innerWidth) - 48) + "px";
      var theme = window.getComputedStyle(shell());
      button.style.background = theme.getPropertyValue("--paper") || "#fff";
      button.style.color = theme.getPropertyValue("--ink") || "#222";
      button.style.display = "grid";
    }
    position(panelCloseButton, controls);
    position(fontCloseButton, settings, controls);
  }
  function apply() {
    queued = false;
    if (debugEnabled && !debugPanel) debug("Ready; open a book, then tap");
    var s = shell();
    if (!s) {
      // v44: nothing to tear down when the reader was never open — do not
      // rewrite <html>'s class list on every mutation and every interval tick.
      if (!root.classList.contains("rr-strip")) { textMode = false; return; }
      root.classList.remove("rr-strip", "rr-hide-chrome", "rr-sheet-open", "rr-theme-dark", "rr-has-close");
      textMode = false;
      if (panelCloseButton) panelCloseButton.style.display = "none";
      if (fontCloseButton) fontCloseButton.style.display = "none";
      syncTapLayer();
      return;
    }
    ensureStandaloneMeta();
    ensureButtons();
    root.classList.add("rr-strip");
    root.classList.toggle("rr-hide-chrome", hidden);
    root.classList.toggle("rr-theme-dark", s.classList.contains("reader-theme-dark"));
    bindTaps();
    syncTapLayer();
    refreshLayout();
    syncPanelCloseButtons();
  }

  function schedule() {
    if (queued) return;
    queued = true;
    (window.requestAnimationFrame || setTimeout)(apply, 0);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", apply);
  else apply();
  // Sections mount asynchronously and are swapped as you read, and the whole
  // shell comes and goes as books open and close — so keep looking.
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener("resize", schedule);
  if (window.visualViewport) window.visualViewport.addEventListener("resize", schedule);
  document.addEventListener("transitionend", schedule);
  // v44: capture-phase, so this fires for EVERY scroller on the page —
  // including each library carousel.  Only the reader shell needs
  // scroll-driven layout, and rr-strip is on <html> exactly while it is
  // open, so this costs one class check per scroll event instead of a
  // full apply() per frame.
  document.addEventListener("scroll", function () {
    if (root.classList.contains("rr-strip")) schedule();
  }, true);
  document.addEventListener("toggle", schedule, true);
  setInterval(apply, 1500);
})();

// Library-only navigation: reuse the app's existing actions and catalogue.
// No catalogue data, progress, or reader settings are changed by this layer.
(function () {
  "use strict";
  var dock, selected = "Home", pending = false;
  var icons = {
    Home: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/>',
    Library: '<rect x="3" y="4" width="4" height="17" rx="1"/><rect x="10" y="3" width="4" height="18" rx="1"/><path d="m17 5 3-1 4 16-3 1zM3 8h4M10 7h4"/>',
    Favorites: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8z"/>',
    Search: '<circle cx="10.5" cy="10.5" r="7.5"/><path d="m16 16 5 5"/>'
  };
  function findView(name) {
    return Array.from(document.querySelectorAll('.topbar nav button')).find(function (b) {
      return b.textContent.includes(name);
    });
  }
  function scrollToPart(selector) {
    var part = document.querySelector(selector);
    if (part) part.scrollIntoView({block:"start",behavior:"auto"});
  }
  function navigate(name) {
    var brand = document.querySelector('.topbar .brand');
    if (name === "Home") {
      if (brand) brand.click();
      window.scrollTo({top:0,behavior:"auto"});
    } else if (name === "Library" || name === "Favorites") {
      if (brand) brand.click();
      var button = findView(name);
      if (button) button.click();
      // React removes discovery shelves when changing views. Scroll only
      // after the resulting layout has committed.
      requestAnimationFrame(function () { requestAnimationFrame(function () { window.scrollTo({top:0,behavior:"auto"}); }); });
    } else {
      if (brand) brand.click();
    }
    selected = name;
    sync();
    if (name === "Search") {
      window.scrollTo({top:0,behavior:"auto"});
      var input = document.querySelector('.hero .search input');
      if (input) input.focus({preventScroll:true});
    }
  }
  function sync() {
    pending = false;
    var main = document.querySelector('main');
    if (!main || !document.querySelector('.topbar')) return;
    if (document.documentElement.dataset.rrLibraryReady !== '1') return;
    if (!dock || !dock.isConnected) {
      dock = document.createElement('nav');
      dock.className = 'rr-library-dock';
      dock.setAttribute('aria-label','Reading Room navigation');
      ['Home','Library','Favorites'].forEach(function (name) {
        var button = document.createElement('button');
        button.type = 'button';
        button.setAttribute('aria-label',name === 'Library' ? 'Browse full library' : name);
        button.dataset.view = name;
        button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' + icons[name] + '</svg><span>' + name + '</span>';
        button.addEventListener('click',function () { navigate(name); });
        dock.appendChild(button);
      });
      document.body.appendChild(dock);
    }
    var reading = !!document.querySelector('.reader-shell');
    dock.hidden = reading || !!document.querySelector('.modal-backdrop');
    document.documentElement.classList.toggle('rr-library-visible',!reading);
    document.documentElement.dataset.rrLibraryView = selected.toLowerCase();
    var heading = document.querySelector('.hero h1');
    var title = selected === 'Home' ? 'Home' : selected === 'Search' ? 'Search' : selected === 'Favorites' ? 'Favorites' : 'Your Library';
    if (heading && heading.textContent !== title) heading.textContent = title;
    document.querySelectorAll('.smart-shelf').forEach(function (shelf) {
      var title = shelf.querySelector('h2');
      shelf.classList.toggle('rr-continue-shelf',!!title && title.textContent === 'Continue');
    });
    // v44: a synchronous JPEG decode on paint blocks the frame, and because
    // every cover is lazily loaded that lands in the middle of a drag.
    document.querySelectorAll('.shelf-cover img').forEach(function (img) {
      if (img.decoding !== 'async') img.decoding = 'async';
    });
    dock.querySelectorAll('button').forEach(function (b) {
      if (b.dataset.view === selected) b.setAttribute('aria-current','page');
      else b.removeAttribute('aria-current');
    });
  }
  function schedule() {
    if (!pending) { pending = true; requestAnimationFrame(sync); }
  }
  document.addEventListener('click',function (event) {
    var b = event.target.closest && event.target.closest('.topbar nav button, .topbar .brand, .shelf-heading button');
    if (b) {
      selected = b.textContent.includes('Favorites') ? 'Favorites' : b.matches('.brand') ? 'Home' : 'Library';
      schedule();
    }
  });
  new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true});
  window.addEventListener('rr-library-ready',schedule);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',sync);
  else sync();
})();

// Body-owned controls: never move React or EPUB renderer nodes.
(function () {
  'use strict';
  const root = document.documentElement;
  let host, dismissZone, reader, view = 'menu', lastOpen = false, signature = '';
  const $ = s => reader && reader.querySelector(s);
  const open = () => root.classList.contains('rr-sheet-open');
  function close() { root.classList.remove('rr-sheet-open'); view = 'menu'; sync(); }
  function native(label) {
    return reader && [...reader.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === label);
  }
  function button(label, action, icon) {
    const b = document.createElement('button'); b.type = 'button';
    b.setAttribute('aria-label', label);
    const text = document.createElement('span'); text.textContent = label; b.append(text);
    if (icon) { const i = document.createElement('span'); i.textContent = icon; i.setAttribute('aria-hidden','true'); b.append(i); }
    b.onclick = e => { e.stopPropagation(); action(); }; return b;
  }
  function go(name) { view = name; signature = ''; render(); }
  function proxy(label) { const b = native(label); if (b) b.click(); }
  function heading(label) {
    const h = document.createElement('header'); const strong = document.createElement('strong'); strong.textContent = label;
    h.append(strong, button('Back to reading menu', () => go('menu'), '‹'));
    host.append(h);
  }
  function row(label, action, icon) { host.append(button(label, action, icon)); }
  function contentsLabel() {
    const source=$('[data-rr-progress]');
    return 'Contents'+(source&&source.dataset.rrProgress!==undefined?' · '+source.dataset.rrProgress+'%':'');
  }
  function change(el, value) {
    if (!el) return;
    const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto,'value').set.call(el, value);
    el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true}));
  }
  function range(label, source, config) {
    if (!source && !config) return;
    const wrap = document.createElement('label'); wrap.textContent = label;
    const value=document.createElement('output');wrap.append(value);
    const input = document.createElement('input'); input.type = 'range';
    if(config){for(const p of ['min','max','step','value'])input[p]=config[p];value.textContent=config.format(config.value);input.oninput=()=>{config.set(Number(input.value));value.textContent=config.format(input.value);saveType();};}
    else{for (const p of ['min','max','step','value']) input[p] = source[p];value.textContent=input.value;input.oninput = () => {change(source,input.value);value.textContent=input.value;};}
    input.setAttribute('aria-label',label);
    wrap.append(input); host.append(wrap);
  }
  let font='Original',bold=false,line=1.65,chars=0,words=0,margins=4,justify=false,preset='Original';
  try { const s=JSON.parse(localStorage.getItem('rr-books-type')||'{}');font=s.font||font;bold=!!s.bold;line=Number(s.line??line);chars=Number(s.chars??chars);words=Number(s.words??words);margins=Number(s.margins??margins);justify=!!s.justify;preset=s.preset||preset; } catch (_) {}
  function applyType() {
    const families = {Original:'',Serif:'Georgia, serif',Palatino:'Palatino, "Palatino Linotype", serif',Helvetica:'Helvetica, Arial, sans-serif',System:'-apple-system, BlinkMacSystemFont, sans-serif'};
    if (!(font in families)) font = 'Original';
    const docs = [];
    if (reader) {
      for (const frame of reader.querySelectorAll('iframe')) { try { if (frame.contentDocument) docs.push(frame.contentDocument); } catch (_) {} }
      for (const f of reader.querySelectorAll('foliate-view')) { try { for (const c of f.renderer?.getContents?.()||[]) if(c.doc) docs.push(c.doc); } catch (_) {} }
    }
    const text=':root:root:root body,:root:root:root body p,:root:root:root body li,:root:root:root body blockquote';
    const marginPixels=margins*Math.min(window.innerWidth||400,900)/100;
    const css=(families[font]?text+'{font-family:'+families[font]+'!important;}':'')+text+'{font-weight:'+(bold?'700':'inherit')+'!important;line-height:'+line+'!important;letter-spacing:'+chars+'px!important;word-spacing:'+words+'px!important;text-align:'+(justify?'justify':'start')+'!important;}'+':root:root:root body{padding-left:'+marginPixels+'px!important;padding-right:'+marginPixels+'px!important;}';
    for (const doc of docs) { let style=doc.getElementById('rr-books-type'); if(!style){style=doc.createElement('style');style.id='rr-books-type';doc.head?.append(style);} if(style.textContent!==css)style.textContent=css; }
  }
  function saveType() { try { localStorage.setItem('rr-books-type',JSON.stringify({font,bold,line,chars,words,margins,justify,preset})); } catch (_) {} applyType(); window.dispatchEvent(new Event('resize')); }
  function setTheme(name) {
    const presets={Original:['Original',false,1.65,0,0,4,'light'],Quiet:['Palatino',false,1.8,.2,1,6,'dark'],Paper:['Serif',false,1.75,.1,.5,5,'light'],Bold:['System',true,1.62,0,0,4,'light'],Calm:['Palatino',false,1.9,.25,1.5,7,'sepia'],Focus:['Serif',false,2.05,.15,1,8,'light']};
    const p=presets[name];if(!p)return;[font,bold,line,chars,words,margins]=p;preset=name;justify=false;
    const nativeTheme=[...reader.querySelectorAll('.theme-options button')].find(b=>b.textContent.toLowerCase()===p[6]);nativeTheme?.click();saveType();render();
  }
  function render() {
    if (!host || !reader) return;
    host.replaceChildren(); host.dataset.view = view;
    host.setAttribute('aria-label', view === 'menu' ? 'Reading menu' : view);
    if (view === 'menu') {
      row(contentsLabel(),()=>go('Contents'),'☷');
      host.lastElementChild.title=$('[data-rr-progress]')?.dataset.rrProgressEstimated==='true'?'Estimated whole-book progress':'Whole-book progress';
      if(native('Search inside book'))row('Search Book',()=>{close();proxy('Search inside book');},'⌕');
      if($('.reader-settings'))row('Themes & Settings',()=>go('Themes & Settings'),'aA');
      const textMode=document.querySelector('.rr-text-mode');
      const actions=document.createElement('div'); actions.className='rr-books-actions';
      if($('.rr-listen'))actions.append(button('Read Aloud',()=>go('Read Aloud'),'▶'));
      actions.append(button('Bookmarks',()=>{close(); const b=[...reader.querySelectorAll('button')].find(b=>(b.getAttribute('aria-label')||'').startsWith('Bookmarks'));b?.click();},'▯'));
      actions.append(button('More',()=>go('More'),'•••'));
      host.append(actions);
    } else if(view === 'Contents') {
      heading(contentsLabel()); const select=$('.reader-actions select:not(.rr-voice)');
      for(const opt of select?.options||[])if(opt.value){row(opt.textContent,()=>{change(select,opt.value);close();});if(opt.value===select.value)host.lastElementChild.setAttribute('aria-current','location');}
      if(!select||![...select.options].some(o=>o.value)){const note=document.createElement('p');note.textContent='No chapter list is available in this file.';host.append(note);}
    } else if(view === 'Themes & Settings') {
      heading(view);
      const sizes=document.createElement('div');sizes.className='rr-books-actions';
      sizes.append(button('Smaller text',()=>proxy('Decrease text size'),'A−'),button('Larger text',()=>proxy('Increase text size'),'A+'));host.append(sizes);
      const themes=document.createElement('div');themes.className='rr-books-themes';
      for(const name of ['Original','Quiet','Paper','Bold','Calm','Focus']){const b=button(name,()=>setTheme(name),'Aa');b.dataset.theme=name.toLowerCase();b.setAttribute('aria-pressed',String(preset===name));themes.append(b);}host.append(themes);
      row('Customise',()=>go('Customise Theme'),'⚙');
      const modes=document.createElement('div');modes.className='rr-books-actions';
      for(const original of reader.querySelectorAll('.reader-modes button')){const b=button(original.textContent,()=>{original.click();setTimeout(render,100);});b.setAttribute('aria-pressed',original.getAttribute('aria-pressed')||String(original.classList.contains('active')));modes.append(b);}host.append(modes);
      const label=document.createElement('label');label.textContent='Font';const select=document.createElement('select');select.setAttribute('aria-label','Font');
      for(const name of ['Original','System','Serif','Palatino','Helvetica']){const o=document.createElement('option');o.textContent=name;select.append(o);}select.value=font;select.onchange=()=>{font=select.value;saveType();};label.append(select);host.append(label);
      const b=button('Bold Text',()=>{bold=!bold;preset='Custom';saveType();render();},bold?'✓':'');b.setAttribute('aria-pressed',String(bold));host.append(b);
    } else if(view === 'Customise Theme') {
      heading(view);
      const label=document.createElement('label');label.textContent='Font';const select=document.createElement('select');select.setAttribute('aria-label','Font');
      for(const name of ['Original','System','Serif','Palatino','Helvetica']){const o=document.createElement('option');o.textContent=name;select.append(o);}select.value=font;select.onchange=()=>{font=select.value;preset='Custom';saveType();};label.append(select);host.append(label);
      const boldButton=button('Bold Text',()=>{bold=!bold;preset='Custom';saveType();render();},bold?'✓':'');boldButton.setAttribute('aria-pressed',String(bold));host.append(boldButton);
      const percent=v=>Math.round(Number(v))+'%';
      range('Line spacing',null,{min:1.1,max:3,step:.05,value:line,format:v=>Number(v).toFixed(2),set:v=>{line=v;preset='Custom';}});
      range('Character spacing',null,{min:-1,max:6,step:.1,value:chars,format:v=>Number(v).toFixed(1)+' px',set:v=>{chars=v;preset='Custom';}});
      range('Word spacing',null,{min:-2,max:18,step:.5,value:words,format:v=>Number(v).toFixed(1)+' px',set:v=>{words=v;preset='Custom';}});
      range('Margins',null,{min:0,max:14,step:.5,value:margins,format:v=>percent(Number(v)/14*100),set:v=>{margins=v;preset='Custom';}});
      const justifyButton=button('Justify Text',()=>{justify=!justify;preset='Custom';saveType();render();},justify?'✓':'');justifyButton.setAttribute('aria-pressed',String(justify));host.append(justifyButton);
      row('Reset Theme',()=>{font='Original';bold=false;line=1.65;chars=0;words=0;margins=4;justify=false;preset='Original';setTheme('Original');},'↺');
    } else if(view === 'Read Aloud') {
      heading(view);const listen=$('.rr-listen');row(listen?.getAttribute('aria-pressed')==='true'?'Stop reading':'Start reading',()=>{listen?.click();setTimeout(render,100);},'▶');
      const original=$('.rr-voice');if(original){const label=document.createElement('label');label.textContent='Voice';const select=original.cloneNode(true);select.removeAttribute('class');select.value=original.value;select.selectedIndex=original.selectedIndex;select.onchange=()=>change(original,select.value);label.append(select);host.append(label);}
      const rate=$('.rr-rate');if(rate)row('Reading speed: '+rate.textContent,()=>{rate.click();setTimeout(render,100);});
    } else if(view === 'More') {
      heading(view);
      row('Share book',async()=>{const data={title:reader.getAttribute('aria-label')?.replace(/^Reading /,''),url:location.href};try{if(navigator.share)await navigator.share(data);else{await navigator.clipboard.writeText(data.url);go('Link copied');}}catch(_){}},'↑');
      const textMode=document.querySelector('.rr-text-mode');
      if(textMode)row(textMode.textContent,()=>{textMode.click();close();},'↖');
    } else { heading(view); }
  }
  function sync() {
    reader=document.querySelector('.reader-shell');root.classList.toggle('rr-books-controls',!!reader);
    if(!reader){if(host)host.hidden=true;if(dismissZone)dismissZone.hidden=true;lastOpen=false;return;}
    if(!host){host=document.createElement('section');host.className='rr-books-menu';host.setAttribute('role','dialog');document.body.append(host);}
    if(!dismissZone){dismissZone=button('Dismiss settings',close);dismissZone.className='rr-books-dismiss';document.body.append(dismissZone);}
    const isOpen=open();host.hidden=!isOpen;dismissZone.hidden=!isOpen;
    if(isOpen&&!lastOpen){view='menu';render();}lastOpen=isOpen;
    const pages=[...reader.querySelectorAll('.reader-modes button')].some(b=>b.textContent==='Pages'&&(b.classList.contains('active')||b.getAttribute('aria-pressed')==='true'));
    root.classList.toggle('rr-books-pages',pages);
    const key=reader.className+'|'+($('.reader-actions select:not(.rr-voice)')?.options.length||0)+'|'+!!$('.rr-listen')+'|'+contentsLabel();if(key!==signature){signature=key;if(isOpen)render();}
    applyType();
  }
  function start(){sync();setInterval(sync,600);window.addEventListener?.('rr-close-reading-menu',close);document.addEventListener('keydown',e=>{if(e.key==='Escape'&&open()){e.preventDefault();e.stopImmediatePropagation();view==='menu'?close():go('menu');}},true);}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();
