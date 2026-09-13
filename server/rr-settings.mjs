// Reading Room — settings API.
//
// Kept out of standalone-server.mjs so the server gains one import and one
// route line rather than another few hundred lines to hand-merge later.
//
// The web app runs hardened (NoNewPrivileges, ProtectSystem=strict, writable
// only under /var/lib/reading-room), so it cannot scan Drive or install a
// catalogue itself. It writes a request file instead; a systemd path unit
// notices and runs the privileged rebuild. Everything here is therefore
// read-only except for settings.json and that request file.
import { readFile, writeFile, readdir, stat, chmod } from "node:fs/promises";
import { join } from "node:path";

const DATA = process.env.READING_ROOM_DATA || "/var/lib/reading-room";
const SITE = process.env.READING_ROOM_SITE || "/opt/reading-room/current/site";
const COVER_DIR = process.env.READING_ROOM_COVER_ART || "/mnt/seagate/ReadingRoom/covers";

const SETTINGS = join(DATA, "settings.json");
const STATUS = join(DATA, "scan-status.json");
const REQUEST = join(DATA, "scan-request.json");

const DEFAULT_DROP = "Books/Archive/New Imports";

const DEFAULT_SOURCES = [
  { id: "books", name: "Books", path: "Books", enabled: true },
  { id: "scripts", name: "Scripts", path: "Scripts", enabled: true },
];

const json = (response, code, body) => {
  const payload = JSON.stringify(body);
  response.writeHead(code, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
  }).end(payload);
};

const readJson = async (path, fallback) => {
  try { return JSON.parse(await readFile(path, "utf8")); } catch { return fallback; }
};

async function loadSettings() {
  const s = await readJson(SETTINGS, null);
  if (!s || !Array.isArray(s.sources) || !s.sources.length) {
    return { sources: DEFAULT_SOURCES, dropFolder: (s && s.dropFolder) || DEFAULT_DROP };
  }
  if (!s.dropFolder) s.dropFolder = DEFAULT_DROP;
  return s;
}

const saveSettings = (s) => writeFile(SETTINGS, JSON.stringify(s, null, 2));

// A title the scanner derived from a filename rather than real metadata:
// "0f 8 - Gotham Knights #056", "031228716XImmediate Fiction B", "31".
const FILENAMEISH = /\d{3,}|_|^\W|\.(pdf|epub|mobi)$|retail|calibre|z-?lib|www\./i;

async function coverIds() {
  try {
    const names = await readdir(COVER_DIR);
    return new Set(names.filter((n) => n.endsWith(".jpg")).map((n) => n.slice(0, -4)));
  } catch { return new Set(); }
}

async function catalogue() {
  return readJson(join(SITE, "catalog.json"), []);
}

async function gapSummary() {
  const [books, covers] = await Promise.all([catalogue(), coverIds()]);
  let noCover = 0, noAuthor = 0, poorTitle = 0;
  for (const b of books) {
    if (!covers.has(b.id)) noCover++;
    if (!(b.author || "").trim()) noAuthor++;
    if (FILENAMEISH.test(b.title || "")) poorTitle++;
  }
  return { total: books.length, noCover, noAuthor, poorTitle, withCover: books.length - noCover };
}

async function gapList(kind, limit = 300) {
  const [books, covers] = await Promise.all([catalogue(), coverIds()]);
  const test = kind === "cover" ? (b) => !covers.has(b.id)
    : kind === "author" ? (b) => !(b.author || "").trim()
    : (b) => FILENAMEISH.test(b.title || "");
  const hits = books.filter(test);
  return {
    kind,
    count: hits.length,
    items: hits.slice(0, limit).map((b) => ({
      id: b.id, title: b.title, author: b.author || "", format: b.format,
      path: b.path, url: b.url, hasCover: covers.has(b.id),
    })),
  };
}

