import test from 'node:test';
import assert from 'node:assert/strict';
import { median, mad, binBy, enoughSamples } from '../src/assets/js/lib/stats.js';

test('median handles odd, even, and empty arrays', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.ok(Number.isNaN(median([])));
  assert.ok(Number.isNaN(median(null)));
});

test('mad is the median absolute deviation', () => {
  assert.equal(mad([1, 1, 2, 2, 4]), 1);
  assert.ok(Number.isNaN(mad([])));
});

test('binBy uses inclusive upper edges', () => {
  const bins = binBy([100, 101, 200, 201, 400, 401], [100, 200, 300, 400]);
  assert.deepEqual(bins.map((bin) => bin.length), [1, 2, 1, 1, 1]);
  assert.deepEqual(bins[0], [100]);
  assert.deepEqual(bins[1], [101, 200]);
  assert.deepEqual(bins[4], [401]);
});

test('binBy ignores non-finite values', () => {
  const bins = binBy([NaN, Infinity, 50], [100]);
  assert.deepEqual(bins, [[50], []]);
});

test('enoughSamples compares n with the minimum', () => {
  assert.equal(enoughSamples(3, 3), true);
  assert.equal(enoughSamples(2, 3), false);
  assert.equal(enoughSamples(NaN, 3), false);
});
