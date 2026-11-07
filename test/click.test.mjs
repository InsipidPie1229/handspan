import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SIZES,
  SPEEDS,
  DURATIONS,
  DIST_EDGES,
  MEASURE_VERSION,
  spawnTarget,
  stepTarget,
  isHit,
  summarize,
  compareKey
} from '../src/assets/js/lib/click.js';

function seededRng(values) {
  let index = 0;
  return () => {
    const value = values[index % values.length];
    index += 1;
    return value;
  };
}

test('constants match the tool contract', () => {
  assert.deepEqual(SIZES, { S: 14, M: 22, L: 32 });
  assert.deepEqual(SPEEDS, { still: 0, slow: 120, fast: 260 });
  assert.deepEqual(DURATIONS, [30, 60]);
  assert.deepEqual(DIST_EDGES, [100, 200, 300, 400]);
  assert.equal(MEASURE_VERSION, 1);
});

test('spawnTarget stays inside the arena and away from the previous target', () => {
  const arena = { w: 800, h: 450 };
  let prev = null;
  for (const rng of [seededRng([0]), seededRng([0.5]), seededRng([0.99]), Math.random]) {
    const target = spawnTarget(prev, arena, SIZES.M, rng);
    assert.ok(target.x >= SIZES.M + 8);
    assert.ok(target.x <= arena.w - SIZES.M - 8);
    assert.ok(target.y >= SIZES.M + 8);
    assert.ok(target.y <= arena.h - SIZES.M - 8);
    if (prev) assert.ok(Math.hypot(target.x - prev.x, target.y - prev.y) >= 60);
    prev = target;
  }
});

test('spawnTarget keeps targets apart across many random spawns', () => {
  const arena = { w: 640, h: 360 };
  let prev = null;
  for (let index = 0; index < 200; index += 1) {
    const target = spawnTarget(prev, arena, SIZES.L, Math.random);
    assert.ok(target.x - SIZES.L >= 8 - 1e-9);
    assert.ok(target.y - SIZES.L >= 8 - 1e-9);
    if (prev) assert.ok(Math.hypot(target.x - prev.x, target.y - prev.y) >= 60 - 1e-9);
    prev = target;
  }
});

test('spawnTarget gives a speed vector only when the target moves', () => {
  const arena = { w: 800, h: 450 };
  const still = spawnTarget(null, arena, SIZES.M, Math.random, SPEEDS.still);
  assert.equal(still.vx, 0);
  assert.equal(still.vy, 0);
  const slow = spawnTarget(null, arena, SIZES.M, Math.random, SPEEDS.slow);
  assert.ok(Math.abs(Math.hypot(slow.vx, slow.vy) - SPEEDS.slow) < 1e-9);
});

test('stepTarget moves and reflects off the arena walls', () => {
  const arena = { w: 400, h: 300 };
  const moved = stepTarget({ x: 100, y: 100, vx: 50, vy: -20, r: 20 }, 1, arena);
  assert.equal(moved.x, 150);
  assert.equal(moved.y, 80);
  const bounced = stepTarget({ x: 385, y: 10, vx: 50, vy: -50, r: 20 }, 1, arena);
  assert.equal(bounced.x, 380);
  assert.equal(bounced.y, 20);
  assert.ok(bounced.vx < 0);
  assert.ok(bounced.vy > 0);
});

test('isHit includes the radius boundary', () => {
  const target = { x: 100, y: 100, r: 20 };
  assert.equal(isHit(target, 100, 100), true);
  assert.equal(isHit(target, 120, 100), true);
  assert.equal(isHit(target, 120.01, 100), false);
  assert.equal(isHit(null, 0, 0), false);
});

test('summarize flags empty and insufficient samples', () => {
  const empty = summarize([], { size: SIZES.M, speed: 0, duration: 30 });
  assert.equal(empty.clicks, 0);
  assert.equal(empty.hits, 0);
  assert.equal(empty.accuracy, 0);
  assert.equal(empty.empty, true);
  assert.equal(empty.insufficient, true);

  const few = summarize([
    { type: 'hit', t: 0.4, dist: 80 },
    { type: 'miss', t: 0.6, dist: 80 },
    { type: 'hit', t: 0.5, dist: 120 }
  ]);
  assert.equal(few.clicks, 3);
  assert.equal(few.hits, 2);
  assert.equal(few.misses, 1);
  assert.equal(few.insufficient, true);
  assert.equal(few.empty, false);
});

test('summarize computes accuracy and the median acquire time', () => {
  const events = [
    { type: 'hit', t: 0.3, dist: 80 },
    { type: 'hit', t: 0.5, dist: 150 },
    { type: 'hit', t: 0.7, dist: 250 },
    { type: 'hit', t: 0.9, dist: 350 },
    { type: 'hit', t: 1.1, dist: 450 },
    { type: 'miss', t: 0.2, dist: 90 }
  ];
  const result = summarize(events, { size: SIZES.M, speed: 0, duration: 30 });
  assert.equal(result.clicks, 6);
  assert.equal(result.hits, 5);
  assert.equal(result.misses, 1);
  assert.equal(result.accuracy, 5 / 6);
  assert.equal(result.medianAcquire, 700);
  assert.equal(result.insufficient, false);
});

test('summarize puts distances on the correct bin boundaries', () => {
  const events = [
    { type: 'hit', t: 0.1, dist: 100 },
    { type: 'hit', t: 0.2, dist: 100.01 },
    { type: 'hit', t: 0.3, dist: 400 },
    { type: 'hit', t: 0.4, dist: 400.01 }
  ];
  const result = summarize(events);
  assert.equal(result.bins[0].n, 1);
  assert.equal(result.bins[1].n, 1);
  assert.equal(result.bins[3].n, 1);
  assert.equal(result.bins[4].n, 1);
  assert.equal(result.bins[2].n, 0);
});

test('summarize hides a bin median below three samples', () => {
  const result = summarize([
    { type: 'hit', t: 0.2, dist: 50 },
    { type: 'hit', t: 0.4, dist: 60 },
    { type: 'hit', t: 0.6, dist: 70 },
    { type: 'hit', t: 0.8, dist: 150 },
    { type: 'hit', t: 1.0, dist: 160 }
  ]);
  assert.equal(result.bins[0].n, 3);
  assert.equal(result.bins[0].median, 400);
  assert.equal(result.bins[1].n, 2);
  assert.equal(result.bins[1].median, null);
});

test('compareKey ignores sub-100px arena differences but keeps real size changes', () => {
  const cfg = { size: SIZES.M, speed: SPEEDS.slow, duration: 30 };
  const base = compareKey(cfg, { w: 800, h: 450 });
  assert.equal(base, compareKey(cfg, { w: 899, h: 499 }));
  assert.notEqual(base, compareKey({ ...cfg, size: SIZES.L }, { w: 800, h: 450 }));
  assert.notEqual(base, compareKey(cfg, { w: 900, h: 450 }));
  assert.equal(JSON.parse(base).tool, 'click');
  assert.equal(JSON.parse(base).measureVersion, MEASURE_VERSION);
});
