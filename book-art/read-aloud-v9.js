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
  var floatBtn = null;
  var rateBtn = null;
  var voiceSel = null;

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
            // foliate owns its scroller; ask it to bring the range into view.
            try { v.renderer.scrollToAnchor(range, false); } catch (e) { /* ignore */ }
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

    var scroller = doc.scrollingElement || doc.documentElement;
    if (scroller && scroller.scrollHeight > scroller.clientHeight + 4) {
      var mid = (doc.documentElement.clientHeight || 0) / 2 - rect.height / 2;
      try { scroller.scrollTo({ top: scroller.scrollTop + rect.top - mid, behavior: "auto" }); } catch (e) {}
      return;
    }
    if (!frame) return;
    var host = scrollableAncestor(frame);
    if (!host) return;
    var frameBox = frame.getBoundingClientRect();
    var hostBox = host === document.scrollingElement
      ? { top: 0, height: window.innerHeight }
      : host.getBoundingClientRect();
    var delta = (frameBox.top + rect.top) - (hostBox.top + hostBox.height / 2 - rect.height / 2);
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

  async function waitUntilVisible(state, range, timeout) {
    for (var waited = 0; waited < timeout; waited += TURN_SETTLE) {
      if (!playing) return false;
      if (isVisible(state, range)) return true;
      await sleep(TURN_SETTLE);
    }
    return isVisible(state, range);
  }

  async function bringIntoView(state, item) {
    if (isVisible(state, item.range)) return true;

    // Never scroll a paginated view: doing so fights the pagination engine and
    // was the source of both skipped text and visible bouncing on iOS.
    if (state.mode === "scroll" && state.reveal) {
      state.reveal(item.range);
      return waitUntilVisible(state, item.range, 280);
    }

    var turns = 0;
    var sig = signature(state.doc);
    while (playing && turns < MAX_TURNS && !isVisible(state, item.range)) {
      var beforeRect = rectKey(item.range);
      state.turn();
      await sleep(TURN_SETTLE);
      if (!playing) return false;
      var now = reader();
      if (!now || signature(now.doc) !== sig) return false;   // section changed
      var moved = false;
      for (var waited = TURN_SETTLE; waited < TURN_TIMEOUT; waited += TURN_SETTLE) {
        if (isVisible(state, item.range)) return true;
        if (rectKey(item.range) !== beforeRect) { moved = true; break; }
        await sleep(TURN_SETTLE);
        if (!playing) return false;
      }
      if (!moved && rectKey(item.range) === beforeRect) return false;
      turns += 1;
    }
    return isVisible(state, item.range);
  }

  function rectKey(range) {
    try { var r = range.getBoundingClientRect(); return Math.round(r.left) + ":" + Math.round(r.top); }
    catch (e) { return "?"; }
  }

  // --- the pump ------------------------------------------------------------
  async function step(mine) {
    if (!playing || mine !== epoch) return;

    var state = reader();
    if (!state) {                        // mid-transition: wait for the new view
      for (var tries = 0; tries < 16 && !state; tries += 1) {
        await sleep(160);
        if (!playing || mine !== epoch) return;
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

    var item = queue[cursor];
    var ok = await bringIntoView(state, item);
    if (!playing || mine !== epoch) return;
    if (!ok) { queueDoc = null; step(mine); return; }

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
      try { synth().cancel(); } catch (e) { /* ignore */ }
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
      if (!playing || mine !== epoch) return;
      var now = reader();
      if (now && signature(now.doc) !== before) {
        queueDoc = null;
        step(mine);
        return;
      }
    }
    stop();                                              // nothing left to read
  }

  function speak(text, mine, doc) {
    var utter = new SpeechSynthesisUtterance(text);
    utter.rate = rate;
    var lang = doc.documentElement && doc.documentElement.lang;
    if (lang) utter.lang = lang;
    var voice = chosenVoice();
    if (voice) { utter.voice = voice; utter.lang = voice.lang; }
    utter.onend = function () {
      if (!playing || mine !== epoch) return;            // a cancelled utterance
      cursor += 1;
      step(mine);
    };
    utter.onerror = function (event) {
      if (!playing || mine !== epoch) return;
      if (event.error === "interrupted" || event.error === "canceled") return;
      stop();
    };
    synth().speak(utter);
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
    try { synth().cancel(); } catch (e) { /* ignore */ }
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
    try { synth().cancel(); } catch (e) { /* ignore */ }
    render();
  }

  function cycleRate() {
    rate = RATES[(RATES.indexOf(rate) + 1) % RATES.length];
    try { localStorage.setItem(RATE_KEY, String(rate)); } catch (e) { /* ignore */ }
    render();
    if (playing && !paused) {            // re-speak the current sentence at the new speed
      epoch += 1;
      var mine = epoch;
      try { synth().cancel(); } catch (e) { /* ignore */ }
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
    var list = voiceList();
    // Resolve against this exact list. Safari may return newly-created voice
    // objects on each getVoices() call, so comparing an object obtained from a
    // separate call makes the working voice look like "Default voice".
    var savedUri = "", savedName = "", savedLang = "";
    try {
      savedUri = localStorage.getItem(VOICE_KEY) || "";
      savedName = localStorage.getItem(VOICE_NAME_KEY) || "";
      savedLang = localStorage.getItem(VOICE_LANG_KEY) || "";
    } catch (e) { /* private mode can block storage */ }
    var current = resolveVoice(list, savedUri, savedName, savedLang);
    voiceSel.innerHTML = "";
    var def = document.createElement("option");
    def.value = "";
    def.textContent = "Default voice";
    if (!current) def.selected = true;
    voiceSel.appendChild(def);
    for (var i = 0; i < list.length; i += 1) {
      var o = document.createElement("option");
      o.value = list[i].voiceURI || list[i].name;
      o.textContent = list[i].name;
      o.setAttribute("data-voice-name", list[i].name || "");
      o.setAttribute("data-voice-lang", list[i].lang || "");
      if (current === list[i]) o.selected = true;
      voiceSel.appendChild(o);
    }
    // Explicitly set the select value after all options exist. This also keeps
    // the visible label correct when iOS rebuilds its voice list asynchronously.
    voiceSel.value = current ? (current.voiceURI || current.name) : "";
  }

  // --- UI ------------------------------------------------------------------
  (function injectStyle() {
    var s = document.createElement("style");
    s.setAttribute("data-rr", "read-aloud");
    s.textContent = ".rr-rate{min-width:54px;font-variant-numeric:tabular-nums}" +
      ".rr-listen,.rr-rate{white-space:nowrap}" +
      ".rr-voice{max-width:150px}" +
      ".rr-read-toggle{position:fixed;right:18px;bottom:calc(78px + env(safe-area-inset-bottom));z-index:124;width:46px;height:46px;padding:0;border:1px solid rgba(70,70,67,.18);border-radius:50%;background:rgba(245,244,239,.9);color:#202321;box-shadow:0 3px 14px rgba(0,0,0,.12);font:600 17px/1 -apple-system,BlinkMacSystemFont,sans-serif;display:grid;place-items:center;-webkit-backdrop-filter:blur(18px);backdrop-filter:blur(18px);-webkit-tap-highlight-color:transparent}" +
      ".rr-read-toggle[hidden]{display:none!important}" +
      ".rr-theme-dark .rr-read-toggle{background:rgba(42,42,40,.9);color:#f7f5ef;border-color:rgba(255,255,255,.18)}";
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
    if (floatBtn) {
      floatBtn.hidden = !playing;
      floatBtn.textContent = paused ? "▶" : "❚❚";
      floatBtn.setAttribute("aria-label", paused ? "Resume read aloud" : "Pause read aloud");
      floatBtn.setAttribute("aria-pressed", paused ? "false" : "true");
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
      if (floatBtn) { floatBtn.remove(); floatBtn = null; }
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

    if (!floatBtn) {
      floatBtn = document.createElement("button");
      floatBtn.type = "button";
      floatBtn.className = "rr-read-toggle";
      floatBtn.hidden = true;
      floatBtn.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        toggle();
      });
      document.body.appendChild(floatBtn);
    }

    rateBtn = document.createElement("button");
    rateBtn.type = "button";
    rateBtn.className = "rr-rate";
    rateBtn.hidden = true;
    rateBtn.setAttribute("aria-label", "Reading speed");
    rateBtn.addEventListener("click", cycleRate);

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
        try { synth().cancel(); } catch (e) { /* ignore */ }
        setTimeout(function () { if (playing && !paused && mine === epoch) step(mine); }, 60);
      }
    });

    var close = actions.querySelector(".reader-close");
    var parts = [btn, rateBtn, voiceSel];
    for (var i = 0; i < parts.length; i += 1) {
      if (close) actions.insertBefore(parts[i], close); else actions.appendChild(parts[i]);
    }
    fillVoices();
    render();
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
  new MutationObserver(mount).observe(document.documentElement, { childList: true, subtree: true });
})();
