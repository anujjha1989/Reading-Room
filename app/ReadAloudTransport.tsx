"use client";

import type { ReadAloudApi } from "./ReadingSheet";
import { useEffect, useRef } from "react";
import { haptic } from "./haptics";

function TransportIcon({ name }: { name: "previous" | "play" | "pause" | "next" }) {
  const path = name === "previous"
    ? <><path d="M6 5v14" /><path d="m17 6-7 6 7 6" /></>
    : name === "next"
      ? <><path d="M18 5v14" /><path d="m7 6 7 6-7 6" /></>
      : name === "play"
        ? <path d="M8 5v14l11-7Z" fill="currentColor" stroke="none" />
        : <path d="M8 5v14M16 5v14" />;
  return <svg viewBox="0 0 24 24" aria-hidden="true">{path}</svg>;
}

/** The compact narration transport is ordinary React chrome, not injected DOM. */
export default function ReadAloudTransport({ api }: { api?: ReadAloudApi }) {
  const hold = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelled = useRef(false);
  const origin = useRef({ x: 0, y: 0 });
  const releaseHold = () => { if (hold.current) clearTimeout(hold.current); hold.current = null; };
  useEffect(() => releaseHold, [api?.playing, Boolean(api?.sleepMinutes)]);
  if (!api?.playing) return null;
  return <>
  <div className="rr-read-extras rr-visible" role="group" aria-label="Reading position and sleep timer">
    {api.sleepMinutes > 0 && <button type="button" className="rr-read-glass rr-read-timer"
      aria-label={`Sleep timer: ${api.sleepMinutes} minutes left. Tap to add 30 minutes; hold for 3 seconds to cancel.`}
      title="Click or Enter: +30 min · Hold 3 seconds or Shift+Enter: cancel timer"
      onKeyDown={event => {
        if (event.key === "Enter" || event.key === " ") cancelled.current = false;
        if (event.key === "Enter" && event.shiftKey) {
          event.preventDefault(); releaseHold(); api.clearSleep(); haptic("select");
        }
      }}
      onPointerDown={event => {
        if (event.button !== 0) return;
        releaseHold(); cancelled.current = false;
        origin.current = { x: event.clientX, y: event.clientY };
        event.currentTarget.setPointerCapture(event.pointerId);
        hold.current = setTimeout(() => { cancelled.current = true; hold.current = null; api.clearSleep(); haptic("select"); }, 3000);
      }}
      onPointerMove={event => { if (Math.hypot(event.clientX-origin.current.x,event.clientY-origin.current.y)>10) { cancelled.current=true; releaseHold(); } }}
      onPointerUp={releaseHold} onPointerCancel={() => { cancelled.current=true; releaseHold(); }} onLostPointerCapture={releaseHold}
      onContextMenu={event => event.preventDefault()}
      onClick={() => { if (!cancelled.current) api.adjustSleep(30); cancelled.current=false; }}>
      <span>{api.sleepMinutes}</span><small>min</small>
    </button>}
    <button type="button" className="rr-read-glass rr-read-return" onClick={api.returnToCurrent} aria-label="Return to current reading" title="Return to the sentence being read">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5H5v3m11-3h3v3M5 16v3h3m11-3v3h-3"/><path d="m10 9 5 3-5 3Z" fill="currentColor" stroke="none"/></svg>
    </button>
  </div>
  <div className="rr-read-transport rr-visible" role="group" aria-label="Read aloud controls">
    <button type="button" onClick={api.previous} disabled={!api.canPrevious} aria-label="Previous sentence"><TransportIcon name="previous" /></button>
    <button type="button" className="rr-read-toggle" onClick={api.toggle} aria-label={api.paused ? "Resume read aloud" : "Pause read aloud"} title={api.error ? `${api.error} Tap to retry.` : undefined} aria-pressed={!api.paused}><TransportIcon name={api.paused ? "play" : "pause"} /></button>
    <button type="button" onClick={api.skip} disabled={!api.canNext} aria-label="Next sentence"><TransportIcon name="next" /></button>
  </div></>;
}
