import { notifyReadAloudChange, registerReadAloudEngine } from "./readAloudController";

// The Reading Room — read aloud.
//
// Works on both reading engines the app uses: epub.js (EPUB) and foliate
// (MOBI/AZW/AZW3/KF8). Rather than borrowing either library's own text
// iterator, this walks the rendered document itself, which is the only way to
// guarantee it reads the prose and nothing else — no running heads, footers,
// nav lists, page-number markers or footnotes.
//
// Highlighting is drawn in a pointer-transparent overlay. Rectangles on the
// same visual line are merged, so word boundaries do not leave vertical gaps,
// and the book's text/layout remains untouched.
(function () {
  "use strict";

  var RATES = [0.8, 1, 1.2, 1.5, 2];
  var RATE_KEY = "reading-room-tts-rate";
  var MAX_TURNS = 40;              // safety bound when chasing a sentence across pages
  var TURN_SETTLE = 70;            // poll interval while a page turn lands
  var TURN_TIMEOUT = 850;
  var PAGE_TURN_SETTLE = 520;      // one animated turn must finish before another can begin
  var STALL_TIMEOUT = 9000;
  var MAX_CHARS = 220;             // short enough for reliable iOS Web Speech callbacks
  var STARTUP_CHARS = 80;          // quick first sound while the longer queue warms behind it

  // Anything matching these is furniture, not the novel. Checked in JS rather
  // than with a CSS selector because epub.js parses the document as HTML (where
  // the attribute is literally "epub:type") while foliate parses it as XML
  // (where it is namespaced) — a selector only ever catches one of the two.
  var OPS_NS = "http://www.idpf.org/2007/ops";
  var FURNITURE_TAGS = /^(header|footer|nav|script|style|noscript|svg|figcaption)$/;
  var FURNITURE_TYPES = /\b(pagebreak|page-list|pagelist|footnote|footnotes|endnote|endnotes|noteref|toc|landmarks|titlepage|colophon)\b/i;

  function isFurniture(el) {
    for (var n = el; n && n.nodeType === 1; n = n.parentElement) {
      var tag = (n.localName || "").toLowerCase();
      if (FURNITURE_TAGS.test(tag)) return true;
      if (n.hasAttribute && (n.hasAttribute("hidden") || n.getAttribute("aria-hidden") === "true")) return true;
      var type = "";
      try { type = n.getAttributeNS(OPS_NS, "type") || ""; } catch (e) { /* HTML doc */ }
      if (!type && n.getAttribute) type = n.getAttribute("epub:type") || n.getAttribute("data-epub-type") || "";
      var role = (n.getAttribute && n.getAttribute("role")) || "";
      if (FURNITURE_TYPES.test(type) || FURNITURE_TYPES.test(role.replace(/^doc-/, ""))) return true;
    }
    return false;
  }

  var rate = 1;
  try {
    var savedRate = parseFloat(localStorage.getItem(RATE_KEY));
    if (RATES.indexOf(savedRate) !== -1) rate = savedRate;
  } catch (e) { /* private mode */ }

  var playing = false;
  var paused = false;          // our own flag: speechSynthesis.pause() is unreliable, especially in Safari
  var epoch = 0;                   // invalidates callbacks from cancelled utterances
  var queue = [];                  // [{ text, range }] for the current document
  var cursor = 0;
  var queueDoc = null;
  var keepAlive = null;
  var sweeper = null;
  var mountedShell = null;
  var piperVoices = [];
  var sleepMs = 0;    // remaining ms; 0 = no timer
  var sleepRef = null;
  var manualScrollUntil = 0;

  function markManualScroll() {
    if (playing && readingMode() === "scroll") manualScrollUntil = Date.now() + 5000;
  }

  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

  function readingMode() {
    var buttons = document.querySelectorAll(".reader-modes button");
    for (var i = 0; i < buttons.length; i += 1) {
      if (buttons[i].getAttribute("aria-pressed") === "true") {
        return /scroll/i.test(buttons[i].textContent || "") ? "scroll" : "pages";
      }
    }
    return "pages";
  }

  function isAppleMobile() {
    var ua = (navigator && navigator.userAgent) || "";
    return /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
  }

  function isControlTap(now) {
    var at = Number(window.__rrControlTapAt || 0);
    return at > 0 && now - at >= 0 && now - at < 800;
  }

  function ignoreSteeringClick(active, now) {
    // On iOS, the compatibility click generated after a reading-control tap
    // is indistinguishable from a deliberate sentence click. While speech is
    // active, controls take priority; sentence seeking remains available once
    // playback is stopped.
    return isControlTap(now) || (active && isAppleMobile());
  }


  // foliate's scroller lives inside the paginator's shadow root as #container,
  // and the element exposes no public "nudge the scroll position" method. This
  // reaches it directly, which is a deliberate coupling to foliate's internals:
  // it is the fallback path when scrollToAnchor silently does nothing, and it
  // degrades to no movement rather than an exception if the internals change.
  function scrollContainerBy(renderer, delta) {
    if (!renderer || !delta) return;
    var box = null;
    try { box = renderer.shadowRoot && renderer.shadowRoot.getElementById("container"); } catch (e) { box = null; }
    if (box && box.scrollHeight > box.clientHeight + 4) {
      try { box.scrollTop += delta; return; } catch (e) { /* try the window next */ }
    }
    // Scrolled mode can also let the host page scroll instead.
    try { window.scrollBy({ top: delta, behavior: "auto" }); } catch (e) {}
  }

  // --- which engine is on screen -------------------------------------------
  function reader() {
    var v = document.querySelector("foliate-view");
    if (v && v.renderer && typeof v.renderer.getContents === "function") {
      var c = v.renderer.getContents()[0];
      if (c && c.doc && c.doc.body) {
        return {
          doc: c.doc,
          mode: readingMode(),
          // foliate's iframe *is* the visible page in both flows, so its own
          // viewport is the right frame of reference.
          visible: function (range) { return visibleInDoc(c.doc, range); },
          turn: function () { return v.next(); },
          reveal: function (range) {
            // foliate owns its scroller, so asking it to bring the range into
            // view is the right first move - but scrollToAnchor cannot be
            // trusted on its own here, for three reasons found by reading
            // paginator.js:
            //
            //   1. It is `async`. The old `try { ... } catch (e) {}` around it
            //      was synchronous, so a rejected promise escaped entirely and
            //      surfaced as an unhandled rejection, not as a caught error.
            //   2. `#scrollToAnchor` returns silently when the range yields no
            //      rect with width and height - which is exactly the case for a
            //      sentence sitting in a not-yet-laid-out part of a tall
            //      scrolled iframe.
            //   3. `#scrollTo` early-returns when `containerPosition` already
            //      equals the computed offset, so a stale anchor can make the
            //      call a no-op even when the sentence is far off screen.
            //
            // So: attempt it, catch async failure properly, then measure whether
            // the sentence actually ended up under the header and fall back to
            // scrolling the container directly if it did not.
            var renderer = v.renderer;
            try {
              var p = renderer.scrollToAnchor(range, false);
              if (p && typeof p.catch === "function") p.catch(function () {});
            } catch (e) { /* fall through to the measured fallback */ }

            requestAnimationFrame(function () {
              var rect;
              try { rect = range.getBoundingClientRect(); } catch (e) { return; }
              if (!rect || (!rect.height && !rect.width)) return;
              var wanted = headerBottom() + 20;
              // Already within a sensible band: leave it alone rather than
              // fighting foliate's own scrolling.
              if (Math.abs(rect.top - wanted) <= 24) return;
              scrollContainerBy(renderer, rect.top - wanted);
            });
          },
        };
      }
    }
    // epub.js keeps one iframe per rendered view and swaps them on a section
    // change; take the biggest one that actually has content on screen.
    var frames = document.querySelectorAll(".epub-viewer iframe");
    var best = null, bestFrame = null, bestArea = 0;
    for (var i = 0; i < frames.length; i += 1) {
      var doc = null;
      try { doc = frames[i].contentDocument; } catch (e) { doc = null; }
      if (!doc || !doc.body || !doc.body.textContent.trim()) continue;
      var box = frames[i].getBoundingClientRect();
      var area = box.width * box.height;
      if (area > bestArea) { bestArea = area; best = doc; bestFrame = frames[i]; }
    }
    if (best) {
      return {
        doc: best,
        mode: readingMode(),
        frame: bestFrame,
        // In scrolled mode epub.js makes the iframe as tall as the entire
        // chapter, so everything looks "visible" from inside it. Judge against
        // the window instead, allowing for the sticky toolbar.
        visible: function (range) { return visibleInHost(bestFrame, range); },
        turn: turnWithFooter,
        reveal: function (range) { revealInFrame(best, bestFrame, range); },
      };
    }
    return null;
  }

  // epub.js in scrolled mode puts the whole section in a tall iframe and lets
  // the host page scroll, so the range has to be mapped into host coordinates.
  function revealInFrame(doc, frame, range) {
    var rect;
    try { rect = range.getBoundingClientRect(); } catch (e) { return; }
    if (!rect) return;

    // Scroll so the highlighted sentence appears near the top of the viewport,
    // just below the reader header, rather than at the centre. This prevents
    // the "reverts to top" effect: centering a range that has gone off the
    // bottom produces a large backwards scroll; top-aligning it does not.
    var topPad = headerBottom() + 20;

    // Set scrollTop directly rather than trusting Element.scrollTo/scrollBy.
    // Mobile Safari exposes both methods on several EPUB wrapper elements but
    // can accept the call without moving them. Direct assignment is observable
    // and lets the next-frame correction below measure the actual result.
    function moveScroller(scroller, delta) {
      if (!scroller || !Number.isFinite(delta) || Math.abs(delta) < 2) return;
      try { scroller.scrollTop = scroller.scrollTop + delta; } catch (e) { /* try the host */ }
    }

    var host = frame ? scrollableAncestor(frame) : null;
    var hostScrolls = host && host.scrollHeight > host.clientHeight + 4;
    var scroller = doc.scrollingElement || doc.documentElement;
    // In continuous EPUB mode epub.js exposes two plausible scrollers. The
    // document inside the iframe may report overflow, but the visible motion is
    // owned by the outer .epub-container. Prefer that observable host whenever
    // it can scroll; writing to the inner document was the inert-arrow bug.
    if (!hostScrolls && scroller && scroller.scrollHeight > scroller.clientHeight + 4) {
      moveScroller(scroller, rect.top - topPad);
      requestAnimationFrame(function () {
        var after;
        try { after = range.getBoundingClientRect(); } catch (e) { return; }
        if (after) moveScroller(scroller, after.top - topPad);
      });
      return;
    }
    if (!frame || !hostScrolls) return;
    var frameBox = frame.getBoundingClientRect();
    var hostTop = host === document.scrollingElement ? 0 : host.getBoundingClientRect().top;
    var delta = (frameBox.top + rect.top) - (hostTop + topPad);
    moveScroller(host, delta);
    // The iframe height and its host offset can settle one frame after a
    // narration highlight. Measure the outcome, then make one bounded
    // correction. This is what turns the arrow into a guarantee rather than a
    // best-effort API call.
    requestAnimationFrame(function () {
      var after, nextFrameBox, nextHostTop;
      try {
        after = range.getBoundingClientRect();
        nextFrameBox = frame.getBoundingClientRect();
        nextHostTop = host === document.scrollingElement ? 0 : host.getBoundingClientRect().top;
      } catch (e) { return; }
      if (!after) return;
      moveScroller(host, (nextFrameBox.top + after.top) - (nextHostTop + topPad));
    });
  }

  function scrollableAncestor(el) {
    for (var n = el.parentElement; n; n = n.parentElement) {
      var st = getComputedStyle(n);
      if (/(auto|scroll)/.test(st.overflowY) && n.scrollHeight > n.clientHeight + 4) return n;
    }
    return document.scrollingElement || document.documentElement;
  }

  // Identity is unreliable across an iframe swap, so compare what is in the
  // document rather than which object it is.
  function signature(doc) {
    if (!doc || !doc.body) return "";
    return (doc.title || "") + "|" + doc.body.textContent.replace(/\s+/g, " ").trim().slice(0, 120);
  }

  function turnWithFooter() {
    var buttons = document.querySelectorAll(".reader-footer button");
    var next = buttons[buttons.length - 1];
    if (next && !next.disabled) next.click();
  }

  // --- collect the prose, in order -----------------------------------------
  function speechChunks(text, lang, limit) {
    var sentences = [], segmenter = null;
    try { segmenter = new Intl.Segmenter(lang || "en", { granularity: "sentence" }); } catch (e) { segmenter = null; }
    if (segmenter) {
      for (var seg of segmenter.segment(text)) sentences.push({ text: seg.segment, at: seg.index });
    } else {
      var re = /[^.!?]+(?:[.!?]+[\s]*|$)/g, match;
      while ((match = re.exec(text))) sentences.push({ text: match[0], at: match.index });
      if (!sentences.length && text) sentences.push({ text: text, at: 0 });
    }

    var pieces = [];
    for (var i = 0; i < sentences.length; i += 1) {
      var sentence = sentences[i], pos = 0;
      while (sentence.text.length - pos > limit) {
        var cut = pos + limit;
        var windowText = sentence.text.slice(pos, cut + 1);
        var punctuation = Math.max(windowText.lastIndexOf(", "), windowText.lastIndexOf("; "), windowText.lastIndexOf(": "));
        var space = windowText.lastIndexOf(" ");
        var localCut = punctuation > limit * 0.55 ? punctuation + 1 : space > limit * 0.55 ? space + 1 : limit;
        pieces.push({ text: sentence.text.slice(pos, pos + localCut), at: sentence.at + pos });
        pos += localCut;
      }
      if (sentence.text.slice(pos)) pieces.push({ text: sentence.text.slice(pos), at: sentence.at + pos });
    }

    // Join adjacent short sentences from the same paragraph. This removes the
    // audible pause Safari inserts between one-utterance-per-sentence calls.
    var out = [];
    for (var j = 0; j < pieces.length; j += 1) {
      var p = pieces[j];
      if (!p.text.trim()) continue;
      var last = out[out.length - 1];
      if (last && last.at + last.text.length === p.at && last.text.length + p.text.length <= limit) {
        last.text += p.text;
        last.end = p.at + p.text.length;
      } else {
        out.push({ text: p.text, at: p.at, end: p.at + p.text.length });
      }
    }
    return out;
  }

  // Safari can expose a different voiceURI for the same installed voice after
  // the page (or Home Screen app) is relaunched. Keep the URI as the primary
  // identifier, but recover the user's choice by its stable name/language.
  function resolveVoice(list, uri, name, lang) {
    var i;
    if (uri) {
      for (i = 0; i < list.length; i += 1) if (list[i].voiceURI === uri) return list[i];
    }
    if (name && lang) {
      for (i = 0; i < list.length; i += 1) {
        if (list[i].name === name && (list[i].lang || "").toLowerCase() === lang.toLowerCase()) return list[i];
      }
    }
    if (name) {
      for (i = 0; i < list.length; i += 1) if (list[i].name === name) return list[i];
    }
    return null;
  }

  if (window.__RR_TTS_TEST_ONLY__) {
    window.__RR_TTS_TEST_API__ = { speechChunks: speechChunks, resolveVoice: resolveVoice, isAppleMobile: isAppleMobile, isControlTap: isControlTap, ignoreSteeringClick: ignoreSteeringClick, testWindow: window };
    return;
  }

  function collect(doc) {
    var out = [];
    var lang = (doc.documentElement && doc.documentElement.lang) || "en";

    var walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        if (!node.data || !node.data.trim()) return NodeFilter.FILTER_REJECT;
        var el = node.parentElement;
        if (!el) return NodeFilter.FILTER_REJECT;
        if (isFurniture(el)) return NodeFilter.FILTER_REJECT;
        var style = doc.defaultView.getComputedStyle(el);
        if (style && (style.display === "none" || style.visibility === "hidden")) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });

    // Group text nodes by their nearest block ancestor so sentences don't run
    // across paragraph boundaries.
    var blocks = [];
    var current = null;
    var node;
    while ((node = walker.nextNode())) {
      var block = node.parentElement.closest("p,h1,h2,h3,h4,h5,h6,li,blockquote,dd,dt,td,th,pre,section,div,body") || doc.body;
      if (!current || current.block !== block) {
        current = { block: block, nodes: [], text: "" };
        blocks.push(current);
      }
      current.nodes.push({ node: node, at: current.text.length });
      current.text += node.data;
    }

    for (var i = 0; i < blocks.length; i += 1) {
      var b = blocks[i];
      if (!isProse(b.text)) continue;
      var pieces = speechChunks(b.text, lang, MAX_CHARS);
      for (var j = 0; j < pieces.length; j += 1) {
        var p = pieces[j];
        if (!p.text.trim()) continue;
        var range = rangeFor(doc, b, p.at, p.end);
        if (range) out.push({ text: p.text, range: range, block: b, at: p.at, end: p.end });
      }
    }
    return out;
  }

  // Piper returns a complete audio file, not a stream. A normal 200-character
  // clip can therefore leave a new book silent while the whole sentence is
  // synthesised. Split only the first clip of a newly started position; the
  // rest retain the longer cadence-friendly size and are prefetched while
  // this short lead-in plays.
  function prepareStartupClip(doc, index) {
    var item = queue[index];
    if (!item || item.startupReady || item.text.length <= STARTUP_CHARS || !item.block) return;
    var min = Math.min(44, STARTUP_CHARS - 1);
    var cut = -1;
    for (var i = STARTUP_CHARS; i >= min; i -= 1) {
      if (/\s/.test(item.text.charAt(i))) { cut = i + 1; break; }
    }
    if (cut <= 0 || cut >= item.text.length) return;
    var middle = item.at + cut;
    var firstRange = rangeFor(doc, item.block, item.at, middle);
    var restRange = rangeFor(doc, item.block, middle, item.end);
    if (!firstRange || !restRange) return;
    queue.splice(index, 1,
      { text: item.text.slice(0, cut), range: firstRange, block: item.block, at: item.at, end: middle, startupReady: true },
      { text: item.text.slice(cut), range: restRange, block: item.block, at: middle, end: item.end, startupReady: true });
  }

  function rangeFor(doc, block, start, end) {
    var s = locate(block, start);
    var e = locate(block, end);
    if (!s || !e) return null;
    try {
      var r = doc.createRange();
      r.setStart(s.node, s.offset);
      r.setEnd(e.node, e.offset);
      return r;
    } catch (err) { return null; }
  }

  function locate(block, index) {
    for (var i = 0; i < block.nodes.length; i += 1) {
      var entry = block.nodes[i];
      var len = entry.node.data.length;
      if (index <= entry.at + len) return { node: entry.node, offset: Math.max(0, index - entry.at) };
    }
    var last = block.nodes[block.nodes.length - 1];
    return last ? { node: last.node, offset: last.node.data.length } : null;
  }

  function isProse(text) {
    var t = text.replace(/\s+/g, " ").trim();
    if (t.length < 2) return false;
    if (!/[A-Za-zÀ-ɏЀ-ӿऀ-ॿ]/.test(t)) return false;   // no letters: page numbers, rules
    if (/^[ivxlcdm]+$/i.test(t)) return false;                    // roman folio
    return true;
  }

  // --- highlight without touching the document -----------------------------
  // Deliberately defensive. One Highlight object is created per document and
  // reused — its ranges are cleared and re-added rather than the registry
  // entry being replaced — and every document currently on screen is swept
  // before each sentence. Replacing a registry entry *should* be enough, but
  // it demonstrably is not in every browser, and a trail of stale highlights
  // is the most visible possible failure.
  function allDocs() {
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
      try { if (frames[j].contentDocument) out.push(frames[j].contentDocument); } catch (e) { /* ignore */ }
    }
    return out;
  }

  function clearHighlights(except) {
    var docs = allDocs();
    for (var i = 0; i < docs.length; i += 1) {
      var doc = docs[i];
      if (except && doc === except) continue;
      try {
        var overlays = doc.querySelectorAll && doc.querySelectorAll(".rr-reading-highlight-overlay");
        for (var j = 0; overlays && j < overlays.length; j += 1) overlays[j].remove();
        var sel = doc.getSelection && doc.getSelection();
        if (sel && sel.rangeCount) sel.removeAllRanges();
      } catch (e) { /* document torn down */ }
    }
  }

  function highlight(doc, range) {
    // A sentence owns the only narration highlight. The previous version kept
    // the current document out of cleanup, so every spoken sentence appended
    // another overlay on top of all earlier sentences in the chapter.
    clearHighlights();
    // `allDocs()` can briefly miss a newly swapped iframe. Clean the target
    // directly as well so the one-highlight invariant survives that handoff.
    try {
      var stale = doc.querySelectorAll && doc.querySelectorAll(".rr-reading-highlight-overlay");
      for (var staleIndex = 0; stale && staleIndex < stale.length; staleIndex += 1) stale[staleIndex].remove();
    } catch (e) { /* document torn down */ }
    try {
      var rects = Array.prototype.filter.call(range.getClientRects(), function (rect) {
        return rect.width > 0 && rect.height > 0;
      }).sort(function (a, b) { return a.top - b.top || a.left - b.left; });
      if (!rects.length) return;
      var lines = [];
      rects.forEach(function (rect) {
        var line = lines[lines.length - 1];
        if (!line || Math.abs(line.top - rect.top) > Math.max(3, rect.height * 0.28)) {
          lines.push({ left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom });
        } else {
          line.left = Math.min(line.left, rect.left);
          line.right = Math.max(line.right, rect.right);
          line.top = Math.min(line.top, rect.top);
          line.bottom = Math.max(line.bottom, rect.bottom);
        }
      });
      var root = doc.createElement("div");
      root.className = "rr-reading-highlight-overlay";
      root.setAttribute("aria-hidden", "true");
      root.style.cssText = "position:absolute;left:0;top:0;width:0;height:0;pointer-events:none;z-index:2147483646";
      var win = doc.defaultView;
      var sx = (win && win.scrollX) || 0, sy = (win && win.scrollY) || 0;
      lines.forEach(function (line) {
        var mark = doc.createElement("span");
        mark.style.cssText = "position:absolute;display:block;background:rgba(129,147,135,.34);border-radius:2px;" +
          "left:" + (line.left + sx) + "px;top:" + (line.top + sy) + "px;width:" + (line.right - line.left) + "px;height:" + (line.bottom - line.top) + "px";
        root.appendChild(mark);
      });
      (doc.body || doc.documentElement).appendChild(root);
    } catch (e) {
      // A highlight failure must never interrupt narration.
    }
  }

  // --- keeping the page in step with the voice -----------------------------
  function headerBottom() {
    var h = document.querySelector(".reader-header");
    if (!h) return 0;
    var r = h.getBoundingClientRect();
    return r.bottom > 0 ? r.bottom : 0;
  }

  function visibleInHost(frame, range) {
    var r, f;
    try { r = range.getBoundingClientRect(); f = frame.getBoundingClientRect(); } catch (e) { return false; }
    if (!r || (!r.width && !r.height)) return false;
    var top = f.top + r.top, bottom = f.top + r.bottom;
    var left = f.left + r.left, right = f.left + r.right;
    return bottom > headerBottom() + 2 && top < window.innerHeight - 2 &&
           right > 0 && left < window.innerWidth - 1;
  }

  // Wait until the active sentence reaches the final part of the viewport.
  // The old 50% boundary made the page jump while the highlight was midway
  // down the screen; the lower 12% is now the reveal safety band.
  //
  // The frame of reference has to match the mode's own visibility test. In
  // epub.js scrolled mode the iframe is as tall as the whole chapter and the
  // host window scrolls, so measuring against the iframe's height - as the
  // first version of this did - made almost everything look "comfortable",
  // no reveal ever fired, and playback fell through to page turns that loop
  // back to the top of the section.
  function comfortablyVisible(state, range) {
    if (!isVisible(state, range)) return false;
    var r;
    try { r = range.getBoundingClientRect(); } catch (e) { return false; }
    if (!r) return false;

    if (state.frame) {
      // Host coordinates: map the range through the iframe's own offset.
      var f;
      try { f = state.frame.getBoundingClientRect(); } catch (e) { return true; }
      var top = f.top + r.top, bottom = f.top + r.bottom;
      var head = headerBottom();
      var limit = head + (window.innerHeight - head) * 0.88;
      return top >= head - 2 && bottom <= limit;
    }

    // foliate: the iframe is the visible page, so its viewport is correct.
    var doc = state.doc;
    var h = (doc && (doc.documentElement.clientHeight || doc.body.clientHeight)) || 0;
    if (!h) return true;
    return r.top >= -2 && r.bottom <= h * 0.88;
  }

  function visibleInDoc(doc, range) {
    var r;
    try { r = range.getBoundingClientRect(); } catch (e) { return false; }
    if (!r || (!r.width && !r.height)) return false;
    var w = doc.documentElement.clientWidth || doc.body.clientWidth;
    var h = doc.documentElement.clientHeight || doc.body.clientHeight;
    return r.left > -4 && r.left < w - 1 && r.bottom > -4 && r.top < h + 4;
  }

  function isVisible(state, range) {
    return state.visible ? state.visible(range) : visibleInDoc(state.doc, range);
  }

  async function waitUntilVisible(state, range, timeout, mine) {
    for (var waited = 0; waited < timeout; waited += TURN_SETTLE) {
      if (!playing || paused || mine !== epoch) return false;
      if (isVisible(state, range)) return true;
      await sleep(TURN_SETTLE);
    }
    return playing && !paused && mine === epoch && isVisible(state, range);
  }

  // With the screen locked iOS stops running layout: getBoundingClientRect
  // returns stale numbers, so nothing ever looks visible and no page turn ever
  // looks like it moved. The paginated path below then hits its "did not move"
  // guard and returns false, which stops playback after a page or two. While
  // hidden, skip the geometry entirely and let speech continue - the text is
  // not being looked at, and position is reconciled on the next wake.
  function screenAsleep() {
    return typeof document !== "undefined" && document.hidden;
  }

  async function bringIntoView(state, item, mine) {
    if (!playing || paused || mine !== epoch) return false;
    if (screenAsleep()) return true;
    // In scroll mode "visible" is not enough: a sentence sitting on the last
    // line still counts, so reveal only once it enters the lower safety band.
    // This keeps most of a page stable instead of snapping at its midpoint.
    if (state.mode === "scroll" && state.reveal) {
      if (comfortablyVisible(state, item.range)) return true;
      // A finger drag or wheel belongs to the reader. Do not have narration
      // immediately yank the chapter back underneath them; keep speaking and
      // resume visual following only after the interaction has settled.
      if (Date.now() < manualScrollUntil) return true;
      state.reveal(item.range);
      await waitUntilVisible(state, item.range, 280, mine);
      if (!playing || paused || mine !== epoch) return false;
      // Report success either way. Returning false here made step() null the
      // queue and restart from the first visible sentence - which, right after
      // a scroll, is the top of the page. That was the loop: read to the
      // bottom, fail the check, jump back up, read the same text again.
      //
      // A reveal that does not land is not a reason to stop or rewind: the
      // sentence is still the correct next one, so speak it and let the next
      // reveal catch up. Only a genuine end of section advances, via the
      // cursor running past the queue.
      return true;
    }
    // Paginated: never scroll. Doing so fights the pagination engine and was
    // the source of both skipped text and visible bouncing on iOS - page turns
    // below are the only way to move.
    if (isVisible(state, item.range)) return true;

    var turns = 0;
    var sig = signature(state.doc);
    while (playing && !paused && mine === epoch && turns < MAX_TURNS && !isVisible(state, item.range)) {
      // The screen can lock part-way through: layout freezes, so no turn ever
      // looks like it moved and the loop would keep turning pages blindly until
      // MAX_TURNS. Stop chasing and just speak.
      if (screenAsleep()) return true;
      var beforeRect = rectKey(item.range);
      state.turn();
      await sleep(PAGE_TURN_SETTLE);
      if (!playing || paused || mine !== epoch) return false;
      if (screenAsleep()) return true;
      var now = reader();
      if (!now || signature(now.doc) !== sig) return false;   // section changed
      var moved = false;
      for (var waited = TURN_SETTLE; waited < TURN_TIMEOUT; waited += TURN_SETTLE) {
        if (isVisible(state, item.range)) return true;
        if (rectKey(item.range) !== beforeRect) { moved = true; break; }
        await sleep(TURN_SETTLE);
        if (!playing || paused || mine !== epoch) return false;
      }
      // A turn that did not move the page means we are at the end of the
      // section: hand back to step(), which advances via the cursor. Returning
      // false for "the sentence is still not on screen" is what made paginated
      // mode rewind - step() nulls the queue and restarts from the first
      // visible sentence, i.e. the top of the current page.
      if (!moved && rectKey(item.range) === beforeRect) break;
      turns += 1;
    }
    // Speak it regardless. Same reasoning as scroll mode: failing to bring a
    // sentence on screen is not a reason to rewind or stop, and the highlight
    // simply lands off-view for one sentence. The genuine end of a section is
    // still detected by the cursor running past the queue.
    return true;
  }

  function rectKey(range) {
    try { var r = range.getBoundingClientRect(); return Math.round(r.left) + ":" + Math.round(r.top); }
    catch (e) { return "?"; }
  }

  // --- the pump ------------------------------------------------------------
  async function step(mine) {
    if (!playing || paused || mine !== epoch) return;

    var state = reader();
    if (!state) {                        // mid-transition: wait for the new view
      for (var tries = 0; tries < 16 && !state; tries += 1) {
        await sleep(160);
        if (!playing || paused || mine !== epoch) return;
        state = reader();
      }
      if (!state) { stop(); return; }
    }

    if (signature(state.doc) !== queueDoc) {
      ensureQueue(state.doc);
      if (!queue.length) { await advanceSection(state, mine); return; }
      // Start from whatever is on screen, not the top of the chapter.
      var visibleItems = [];
      for (var i = 0; i < queue.length; i += 1) if (isVisible(state, queue[i].range)) visibleItems.push(i);
      if (visibleItems.length) cursor = visibleItems[0];
      prepareStartupClip(state.doc, cursor);
    }

    if (cursor >= queue.length) { await advanceSection(state, mine); return; }

    // play() renders before the first document has been collected, and each
    // completed clip advances the cursor before returning here. Refresh the
    // controls now that the queue/cursor are authoritative so the compact and
    // expanded Previous/Next buttons never lag one sentence behind playback.
    render();

    var item = queue[cursor];
    var ok = await bringIntoView(state, item, mine);
    if (!playing || paused || mine !== epoch) return;
    if (!ok) return;

    highlight(state.doc, item.range);
    speak(item.text, mine, state.doc);
  }

  function ensureQueue(doc) {
    var sig = signature(doc);
    if (sig === queueDoc && queue.length) return;
    queue = collect(doc);
    queueDoc = sig;
    cursor = 0;
    attachSteering(doc);
  }

  // --- click any sentence to read from there --------------------------------
  function attachSteering(doc) {
    if (!doc || doc.__rrSteering) return;
    doc.__rrSteering = true;
    doc.addEventListener("touchmove", markManualScroll, { passive: true });
    doc.addEventListener("wheel", markManualScroll, { passive: true });
    doc.addEventListener("click", function (event) {
      if (!mountedShell) return;                          // reader not mounted
      if (ignoreSteeringClick(playing, Date.now())) return;
      var t = event.target;
      if (t && t.closest && t.closest("a,button,input,select,textarea")) return;
      var sel = doc.getSelection && doc.getSelection();
      if (sel && sel.rangeCount && !sel.isCollapsed) return;   // user is selecting text
      var here = reader();
      if (!here || here.doc !== doc) return;
      ensureQueue(doc);
      var idx = indexAtPoint(doc, event.clientX, event.clientY);
      if (idx < 0) return;
      cursor = idx;
      playing = true;
      paused = false;
      epoch += 1;
      haltCurrentAudio();
      render();
      step(epoch);
    }, true);
  }

  function indexAtPoint(doc, x, y) {
    var caret = null;
    try {
      if (doc.caretRangeFromPoint) caret = doc.caretRangeFromPoint(x, y);
      else if (doc.caretPositionFromPoint) {
        var pos = doc.caretPositionFromPoint(x, y);
        if (pos) { caret = doc.createRange(); caret.setStart(pos.offsetNode, pos.offset); }
      }
    } catch (e) { caret = null; }
    if (!caret) return -1;
    var node = caret.startContainer, offset = caret.startOffset;
    var best = -1;
    for (var i = 0; i < queue.length; i += 1) {
      try {
        if (queue[i].range.comparePoint(node, offset) === 0) return i;
        if (queue[i].range.comparePoint(node, offset) > 0) best = i;   // click is past this one
      } catch (e) { /* different tree */ }
    }
    return best >= 0 ? Math.min(best + 1, queue.length - 1) : -1;
  }

  async function advanceSection(state, mine) {
    var before = signature(state.doc);
    state.turn();
    // A new section means a new document, but the engines take their time
    // mounting it — poll rather than guess a delay.
    for (var waited = 0; waited < 2600; waited += 160) {
      await sleep(160);
      if (!playing || paused || mine !== epoch) return;
      // Re-assert playbackState so iOS does not suspend the audio session
      // during the gap between the last sentence and the first of the new page.
      try { if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "playing"; } catch (e) {}
      var now = reader();
      if (now && signature(now.doc) !== before) {
        queueDoc = null;
        step(mine);
        return;
      }
    }
    stop();                                              // nothing left to read
  }

  // --- narration through Piper -------------------------------------------
  // One <audio> element for the whole session: iOS only grants background
  // playback to an element it has seen the user start, so it is created once
  // and reused rather than per sentence.
  var rrTtsAudio = null, rrPrefetch = Object.create(null), rrWarmTimer = null;
  var stallTimer = null, stallRetries = 0, stallText = "";

  function clearStallWatchdog() {
    if (stallTimer) clearTimeout(stallTimer);
    stallTimer = null;
  }

  function armStallWatchdog(text, mine) {
    clearStallWatchdog();
    stallTimer = setTimeout(function () {
      stallTimer = null;
      if (!playing || paused || mine !== epoch) return;
      if (stallText !== text) { stallText = text; stallRetries = 0; }
      stallRetries += 1;
      if (stallRetries <= 2) restartCurrentSentence();
      else { stallRetries = 0; cursor += 1; restartCurrentSentence(); }
    }, STALL_TIMEOUT);
  }

  function ttsVoice() {
    try { return localStorage.getItem("reading-room-voice") || ""; } catch (e) { return ""; }
  }

  function ttsUrl(text) {
    return "/api/tts?v=" + encodeURIComponent(ttsVoice()) + "&t=" + encodeURIComponent(text);
  }

  function audioEl() {
    if (rrTtsAudio) return rrTtsAudio;
    var a = document.createElement("audio");
    a.id = "rr-tts-audio";
    a.preload = "auto";
    // Keep it in the document: a detached element is treated as disposable
    // and can be stopped when the page is backgrounded.
    a.style.cssText = "position:fixed;width:0;height:0;opacity:0;pointer-events:none";
    document.body.appendChild(a);
    rrTtsAudio = a;
    return a;
  }

  function warmUrl(url) {
    if (rrPrefetch[url]) return rrPrefetch[url];
    try {
      rrPrefetch[url] = fetch(url, { cache: "force-cache" }).catch(function () {});
    } catch (e) {
      rrPrefetch[url] = Promise.resolve();
    }
    return rrPrefetch[url];
  }

  // Warm the next sentence while the current one plays. Synthesis runs at
  // several times real time, so by the time it is needed it is on disk.
  function warmAhead(start, count) {
    var end = start + count;
    function lane(index) {
      if (index >= end) return Promise.resolve();
      var next = queue[index];
      if (!next || !next.text) return lane(index + 2);
      var url = ttsUrl(next.text);
      return warmUrl(url).then(function () { return lane(index + 2); });
    }
    // Piper has two worker slots. Two ordered lanes keep both busy while
    // guaranteeing that sentence 1/2 are submitted before 3/4 and 5/6; a
    // six-request burst let distant prefetches win the scheduler race.
    lane(start);
    lane(start + 1);
  }

  function prefetch(mine) {
    // Six ahead, not two. Each /api/tts call is a synthesis round trip on the
    // Pi; two sentences of lead does not cover it at reading speed, so
    // playback stalled for several seconds every few sentences waiting for the
    // next clip. The responses are cached, so the extra warming is cheap.
    warmAhead(cursor + 1, 6);
  }

  // Piper has to synthesise a clip the first time a sentence/voice pair is
  // requested. Do that quiet work shortly after the book settles, before the
  // user opens Read Aloud. The warmed URL is exactly the one play() will use,
  // so starting feels immediate without changing playback state or position.
  function warmFirstSentence() {
    rrWarmTimer = null;
    if (playing) return;
    var state = reader();
    if (!state) return;
    ensureQueue(state.doc);
    if (!queue.length) return;
    var at = 0;
    for (var i = 0; i < queue.length; i += 1) {
      if (isVisible(state, queue[i].range)) { at = i; break; }
    }
    var item = queue[at];
    prepareStartupClip(state.doc, at);
    item = queue[at];
    if (!item || !item.text) return;
    var url = ttsUrl(item.text);
    warmUrl(url).then(function () { warmAhead(at + 1, 6); });
  }

  function scheduleWarmFirstSentence(delay) {
    if (rrWarmTimer) clearTimeout(rrWarmTimer);
    rrWarmTimer = setTimeout(warmFirstSentence, delay == null ? 80 : delay);
  }

  function mediaSession(doc) {
    if (!("mediaSession" in navigator)) return;
    try {
      var title = (document.querySelector(".reader-shell h1, .reader-title") || {}).textContent
        || document.title || "The Reading Room";
      navigator.mediaSession.metadata = new MediaMetadata({
        title: String(title).trim().slice(0, 120),
        artist: "The Reading Room",
      });
      // Tell iOS the audio session is actively playing so it keeps background
      // audio alive through page-turn gaps (fixes reading stopping after 2-3
      // pages when the screen is locked).
      navigator.mediaSession.playbackState = "playing";
      navigator.mediaSession.setActionHandler("play", function () { if (paused) toggle(); });
      navigator.mediaSession.setActionHandler("pause", function () { if (!paused) toggle(); });
      navigator.mediaSession.setActionHandler("stop", stop);
      navigator.mediaSession.setActionHandler("previoustrack", function () { skipSentence(-1); });
      navigator.mediaSession.setActionHandler("nexttrack", function () { skipSentence(1); });
    } catch (e) { /* older browsers */ }
  }

  function speak(text, mine, doc) {
    var a = audioEl();
    // playbackRate has to be re-applied after each load. Assigning it before
    // src looks right but iOS resets the rate when new media loads, so every
    // sentence played at 1x however the control was set - which is why the
    // speed control appeared to do nothing.
    var applyRate = function () { try { a.playbackRate = rate; } catch (e) {} };
    applyRate();
    a.onloadedmetadata = applyRate;
    a.onplay = applyRate;
    a.onended = function () {
      if (!playing || mine !== epoch) return;
      clearStallWatchdog();
      stallRetries = 0;
      cursor += 1;
      step(mine);
    };
    a.onerror = function () {
      if (!playing || mine !== epoch) return;
      clearStallWatchdog();
      if (stallText !== text) { stallText = text; stallRetries = 0; }
      stallRetries += 1;
      if (stallRetries <= 2) restartCurrentSentence();
      else { stallRetries = 0; cursor += 1; restartCurrentSentence(); }
    };
    a.onplaying = function () { armStallWatchdog(text, mine); };
    a.ontimeupdate = function () { armStallWatchdog(text, mine); };
    a.onwaiting = function () { armStallWatchdog(text, mine); };
    a.src = ttsUrl(text);
    mediaSession(doc);
    stallText = text;
    armStallWatchdog(text, mine);
    var go = a.play();
    if (go && go.catch) {
      go.catch(function () {
        // Autoplay refused (no gesture yet, usually): leave it to the user.
        // A pause invalidates this play request by advancing epoch. Safari can
        // reject that now-obsolete promise after the pause tap; treating the
        // rejection as a fresh autoplay failure stopped the whole session and
        // made the collapsed controls disappear.
        if (playing && !paused && mine === epoch) { playing = false; paused = true; render(); }
      });
    }
    prefetch(mine);
  }

  // --- sleep timer -----------------------------------------------------------
  function renderTimer() {
    render();
  }

  function adjustSleepTime(minutes) {
    var delta = Number(minutes);
    if (!isFinite(delta) || !delta) return;
    sleepMs = Math.max(0, sleepMs + delta * 60 * 1000);
    if (!sleepRef) {
      if (sleepMs) {
        sleepRef = setInterval(function () {
          if (!playing || paused) return; // pause countdown while paused
          sleepMs = Math.max(0, sleepMs - 1000);
          renderTimer();
          if (!sleepMs) { clearInterval(sleepRef); sleepRef = null; stop(); }
        }, 1000);
      }
    } else if (!sleepMs) {
      // Reaching zero through the minus button disables the timer; only the
      // countdown expiring naturally should stop playback.
      clearInterval(sleepRef);
      sleepRef = null;
    }
    renderTimer();
  }

  function clearSleepTimer() {
    sleepMs = 0;
    if (sleepRef) { clearInterval(sleepRef); sleepRef = null; }
  }

  // --- controls ------------------------------------------------------------
  function play() {
    if (!reader()) return;
    playing = true;
    paused = false;
    epoch += 1;
    queueDoc = null;
    render();
    step(epoch);
    // Each utterance is deliberately kept short. Do not use the traditional
    // speechSynthesis pause/resume keepalive: on iOS it creates a very audible
    // skip and can lose the boundary callback entirely.
    if (!sweeper) {
      sweeper = setInterval(function () {
        if (!playing) return;
        var st = reader();
        if (st) clearHighlights(st.doc);        // nothing highlighted anywhere else
      }, 1200);
    }
  }

  function stop() {
    playing = false;
    paused = false;
    epoch += 1;
    queue = []; queueDoc = null; cursor = 0;
    clearSleepTimer();
    clearStallWatchdog();
    try { if (rrTtsAudio) { rrTtsAudio.pause(); rrTtsAudio.removeAttribute('src'); rrTtsAudio.load(); } } catch (e) { /* ignore */ }
    try { if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'none'; } catch (e) {}
    if (keepAlive) { clearInterval(keepAlive); keepAlive = null; }
    if (sweeper) { clearInterval(sweeper); sweeper = null; }
    clearHighlights();
    render();
  }

  // Keep the same audio element and source paused so iOS retains the media
  // session and AirPods/lock-screen Play can resume without a foreground tap.
  function toggle() {
    if (!playing) { play(); return; }
    if (paused) {
      paused = false;
      try { if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "playing"; } catch (e) {}
      render();
      if (rrTtsAudio && rrTtsAudio.src) {
        var resumed = rrTtsAudio.play();
        if (resumed && resumed.catch) resumed.catch(restartCurrentSentence);
      } else restartCurrentSentence();
      return;
    }
    paused = true;
    clearStallWatchdog();
    try { if (rrTtsAudio) rrTtsAudio.pause(); } catch (e) { /* ignore */ }
    try { if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "paused"; } catch (e) {}
    render();
  }

  function haltCurrentAudio() {
    clearStallWatchdog();
    try {
      if (rrTtsAudio) {
        rrTtsAudio.onended = null;
        rrTtsAudio.onerror = null;
        rrTtsAudio.pause();
        rrTtsAudio.removeAttribute("src");
        rrTtsAudio.load();
      }
    } catch (e) { /* ignore */ }
  }

  function restartCurrentSentence() {
    if (!playing || paused) return;
    epoch += 1;
    var mine = epoch;
    haltCurrentAudio();
    setTimeout(function () { if (playing && !paused && mine === epoch) step(mine); }, 80);
  }

  // One implementation backs the expanded sheet, the collapsed transport and
  // the Lock Screen controls. Invalidating the current clip before moving the
  // cursor is important: otherwise its delayed `ended` callback advances a
  // second time and makes a single Next tap skip two sentences.
  function skipSentence(delta) {
    if (!playing || !delta) return;
    var state = reader();
    if (state) ensureQueue(state.doc);
    if (!queue.length) return;
    cursor = delta < 0 ? Math.max(0, cursor - 1) : Math.min(queue.length, cursor + 1);
    epoch += 1;
    var mine = epoch;
    haltCurrentAudio();
    clearHighlights();
    render();
    if (!paused) step(mine);
  }

  function publicState() {
    return {
      playing: playing,
      paused: paused,
      rate: rate,
      sleepMinutes: sleepMs ? Math.ceil(sleepMs / 60000) : 0,
      canPrevious: playing && cursor > 0,
      canNext: playing && !!queue.length,
    };
  }

  // Voices as data rather than a DOM node. The reading sheet used to clone the
  // <select> and read .options, which coupled it to this module's markup; a
  // React component should not have to know a select exists. The select stays as
  // the source of truth so nothing about playback changes.
  function getVoices() {
    var selected = ttsVoice();
    return piperVoices.map(function (voice) {
      return { label: voice.label, value: voice.id, current: voice.id === selected };
    });
  }
  function setVoice(value) {
    try { localStorage.setItem("reading-room-voice", value || ""); } catch (e) {}
    scheduleWarmFirstSentence(40);
    render();
    if (playing && !paused) restartCurrentSentence();
  }

  window.addEventListener("rr-reading-mode-change", function (event) {
    var requested = event.detail && event.detail.mode;
    if (requested !== "pages" && requested !== "scroll") return;
    var before = reader();
    if (before) ensureQueue(before.doc);
    var anchorText = queue[cursor] && queue[cursor].text;
    var oldDoc = before && before.doc;
    var wasPlaying = playing;
    var wasPaused = paused;
    epoch += 1;
    var mine = epoch;
    haltCurrentAudio();
    clearHighlights();
    queue = []; queueDoc = null; cursor = 0;
    if (!wasPlaying || !anchorText) { render(); return; }

    (async function restoreAfterModeChange() {
      var state = null;
      for (var attempt = 0; attempt < 50; attempt += 1) {
        await sleep(100);
        if (mine !== epoch) return;
        state = reader();
        if (state && state.mode === requested && state.doc !== oldDoc) break;
      }
      if (!state || mine !== epoch) return;
      ensureQueue(state.doc);
      var normalized = anchorText.replace(/\s+/g, " ").trim();
      var found = queue.findIndex(function (item) {
        return item.text.replace(/\s+/g, " ").trim() === normalized;
      });
      if (found >= 0) cursor = found;
      else {
        var visible = queue.findIndex(function (item) { return isVisible(state, item.range); });
        cursor = visible >= 0 ? visible : 0;
      }
      playing = true;
      paused = wasPaused;
      render();
      if (paused) {
        if (queue[cursor]) highlight(state.doc, queue[cursor].range);
        try { if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "paused"; } catch (e) {}
      } else step(mine);
    })();
  });

  // Exposed so the reading menu can offer a slider instead of a cycle button.
  // Restarting the sentence is what makes a change audible immediately; without
  // it the new rate only applied from the next sentence.
  function setRate(next) {
    var v = Number(next);
    if (!isFinite(v)) return;
    rate = Math.min(2, Math.max(0.5, v));
    try { localStorage.setItem(RATE_KEY, String(rate)); } catch (e) {}
    try { if (rrTtsAudio) rrTtsAudio.playbackRate = rate; } catch (e) {}
    render();
    if (playing && !paused) restartCurrentSentence();
  }

  // --- Piper voices ---------------------------------------------------------
  function fillVoices() {
    if (piperVoices.length) return;
    fetch("/api/tts/voices").then(function (r) { return r.json(); }).then(function (d) {
      piperVoices = (d.voices || []).map(function (voice) {
        return { id: String(voice.id || ""), label: String(voice.label || voice.id || "") };
      });
      render();
    }).catch(function () { /* keep the system default */ });
  }

  function render() {
    notifyReadAloudChange();
  }

  function mount() {
    // Only a closed reader should stop playback. During a page or section
    // change the engine briefly tears its iframe down, so a missing document
    // here is normal and must not be mistaken for the book being closed.
    var shell = document.querySelector(".reader-shell");
    if (!shell) {
      if (playing) stop();
      mountedShell = null;
      return;
    }
    if (mountedShell === shell) return;
    if (!reader()) return;               // no engine yet — wait, don't stop
    mountedShell = shell;
    fillVoices();
    render();
    scheduleWarmFirstSentence();
  }

  document.addEventListener("keydown", function (e) {
    if (!document.querySelector(".reader-shell")) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test((e.target || {}).tagName || "")) return;
    if (e.key === "l" || e.key === "L") { e.preventDefault(); toggle(); }
  });
  registerReadAloudEngine({
    getState: publicState,
    getVoices: getVoices,
    toggle: toggle,
    stop: stop,
    skip: skipSentence,
    adjustSleep: adjustSleepTime,
    setRate: setRate,
    setVoice: setVoice,
  });

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();
  document.addEventListener("touchmove", markManualScroll, { passive: true, capture: true });
  document.addEventListener("wheel", markManualScroll, { passive: true, capture: true });
  new MutationObserver(mount).observe(document.documentElement, { childList: true, subtree: true });
})();
