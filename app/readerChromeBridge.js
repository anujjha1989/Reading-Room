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
  if (typeof document === "undefined") return;

  var root = document.documentElement;
  var HIDE_KEY = "reading-room-hide-chrome";

  var hidden = false;
  try { hidden = localStorage.getItem(HIDE_KEY) === "1"; } catch (e) { /* private mode */ }

  function shell() { return document.querySelector(".reader-shell"); }
  function sheetOpen() { return root.classList.contains("rr-react-sheet-open"); }
  function closeSheet() {
    var settings = document.querySelector(".reader-settings");
    if (settings) settings.open = false;
    window.dispatchEvent(new Event("rr-close-reading-menu"));
    schedule();
  }

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

  // Remaining bridge buttons live on <body>, outside React's tree.
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
    tapLayer.style.display = !textMode && !sheetOpen()
      && !root.classList.contains("rr-react-sheet-open")
      && width > 0 && height > 0 ? "flex" : "none";
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
      root.classList.remove("rr-strip", "rr-hide-chrome", "rr-sheet-open", "rr-theme-dark");
      textMode = false;
      if (panelCloseButton) panelCloseButton.style.display = "none";
      if (fontCloseButton) fontCloseButton.style.display = "none";
      syncTapLayer();
      return;
    }
    ensureStandaloneMeta();
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

// Reading controls are owned by app/ReadingSheet.tsx. Keeping a second,
// body-injected implementation here made every control change require two
// edits and allowed the two paths to drift. The override now only supplies
// the iOS gesture/chrome bridge used by the React reader.


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
  if (typeof document === "undefined") return;


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
