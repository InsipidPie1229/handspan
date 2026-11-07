import test from 'node:test';
import assert from 'node:assert/strict';
import { vToH, hToV, zoomMultiplier, fovForMagnification, owZoomPercent } from '../src/assets/js/lib/zoom.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} vs ${b}`);

test('FOV conversions are inverse and match known 16:9 values', () => {
  close(hToV(vToH(70, 16 / 9), 16 / 9), 70);
  close(hToV(103, 16 / 9), 70.53, 0.01); // Overwatch 103 horizontal = 70.53 vertical
  close(vToH(73.74, 16 / 9), 106.26, 0.01); // CS2 4:3 90 -> 16:9 106.26
});

test('Overwatch values reproduce the widely cited numbers at FOV 103', () => {
  assert.equal(owZoomPercent('widow', 103, 'mdh', 0).toFixed(2), '37.89');
  assert.equal(owZoomPercent('ana', 103, 'mdh', 0).toFixed(2), '37.89');
  assert.equal(owZoomPercent('ashe', 103, 'mdh', 0).toFixed(2), '51.47');
  assert.equal(owZoomPercent('widow', 103, 'turn'), 100);
});

test('lower FOV setting needs a higher zoom percentage', () => {
  assert.ok(owZoomPercent('widow', 90, 'mdh', 0) > owZoomPercent('widow', 103, 'mdh', 0));
});

test('point matching moves from the focal match toward the turn match', () => {
  const m0 = zoomMultiplier(103, 51, 'mdh', 0);
  const m50 = zoomMultiplier(103, 51, 'mdh', 0.5);
  const m100 = zoomMultiplier(103, 51, 'mdh', 1);
  assert.ok(m0 < m50 && m50 < m100 && m100 < 1);
  close(zoomMultiplier(103, 51, 'mdh', 1e-9), m0, 1e-6);
  close(zoomMultiplier(90, 90, 'mdh', 0.5), 1);
});

test('magnification gives the focal-length FOV', () => {
  close(Math.tan(fovForMagnification(90, 4) * Math.PI / 360), Math.tan(Math.PI / 4) / 4);
  close(zoomMultiplier(90, fovForMagnification(90, 4), 'mdh', 0), 0.25);
});

test('invalid inputs throw instead of returning NaN', () => {
  for (const args of [[0, 50, 'mdh', 0], [103, 180, 'mdh', 0], [103, 50, 'mdh', 2], [103, 50, 'nope', 0], [NaN, 50, 'turn']]) {
    assert.throws(() => zoomMultiplier(...args), RangeError, JSON.stringify(args));
  }
  assert.throws(() => owZoomPercent('mercy', 103, 'mdh', 0), RangeError);
  assert.throws(() => owZoomPercent('widow', 79, 'mdh', 0), RangeError);
  assert.throws(() => fovForMagnification(90, 0.5), RangeError);
  // review P2: every public function rejects non-finite or degenerate input
  for (const fn of [() => vToH(NaN, 16 / 9), () => hToV(90, 0), () => hToV(90, -1), () => vToH(90, Infinity),
    () => fovForMagnification(NaN, 4), () => fovForMagnification(90, Infinity), () => vToH(180, 1)]) {
    assert.throws(fn, RangeError);
  }
});
