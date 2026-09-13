// The Reading Room — library behaviour refinements.  (v5)
// Two things the stylesheet cannot do: pick a better default sort, and give
// the horizontal rails a way to tell you they scroll.
//
// v5 — scroll performance.  Three changes, no behaviour change:
//   * markEdges no longer measures on every scroll event.  scrollWidth and
//     clientWidth only change on resize, so they are cached and the class
//     writes are batched into one rAF.  (Was: a forced layout per scroll tick.)
//   * scan() is rAF-throttled instead of running synchronously inside the
//     MutationObserver callback, and the observer disconnects once the sort
//     has settled — it existed only to straddle hydration.
//   * the observer watches <main> rather than documentElement.
(function () {
  "use strict";

  var SORT_KEY = "reading-room-sort";
  var DEFAULT_SORT = "added";
  var settled = false;                       // stop once the sort has stuck
  var deadline = Date.now() + 8000;          // ...or after 8s, whichever first
  var lastApplied = null;                    // the value we most recently forced
  var observer = null;
  var scanQueued = false;

  function savedSort() {
    try { return localStorage.getItem(SORT_KEY); } catch (e) { return null; }
  }

  // --- Default the catalogue to "Recently added" ---------------------------
  // Sorting by title puts scanned comics and numeric filenames first, which is
  // a poor front door for a library this size.
  //
  // The select is present in the server-rendered HTML, so setting it before
  // React hydrates is silently undone — we have to keep trying until it takes.
  // A real (isTrusted) change from you settles it for good and is remembered.
  function watchSort(select) {
    if (!select.dataset.rrSort) {
      select.dataset.rrSort = "1";
      select.addEventListener("change", function () {
        // Anything other than the value we just forced is your choice: honour
        // it, remember it, and stop interfering. (Comparing values rather than
        // trusting `isTrusted`, which varies across browsers and automation.)
        if (select.value === lastApplied) return;
        settled = true;
        try { localStorage.setItem(SORT_KEY, select.value); } catch (err) { /* private mode */ }
      });
    }
    if (settled || Date.now() > deadline) return;
    var wanted = savedSort() || DEFAULT_SORT;
    // Deliberately do NOT settle just because the DOM value matches: before
    // hydration React will overwrite it again. Keep re-applying until either
    // React adopts it, you pick a sort yourself, or the deadline passes.
    if (select.value === wanted) return;
    var ok = Array.prototype.some.call(select.options, function (o) { return o.value === wanted; });
    if (!ok) { settled = true; return; }
    // React tracks the value internally; go through the native setter so the
    // change event it hears carries the new value.
    var setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
    lastApplied = wanted;
    setter.call(select, wanted);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }

  // --- Rails: edge fade + arrows ------------------------------------------
  // The metrics are read once per resize, never mid-gesture: reading
  // scrollWidth inside a scroll handler forces a synchronous layout on every
  // frame of the drag, which is what made the rails stutter.
  function enhance(strip) {
    if (strip.dataset.rrRail && strip.closest(".smart-shelf").querySelector(".rail-nav")) return;
    var shelf = strip.closest(".smart-shelf");
    if (!shelf) return;
    strip.dataset.rrRail = "1";

    var maxScroll = 0;
    var ticking = false;
    var prevBtn = null;
    var nextBtn = null;

    function measure() { maxScroll = strip.scrollWidth - strip.clientWidth; }

    function paint() {
      ticking = false;
      var x = strip.scrollLeft;
      var atStart = x <= 4;
      var atEnd = x >= maxScroll - 4;
      strip.classList.toggle("rail-start", !atStart);
      strip.classList.toggle("rail-end", !atEnd);
      if (prevBtn) prevBtn.hidden = atStart;
      if (nextBtn) nextBtn.hidden = atEnd;
    }

    function schedulePaint() {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(paint);
    }

    ["prev", "next"].forEach(function (dir) {
      var b = document.createElement("button");
      b.className = "rail-nav " + dir;
      b.type = "button";
      b.setAttribute("aria-label", dir === "prev" ? "Scroll left" : "Scroll right");
      b.textContent = dir === "prev" ? "‹" : "›";
      b.addEventListener("click", function () {
        strip.scrollBy({ left: (dir === "prev" ? -1 : 1) * strip.clientWidth * 0.8, behavior: "smooth" });
      });
      shelf.appendChild(b);
      if (dir === "prev") prevBtn = b; else nextBtn = b;
    });

    strip.addEventListener("scroll", schedulePaint, { passive: true });
    if (window.ResizeObserver) {
      new ResizeObserver(function () { measure(); schedulePaint(); }).observe(strip);
    }
    measure();
    paint();
  }

  function scan() {
    scanQueued = false;
    var select = document.querySelector(".sort-control select");
    if (select) watchSort(select);
    document.querySelectorAll(".series-strip, .shelf-strip").forEach(enhance);
    // The observer exists only to straddle hydration. Once the sort has
    // settled there is nothing left for it to catch that the rails do not
    // already handle themselves, so stop paying for it on every DOM change
    // the app makes — including every cover that fails and retries.
    if (observer && (settled || Date.now() > deadline)) {
      observer.disconnect();
      observer = null;
    }
  }

  function scheduleScan() {
    if (scanQueued) return;
    scanQueued = true;
    requestAnimationFrame(scan);
  }

  // The catalogue renders client-side, so scan on load, on a few timed retries
  // that straddle hydration, and on any later DOM change — but coalesced into
  // one pass per frame rather than one per mutation batch.
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", scan);
  } else {
    scan();
  }
  [50, 200, 500, 1000, 2000, 3500, 6000].forEach(function (t) { setTimeout(scan, t); });
  observer = new MutationObserver(scheduleScan);
  observer.observe(document.querySelector("main") || document.documentElement,
                   { childList: true, subtree: true });
})();
