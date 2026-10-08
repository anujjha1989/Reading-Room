import { notifyReadAloudChange, registerReadAloudEngine } from "./readAloudController";
import { type EpubOffscreenSection, getEpubNarrationAdapter, visibleEpubNarrationTarget } from "./epubNarration";

type NarrationDocument = Document & {
  __rrSteering?: boolean;
  caretRangeFromPoint?: (x: number, y: number) => Range | null;
  caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
};
type FoliateRenderer = {
  getContents: () => Array<{ doc: NarrationDocument }>;
  scrollToAnchor: (range: Range, animate: boolean) => Promise<unknown> | void;
  shadowRoot?: ShadowRoot;
};
type FoliateView = Element & { renderer?: FoliateRenderer; next: () => void | Promise<void> };
type ReaderState = {
  doc: NarrationDocument;
  mode: "scroll" | "pages";
  frame?: HTMLIFrameElement;
  visible: (range: Range) => boolean;
  turn: () => void | Promise<void>;
  reveal: (range: Range) => void;
};
type Block = { block: Element; nodes: Array<{ node: Text; at: number }>; text: string };
type QueueItem = { text: string; range: Range; block: Block; at: number; end: number; startupReady?: boolean };
type PiperVoice = { id: string; label: string; speed?: string };
type SpeechPiece = { text: string; at: number; end: number };
type HighlightLine = { left: number; right: number; top: number; bottom: number };
type TestWindow = Window & typeof globalThis & {
  __rrControlTapAt?: number;
  __RR_TTS_TEST_ONLY__?: boolean;
  __RR_TTS_TEST_API__?: object;
};

