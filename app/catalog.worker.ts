import { prepareCatalog, type RawBook } from "./catalogModel";
const scope = globalThis as unknown as { onmessage: ((event: MessageEvent<RawBook[]>) => void) | null; postMessage: (data: unknown) => void };
scope.onmessage = event => {
  try { scope.postMessage({ books: prepareCatalog(event.data) }); }
  catch { scope.postMessage({ error: true }); }
};
