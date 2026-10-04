import { spawn } from "node:child_process";

/** Local engines acknowledge each WAV after writing it. Reuse their model
 * across jobs; bound resident workers, release idle models and discard
 * stalled/crashed processes instead of carrying a broken sentence forward. */
export function createVoiceWorkerPool({ commandForVoice, modelKey = voice => voice, jobInput = (voice, text, out) => ({ text, output_file: out }), size = 2, idleMs = 120_000, timeoutMs = 120_000, spawnProcess = spawn }) {
  const slots = Array.from({ length: size }, () => ({ busy: false, worker: null }));
  let closed = false;
  function workerFor(voice) {
    const { executable, args } = commandForVoice(voice);
    const child = spawnProcess(executable, args, { stdio: ["pipe", "pipe", "pipe"] });
    const worker = { child, key: modelKey(voice), job: null, buffer: "", timer: null, dead: false };
    worker.ended = new Promise(resolve => child.once("close", resolve));
    const fail = () => {
      worker.dead = true;
      worker.job?.reject(new Error("The local voice process stopped responding"));
      worker.job = null;
    };
    child.on("error", fail); child.on("exit", fail); child.stdin.on("error", fail);
    // Logging is disabled. Drain stderr so a diagnostic cannot stall synthesis.
    child.stderr.resume(); child.stdout.setEncoding("utf8");
    child.stdout.on("data", chunk => {
      worker.buffer += chunk;
      if (worker.buffer.length > 65_536) { fail(); child.kill("SIGKILL"); return; }
      let index;
      while ((index = worker.buffer.indexOf("\n")) >= 0) {
        const path = worker.buffer.slice(0, index).trim(); worker.buffer = worker.buffer.slice(index + 1);
        if (!path) continue;
        const job = worker.job;
        if (!job || path !== job.out) { fail(); child.kill("SIGKILL"); return; }
        worker.job = null; job.resolve();
      }
    });
    return worker;
  }
  async function retire(worker) {
    if (!worker) return;
    clearTimeout(worker.timer);
    worker.dead = true;
    worker.job?.reject(new Error("The local voice process was closed")); worker.job = null;
    if (worker.child.exitCode !== null || worker.child.signalCode !== null) return worker.ended;
    worker.child.kill("SIGTERM");
    const kill = setTimeout(() => worker.child.kill("SIGKILL"), 1_000); kill.unref();
    try { await worker.ended; } finally { clearTimeout(kill); }
  }
  return {
    status: () => ({ active: slots.filter(slot => slot.busy).length, models: slots.filter(slot => slot.worker && !slot.worker.dead).length }),
    async synthesize(voice, text, out) {
      if (closed) throw new Error("Voice pool is closed");
      const key = modelKey(voice);
      const slot = slots.find(slot => !slot.busy && slot.worker?.key === key && !slot.worker.dead) ?? slots.find(slot => !slot.busy);
      if (!slot) throw new Error("Voice pool is busy");
      slot.busy = true;
      clearTimeout(slot.worker?.timer);
      try {
        if (slot.worker && (slot.worker.dead || slot.worker.key !== key)) {
          await retire(slot.worker); slot.worker = null;
        }
        if (closed) throw new Error("Voice pool is closed");
        const worker = slot.worker ??= workerFor(voice);
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            worker.dead = true; worker.child.kill("SIGKILL"); reject(new Error("Local voice synthesis timed out"));
          }, timeoutMs);
          const finish = callback => value => { clearTimeout(timer); callback(value); };
          worker.job = { out, resolve: finish(resolve), reject: finish(reject) };
          worker.child.stdin.write(JSON.stringify(jobInput(voice, text, out)) + "\n", error => {
            if (error) worker.job?.reject(error);
          });
        });
      } catch (error) {
        await retire(slot.worker); slot.worker = null; throw error;
      } finally {
        slot.busy = false;
        if (slot.worker && !closed) {
          const worker = slot.worker;
          worker.timer = setTimeout(() => {
            if (!slot.busy && slot.worker === worker) void retire(worker).then(() => { if (slot.worker === worker) slot.worker = null; });
          }, idleMs);
          worker.timer.unref();
        }
      }
    },
    async close() { closed = true; await Promise.all(slots.map(slot => retire(slot.worker))); },
  };
}
