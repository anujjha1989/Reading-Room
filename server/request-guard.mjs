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
