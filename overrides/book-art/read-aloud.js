// The Reading Room — read aloud.
//
// Works on both reading engines the app uses: epub.js (EPUB) and foliate
// (MOBI/AZW/AZW3/KF8). Rather than borrowing either library's own text
// iterator, this walks the rendered document itself, which is the only way to
// guarantee it reads the prose and nothing else — no running heads, footers,
// nav lists, page-number markers or footnotes.
//
// Highlighting uses the CSS Custom Highlight API where available, so nothing
// in the book's DOM is touched and pagination can't shift under the reader.
(function () {
  "use strict";

  var RATES = [0.8, 1, 1.2, 1.5, 2];
  var RATE_KEY = "reading-room-tts-rate";
  var VOICE_KEY = "reading-room-tts-voice";
  var VOICE_NAME_KEY = "reading-room-tts-voice-name";
  var VOICE_LANG_KEY = "reading-room-tts-voice-lang";
  var MAX_TURNS = 40;              // safety bound when chasing a sentence across pages
  var TURN_SETTLE = 70;            // poll interval while a page turn lands
  var TURN_TIMEOUT = 850;
  var MAX_CHARS = 220;             // short enough for reliable iOS Web Speech callbacks

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
  var btn = null;
  var floatTray = null;
  var floatBtn = null;
  var floatPrev = null;
  var floatNext = null;
  var followBtn = null;
  var rateBtn = null;
  var voiceSel = null;
  var timerBtn = null;
  var sleepMs = 0;    // remaining ms; 0 = no timer
  var sleepRef = null;
  var manualScrollUntil = 0;

  function markManualScroll() {
    if (playing && readingMode() === "scroll") manualScrollUntil = Date.now() + 5000;
  }

  function snapToSpokenSentence() {
    if (!playing || !queue.length) return;
    var state = reader();
    var item = queue[Math.min(cursor, queue.length - 1)];
    if (!state || !item || state.mode !== "scroll" || !state.reveal) return;
    manualScrollUntil = 0;
    // Only one call now. reveal() already re-measures on the next frame and
    // corrects itself, so the second call this used to make would run while that
    // correction was still pending and re-issue a scroll from a stale rect -
    // the two fought each other. Repeating a reveal is only idempotent if it is
    // a plain scroll; it no longer is.
    try { state.reveal(item.range); } catch (e) { /* nothing more to try */ }
  }

  var synth = function () { return window.speechSynthesis; };
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

    var scroller = doc.scrollingElement || doc.documentElement;
    if (scroller && scroller.scrollHeight > scroller.clientHeight + 4) {
      try { scroller.scrollTo({ top: scroller.scrollTop + rect.top - topPad, behavior: "auto" }); } catch (e) {}
      return;
    }
    if (!frame) return;
    var host = scrollableAncestor(frame);
    if (!host) return;
    var frameBox = frame.getBoundingClientRect();
    var hostTop = host === document.scrollingElement ? 0 : host.getBoundingClientRect().top;
    var delta = (frameBox.top + rect.top) - (hostTop + topPad);
    try { host.scrollBy({ top: delta, behavior: "auto" }); } catch (e) { host.scrollTop += delta; }
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
        if (range) out.push({ text: p.text, range: range });
      }
    }
    return out;
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
  var highlightName = "rr-reading";
  var hlObject = null;
  var hlWindow = null;

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
        var win = doc.defaultView;
        if (win && win.CSS && win.CSS.highlights) win.CSS.highlights.delete(highlightName);
        var sel = doc.getSelection && doc.getSelection();
        if (sel && sel.rangeCount) sel.removeAllRanges();
      } catch (e) { /* document torn down */ }
    }
    if (!except) { hlObject = null; hlWindow = null; }
  }

  function highlight(doc, range) {
    clearHighlights(doc);                       // wipe every other document
    try {
      var win = doc.defaultView;
      if (win && win.CSS && win.CSS.highlights && typeof win.Highlight === "function") {
        if (!doc.__rrHighlightStyle) {
          var st = doc.createElement("style");
          st.textContent = "::highlight(" + highlightName + "){background:rgba(129,147,135,.34)}";
          (doc.head || doc.body).appendChild(st);
          doc.__rrHighlightStyle = st;
        }
        if (hlWindow !== win || !hlObject) {
          hlObject = new win.Highlight();
          hlWindow = win;
        }
        if (typeof hlObject.clear === "function") hlObject.clear();
        else { hlObject = new win.Highlight(); hlWindow = win; }
        hlObject.add(range);
        win.CSS.highlights.set(highlightName, hlObject);
        return;
      }
      // Safari's Selection fallback can itself scroll the iframe on iOS. A
      // missing highlight is preferable to the text jumping under the reader.
      if (isAppleMobile()) return;
      var sel = doc.getSelection();
      if (sel) { sel.removeAllRanges(); sel.addRange(range); }
    } catch (e) {
      try { var s2 = doc.getSelection(); if (s2) { s2.removeAllRanges(); s2.addRange(range); } } catch (e2) { /* give up */ }
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

  // Visible AND still in the upper part of the reading area, so speaking on
  // will not run off the bottom. Anything lower triggers a reveal, which
  // top-aligns it.
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
      var limit = head + (window.innerHeight - head) * 0.5;
      return top >= head - 2 && bottom <= limit;
    }

    // foliate: the iframe is the visible page, so its viewport is correct.
    var doc = state.doc;
    var h = (doc && (doc.documentElement.clientHeight || doc.body.clientHeight)) || 0;
    if (!h) return true;
    return r.top >= -2 && r.bottom <= h * 0.55;
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
    // line still counts, so nothing scrolled until it had left the screen and
    // the next reveal then jumped a long way - which read as reverting to the
    // top. Keep the spoken line inside the upper band instead, so the text
    // moves up steadily as it is read.
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
      await sleep(TURN_SETTLE);
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
      if (!btn) return;                                   // reader not mounted
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
      try { if (rrTtsAudio) { rrTtsAudio.pause(); rrTtsAudio.removeAttribute('src'); rrTtsAudio.load(); } } catch (e) { /* ignore */ }
    try { if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'none'; } catch (e) {}
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

  // Warm the next sentence while the current one plays. Synthesis runs at
  // several times real time, so by the time it is needed it is on disk.
  function prefetch(mine) {
    // Six ahead, not two. Each /api/tts call is a synthesis round trip on the
    // Pi; two sentences of lead does not cover it at reading speed, so
    // playback stalled for several seconds every few sentences waiting for the
    // next clip. The responses are cached, so the extra warming is cheap.
    for (var n = 1; n <= 6; n += 1) {
      var next = queue[cursor + n];
      if (!next || !next.text) continue;
      var url = ttsUrl(next.text);
      if (rrPrefetch[url]) continue;
      rrPrefetch[url] = true;
      try { fetch(url, { cache: "force-cache" }).catch(function () {}); } catch (e) { /* ignore */ }
    }
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
    if (!item || !item.text) return;
    var url = ttsUrl(item.text);
    if (rrPrefetch[url]) return;
    rrPrefetch[url] = true;
    try { fetch(url, { cache: "force-cache" }).catch(function () {}); } catch (e) { /* ignore */ }
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
      cursor += 1;
      step(mine);
    };
    a.onerror = function () {
      if (!playing || mine !== epoch) return;
      // A sentence that will not synthesise must not end the session: skip it.
      cursor += 1;
      step(mine);
    };
    a.src = ttsUrl(text);
    mediaSession(doc);
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
  function sleepLabel() {
    if (!sleepMs) return "+30m";
    var mins = Math.ceil(sleepMs / 60000);
    if (mins >= 60) {
      var h = Math.floor(mins / 60), m = mins % 60;
      return m ? h + "h" + m + "m" : h + "h";
    }
    return mins + "m";
  }

  function renderTimer() {
    if (!timerBtn) return;
    timerBtn.textContent = sleepLabel();
    timerBtn.setAttribute("aria-label", sleepMs
      ? sleepLabel() + " remaining — tap to add 30 min"
      : "Sleep timer: tap to set 30 min");
    timerBtn.classList.toggle("rr-timer-active", sleepMs > 0);
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

  function addSleepSlot() { adjustSleepTime(30); }

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
    try { if (rrTtsAudio) { rrTtsAudio.pause(); rrTtsAudio.removeAttribute('src'); rrTtsAudio.load(); } } catch (e) { /* ignore */ }
    try { if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'none'; } catch (e) {}
    if (keepAlive) { clearInterval(keepAlive); keepAlive = null; }
    if (sweeper) { clearInterval(sweeper); sweeper = null; }
    clearHighlights();
    render();
  }

  // Rather than trusting speechSynthesis.pause()/resume(), stop the utterance
  // and re-speak the current sentence on resume. Deterministic everywhere, and
  // it costs at most a repeated sentence.
  function toggle() {
    if (!playing) { play(); return; }
    if (paused) {
      paused = false;
      epoch += 1;
      render();
      step(epoch);
      return;
    }
    paused = true;
    epoch += 1;
    try { if (rrTtsAudio) { rrTtsAudio.pause(); rrTtsAudio.removeAttribute('src'); rrTtsAudio.load(); } } catch (e) { /* ignore */ }
    try { if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'none'; } catch (e) {}
    render();
  }

  function haltCurrentAudio() {
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
    clearHighlights(state && state.doc);
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
  window.rrGetVoices = function () {
    if (!voiceSel) return [];
    return Array.prototype.map.call(voiceSel.options, function (opt) {
      return { label: opt.textContent, value: opt.value, current: opt.selected };
    });
  };
  window.rrSetVoice = function (value) {
    if (!voiceSel) return;
    voiceSel.value = value;
    // The change listener wired above is what persists the choice and restarts
    // the sentence, so dispatch rather than duplicating that logic here.
    voiceSel.dispatchEvent(new Event("change", { bubbles: true }));
  };

  window.rrToggleReadAloud = toggle;
  window.rrStopReadAloud = stop;
  window.rrSkipSentence = skipSentence;
  // Named wrappers. skipSentence already takes a direction, so previous needs no
  // new logic - only the legacy sheet knew to pass -1, which is why the React one
  // had no back button.
  window.rrNextSentence = function () { skipSentence(1); };
  window.rrPreviousSentence = function () { skipSentence(-1); };
  window.rrAddSleepTime = addSleepSlot;
  window.rrAdjustSleepTime = adjustSleepTime;
  window.rrGetReadAloudState = publicState;

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
  }
  window.rrSetReadingRate = setRate;
  window.rrGetReadingRate = function () { return rate; };

  function cycleRate() {
    rate = RATES[(RATES.indexOf(rate) + 1) % RATES.length];
    try { localStorage.setItem(RATE_KEY, String(rate)); } catch (e) { /* ignore */ }
    render();
    if (playing && !paused) {            // re-speak the current sentence at the new speed
      epoch += 1;
      var mine = epoch;
      try { if (rrTtsAudio) { rrTtsAudio.pause(); rrTtsAudio.removeAttribute('src'); rrTtsAudio.load(); } } catch (e) { /* ignore */ }
    try { if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'none'; } catch (e) {}
      setTimeout(function () { if (playing && !paused && mine === epoch) step(mine); }, 60);
    }
  }

  // --- voices ---------------------------------------------------------------
  // macOS ships plain voices by default; the good ones (Siri, Premium,
  // Enhanced) are optional downloads and only appear here once installed.
  function voiceList() {
    var all = [];
    try { all = synth().getVoices() || []; } catch (e) { return []; }
    var docLang = "en";
    var st = reader();
    if (st && st.doc.documentElement && st.doc.documentElement.lang) {
      docLang = st.doc.documentElement.lang.slice(0, 2);
    }
    var matching = all.filter(function (v) { return (v.lang || "").slice(0, 2) === docLang; });
    var pool = matching.length ? matching : all;
    var quality = /siri|premium|enhanced|natural|neural/i;
    return pool.slice().sort(function (a, b) {
      var qa = quality.test(a.name) ? 0 : 1, qb = quality.test(b.name) ? 0 : 1;
      if (qa !== qb) return qa - qb;
      if (a.localService !== b.localService) return a.localService ? -1 : 1;
      return (a.name || "").localeCompare(b.name || "");
    });
  }

  // Returns null unless you have explicitly chosen a voice — null means "let
  // the system use its default", which is what the browser did before any of
  // this existed and is a far safer starting point than guessing.
  function chosenVoice() {
    var uri = null, name = null, lang = null;
    try {
      uri = localStorage.getItem(VOICE_KEY);
      name = localStorage.getItem(VOICE_NAME_KEY);
      lang = localStorage.getItem(VOICE_LANG_KEY);
    } catch (e) { /* ignore */ }
    if (!uri && !name) return null;
    return resolveVoice(voiceList(), uri, name, lang);
  }

  function fillVoices() {
    if (!voiceSel) return;
    // Piper's voices, from the server. Populated once and cached; the list
    // only changes when a voice file is added to the Pi.
    var saved = "";
    try { saved = localStorage.getItem("reading-room-voice") || ""; } catch (e) {}
    if (!voiceSel.dataset.rrWired) {
      voiceSel.dataset.rrWired = "1";
      voiceSel.addEventListener("change", function () {
        try { localStorage.setItem("reading-room-voice", voiceSel.value); } catch (e) {}
        // Cached audio is keyed by voice, so a change takes effect on the next
        // sentence with no further bookkeeping.
        scheduleWarmFirstSentence(40);
      });
    }
    if (voiceSel.options.length < 2) {
      fetch("/api/tts/voices").then(function (r) { return r.json(); }).then(function (d) {
        voiceSel.innerHTML = "";
        (d.voices || []).forEach(function (v) {
          var o = document.createElement("option");
          o.value = v.id;
          o.textContent = v.label;
          if (v.id === saved) o.selected = true;
          voiceSel.appendChild(o);
        });
        if (saved) voiceSel.value = saved;
      }).catch(function () { /* leave whatever is there */ });
    }
  }

  // --- UI ------------------------------------------------------------------
  function transportIcon(path) {
    return '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" style="width:20px;height:20px">' + path + '</svg>';
  }

  (function injectStyle() {
    var s = document.createElement("style");
    s.setAttribute("data-rr", "read-aloud");
    s.textContent = ".rr-rate{min-width:54px;font-variant-numeric:tabular-nums}" +
      ".rr-listen,.rr-rate{white-space:nowrap}" +
      ".rr-voice{max-width:150px}" +
      ".rr-timer{min-width:44px;font-variant-numeric:tabular-nums;white-space:nowrap;transition:color .2s}" +
      ".rr-timer.rr-timer-active{color:var(--rr-timer-ink,#5a7c62)}" +
      ".rr-theme-dark .rr-timer.rr-timer-active{color:var(--rr-timer-ink-dark,#85b892)}" +
      ".rr-read-transport{position:fixed;right:15px;bottom:calc(78px + env(safe-area-inset-bottom));z-index:124;display:flex;flex-direction:column;align-items:center;gap:2px;padding:4px;border:1px solid rgba(70,70,67,.16);border-radius:25px;background:rgba(245,244,239,.88);color:#202321;box-shadow:0 4px 18px rgba(0,0,0,.13);-webkit-backdrop-filter:blur(20px) saturate(1.25);backdrop-filter:blur(20px) saturate(1.25);opacity:0;pointer-events:none;transform:translateY(18px) scale(.88);transform-origin:bottom center;transition:opacity .28s linear,transform .46s cubic-bezier(.16,1,.3,1);transition-timing-function:linear,linear(0,.03,.11,.23,.37,.52,.66,.78,.87,.93,.97,.99,1)}" +
      ".rr-read-transport.rr-visible{opacity:1;pointer-events:auto;transform:translateY(0) scale(1)}" +
      ".rr-read-transport button{width:40px;height:40px;padding:0;border:0;border-radius:50%;background:transparent;color:inherit;display:grid;place-items:center;font:600 16px/1 -apple-system,BlinkMacSystemFont,sans-serif;-webkit-tap-highlight-color:transparent}" +
      ".rr-read-transport button:active{background:rgba(90,90,90,.14);transform:scale(.94)}" +
      ".rr-read-transport button:disabled{opacity:.28}" +
      ".rr-read-transport .rr-read-toggle{width:44px;height:44px;background:rgba(255,255,255,.72);box-shadow:0 1px 5px rgba(0,0,0,.09)}" +
      ".rr-theme-dark .rr-read-transport,html.rr-reader-dark .rr-read-transport{background:rgba(42,42,40,.88);color:#f7f5ef;border-color:rgba(255,255,255,.16)}" +
      ".rr-theme-dark .rr-read-transport .rr-read-toggle,html.rr-reader-dark .rr-read-transport .rr-read-toggle{background:rgba(255,255,255,.10)}" +
      ".rr-read-follow{position:fixed;right:70px;bottom:calc(92px + env(safe-area-inset-bottom));z-index:124;width:46px;height:46px;border:1px solid rgba(70,70,67,.16);border-radius:50%;display:grid;place-items:center;background:rgba(245,244,239,.72);color:#202321;box-shadow:0 5px 20px rgba(0,0,0,.13);-webkit-backdrop-filter:blur(22px) saturate(1.35);backdrop-filter:blur(22px) saturate(1.35);opacity:0;pointer-events:none;transform:translateX(16px) scale(.82);transform-origin:right center;transition:opacity .28s linear,transform .46s cubic-bezier(.16,1,.3,1);transition-timing-function:linear,linear(0,.03,.11,.23,.37,.52,.66,.78,.87,.93,.97,.99,1)}" +
      ".rr-read-follow.rr-visible{opacity:1;pointer-events:auto;transform:translateX(0) scale(1)}" +
      ".rr-theme-dark .rr-read-follow,html.rr-reader-dark .rr-read-follow{background:rgba(42,42,40,.76);color:#f7f5ef;border-color:rgba(255,255,255,.16)}" +
      "@media(prefers-reduced-motion:reduce){.rr-read-transport,.rr-read-follow{transition:opacity .12s linear;transform:none!important}}";
    document.head.appendChild(s);
  })();

  function render() {
    if (!btn) return;
    var active = playing && !paused;
    btn.className = "rr-listen" + (active ? " active" : "");
    btn.setAttribute("aria-pressed", active ? "true" : "false");
    btn.innerHTML = active
      ? "❚❚ <span class=\"reader-action-label\">Pause</span>"
      : "▶ <span class=\"reader-action-label\">Listen</span>";
    rateBtn.hidden = !playing;
    rateBtn.textContent = rate.toFixed(1) + "×";
    if (timerBtn) { timerBtn.hidden = !playing; renderTimer(); }
    if (floatBtn) {
      if (floatTray) {
        floatTray.hidden = false;
        floatTray.classList.toggle("rr-visible", playing);
        floatTray.setAttribute("aria-hidden", playing ? "false" : "true");
      }
      floatBtn.innerHTML = paused
        ? transportIcon('<path d="M8 5v14l11-7Z" fill="currentColor" stroke="none"/>')
        : transportIcon('<path d="M8 5v14M16 5v14"/>');
      floatBtn.setAttribute("aria-label", paused ? "Resume read aloud" : "Pause read aloud");
      floatBtn.setAttribute("aria-pressed", paused ? "false" : "true");
    }
    if (floatPrev) floatPrev.disabled = !playing || cursor <= 0;
    if (floatNext) floatNext.disabled = !playing || !queue.length;
    if (followBtn) {
      var canFollow = playing && readingMode() === "scroll" && queue.length > 0;
      followBtn.classList.toggle("rr-visible", canFollow);
      followBtn.setAttribute("aria-hidden", canFollow ? "false" : "true");
    }
    if (voiceSel) {
      // Voices arrive asynchronously in some browsers, so keep trying to fill
      // the menu; show it whenever the reader is open, not only while playing.
      if (voiceSel.options.length <= 1) fillVoices();
      voiceSel.hidden = false;
    }
  }

  function mount() {
    // Only a closed reader should stop playback. During a page or section
    // change the engine briefly tears its iframe down, so a missing document
    // here is normal and must not be mistaken for the book being closed.
    var shell = document.querySelector(".reader-shell");
    if (!shell) {
      if (playing) stop();
      if (floatTray) { floatTray.remove(); floatTray = null; }
      if (followBtn) { followBtn.remove(); followBtn = null; }
      floatBtn = null; floatPrev = null; floatNext = null;
      btn = null; rateBtn = null;
      return;
    }
    var actions = shell.querySelector(".reader-actions");
    if (!actions) return;
    if (btn && actions.contains(btn)) return;
    if (!reader()) return;               // no engine yet — wait, don't stop

    btn = document.createElement("button");
    btn.type = "button";
    btn.setAttribute("aria-label", "Read aloud");
    btn.addEventListener("click", toggle);

    if (!floatTray) {
      floatTray = document.createElement("div");
      floatTray.className = "rr-read-transport";
      floatTray.setAttribute("role", "group");
      floatTray.setAttribute("aria-label", "Read aloud controls");
      floatTray.hidden = true;

      floatPrev = document.createElement("button");
      floatPrev.type = "button";
      floatPrev.innerHTML = transportIcon('<path d="M6 5v14"/><path d="m17 6-7 6 7 6"/>');
      floatPrev.setAttribute("aria-label", "Previous sentence");
      floatPrev.addEventListener("click", function (event) {
        event.preventDefault(); event.stopPropagation();
        window.__rrControlTapAt = Date.now();
        skipSentence(-1);
      });

      floatBtn = document.createElement("button");
      floatBtn.type = "button";
      floatBtn.className = "rr-read-toggle";
      floatBtn.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        window.__rrControlTapAt = Date.now();
        toggle();
      });

      floatNext = document.createElement("button");
      floatNext.type = "button";
      floatNext.innerHTML = transportIcon('<path d="M18 5v14"/><path d="m7 6 7 6-7 6"/>');
      floatNext.setAttribute("aria-label", "Next sentence");
      floatNext.addEventListener("click", function (event) {
        event.preventDefault(); event.stopPropagation();
        window.__rrControlTapAt = Date.now();
        skipSentence(1);
      });

      floatTray.append(floatPrev, floatBtn, floatNext);
      document.body.appendChild(floatTray);

      followBtn = document.createElement("button");
      followBtn.type = "button";
      followBtn.className = "rr-read-follow";
      followBtn.setAttribute("aria-label", "Return to the sentence being read");
      followBtn.setAttribute("aria-hidden", "true");
      followBtn.innerHTML = transportIcon('<path d="M12 4v14"/><path d="m6.5 12.5 5.5 5.5 5.5-5.5"/>');
      followBtn.addEventListener("click", function (event) {
        event.preventDefault(); event.stopPropagation();
        window.__rrControlTapAt = Date.now();
        snapToSpokenSentence();
      });
      document.body.appendChild(followBtn);
    }

    rateBtn = document.createElement("button");
    rateBtn.type = "button";
    rateBtn.className = "rr-rate";
    rateBtn.hidden = true;
    rateBtn.setAttribute("aria-label", "Reading speed");
    rateBtn.addEventListener("click", cycleRate);

    timerBtn = document.createElement("button");
    timerBtn.type = "button";
    timerBtn.className = "rr-timer";
    timerBtn.hidden = true;
    renderTimer();
    timerBtn.addEventListener("click", addSleepSlot);

    voiceSel = document.createElement("select");
    voiceSel.className = "rr-voice";
    voiceSel.setAttribute("aria-label", "Voice");
    voiceSel.addEventListener("change", function () {
      var selected = voiceSel.options[voiceSel.selectedIndex];
      try {
        localStorage.setItem(VOICE_KEY, voiceSel.value);
        if (voiceSel.value && selected) {
          localStorage.setItem(VOICE_NAME_KEY, selected.getAttribute("data-voice-name") || selected.textContent || "");
          localStorage.setItem(VOICE_LANG_KEY, selected.getAttribute("data-voice-lang") || "");
        } else {
          localStorage.removeItem(VOICE_NAME_KEY);
          localStorage.removeItem(VOICE_LANG_KEY);
        }
      } catch (e) { /* ignore */ }
      if (playing && !paused) {                 // re-speak this sentence in the new voice
        epoch += 1;
        var mine = epoch;
        try { if (rrTtsAudio) { rrTtsAudio.pause(); rrTtsAudio.removeAttribute('src'); rrTtsAudio.load(); } } catch (e) { /* ignore */ }
    try { if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'none'; } catch (e) {}
        setTimeout(function () { if (playing && !paused && mine === epoch) step(mine); }, 60);
      }
    });

    var close = actions.querySelector(".reader-close");
    var parts = [btn, rateBtn, timerBtn, voiceSel];
    for (var i = 0; i < parts.length; i += 1) {
      if (close) actions.insertBefore(parts[i], close); else actions.appendChild(parts[i]);
    }
    fillVoices();
    render();
    scheduleWarmFirstSentence();
  }

  document.addEventListener("keydown", function (e) {
    if (!document.querySelector(".reader-shell")) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test((e.target || {}).tagName || "")) return;
    if (e.key === "l" || e.key === "L") { e.preventDefault(); toggle(); }
  });
  window.addEventListener("beforeunload", function () { try { synth().cancel(); } catch (e) {} });

  try { synth().addEventListener("voiceschanged", function () { fillVoices(); render(); }); } catch (e) { /* ignore */ }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();
  document.addEventListener("touchmove", markManualScroll, { passive: true, capture: true });
  document.addEventListener("wheel", markManualScroll, { passive: true, capture: true });
  new MutationObserver(mount).observe(document.documentElement, { childList: true, subtree: true });
})();
