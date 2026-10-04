/** A durable, latest-write-wins outbox. A failed HTTP response is not an acknowledgement. */
export type SyncRecord = { bookId: string; updatedAt: number };
export type SyncStatus = { pending: number; error: boolean; storageUnavailable: boolean };
type StorageLike = Pick<Storage, "getItem" | "setItem">;
type Options<T> = {
  storage: StorageLike;
  send: (records: T[], signal: AbortSignal) => Promise<{ ok: boolean }>;
  onStatus?: (status: SyncStatus) => void;
  debounceMs?: number;
  retryMs?: number;
  timeoutMs?: number;
};
const KEY = "home-books-state-outbox:v1";

export function createStateOutbox<T extends SyncRecord>(options: Options<T>) {
  const pending = new Map<string, T>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let active = false, sending = false, error = false, storageUnavailable = false, failures = 0;
  try {
    const data: unknown = JSON.parse(options.storage.getItem(KEY) || "[]");
    if (Array.isArray(data)) for (const record of data) {
      if (record && typeof record.bookId === "string" && Number.isFinite(record.updatedAt)) {
        pending.set(record.bookId, record as T);
      }
    }
  } catch { storageUnavailable = true; }
  const status = () => ({ pending: pending.size, error, storageUnavailable });
  const notify = () => options.onStatus?.(status());
  function persist() {
    try { options.storage.setItem(KEY, JSON.stringify([...pending.values()])); storageUnavailable = false; }
    catch { storageUnavailable = true; }
    notify();
  }
  function schedule(delay: number) {
    if (!active || !pending.size) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = undefined; void flush(); }, delay);
  }
  async function flush() {
    if (sending || !pending.size) return;
    if (timer) { clearTimeout(timer); timer = undefined; }
    sending = true;
    // Keep requests small enough for a page-hide keepalive request. Large
    // annotation records are still sent individually and stay durable on failure.
    const batch: T[] = [];
    let bytes = 2;
    for (const record of pending.values()) {
      const size = new TextEncoder().encode(JSON.stringify(record)).length + 1;
      if (batch.length && bytes + size > 48_000) break;
      batch.push(record); bytes += size;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 15_000);
    try {
      const response = await options.send(batch, controller.signal);
      if (!response.ok) throw new Error("Save was not acknowledged");
      for (const record of batch) if (pending.get(record.bookId) === record) pending.delete(record.bookId);
      error = false; failures = 0;
    } catch { error = true; failures += 1; }
    finally {
      clearTimeout(timeout); sending = false; persist();
      schedule(error ? Math.min(60_000, (options.retryMs ?? 2_000) * 2 ** Math.min(5, failures - 1)) : 0);
    }
  }
  return {
    records: () => [...pending.values()],
    status,
    start() { active = true; notify(); schedule(0); },
    stop() { active = false; if (timer) clearTimeout(timer); timer = undefined; persist(); },
    enqueue(record: T) {
      const previous = pending.get(record.bookId);
      if (previous && previous.updatedAt > record.updatedAt) return;
      pending.set(record.bookId, record); persist(); schedule(options.debounceMs ?? 650);
    },
    flush,
  };
}
