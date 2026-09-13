// The Reading Room — local library server.
// Serves the catalogue UI, proxies book downloads from Google Drive, syncs
// reading state across devices, and enriches covers from Open Library.
// Dependency-free: only Node built-ins.

import { createServer as createHttpServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { createReadStream, readFileSync } from "node:fs";
import { access, readFile, stat, mkdir, writeFile, rename, readdir, unlink } from "node:fs/promises";
import { extname, join, normalize, resolve, dirname } from "node:path";
import { homedir, networkInterfaces } from "node:os";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

const APP_VERSION = "1.1";
const startedAt = Date.now();
let shuttingDown = false;

// READING_ROOM_HOST is preferred on Linux. HOSTNAME remains as a legacy
// fallback for compatibility with the original macOS launcher.
const host = process.env.READING_ROOM_HOST || process.env.HOSTNAME || "0.0.0.0";
const port = Number(process.env.PORT || 4311);
const httpsPort = Number(process.env.READING_ROOM_HTTPS_PORT || port + 1);
const certPath = process.env.READING_ROOM_CERT || "";
const keyPath = process.env.READING_ROOM_KEY || "";
const siteRoot = resolve(process.env.READING_ROOM_SITE || join(process.cwd(), "site"));
const driveIdPattern = /^[A-Za-z0-9_-]{10,100}$/;

const dataDir = resolve(
  process.env.READING_ROOM_DATA ||
    join(homedir(), "Library", "Application Support", "The Reading Room")
);
const statePath = process.env.READING_ROOM_STATE || join(dataDir, "library-state.json");
const backupDir = join(dataDir, "state-backups");
const coverCachePath = join(dataDir, "cover-cache.json");
const titleFixPath = join(dataDir, "title-fixes.json");
const catalogPath = join(siteRoot, "catalog.json");

const MAX_STATE_BODY = 256 * 1024;
const BACKUP_MIN_INTERVAL = 60 * 60 * 1000;   // at most one state backup per hour
const BACKUP_KEEP = 10;
const STATIC_CACHE_MAX_BYTES = 6 * 1024 * 1024;   // per file kept in memory
const NEGATIVE_COVER_TTL = 45 * 24 * 60 * 60 * 1000;   // retry "no cover" after ~6 weeks

// Cover warmer: a global rate limit rather than a per-request sleep, so a large
// catalogue finishes in a reasonable time while staying polite to Open Library.
const WARMER_CONCURRENCY = Math.max(1, Number(process.env.READING_ROOM_WARM_CONCURRENCY || 4));
const WARMER_PER_SECOND = Math.max(0.2, Number(process.env.READING_ROOM_WARM_RATE || 3));

// ---------------------------------------------------------------------------
// QR encoder (byte mode, ECC level M, versions 1-10). Used by /connect so a
// phone can join the library without anyone typing an IP address.
// ---------------------------------------------------------------------------
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i += 1) GF_EXP[i] = GF_EXP[i - 255];
}
const gfMul = (a, b) => (a === 0 || b === 0 ? 0 : GF_EXP[GF_LOG[a] + GF_LOG[b]]);

function rsGenerator(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i += 1) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j += 1) {
      next[j] ^= gfMul(poly[j], 1);
      next[j + 1] ^= gfMul(poly[j], GF_EXP[i]);
    }
    poly = next;
  }
  return poly;
}

function rsEncode(data, ecCount) {
  const gen = rsGenerator(ecCount);
  const result = new Array(ecCount).fill(0);
  for (const byte of data) {
    const factor = byte ^ result[0];
    result.shift();
    result.push(0);
    for (let i = 0; i < ecCount; i += 1) result[i] ^= gfMul(gen[i + 1], factor);
  }
  return result;
}

const QR_VERSIONS = {
  1:  { ec: 10, groups: [[1, 16]] },
  2:  { ec: 16, groups: [[1, 28]] },
  3:  { ec: 26, groups: [[1, 44]] },
  4:  { ec: 18, groups: [[2, 32]] },
  5:  { ec: 24, groups: [[2, 43]] },
  6:  { ec: 16, groups: [[4, 27]] },
  7:  { ec: 18, groups: [[4, 31]] },
  8:  { ec: 22, groups: [[2, 38], [2, 39]] },
  9:  { ec: 22, groups: [[3, 36], [2, 37]] },
  10: { ec: 26, groups: [[4, 43], [1, 44]] },
};
const QR_ALIGNMENT = {
  1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
  6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
};
const QR_MASKS = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

const qrCapacity = (version) =>
  QR_VERSIONS[version].groups.reduce((sum, [count, size]) => sum + count * size, 0);

function bchFormat(value) {
  let d = value << 10;
  for (let i = 4; i >= 0; i -= 1) if (d & (1 << (i + 10))) d ^= 0x537 << i;
  return ((value << 10) | d) ^ 0x5412;
}

function bchVersion(version) {
  let d = version << 12;
  for (let i = 5; i >= 0; i -= 1) if (d & (1 << (i + 12))) d ^= 0x1f25 << i;
  return (version << 12) | d;
}

function qrCodewords(bytes, version) {
  const capacity = qrCapacity(version);
  const bits = [];
  const put = (value, length) => {
    for (let i = length - 1; i >= 0; i -= 1) bits.push((value >>> i) & 1);
  };
  put(0b0100, 4);                                   // byte mode
  put(bytes.length, version < 10 ? 8 : 16);         // character count
  for (const byte of bytes) put(byte, 8);
  const totalBits = capacity * 8;
  put(0, Math.min(4, totalBits - bits.length));     // terminator
  while (bits.length % 8) bits.push(0);

  const data = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j += 1) byte = (byte << 1) | bits[i + j];
    data.push(byte);
  }
  const PAD = [0xec, 0x11];
  for (let i = 0; data.length < capacity; i += 1) data.push(PAD[i % 2]);

  const { ec: ecCount, groups } = QR_VERSIONS[version];
  const dataBlocks = [];
  const ecBlocks = [];
  let offset = 0;
  for (const [count, size] of groups) {
    for (let i = 0; i < count; i += 1) {
      const block = data.slice(offset, offset + size);
      offset += size;
      dataBlocks.push(block);
      ecBlocks.push(rsEncode(block, ecCount));
    }
  }
  const out = [];
  const longest = Math.max(...dataBlocks.map((b) => b.length));
  for (let i = 0; i < longest; i += 1) {
    for (const block of dataBlocks) if (i < block.length) out.push(block[i]);
  }
  for (let i = 0; i < ecCount; i += 1) for (const block of ecBlocks) out.push(block[i]);
  return out;
}

