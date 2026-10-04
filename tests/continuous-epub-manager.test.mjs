import test from "node:test";
import assert from "node:assert/strict";
import { continuousEpubManager } from "../app/continuousEpubManager.ts";

function setup() {
  const queue = [], views = [];
  class Base {
    settings = { offset: 1800 };
    views = { all: () => views };
    q = { enqueue: task => queue.push(task) };
    bounds() { return {}; }
    isVisible(view) { return view.visible; }
    trim() { return Promise.resolve(); }
    destroy() { this.destroyed = true; }
  }
  return { manager: new (continuousEpubManager(Base))(), queue, views };
}

test("continuous manager never unloads during active updates or queues stale visibility decisions", async () => {
  const { manager, queue, views } = setup();
  let unloads = 0;
  const view = { displayed: true, visible: false, destroy() { unloads++; this.displayed = false; }, show() {} };
  views.push(view);
  await manager.update();
  assert.equal(unloads, 0);
  assert.equal(queue.length, 0);
  view.visible = true; view.displayed = true;
  await manager.update();
  assert.equal(unloads, 0, "reversal must preserve the visible section");
  manager.destroy();
});

test("idle cleanup retains neighbours and geometry, while releasing distant iframes", async () => {
  const { manager, views, queue } = setup();
  for (let i = 0; i < 7; i++) views.push({ displayed: true, visible: i === 3, destroy() { this.displayed = false; }, show() {} });
  await manager.update();
  // A queued decision would be stale after a direction reversal.
  views[3].visible = false; views[1].visible = true;
  await new Promise(resolve => setTimeout(resolve, 650));
  assert.deepEqual(views.map(view => view.displayed), [true, true, true, false, false, false, false]);
  assert.equal(views.length, 7, "measured placeholders must remain for reverse scrolling");
  await manager.trim(); assert.equal(views.length, 7);
  assert.equal(queue.length, 0);
  manager.destroy();
});

test("overlapping updates share a load and cannot destroy its unfinished iframe", async () => {
  const { manager, views } = setup();
  let finish, loads = 0, shown = 0, unloads = 0;
  const view = { displayed: false, visible: true, display() { loads++; return new Promise(resolve => { finish = resolve; }); }, show() { shown++; }, destroy() { unloads++; } };
  views.push(view);
  const first = manager.update(), second = manager.update();
  assert.equal(loads, 1);
  view.visible = false; view.displayed = true;
  await manager.update();
  assert.equal(unloads, 0);
  manager.destroy(); finish(view);
  await Promise.all([first, second]);
  assert.equal(shown, 0, "closing the reader must not show a late iframe");
});

test("a failed section load can be retried", async () => {
  const { manager, views } = setup();
  let loads = 0;
  views.push({ displayed: false, visible: true, display() { return ++loads === 1 ? Promise.reject(new Error("fixture failure")) : Promise.resolve(this); }, show() {} });
  await assert.rejects(manager.update(), /fixture failure/);
  await manager.update();
  assert.equal(loads, 2);
  manager.destroy();
});
