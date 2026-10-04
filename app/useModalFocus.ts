"use client";
import { useEffect, type RefObject } from "react";

/** Keep keyboard and assistive-technology focus inside the visible dialog. */
export function useModalFocus(ref: RefObject<HTMLElement | null>, active = true) {
  useEffect(() => {
    const dialog = ref.current;
    if (!active || !dialog) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const candidates = () => [...dialog.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex="0"]')]
      .filter(node => node.getClientRects().length > 0 && !node.closest('[hidden],[inert]'));
    const focusFirst = () => (candidates()[0] ?? dialog).focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const items = candidates(), first = items[0], last = items.at(-1);
      if (!first) { event.preventDefault(); dialog.focus(); return; }
      if (!dialog.contains(document.activeElement) || (event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last)) {
        event.preventDefault(); (event.shiftKey ? last : first)?.focus();
      }
    };
    const onFocus = (event: FocusEvent) => { if (event.target instanceof Node && !dialog.contains(event.target)) focusFirst(); };
    // Inert only siblings along the ancestor path, never the dialog's own
    // ancestor (Settings is rendered inside the library's main element).
    const siblings: Array<{ element: HTMLElement; inert: boolean }> = [];
    for (let node: HTMLElement | null = dialog; node?.parentElement && node !== document.body; node = node.parentElement) {
      for (const sibling of node.parentElement.children) if (sibling !== node && sibling instanceof HTMLElement && !["SCRIPT", "STYLE", "LINK"].includes(sibling.tagName)) {
        siblings.push({ element: sibling, inert: sibling.inert }); sibling.inert = true;
      }
    }
    if (!dialog.contains(document.activeElement)) focusFirst();
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("focusin", onFocus, true);
    return () => {
      document.removeEventListener("keydown", onKey, true); document.removeEventListener("focusin", onFocus, true);
      for (const { element, inert } of siblings) element.inert = inert;
      if (previous?.isConnected && !previous.inert) previous.focus();
    };
  }, [ref, active]);
}
