import { test } from "node:test";
import assert from "node:assert/strict";
import { createStateOutbox } from "../app/libraryStateSync.ts";

function storage() {
  const data = new Map();
  return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
}
const record = (updatedAt = 1) => ({ bookId: "book-a", updatedAt, position: `cfi-${updatedAt}`, bookmarks: [{ position: "chapter-2" }] });
const waitFor = async predicate => { for (let i = 0; i < 100; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 5)); } assert.fail("Condition did not settle"); };

test("503 and 401 remain pending; recovery retries without another edit", async () => {
  let calls = 0, healthy = false;
  const box = createStateOutbox({ storage: storage(), debounceMs: 0, retryMs: 10, send: async () => { calls++; return { ok: healthy }; } });
  box.enqueue(record()); box.start();
  await waitFor(() => calls >= 2);
  assert.equal(box.status().pending, 1); assert.equal(box.status().error, true);
  healthy = true;
  await waitFor(() => box.status().pending === 0);
  assert.equal(box.status().error, false); box.stop();
});

test("a failed save and bookmarks survive closing and restarting", async () => {
  const disk = storage();
  const first = createStateOutbox({ storage: disk, send: async () => ({ ok: false }) });
  first.enqueue(record()); await first.flush(); first.stop();
  let sent;
  const next = createStateOutbox({ storage: disk, send: async records => { sent = records; return { ok: true }; } });
  assert.deepEqual(next.records(), [record()]);
  await next.flush(); assert.deepEqual(sent, [record()]); assert.equal(next.status().pending, 0);
});

test("acknowledging an older in-flight save cannot discard a newer edit", async () => {
  let complete;
  const box = createStateOutbox({ storage: storage(), send: () => new Promise(resolve => { complete = resolve; }) });
  box.enqueue(record(1)); const request = box.flush();
  box.enqueue(record(2)); complete({ ok: true }); await request;
  assert.deepEqual(box.records(), [record(2)]);
  box.enqueue(record(0)); assert.deepEqual(box.records(), [record(2)]); box.stop();
});

test("full or unavailable device storage does not prevent a server save", async () => {
  const box = createStateOutbox({ storage: { getItem() { throw new Error("Private mode"); }, setItem() { throw new Error("Quota"); } }, send: async () => ({ ok: true }) });
  box.enqueue(record()); assert.equal(box.status().storageUnavailable, true);
  await box.flush(); assert.equal(box.status().pending, 0); box.stop();
});

test("timed-out requests stay pending and retryable", async () => {
  const box = createStateOutbox({ storage: storage(), timeoutMs: 10, send: (_, signal) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("Timeout")))) });
  box.enqueue(record()); await box.flush();
  assert.equal(box.status().pending, 1); assert.equal(box.status().error, true); box.stop();
});
