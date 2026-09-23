"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/** A shelf owns its own scroll affordances; no document-wide DOM scanner. */
export default function ShelfRail({ children }: { children: ReactNode }) {
  const stripRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ before: false, after: false });

  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    let frame = 0;
    let maxScroll = 0;
    const paint = () => {
      frame = 0;
      const next = { before: strip.scrollLeft > 4, after: strip.scrollLeft < maxScroll - 4 };
      setEdges((old) => old.before === next.before && old.after === next.after ? old : next);
    };
    const schedulePaint = () => { if (!frame) frame = requestAnimationFrame(paint); };
    const measure = () => { maxScroll = Math.max(0, strip.scrollWidth - strip.clientWidth); schedulePaint(); };
    const resize = new ResizeObserver(measure);
    resize.observe(strip);
    strip.addEventListener("scroll", schedulePaint, { passive: true });
    measure();
    return () => {
      resize.disconnect();
      strip.removeEventListener("scroll", schedulePaint);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  const scroll = (direction: -1 | 1) => {
    const strip = stripRef.current;
    if (strip) strip.scrollBy({ left: direction * strip.clientWidth * 0.8, behavior: "smooth" });
  };

  return <>
    <div ref={stripRef} className={`shelf-strip${edges.before ? " rail-start" : ""}${edges.after ? " rail-end" : ""}`}>
      {children}
    </div>
    <button type="button" className="rail-nav prev" aria-label="Scroll left" hidden={!edges.before} onClick={() => scroll(-1)}>‹</button>
    <button type="button" className="rail-nav next" aria-label="Scroll right" hidden={!edges.after} onClick={() => scroll(1)}>›</button>
  </>;
}
