/** The part of EPUB.js's manager contract used by our continuous renderer. */
interface SectionView {
  displayed: boolean;
  display(request: unknown): Promise<SectionView>;
  show(): void;
  destroy(): void;
}

interface ContinuousManager {
  settings: { offset: number };
  request: unknown;
  views: { all(): SectionView[] };
  q: { enqueue(task: () => unknown): unknown };
  trimTimeout?: ReturnType<typeof setTimeout>;
  bounds(): DOMRect;
  isVisible(view: SectionView, before: number, after: number, bounds: DOMRect): boolean;
  trim(): Promise<unknown>;
  destroy(): void;
}

export type ContinuousManagerConstructor = new (...args: never[]) => ContinuousManager;

/**
 * EPUB.js queues destruction after deciding a section is off screen. When the
 * user reverses direction, queued work can destroy a now-visible section. Own
 * the update operation so visibility and unloading happen in the same turn.
 * Keep the upstream bounded view trimming and section navigation.
 */
export function continuousEpubManager(Base: ContinuousManagerConstructor) {
  return class ContinuousEpubManager extends Base {
    private pending = new WeakMap<SectionView, Promise<void>>();
    private disposed = false;

    update(offset = this.settings.offset): Promise<void[]> {
      if (this.disposed) return Promise.resolve([]);
      const bounds = this.bounds();
      const tasks: Promise<void>[] = [];
      for (const view of this.views.all()) {
        if (this.isVisible(view, offset, offset, bounds)) {
          if (view.displayed) view.show();
          else {
            let task = this.pending.get(view);
            if (!task) {
              task = view.display(this.request)
                .then(() => {
                  if (!this.disposed && this.views.all().includes(view)) view.show();
                })
                .finally(() => this.pending.delete(view));
              this.pending.set(view, task);
            }
            tasks.push(task);
          }
        } else if (view.displayed && !this.pending.has(view)) {
          // No intervening queue or await: the visibility decision is current.
          view.destroy();
          clearTimeout(this.trimTimeout);
          this.trimTimeout = setTimeout(() => {
            if (!this.disposed) this.q.enqueue(() => this.trim());
          }, 250);
        }
      }
      return Promise.all(tasks);
    }

    destroy() {
      this.disposed = true;
      clearTimeout(this.trimTimeout);
      super.destroy();
    }
  };
}
