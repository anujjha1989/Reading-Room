"use client";
import { useEffect } from "react";

/** Browser-only release lifecycle; UI and error recovery stay React-owned. */
export default function AppLifecycle() {
  useEffect(() => {
    const scheme = matchMedia("(prefers-color-scheme: dark)");
    const paint = () => {
      if (document.querySelector(".reader-shell")) return;
      const preference = document.documentElement.dataset.rrTheme;
      const dark = preference === "dark" || (preference !== "light" && scheme.matches);
      const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
      if (meta) { meta.removeAttribute("media"); meta.content = dark ? "#000000" : "#ffffff"; }
    };
    paint();
    const observer = new MutationObserver(paint);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-rr-theme"] });
    scheme.addEventListener("change", paint);
    if ("serviceWorker" in navigator) void navigator.serviceWorker.register("/sw.js").catch(() => {});
    return () => { observer.disconnect(); scheme.removeEventListener("change", paint); };
  }, []);
  return null;
}
