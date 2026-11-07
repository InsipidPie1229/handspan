import test from 'node:test';
import assert from 'node:assert/strict';
import {
  interp, TABLES, AREAS, scoreAll, totalScore, gameAge, gamerType, median, mean, rng, memorySequence,
  encodeResult, decodeResult, MEMORY_MAX,
} from '../src/assets/js/lib/physical.js';

const raw = {
  reaction: { medianMs: 250, n: 7 },
  aim: { meanMs: 700, hitRate: 0.9 },
  track: { pct: 62 },
  timing: { meanErrMs: 30 },
  color: { medianMs: 900, accuracy: 0.94 },
  memory: { longest: 7 },
};

test('interp clamps and interpolates', () => {
  const pts = [[0, 0], [10, 100]];
  assert.equal(interp(pts, -5), 0);
  assert.equal(interp(pts, 5), 50);
  assert.equal(interp(pts, 50), 100);
  assert.equal(interp(pts, NaN), 0);
  for (const k of AREAS) {
    const xs = TABLES[k].map((p) => p[0]);
    assert.deepEqual(xs, [...xs].sort((a, b) => a - b), `${k} table sorted`);
  }
});

test('scores are integers in 0..100 and penalties apply', () => {
  const s = scoreAll(raw);
  for (const k of AREAS) assert.ok(Number.isInteger(s[k]) && s[k] >= 0 && s[k] <= 100, k);
  const perfectAim = scoreAll({ ...raw, aim: { meanMs: 700, hitRate: 1 } }).aim;
  assert.ok(s.aim < perfectAim);
  assert.equal(scoreAll({ ...raw, color: { medianMs: NaN, accuracy: 0 } }).color, 0, 'no correct answers scores 0, not NaN');
});

test('game age and total are bounded', () => {
  assert.equal(gameAge(100), 16);
  assert.equal(gameAge(0), 66);
  assert.equal(gameAge(150), 16);
  assert.equal(gameAge(-20), 66);
  const s = scoreAll(raw);
  const total = totalScore(s);
  assert.ok(total >= 0 && total <= 100);
});

test('gamer type rules', () => {
  const flat = Object.fromEntries(AREAS.map((k) => [k, 85]));
  assert.equal(gamerType(flat), 'allround');
  const low = Object.fromEntries(AREAS.map((k) => [k, 20]));
  assert.equal(gamerType(low), 'relaxed');
  assert.equal(gamerType({ ...low, timing: 95, reaction: 60, aim: 60, track: 60 }), 'timing');
});

test('median and mean ignore non-finite values', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
  assert.ok(Number.isNaN(median([])));
  assert.equal(mean([1, NaN, 3]), 2);
});

test('memory sequence is deterministic, in range and never repeats a cell back to back', () => {
  const a = memorySequence(rng(42), MEMORY_MAX);
  assert.deepEqual(a, memorySequence(rng(42), MEMORY_MAX));
  assert.equal(a.length, MEMORY_MAX);
  for (let i = 0; i < a.length; i++) {
    assert.ok(a[i] >= 0 && a[i] <= 8);
    if (i) assert.notEqual(a[i], a[i - 1]);
  }
});

test('result code round-trips and keeps the score', () => {
  const code = encodeResult(raw, 'mouse');
  const back = decodeResult(code);
  assert.equal(back.input, 'mouse');
  const a = scoreAll(raw);
  const b = scoreAll(back.raw);
  for (const k of AREAS) assert.ok(Math.abs(a[k] - b[k]) <= 1, k);
});

test('unmeasurable color result round-trips as not measurable', () => {
  const r2 = { ...raw, color: { medianMs: NaN, accuracy: 0 } };
  const back = decodeResult(encodeResult(r2, 'touch'));
  assert.ok(Number.isNaN(back.raw.color.medianMs));
  assert.equal(scoreAll(back.raw).color, 0);
});

test('incomplete results cannot be encoded', () => {
  assert.throws(() => encodeResult({ ...raw, reaction: { medianMs: NaN, n: 0 } }, 'mouse'), RangeError);
});

test('malformed share codes decode to null', () => {
  const good = encodeResult(raw, 'mouse');
  const bad = [
    '', 'v2' + good.slice(2), good + '.1', good.replace('mouse', 'robot'), good.replace('.7.', '.-7.'),
    good.replace('.7.', '.7e2.'), good.replace('.7.', '.0.'), 'v1.1.1.1.1.1.1.1.1.1.mouse', 'x'.repeat(200),
    // colorMs 0 is only valid with accuracy 0
    ['v1', 250, 7, 700, 90, 62, 30, 0, 94, 7, 'mouse'].join('.'),
    ['v1', 250, 7, 700, 90, 62, 30, 900, 0, 7, 'mouse'].join('.'),
    ['v1', 250, 7, 700, 90, 62, 30, 900, 94, MEMORY_MAX + 1, 'mouse'].join('.'),
    null, 42,
  ];
  for (const b of bad) assert.equal(decodeResult(b), null, String(b));
});
