import test from "node:test";
import assert from "node:assert/strict";
import { mutationProblem } from "../server/request-guard.mjs";
const req = (extra = {}) => ({ method: "POST", headers: { host: "anujrpi.local:4311", "content-type": "application/json", ...extra } });
test("same-origin and authenticated native JSON remain supported", () => {
  assert.equal(mutationProblem(req({ origin: "http://anujrpi.local:4311" })), null);
  assert.equal(mutationProblem(req()), null);
  assert.equal(mutationProblem(req({ host: "anujrpi.tail549492.ts.net:8443", origin: "https://anujrpi.tail549492.ts.net:8443" })), null);
});
test("cross-site, opaque and non-JSON mutations are refused", () => {
  for (const origin of ["https://evil.example", "null", "http://anujrpi.local:4312", "https://anujrpi.local:4311", "invalid"]) assert.equal(mutationProblem(req({ origin })).status, 403);
  assert.equal(mutationProblem(req({ "sec-fetch-site": "cross-site" })).status, 403);
  assert.equal(mutationProblem(req({ "content-type": "text/plain" })).status, 415);
  assert.equal(mutationProblem(req({ "content-type": "application/json; charset=utf-8" })), null);
  assert.equal(mutationProblem({ method: "GET", headers: {} }), null);
});

test("reading state keeps the documented shape and drops what could break a reader", async () => {
  const { cleanReadingState } = await import("../server/request-guard.mjs");
  assert.equal(cleanReadingState(null), null);
  assert.equal(cleanReadingState({ bookId: "../../etc/passwd" }), null);
  assert.equal(cleanReadingState({ bookId: "x".repeat(401) }), null);
  const kept = cleanReadingState({ bookId: "ref-1NT84r_ap9RG6k3ifIVddaFC2xDDgR8VX", favorite: true, status: "reading", updatedAt: 5, lastOpened: null,
    progress: 0.33, position: "epubcfi(/6/4!/4/2)", lists: ["Summer", 7, ""], wantToRead: false,
    highlights: [{ id: "a", cfi: "epubcfi(/6/2)", text: "t", color: "yellow" }, "junk", { cfi: 4 }], bookmarks: [{ id: "b" }, null], futureField: "ok" });
  assert.deepEqual(kept.lists, ["Summer"]); assert.equal(kept.highlights.length, 1); assert.equal(kept.bookmarks.length, 1);
  assert.equal(kept.progress, 0.33); assert.equal(kept.lastOpened, null); assert.equal(kept.futureField, "ok");
  const collection = cleanReadingState({ bookId: "L21f5fc9f61ffc9c2b8b0107ab33083a58460018b~22-52", status: "finished" });
  assert.equal(collection.status, "finished");
  const bad = cleanReadingState({ bookId: "Labc", status: { x: 1 }, highlights: "notalist", updatedAt: "zzz", favorite: "yes", progress: 7, "__proto__x": 1, nested: { a: 1 } });
  assert.deepEqual(bad, { bookId: "Labc" });
});