export async function settingsRoute(request, response, url) {
  const path = url.pathname;

  if (path === "/api/settings/state" && request.method === "GET") {
    const [settings, status, gaps, books] = await Promise.all([
      loadSettings(), readJson(STATUS, { state: "idle" }), gapSummary(), catalogue(),
    ]);
    let catalogueModified = null;
    try { catalogueModified = (await stat(join(SITE, "catalog.json"))).mtime.toISOString(); } catch {}
    const formats = {};
    for (const b of books) formats[b.format] = (formats[b.format] || 0) + 1;
    json(response, 200, { sources: settings.sources, dropFolder: settings.dropFolder,
                          status, gaps, formats, catalogueModified });
    return true;
  }

  if (path === "/api/settings/sources" && request.method === "POST") {
    let body = "";
    for await (const chunk of request) {
      body += chunk;
      if (body.length > 65536) { json(response, 413, { error: "too large" }); return true; }
    }
    let payload;
    try { payload = JSON.parse(body || "{}"); } catch { json(response, 400, { error: "bad JSON" }); return true; }

    const settings = await loadSettings();
    const clean = (v) => String(v || "").replace(/^\/+|\/+$/g, "").trim();

    if (payload.action === "add") {
      const p = clean(payload.path);
      // Anything outside Books/ or Scripts/ would be silently dropped by
      // drive-scan.mjs, so refuse it here rather than appear to accept it.
      if (!p || !/^(Books|Scripts)(\/|$)/.test(p)) {
        json(response, 400, { error: "Source must be inside Books/ or Scripts/." });
        return true;
      }
      if (settings.sources.some((s) => s.path === p)) {
        json(response, 409, { error: "That folder is already a source." });
        return true;
      }
      settings.sources.push({
        id: "s" + Date.now().toString(36),
        name: clean(payload.name) || p.split("/").pop(),
        path: p,
        enabled: true,
      });
    } else if (payload.action === "remove") {
      settings.sources = settings.sources.filter((s) => s.id !== payload.id);
      if (!settings.sources.length) {
        json(response, 400, { error: "Keep at least one source folder." });
        return true;
      }
    } else if (payload.action === "toggle") {
      const s = settings.sources.find((x) => x.id === payload.id);
      if (s) s.enabled = !s.enabled;
    } else if (payload.action === "dropFolder") {
      const p = clean(payload.path);
      if (!p || !/^(Books|Scripts)(\/|$)/.test(p)) {
        json(response, 400, { error: "Drop folder must be inside Books/ or Scripts/." });
        return true;
      }
      settings.dropFolder = p;
    } else {
      json(response, 400, { error: "unknown action" });
      return true;
    }
    await saveSettings(settings);
    json(response, 200, { sources: settings.sources, dropFolder: settings.dropFolder });
    return true;
  }

  if (path === "/api/settings/scan" && request.method === "POST") {
    const status = await readJson(STATUS, { state: "idle" });
    if (status.state === "running") {
      json(response, 409, { error: "A scan is already running.", status });
      return true;
    }
    let mode = "full";
    try {
      let body = "";
      for await (const chunk of request) { body += chunk; if (body.length > 4096) break; }
      if (JSON.parse(body || "{}").mode === "incremental") mode = "incremental";
    } catch { /* no body: a full scan */ }
    // The privileged rebuild is started by a systemd path unit watching this.
    // "incremental" lists only the drop folder and appends; "full" relists all
    // of Drive and rebuilds, so deleted books drop out.
    await writeFile(REQUEST, JSON.stringify({ requestedAt: new Date().toISOString(), mode }));
    // UMask=0077 would leave this 0600 and unreadable by the rebuild,
    // which runs as a different user and would silently fall back to a
    // full scan.
    await chmod(REQUEST, 0o644);
    json(response, 202, { state: "requested", mode });
    return true;
  }

  if (path === "/api/settings/gaps" && request.method === "GET") {
    const kind = url.searchParams.get("kind") || "cover";
    if (!["cover", "author", "title"].includes(kind)) {
      json(response, 400, { error: "unknown kind" });
      return true;
    }
    json(response, 200, await gapList(kind));
    return true;
  }

  return false;
}
