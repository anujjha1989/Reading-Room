"use client";

import { useRef, type ComponentPropsWithoutRef } from "react";
import { useModalFocus } from "./useModalFocus";

/** Shared focus ownership without changing a dialog's visual layout. */
export default function ModalDialog(props: ComponentPropsWithoutRef<"section">) {
  const dialog = useRef<HTMLElement>(null);
  useModalFocus(dialog);
  return <section {...props} ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" />;
}
