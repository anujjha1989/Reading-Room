type State = { bookId: string; fileId?: string | null; updatedAt: number };
type Group = { id: string; copies: Array<{ id: string }> };

/** Native TV chooses the readable file; web catalogue groups several editions.
 * Re-key known copies without losing annotations stored on the grouped title.
 * Unknown files stay intact until their catalogue has loaded.
 */
export function remapFileStates<T extends State>(states: Record<string, T>, books: Group[]): Record<string, T> {
  const owner = new Map<string, string>();
  for (const book of books) for (const copy of book.copies) owner.set(copy.id, book.id);
  let next = states;
  for (const [id, state] of Object.entries(states)) {
    const canonical = owner.get(state.fileId || id) || owner.get(id);
    if (!canonical || canonical === id) continue;
    if (next === states) next = { ...states };
    const current = next[canonical];
    next[canonical] = { ...(current || {}), ...state, ...(current && current.updatedAt > state.updatedAt ? current : {}), bookId: canonical } as T;
    delete next[id];
  }
  return next;
}

export function mergeReadingStates<T extends State>(current: Record<string, T>, incoming: T[]): Record<string, T> {
  const next = { ...current };
  for (const state of incoming) {
    if (!state || typeof state.bookId !== "string" || !Number.isFinite(state.updatedAt)) continue;
    const old = next[state.bookId];
    if (!old || state.updatedAt >= old.updatedAt) next[state.bookId] = { ...old, ...state };
  }
  return next;
}