// Home Books — read aloud.
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
  // This client module is also imported while vinext renders HTML on the server.
  if (typeof window === "undefined") return;
  const testWindow = window as TestWindow;

  var RATES = [0.8, 1, 1.2, 1.5, 2];
  var RATE_KEY = "reading-room-tts-rate";
  var MAX_TURNS = 40;              // safety bound when chasing a sentence across pages
  var TURN_SETTLE = 70;            // poll interval while a page turn lands
  var TURN_TIMEOUT = 850;
  var PAGE_TURN_SETTLE = 520;      // one animated turn must finish before another can begin
  var STALL_TIMEOUT = 9000;
  var LOAD_TIMEOUT = 25000;       // an uncached high-quality voice may need synthesis first
  var MAX_CHARS = 220;             // short enough for reliable iOS Web Speech callbacks
  var STARTUP_CHARS = 80;          // quick first sound while the longer queue warms behind it

  // Anything matching these is furniture, not the novel. Checked in JS rather
  // than with a CSS selector because epub.js parses the document as HTML (where
  // the attribute is literally "epub:type") while foliate parses it as XML
  // (where it is namespaced) — a selector only ever catches one of the two.
  var OPS_NS = "http://www.idpf.org/2007/ops";
  var FURNITURE_TAGS = /^(header|footer|nav|script|style|noscript|svg|figcaption)$/;
  var FURNITURE_TYPES = /\b(pagebreak|page-list|pagelist|footnote|footnotes|endnote|endnotes|noteref|toc|landmarks|titlepage|colophon)\b/i;

  function isFurniture(el: Element) {
    for (var n: Element | null = el; n && n.nodeType === 1; n = n.parentElement) {
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
    var savedRate = parseFloat(localStorage.getItem(RATE_KEY) || "");
    if (RATES.indexOf(savedRate) !== -1) rate = savedRate;
  } catch (e) { /* private mode */ }

  var playing = false;
  var paused = false;          // our own flag: speechSynthesis.pause() is unreliable, especially in Safari
  var epoch = 0;                   // invalidates callbacks from cancelled utterances
  var queue: QueueItem[] = [];     // current rendered document
  var cursor = 0;
  var queueDoc: string | null = null;
  var queueDocument: NarrationDocument | null = null;
  // A chapter narration reached while the screen was off: its text was loaded
  // straight from the book and has not been drawn. Cleared once it is on screen.
  var detached: EpubOffscreenSection | null = null;
  var playbackError: string | undefined;
  var keepAlive: ReturnType<typeof setInterval> | null = null;
  var sweeper: ReturnType<typeof setInterval> | null = null;
  var mountedShell: Element | null = null;
  var piperVoices: PiperVoice[] = [];
  var sleepMs = 0;    // remaining ms; 0 = no timer
  var sleepRef: ReturnType<typeof setInterval> | null = null;
  var manualScrollUntil = 0;

  function markManualScroll() {
    if (playing && readingMode() === "scroll") manualScrollUntil = Date.now() + 5000;
  }

  var sleep = function (ms: number) { return new Promise<void>(function (r) { setTimeout(r, ms); }); };

  function readingMode(): "scroll" | "pages" {
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

  function isControlTap(now: number) {
    var at = Number(testWindow.__rrControlTapAt || 0);
    return at > 0 && now - at >= 0 && now - at < 800;
  }

  function ignoreSteeringClick(active: boolean, now: number) {
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
  function scrollContainerBy(renderer: FoliateRenderer, delta: number) {
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
  function reader(): ReaderState | null {
    // A chapter reached with the screen off is read from its loaded text,
    // whichever engine (EPUB or MOBI) will draw it later.
    if (detached && playing) {
      return { doc: detached.doc as NarrationDocument, mode: readingMode(),
        visible: () => true, turn: () => undefined, reveal: () => undefined };
    }
    var v = document.querySelector<FoliateView>("foliate-view");
    if (v && v.renderer && typeof v.renderer.getContents === "function") {
      var c = v.renderer.getContents()[0];
      if (c && c.doc && c.doc.body) {
        // In pages mode foliate's iframe is the visible page, so its own
        // viewport is the frame of reference. In scroll mode the iframe is as
        // tall as the whole chapter and foliate's container scrolls it, so
        // everything looked "visible" from inside, no follow-scroll ever
        // fired and the highlight ran off the bottom of the screen. Scroll
        // mode is judged against the window instead, as EPUBs are.
        var foliateFrame: HTMLIFrameElement | null = null;
        if (readingMode() === "scroll") {
          try { foliateFrame = (c.doc.defaultView && c.doc.defaultView.frameElement) as HTMLIFrameElement | null; } catch (e) { foliateFrame = null; }
        }
        return {
          doc: c.doc,
          mode: readingMode(),
          frame: foliateFrame || undefined,
          visible: function (range: Range) { return foliateFrame ? visibleInHost(foliateFrame, range) : visibleInDoc(c.doc, range); },
          turn: function () { return v!.next(); },
          reveal: function (range: Range) {
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
            var renderer = v!.renderer!;
            try {
              var p = renderer.scrollToAnchor(range, false);
              if (p && typeof p.catch === "function") p.catch(function () {});
            } catch (e) { /* fall through to the measured fallback */ }

            requestAnimationFrame(function () {
              var rect, offset = 0;
              try {
                rect = range.getBoundingClientRect();
                // Where the sentence sits on the screen, not inside the chapter.
                if (foliateFrame) offset = foliateFrame.getBoundingClientRect().top;
              } catch (e) { return; }
              if (!rect || (!rect.height && !rect.width)) return;
              var wanted = followTop(), top = rect.top + offset;
              // Already within a sensible band: leave it alone rather than
              // fighting foliate's own scrolling.
              if (Math.abs(top - wanted) <= 24) return;
              scrollContainerBy(renderer, top - wanted);
            });
          },
        };
      }
    }
    const adapter = getEpubNarrationAdapter();
    if (adapter) {
      const targets = adapter.targets();
      // Keep the sentence queue attached to its chapter while adjacent frames
      // mount/unmount. A newly loaded taller chapter must not steal narration.
      const queuedDoc = queue[cursor]?.range.startContainer.ownerDocument
        ?? queue[queue.length - 1]?.range.startContainer.ownerDocument ?? queueDocument;
      const target = playing && queueDoc && queuedDoc
        ? targets.find(item => item.doc === queuedDoc) ?? visibleEpubNarrationTarget(targets, headerBottom(), window.innerHeight)
        : visibleEpubNarrationTarget(targets, headerBottom(), window.innerHeight);
      if (!target) return null;
      return { doc: target.doc as NarrationDocument, frame: target.frame, mode: readingMode(),
        visible: range => visibleInHost(target.frame, range), turn: turnWithFooter,
        reveal: range => revealInFrame(target.doc as NarrationDocument, target.frame, range) };
    }
    // Compatibility path when no reader-owned adapter is registered.
    var frames = document.querySelectorAll<HTMLIFrameElement>(".epub-viewer iframe");
    var best: NarrationDocument | null = null, bestFrame: HTMLIFrameElement | null = null, bestArea = 0;
    for (var i = 0; i < frames.length; i += 1) {
      var doc = null;
      try { doc = frames[i].contentDocument; } catch (e) { doc = null; }
      if (!doc || !doc.body || !doc.body.textContent.trim()) continue;
      var box = frames[i].getBoundingClientRect();
      var area = box.width * Math.max(0, Math.min(window.innerHeight, box.bottom) - Math.max(headerBottom(), box.top));
      if (area > bestArea) { bestArea = area; best = doc; bestFrame = frames[i]; }
    }
    if (best) {
      return {
        doc: best,
        mode: readingMode(),
        frame: bestFrame!,
        // In scrolled mode epub.js makes the iframe as tall as the entire
        // chapter, so everything looks "visible" from inside it. Judge against
        // the window instead, allowing for the sticky toolbar.
        visible: function (range: Range) { return visibleInHost(bestFrame!, range); },
        turn: turnWithFooter,
        reveal: function (range: Range) { revealInFrame(best!, bestFrame!, range); },
      };
    }
    return null;
  }

  // epub.js in scrolled mode puts the whole section in a tall iframe and lets
  // the host page scroll, so the range has to be mapped into host coordinates.
  function revealInFrame(doc: NarrationDocument, frame: HTMLIFrameElement, range: Range) {
    var rect;
    try { rect = range.getBoundingClientRect(); } catch (e) { return; }
    if (!rect) return;

    // Scroll so the highlighted sentence appears near the top of the viewport,
    // just below the reader header, rather than at the centre. This prevents
    // the "reverts to top" effect: centering a range that has gone off the
    // bottom produces a large backwards scroll; top-aligning it does not.
    var topPad = followTop();

    // Set scrollTop directly rather than trusting Element.scrollTo/scrollBy.
    // Mobile Safari exposes both methods on several EPUB wrapper elements but
    // can accept the call without moving them. Direct assignment is observable
    // and lets the next-frame correction below measure the actual result.
    function moveScroller(scroller: Element | null, delta: number) {
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
    if (!frame || !host || !hostScrolls) return;
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
        nextHostTop = host === document.scrollingElement ? 0 : host!.getBoundingClientRect().top;
      } catch (e) { return; }
      if (!after) return;
      moveScroller(host, (nextFrameBox.top + after.top) - (nextHostTop + topPad));
    });
  }

  function scrollableAncestor(el: Element): Element {
    for (var n = el.parentElement; n; n = n.parentElement) {
      var st = getComputedStyle(n);
      if (/(auto|scroll)/.test(st.overflowY) && n.scrollHeight > n.clientHeight + 4) return n;
    }
    return document.scrollingElement || document.documentElement;
  }

  // Identity is unreliable across an iframe swap, so compare what is in the
  // document rather than which object it is.
  function signature(doc: NarrationDocument | null) {
    if (!doc || !doc.body) return "";
    return (doc.title || "") + "|" + (doc.body.textContent || "").replace(/\s+/g, " ").trim().slice(0, 120);
  }

  function turnWithFooter() {
    var buttons = document.querySelectorAll<HTMLButtonElement>(".reader-footer button");
    var next = buttons[buttons.length - 1];
    if (next && !next.disabled) next.click();
  }

  // --- collect the prose, in order -----------------------------------------
  function speechChunks(text: string, lang: string, limit: number, keepLines?: boolean): SpeechPiece[] {
    // Many EPUBs hard-wrap their source every ~80 characters. Those newlines
    // are ordinary spaces on the page, but a sentence segmenter treats each as
    // the end of a sentence and the voice engine pauses on it, so narration
    // broke wherever the file happened to wrap. Swap them one-for-one (offsets
    // must not move) unless the block really displays its line breaks.
    if (!keepLines) text = text.replace(/[\t\n\r\f\v\u2028\u2029]/g, " ");
    var sentences: Array<{ text: string; at: number }> = [], segmenter: Intl.Segmenter | null = null;
    try { segmenter = new Intl.Segmenter(lang || "en", { granularity: "sentence" }); } catch (e) { segmenter = null; }
    if (segmenter) {
      for (var seg of segmenter.segment(text)) sentences.push({ text: seg.segment, at: seg.index });
    } else {
      var re = /[^.!?]+(?:[.!?]+[\s]*|$)/g, match: RegExpExecArray | null;
      while ((match = re.exec(text))) sentences.push({ text: match[0], at: match.index });
      if (!sentences.length && text) sentences.push({ text: text, at: 0 });
    }

    var pieces: Array<{ text: string; at: number }> = [];
    for (var i = 0; i < sentences.length; i += 1) {
      var sentence = sentences[i], pos = 0;
      while (sentence.text.length - pos > limit) {
        var cut = pos + limit;
        var windowText = sentence.text.slice(pos, cut + 1);
        // A sentence too long for one clip is cut at the last pause a reader
        // would make anyway - comma, semicolon, colon or dash - and only
        // between two plain words when the whole window has no such pause.
        var pause = /[,;:\u2014\u2013]["'\u201d\u2019)]*(?=\s|[^\s\d])\s*/g, hit: RegExpExecArray | null, punctuation = -1;
        while ((hit = pause.exec(windowText))) {
          var after = hit.index + hit[0].length;
          if (after <= limit && after > limit * 0.3) punctuation = after;
        }
        var space = windowText.lastIndexOf(" ");
        var localCut = punctuation > 0 ? punctuation : space > limit * 0.55 ? space + 1 : limit;
        pieces.push({ text: sentence.text.slice(pos, pos + localCut), at: sentence.at + pos });
        pos += localCut;
      }
      if (sentence.text.slice(pos)) pieces.push({ text: sentence.text.slice(pos), at: sentence.at + pos });
    }

    // Join adjacent short sentences from the same paragraph. This removes the
    // audible pause Safari inserts between one-utterance-per-sentence calls.
    var out: SpeechPiece[] = [];
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
  function resolveVoice(list: SpeechSynthesisVoice[], uri: string | null, name: string | null, lang: string | null) {
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

  if (testWindow.__RR_TTS_TEST_ONLY__) {
    testWindow.__RR_TTS_TEST_API__ = { speechChunks: speechChunks, startupSplitOffset: startupSplitOffset, resolveVoice: resolveVoice, isAppleMobile: isAppleMobile, isControlTap: isControlTap, ignoreSteeringClick: ignoreSteeringClick, testWindow: window };
    return;
  }

  function collect(doc: NarrationDocument): QueueItem[] {
    var out: QueueItem[] = [];
    var lang = (doc.documentElement && doc.documentElement.lang) || "en";

    var walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node: Node) {
        if (node.nodeType !== Node.TEXT_NODE) return NodeFilter.FILTER_REJECT;
        const textNode = node as Text;
        if (!textNode.data || !textNode.data.trim()) return NodeFilter.FILTER_REJECT;
        var el = node.parentElement;
        if (!el) return NodeFilter.FILTER_REJECT;
        if (isFurniture(el)) return NodeFilter.FILTER_REJECT;
        var style = doc.defaultView?.getComputedStyle(el);
        if (style && (style.display === "none" || style.visibility === "hidden")) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });

    // Group text nodes by their nearest block ancestor so sentences don't run
    // across paragraph boundaries.
    var blocks: Block[] = [];
    var current: Block | null = null;
    var node: Node | null;
    while ((node = walker.nextNode())) {
      if (node.nodeType !== Node.TEXT_NODE || !node.parentElement) continue;
      const textNode = node as Text;
      var block = node.parentElement.closest("p,h1,h2,h3,h4,h5,h6,li,blockquote,dd,dt,td,th,pre,section,div,body") || doc.body;
      if (!current || current.block !== block) {
        current = { block: block, nodes: [], text: "" };
        blocks.push(current);
      }
      current.nodes.push({ node: textNode, at: current.text.length });
      current.text += textNode.data;
    }

    for (var i = 0; i < blocks.length; i += 1) {
      var b = blocks[i];
      if (!isProse(b.text)) continue;
      var blockSpace = doc.defaultView?.getComputedStyle(b.block).whiteSpace || "";
      var pieces = speechChunks(b.text, lang, MAX_CHARS, /^(pre|break-spaces)/.test(blockSpace));
      for (var j = 0; j < pieces.length; j += 1) {
        var p = pieces[j];
        if (!p.text.trim()) continue;
        var range = rangeFor(doc, b, p.at, p.end);
        if (range) out.push({ text: p.text, range: range, block: b, at: p.at, end: p.end });
      }
    }
    return out;
  }

  // A short first clip can reduce startup latency, but cutting at an arbitrary
  // word makes an audible break in the middle of a sentence. Only split at a
  // natural phrase boundary; otherwise keep the full sentence intact.
  function startupSplitOffset(text: string, limit: number) {
    var boundary = /[.!?;:](?:["'”’)]*)\s+/g;
    var cut = -1, match: RegExpExecArray | null;
    while ((match = boundary.exec(text)) && match.index < limit) {
      var end = match.index + match[0].length;
      if (end >= 20 && end < text.length && end <= limit) cut = end;
    }
    return cut;
  }

  function prepareStartupClip(doc: NarrationDocument, index: number) {
    var item = queue[index];
    if (!item || item.startupReady || item.text.length <= STARTUP_CHARS || !item.block) return;
    var cut = startupSplitOffset(item.text, STARTUP_CHARS);
    if (cut <= 0 || cut >= item.text.length) return;
    var middle = item.at + cut;
    var firstRange = rangeFor(doc, item.block, item.at, middle);
    var restRange = rangeFor(doc, item.block, middle, item.end);
    if (!firstRange || !restRange) return;
    queue.splice(index, 1,
      { text: item.text.slice(0, cut), range: firstRange, block: item.block, at: item.at, end: middle, startupReady: true },
      { text: item.text.slice(cut), range: restRange, block: item.block, at: middle, end: item.end, startupReady: true });
  }

  function rangeFor(doc: NarrationDocument, block: Block, start: number, end: number): Range | null {
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

  function locate(block: Block, index: number): { node: Text; offset: number } | null {
    for (var i = 0; i < block.nodes.length; i += 1) {
      var entry = block.nodes[i];
      var len = entry.node.data.length;
      if (index <= entry.at + len) return { node: entry.node, offset: Math.max(0, index - entry.at) };
    }
    var last = block.nodes[block.nodes.length - 1];
    return last ? { node: last.node, offset: last.node.data.length } : null;
  }

  function isProse(text: string) {
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
  function allDocs(): NarrationDocument[] {
    var out: NarrationDocument[] = [];
    var view = document.querySelector<FoliateView>("foliate-view");
    if (view && view.renderer && typeof view.renderer.getContents === "function") {
      try {
        var contents = view.renderer.getContents() || [];
        for (var i = 0; i < contents.length; i += 1) if (contents[i] && contents[i].doc) out.push(contents[i].doc);
      } catch (e) { /* not ready */ }
    }
    var frames = document.querySelectorAll<HTMLIFrameElement>(".epub-viewer iframe");
    for (var j = 0; j < frames.length; j += 1) {
      try { if (frames[j].contentDocument) out.push(frames[j].contentDocument as NarrationDocument); } catch (e) { /* ignore */ }
    }
    return out;
  }

  function clearHighlights(except?: NarrationDocument) {
    var docs = allDocs();
    for (var i = 0; i < docs.length; i += 1) {
      var doc = docs[i];
      if (except && doc === except) continue;
      try {
        var overlays = doc.querySelectorAll && doc.querySelectorAll(".rr-reading-highlight-overlay");
        for (var j = 0; overlays && j < overlays.length; j += 1) overlays[j].remove();
        // Narration draws overlays now, not a DOM selection, so a reader's own
        // text selection (to highlight or look up) is left alone.
      } catch (e) { /* document torn down */ }
    }
  }

  function highlight(doc: NarrationDocument, range: Range) {
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
      var rects = Array.from(range.getClientRects()).filter(function (rect) {
        return rect.width > 0 && rect.height > 0;
      }).sort(function (a, b) { return a.top - b.top || a.left - b.left; });
      if (!rects.length) return;
      var lines: HighlightLine[] = [];
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

  // Narration follows the text inside one band: the same clear gap below the
  // notch (or header) as above the Home indicator. A sentence is brought to
  // the top edge of the band, and the page moves on only when the sentence
  // being read would cross its bottom edge.
  var FOLLOW_GAP = 24;
  var insetProbe: HTMLElement | null = null;
  function safeInset(side: "top" | "bottom") {
    try {
      if (!insetProbe || !insetProbe.isConnected) {
        insetProbe = document.createElement("div");
        insetProbe.setAttribute("aria-hidden", "true");
        insetProbe.style.cssText = "position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)";
        document.documentElement.appendChild(insetProbe);
      }
      var style = getComputedStyle(insetProbe);
      return parseFloat(side === "top" ? style.paddingTop : style.paddingBottom) || 0;
    } catch (e) { return 0; }
  }
  function followTop() { return Math.max(headerBottom(), safeInset("top")) + FOLLOW_GAP; }
  function followBottom() { return window.innerHeight - safeInset("bottom") - FOLLOW_GAP; }

  function visibleInHost(frame: HTMLIFrameElement, range: Range) {
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
  // down the screen; the reveal band is now the same small gap used at the top.
  //
  // The frame of reference has to match the mode's own visibility test. In
  // epub.js scrolled mode the iframe is as tall as the whole chapter and the
  // host window scrolls, so measuring against the iframe's height - as the
  // first version of this did - made almost everything look "comfortable",
  // no reveal ever fired, and playback fell through to page turns that loop
  // back to the top of the section.
  function comfortablyVisible(state: ReaderState, range: Range) {
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
      return top >= head - 2 && bottom <= followBottom();
    }

    // foliate: the iframe is the visible page, so its viewport is correct.
    var doc = state.doc;
    var h = (doc && (doc.documentElement.clientHeight || doc.body.clientHeight)) || 0;
    if (!h) return true;
    return r.top >= -2 && r.bottom <= h * 0.88;
  }

  function visibleInDoc(doc: NarrationDocument, range: Range) {
    var r;
    try { r = range.getBoundingClientRect(); } catch (e) { return false; }
    if (!r || (!r.width && !r.height)) return false;
    var w = doc.documentElement.clientWidth || doc.body.clientWidth;
    var h = doc.documentElement.clientHeight || doc.body.clientHeight;
    return r.left > -4 && r.left < w - 1 && r.bottom > -4 && r.top < h + 4;
  }

  function isVisible(state: ReaderState, range: Range) {
    return state.visible ? state.visible(range) : visibleInDoc(state.doc, range);
  }

  async function waitUntilVisible(state: ReaderState, range: Range, timeout: number, mine: number) {
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
  //
  // "Asleep" is judged by whether the screen is actually drawing, not by
  // document.hidden alone. Inside the iPhone app the page's visibility flag is
  // not a reliable witness: if it stays "hidden" after an unlock, narration
  // would keep skipping the follow-scroll on a screen the reader is looking
  // at; if it stays "visible" under a locked screen, a chapter change would
  // wait for a drawing that never comes. A frame callback is the direct
  // evidence, so a heartbeat runs while narration plays.
  var lastFrameAt = 0, frameLoop = false, FRAME_STALE = 2000;
  function watchFrames() {
    lastFrameAt = Date.now();
    if (frameLoop || typeof requestAnimationFrame !== "function") return;
    frameLoop = true;
    var tick = function () {
      lastFrameAt = Date.now();
      if (!playing) { frameLoop = false; return; }
      // Frames are flowing again: put a chapter reached in the dark on the page.
      if (detached) void reattach();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
  function screenAsleep() {
    if (typeof document === "undefined") return false;
    if (!frameLoop) return document.hidden;
    return Date.now() - lastFrameAt > FRAME_STALE;
  }

  async function bringIntoView(state: ReaderState, item: QueueItem, mine: number) {
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

  function rectKey(range: Range) {
    try { var r = range.getBoundingClientRect(); return Math.round(r.left) + ":" + Math.round(r.top); }
    catch (e) { return "?"; }
  }

  // --- the pump ------------------------------------------------------------
  async function step(mine: number) {
    if (!playing || paused || mine !== epoch) return;

    var state = reader();
    if (!state) {                        // mid-transition: wait for the new view
      for (var tries = 0; tries < 16 && !state; tries += 1) {
        await sleep(160);
        if (!playing || paused || mine !== epoch) return;
        state = reader();
      }
      if (!state) { pauseForRecovery("The reading view did not become ready. Tap Play to retry."); return; }
    }

    if (state.doc !== queueDocument || signature(state.doc) !== queueDoc) {
      const sameChapter = signature(state.doc) === queueDoc;
      ensureQueue(state.doc);
      if (!queue.length) { await advanceSection(state, mine); return; }
      // Start from whatever is on screen, not the top of the chapter.
      var visibleItems: number[] = [];
      for (var i = 0; i < queue.length; i += 1) if (isVisible(state, queue[i].range)) visibleItems.push(i);
      if (!sameChapter && visibleItems.length) cursor = visibleItems[0];
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
    if (!ok) {
      // A page turn can replace the iframe while bringIntoView is waiting.
      // The old path exited here with playing=true but no audio or pending
      // callback, so the chapter appeared frozen until the user pressed Skip.
      await sleep(TURN_SETTLE);
      if (playing && !paused && mine === epoch) void step(mine);
      return;
    }

    if (!detached) highlight(state.doc, item.range);
    announce("sentence", state.doc, item.range);
    speak(item.text, mine, state.doc);
  }

  // The reader keeps its saved place on the sentence being spoken, so stopping
  // listening leaves the book open where the voice was (on this device and the
  // next), and waking the screen brings the page back to it.
  var lastSpoken: { doc: NarrationDocument; range: Range } | null = null;
  function announce(kind: "sentence" | "playing" | "paused" | "stopped" | "return", doc?: NarrationDocument, range?: Range) {
    if (doc && range) lastSpoken = { doc: doc, range: range };
    try {
      window.dispatchEvent(new CustomEvent("rr-narration", {
        detail: { kind: kind, doc: lastSpoken ? lastSpoken.doc : null, range: lastSpoken ? lastSpoken.range : null,
          cfi: detached && lastSpoken && lastSpoken.doc === detached.doc ? detached.cfiFor(lastSpoken.range) : null },
      }));
    } catch (e) { /* the reader is gone */ }
  }

  // After the reader jumps (a chapter from the Lock Screen), carry on from the
  // first sentence on the new page rather than the old queue.
  function restartFromView() {
    if (!playing) return;
    epoch += 1;
    var mine = epoch;
    haltCurrentAudio();
    queueDoc = null; detached = null;
    render();
    setTimeout(function () { if (playing && mine === epoch) { paused = false; step(mine); } }, 450);
  }

  function ensureQueue(doc: NarrationDocument) {
    var sig = signature(doc);
    if (doc === queueDocument && sig === queueDoc && queue.length) return;
    const previous = sig === queueDoc ? queue[cursor] : undefined;
    const wasAtEnd = sig === queueDoc && queue.length > 0 && cursor >= queue.length;
    queue = collect(doc);
    queueDoc = sig;
    queueDocument = doc;
    cursor = 0;
    if (wasAtEnd) cursor = queue.length;
    else if (previous) {
      const exact = queue.findIndex(item => item.text === previous.text && item.at === previous.at);
      const match = exact >= 0 ? exact : queue.findIndex(item => item.text === previous.text);
      if (match >= 0) cursor = match;
    }
    attachSteering(doc);
  }

  // --- click any sentence to read from there --------------------------------
  function attachSteering(doc: NarrationDocument) {
    if (!doc || doc.__rrSteering) return;
    doc.__rrSteering = true;
    doc.addEventListener("touchmove", markManualScroll, { passive: true });
    doc.addEventListener("wheel", markManualScroll, { passive: true });
    doc.addEventListener("click", function (event) {
      if (!mountedShell) return;                          // reader not mounted
      if (ignoreSteeringClick(playing, Date.now())) return;
      var t = event.target;
      if (t && (t as Element).closest?.("a,button,input,select,textarea")) return;
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

  function indexAtPoint(doc: NarrationDocument, x: number, y: number) {
    var caret: Range | null = null;
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

  async function advanceSection(state: ReaderState, mine: number) {
    const adapter = getEpubNarrationAdapter();
    // Either witness is enough here: the flag turns at once on a lock, the
    // heartbeat only after a moment, and reading a chapter undrawn is harmless
    // (it is put on the page as soon as frames flow).
    if (adapter && adapter.offscreen && (detached || screenAsleep() || document.hidden)) {
      // With the screen off nothing is drawn, so a chapter that has to be
      // displayed first never arrives and listening stopped at every chapter
      // end. Read the next chapter's text straight from the book instead, and
      // keep the audio session alive with silence while it loads.
      var index = detached ? detached.index : -1;
      if (index < 0) {
        var shown = adapter.targets().find(function (target) { return target.doc === state.doc; });
        index = shown ? shown.index : -1;
      }
      if (index >= 0) {
        try {
          var bridge = new Promise<void>(function (resolve) { playSilence(PAUSE_TARGET.heading, mine, resolve); });
          for (let empty = 0; empty < 64; empty += 1) {
            const section = await adapter.offscreen(index, 1);
            if (!playing || mine !== epoch) return;
            if (!section) { await bridge; if (playing && mine === epoch) stop(); return; }
            index = section.index;
            if (!section.doc.body) continue;
            detached = section;
            ensureQueue(section.doc as NarrationDocument);
            if (!queue.length) continue;
            cursor = 0;
            prepareStartupClip(section.doc as NarrationDocument, cursor);
            if (queue[cursor]) warmUrl(ttsUrl(queue[cursor].text));
            await bridge;
            if (playing && !paused && mine === epoch) void step(mine);
            return;
          }
          pauseForRecovery("No readable sentence was found in the next chapters.");
        } catch {
          if (playing && mine === epoch) pauseForRecovery("The next chapter could not be opened.");
        }
        return;
      }
    }
    if (adapter) {
      try {
        let from = state.doc;
        for (let empty = 0; empty < 64; empty += 1) {
          const next = await adapter.navigate(from, 1);
          if (!playing || paused || mine !== epoch) return;
          if (!next) { stop(); return; }
          from = next.doc as NarrationDocument;
          ensureQueue(from);
          if (!queue.length) continue;
          cursor = 0;
          prepareStartupClip(from, cursor);
          void step(mine);
          return;
        }
        pauseForRecovery("No readable sentence was found in the next chapters.");
      } catch {
        if (playing && mine === epoch) pauseForRecovery("The next chapter could not be opened.");
      }
      return;
    }
    var before = signature(state.doc);
    state.turn();
    // A new section means a new document, but the engines take their time
    // mounting it — poll rather than guess a delay.
    for (var waited = 0; waited < 6000; waited += 160) {
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

  // When the screen comes back, put the chapter being spoken on the page and
  // move narration from the loaded text onto the drawn one, sentence for
  // sentence, so the highlight and taps work again without a break in audio.
  var reattaching = false;
  function blockOrder(items: QueueItem[], item: QueueItem) {
    var seen: Block[] = [];
    for (var i = 0; i < items.length; i += 1) {
      if (seen[seen.length - 1] !== items[i].block) seen.push(items[i].block);
      if (items[i] === item) return seen.length - 1;
    }
    return -1;
  }
  async function reattach() {
    if (reattaching) return;
    reattaching = true;
    try {
      const adapter = getEpubNarrationAdapter(), want = detached;
      if (!adapter || !want) return;
      let target = null, asked = false;
      for (let waited = 0; waited < 8000 && detached === want && !screenAsleep(); waited += 200) {
        target = adapter.targets().find(function (item) { return item.index === want.index; }) ?? null;
        if (target) break;
        // The reader normally returns to the spoken place by itself on wake;
        // ask for the chapter directly only if that has not happened.
        if (!asked && waited >= 1000 && adapter.show) { asked = true; adapter.show(want.index).catch(function () { return null; }); }
        await sleep(200);
      }
      if (!target || detached !== want) return;
      var old = queue, oldCursor = cursor, speaking = old[oldCursor];
      var order = speaking ? blockOrder(old, speaking) : -1, at = speaking ? speaking.at : 0;
      detached = null;
      queue = []; queueDoc = null;
      ensureQueue(target.doc as NarrationDocument);
      if (oldCursor >= old.length) cursor = queue.length;
      else {
        var match = -1;
        for (var i = 0; i < queue.length && match < 0; i += 1) {
          if (blockOrder(queue, queue[i]) === order && queue[i].at <= at && at < queue[i].end) match = i;
        }
        if (match < 0 && speaking) match = queue.findIndex(function (item) { return item.text === speaking.text; });
        cursor = match >= 0 ? match : Math.min(oldCursor, Math.max(0, queue.length - 1));
      }
      var item = queue[cursor], state = reader();
      if (playing && item && state) {
        if (state.mode === "scroll" && state.reveal) state.reveal(item.range);
        highlight(target.doc as NarrationDocument, item.range);
        announce("sentence", target.doc as NarrationDocument, item.range);
      }
      render();
    } finally { reattaching = false; }
  }
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", function () { if (!document.hidden && detached) void reattach(); });
  }

  // --- narration through Piper -------------------------------------------
  // One <audio> element for the whole session: iOS only grants background
  // playback to an element it has seen the user start, so it is created once
  // and reused rather than per sentence.
  var rrTtsAudio: HTMLAudioElement | null = null;
  const rrPrefetch = new Map<string, { promise: Promise<unknown>; controller: AbortController; done: boolean; audioUrl?: string; bytes: number }>();
  let bufferedBytes = 0, activeAudioUrl = "";
  const MAX_BUFFER_BYTES = 16 * 1024 * 1024;
  var rrWarmTimer: ReturnType<typeof setTimeout> | null = null;
  var rrWarmAttempts = 0;
  var stallTimer: ReturnType<typeof setTimeout> | null = null, stallRetries = 0, stallText = "";

  function clearStallWatchdog() {
    if (stallTimer) clearTimeout(stallTimer);
    stallTimer = null;
  }

  function armStallWatchdog(text: string, mine: number, timeout = STALL_TIMEOUT) {
    clearStallWatchdog();
    stallTimer = setTimeout(function () {
      stallTimer = null;
      if (!playing || paused || mine !== epoch) return;
      if (stallText !== text) { stallText = text; stallRetries = 0; }
      stallRetries += 1;
      if (stallRetries <= 2) restartCurrentSentence();
      else pauseForRecovery("The voice stopped responding.");
    }, timeout);
  }

  function ttsVoice() {
    try { return localStorage.getItem("reading-room-voice") || ""; } catch (e) { return ""; }
  }

  function ttsUrl(text: string) {
    // MP3 for the Pi's voices: a seventh of the WAV on the wire. The iPhone's
    // own voices ("ios:") are made on the phone and keep their native format.
    var voice = ttsVoice();
    return "/api/tts?v=" + encodeURIComponent(voice) + "&t=" + encodeURIComponent(text) + (voice.indexOf("ios:") === 0 ? "" : "&f=mp3");
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

  function warmUrl(url: string): Promise<unknown> {
    const cached = rrPrefetch.get(url);
    if (cached) return cached.promise;
    while (rrPrefetch.size >= 24) {
      const oldest = rrPrefetch.keys().next().value!;
      discardBuffer(oldest);
    }
    const controller = new AbortController();
    const entry: { controller: AbortController; done: boolean; promise: Promise<unknown>; audioUrl?: string; bytes: number } = { controller, done: false, promise: Promise.resolve(), bytes: 0 };
    entry.promise = fetch(url, {
      cache: "force-cache", signal: controller.signal,
      headers: { "X-Home-Books-Prefetch": "1" },
    }).then(async function (response) {
        if (!response.ok) throw new Error("TTS prefetch returned " + response.status);
        // Keep the downloaded audio itself. Safari's media loader need not
        // share fetch's HTTP cache (and gateways may disable that cache), so
        // setting the HTTP src again discarded our lookahead at every boundary.
        const blob = await response.blob();
        if (controller.signal.aborted || rrPrefetch.get(url) !== entry) return;
        if (blob.size <= MAX_BUFFER_BYTES) {
          entry.audioUrl = URL.createObjectURL(blob);
          entry.bytes = blob.size;
          bufferedBytes += blob.size;
          for (const key of rrPrefetch.keys()) {
            if (bufferedBytes <= MAX_BUFFER_BYTES) break;
            if (key !== url) discardBuffer(key);
          }
        }
        entry.done = true;
      }).catch(function () {
        if (rrPrefetch.get(url) === entry) rrPrefetch.delete(url);
      });
    rrPrefetch.set(url, entry);
    return entry.promise;
  }

  function discardBuffer(url: string) {
    const entry = rrPrefetch.get(url);
    if (!entry) return;
    entry.controller.abort();
    bufferedBytes -= entry.bytes;
    // The element owns its current URL until the next source is installed.
    if (entry.audioUrl && entry.audioUrl !== activeAudioUrl) URL.revokeObjectURL(entry.audioUrl);
    rrPrefetch.delete(url);
  }

  function releaseActiveAudio() {
    if (activeAudioUrl && !Array.from(rrPrefetch.values()).some(entry => entry.audioUrl === activeAudioUrl)) {
      URL.revokeObjectURL(activeAudioUrl);
    }
    activeAudioUrl = "";
  }

  function clearAudioBuffers() {
    for (const url of rrPrefetch.keys()) discardBuffer(url);
    releaseActiveAudio();
  }

  function cancelWarming() {
    for (const [url, entry] of rrPrefetch) {
      if (!entry.done) discardBuffer(url);
    }
  }

  // Warm the next sentence while the current one plays. Synthesis runs at
  // several times real time, so by the time it is needed it is on disk.
  function warmAhead(start: number, count: number) {
    var end = start + count;
    const generation = epoch, source = queue;
    function lane(index: number): Promise<unknown> {
      if (generation !== epoch || source !== queue || index >= end) return Promise.resolve();
      var next = source[index];
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

  function prefetch(mine: number) {
    if (mine !== epoch) return;
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
    if (!state) {
      if (rrWarmAttempts++ < 12) rrWarmTimer = setTimeout(warmFirstSentence, 250);
      return;
    }
    ensureQueue(state.doc);
    if (!queue.length) {
      if (rrWarmAttempts++ < 12) rrWarmTimer = setTimeout(warmFirstSentence, 250);
      return;
    }
    var at = 0;
    for (var i = 0; i < queue.length; i += 1) {
      if (isVisible(state, queue[i].range)) { at = i; break; }
    }
    var item = queue[at];
    prepareStartupClip(state.doc, at);
    item = queue[at];
    if (!item || !item.text) return;
    var url = ttsUrl(item.text);
    warmUrl(url);
    warmAhead(at + 1, 6);
  }

  function scheduleWarmFirstSentence(delay?: number) {
    if (rrWarmTimer) clearTimeout(rrWarmTimer);
    rrWarmAttempts = 0;
    rrWarmTimer = setTimeout(warmFirstSentence, delay == null ? 80 : delay);
  }

  function mediaSession(doc: NarrationDocument) {
    if (!("mediaSession" in navigator)) return;
    try {
      var title = document.querySelector<HTMLElement>(".reader-shell h1, .reader-title")?.textContent
        || document.title || "Home Books";
      // The reader publishes the chapter, author and cover, so the Lock Screen
      // and CarPlay's Now Playing read like an audiobook's.
      var info = (window as Window & { __rrNowPlaying?: { title?: string; artist?: string; album?: string; artwork?: string } }).__rrNowPlaying || {};
      var meta = {
        title: String(info.title || title).trim().slice(0, 120),
        artist: String(info.artist || "Home Books").slice(0, 120),
        album: String(info.album || title).trim().slice(0, 120),
        artwork: info.artwork ? [{ src: info.artwork, sizes: "512x512" }] : [],
      };
      var current = navigator.mediaSession.metadata;
      if (!current || current.title !== meta.title || current.artist !== meta.artist || current.album !== meta.album) {
        navigator.mediaSession.metadata = new MediaMetadata(meta);
      }
      // Tell iOS the audio session is actively playing so it keeps background
      // audio alive through page-turn gaps (fixes reading stopping after 2-3
      // pages when the screen is locked).
      navigator.mediaSession.playbackState = "playing";
      navigator.mediaSession.setActionHandler("play", function () { if (paused) toggle(); });
      navigator.mediaSession.setActionHandler("pause", function () { if (!paused) toggle(); });
      navigator.mediaSession.setActionHandler("stop", stop);
      // Skip back/forward (the Lock Screen's 15-second buttons, AirPods, the car)
      // move by a couple of sentences - about that long spoken. Previous/next
      // track move by chapter, as in an audiobook.
      navigator.mediaSession.setActionHandler("seekbackward", async function () { await skipSentence(-1); await skipSentence(-1); });
      navigator.mediaSession.setActionHandler("seekforward", async function () { await skipSentence(1); await skipSentence(1); });
      navigator.mediaSession.setActionHandler("previoustrack", function () { changeChapter(-1); });
      navigator.mediaSession.setActionHandler("nexttrack", function () { changeChapter(1); });
    } catch (e) { /* older browsers */ }
  }

  function changeChapter(delta: -1 | 1) {
    try { window.dispatchEvent(new CustomEvent("rr-narration-chapter", { detail: { delta: delta } })); } catch (e) {}
  }

  // --- natural pauses -------------------------------------------------------
  // A narrator breathes between sentences, waits longer between paragraphs and
  // longer still around a heading or a scene break. Targets are the total
  // silence wanted at 1x; each voice family already leaves some of it at the
  // edges of its clips (measured: Piper about 0.3 s, Kokoro about 0.15 s), so
  // only the difference is added. A sentence cut at a comma adds nothing.
  var PAUSE_TARGET = { sentence: 0.35, paragraph: 0.75, heading: 1.1, scene: 1.4 };
  function clipEdgeSilence() {
    var voice = ttsVoice();
    return voice.indexOf("kokoro-") === 0 ? 0.15 : voice.indexOf("ios:") === 0 ? 0.1 : 0.3;
  }
  function isHeading(el: Element) { return /^H[1-6]$/i.test(el.tagName); }
  function sceneBreakBetween(a: Element, b: Element) {
    try {
      // An ornament, rule or empty spacer paragraph between the two blocks...
      if (a.parentElement && a.parentElement === b.parentElement) {
        var hops = 0;
        for (var n = a.nextElementSibling; n && n !== b && hops < 6; n = n.nextElementSibling, hops += 1) {
          var t = (n.textContent || "").replace(/[\s\u00a0]+/g, "");
          if (n.tagName === "HR" || !t || !/[A-Za-z0-9\u00c0-\u024f\u0400-\u04ff\u0900-\u097f]/.test(t)) return true;
        }
      }
      // ...or a paragraph set well apart from the one before it.
      var view = b.ownerDocument.defaultView;
      if (!view) return false;
      var sb = view.getComputedStyle(b), sa = view.getComputedStyle(a);
      var size = parseFloat(sb.fontSize) || 16;
      return (parseFloat(sb.marginTop) || 0) + (parseFloat(sa.marginBottom) || 0) >= size * 2.6;
    } catch (e) { return false; }
  }
  function pauseAfter(index: number) {
    var done = queue[index], next = queue[index + 1];
    if (!done || !next || !done.block || !next.block) return 0;
    var target = 0;
    if (done.block === next.block) {
      target = /[.!?\u2026]["'\u201d\u2019)\]]*\s*$/.test(done.text) ? PAUSE_TARGET.sentence : 0;
    } else if (isHeading(done.block.block) || isHeading(next.block.block)) target = PAUSE_TARGET.heading;
    else if (sceneBreakBetween(done.block.block, next.block.block)) target = PAUSE_TARGET.scene;
    else target = PAUSE_TARGET.paragraph;
    var add = target - clipEdgeSilence();
    return add >= 0.06 ? add / Math.max(0.5, rate) : 0;
  }
  function silentClip(seconds: number) {
    var sampleRate = 8000, samples = Math.max(1, Math.round(sampleRate * seconds));
    var buffer = new ArrayBuffer(44 + samples * 2), view = new DataView(buffer);
    var tag = function (at: number, text: string) { for (var i = 0; i < text.length; i += 1) view.setUint8(at + i, text.charCodeAt(i)); };
    tag(0, "RIFF"); view.setUint32(4, 36 + samples * 2, true); tag(8, "WAVEfmt "); view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    tag(36, "data"); view.setUint32(40, samples * 2, true);
    return URL.createObjectURL(new Blob([buffer], { type: "audio/wav" }));
  }
  var pauseGuard: ReturnType<typeof setTimeout> | undefined;
  function clearPauseGuard() { if (pauseGuard) { clearTimeout(pauseGuard); pauseGuard = undefined; } }
  // The pause is real (silent) audio on the same element, not a timer: iOS
  // suspends timers behind a locked screen but keeps an audio session that is
  // actually playing, so lock-screen listening carries on through every pause.
  function playPause(seconds: number, mine: number) {
    playSilence(seconds, mine, function () { if (playing && !paused && mine === epoch) step(mine); });
  }
  function playSilence(seconds: number, mine: number, done: () => void) {
    var a = audioEl(), finished = false;
    var proceed = function () {
      if (finished) return;
      finished = true; clearPauseGuard();
      done();
    };
    var unity = function () { try { a.playbackRate = 1; } catch (e) {} };
    a.onloadedmetadata = unity; a.onplay = unity;
    a.onplaying = null; a.ontimeupdate = null; a.onwaiting = null;
    a.onended = proceed; a.onerror = proceed;
    var url = silentClip(seconds);
    a.src = url;
    releaseActiveAudio();
    activeAudioUrl = url;
    clearPauseGuard();
    // If the silent clip never reports its end, carry on rather than hang.
    pauseGuard = setTimeout(function () { if (!paused) proceed(); }, seconds * 1000 + 1500);
    var go = a.play();
    if (go && go.catch) go.catch(proceed);
  }

  function speak(text: string, mine: number, doc: NarrationDocument) {
    var a = audioEl();
    clearPauseGuard();
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
      var gap = pauseAfter(cursor);
      cursor += 1;
      if (gap > 0) playPause(gap, mine); else step(mine);
    };
    a.onerror = function () {
      if (!playing || mine !== epoch) return;
      clearStallWatchdog();
      if (stallText !== text) { stallText = text; stallRetries = 0; }
      stallRetries += 1;
      if (stallRetries <= 2) restartCurrentSentence();
      else pauseForRecovery("This sentence's audio could not be loaded.");
    };
    a.onplaying = function () { armStallWatchdog(text, mine); };
    a.ontimeupdate = function () { armStallWatchdog(text, mine); };
    a.onwaiting = function () { armStallWatchdog(text, mine, a.readyState < 2 ? LOAD_TIMEOUT : STALL_TIMEOUT); };
    const url = ttsUrl(text);
    const buffered = rrPrefetch.get(url)?.audioUrl;
    // Reuse the gesture-authorised element, including for lock-screen audio.
    // A cold start retains the direct URL path so it never waits on lookahead.
    a.src = buffered || url;
    releaseActiveAudio();
    activeAudioUrl = buffered || "";
    // Mark the played entry most-recently used; short backward skips stay warm.
    const entry = rrPrefetch.get(url);
    if (entry) { rrPrefetch.delete(url); rrPrefetch.set(url, entry); }
    mediaSession(doc);
    stallText = text;
    armStallWatchdog(text, mine, LOAD_TIMEOUT);
    var go = a.play();
    if (go && go.catch) {
      go.catch(function () {
        // Autoplay refused (no gesture yet, usually): leave it to the user.
        // A pause invalidates this play request by advancing epoch. Safari can
        // reject that now-obsolete promise after the pause tap; treating the
        // rejection as a fresh autoplay failure stopped the whole session and
        // made the collapsed controls disappear.
        if (playing && !paused && mine === epoch) pauseForRecovery("Playback needs your permission to resume.");
      });
    }
    prefetch(mine);
  }

  // --- sleep timer -----------------------------------------------------------
  function renderTimer() {
    render();
  }

  function adjustSleepTime(minutes: number) {
    var delta = Number(minutes);
    if (!isFinite(delta) || !delta) return;
    sleepMs = Math.max(0, sleepMs + delta * 60 * 1000);
    if (!sleepRef) {
      if (sleepMs) {
        sleepRef = setInterval(function () {
          if (!playing || paused) return; // pause countdown while paused
          sleepMs = Math.max(0, sleepMs - 1000);
          renderTimer();
          if (!sleepMs) { if (sleepRef) clearInterval(sleepRef); sleepRef = null; stop(); }
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
    playbackError = undefined;
    epoch += 1;
    queueDoc = null; detached = null;
    watchFrames();
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
    playbackError = undefined;
    epoch += 1;
    cancelWarming();
    if (rrWarmTimer) clearTimeout(rrWarmTimer);
    rrWarmTimer = null;
    queue = []; queueDoc = null; queueDocument = null; cursor = 0; detached = null;
    clearSleepTimer();
    clearStallWatchdog();
    try { if (rrTtsAudio) { rrTtsAudio.pause(); rrTtsAudio.removeAttribute('src'); rrTtsAudio.load(); } } catch (e) { /* ignore */ }
    clearAudioBuffers();
    try { if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'none'; } catch (e) {}
    if (keepAlive) { clearInterval(keepAlive); keepAlive = null; }
    if (sweeper) { clearInterval(sweeper); sweeper = null; }
    clearHighlights();
    render();
    announce("stopped");
    lastSpoken = null;
  }

  // Keep the same audio element and source paused so iOS retains the media
  // session and AirPods/lock-screen Play can resume without a foreground tap.
  function toggle() {
    if (!playing) { play(); return; }
    if (paused) {
      const retry = Boolean(playbackError);
      playbackError = undefined;
      stallRetries = 0;
      paused = false;
      try { if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "playing"; } catch (e) {}
      render();
      if (!retry && rrTtsAudio && rrTtsAudio.src) {
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
    announce("paused");
  }

  function haltCurrentAudio() {
    clearStallWatchdog();
    clearPauseGuard();
    cancelWarming();
    try {
      if (rrTtsAudio) {
        rrTtsAudio.onended = null;
        rrTtsAudio.onerror = null;
        rrTtsAudio.pause();
        rrTtsAudio.removeAttribute("src");
        rrTtsAudio.load();
        releaseActiveAudio();
      }
    } catch (e) { /* ignore */ }
  }

  function pauseForRecovery(message: string) {
    epoch += 1;
    haltCurrentAudio();
    paused = true;
    playbackError = message;
    try { if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "paused"; } catch {}
    render(); announce("paused");
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
  async function skipSentence(delta: -1 | 1) {
    if (!playing || !delta) return;
    var state = reader();
    if (state) ensureQueue(state.doc);
    if (!queue.length) return;
    epoch += 1;
    var mine = epoch;
    playbackError = undefined;
    stallRetries = 0;
    haltCurrentAudio();
    clearHighlights();
    if (delta < 0 && cursor === 0 && state && !detached && getEpubNarrationAdapter()) {
      const adapter = getEpubNarrationAdapter();
      try {
        let from = state.doc;
        // Contents/title/furniture-only sections are not a listening destination.
        // Bound traversal and invalidate every awaited reply on stop/another seek.
        for (let empty = 0; empty < 64; empty += 1) {
          const previous = await adapter?.navigate(from, -1);
          if (!playing || mine !== epoch) return;
          if (!previous) {
            if (!queue.length) { pauseForRecovery("No earlier readable sentence was found."); return; }
            break;
          }
          ensureQueue(previous.doc as NarrationDocument);
          from = previous.doc as NarrationDocument;
          state = reader();
          if (queue.length) { cursor = queue.length - 1; break; }
          if (empty === 63) { pauseForRecovery("No readable sentence was found in the previous chapters."); return; }
        }
      } catch { if (playing && mine === epoch) pauseForRecovery("The previous chapter could not be opened."); return; }
    } else cursor = delta < 0 ? Math.max(0, cursor - 1) : Math.min(queue.length, cursor + 1);
    render();
    if (!paused) step(mine);
    else if (state && queue[cursor]) {
      // Paused navigation intentionally does not enter the playing-only pump.
      // Explicitly reveal its target without resuming or turning multiple pages.
      if (!screenAsleep()) state.reveal(queue[cursor].range);
      if (playing && mine === epoch && paused) highlight(state.doc, queue[cursor].range);
    }
  }

  function publicState() {
    return {
      playing: playing,
      paused: paused,
      rate: rate,
      sleepMinutes: sleepMs ? Math.ceil(sleepMs / 60000) : 0,
      canPrevious: playing && (cursor > 0 || Boolean(queueDocument && getEpubNarrationAdapter()?.canPrevious(queueDocument))),
      canNext: playing && !!queue.length,
      error: playbackError,
    };
  }

  // Voices as data rather than a DOM node. The reading sheet used to clone the
  // <select> and read .options, which coupled it to this module's markup; a
  // React component should not have to know a select exists. The select stays as
  // the source of truth so nothing about playback changes.
  function getVoices() {
    var selected = ttsVoice();
    return piperVoices.map(function (voice) {
      // The Pi reports how quickly it can speak each voice; a slow one can
      // leave gaps between sentences, so say so where the voice is chosen.
      return { label: voice.label, value: voice.id, current: voice.id === selected, detail: voice.speed === "fast" ? "Fast" : voice.speed === "slow" ? "Slower" : "" };
    });
  }
  function setVoice(value: string) {
    try { localStorage.setItem("reading-room-voice", value || ""); } catch (e) {}
    scheduleWarmFirstSentence(40);
    render();
    if (playing && !paused) restartCurrentSentence();
  }

  window.addEventListener("rr-reading-mode-change", function (event) {
    var requested = (event as CustomEvent<{ mode?: string }>).detail?.mode;
    if (requested !== "pages" && requested !== "scroll") return;
    var before = reader();
    if (before) ensureQueue(before.doc);
    var anchorText = queue[cursor] && queue[cursor].text;
    var oldDoc = before && before.doc;
    // EPUB rebuilds its document; Foliate reflows the same document in place.
    // Both are ready after their mode changes, not only after a new iframe.
    var keepsDocument = Boolean(document.querySelector("foliate-view"));
    var wasPlaying = playing;
    var wasPaused = paused;
    epoch += 1;
    var mine = epoch;
    haltCurrentAudio();
    clearHighlights();
    queue = []; queueDoc = null; cursor = 0; detached = null;
    if (!wasPlaying || !anchorText) { render(); return; }

    (async function restoreAfterModeChange() {
      var state: ReaderState | null = null;
      for (var attempt = 0; attempt < 50; attempt += 1) {
        await sleep(100);
        if (mine !== epoch) return;
        state = reader();
        if (state && state.mode === requested && (state.doc !== oldDoc || keepsDocument)) break;
      }
      if (!state || mine !== epoch) return;
      ensureQueue(state.doc);
      const settledState = state;
      var normalized = anchorText.replace(/\s+/g, " ").trim();
      var found = queue.findIndex(function (item) {
        return item.text.replace(/\s+/g, " ").trim() === normalized;
      });
      if (found >= 0) cursor = found;
      else {
        var visible = queue.findIndex(function (item) { return isVisible(settledState, item.range); });
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
  function setRate(next: number) {
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
    fetch("/api/tts/voices").then(function (r) { return r.json(); }).then(function (d: { voices?: Array<{ id: string; label: string; speed?: string }> }) {
      piperVoices = (d.voices || []).map(function (voice) {
        return { id: String(voice.id || ""), label: String(voice.label || voice.id || ""), speed: typeof voice.speed === "string" ? voice.speed : "" };
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
    if (/^(INPUT|TEXTAREA|SELECT)$/.test((e.target as Element | null)?.tagName || "")) return;
    if (e.key === "l" || e.key === "L") { e.preventDefault(); toggle(); }
  });
  registerReadAloudEngine({
    getState: publicState,
    getVoices: getVoices,
    toggle: toggle,
    stop: stop,
    skip: skipSentence,
    restartFromView: restartFromView,
    adjustSleep: adjustSleepTime,
    clearSleep: function () { clearSleepTimer(); render(); },
    returnToCurrent: function () {
      if (!playing || !lastSpoken) return;
      manualScrollUntil = 0;
      // The reader's saved CFI survives unloaded EPUB chapters; it owns navigation.
      if (getEpubNarrationAdapter()) announce("return");
      else {
        const state = reader();
        if (state && state.doc === lastSpoken.doc) state.reveal(lastSpoken.range);
      }
    },
    setRate: setRate,
    setVoice: setVoice,
  });

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();
  document.addEventListener("touchmove", markManualScroll, { passive: true, capture: true });
  document.addEventListener("wheel", markManualScroll, { passive: true, capture: true });
  new MutationObserver(mount).observe(document.documentElement, { childList: true, subtree: true });
})();
