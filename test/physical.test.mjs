import test from 'node:test';
import assert from 'node:assert/strict';
import {
  interp, TABLES, AREAS, scoreAll, totalScore, gameAge, gamerType, median, mean, rng, memorySequence,
  encodeResult, decodeResult, quantize, createTimingRun, MEMORY_MAX,
} from '../src/assets/js/lib/physical.js';

const raw = {
  reaction: { medianMs: 250, n: 7 },
  aim: { meanMs: 700, hitRate: 0.9 },
  track: { pct: 62 },
  timing: { meanErrMs: 30 },
  color: { medianMs: 900, accuracy: 0.94 },
  memory: { longest: 7 },
  meta: { falseStarts: 1, aimHits: 15, aimMisses: 2, timingN: 5, timingMisses: 0, colorCorrect: 15, colorN: 16 },
};
const summary = (r) => { const sc = scoreAll(r); const tot = totalScore(sc); return { sc, tot, age: gameAge(tot), type: gamerType(sc) }; };

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

test('shared result scores exactly like the shown result (OpenClaw repro)', () => {
  const repro = {
    reaction: { medianMs: 384, n: 7 }, aim: { meanMs: 1054, hitRate: 15 / 25 }, track: { pct: 82.559 },
    timing: { meanErrMs: 135 }, color: { medianMs: 1632, accuracy: 15 / 16 }, memory: { longest: 11 },
    meta: { falseStarts: 0, aimHits: 15, aimMisses: 10, timingN: 5, timingMisses: 3, colorCorrect: 15, colorN: 16 },
  };
  for (const r of [raw, repro]) {
    const shown = quantize(r, 'mouse');
    const restored = decodeResult(encodeResult(shown.raw, 'mouse'));
    assert.deepEqual(summary(restored.raw), summary(shown.raw));
    assert.deepEqual(restored.raw.meta, r.meta);
    assert.equal(encodeResult(restored.raw, 'mouse'), encodeResult(shown.raw, 'mouse'), 'code is a fixed point');
  }
  assert.equal(quantize(repro, 'mouse').raw.aim.hitRate, 0.6, 'ratios come back exactly from counts');
});

test('v1 links keep their meaning and report missing counts as null', () => {
  const back = decodeResult('v1.250.7.700.90.62.30.900.94.7.mouse');
  assert.equal(back.raw.meta, null);
  assert.equal(back.raw.aim.hitRate, 0.9);
  assert.equal(back.raw.color.accuracy, 0.94);
  assert.throws(() => encodeResult(back.raw, 'mouse'), RangeError, 'no counts to re-encode');
});

test('out-of-range values are refused, not clamped', () => {
  assert.throws(() => encodeResult({ ...raw, aim: { meanMs: 70000, hitRate: 1 } }, 'mouse'), RangeError);
  assert.throws(() => encodeResult({ ...raw, reaction: { medianMs: 2500, n: 7 } }, 'mouse'), RangeError);
});

test('timing run ends each round exactly once (OpenClaw P1)', () => {
  const tr = createTimingRun({ trials: 2, sweep: 1000, timeoutFrac: 1.15, cap: 150 });
  assert.equal(tr.press(5), null, 'press before start is ignored');
  assert.ok(tr.start(0, 0.5));
  assert.equal(tr.tick(1000), null);
  const timeout = tr.tick(1150);
  assert.ok(timeout && timeout.missed && !timeout.done);
  assert.equal(tr.press(1160), null, 'press after a timeout cannot end the round again');
  assert.equal(tr.tick(1200), null);
  assert.ok(tr.start(2000, 0.5));
  assert.equal(tr.start(2001, 0.5), false, 'cannot start twice');
  const hit = tr.press(2520);
  assert.equal(hit.err, 20);
  assert.ok(hit.done);
  assert.equal(tr.press(2600), null, 'press after the last round is ignored');
  assert.equal(tr.tick(9999), null, 'tick after the last round is ignored');
  assert.equal(tr.start(3000, 0.5), false);
  assert.deepEqual(tr.result(), { meanErrMs: (150 + 20) / 2, n: 2, misses: 1 });
});

test('last-round timeout followed by input finishes once', () => {
  const tr = createTimingRun({ trials: 1, sweep: 1000 });
  tr.start(0, 0.6);
  const r = tr.tick(1200);
  assert.ok(r.done && r.missed);
  assert.equal(tr.press(1210), null);
  assert.equal(tr.result().n, 1);
});

test('result code round-trips', () => {
  const code = encodeResult(raw, 'mouse');
  const back = decodeResult(code);
  assert.equal(back.input, 'mouse');
  assert.deepEqual(back.raw.meta, raw.meta);
  const a = scoreAll(raw);
  const b = scoreAll(back.raw);
  for (const k of AREAS) assert.ok(Math.abs(a[k] - b[k]) <= 1, k);
});

test('unmeasurable color result round-trips as not measurable', () => {
  const r2 = { ...raw, color: { medianMs: NaN, accuracy: 0 }, meta: { ...raw.meta, colorCorrect: 0 } };
  const back = decodeResult(encodeResult(r2, 'touch'));
  assert.ok(Number.isNaN(back.raw.color.medianMs));
  assert.equal(scoreAll(back.raw).color, 0);
});

test('incomplete results cannot be encoded', () => {
  assert.throws(() => encodeResult({ ...raw, reaction: { medianMs: NaN, n: 0 } }, 'mouse'), RangeError);
  assert.throws(() => encodeResult({ ...raw, meta: undefined }, 'mouse'), RangeError);
});

test('malformed share codes decode to null', () => {
  const good = encodeResult(raw, 'mouse');
  const p = good.split('.');
  const swap = (i, v) => { const q = [...p]; q[i] = v; return q.join('.'); };
  const bad = [
    '', 'v3' + good.slice(2), good + '.1', swap(15, 'robot'), swap(1, '-250'), swap(1, '2.5e2'), swap(2, '0'),
    swap(10, '6'), // misses > rounds
    swap(12, '17'), // correct > questions
    swap(11, '0'), // colorMs 0 with correct answers
    swap(14, String(MEMORY_MAX + 1)), 'v1.1.1.1.1.1.1.1.1.1.mouse', 'x'.repeat(200), null, 42,
  ];
  for (const b of bad) assert.equal(decodeResult(b), null, String(b));
});
