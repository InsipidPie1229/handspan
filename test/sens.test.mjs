import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cm360,
  sensFor,
  roundSens,
  convert,
  validateDpi,
  validateSens,
  roundDpi,
  altDpi,
  settableSens,
  settableDpi,
} from '../src/assets/js/lib/sens.js';

const games = [
  { id: 'ow', yaw: 0.0066, decimals: 2 },
  { id: 'cs', yaw: 0.022, decimals: 2 },
  { id: 'val', yaw: 0.07, decimals: 3 }
];

test('cm360 for Overwatch 800 DPI sensitivity 4', () => {
  const cm = cm360(800, 4, 0.0066);
  assert.ok(Math.abs(cm - 43.29) < 0.01);
});

test('sensFor is the inverse of cm360', () => {
  const cm = cm360(800, 4, 0.0066);
  const sens = sensFor(cm, 800, 0.0066);
  assert.ok(Math.abs(sens - 4) < 1e-9);
});

test('roundSens rounds to the requested decimals', () => {
  assert.equal(roundSens(1.23456, 2), 1.23);
  assert.equal(roundSens(1.23456, 3), 1.235);
  assert.equal(roundSens(2.6, 0), 3);
});

test('Overwatch 800/4 converts to CS2 and Valorant', () => {
  const { rows } = convert('ow', 800, 4, 800, games);
  const cs = rows.find((row) => row.id === 'cs');
  const val = rows.find((row) => row.id === 'val');
  assert.equal(cs.sens, 1.2);
  assert.equal(val.sens, 0.377);
});

test('rounded sensitivity keeps edpi, cm, and error consistent', () => {
  const { cm, rows } = convert('ow', 800, 4, 800, games);
  for (const row of rows) {
    assert.equal(row.edpi, Math.round(row.sens * 800 * 100) / 100);
    assert.equal(row.cm, cm360(800, row.sens, games.find((g) => g.id === row.id).yaw));
    assert.ok(Math.abs(row.errPct) < 1);
    assert.ok(Math.abs(row.cm / cm - 1 - row.errPct / 100) < 1e-12);
  }
});

test('validateDpi accepts 100 to 32000', () => {
  assert.equal(validateDpi(99), 'err.dpi');
  assert.equal(validateDpi(100), null);
  assert.equal(validateDpi(32000), null);
  assert.equal(validateDpi(32001), 'err.dpi');
  assert.equal(validateDpi(NaN), 'err.dpi');
  assert.equal(validateDpi(Infinity), 'err.dpi');
});

test('validateSens requires a positive finite number', () => {
  assert.equal(validateSens(0), 'err.sens');
  assert.equal(validateSens(-1), 'err.sens');
  assert.equal(validateSens(0.01), null);
  assert.equal(validateSens(NaN), 'err.sens');
});

test('roundDpi rounds to the nearest step and clamps', () => {
  assert.deepEqual(roundDpi(633, 50), { dpi: 650 });
  assert.deepEqual(roundDpi(10, 50), { dpi: 50 });
  assert.deepEqual(roundDpi(40000, 10), { error: 'err.dpiRange' });
  assert.deepEqual(roundDpi(30000, 500), { dpi: 30000 });
});

test('rounded sensitivity never drops to 0', () => {
  const games = [{ id: 'a', yaw: 0.0066, decimals: 2 }, { id: 'r6', yaw: 0.00572957795, decimals: 0 }];
  const r = convert('a', 400, 0.5, 400, games);
  for (const row of r.rows) {
    assert.ok(row.sens > 0);
    assert.ok(Number.isFinite(row.errPct));
  }
});

test('altDpi finds a DPI within tolerance for an integer-sensitivity game', () => {
  const r = altDpi(60, 0.00572957795, 0, 400);
  assert.ok(r && Math.abs(r.errPct) <= 3 && r.dpi % 100 === 0);
});

test('settableDpi stays finite and within limits for R6 at extreme inputs', () => {
  const r = settableDpi(100, 1, 0.00572957795, 50);
  assert.ok(Number.isFinite(r.cm) && r.dpi >= 50 && r.dpi <= 32000);
  const far = settableDpi(0.01, 1, 0.00572957795, 50);
  assert.ok(Number.isFinite(far.cm) && far.dpi === 32000 && far.clamped && !far.ok);
});

test('settableSens never returns 0 or Infinity (R6, DPI 32000, 100 cm)', () => {
  const r = settableSens(100, 32000, 0.00572957795, 0);
  assert.ok(r.sens >= 1 && Number.isFinite(r.cm) && Number.isFinite(r.errPct));
  assert.equal(r.ok, false);
});

test('altDpi searches DPIs near a non-multiple-of-100 input', () => {
  // OpenClaw repro: a target that a DPI of 850 cannot reach within 3% for R6.
  // Target where DPI 900 / R6 4 lands at +2.38%; the old search (850±100n, multiples of 100 only) found nothing.
  const cm = (914.4 / (900 * 0.00572957795 * 4)) / 1.0238;
  const r = altDpi(cm, 0.00572957795, 0, 850);
  assert.equal(r.dpi, 900);
  assert.equal(r.sens, 4);
  assert.ok(Math.abs(r.errPct - 2.38) < 0.01);
});
