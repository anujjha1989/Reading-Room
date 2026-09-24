"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import "./settings-panel.css";

type Source = { id: string; name: string; path: string; enabled: boolean };
type ScanStatus = { state: string; message?: string; before?: number; after?: number };
type SettingsState = {
  sources: Source[];
  dropFolder: string;
  status: ScanStatus;
  gaps: { total: number; withCover: number; noCover: number; noAuthor: number; poorTitle: number };
  catalogueModified: string | null;
};
type GapBook = { id: string; title: string; author: string; format: string };
type GapResult = { count: number; items: GapBook[] };
type Page = "root" | "sources" | "source" | "add" | "maintenance" | "drop" | "gaps" | "gap-list" | "theme" | "about";
type Theme = "system" | "light" | "dark";

const number = (n: number) => n.toLocaleString();
const post = (body: object): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body as T;
}
function savedTheme(): Theme {
  try {
    const value = localStorage.getItem("reading-room-theme");
    return value === "light" || value === "dark" ? value : "system";
  } catch { return "system"; }
}
const themeLabels: Record<Theme, string> = { system: "Match device", light: "Light", dark: "Dark" };
type IconName = "folder" | "refresh" | "chart" | "sun" | "info" | "plus" | "book";
function SettingIcon({ name }: { name: IconName }) {
  return <span className="rr-settings-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {name === "folder" && <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />}
    {name === "refresh" && <><path d="M20 11a8 8 0 1 0-.6 4" /><path d="M20 5v6h-6" /></>}
    {name === "chart" && <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />}
    {name === "sun" && <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" /></>}
    {name === "info" && <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>}
    {name === "plus" && <path d="M12 5v14M5 12h14" />}
    {name === "book" && <><path d="M4 5a2 2 0 0 1 2-2h12v18H6a2 2 0 0 1-2-2Z" /><path d="M8 3v18" /></>}
  </svg></span>;
}

function Row({ title, sub, value, icon, onClick, pressed, danger = false, disabled = false }: { title: string; sub?: string; value?: string; icon?: IconName; onClick?: () => void; pressed?: boolean; danger?: boolean; disabled?: boolean }) {
  const contents = <>{icon && <SettingIcon name={icon} />}<span className="rr-settings-row-text"><strong>{title}</strong>{sub && <small>{sub}</small>}</span>{value && <span className="rr-settings-value">{value}</span>}{onClick && <span className="rr-settings-chevron" aria-hidden="true">›</span>}</>;
  return onClick ? <button type="button" className={`rr-settings-row${danger ? " danger" : ""}`} onClick={onClick} aria-pressed={pressed} disabled={disabled}>{contents}</button> : <div className="rr-settings-row">{contents}</div>;
}
function Group({ children, label, footer }: { children: ReactNode; label?: string; footer?: ReactNode }) {
  return <section className="rr-settings-section">{label && <h2>{label}</h2>}<div className="rr-settings-rows">{children}</div>{footer && <p className="rr-settings-footer">{footer}</p>}</section>;
}

type Props = { version: string; closing: boolean; onClose: () => void; onRefresh: () => void; onThemeChange: (theme: Theme) => void };
export default function SettingsPanel({ version, closing, onClose, onRefresh, onThemeChange }: Props) {
  const [state, setState] = useState<SettingsState | null>(null);
  const [error, setError] = useState("");
  const [page, setPage] = useState<Page>("root");
  const [sourceId, setSourceId] = useState("");
  const [gap, setGap] = useState<{ kind: "cover" | "author" | "title"; title: string } | null>(null);
  const [gapResult, setGapResult] = useState<GapResult | null>(null);
  const [theme, setTheme] = useState<Theme>(savedTheme);
  const [path, setPath] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const previousScan = useRef<string | null>(null);
  const overlay = useRef<HTMLDivElement>(null);

  const reload = useCallback(async () => {
    try { setState(await api<SettingsState>("/api/settings/state")); setError(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not load settings"); }
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => {
    if (page !== "maintenance" || state?.status?.state !== "running") return;
    const timer = setInterval(() => { void reload(); }, 2500);
    return () => clearInterval(timer);
  }, [page, state?.status?.state, reload]);
  useEffect(() => {
    const current = state?.status?.state;
    if (previousScan.current === "running" && current && current !== "running") {
      setToast(current === "failed" ? "Scan failed" : "Scan complete");
    }
    if (current) previousScan.current = current;
  }, [state?.status?.state]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 3200);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => { if (overlay.current) overlay.current.scrollTop = 0; }, [page]);

  const back = useCallback(() => {
    if (page === "source" || page === "add") setPage("sources");
    else if (page === "drop") setPage("maintenance");
    else if (page === "gap-list") setPage("gaps");
    else setPage("root");
  }, [page]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopImmediatePropagation();
      if (page === "root") onClose(); else back();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [page, back, onClose]);

  async function mutate<T>(request: () => Promise<T>, update: (result: T) => void, message: string, next?: Page) {
    if (busy) return;
    setBusy(true);
    try { update(await request()); setToast(message); if (next) setPage(next); }
    catch (cause) { setToast(cause instanceof Error ? cause.message : "Could not save"); }
    finally { setBusy(false); }
  }
  const changeSources = (result: { sources: Source[] }) => setState((old) => old ? { ...old, sources: result.sources } : old);
  const source = state?.sources.find((item) => item.id === sourceId);
  const openGap = async (kind: "cover" | "author" | "title", title: string) => {
    setGap({ kind, title }); setGapResult(null); setPage("gap-list");
    try { setGapResult(await api<GapResult>(`/api/settings/gaps?kind=${kind}`)); }
    catch (cause) { setToast(cause instanceof Error ? cause.message : "Could not load books"); }
  };
  const changeTheme = (value: Theme) => {
    try { value === "system" ? localStorage.removeItem("reading-room-theme") : localStorage.setItem("reading-room-theme", value); } catch { /* private mode */ }
    setTheme(value); onThemeChange(value); setToast(`Appearance: ${themeLabels[value]}`);
  };
  const scanLine = () => {
    if (!state) return "";
    if (state.status?.state === "running") return state.status.message || "Scan in progress…";
    if (state.status?.state === "failed") return state.status.message || "The last scan failed.";
    const when = state.catalogueModified ? new Date(state.catalogueModified).toLocaleString() : "never";
    const counts = state.status?.before != null && state.status.after != null ? ` · last run ${number(state.status.before)} → ${number(state.status.after)}` : "";
    return `${number(state.gaps.total)} books · catalogue updated ${when}${counts}`;
  };

  const titles: Record<Page, string> = { root: "Settings", sources: "Library sources", source: source?.name || "Source", add: "Add a folder", maintenance: "Library maintenance", drop: "Drop folder", gaps: "Metadata & artwork", "gap-list": gap?.title || "Books", theme: "Appearance", about: "About" };
  const action = (label: string, onClick: () => void, secondary = false, disabled = false) => <button type="button" className={secondary ? "rr-settings-secondary" : "rr-settings-primary"} onClick={onClick} disabled={busy || disabled}>{label}</button>;

  return <div ref={overlay} id="rr-settings-overlay" className={`rr-settings${closing ? " rr-settings-closing" : ""}`} role="dialog" aria-modal="true" aria-label="Library settings">
    <div className="rr-settings-wrap">
      <header className="rr-settings-head">
        {page === "root" ? <span className="rr-settings-back-spacer" /> : <button type="button" aria-label="Back" className="rr-settings-back" onClick={back}>‹</button>}
        <h1>{titles[page]}</h1>
        <button type="button" id="close" aria-label="Close settings" className="rr-settings-close" onClick={onClose} autoFocus>×</button>
      </header>
      {error && !state ? <p className="rr-settings-footer" role="alert">Could not load settings: {error} {action("Retry", () => { void reload(); }, true)}</p> : !state ? <p className="rr-settings-footer">Loading settings…</p> : <>
        {page === "root" && <><Group>
          <Row icon="folder" title="Library sources" sub={`${state.sources.length} folder${state.sources.length === 1 ? "" : "s"}${state.sources.filter((item) => !item.enabled).length ? ` · ${state.sources.filter((item) => !item.enabled).length} paused` : ""}`} onClick={() => setPage("sources")} />
          <Row icon="refresh" title="Library maintenance" sub={state.status?.state === "running" ? state.status.message || "Scan in progress" : state.status?.state === "failed" ? state.status.message || "Last scan failed" : `${number(state.gaps.total)} books · ${number(state.gaps.withCover)} with artwork`} onClick={() => setPage("maintenance")} />
          <Row icon="chart" title="Metadata & artwork" sub={`${number(state.gaps.noCover)} without artwork · ${number(state.gaps.noAuthor)} without an author`} onClick={() => setPage("gaps")} />
          <Row icon="sun" title="Appearance" sub={themeLabels[theme]} onClick={() => setPage("theme")} />
          <Row icon="info" title="About" sub="How this works" onClick={() => setPage("about")} />
        </Group><div className="rr-settings-actions">{action("Refresh Library", onRefresh)}</div></>}
        {page === "sources" && <Group label="FOLDERS" footer={<>Folders are paths inside your Drive. Pausing or removing one only stops it being indexed — nothing in Drive is touched.</>}>
          {state.sources.map((item) => <Row key={item.id} icon="folder" title={item.name} sub={item.path} value={item.enabled ? "Indexed" : "Paused"} onClick={() => { setSourceId(item.id); setPage("source"); }} />)}
          <Row icon="plus" title="Add a folder" onClick={() => { setPath(""); setName(""); setPage("add"); }} />
        </Group>}
        {page === "source" && source && <Group footer="Removing a source drops its books from the catalogue at the next scan. The files stay in Drive.">
          <Row icon="folder" title="Path" sub={source.path} />
          <Row icon="refresh" title={source.enabled ? "Pause indexing" : "Resume indexing"} sub={source.enabled ? "Included in every scan" : "Currently skipped by scans"} onClick={() => { void mutate(() => api<{ sources: Source[] }>("/api/settings/sources", post({ action: "toggle", id: source.id })), changeSources, "Saved", "sources"); }} />
          <Row icon="plus" title="Remove this source" danger onClick={() => { void mutate(() => api<{ sources: Source[] }>("/api/settings/sources", post({ action: "remove", id: source.id })), changeSources, "Source removed", "sources"); }} />
        </Group>}
        {page === "add" && <><Group><div className="rr-settings-form"><label htmlFor="rr-source-path">Folder path in Drive</label><small>A Drive path like Books/Archive/New Imports, or a full path on the Pi starting with /.</small><input id="rr-source-path" value={path} onChange={(event) => setPath(event.target.value)} placeholder="Books/Archive/New Imports or /mnt/seagate/…" autoCapitalize="off" autoCorrect="off" spellCheck={false} /><label htmlFor="rr-source-name">Name (optional)</label><input id="rr-source-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="New Imports" /></div></Group><div className="rr-settings-actions">{action("Add source", () => { if (!path.trim()) { setToast("Enter a folder path"); return; } void mutate(() => api<{ sources: Source[] }>("/api/settings/sources", post({ action: "add", path: path.trim(), name: name.trim() })), changeSources, "Source added · run a scan to index it", "sources"); })}{action("Cancel", back, true)}</div><p className="rr-settings-footer">A Drive source must sit inside Books/ or Scripts/. A folder on the Pi can be anywhere Home Books can read.</p></>}
        {page === "maintenance" && <><div className="rr-settings-actions">{action(state.status?.state === "running" ? "Working…" : "Rescan Database", () => { void mutate(() => api<object>("/api/settings/scan", post({ mode: "full" })), () => { setState((old) => old ? { ...old, status: { state: "running", message: "Starting…" } } : old); }, "Full scan started"); }, false, state.status?.state === "running")}</div><Group>
          <Row icon="book" title="Sync new additions" sub={`Only ${state.dropFolder || "the drop folder"}`} onClick={() => { void mutate(() => api<object>("/api/settings/scan", post({ mode: "incremental" })), () => { setState((old) => old ? { ...old, status: { state: "running", message: "Starting…" } } : old); }, "Checking the drop folder"); }} />
          <Row icon="folder" title="Drop folder" sub="Where new books are dropped" value="Change" onClick={() => { setPath(state.dropFolder || ""); setPage("drop"); }} />
          <Row icon="chart" title="Review metadata & artwork" sub="Books missing covers, authors or real titles" onClick={() => setPage("gaps")} />
        </Group><p className="rr-settings-footer" aria-live="polite">{scanLine()}</p><p className="rr-settings-footer">A full scan relists everything and rebuilds the catalogue. Syncing new additions only looks in the drop folder and never removes anything.</p></>}
        {page === "drop" && <><Group><div className="rr-settings-form"><label htmlFor="rr-drop-path">Folder path in Drive</label><small>“Sync new additions” looks here and nowhere else.</small><input id="rr-drop-path" value={path} onChange={(event) => setPath(event.target.value)} autoCapitalize="off" autoCorrect="off" spellCheck={false} /></div></Group><div className="rr-settings-actions">{action("Save", () => { void mutate(() => api<{ dropFolder: string }>("/api/settings/sources", post({ action: "dropFolder", path: path.trim() })), (result) => setState((old) => old ? { ...old, dropFolder: result.dropFolder } : old), "Drop folder saved", "maintenance"); })}{action("Cancel", back, true)}</div></>}
        {page === "gaps" && <Group footer={`${number(state.gaps.withCover)} of ${number(state.gaps.total)} books have artwork. Covers are read out of the book files themselves.`}>
          <Row icon="chart" title="Without artwork" value={number(state.gaps.noCover)} onClick={() => { void openGap("cover", "Without artwork"); }} />
          <Row icon="chart" title="Without an author" value={number(state.gaps.noAuthor)} onClick={() => { void openGap("author", "Without an author"); }} />
          <Row icon="chart" title="Filename-style titles" value={number(state.gaps.poorTitle)} onClick={() => { void openGap("title", "Filename-style titles"); }} />
        </Group>}
        {page === "gap-list" && <Group footer={gapResult ? `${number(gapResult.count)} book${gapResult.count === 1 ? "" : "s"}${gapResult.count > gapResult.items.length ? ` · showing the first ${number(gapResult.items.length)}` : ""}` : undefined}>
          {!gapResult ? <p className="rr-settings-footer">Loading…</p> : gapResult.items.length ? gapResult.items.map((book) => <div className="rr-settings-gap" key={book.id}><span>{book.title}{book.author && <small> · {book.author}</small>}</span><small>{book.format}</small></div>) : <p className="rr-settings-footer">Nothing here — all clear.</p>}
        </Group>}
        {page === "theme" && <Group footer="This is saved on this device, so each device you read on can differ.">
          {(["system", "light", "dark"] as const).map((value) => <Row key={value} icon="sun" title={themeLabels[value]} sub={{ system: "Follow your phone or computer", light: "Paper and ink, always", dark: "Black background, as in Books" }[value]} value={theme === value ? "✓" : undefined} pressed={theme === value} onClick={() => changeTheme(value)} />)}
        </Group>}
        {page === "about" && <Group footer="A scan lists your source folders and rebuilds the catalogue from what is actually there. Reading positions are carried across by title. Cover art is read from the book files themselves.">
          <Row icon="info" title="Version" value={version} /><Row icon="book" title="Books in the catalogue" value={number(state.gaps.total)} /><Row icon="chart" title="With artwork" value={number(state.gaps.withCover)} /><Row icon="folder" title="Source folders" value={String(state.sources.length)} />
        </Group>}
      </>}
    </div>
    {toast && <div className="rr-settings-toast" role="status">{toast}</div>}
  </div>;
}
