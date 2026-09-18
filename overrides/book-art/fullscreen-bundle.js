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
  // Is there a link under this point, inside the book's iframe? The reading
  // content lives in an epub.js (or foliate) iframe beneath our tap overlay,
  // so the only way to know is to ask that document directly.
  //
  // Re-dispatching the click on the anchor is deliberate: both renderers
  // already intercept anchor clicks inside their own document and resolve the
  // href against the book's spine. Reimplementing that resolution here would
  // duplicate logic that works.
  function followLinkAt(x, y) {
    if (!x && !y) return false;                  // synthetic click, no position
    var frames = document.querySelectorAll("iframe");
    for (var i = 0; i < frames.length; i += 1) {
      var f = frames[i];
      var r = f.getBoundingClientRect();
      if (r.width < 40 || r.height < 40) continue;
      if (x < r.left || x > r.right || y < r.top || y > r.bottom) continue;
      var doc = null;
      try { doc = f.contentDocument; } catch (e) { continue; }   // not ours
      if (!doc) continue;
      var el = null;
      try { el = doc.elementFromPoint(x - r.left, y - r.top); } catch (e) { continue; }
      var a = el && el.closest ? el.closest("a[href]") : null;
      if (!a) continue;
      var href = a.getAttribute("href") || "";
      if (!href || href.charAt(0) === "#" && href.length === 1) continue;
      if (/^(https?:|mailto:|tel:)/i.test(href)) {
        try { window.open(a.href, "_blank", "noopener"); } catch (e) { /* blocked */ }
        debug("Link out: " + href);
        return true;
      }
      debug("Link: " + href);
      // epub.js wires internal anchors with `onclick = ... ; return false`.
      // Calling that directly is the cleanest path: it navigates the book and
      // cannot fall through to a browser navigation.
      if (typeof a.onclick === "function") {
        try { a.onclick.call(a); return true; } catch (e) { /* fall through */ }
      }
      // Otherwise dispatch a real click so the renderer's own delegated
      // handler sees it — behind a navigation guard. A capture-phase
      // preventDefault runs before any handler and does not stop propagation,
      // so the renderer still gets the event but the browser cannot follow the
      // href. Without this, an unwired anchor navigates the reader iframe to
      // the app itself and the library appears inside the book.
      var guard = function (ev) { ev.preventDefault(); };
      doc.addEventListener("click", guard, true);
      try { a.click(); } catch (e) { return false; }
      finally { doc.removeEventListener("click", guard, true); }
      return true;
    }
    return false;
  }

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
          // A link under the finger wins over turning the page or toggling
          // the chrome — checked before the repeat-tap guard so a link never
          // gets swallowed by it either.
          if (followLinkAt(event.clientX, event.clientY)) {
            lastActed = Date.now();
            return;
          }
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
    // Every library chrome element keys off this. rr-strip is not enough: it is
    // only set for text-mode reading, so a PDF or comic left the header and the
    // icon rail painted over the open book.
    document.documentElement.classList.toggle('rr-book-open', reading);
    document.documentElement.classList.toggle('rr-library-visible',!reading);
    document.documentElement.dataset.rrLibraryView = selected.toLowerCase();
    var heading = document.querySelector('.hero h1');
    var title = selected === 'Home' ? 'Home' : selected === 'Search' ? 'Search' : selected === 'Favorites' ? 'Favorites' : 'Library';
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
    // (the settings gear now has its own bootstrap; see rr-gear-boot below)
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
    // Prefix match, not equality: some native controls interpolate state into
    // their label - the text-size buttons render "Decrease text size (100%)" -
    // so an exact comparison silently found nothing and the proxied tap did
    // nothing at all. Falls back to a contains match for safety.
    if (!reader) return undefined;
    const buttons = [...reader.querySelectorAll('button')];
    const get = (b) => b.getAttribute('aria-label') || '';
    return buttons.find(b => get(b) === label)
      || buttons.find(b => get(b).startsWith(label))
      || buttons.find(b => get(b).indexOf(label) !== -1);
  }
  // Real icons rather than ASCII stand-ins: ▶ ⌕ aA ▯ ••• read as placeholders
  // at this size, and the sheet is meant to be scanned by shape.
  const ICON = {
    play:'<path d="M7 4.5v15l12-7.5Z" fill="currentColor" stroke="none"/>',
    stop:'<rect x="6.5" y="6.5" width="11" height="11" rx="2" fill="currentColor" stroke="none"/>',
    search:'<circle cx="11" cy="11" r="6"/><path d="M15.5 15.5 20 20"/>',
    text:'<path d="M4 6h16M4 12h10M4 18h13"/>',
    bookmark:'<path d="M7 4h10v16l-5-4-5 4Z"/>',
    more:'<circle cx="5" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.5" fill="currentColor" stroke="none"/>',
    contents:'<path d="M4 6h2M9 6h11M4 12h2M9 12h11M4 18h2M9 18h11"/>',
    gear:'<circle cx="12" cy="12" r="3"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4"/>',
    back:'<path d="M14 6l-6 6 6 6"/>',
  };
  function glyph(name) {
    if (!ICON[name]) return null;
    const span = document.createElement('span');
    span.setAttribute('aria-hidden', 'true');
    span.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"'
      + ' stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"'
      + ' style="width:1em;height:1em;display:block">' + ICON[name] + '</svg>';
    return span;
  }

  function button(label, action, icon) {
    const b = document.createElement('button'); b.type = 'button';
    b.setAttribute('aria-label', label);
    const text = document.createElement('span'); text.textContent = label; b.append(text);
    if (icon) {
      const named = glyph(icon);
      if (named) b.append(named);
      else { const i = document.createElement('span'); i.textContent = icon; i.setAttribute('aria-hidden','true'); b.append(i); }
    }
    b.onclick = e => { e.stopPropagation(); action(); }; return b;
  }
  function go(name) { view = name; signature = ''; render(); }
  function proxy(label) { const b = native(label); if (b) b.click(); }
  function heading(label) {
    const h = document.createElement('header'); const strong = document.createElement('strong'); strong.textContent = label;
    h.append(strong, button('Back to reading menu', () => go('menu'), 'back'));
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
  // The preset carries a book theme - Original and Paper are light, Quiet is
  // dark - and it is saved on first use, so a stored 'Original' pinned every
  // book to light however the app was themed. Until a theme is deliberately
  // chosen, start from a preset that matches the app: Quiet for dark, Original
  // for light. Typography from the stored preset is kept either way.
  try {
    if (localStorage.getItem('reading-room-reader-theme-set') !== '1') {
      const appTheme = localStorage.getItem('reading-room-theme');
      const wantDark = appTheme === 'dark'
        || (appTheme !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
      if (wantDark && (preset === 'Original' || preset === 'Paper' || preset === 'Focus' || preset === 'Bold')) preset = 'Quiet';
      else if (!wantDark && preset === 'Quiet') preset = 'Original';
    }
  } catch (_) {}
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
    // Picking a preset is a deliberate theme choice, so record the flag the
    // reader checks - otherwise the next book would go back to following the
    // app theme and silently undo this.
    try { localStorage.setItem('reading-room-reader-theme-set','1'); } catch (_) {}
    const nativeTheme=[...reader.querySelectorAll('.theme-options button')].find(b=>b.textContent.toLowerCase()===p[6]);nativeTheme?.click();saveType();render();
  }
  function render() {
    if (!host || !reader) return;
    host.replaceChildren(); host.dataset.view = view;
    host.setAttribute('aria-label', view === 'menu' ? 'Reading menu' : view);
    if (view === 'menu') {
      row(contentsLabel(),()=>go('Contents'),'contents');
      host.lastElementChild.title=$('[data-rr-progress]')?.dataset.rrProgressEstimated==='true'?'Estimated whole-book progress':'Whole-book progress';
      if(native('Search inside book'))row('Search Book',()=>{close();proxy('Search inside book');},'search');
      if($('.reader-settings'))row('Themes & Settings',()=>go('Themes & Settings'),'text');
      const textMode=document.querySelector('.rr-text-mode');
      const actions=document.createElement('div'); actions.className='rr-books-actions';
      if($('.rr-listen'))actions.append(button('Read Aloud',()=>go('Read Aloud'),'play'));
      actions.append(button('Bookmarks',()=>{close(); const b=[...reader.querySelectorAll('button')].find(b=>(b.getAttribute('aria-label')||'').startsWith('Bookmarks'));b?.click();},'bookmark'));
      actions.append(button('More',()=>go('More'),'more'));
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
      row('Customise',()=>go('Customise Theme'),'gear');
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
      heading(view);const listen=$('.rr-listen');row(listen?.getAttribute('aria-pressed')==='true'?'Stop reading':'Start reading',()=>{listen?.click();setTimeout(render,100);},listen?.getAttribute('aria-pressed')==='true'?'stop':'play');
      // Voice: an icon instead of the word, to match the rest of the sheet.
      const original=$('.rr-voice');
      if(original){
        const label=document.createElement('label');
        label.className='rr-voice-row';
        const icon=document.createElement('span');
        icon.className='rr-voice-icon';icon.setAttribute('aria-hidden','true');
        icon.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v18M8 7v10M16 7v10M4 10v4M20 10v4"/></svg>';
        const select=original.cloneNode(true);
        select.removeAttribute('class');
        select.setAttribute('aria-label','Reading voice');
        select.value=original.value;select.selectedIndex=original.selectedIndex;
        select.onchange=()=>change(original,select.value);
        label.append(icon,select);host.append(label);
      }
      // Speed: a real slider. The old row cycled through fixed steps on tap,
      // which read as a button that did nothing when the rate was not actually
      // being applied to the audio element.
      if($('.rr-rate') && typeof window.rrSetReadingRate === 'function'){
        const wrap=document.createElement('label');
        wrap.className='rr-rate-row';
        const out=document.createElement('span');
        out.className='rr-rate-value';
        const slider=document.createElement('input');
        slider.type='range';slider.min='0.5';slider.max='2';slider.step='0.1';
        slider.setAttribute('aria-label','Reading speed');
        const current=typeof window.rrGetReadingRate==='function'?window.rrGetReadingRate():1;
        slider.value=String(current);
        out.textContent=Number(current).toFixed(1)+'×';
        slider.oninput=()=>{out.textContent=Number(slider.value).toFixed(1)+'×';};
        slider.onchange=()=>window.rrSetReadingRate(slider.value);
        wrap.append(slider,out);host.append(wrap);
      }
    } else if(view === 'More') {
      heading(view);
      row('Share book',async()=>{const data={title:reader.getAttribute('aria-label')?.replace(/^Reading /,''),url:location.href};try{if(navigator.share)await navigator.share(data);else{await navigator.clipboard.writeText(data.url);go('Link copied');}}catch(_){}},'↑');
      const textMode=document.querySelector('.rr-text-mode');
      if(textMode)row(textMode.textContent,()=>{textMode.click();close();},'↖');
    } else { heading(view); }
  }
  function sync() {
    reader=document.querySelector('.reader-shell');root.classList.toggle('rr-books-controls',!!reader);
    if(!reader){if(host)host.hidden=true;if(dismissZone)dismissZone.hidden=true;lastOpen=false;themeSynced=false;return;}
    syncPresetTheme();
    if(!host){host=document.createElement('section');host.className='rr-books-menu';host.setAttribute('role','dialog');document.body.append(host);}
    if(!dismissZone){dismissZone=button('Dismiss settings',close);dismissZone.className='rr-books-dismiss';document.body.append(dismissZone);}
    const isOpen=open();host.hidden=!isOpen;dismissZone.hidden=!isOpen;
    if(isOpen&&!lastOpen){view='menu';render();}lastOpen=isOpen;
    const pages=[...reader.querySelectorAll('.reader-modes button')].some(b=>b.textContent==='Pages'&&(b.classList.contains('active')||b.getAttribute('aria-pressed')==='true'));
    root.classList.toggle('rr-books-pages',pages);
    const key=reader.className+'|'+($('.reader-actions select:not(.rr-voice)')?.options.length||0)+'|'+!!$('.rr-listen')+'|'+contentsLabel();if(key!==signature){signature=key;if(isOpen)render();}
    applyType();
  }
  // Apply the theme the preset implies once the reader exists. Choosing a
  // preset clicks the native theme button, but a preset restored from storage
  // never did - so the reader kept whatever theme it defaulted to.
  let themeSynced = false;
  function syncPresetTheme() {
    if (themeSynced || !reader) return;
    try {
      if (localStorage.getItem('reading-room-reader-theme-set') === '1') { themeSynced = true; return; }
      // Derive the wanted theme from the app, not from `preset`. preset is a
      // module-load snapshot and also encodes typography, so a stored
      // 'Original' meant light forever. With no deliberate choice recorded the
      // app theme is the only correct source.
      const appTheme = localStorage.getItem('reading-room-theme');
      const wantDark = appTheme === 'dark'
        || (appTheme !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
      const want = wantDark ? 'dark' : 'light';
      const buttons = [...reader.querySelectorAll('.theme-options button')];
      if (!buttons.length) return;                   // reader not ready yet
      const target = buttons.find(b => b.textContent.toLowerCase() === want);
      if (target && !target.classList.contains('active')) target.click();
      themeSynced = true;
    } catch (_) { themeSynced = true; }
  }

  function start(){sync();setInterval(sync,600);window.addEventListener?.('rr-close-reading-menu',close);document.addEventListener('keydown',e=>{if(e.key==='Escape'&&open()){e.preventDefault();e.stopImmediatePropagation();view==='menu'?close():go('menu');}},true);}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();


// --- settings gear (rr-gear-boot) -----------------------------------------
// Deliberately standalone: it does not wait for the library to signal ready,
// does not live inside a React-managed container, and does not depend on any
// view being active. A single button should not have five ways to disappear.
(function () {
  "use strict";
  var ID = "rr-settings-link";
  var GEAR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"'
    + ' stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"'
    + ' aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7'
    + ' 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7'
    + ' 1.7 0 0 0-1.03 1.56V21h-4v-.08A1.7 1.7 0 0 0 8.96 19.4a1.7 1.7 0 0'
    + ' 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15 1.7 1.7 0 0 0'
    + ' 3.08 14H3v-4h.08A1.7 1.7 0 0 0 4.6 8.96a1.7 1.7 0 0 0-.34-1.88l-.06-.06'
    + ' 2.83-2.83.06.06A1.7 1.7 0 0 0 8.96 4.6 1.7 1.7 0 0 0 10 3.08V3h4v.08a1.7'
    + ' 1.7 0 0 0 1.03 1.53 1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7'
    + ' 1.7 0 0 0 19.4 8.96 1.7 1.7 0 0 0 20.92 10H21v4h-.08A1.7 1.7 0 0 0 19.4 15Z"/></svg>';

  // Settings opens over the library rather than navigating to it. Coming back
  // from a separate page is a cold start — the catalogue is re-downloaded and
  // 9,689 books re-hydrated, which is the blank screen and the five seconds.
  // An overlay leaves the library mounted, so closing is instant.
  function closeOverlay() {
    var f = document.getElementById("rr-settings-overlay");
    if (f) f.remove();
    document.documentElement.classList.remove("rr-settings-open");
  }

  function openOverlay() {
    if (document.getElementById("rr-settings-overlay")) return;
    var f = document.createElement("iframe");
    f.id = "rr-settings-overlay";
    f.src = SETTINGS_URL + (SETTINGS_URL.indexOf("?") === -1 ? "?" : "&") + "embedded=1";
    f.setAttribute("title", "Library settings");
    f.addEventListener("load", function () {
      // settings.html closes itself by going to "/". Intercept that and just
      // drop the overlay: the library underneath never went away.
      try {
        var p = f.contentWindow.location.pathname;
        if (p === "/" || p === "/index.html") { closeOverlay(); return; }
        // Push the app's current theme into the overlay. Both read the same
        // localStorage key at boot, but the overlay is a separate document that
        // boots once and is then cached - so after a theme change the library
        // and the settings page could disagree until a full reload. The parent
        // is authoritative here.
        var d = f.contentDocument;
        if (d && d.documentElement) {
          var t = document.documentElement.dataset.rrTheme;
          if (t) d.documentElement.dataset.rrTheme = t;
          else delete d.documentElement.dataset.rrTheme;
        }
      } catch (e) { /* cross-origin or settings page not available */ }
    });
    document.documentElement.classList.add("rr-settings-open");
    document.body.appendChild(f);
  }

  // This file is served as fullscreen-bundle-vNN.js, so its own URL carries the
  // deploy version. settings.html is a fixed URL with no hash and no query, so
  // iOS serves it from HTTP cache indefinitely: a deploy changed the file on the
  // Pi and the phone kept showing the previous one. Version the request the same
  // way index.html versions this script.
  var RR_V = (function () {
    try {
      // The stylesheet link is the reliable source: this script is deferred, so
      // document.currentScript is null by the time it runs.
      var link = document.querySelector('link[href*="fullscreen-bundle-v"]');
      var m = link && /fullscreen-bundle-v(\d+)\./.exec(link.getAttribute("href") || "");
      if (m) return m[1];
      var tag = document.querySelector('script[src*="fullscreen-bundle-v"]');
      m = tag && /fullscreen-bundle-v(\d+)\.js/.exec(tag.getAttribute("src") || "");
      if (m) return m[1];
    } catch (e) {}
    return "";
  })();
  var SETTINGS_URL = "/settings.html" + (RR_V ? "?v=" + RR_V : "");

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closeOverlay();
  });

  // The settings overlay talks to us instead of reaching into our DOM, which is
  // what the injected Refresh Library button used to do.
  window.addEventListener("message", function (e) {
    if (e.origin !== location.origin || !e.data) return;
    if (e.data.type === "rr-refresh-library") { closeOverlay(); location.reload(); return; }
    if (e.data.type === "rr-theme") {
      // Apply the theme to the library immediately. Both the overlay and this
      // page key off data-rr-theme on <html>, so setting it here is enough.
      if (e.data.value === "system") delete document.documentElement.dataset.rrTheme;
      else document.documentElement.dataset.rrTheme = e.data.value;
    }
  });

  function add() {
    if (!document.body || document.getElementById(ID)) return;
    var a = document.createElement("a");
    a.id = ID;
    a.href = SETTINGS_URL;
    a.setAttribute("aria-label", "Library settings");
    a.innerHTML = GEAR;
    a.addEventListener("click", function (e) {
      // Plain click opens the overlay; cmd/ctrl-click still opens a real tab.
      if (e.metaKey || e.ctrlKey || e.shiftKey) return;
      e.preventDefault();
      openOverlay();
    });
    document.body.appendChild(a);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", add);
  } else {
    add();
  }
  // React replaces large parts of the tree as views change; re-add cheaply if
  // the button is ever swept away. Timed retries rather than an observer: this
  // is one element check, and the scroll work is already sensitive enough.
  [0, 200, 800, 2000, 5000].forEach(function (t) { setTimeout(add, t); });
  setInterval(add, 4000);
})();
// --- rr-meta-fix: long-press a book to correct its title or author ----------
//
// Corrections used to mean asking someone to edit the catalogue by hand, which
// a rescan would then throw away. The server keeps them as overrides outside
// catalog.json and re-applies them on every load, so a fix made here survives
// the weekly scan. This is just the way in.
//
// Deliberately independent of the React app: it reads the book id out of the
// cover image URL already present in the card, so it needs no hook into the
// app's own state and cannot be swept away when a view re-renders.
(function () {
  "use strict";


  function bookFromNode(node) {
    var card = node && node.closest ? node.closest("li, article, a, div") : null;
    for (var hops = 0; card && hops < 6; hops++) {
      var img = card.querySelector && card.querySelector('img[src*="/api/cover"]');
      if (img) {
        var m = /[?&]id=([^&]+)/.exec(img.getAttribute("src") || "");
        if (m) return { id: decodeURIComponent(m[1]), card: card, img: img };
      }
      card = card.parentElement;
    }
    return null;
  }

  // The card shows the title and author already; read them back rather than
  // refetching the catalogue just to prefill two boxes.
  function guessFields(card) {
    var text = [];
    card.querySelectorAll("*").forEach(function (el) {
      if (el.children.length === 0) {
        var t = (el.textContent || "").trim();
        if (t && t.length < 220 && !/^(EPUB|MOBI|PDF|CBR|CBZ|AZW3?|TXT|DOC|DOCX|RTF)$/i.test(t)) text.push(t);
      }
    });
    return { title: text[0] || "", author: text[1] || "" };
  }

  var overlay = null;

  // Patches every book card in the current DOM that matches id, and stores the
  // correction in localStorage so it is reapplied on the next page load before
  // the server-side catalogue data arrives (helps with #8: changes not sticking).
  function applyCorrection(id, title, author) {
    try {
      var stored = JSON.parse(localStorage.getItem("rr-meta-corrections") || "{}");
      stored[id] = { title: title, author: author };
      localStorage.setItem("rr-meta-corrections", JSON.stringify(stored));
    } catch (e) {}
    document.querySelectorAll('img[src*="/api/cover"]').forEach(function (img) {
      var src = img.getAttribute("src") || "";
      var m = /[?&]id=([^&]+)/.exec(src);
      if (!m || decodeURIComponent(m[1]) !== id) return;
      var card = img.parentElement;
      for (var hops = 0; card && hops < 8; hops++) {
        var leaves = [];
        card.querySelectorAll("*").forEach(function (el) {
          if (el.children.length === 0) {
            var t = (el.textContent || "").trim();
            if (t && t.length < 220 && !/^(EPUB|MOBI|PDF|CBR|CBZ|AZW3?|TXT|DOC|DOCX|RTF)$/i.test(t)) leaves.push(el);
          }
        });
        if (leaves.length >= 2) {
          if (title) leaves[0].textContent = title;
          if (author) leaves[1].textContent = author;
          break;
        }
        card = card.parentElement;
      }
    });
  }

  // Reapply any corrections stored from a previous session. Four attempts at
  // increasing delays handle both fast and slow React hydration on the Pi.
  (function reapplyStoredCorrections() {
    var stored;
    try { stored = JSON.parse(localStorage.getItem("rr-meta-corrections") || "{}"); } catch (e) { stored = {}; }
    var ids = Object.keys(stored);
    if (!ids.length) return;
    function run() {
      ids.forEach(function (id) { var c = stored[id]; applyCorrection(id, c.title, c.author); });
    }
    [100, 600, 1800, 5000].forEach(function (t) { setTimeout(run, t); });
  })();

  function close() {
    if (overlay) { overlay.remove(); overlay = null; }
    document.documentElement.classList.remove("rr-metafix-open");
  }

  function open(book) {
    if (overlay) return;
    var guess = guessFields(book.card);

    overlay = document.createElement("div");
    overlay.id = "rr-metafix";
    overlay.innerHTML =
      '<div class="rr-mf-sheet" role="dialog" aria-label="Edit book details">' +
      '<h2>Edit details</h2>' +
      '<label>Title<input id="rr-mf-title" type="text" autocomplete="off"></label>' +
      '<label>Author<input id="rr-mf-author" type="text" autocomplete="off"></label>' +
      '<p class="rr-mf-note">Saved as a correction, so a rescan will not undo it. ' +
      'Clear a box to go back to the scanned value.</p>' +
      '<div class="rr-mf-row">' +
      '<button type="button" class="rr-mf-cancel">Cancel</button>' +
      '<button type="button" class="rr-mf-quarantine">Delete</button>' +
      '<button type="button" class="rr-mf-save">Save</button>' +
      '</div><p class="rr-mf-status" role="status"></p></div>';

    document.body.appendChild(overlay);
    document.documentElement.classList.add("rr-metafix-open");

    var titleEl = overlay.querySelector("#rr-mf-title");
    var authorEl = overlay.querySelector("#rr-mf-author");
    var status = overlay.querySelector(".rr-mf-status");
    titleEl.value = guess.title;
    authorEl.value = guess.author;
    setTimeout(function () { titleEl.focus(); }, 40);

    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) close();
    });
    overlay.querySelector(".rr-mf-cancel").addEventListener("click", close);

    overlay.querySelector(".rr-mf-quarantine").addEventListener("click", function () {
      // Labelled Delete, still a quarantine move: the file is set aside rather
      // than destroyed, which is the behaviour we want to keep.
      if (!confirm('Delete "' + (titleEl.value || book.id) + '" from the library?')) return;
      status.textContent = "Deleting…";
      fetch("/api/quarantine", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: book.id }),
      }).then(function (r) {
        if (!r.ok) throw new Error("quarantine failed (" + r.status + ")");
        return r.json();
      }).then(function () {
        status.textContent = "Deleted.";
        // Grey out the card so it is visually clear even before a reload.
        if (book.card) book.card.style.opacity = "0.3";
        setTimeout(close, 1200);
      }).catch(function (err) {
        status.textContent = err.message || "Could not delete";
      });
    });

    overlay.querySelector(".rr-mf-save").addEventListener("click", function () {
      status.textContent = "Saving…";
      fetch("/api/meta-fix", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: book.id, title: titleEl.value, author: authorEl.value }),
      }).then(function (r) {
        if (!r.ok) throw new Error("save failed (" + r.status + ")");
        return r.json();
      }).then(function () {
        status.textContent = "Saved.";
        applyCorrection(book.id, titleEl.value, authorEl.value);
        setTimeout(close, 900);
      }).catch(function (err) {
        status.textContent = err.message || "Could not save";
      });
    });
  }

  // Opened from the card's ⋯ menu, which replaced long-press: two hidden routes
  // to the same sheet was worse than one visible one. The React side sends the
  // book id; find its card so guessFields can still prefill from the DOM.
  window.addEventListener("rr-edit-book", function (e) {
    if (overlay || !e.detail || !e.detail.id) return;
    var id = e.detail.id;
    var img = document.querySelector('img[src*="id=' + id + '"]');
    var card = img && img.closest ? img.closest("article, .rr-shelf-cell, li, div") : null;
    if (!card) return;
    open({ id: id, card: card, img: img });
    if (e.detail.focus === "delete") {
      var btn = overlay && overlay.querySelector(".rr-mf-quarantine");
      if (btn) setTimeout(function () { btn.focus(); }, 60);
    }
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") close();
  });
})();

