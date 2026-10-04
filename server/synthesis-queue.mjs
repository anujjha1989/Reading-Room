/** Bounded shared jobs. Playback outranks queued warming; disconnects remove
 * unused queued work, but never cancel a clip another listener still needs. */
export function createSynthesisQueue({ concurrency = 2, maxPending = 32 } = {}) {
  const jobs = new Map(), waiting = [];
  let active = 0;
  function pump() {
    waiting.sort((a, b) => Number(b.priority) - Number(a.priority) || a.order - b.order);
    while (active < concurrency && waiting.length) {
      const job = waiting.shift(); job.started = true; active++;
      Promise.resolve().then(job.run).then(job.resolve, job.reject).finally(() => {
        active--; if (jobs.get(job.key) === job) jobs.delete(job.key); pump();
      });
    }
  }
  let sequence = 0;
  return {
    status: () => ({ active, pending: waiting.length, shared: jobs.size }),
    acquire(key, run, priority = true) {
      let job = jobs.get(key);
      if (!job) {
        if (waiting.length >= maxPending) throw new Error("Voice queue is busy. Try again shortly.");
        job = { key, run, priority, order: sequence++, clients: 0, started: false };
        job.promise = new Promise((resolve, reject) => { job.resolve = resolve; job.reject = reject; });
        job.promise.catch(() => {});
        jobs.set(key, job); waiting.push(job);
      } else if (priority) job.priority = true;
      job.clients++; pump();
      let released = false;
      return {
        promise: job.promise,
        release() {
          if (released) return; released = true; job.clients--;
          if (!job.started && job.clients === 0) {
            const index = waiting.indexOf(job); if (index >= 0) waiting.splice(index, 1);
            if (jobs.get(key) === job) jobs.delete(key);
            job.reject(new Error("Unused queued narration cancelled"));
          }
        },
      };
    },
  };
}
