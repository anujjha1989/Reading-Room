"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

export type LibraryChromeView = "home" | "library" | "favorites";
export type LibraryDisplayMode = "thumbnails" | "list";
export type LibrarySortMode = "title" | "author" | "series" | "added" | "opened";

type Props = {
  view: LibraryChromeView;
  displayMode: LibraryDisplayMode;
  sort: LibrarySortMode;
  filtersOpen: boolean;
  hidden: boolean;
  onViewChange: (view: LibraryChromeView) => void;
  onDisplayModeChange: (mode: LibraryDisplayMode) => void;
  onSortChange: (sort: LibrarySortMode) => void;
  onFiltersOpenChange: (open: boolean) => void;
};

const sortOptions: Array<{ value: LibrarySortMode; label: string }> = [
  { value: "title", label: "Title" }, { value: "author", label: "Author" },
  { value: "series", label: "Series" }, { value: "added", label: "Recently added" },
  { value: "opened", label: "Recently opened" },
];

function Icon({ name }: { name: "home" | "library" | "favorites" | "filter" | "more" | "gear" }) {
  if (name === "home") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z" /></svg>;
  if (name === "library") return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="4" height="17" rx="1" /><rect x="10" y="3" width="4" height="18" rx="1" /><path d="m17 5 3-1 4 16-3 1zM3 8h4M10 7h4" /></svg>;
  if (name === "favorites") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8z" /></svg>;
  if (name === "filter") return <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="var(--rr-library-icon)" strokeWidth="1.8" strokeLinecap="round"><path d="M4 7h16M6.5 12h11M10 17h4" /></svg>;
  if (name === "more") return <svg viewBox="0 0 24 24" aria-hidden="true" fill="var(--rr-library-icon)"><circle cx="5" cy="12" r="1.4" /><circle cx="12" cy="12" r="1.4" /><circle cx="19" cy="12" r="1.4" /></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="var(--rr-library-icon)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06a1.7 1.7 0 0 0-1.88-.34A1.7 1.7 0 0 0 14 20.93V21h-4v-.08a1.7 1.7 0 0 0-1.04-1.52 1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15 1.7 1.7 0 0 0 3.08 14H3v-4h.08A1.7 1.7 0 0 0 4.6 8.96a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 8.96 4.6 1.7 1.7 0 0 0 10 3.08V3h4v.08a1.7 1.7 0 0 0 1.03 1.53 1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 8.96 1.7 1.7 0 0 0 20.92 10H21v4h-.08A1.7 1.7 0 0 0 19.4 15Z" /></svg>;
}