// --- rr-library-chrome: Books-style filter + sort rail ----------------------
//
// The library header stacked title, search, category chips and a toolbar
// (Filters, sort select, title count, Thumbnails/List) above the first cover.
// Books shows two icons beside the title instead. This drives React's own
// controls rather than reimplementing them: the sort <select> and the display
// buttons stay the source of truth, so nothing here has to know how sorting or
// grid rendering works. CSS hides the originals; these are remote controls.
(function () {
  "use strict";
  var FILTER_ID = "rr-filter-btn", SORT_ID = "rr-sort-btn";
  var MENU_ID = "rr-sort-menu", SCRIM_ID = "rr-popover-scrim";
  var root = document.documentElement;

  var svg = function (paths) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"'
      + ' stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths + '</svg>';
  };
  // Three stacked rules, shortening downward - the Books filter/sort glyph.
  var FILTER_ICON = svg('<path d="M4 7h16M6.5 12h11M10 17h4"/>');
  var SORT_ICON = svg('<circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none"/>'
    + '<circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/>'
    + '<circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none"/>');
  var TICK = '<svg class="rr-tick" viewBox="0 0 24 24" fill="none" stroke="currentColor"'
    + ' stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
    + '<path d="M4 12.5l5 5L20 6.5"/></svg>';

  var q = function (sel) { return document.querySelector(sel); };
  var sortSelect = function () { return q(".catalog .sort-control select"); };
  var displayButtons = function () {
    return Array.prototype.slice.call(document.querySelectorAll(".catalog .display-switch button"));
  };

  function closeAll() {
    root.classList.remove("rr-filters-open", "rr-sort-open");
    // Put React's panel back to closed too, or its own Filters button falls out
    // of step with ours and the next tap does nothing.
    var panel = q(".catalog .filters");
    if (panel && panel.classList.contains("open")) {
      var toggle = q(".catalog .mobile-filter-toggle");
      if (toggle) toggle.click();
      else panel.classList.remove("open");
    }
    var t = q("#" + FILTER_ID), s = q("#" + SORT_ID);
    if (t) t.setAttribute("aria-expanded", "false");
    if (s) s.setAttribute("aria-expanded", "false");
  }

  function toggleFilters() {
    var opening = !root.classList.contains("rr-filters-open");
    closeAll();
    if (!opening) return;
    // globals.css hides the panel with `.expanded-filters { display:none }` and
    // reveals it with `.expanded-filters.open`. Positioning it was not enough:
    // display:none wins over any amount of position and opacity. React toggles
    // `open` from its own Filters button, so click that rather than adding the
    // class directly, which React would revert on its next render.
    var panel = q(".catalog .filters");
    if (panel && !panel.classList.contains("open")) {
      var toggle = q(".catalog .mobile-filter-toggle");
      if (toggle) toggle.click();
      else panel.classList.add("open");
    }
    root.classList.add("rr-filters-open");
    var btn = q("#" + FILTER_ID);
    if (btn) btn.setAttribute("aria-expanded", "true");
  }

  function buildMenu() {
    var menu = q("#" + MENU_ID);
    if (!menu) {
      menu = document.createElement("div");
      menu.id = MENU_ID;
      menu.setAttribute("role", "menu");
      document.body.appendChild(menu);
    }
    var sel = sortSelect();
    var display = displayButtons();
    if (!sel) return menu;

    var html = "";
    if (display.length) {
      display.forEach(function (b, i) {
        var on = b.classList.contains("active") || b.getAttribute("aria-pressed") === "true";
        html += '<button type="button" role="menuitemradio" data-rr-display="' + i + '"'
          + ' aria-checked="' + (on ? "true" : "false") + '">' + TICK
          + "<span>" + (b.textContent || "").trim() + "</span></button>";
      });
      html += "<hr>";
    }
    html += '<div class="rr-menu-label">Sort by</div>';
    Array.prototype.forEach.call(sel.options, function (opt) {
      html += '<button type="button" role="menuitemradio" data-rr-sort="' + opt.value + '"'
        + ' aria-checked="' + (opt.selected ? "true" : "false") + '">' + TICK
        + "<span>" + opt.textContent + "</span></button>";
    });
    menu.innerHTML = html;
    return menu;
  }

  function toggleSort() {
    var opening = !root.classList.contains("rr-sort-open");
    closeAll();
    if (!opening) return;
    buildMenu();
    root.classList.add("rr-sort-open");
    var btn = q("#" + SORT_ID);
    if (btn) btn.setAttribute("aria-expanded", "true");
  }

  // Delegated: the menu is rebuilt on every open, so per-item listeners would
  // have to be re-attached each time.
  document.addEventListener("click", function (e) {
    var item = e.target.closest && e.target.closest("#" + MENU_ID + " button");
    if (!item) return;
    var sortValue = item.getAttribute("data-rr-sort");
    if (sortValue !== null) {
      var sel = sortSelect();
      if (sel) {
        sel.value = sortValue;
        // React listens for change, not input, and needs it to bubble.
        sel.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }
    var displayIndex = item.getAttribute("data-rr-display");
    if (displayIndex !== null) {
      var b = displayButtons()[Number(displayIndex)];
      if (b) b.click();
    }
    closeAll();
  });

  function add() {
    if (!document.body) return;
    if (!q("#" + SCRIM_ID)) {
      var scrim = document.createElement("div");
      scrim.id = SCRIM_ID;
      scrim.addEventListener("click", closeAll);
      document.body.appendChild(scrim);
    }
    if (!q("#" + FILTER_ID)) {
      var f = document.createElement("button");
      f.id = FILTER_ID;
      f.type = "button";
      f.setAttribute("aria-label", "Filter library");
      f.setAttribute("aria-expanded", "false");
      f.innerHTML = FILTER_ICON;
      f.addEventListener("click", function (e) { e.preventDefault(); toggleFilters(); });
      document.body.appendChild(f);
    }
    if (!q("#" + SORT_ID)) {
      var s = document.createElement("button");
      s.id = SORT_ID;
      s.type = "button";
      s.setAttribute("aria-label", "Sort and view options");
      s.setAttribute("aria-expanded", "false");
      s.innerHTML = SORT_ICON;
      s.addEventListener("click", function (e) { e.preventDefault(); toggleSort(); });
      document.body.appendChild(s);
    }
  }

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && (root.classList.contains("rr-filters-open")
      || root.classList.contains("rr-sort-open"))) {
      e.preventDefault();
      e.stopImmediatePropagation();
      closeAll();
    }
  }, true);

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", add);
  else add();
  // Same reasoning as the gear: React sweeps parts of the tree, so re-add
  // cheaply rather than watching with an observer.
  [0, 200, 800, 2000, 5000].forEach(function (t) { setTimeout(add, t); });
  setInterval(add, 4000);
})();