function qrTemplate(version) {
  const size = version * 4 + 17;
  const modules = Array.from({ length: size }, () => new Array(size).fill(null));
  const reserved = Array.from({ length: size }, () => new Array(size).fill(false));
  const put = (row, col, value) => {
    if (row < 0 || col < 0 || row >= size || col >= size) return;
    modules[row][col] = value;
    reserved[row][col] = true;
  };
  for (const [baseRow, baseCol] of [[0, 0], [0, size - 7], [size - 7, 0]]) {
    for (let r = -1; r <= 7; r += 1) {
      for (let c = -1; c <= 7; c += 1) {
        const inside = r >= 0 && r <= 6 && c >= 0 && c <= 6;
        put(baseRow + r, baseCol + c, inside && (r === 0 || r === 6 || c === 0 || c === 6 ||
          (r >= 2 && r <= 4 && c >= 2 && c <= 4)));
      }
    }
  }
  for (let i = 8; i < size - 8; i += 1) {
    put(6, i, i % 2 === 0);
    put(i, 6, i % 2 === 0);
  }
  const centers = QR_ALIGNMENT[version];
  for (const row of centers) {
    for (const col of centers) {
      if ((row <= 8 && col <= 8) || (row <= 8 && col >= size - 9) ||
          (row >= size - 9 && col <= 8)) continue;
      for (let r = -2; r <= 2; r += 1) {
        for (let c = -2; c <= 2; c += 1) {
          put(row + r, col + c, Math.max(Math.abs(r), Math.abs(c)) !== 1);
        }
      }
    }
  }
  put(size - 8, 8, true);
  for (let i = 0; i < 9; i += 1) {
    if (modules[8][i] === null) put(8, i, false);
    if (modules[i][8] === null) put(i, 8, false);
  }
  for (let i = 0; i < 8; i += 1) {
    if (modules[8][size - 1 - i] === null) put(8, size - 1 - i, false);
    if (modules[size - 1 - i][8] === null) put(size - 1 - i, 8, false);
  }
  if (version >= 7) {
    for (let i = 0; i < 6; i += 1) {
      for (let j = 0; j < 3; j += 1) {
        if (modules[size - 11 + j][i] === null) put(size - 11 + j, i, false);
        if (modules[i][size - 11 + j] === null) put(i, size - 11 + j, false);
      }
    }
  }
  return { modules, reserved, size };
}

function qrPenalty(grid, size) {
  let score = 0;
  for (let i = 0; i < size; i += 1) {
    for (const byRow of [true, false]) {
      let run = 1;
      for (let j = 1; j < size; j += 1) {
        const prev = byRow ? grid[i][j - 1] : grid[j - 1][i];
        const cur = byRow ? grid[i][j] : grid[j][i];
        if (cur === prev) run += 1;
        else { if (run >= 5) score += run - 2; run = 1; }
      }
      if (run >= 5) score += run - 2;
    }
  }
  for (let r = 0; r < size - 1; r += 1) {
    for (let c = 0; c < size - 1; c += 1) {
      const v = grid[r][c];
      if (v === grid[r][c + 1] && v === grid[r + 1][c] && v === grid[r + 1][c + 1]) score += 3;
    }
  }
  const A = [true, false, true, true, true, false, true, false, false, false, false];
  const B = [false, false, false, false, true, false, true, true, true, false, true];
  const hits = (get, start) => {
    let a = true;
    let b = true;
    for (let k = 0; k < 11; k += 1) {
      const v = get(start + k);
      if (v !== A[k]) a = false;
      if (v !== B[k]) b = false;
    }
    return (a ? 1 : 0) + (b ? 1 : 0);
  };
  for (let i = 0; i < size; i += 1) {
    for (let j = 0; j <= size - 11; j += 1) {
      score += 40 * hits((k) => grid[i][k], j);
      score += 40 * hits((k) => grid[k][i], j);
    }
  }
  let dark = 0;
  for (let r = 0; r < size; r += 1) for (let c = 0; c < size; c += 1) if (grid[r][c]) dark += 1;
  score += Math.floor(Math.abs((dark * 100) / (size * size) - 50) / 5) * 10;
  return score;
}

function qrMatrix(text) {
  const bytes = [...Buffer.from(text, "utf8")];
  let version = 0;
  for (let v = 1; v <= 10; v += 1) {
    if (bytes.length * 8 + 4 + (v < 10 ? 8 : 16) <= qrCapacity(v) * 8) { version = v; break; }
  }
  if (!version) throw new Error("Text too long for QR");
  const codewords = qrCodewords(bytes, version);
  const { modules, reserved, size } = qrTemplate(version);

  let bitIndex = 0;
  let upward = true;
  for (let right = size - 1; right > 0; right -= 2) {
    if (right === 6) right -= 1;
    for (let step = 0; step < size; step += 1) {
      const row = upward ? size - 1 - step : step;
      for (const col of [right, right - 1]) {
        if (reserved[row][col]) continue;
        const byte = codewords[bitIndex >> 3];
        modules[row][col] = byte !== undefined && ((byte >>> (7 - (bitIndex & 7))) & 1) === 1;
        bitIndex += 1;
      }
    }
    upward = !upward;
  }

  let best = null;
  for (let mask = 0; mask < 8; mask += 1) {
    const grid = modules.map((row, r) =>
      row.map((v, c) => (reserved[r][c] ? v : v !== QR_MASKS[mask](r, c))));
    const fbits = bchFormat((0b00 << 3) | mask);      // 0b00 = ECC level M
    const at = (i) => ((fbits >>> (14 - i)) & 1) === 1;
    for (let i = 0; i <= 5; i += 1) grid[8][i] = at(i);
    grid[8][7] = at(6);
    grid[8][8] = at(7);
    grid[7][8] = at(8);
    for (let i = 9; i <= 14; i += 1) grid[14 - i][8] = at(i);
    for (let i = 0; i <= 6; i += 1) grid[size - 1 - i][8] = at(i);
    for (let i = 7; i <= 14; i += 1) grid[8][size - 15 + i] = at(i);
    grid[size - 8][8] = true;
    if (version >= 7) {
      const vbits = bchVersion(version);
      for (let i = 0; i < 18; i += 1) {
        const bit = ((vbits >>> i) & 1) === 1;
        grid[Math.floor(i / 3)][size - 11 + (i % 3)] = bit;
        grid[size - 11 + (i % 3)][Math.floor(i / 3)] = bit;
      }
    }
    const score = qrPenalty(grid, size);
    if (!best || score < best.score) best = { score, grid };
  }
  return best.grid;
}

