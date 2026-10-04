import test from "node:test";
import assert from "node:assert/strict";
import { readerDeadline } from "../app/readerDeadline.ts";
test("reader deadlines preserve valid values and reject malformed books", async () => {
  const controller = new AbortController();
  assert.equal(await readerDeadline(Promise.resolve("valid"), controller.signal), "valid");
  await assert.rejects(readerDeadline(Promise.reject(new Error("Bad archive")), controller.signal), /Bad archive/);
});
test("a stalled reader cannot leave loading open indefinitely", async () => {
  await assert.rejects(readerDeadline(new Promise(() => {}), new AbortController().signal, 10), /too long/);
});
test("closing the reader cancels pending work", async () => {
  const controller = new AbortController();
  const request = readerDeadline(new Promise(() => {}), controller.signal);
  controller.abort();
  await assert.rejects(request, { name: "AbortError" });
});
