/** Browser mutations must be JSON from this origin, not a cross-site form.
 * Native/CLI clients may omit Origin; the public listener still requires auth. */
export function mutationProblem(request) {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) return null;
  const headers = request.headers;
  if (String(headers["content-type"] || "").split(";")[0].trim().toLowerCase() !== "application/json")
    return { status: 415, error: "Send application/json." };
  if (headers["sec-fetch-site"] === "cross-site") return { status: 403, error: "Cross-site changes are not allowed." };
  if (!headers.origin) return null;
  try {
    const origin = new URL(headers.origin);
    const host = String(headers.host || "").toLowerCase();
    const secure = request.socket?.encrypted || headers["x-forwarded-proto"] === "https" || /\.ts\.net(?::\d+)?$/.test(host);
    if (origin.origin === `${secure ? "https" : "http"}://${host}`) return null;
  } catch { /* malformed or opaque origin */ }
  return { status: 403, error: "Cross-site changes are not allowed." };
}

/** One book's saved reading state, as the reader sends it. Anything that is
 * not the documented shape is dropped rather than stored: a malformed record
 * (a string where the highlight list should be) is served back to every
 * device and can break the screens that read it. Returns null when the record
 * cannot be kept at all. Unknown keys survive only as short plain values, so
 * a newer client's extra field is not lost. */
const STATUSES = new Set(["unread", "reading", "finished"]);
const text = (value, max) => typeof value === "string" ? value.slice(0, max) : undefined;
const orNull = (value, check) => value === null ? null : check(value);
export function cleanReadingState(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  if (typeof item.bookId !== "string" || !/^[A-Za-z0-9_~,.:-]{1,400}$/.test(item.bookId)) return null;
  const out = { bookId: item.bookId };
  for (const [key, value] of Object.entries(item)) {
    let kept;
    switch (key) {
      case "bookId": continue;
      case "favorite": case "wantToRead": kept = typeof value === "boolean" ? value : undefined; break;
      case "status": kept = STATUSES.has(value) ? value : undefined; break;
      case "updatedAt": kept = Number.isFinite(value) && value >= 0 ? value : undefined; break;
      case "lastOpened": kept = orNull(value, v => Number.isFinite(v) && v >= 0 ? v : undefined); break;
      case "progress": kept = orNull(value, v => Number.isFinite(v) && v >= 0 && v <= 1 ? v : undefined); break;
      case "fileId": kept = orNull(value, v => text(v, 400)); break;
      case "position": kept = orNull(value, v => text(v, 4000)); break;
      case "progressLabel": kept = orNull(value, v => text(v, 200)); break;
      case "lists": kept = Array.isArray(value) ? value.filter(v => typeof v === "string" && v.trim()).map(v => v.slice(0, 60)).slice(0, 50) : undefined; break;
      case "bookmarks": kept = Array.isArray(value) ? value.filter(v => v && typeof v === "object" && !Array.isArray(v)).slice(0, 200) : undefined; break;
      case "highlights": kept = Array.isArray(value) ? value.filter(v => v && typeof v === "object" && !Array.isArray(v) && typeof v.cfi === "string").slice(0, 2000) : undefined; break;
      default:
        if (!/^[A-Za-z][A-Za-z0-9]{0,40}$/.test(key)) continue;
        kept = typeof value === "boolean" || value === null || Number.isFinite(value) ? value : text(value, 2000);
    }
    if (kept !== undefined) out[key] = kept;
  }
  return out;
}
