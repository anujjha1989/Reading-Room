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
 * Keep measured placeholders instead of trimming/rebasing the native scroller.
 * Only nearby sections retain live iframes; empty measured divs are cheap and
 * let reverse scrolling reuse the same geometry.
 */
export function continuousEpubManager(Base: ContinuousManagerConstructor) {
  return class ContinuousEpubManager extends Base {
    private pending = new WeakMap<SectionView, Promise<void>>();
    private disposed = false;
    private cleanupTimer?: ReturnType<typeof setTimeout>;

    private scheduleCleanup(offset: number) {
      clearTimeout(this.cleanupTimer);
      this.cleanupTimer = setTimeout(() => {
        if (this.disposed) return;
        const bounds = this.bounds();
        const views = this.views.all();
        const near = views.map((view, index) => this.isVisible(view, offset, offset, bounds) ? index : -1).filter(index => index >= 0);
        if (!near.length) return;
        const first = Math.max(0, near[0] - 1), last = Math.min(views.length - 1, near[near.length - 1] + 1);
        views.forEach((view, index) => {
          if ((index < first || index > last) && view.displayed && !this.pending.has(view)) view.destroy();
        });
      }, 600);
    }

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
        }
      }
      // update() runs during gestures and momentum. Destruction must wait until
      // updates stop, and then make a fresh visibility decision, not queue one.
      this.scheduleCleanup(offset);
      return Promise.all(tasks);
    }

    trim() { return Promise.resolve(); }

    destroy() {
      this.disposed = true;
      clearTimeout(this.cleanupTimer);
      clearTimeout(this.trimTimeout);
      super.destroy();
    }
  };
}
