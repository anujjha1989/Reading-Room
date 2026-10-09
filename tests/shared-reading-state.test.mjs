import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeReadingStates, remapFileStates } from '../app/sharedReadingState.ts';
import { parsePortablePosition } from '../app/portableReadingPosition.ts';

test('TV file state maps to a grouped title without removing bookmarks or highlights', () => {
  const old = { grouped: { bookId: 'grouped', updatedAt: 10, highlights: ['keep'], bookmarks: ['keep'] }, epub: { bookId: 'epub', fileId: 'epub', updatedAt: 20, progress: .4, position: 'rrportable:test' } };
  const next = remapFileStates(old, [{ id: 'grouped', copies: [{ id: 'epub' }] }]);
  assert.equal(next.grouped.progress, .4); assert.deepEqual(next.grouped.highlights, ['keep']);
  assert.deepEqual(next.grouped.bookmarks, ['keep']); assert.equal(next.epub, undefined);
  assert.equal(old.epub.bookId, 'epub');
  assert.equal(remapFileStates(next, [{ id: 'grouped', copies: [{ id: 'epub' }] }]), next);
});
test('older native state cannot replace a newer phone position', () => {
  const next = remapFileStates({ grouped: { bookId: 'grouped', updatedAt: 30, position: 'phone' }, epub: { bookId: 'epub', updatedAt: 20, position: 'tv' } }, [{ id: 'grouped', copies: [{ id: 'epub' }] }]);
  assert.equal(next.grouped.position, 'phone');
});
test('partial server patches keep annotations; unknown files survive catalogue loading', () => {
  const old = { a: { bookId: 'a', updatedAt: 10, favorite: true, highlights: ['note'] } };
  const next = mergeReadingStates(old, [{ bookId: 'a', updatedAt: 20, progress: .5 }]);
  assert.equal(next.a.favorite, true); assert.deepEqual(next.a.highlights, ['note']);
  assert.equal(remapFileStates(next, []), next);
});
test('portable text anchors reject invalid versions, offsets and malformed JSON', () => {
  const valid = { v: 1, fileId: 'epub', spine: 3, wordOffset: 120, quote: 'The next passage' };
  assert.deepEqual(parsePortablePosition('rrportable:' + JSON.stringify(valid)), valid);
  for (const bad of [null, {}, { ...valid, v: 2 }, { ...valid, spine: -1 }, { ...valid, wordOffset: .5 }]) assert.equal(parsePortablePosition('rrportable:' + JSON.stringify(bad)), null);
});