function Tick() { return <svg className="rr-tick" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12.5l5 5L20 6.5" /></svg>; }

export default function LibraryChrome(props: Props) {
  // The deployed index is a committed prerendered document. This component did
  // not exist when that document was captured, so keep the hydration snapshot
  // identical and mount the fixed chrome immediately afterwards. Unlike a
  // setState-in-effect gate, useSyncExternalStore has an explicit server
  // snapshot and cannot produce a hydration mismatch.
  const hydrated = useSyncExternalStore(() => () => {}, () => true, () => false);
  const { onFiltersOpenChange } = props;
  const [sortOpen, setSortOpen] = useState(false);
  const [settingsMounted, setSettingsMounted] = useState(false);
  const [settingsClosing, setSettingsClosing] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closePopovers = useCallback(() => { setSortOpen(false); onFiltersOpenChange(false); }, [onFiltersOpenChange]);
  const closeSettings = useCallback(() => {
    if (!settingsMounted || settingsClosing) return;
    setSettingsClosing(true);
    document.documentElement.classList.remove("rr-settings-open");
    closeTimer.current = setTimeout(() => { setSettingsMounted(false); setSettingsClosing(false); closeTimer.current = null; }, 430);
  }, [settingsClosing, settingsMounted]);
  const openSettings = () => {
    closePopovers(); setSettingsClosing(false); setSettingsMounted(true);
    document.documentElement.classList.add("rr-settings-open");
  };

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("rr-book-open", props.hidden);
    root.classList.toggle("rr-library-visible", !props.hidden);
    root.dataset.rrLibraryView = props.view;
    root.classList.toggle("rr-filters-open", props.filtersOpen);
    root.classList.toggle("rr-sort-open", sortOpen);
    return () => { root.classList.remove("rr-book-open", "rr-library-visible", "rr-filters-open", "rr-sort-open"); delete root.dataset.rrLibraryView; };
  }, [props.hidden, props.view, props.filtersOpen, sortOpen]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (settingsMounted) closeSettings();
      else closePopovers();
    };
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== location.origin || !event.data) return;
      if (event.data.type === "rr-close-settings") closeSettings();
      else if (event.data.type === "rr-refresh-library") { closeSettings(); location.reload(); }
      else if (event.data.type === "rr-theme") {
        if (event.data.value === "system") delete document.documentElement.dataset.rrTheme;
        else document.documentElement.dataset.rrTheme = event.data.value;
      }
    };
    window.addEventListener("keydown", onKey); window.addEventListener("message", onMessage);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("message", onMessage); };
  }, [closePopovers, closeSettings, settingsMounted]);

  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current); document.documentElement.classList.remove("rr-settings-open"); }, []);

  const version = typeof document === "undefined" ? "" : (/fullscreen-bundle-v(\d+)\./.exec(document.querySelector<HTMLLinkElement>('link[href*="fullscreen-bundle-v"]')?.href || "")?.[1] || "");
  const settingsUrl = `/settings.html${version ? `?v=${encodeURIComponent(version)}&` : "?"}embedded=1`;

  if (!hydrated) return null;

  return <>
    <div id="rr-popover-scrim" onClick={closePopovers} />
    <button id="rr-filter-btn" type="button" aria-label="Filter library" aria-expanded={props.filtersOpen} onClick={() => { const next = !props.filtersOpen; setSortOpen(false); props.onFiltersOpenChange(next); }}><Icon name="filter" /></button>
    <button id="rr-sort-btn" type="button" aria-label="Sort and view options" aria-expanded={sortOpen} onClick={() => { const next = !sortOpen; props.onFiltersOpenChange(false); setSortOpen(next); }}><Icon name="more" /></button>
    <button id="rr-settings-link" type="button" aria-label="Library settings" onClick={openSettings}><Icon name="gear" /></button>
    <div id="rr-sort-menu" role="menu">
      {(["thumbnails", "list"] as const).map((mode) => <button type="button" role="menuitemradio" aria-checked={props.displayMode === mode} key={mode} onClick={() => { props.onDisplayModeChange(mode); closePopovers(); }}><Tick /><span>{mode === "thumbnails" ? "▦ Thumbnails" : "☷ List"}</span></button>)}
      <hr /><div className="rr-menu-label">Sort by</div>
      {sortOptions.map((option) => <button type="button" role="menuitemradio" aria-checked={props.sort === option.value} key={option.value} onClick={() => { props.onSortChange(option.value); closePopovers(); }}><Tick /><span>{option.label}</span></button>)}
    </div>
    <nav className="rr-library-dock" aria-label="Reading Room navigation" hidden={props.hidden}>
      {(["home", "library", "favorites"] as const).map((item) => <button type="button" data-view={item[0].toUpperCase() + item.slice(1)} aria-label={item === "library" ? "Browse full library" : item[0].toUpperCase() + item.slice(1)} aria-current={props.view === item ? "page" : undefined} key={item} onClick={() => props.onViewChange(item)}><Icon name={item} /><span>{item[0].toUpperCase() + item.slice(1)}</span></button>)}
    </nav>
    {settingsMounted && <iframe id="rr-settings-overlay" className={settingsClosing ? "rr-settings-closing" : undefined} src={settingsUrl} title="Library settings" onLoad={(event) => {
      try {
        const frame = event.currentTarget;
        if (["/", "/index.html"].includes(frame.contentWindow?.location.pathname || "")) { closeSettings(); return; }
        const theme = document.documentElement.dataset.rrTheme;
        if (frame.contentDocument?.documentElement) { if (theme) frame.contentDocument.documentElement.dataset.rrTheme = theme; else delete frame.contentDocument.documentElement.dataset.rrTheme; }
      } catch { /* A failed settings page remains closable with Escape. */ }
    }} />}
  </>;
}
