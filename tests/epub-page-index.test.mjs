import test from 'node:test';
import assert from 'node:assert/strict';
import { createEpubPageIndex } from '../app/epubPageIndex.ts';

test('reading pages continue across sections, reverse and survive a cached reopen', async () => {
  const options = { linear: [true, true, false, true], signal: new AbortController().signal,
    loadLength: async index => [30000, 3000, 99999, 4500][index] };
  const pages = createEpubPageIndex(options);
  assert.equal(await pages.pageAt(0, 28500), 20);
  assert.equal(await pages.pageAt(1, 0), 21);
  assert.equal(await pages.pageAt(1, 1500), 22);
  assert.equal(await pages.pageAt(0, 28500), 20);
  assert.equal(await pages.pageAt(3, 0), 23, 'nonlinear furniture is excluded');
  const reopened = createEpubPageIndex({ ...options, lengths: pages.snapshot(),
    loadLength: async () => { throw Error('cached sections must not reload'); } });
  assert.equal(await reopened.pageAt(3, 0), 23);
});

test('concurrent relocations share indexing and only load required predecessors', async () => {
  const loaded = [];
  const pages = createEpubPageIndex({ linear: [true, true, true, true], signal: new AbortController().signal,
    loadLength: async index => { loaded.push(index); return 3000; } });
  pages.remember(0, 3000);
  assert.deepEqual(await Promise.all([pages.pageAt(2, 0), pages.pageAt(2, 1500)]), [5, 6]);
  assert.deepEqual(loaded, [1]);
});

test('close cancels indexing, a failed section is retryable, invalid cache is ignored', async () => {
  const controller = new AbortController(); let calls = 0;
  const pages = createEpubPageIndex({ linear: [true, true], lengths: [NaN, null], signal: controller.signal,
    loadLength: async () => { if (++calls === 1) throw Error('broken section'); return 3000; } });
  await assert.rejects(pages.pageAt(1, 0), /broken section/);
  assert.equal(await pages.pageAt(1, 0), 3);
  controller.abort();
  await assert.rejects(pages.pageAt(1, 0), /abort/i);
});
