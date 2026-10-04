import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createPiperPool } from "../server/piper-pool.mjs";
const fixture = fileURLToPath(new URL("./fixtures/piper-process.mjs", import.meta.url));
function setup(t, options = {}) {
  const starts = [];
  const pool = createPiperPool({ executable: process.execPath, voiceDir: "/voices", ...options,
    spawnProcess: (executable, args, spawnOptions) => { starts.push(args[1]); return spawn(executable, [fixture], spawnOptions); },
  });
  t.after(() => pool.close()); return { pool, starts };
}
test("same voice retains one model; voice replacement does not exceed the pool bound", async t => {
  const { pool, starts } = setup(t, { size: 1 });
  await pool.synthesize("alba", "one", "/first.wav");
  await pool.synthesize("alba", "two", "/second.wav");
  assert.equal(starts.length, 1);
  await pool.synthesize("alan", "three", "/third.wav");
  assert.equal(starts.length, 2); assert.equal(pool.status().models, 1);
});
test("concurrency is bounded instead of starting excess voice processes", async t => {
  const { pool, starts } = setup(t);
  const a = pool.synthesize("alba", "slow", "/a.wav"), b = pool.synthesize("alan", "slow", "/b.wav");
  await assert.rejects(pool.synthesize("ryan", "extra", "/c.wav"), /busy/);
  assert.equal(starts.length, 2); await Promise.all([a, b]);
});
test("crashed and timed-out voices are replaced on retry", async t => {
  const { pool, starts } = setup(t, { size: 1, timeoutMs: 1000 });
  await assert.rejects(pool.synthesize("alba", "crash", "/a.wav"), /stopped/);
  await pool.synthesize("alba", "retry", "/b.wav");
  await assert.rejects(pool.synthesize("alba", "hang", "/c.wav"), /timed out/);
  await pool.synthesize("alba", "retry", "/d.wav"); assert.equal(starts.length, 3);
});
test("idle models release memory and shutdown invalidates unfinished work", async t => {
  const { pool } = setup(t, { size: 1, idleMs: 20 });
  await pool.synthesize("alba", "one", "/a.wav");
  await new Promise(resolve => setTimeout(resolve, 100)); assert.equal(pool.status().models, 0);
  const unfinished = pool.synthesize("alba", "hang", "/b.wav");
  const rejection = assert.rejects(unfinished, /closed|stopped/);
  await pool.close(); await rejection;
  await assert.rejects(pool.synthesize("alba", "one", "/c.wav"), /closed/);
});
