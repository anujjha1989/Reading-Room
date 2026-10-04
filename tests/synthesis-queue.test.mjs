import test from "node:test";
import assert from "node:assert/strict";
import { createSynthesisQueue } from "../server/synthesis-queue.mjs";
const deferred = () => { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; };
test("playback is promoted ahead of queued prefetches and duplicate synthesis is shared", async () => {
  const queue = createSynthesisQueue({ concurrency: 1 });
  const gate = deferred(), order = [];
  const active = queue.acquire("active", () => gate.promise);
  const warm = queue.acquire("later", () => { order.push("later"); }, false);
  let calls = 0;
  const first = queue.acquire("current", () => { calls++; order.push("current"); }, false);
  const playback = queue.acquire("current", () => { throw new Error("Must not duplicate"); });
  gate.resolve(); await Promise.all([active.promise, warm.promise, first.promise, playback.promise]);
  assert.deepEqual(order, ["current", "later"]); assert.equal(calls, 1);
});
test("a disconnected listener cancels only unshared pending work", async () => {
  const queue = createSynthesisQueue({ concurrency: 1 });
  const gate = deferred(), running = queue.acquire("busy", () => gate.promise);
  const unused = queue.acquire("unused", () => assert.fail("Cancelled work ran"), false);
  unused.release(); await assert.rejects(unused.promise, /cancelled/);
  const one = queue.acquire("shared", () => "audio", false), two = queue.acquire("shared", () => assert.fail("Duplicate"));
  one.release(); gate.resolve(); await running.promise;
  assert.equal(await two.promise, "audio");
});
test("excess requests are rejected instead of growing an unlimited queue", async () => {
  const queue = createSynthesisQueue({ concurrency: 1, maxPending: 1 });
  const gate = deferred(), running = queue.acquire("busy", () => gate.promise);
  const queued = queue.acquire("queued", () => "audio");
  assert.throws(() => queue.acquire("extra", () => "audio"), /busy/);
  assert.equal(queue.status().pending, 1); gate.resolve(); await Promise.all([running.promise, queued.promise]);
});
