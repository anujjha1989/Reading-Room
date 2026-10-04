import test from 'node:test';
import assert from 'node:assert/strict';
import { continueProgress } from '../app/homeShelves.ts';

test('whole-book fraction takes precedence over a chapter page label', () => {
  assert.equal(continueProgress({ progress: .63, progressLabel: 'Page 1 of 30' }), '63%');
  assert.equal(continueProgress({ progress: .004 }), '1%');
  assert.equal(continueProgress({ progress: 0 }), '0%');
  assert.equal(continueProgress({ status: 'finished' }), '100%');
});

test('older saved reading places are never misreported as zero', () => {
  assert.equal(continueProgress({ position: 'epubcfi(/6/14!/4/2)', progressLabel: 'In progress' }), 'In progress');
  assert.equal(continueProgress({ lastOpened: 123, progressLabel: 'UNO' }), 'In progress');
  assert.equal(continueProgress({ progressLabel: '47%' }), '47%');
  assert.equal(continueProgress(undefined), '0%');
});
