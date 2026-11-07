import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SIZES,
  SPEEDS,
  DURATIONS,
  MEASURE_VERSION,
  MAPPINGS,
  spawnPair,
  respawn,
  judge,
  summarize,
  compareKey
} from '../src/assets/js/lib/kite.js';

const arena = { w: 800, h: 450, top: 48 };
const base = {
  move: { x: 100, y: 200, vx: 0, vy: 0, r: 22 },
  attack: { x: 400, y: 200, vx: 0, vy: 0, r: 22 },
  turn: 'move'
};

test('constants match the tool contract', () => {
  assert.deepEqual(SIZES, { S: 14, M: 22, L: 32 });
  assert.deepEqual(SPEEDS, { still: 0, slow: 90, fast: 200 });
  assert.deepEqual(DURATIONS, [30, 60]);
  assert.equal(MEASURE_VERSION, 1);
});

test('judge accepts the right button on the turn target and passes the turn', () => {
  const result = judge(base, MAPPINGS.rl.move, 100, 200, MAPPINGS.rl, { arena, size: 22 });
  assert.equal(result.kind, 'ok');
  assert.equal(result.next.turn, 'attack');
  assert.deepEqual(result.next.attack, base.attack);
  assert.ok(Math.hypot(result.next.move.x - base.attack.x, result.next.move.y - base.attack.y) >= 80);
});

test('judge reports a miss outside any target and keeps the turn', () => {
  const result = judge(base, 2, 700, 400, MAPPINGS.rl);
  assert.equal(result.kind, 'miss');
  assert.equal(result.next.turn, 'move');
});

test('judge reports an order error for the wrong button', () => {
  const onTarget = judge(base, 0, 100, 200, MAPPINGS.rl);
  assert.equal(onTarget.kind, 'order');
  assert.equal(onTarget.next.turn, 'move');
  const elsewhere = judge(base, 0, 700, 400, MAPPINGS.rl);
  assert.equal(elsewhere.kind, 'order');
});

test('judge reports a wrong target for the right button on the other target', () => {
  const result = judge(base, 2, 400, 200, MAPPINGS.rl);
  assert.equal(result.kind, 'wrongTarget');
  assert.equal(result.next.turn, 'move');
});

test('left-only mode never reports an order error and only checks the sequence', () => {
  assert.equal(judge(base, 0, 100, 200, MAPPINGS.ll).kind, 'ok');
  assert.equal(judge(base, 0, 400, 200, MAPPINGS.ll).kind, 'wrongTarget');
  assert.equal(judge(base, 0, 700, 400, MAPPINGS.ll).kind, 'miss');
  const attackTurn = { ...base, turn: 'attack' };
  assert.equal(judge(attackTurn, 0, 400, 200, MAPPINGS.ll).kind, 'ok');
  assert.equal(judge(attackTurn, 0, 100, 200, MAPPINGS.ll).kind, 'wrongTarget');
});

test('swapped mapping uses left for move and right for attack', () => {
  assert.equal(judge(base, 0, 100, 200, MAPPINGS.lr).kind, 'ok');
  assert.equal(judge(base, 2, 100, 200, MAPPINGS.lr).kind, 'order');
  const attackTurn = { ...base, turn: 'attack' };
  assert.equal(judge(attackTurn, 2, 400, 200, MAPPINGS.lr).kind, 'ok');
});

test('summarize computes the median gap between consecutive ok clicks', () => {
  const result = summarize([
    { type: 'ok', at: 1.0 },
    { type: 'order', at: 1.2 },
    { type: 'ok', at: 1.5 },
    { type: 'ok', at: 2.1 },
    { type: 'miss', at: 2.3 },
    { type: 'ok', at: 3.1 },
    { type: 'wrongTarget', at: 3.2 }
  ]);
  assert.equal(result.clicks, 7);
  assert.equal(result.ok, 4);
  assert.equal(result.misses, 1);
  assert.equal(result.orderErrors, 1);
  assert.equal(result.wrongTargets, 1);
  assert.equal(result.accuracy, 4 / 7);
  assert.equal(result.medianSwitchMs, null, 'fewer than 6 ok clicks: no representative gap');
  assert.equal(result.pairs, 2);
});

test('summarize reports the median gap with enough ok clicks and skips gaps across a resume', () => {
  const result = summarize([
    { type: 'ok', at: 1.0 }, { type: 'ok', at: 1.5 }, { type: 'ok', at: 2.0 },
    { type: 'break', at: 2.0 },
    { type: 'ok', at: 9.0 }, { type: 'ok', at: 9.5 }, { type: 'ok', at: 10.0 }
  ]);
  assert.equal(result.clicks, 6);
  assert.equal(result.ok, 6);
  assert.equal(Math.round(result.medianSwitchMs), 500);
});

test('summarize flags empty and insufficient runs', () => {
  const empty = summarize([]);
  assert.equal(empty.empty, true);
  assert.equal(empty.insufficient, true);
  assert.equal(empty.accuracy, 0);
  assert.equal(empty.medianSwitchMs, null);
  const few = summarize([{ type: 'ok', at: 1 }, { type: 'ok', at: 2 }, { type: 'miss', at: 3 }]);
  assert.equal(few.empty, false);
  assert.equal(few.insufficient, true);
  const events = Array.from({ length: 6 }, (_, index) => ({ type: 'ok', at: index }));
  assert.equal(summarize(events).insufficient, false);
});

test('spawnPair and respawn keep targets 80px apart inside the area', () => {
  let state = spawnPair(arena, SIZES.L, SPEEDS.slow);
  for (let index = 0; index < 300; index += 1) {
    const which = index % 2 ? 'attack' : 'move';
    state = respawn(state, which, arena, SIZES.L, SPEEDS.slow);
    for (const target of [state.move, state.attack]) {
      assert.ok(target.x >= SIZES.L + 8 - 1e-9 && target.x <= arena.w - SIZES.L - 8 + 1e-9);
      assert.ok(target.y >= arena.top + SIZES.L + 8 - 1e-9 && target.y <= arena.h - SIZES.L - 8 + 1e-9);
    }
    assert.ok(Math.hypot(state.move.x - state.attack.x, state.move.y - state.attack.y) >= 80 - 1e-9);
  }
  assert.ok(Math.abs(Math.hypot(state.move.vx, state.move.vy) - SPEEDS.slow) < 1e-9);
  assert.equal(spawnPair(arena, SIZES.M, 0).move.vx, 0);
  assert.equal(spawnPair(arena, SIZES.M, 0).turn, 'move');
});

test('compareKey ignores small arena differences but not mapping or size', () => {
  const cfg = { size: SIZES.M, speed: SPEEDS.slow, duration: 30, map: 'rl' };
  const key = compareKey(cfg, { w: 800, h: 450 });
  assert.equal(key, compareKey(cfg, { w: 899, h: 499 }));
  assert.notEqual(key, compareKey({ ...cfg, map: 'lr' }, { w: 800, h: 450 }));
  assert.notEqual(key, compareKey({ ...cfg, map: 'll' }, { w: 800, h: 450 }));
  assert.notEqual(key, compareKey({ ...cfg, size: SIZES.L }, { w: 800, h: 450 }));
  assert.equal(JSON.parse(key).tool, 'kite');
  assert.equal(JSON.parse(key).measureVersion, MEASURE_VERSION);
});
