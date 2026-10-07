/**
 * A visible flash under the finger for every button in the app, the way native
 * iOS controls answer a touch: the surface lights up the moment it is pressed,
 * stays lit long enough to register even on the quickest tap, then fades.
 *
 * Glass controls (the reader's floating chips, the library dock and icon
 * rail) brighten and swell slightly; everything else - rows, text buttons,
 * covers - takes a soft tint. The flash is its own overlay element, so no
 * button's styling, transition or layout is touched and nothing added later
 * needs to opt in. It sits beside the haptic tap and follows the same rules:
 * a scroll or swipe that starts on a control cancels it.
 */

const CONTROL = [
  "button", "a[href]", "summary",
  "[role=button]", "[role=tab]", "[role=menuitem]", "[role=menuitemcheckbox]", "[role=menuitemradio]",
  "[role=option]", "[role=switch]",
].join(",");
const HOLD_MS = 150;      // the shortest a flash is ever shown
const FADE_MS = 240;

function controlAt(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  const control = target.closest(CONTROL);
  if (!(control instanceof HTMLElement)) return null;
  // The invisible page-turn zones over the book are buttons, not controls.
  if (control.closest('[aria-label="Page tap controls"]')) return null;
  if ((control as HTMLButtonElement).disabled || control.getAttribute("aria-disabled") === "true") return null;
  return control;
}

function luminance(color: string) {
  const parts = color.match(/[\d.]+/g);
  if (!parts || parts.length < 3) return 0;
  return (0.2126 * Number(parts[0]) + 0.7152 * Number(parts[1]) + 0.0722 * Number(parts[2])) / 255;
}

let installed = false;

export function installPressFeedback() {
  if (installed || typeof window === "undefined") return () => {};
  installed = true;
  let active: { control: HTMLElement; overlay: HTMLElement; grow: Animation | null; x: number; y: number; at: number } | null = null;

  const release = (immediately = false) => {
    const press = active;
    active = null;
    if (!press) return;
    const finish = () => {
      if (press.grow) {
        // Settle back rather than snapping from the swollen size.
        try {
          press.grow.cancel();
          press.control.animate([{ scale: "1.08" }, { scale: "1" }], { duration: 200, easing: "ease-out" });
        } catch { /* already gone */ }
      }
      const fade = press.overlay.animate([{ opacity: 1 }, { opacity: 0 }], { duration: immediately ? 90 : FADE_MS, easing: "ease-out", fill: "forwards" });
      fade.onfinish = fade.oncancel = () => press.overlay.remove();
      // Safety net: an animation that never reports must not leave a tint behind.
      setTimeout(() => press.overlay.remove(), (immediately ? 90 : FADE_MS) + 200);
    };
    const shown = Date.now() - press.at;
    if (immediately || shown >= HOLD_MS) finish(); else setTimeout(finish, HOLD_MS - shown);
  };

  const onDown = (event: PointerEvent) => {
    if (event.button > 0) return;
    release(true);
    const control = controlAt(event.target);
    if (!control) return;
    const box = control.getBoundingClientRect();
    if (box.width < 4 || box.height < 4) return;
    const style = getComputedStyle(control);
    const backdrop = style.backdropFilter || (style as CSSStyleDeclaration & { webkitBackdropFilter?: string }).webkitBackdropFilter || "";
    const glass = backdrop !== "" && backdrop !== "none";
    const onDark = luminance(style.color) > 0.6;            // light ink means a dark surface
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const overlay = document.createElement("div");
    overlay.setAttribute("aria-hidden", "true");
    overlay.className = "rr-press-flash";
    overlay.style.cssText = `position:fixed;left:${box.left}px;top:${box.top}px;width:${box.width}px;height:${box.height}px;`
      + `border-radius:${style.borderRadius};pointer-events:none;z-index:2147483000;opacity:0;`
      + `background:${glass ? (onDark ? "rgba(255,255,255,.30)" : "rgba(255,255,255,.72)") : (onDark ? "rgba(255,255,255,.16)" : "rgba(60,60,67,.14)")};`;
    document.body.appendChild(overlay);
    overlay.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 70, easing: "ease-out", fill: "forwards" });
    let grow: Animation | null = null;
    if (glass && !calm) {
      const frames = [{ scale: "1" }, { scale: "1.08" }];
      const timing: KeyframeAnimationOptions = { duration: 130, easing: "cubic-bezier(.2,.9,.3,1.2)", fill: "forwards" };
      try { grow = control.animate(frames, timing); overlay.animate(frames, timing); } catch { grow = null; }
    }
    active = { control, overlay, grow, x: event.clientX, y: event.clientY, at: Date.now() };
  };
  const onMove = (event: PointerEvent) => {
    if (active && Math.hypot(event.clientX - active.x, event.clientY - active.y) > 12) release(true);   // a scroll or swipe
  };
  const onUp = () => release();
  const onCancel = () => release(true);
  const options = { capture: true, passive: true } as const;
  document.addEventListener("pointerdown", onDown, options);
  document.addEventListener("pointermove", onMove, options);
  document.addEventListener("pointerup", onUp, options);
  document.addEventListener("pointercancel", onCancel, options);
  window.addEventListener("scroll", onCancel, options);
  window.addEventListener("blur", onCancel);
  return () => {
    installed = false;
    release(true);
    document.removeEventListener("pointerdown", onDown, true);
    document.removeEventListener("pointermove", onMove, true);
    document.removeEventListener("pointerup", onUp, true);
    document.removeEventListener("pointercancel", onCancel, true);
    window.removeEventListener("scroll", onCancel, true);
    window.removeEventListener("blur", onCancel);
  };
}
