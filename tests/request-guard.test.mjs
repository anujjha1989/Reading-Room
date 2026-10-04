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
