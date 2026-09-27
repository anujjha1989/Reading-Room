/**
 * A light tap under the finger for every button in the app - library, reader,
 * menus and sheets.
 *
 * WebKit on iPhone has no navigator.vibrate, so the Home Books app provides a
 * `rrHaptic` message handler (UIFeedbackGenerator; Settings can turn it off).
 * Elsewhere navigator.vibrate is used where it exists (Android), and nothing
 * happens where it doesn't (desktop, Safari).
 *
 * One document-level listener rather than a call in every onClick: it covers
 * buttons that bypass click (the reading menu's own touch path), the ones in
 * portals, and whatever is added later. It fires on release, and only if the
 * finger didn't travel - so scrolling a shelf that starts on a cover, or a
 * swipe to turn the page, stays silent. The page-turn layer isn't a control,
 * so turning pages doesn't buzz, as in Apple Books.
 */

export type HapticKind = "tap" | "select" | "firm";

type HapticWindow = Window & { webkit?: { messageHandlers?: { rrHaptic?: { postMessage: (kind: string) => void } } } };

export function haptic(kind: HapticKind = "tap") {
  try {
    const native = (window as HapticWindow).webkit?.messageHandlers?.rrHaptic;
    if (native) { native.postMessage(kind); return; }
    navigator.vibrate?.(kind === "firm" ? 14 : 8);
  } catch { /* not available */ }
}

const CONTROL = [
  "button", "a[href]", "summary", "select", "label",
  "input[type=checkbox]", "input[type=radio]",
  "[role=button]", "[role=tab]", "[role=menuitem]", "[role=menuitemcheckbox]", "[role=menuitemradio]",
  "[role=option]", "[role=switch]",
].join(",");
const SELECTION = "[role=tab], [role=option], [role=menuitemcheckbox], [role=menuitemradio], [role=switch], select, input[type=checkbox], input[type=radio], [aria-pressed]";

function controlAt(target: EventTarget | null): Element | null {
  if (!(target instanceof Element)) return null;
  const control = target.closest(CONTROL);
  if (!control) return null;
  // The invisible page-turn zones over the book are buttons too, but a buzz on
  // every page turn is noise, not feedback (Apple Books doesn't either).
  if (control.closest('[aria-label="Page tap controls"]')) return null;
  if ((control as HTMLButtonElement).disabled || control.getAttribute("aria-disabled") === "true") return null;
  // A label only counts when it wraps or names a control (the filter pickers).
  if (control.tagName === "LABEL" && !control.querySelector("input, select") && !(control as HTMLLabelElement).htmlFor) return null;
  return control;
}

let installed = false;

export function installHaptics() {
  if (installed || typeof window === "undefined") return () => {};
  installed = true;
  let down: { x: number; y: number; control: Element; at: number } | null = null;
  const onDown = (event: PointerEvent) => {
    if (event.button > 0) { down = null; return; }
    const control = controlAt(event.target);
    down = control ? { x: event.clientX, y: event.clientY, control, at: Date.now() } : null;
  };
  const onUp = (event: PointerEvent) => {
    const start = down;
    down = null;
    if (!start) return;
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 12) return;   // a scroll or swipe
    if (Date.now() - start.at > 900) return;                                          // a long press has its own
    const control = controlAt(event.target) || start.control;
    haptic(control.matches(SELECTION) ? "select" : "tap");
  };
  const onCancel = () => { down = null; };
  document.addEventListener("pointerdown", onDown, { capture: true, passive: true });
  document.addEventListener("pointerup", onUp, { capture: true, passive: true });
  document.addEventListener("pointercancel", onCancel, { capture: true, passive: true });
  return () => {
    installed = false;
    document.removeEventListener("pointerdown", onDown, true);
    document.removeEventListener("pointerup", onUp, true);
    document.removeEventListener("pointercancel", onCancel, true);
  };
}
