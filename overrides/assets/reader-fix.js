// The Reading Room — make A− / A+ work in every book.
//
// The reader changes text size by setting a percentage on <body>. That only
// works if the book sizes its text relatively. Plenty of books don't: Calibre
// and Word conversions are full of absolute sizes like
//
//     p.MsoNormal, li.MsoNormal, div.MsoNormal { font-size: 12pt }
//     span.sgc-20 { font-size: 14pt }
//     .imp { font-size: small }
//
// Absolute lengths and absolute-size keywords are computed from the browser's
// base size, not from the parent, so scaling <body> leaves them untouched and
// the buttons appear dead.
//
// This rewrites those declarations in the book's own stylesheets into `em`,
// using the same 16px base the browser started from — so at 100% the page
// looks exactly as before, and every step of A− / A+ now scales it.
(function () {
  "use strict";

  var BASE_PX = 16;
  var UNIT_PX = { px: 1, pt: 4 / 3, pc: 16, in: 96, cm: 96 / 2.54, mm: 96 / 25.4, q: 96 / 101.6 };
  var KEYWORD_EM = {
    "xx-small": 0.5625, "x-small": 0.625, small: 0.8125, medium: 1,
    large: 1.125, "x-large": 1.5, "xx-large": 2, "xxx-large": 3,
  };
  var LENGTH = /^\s*(-?[\d.]+)\s*(px|pt|pc|in|cm|mm|q)\s*$/i;

  function toEm(value) {
    if (!value) return null;
    var text = String(value).toLowerCase().trim();
    if (Object.prototype.hasOwnProperty.call(KEYWORD_EM, text)) {
      return KEYWORD_EM[text] + "em";
    }
    var m = LENGTH.exec(text);
    if (!m) return null;                       // already em/rem/%/inherit — leave it
    var px = parseFloat(m[1]) * UNIT_PX[m[2]];
    if (!isFinite(px) || px <= 0) return null;
    return Math.round((px / BASE_PX) * 10000) / 10000 + "em";
  }

  function fixRules(rules) {
    var changed = 0;
    for (var i = 0; i < rules.length; i += 1) {
      var rule = rules[i];
      try {
        if (rule.style && rule.style.fontSize) {
          var em = toEm(rule.style.fontSize);
          if (em) {
            var important = rule.style.getPropertyPriority("font-size");
            rule.style.setProperty("font-size", em, important);
            changed += 1;
          }
        }
        if (rule.cssRules && rule.cssRules.length) changed += fixRules(rule.cssRules);  // @media, @supports
      } catch (e) { /* one bad rule shouldn't stop the rest */ }
    }
    return changed;
  }

  function normalise(doc) {
    if (!doc || !doc.body || doc.__rrFontScaleFixed) return 0;
    var changed = 0;
    var sheets = doc.styleSheets || [];
    for (var i = 0; i < sheets.length; i += 1) {
      var rules = null;
      try { rules = sheets[i].cssRules; } catch (e) { continue; }   // cross-origin sheet
      if (rules) changed += fixRules(rules);
    }
    var inline = doc.querySelectorAll('[style*="font-size"]');
    for (var j = 0; j < inline.length; j += 1) {
      try {
        var em = toEm(inline[j].style.fontSize);
        if (em) { inline[j].style.setProperty("font-size", em, inline[j].style.getPropertyPriority("font-size")); changed += 1; }
      } catch (e) { /* ignore */ }
    }
    doc.__rrFontScaleFixed = true;
    return changed;
  }

  // Both engines, same treatment: foliate hands its document over directly,
  // epub.js renders into same-origin iframes.
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

  function scan() {
    var docs = documents();
    for (var i = 0; i < docs.length; i += 1) normalise(docs[i]);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", scan);
  else scan();
  // Sections mount asynchronously and are swapped as you read, so keep looking.
  new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true });
  setInterval(scan, 1500);
})();