function qrSvg(text, { size = 260, quiet = 3, dark = "#26332f", light = "#fffdf7" } = {}) {
  const grid = qrMatrix(text);
  const span = grid.length + quiet * 2;
  let path = "";
  for (let r = 0; r < grid.length; r += 1) {
    for (let c = 0; c < grid.length; c += 1) {
      if (grid[r][c]) path += `M${c + quiet} ${r + quiet}h1v1h-1z`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" ` +
    `viewBox="0 0 ${span} ${span}" shape-rendering="crispEdges" role="img" aria-label="QR code">` +
    `<rect width="${span}" height="${span}" rx="1" fill="${light}"/>` +
    `<path d="${path}" fill="${dark}"/></svg>`;
}

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------
function normalized(value) {
  return (value || "").normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function similarity(left, right) {
  const a = new Set(normalized(left).split(" ").filter((w) => w.length > 1));
  const b = new Set(normalized(right).split(" ").filter((w) => w.length > 1));
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared += 1;
  return shared / Math.min(a.size, b.size);
}

function sendJson(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  response.end(body);
}

const acceptsGzip = (request) => /\bgzip\b/.test(request.headers["accept-encoding"] || "");
const escapeHtml = (s) => String(s).replace(/[&<>"']/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// A title that ends mid-word or on a dangling stop-word / open paren.
function isTruncated(title) {
  if (!title) return false;
  if (/[A-Za-z]_$/.test(title)) return true;
  if (title.endsWith("(") || /\(v[\d.]*$/.test(title)) return true;
  if (/[a-z]\s+(of|on|to|and|the|a|an|my|from|in|for|as|at|is)$/.test(title)) return true;
  if (/\b\d+\s+of$/.test(title)) return true;
  return false;
}

function lanAddress() {
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family !== "IPv4" || entry.internal) continue;
      if (/^169\.254\./.test(entry.address)) continue;
      return entry.address;
    }
  }
  return "";
}

// ---------------------------------------------------------------------------
// Reading state (cross-device sync) + rotating backups
// ---------------------------------------------------------------------------
const libraryState = new Map();
let writeChain = Promise.resolve();
let lastBackupAt = 0;

async function loadLibraryState() {
  try {
    const parsed = JSON.parse(await readFile(statePath, "utf8"));
    const states = Array.isArray(parsed) ? parsed : parsed?.states || [];
    for (const s of states) if (s && typeof s.bookId === "string") libraryState.set(s.bookId, s);
    console.log(`Loaded ${libraryState.size} reading states from ${statePath}`);
  } catch (error) {
    if (error?.code !== "ENOENT") console.error("Could not read reading state:", error.message);
  }
}

async function rotateBackup(snapshot) {
  const now = Date.now();
  if (now - lastBackupAt < BACKUP_MIN_INTERVAL) return;
  lastBackupAt = now;
  try {
    await mkdir(backupDir, { recursive: true });
    const stamp = new Date(now).toISOString().replace(/[:.]/g, "-");
    await writeFile(join(backupDir, `library-state.${stamp}.json`), snapshot);
    const files = (await readdir(backupDir)).filter((f) => f.startsWith("library-state.")).sort();
    for (const stale of files.slice(0, Math.max(0, files.length - BACKUP_KEEP))) {
      await unlink(join(backupDir, stale)).catch(() => {});
    }
  } catch (error) {
    console.error("Could not write state backup:", error.message);
  }
}

function persistLibraryState() {
  const snapshot = JSON.stringify({ states: [...libraryState.values()] });
  writeChain = writeChain
    .then(async () => {
      await mkdir(dirname(statePath), { recursive: true });
      const tmp = join(dirname(statePath), `.library-state.${process.pid}.tmp`);
      await writeFile(tmp, snapshot);
      await rename(tmp, statePath);
      await rotateBackup(snapshot);
    })
    .catch((error) => console.error("Could not save reading state:", error.message));
  return writeChain;
}

function readRequestBody(request, limit) {
  return new Promise((resolveBody, reject) => {
    let size = 0;
    const chunks = [];
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) { reject(new Error("Payload too large")); request.destroy(); return; }
      chunks.push(chunk);
    });
    request.on("end", () => resolveBody(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

async function handleLibraryState(request, response) {
  if (request.method === "GET") {
    sendJson(response, 200, { states: [...libraryState.values()], storage: "server" });
    return;
  }
  if (request.method === "POST") {
    let incoming;
    try { incoming = JSON.parse(await readRequestBody(request, MAX_STATE_BODY) || "{}"); }
    catch { sendJson(response, 400, { saved: false, error: "Invalid JSON" }); return; }
    const items = Array.isArray(incoming) ? incoming : [incoming];
    let changed = false;
    for (const item of items) {
      if (!item || typeof item.bookId !== "string") continue;
      const previous = libraryState.get(item.bookId);
      const incomingAt = Number(item.updatedAt) || 0;
      const previousAt = Number(previous?.updatedAt) || 0;
      if (previous && incomingAt !== 0 && previousAt > incomingAt) continue;
      libraryState.set(item.bookId, { ...previous, ...item });
      changed = true;
    }
    if (changed) await persistLibraryState();
    sendJson(response, 200, { saved: changed, storage: "server" });
    return;
  }
  sendJson(response, 405, { saved: false, error: "Method not allowed" });
}

// ---------------------------------------------------------------------------
// Catalog (with title-fix overrides applied) + cover cache
// ---------------------------------------------------------------------------
let catalog = [];
let titleFixes = {};                 // bookId -> corrected title
const coverCache = new Map();        // normkey -> { coverId } | { none: true, at }
let catalogGzip = null;
let catalogBuffer = null;
let catalogEtag = "";
let coverCacheDirty = false;
let appCssHref = "";                 // hashed stylesheet from the built site
const warmerProgress = { total: 0, done: 0, running: false, fixes: 0 };

async function loadCatalogAndCaches() {
  try { catalog = JSON.parse(await readFile(catalogPath, "utf8")); }
  catch (error) { console.error("Could not read catalog:", error.message); catalog = []; }
  try { titleFixes = JSON.parse(await readFile(titleFixPath, "utf8")); } catch { titleFixes = {}; }
  try {
    const raw = JSON.parse(await readFile(coverCachePath, "utf8"));
    for (const [k, v] of Object.entries(raw)) coverCache.set(k, v);
    console.log(`Loaded ${coverCache.size} cached covers`);
  } catch { /* first run */ }
  try {
    const html = await readFile(join(siteRoot, "index.html"), "utf8");
    appCssHref = (html.match(/href="(\/assets\/index-[^"]+\.css)"/) || [])[1] || "";
  } catch { /* stats page falls back to its own styles */ }
  rebuildCatalog();
}

function rebuildCatalog() {
  const merged = catalog.map((b) =>
    titleFixes[b.id] && titleFixes[b.id] !== b.title ? { ...b, title: titleFixes[b.id] } : b);
  catalogBuffer = Buffer.from(JSON.stringify(merged));
  catalogGzip = gzipSync(catalogBuffer, { level: 6 });
  catalogEtag = `"${createHash("sha1").update(catalogBuffer).digest("hex").slice(0, 16)}"`;
}

let coverPersistTimer = null;
function scheduleCoverPersist() {
  coverCacheDirty = true;
  if (coverPersistTimer) return;
  coverPersistTimer = setTimeout(() => { coverPersistTimer = null; flushCoverCache(); }, 3000);
}

async function flushCoverCache() {
  if (!coverCacheDirty) return;
  coverCacheDirty = false;
  try {
    await mkdir(dataDir, { recursive: true });
    const tmp = join(dataDir, `.cover-cache.${process.pid}.tmp`);
    await writeFile(tmp, JSON.stringify(Object.fromEntries(coverCache)));
    await rename(tmp, coverCachePath);
  } catch (error) { console.error("Could not save cover cache:", error.message); }
}

async function saveTitleFixes() {
  try {
    await mkdir(dataDir, { recursive: true });
    const tmp = join(dataDir, `.title-fixes.${process.pid}.tmp`);
    await writeFile(tmp, JSON.stringify(titleFixes));
    await rename(tmp, titleFixPath);
  } catch (error) { console.error("Could not save title fixes:", error.message); }
}

// Resolve a cover (and canonical title) from Open Library. Never throws.
async function resolveFromOpenLibrary(title, author) {
  try {
    const query = new URLSearchParams({ title, fields: "title,author_name,cover_i", limit: "5", lang: "en" });
    if (author) query.set("author", author);
    const upstream = await fetch(`https://openlibrary.org/search.json?${query}`, {
      headers: { Accept: "application/json", "User-Agent": "TheReadingRoom/1.1 (personal library)" },
      signal: AbortSignal.timeout(12000),
    });
    if (!upstream.ok) return null;
    const payload = await upstream.json();
    const docs = (payload.docs || []).slice().sort((a, b) => {
      const score = (it) => similarity(title, it.title || "") +
        (author ? similarity(author, (it.author_name || []).join(" ")) * 0.35 : 0);
      return score(b) - score(a);
    });
    const best = docs[0];
    if (best && similarity(title, best.title || "") >= 0.62) {
      return { coverId: best.cover_i || null, olTitle: best.title || null };
    }
  } catch { /* offline / rate limited: caller falls back */ }
  return null;
}

const OL_FORMATS = new Set(["EPUB", "MOBI", "AZW", "AZW3", "KF8", "CBR", "CBZ", "FB2"]);
const DRIVE_THUMB_FORMATS = new Set(["PDF", "DOC", "DOCX", "RTF", "TXT", "FDX"]);

const isFreshMiss = (entry) => entry?.none === true &&
  (!entry.at || Date.now() - entry.at < NEGATIVE_COVER_TTL);

async function cover(response, url) {
  const title = (url.searchParams.get("title") || "").slice(0, 180).trim();
  const author = (url.searchParams.get("author") || "").slice(0, 100).trim();
  const id = url.searchParams.get("id") || "";
  const format = (url.searchParams.get("format") || "").toUpperCase();
  if (!title) { response.writeHead(400).end("Missing title"); return; }

  if (DRIVE_THUMB_FORMATS.has(format) && driveIdPattern.test(id)) {
    response.writeHead(302, {
      location: `https://drive.google.com/thumbnail?id=${encodeURIComponent(id)}&sz=w500`,
      "cache-control": "public, max-age=86400",
    }).end();
    return;
  }

  const key = `${normalized(title)}|${normalized(author)}`;
  const cached = coverCache.get(key);
  if (cached?.coverId) {
    response.writeHead(302, {
      location: `https://covers.openlibrary.org/b/id/${cached.coverId}-M.jpg`,
      "cache-control": "public, max-age=604800",
    }).end();
    return;
  }
  if (isFreshMiss(cached)) {
    response.writeHead(404, { "cache-control": "public, max-age=86400" }).end("Cover unavailable");
    return;
  }

  const resolved = await resolveFromOpenLibrary(title, author);
  if (resolved?.coverId) {
    coverCache.set(key, { coverId: resolved.coverId });
    scheduleCoverPersist();
    response.writeHead(302, {
      location: `https://covers.openlibrary.org/b/id/${resolved.coverId}-M.jpg`,
      "cache-control": "public, max-age=604800",
    }).end();
    return;
  }
  coverCache.set(key, { none: true, at: Date.now() });
  scheduleCoverPersist();
  response.writeHead(404, { "cache-control": "public, max-age=86400" }).end("Cover unavailable");
}

// Background warmer: fills the cover cache and repairs truncated titles.
// Runs a few workers behind a shared rate limit, so a large catalogue finishes
// in minutes rather than hours without hammering Open Library.
async function runWarmer() {
  const seen = new Set();
  const work = [];
  for (const b of catalog) {
    if (!OL_FORMATS.has(b.format)) continue;
    const key = `${normalized(b.title)}|${normalized(b.author)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const cached = coverCache.get(key);
    if (cached?.coverId || isFreshMiss(cached)) continue;
    work.push({ key, id: b.id, title: b.title, author: b.author });
  }
  if (!work.length) { console.log("Cover cache already warm."); return; }

  warmerProgress.total = work.length;
  warmerProgress.done = 0;
  warmerProgress.running = true;
  console.log(`Warming ${work.length} covers (${WARMER_CONCURRENCY} workers, ${WARMER_PER_SECOND}/s)…`);

  const spacing = 1000 / WARMER_PER_SECOND;
  let nextSlot = Date.now();
  const takeSlot = async () => {
    const now = Date.now();
    const at = Math.max(now, nextSlot);
    nextSlot = at + spacing;
    if (at > now) await new Promise((r) => setTimeout(r, at - now));
  };

  let cursor = 0;
  const worker = async () => {
    while (cursor < work.length && !shuttingDown) {
      const item = work[cursor];
      cursor += 1;
      await takeSlot();
      const resolved = await resolveFromOpenLibrary(item.title, item.author);
      coverCache.set(item.key,
        resolved?.coverId ? { coverId: resolved.coverId } : { none: true, at: Date.now() });
      scheduleCoverPersist();
      if (resolved?.olTitle && isTruncated(item.title) && !titleFixes[item.id]) {
        const stem = item.title.replace(/[\s(_]+$/, "").trim();
        if (normalized(resolved.olTitle).startsWith(normalized(stem)) &&
            resolved.olTitle.length > stem.length) {
          titleFixes[item.id] = resolved.olTitle;
          warmerProgress.fixes += 1;
          if (warmerProgress.fixes % 10 === 0) { await saveTitleFixes(); rebuildCatalog(); }
        }
      }
      warmerProgress.done += 1;
      if (warmerProgress.done % 250 === 0) {
        console.log(`  covers: ${warmerProgress.done}/${work.length}`);
      }
    }
  };
  await Promise.all(Array.from({ length: WARMER_CONCURRENCY }, worker));
  if (warmerProgress.fixes) { await saveTitleFixes(); rebuildCatalog(); }
  await flushCoverCache();
  warmerProgress.running = false;
  console.log(`Warmer done. Repaired ${warmerProgress.fixes} truncated titles.`);
}

// ---------------------------------------------------------------------------
// Shared page chrome for the server-rendered pages (/stats, /connect)
// ---------------------------------------------------------------------------
function pageShell(title, subtitle, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#f3efe5">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<title>The Reading Room — ${escapeHtml(title)}</title>
${appCssHref ? `<link rel="preload" as="style" href="${appCssHref}">` : ""}
<style>
:root{--paper:#f3efe5;--paper-2:#e8e2d3;--ink:#26332f;--muted:#6f776f;--sage:#819387;--line:#d3ccbb;--white:#fffdf7}
@media(prefers-color-scheme:dark){:root{--paper:#171918;--paper-2:#1e2220;--ink:#e8e4d8;--muted:#9aa39c;--sage:#819387;--line:#2c3230;--white:#1e2220}}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);
 font:16px/1.55 ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
 -webkit-font-smoothing:antialiased}
a{color:inherit}
.topbar{display:flex;align-items:center;gap:12px;padding:16px 24px;border-bottom:1px solid var(--line);
 background:var(--white);position:sticky;top:0;z-index:5}
.mark{width:34px;height:34px;border-radius:10px;background:var(--ink);color:var(--white);
 display:grid;place-items:center;font-weight:700;font-size:17px;flex:none}
.brand strong{display:block;font-size:15px;letter-spacing:-.01em}
.brand small{display:block;font-size:10px;letter-spacing:.14em;color:var(--muted);text-transform:uppercase}
.topbar nav{margin-left:auto;display:flex;gap:6px}
.topbar nav a{padding:7px 14px;border-radius:999px;text-decoration:none;font-size:13.5px;
 border:1px solid transparent;color:var(--muted)}
.topbar nav a:hover{background:var(--paper-2);color:var(--ink)}
.topbar nav a[aria-current]{background:var(--ink);color:var(--white)}
.wrap{max-width:960px;margin:0 auto;padding:36px 24px 72px}
.eyebrow{margin:0 0 6px;font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--sage)}
h1{font-size:clamp(28px,5vw,40px);line-height:1.1;margin:0 0 8px;letter-spacing:-.02em}
.lede{margin:0 0 32px;color:var(--muted);max-width:60ch}
h2{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--sage);margin:0 0 12px}
.cards{display:grid;grid-template-columns:repeat(6,1fr);gap:12px;margin-bottom:36px}
@media(max-width:900px){.cards{grid-template-columns:repeat(3,1fr)}}
@media(max-width:520px){.cards{grid-template-columns:repeat(2,1fr)}}
.card{background:var(--white);border:1px solid var(--line);border-radius:14px;padding:16px 18px}
.card b{display:block;font-size:29px;line-height:1.1;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.card span{display:block;margin-top:4px;font-size:12.5px;color:var(--muted)}
.panel{background:var(--white);border:1px solid var(--line);border-radius:16px;padding:22px 24px;margin-bottom:20px}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:20px;align-items:start}
@media(max-width:720px){.grid2{grid-template-columns:1fr}}
.bars{display:grid;gap:9px}
.bar{display:grid;grid-template-columns:1fr auto;gap:10px;align-items:center;font-size:14px}
.bar i{grid-column:1/-1;height:5px;border-radius:3px;background:var(--paper-2);display:block;overflow:hidden}
.bar i em{display:block;height:100%;background:var(--sage);border-radius:3px}
.bar span{color:var(--muted);font-variant-numeric:tabular-nums;font-size:13px}
.rows{list-style:none;margin:0;padding:0;display:grid;gap:2px}
.rows li{display:flex;gap:12px;align-items:baseline;padding:7px 0;border-bottom:1px solid var(--line)}
.rows li:last-child{border-bottom:0}
.rows li .t{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rows li .m{color:var(--muted);font-size:12.5px;white-space:nowrap}
.muted{color:var(--muted)}
.empty{color:var(--muted);font-size:14.5px;padding:6px 0}
footer{max-width:960px;margin:0 auto;padding:0 24px 48px;color:var(--muted);font-size:12.5px}
</style></head><body>
<header class="topbar"><span class="mark">R</span><span class="brand"><strong>The Reading Room</strong>
<small>Private digital library</small></span>
<nav><a href="/">Library</a><a href="/stats"${title === "Stats" ? ' aria-current="page"' : ""}>Stats</a>
<a href="/connect"${title === "Connect" ? ' aria-current="page"' : ""}>Phone</a></nav></header>
<main class="wrap"><p class="eyebrow">${escapeHtml(subtitle)}</p>${body}</main>
<footer>The Reading Room ${APP_VERSION} · covers enriched by
<a href="https://openlibrary.org" target="_blank" rel="noreferrer">Open Library</a></footer>
</body></html>`;
}

// ---------------------------------------------------------------------------
// /stats
// ---------------------------------------------------------------------------
const DAY = 24 * 60 * 60 * 1000;
const dayKey = (ms) => new Date(ms).toISOString().slice(0, 10);

function streaks(states) {
  const days = new Set(states.filter((s) => s.lastOpened).map((s) => dayKey(s.lastOpened)));
  if (!days.size) return { current: 0, longest: 0, days: 0 };
  const sorted = [...days].sort();
  let longest = 1;
  let run = 1;
  for (let i = 1; i < sorted.length; i += 1) {
    const gap = (Date.parse(sorted[i]) - Date.parse(sorted[i - 1])) / DAY;
    run = gap === 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
  }
  let current = 0;
  const today = Date.parse(dayKey(Date.now()));
  if (days.has(dayKey(today)) || days.has(dayKey(today - DAY))) {
    let cursor = days.has(dayKey(today)) ? today : today - DAY;
    while (days.has(dayKey(cursor))) { current += 1; cursor -= DAY; }
  }
  return { current, longest, days: days.size };
}

function barList(counts, limit = 8) {
  const entries = Object.entries(counts).filter(([k]) => k).sort((a, b) => b[1] - a[1]).slice(0, limit);
  if (!entries.length) return `<p class="empty">Nothing here yet.</p>`;
  const top = entries[0][1] || 1;
  return `<div class="bars">${entries.map(([label, value]) => `<div class="bar">
<span style="color:var(--ink);flex:1">${escapeHtml(label)}</span><span>${value.toLocaleString()}</span>
<i><em style="width:${Math.max(3, (value / top) * 100)}%"></em></i></div>`).join("")}</div>`;
}

function statsPage() {
  const states = [...libraryState.values()];
  const finished = states.filter((s) => s.status === "finished");
  const reading = states.filter((s) => s.status === "reading");
  const favorites = states.filter((s) => s.favorite).length;
  const streak = streaks(states);

  const formats = {};
  const categories = {};
  const authors = {};
  const collections = {};
  const seriesSet = new Set();
  let readable = 0;
  for (const b of catalog) {
    formats[b.format] = (formats[b.format] || 0) + 1;
    categories[b.category] = (categories[b.category] || 0) + 1;
    if (b.author) authors[b.author] = (authors[b.author] || 0) + 1;
    for (const c of b.collections || []) collections[c] = (collections[c] || 0) + 1;
    if (b.series) seriesSet.add(b.series);
    if (OL_FORMATS.has(b.format) || b.format === "PDF") readable += 1;
  }

  const byId = new Map(catalog.map((b) => [b.id, { ...b, title: titleFixes[b.id] || b.title }]));
  const label = (s) => {
    const book = byId.get(s.bookId);
    return book ? `${book.title}${book.author ? ` — ${book.author}` : ""}` : s.bookId;
  };
  const when = (ms) => {
    if (!ms) return "";
    const days = Math.floor((Date.now() - ms) / DAY);
    if (days <= 0) return "today";
    if (days === 1) return "yesterday";
    if (days < 30) return `${days} days ago`;
    return new Date(ms).toLocaleDateString(undefined, { month: "short", year: "numeric" });
  };
  const listOf = (items, empty) => (items.length
    ? `<ul class="rows">${items.map((s) => `<li><span class="t">${escapeHtml(label(s))}</span>
<span class="m">${escapeHtml(when(s.lastOpened))}</span></li>`).join("")}</ul>`
    : `<p class="empty">${empty}</p>`);

  const recent = states.filter((s) => s.lastOpened)
    .sort((a, b) => b.lastOpened - a.lastOpened).slice(0, 10);
  const inProgress = reading.slice()
    .sort((a, b) => (b.lastOpened || 0) - (a.lastOpened || 0)).slice(0, 10);
  const doneRecently = finished.slice()
    .sort((a, b) => (b.lastOpened || 0) - (a.lastOpened || 0)).slice(0, 10);

  const coversKnown = [...coverCache.values()].filter((v) => v.coverId).length;
  const warmNote = warmerProgress.running
    ? `Looking up covers — ${warmerProgress.done.toLocaleString()} of ${warmerProgress.total.toLocaleString()} done.`
    : `${coversKnown.toLocaleString()} covers matched from Open Library.`;

  const body = `
<h1>Your reading room</h1>
<p class="lede">${catalog.length.toLocaleString()} titles across ${Object.keys(categories).length}
categories, ${seriesSet.size.toLocaleString()} series and
${Object.keys(authors).length.toLocaleString()} authors. ${escapeHtml(warmNote)}</p>

<div class="cards">
<div class="card"><b>${catalog.length.toLocaleString()}</b><span>books in the library</span></div>
<div class="card"><b>${finished.length.toLocaleString()}</b><span>finished</span></div>
<div class="card"><b>${reading.length.toLocaleString()}</b><span>in progress</span></div>
<div class="card"><b>${favorites.toLocaleString()}</b><span>favourites</span></div>
<div class="card"><b>${streak.current}</b><span>day streak${streak.longest > streak.current ? ` · best ${streak.longest}` : ""}</span></div>
<div class="card"><b>${readable.toLocaleString()}</b><span>readable in the browser</span></div>
</div>

<div class="grid2">
<section class="panel"><h2>Continue reading</h2>${listOf(inProgress, "Nothing in progress — open a book to start.")}</section>
<section class="panel"><h2>Recently finished</h2>${listOf(doneRecently, "No finished books yet.")}</section>
</div>

<section class="panel"><h2>Recently opened</h2>${listOf(recent, "Nothing opened yet.")}</section>

<div class="grid2">
<section class="panel"><h2>By format</h2>${barList(formats)}</section>
<section class="panel"><h2>By category</h2>${barList(categories)}</section>
</div>
<div class="grid2">
<section class="panel"><h2>Most-collected authors</h2>${barList(authors)}</section>
<section class="panel"><h2>Collections</h2>${barList(collections)}</section>
</div>`;
  return pageShell("Stats", "Library & reading stats", body);
}

// ---------------------------------------------------------------------------
// /connect — pair a phone or tablet without typing an IP address
// ---------------------------------------------------------------------------
function connectPage(request) {
  // Tailscale Serve forwards the original tailnet hostname to this localhost
  // service. Reuse it for a QR code without trusting arbitrary Host content.
  const authority = String(request.headers.host || "").replace(/[^A-Za-z0-9.:[\]-]/g, "");
  const isTailscaleHost = /\.ts\.net(?::\d+)?$/i.test(authority);
  const forwardedProto = String(request.headers["x-forwarded-proto"] || "").toLowerCase();
  const protocol = isTailscaleHost || forwardedProto === "https" ? "https" : "http";
  const publicUrl = authority ? `${protocol}://${authority}` : "";
  if (!publicUrl) {
    return pageShell("Connect", "Read on your phone", `<h1>Open through Tailscale</h1>
<p class="lede">Run <code>sudo tailscale serve status</code> on the Pi to see this library's
private HTTPS address.</p>`);
  }
  const panel = (heading, url, note) => `<section class="panel" style="text-align:center">
<h2>${heading}</h2>
<div style="margin:6px 0 14px">${qrSvg(url, { size: 232 })}</div>
<p style="margin:0;font-size:15px;font-variant-numeric:tabular-nums"><code>${escapeHtml(url)}</code></p>
<p class="muted" style="margin:8px 0 0;font-size:13px">${note}</p></section>`;

  return pageShell("Connect", "Read on your phone", `
<h1>Point your camera here</h1>
<p class="lede">Connect Tailscale on the iPhone, scan the code, then use
<b>Share → Add to Home Screen</b> to keep the library one tap away.</p>
${panel("Scan to open", publicUrl, "Private to devices permitted by your Tailscale network.")}
<section class="panel"><h2>If it doesn't connect</h2>
<ul class="rows">
<li><span class="t">Confirm Tailscale shows connected on both the Pi and iPhone.</span></li>
<li><span class="t">Keep the Pi powered on and connected to the internet.</span></li>
<li><span class="t">On the Pi, check <code>sudo systemctl status reading-room</code>.</span></li>
</ul></section>`);
}

// ---------------------------------------------------------------------------
// Static assets (cached in memory, ETag + immutable hashed assets)
// ---------------------------------------------------------------------------
const mimeTypes = {
  ".css": "text/css; charset=utf-8", ".html": "text/html; charset=utf-8", ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg",
  ".svg": "image/svg+xml", ".wasm": "application/wasm", ".woff2": "font/woff2",
  ".webmanifest": "application/manifest+json; charset=utf-8", ".txt": "text/plain; charset=utf-8",
};
const GZIP_TYPES = new Set([".css", ".html", ".js", ".json", ".map", ".svg", ".webmanifest", ".txt"]);
const HASHED_ASSET = /-[A-Za-z0-9_-]{8,}\.[a-z0-9]+$/;
const OVERLAY_ASSET = /(reader-fix|library-fix|read-aloud)\.(css|js)$/;

const staticCache = new Map();       // relative path -> entry

function respond(request, response, entry, extraHeaders = {}) {
  if (request.headers["if-none-match"] === entry.etag) {
    response.writeHead(304, { etag: entry.etag, "cache-control": entry.cacheControl });
    response.end();
    return;
  }
  const useGzip = entry.gzip && acceptsGzip(request);
  const payload = useGzip ? entry.gzip : entry.buffer;
  const headers = {
    "content-type": entry.type,
    "content-length": payload.length,
    "cache-control": entry.cacheControl,
    etag: entry.etag,
    ...extraHeaders,
  };
  if (entry.gzip) headers.vary = "Accept-Encoding";
  if (useGzip) headers["content-encoding"] = "gzip";
  response.writeHead(200, headers);
  response.end(request.method === "HEAD" ? undefined : payload);
}

function makeEntry(buffer, type, cacheControl, compress = true) {
  const gzip = compress && buffer.length > 512 ? gzipSync(buffer, { level: 6 }) : null;
  return {
    buffer,
    gzip: gzip && gzip.length < buffer.length ? gzip : null,
    type,
    cacheControl,
    etag: `"${createHash("sha1").update(buffer).digest("hex").slice(0, 16)}"`,
  };
}

async function serveFile(request, response, pathname) {
  const relative = pathname === "/" ? "index.html" : decodeURIComponent(pathname).replace(/^\/+/, "");
  const safePath = normalize(relative);
  const filePath = resolve(siteRoot, safePath);
  if (filePath !== siteRoot && !filePath.startsWith(`${siteRoot}/`)) {
    response.writeHead(403).end("Forbidden");
    return;
  }

  const cached = staticCache.get(safePath);
  if (cached) { respond(request, response, cached); return; }

  try {
    await access(filePath);
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error("Not a file");
    const ext = extname(filePath).toLowerCase();
    const type = mimeTypes[ext] || "application/octet-stream";
    // Files added on top of the build are edited by hand, so they must always
    // be revalidated — a stale copy here is invisible and very confusing.
    const overlay = OVERLAY_ASSET.test(safePath);
    const immutable = !overlay && safePath.startsWith("assets/") && HASHED_ASSET.test(safePath);
    const cacheControl = safePath === "index.html" || overlay ? "no-cache"
      : immutable ? "public, max-age=31536000, immutable" : "public, max-age=3600";

    if (info.size <= STATIC_CACHE_MAX_BYTES) {
      const entry = makeEntry(await readFile(filePath), type, cacheControl, GZIP_TYPES.has(ext));
      staticCache.set(safePath, entry);
      respond(request, response, entry);
      return;
    }
    // Too large to hold in memory: stream it straight through.
    response.writeHead(200, { "content-type": type, "content-length": info.size, "cache-control": cacheControl });
    if (request.method === "HEAD") response.end();
    else createReadStream(filePath).pipe(response);
  } catch {
    // Unknown path: hand back the app shell so client-side routing works.
    let shell = staticCache.get("index.html");
    if (!shell) {
      try {
        shell = makeEntry(await readFile(join(siteRoot, "index.html")), "text/html; charset=utf-8", "no-cache");
        staticCache.set("index.html", shell);
      } catch {
        response.writeHead(404).end("Not found");
        return;
      }
    }
    respond(request, response, shell);
  }
}

// ---------------------------------------------------------------------------
// Book proxy (Google Drive)
// ---------------------------------------------------------------------------
const bookMimeTypes = {
  EPUB: "application/epub+zip", MOBI: "application/x-mobipocket-ebook",
  AZW: "application/vnd.amazon.ebook", AZW3: "application/vnd.amazon.ebook",
  KF8: "application/vnd.amazon.ebook", PDF: "application/pdf",
  CBR: "application/x-cbr", CBZ: "application/vnd.comicbook+zip",
};

function driveDownloadUrl(id, extra) {
  const u = new URL("https://drive.usercontent.google.com/download");
  u.searchParams.set("id", id);
  u.searchParams.set("export", "download");
  for (const [k, v] of Object.entries(extra || {})) u.searchParams.set(k, v);
  return u.toString();
}

// Parse Google Drive's "can't scan for viruses" interstitial form so we can
// re-request the real bytes with the confirm token + uuid it embeds.
export function parseDriveConfirm(html, id) {
  const params = {};
  const inputRe = /<input\b[^>]*>/gi;
  let m;
  while ((m = inputRe.exec(html))) {
    const tag = m[0];
    if (!/type=["']?hidden/i.test(tag)) continue;
    const name = (tag.match(/name=["']([^"']+)["']/i) || [])[1];
    if (!name) continue;
    params[name] = (tag.match(/value=["']([^"']*)["']/i) || [])[1] || "";
  }
  if (!params.confirm) {
    const c = (html.match(/[?&]confirm=([0-9A-Za-z_-]+)/) || [])[1];
    if (c) params.confirm = c;
  }
  params.id = params.id || id;
  params.export = "download";
  return params;
}

async function fetchDriveFile(id, range, signal) {
  const headers = { Accept: "application/octet-stream" };
  if (range) headers.Range = range;
  let resp = await fetch(driveDownloadUrl(id, { confirm: "t" }), { redirect: "follow", headers, signal });
  let ctype = resp.headers.get("content-type") || "";
  if (resp.ok && ctype.includes("text/html")) {
    const html = await resp.text();
    resp = await fetch(driveDownloadUrl(id, parseDriveConfirm(html, id)), { redirect: "follow", headers, signal });
    ctype = resp.headers.get("content-type") || "";
  }
  return { resp, ctype };
}

async function proxyBook(request, response, url) {
  const id = decodeURIComponent(url.pathname.slice("/api/book/".length));
  if (!driveIdPattern.test(id)) { response.writeHead(400).end("Invalid book identifier"); return; }
  const format = (url.searchParams.get("format") || "EPUB").toUpperCase();
  const mimeType = bookMimeTypes[format] || "application/octet-stream";

  // Abort the upstream transfer if the reader navigates away mid-download.
  const controller = new AbortController();
  const abort = () => controller.abort();
  request.on("aborted", abort);
  response.on("close", () => { if (!response.writableFinished) abort(); });

  let upstream;
  let contentType;
  try {
    ({ resp: upstream, ctype: contentType } = await fetchDriveFile(id, request.headers.range, controller.signal));
  } catch (error) {
    if (!response.headersSent) response.writeHead(502).end("The book could not be retrieved from Drive");
    return;
  }
  if (!upstream.ok || !upstream.body || contentType.includes("text/html")) {
    response.writeHead(upstream.status >= 400 ? upstream.status : 502)
      .end("The book could not be retrieved from Drive");
    return;
  }
  const headers = {
    "content-type": mimeType,
    "cache-control": "private, max-age=300",
    "x-content-type-options": "nosniff",
  };
  for (const name of ["accept-ranges", "content-length", "content-range"]) {
    const value = upstream.headers.get(name);
    if (value) headers[name] = value;
  }
  response.writeHead(upstream.status, headers);
  if (request.method === "HEAD") { response.end(); abort(); return; }
  try {
    // pipeline honours backpressure, so a 900 MB comic doesn't buffer in memory.
    await pipeline(Readable.fromWeb(upstream.body), response);
  } catch (error) {
    if (error?.name !== "AbortError" && !response.writableFinished) response.destroy();
  }
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------
await loadLibraryState();
await loadCatalogAndCaches();

function sendHtml(request, response, html, cacheControl = "no-store") {
  const entry = makeEntry(Buffer.from(html), "text/html; charset=utf-8", cacheControl);
  respond(request, response, entry);
}

const handler = async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    switch (url.pathname) {
      case "/catalog.json": {
        if (request.headers["if-none-match"] === catalogEtag) {
          response.writeHead(304, { etag: catalogEtag, "cache-control": "no-cache, must-revalidate" });
          response.end();
          return;
        }
        respond(request, response, {
          buffer: catalogBuffer, gzip: catalogGzip, etag: catalogEtag,
          type: "application/json; charset=utf-8", cacheControl: "no-cache, must-revalidate",
        });
        return;
      }
      case "/api/library-state": await handleLibraryState(request, response); return;
      case "/api/cover": await cover(response, url); return;
      case "/api/health": {
        sendJson(response, 200, {
          ok: true,
          version: APP_VERSION,
          pid: process.pid,
          uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
          books: catalog.length,
          readingStates: libraryState.size,
          coversCached: coverCache.size,
          warmer: { ...warmerProgress },
          urls: {
            local: `http://127.0.0.1:${port}`,
            lan: lanAddress() ? `http://${lanAddress()}:${port}` : null,
            secure: certPath && lanAddress() ? `https://${lanAddress()}:${httpsPort}` : null,
          },
        });
        return;
      }
      case "/qr.svg": {
        const text = (url.searchParams.get("text") || "").slice(0, 200);
        if (!text) { response.writeHead(400).end("Missing text"); return; }
        try {
          const entry = makeEntry(Buffer.from(qrSvg(text, {
            size: Math.min(1024, Math.max(80, Number(url.searchParams.get("size")) || 260)),
          })), "image/svg+xml", "public, max-age=3600");
          respond(request, response, entry);
        } catch { response.writeHead(400).end("Text too long"); }
        return;
      }
      case "/stats": case "/stats/": sendHtml(request, response, statsPage()); return;
      case "/connect": case "/connect/": sendHtml(request, response, connectPage(request)); return;
      default:
        if (url.pathname.startsWith("/api/book/")) { await proxyBook(request, response, url); return; }
        await serveFile(request, response, url.pathname);
    }
  } catch (error) {
    console.error(error);
    if (!response.headersSent) response.writeHead(500).end("The Reading Room encountered an error");
  }
};

const servers = [];

const http = createHttpServer(handler);
http.keepAliveTimeout = 65000;
http.headersTimeout = 70000;
http.requestTimeout = 0;                 // large book downloads must not time out
servers.push(http);
http.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`Port ${port} is already in use — another copy of The Reading Room may be running.`);
    process.exit(2);
  }
  console.error("Server error:", error.message);
  process.exit(1);
});
http.listen(port, host, () => {
  const ip = lanAddress();
  console.log(`The Reading Room is running at http://127.0.0.1:${port}`);
  if (ip) console.log(`On this network: http://${ip}:${port}  (pairing page: /connect)`);
  console.log(`Reading state syncs via ${statePath}`);
  setTimeout(() => { runWarmer().catch((e) => console.error("Warmer error:", e.message)); }, 2500);
});

if (certPath && keyPath) {
  try {
    const secure = createHttpsServer({ cert: readFileSync(certPath), key: readFileSync(keyPath) }, handler);
    secure.keepAliveTimeout = 65000;
    secure.headersTimeout = 70000;
    secure.requestTimeout = 0;
    servers.push(secure);
    secure.on("error", (error) => console.error("HTTPS endpoint unavailable:", error.message));
    secure.listen(httpsPort, host, () => {
      console.log(`Secure endpoint at https://${lanAddress() || host}:${httpsPort}`);
    });
  } catch (error) {
    console.error("HTTPS disabled (could not load certificate):", error.message);
  }
}

// Flush caches on the way out so a restart never loses warmed covers.
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Shutting down (${signal})…`);
  for (const server of servers) server.close();
  try { await Promise.race([Promise.all([flushCoverCache(), writeChain]), new Promise((r) => setTimeout(r, 2000))]); }
  finally { process.exit(0); }
}
for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"]) process.on(signal, () => shutdown(signal));
