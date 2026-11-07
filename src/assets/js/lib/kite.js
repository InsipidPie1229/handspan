import { median } from './stats.js';
import { stepTarget, isHit } from './click.js';

export const SIZES = { S: 14, M: 22, L: 32 };
export const SPEEDS = { still: 0, slow: 90, fast: 200 };
export const DURATIONS = [30, 60];
export const MEASURE_VERSION = 1;
// Mouse button numbers: 0 is the left button, 2 is the right button.
export const MAPPINGS = {
  rl: { move: 2, attack: 0 },
  lr: { move: 0, attack: 2 },
  ll: { move: 0, attack: 0 }
};

const MIN_PAIR_DIST = 80;
const EDGE_MARGIN = 8;
const MIN_OK = 6;

function randomBetween(rng, min, max) {
  return min + rng() * Math.max(0, max - min);
}

function bounds(arena, radius) {
  const w = arena && Number.isFinite(arena.w) ? arena.w : 0;
  const h = arena && Number.isFinite(arena.h) ? arena.h : 0;
  const top = arena && Number.isFinite(arena.top) ? arena.top : 0; // keeps targets clear of the HUD band
  const pad = Math.min(radius + EDGE_MARGIN, w / 2, h / 2);
  const yMin = Math.min(pad + top, h - pad);
  return { xMin: pad, xMax: Math.max(pad, w - pad), yMin, yMax: Math.max(yMin, h - pad) };
}

function place(other, arena, radius, speed, rng) {
  const b = bounds(arena, radius);
  let best = { x: (b.xMin + b.xMax) / 2, y: (b.yMin + b.yMax) / 2 };
  let bestDist = -1;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const x = randomBetween(rng, b.xMin, b.xMax);
    const y = randomBetween(rng, b.yMin, b.yMax);
    const dist = other ? Math.hypot(x - other.x, y - other.y) : Infinity;
    if (dist >= MIN_PAIR_DIST) {
      best = { x, y };
      break;
    }
    if (dist > bestDist) {
      bestDist = dist;
      best = { x, y };
    }
  }
  let vx = 0;
  let vy = 0;
  if (speed > 0) {
    const angle = rng() * Math.PI * 2;
    vx = Math.cos(angle) * speed;
    vy = Math.sin(angle) * speed;
  }
  return { x: best.x, y: best.y, vx, vy, r: radius };
}

// State: { move, attack, turn } where turn is 'move' or 'attack' (the target to press next).
export function spawnPair(arena, size, speed = 0, rng = Math.random) {
  const move = place(null, arena, size, speed, rng);
  const attack = place(move, arena, size, speed, rng);
  return { move, attack, turn: 'move' };
}

export function respawn(state, which, arena, size, speed = 0, rng = Math.random) {
  const other = which === 'move' ? state.attack : state.move;
  const fresh = place(other, arena, size, speed, rng);
  return { ...state, [which]: fresh };
}

export function stepPair(state, dt, arena) {
  if (!state) return state;
  return { ...state, move: stepTarget(state.move, dt, arena), attack: stepTarget(state.attack, dt, arena) };
}

// opts: { arena, size, speed, rng } lets a successful click respawn the target that was pressed.
export function judge(state, button, x, y, mapping, opts = {}) {
  const map = mapping || MAPPINGS.rl;
  const turn = state.turn;
  const other = turn === 'move' ? 'attack' : 'move';
  if (map.move !== map.attack && button !== map[turn]) return { kind: 'order', next: state };
  if (isHit(state[turn], x, y)) {
    let next = { ...state, turn: other };
    if (opts.arena) {
      const size = Number.isFinite(opts.size) ? opts.size : state[turn].r;
      next = respawn(next, turn, opts.arena, size, opts.speed || 0, opts.rng || Math.random);
    }
    return { kind: 'ok', next };
  }
  if (isHit(state[other], x, y)) return { kind: 'wrongTarget', next: state };
  return { kind: 'miss', next: state };
}

// Events: { type: 'ok'|'miss'|'order'|'wrongTarget', at: seconds since the run started }.
export function summarize(events) {
  const all = Array.isArray(events) ? events : [];
  const list = all.filter((event) => event && event.type !== 'break');
  const count = (type) => list.filter((event) => event.type === type).length;
  const clicks = list.length;
  const ok = count('ok');
  // Switch gaps between consecutive ok clicks; a 'break' (resume after pause) starts a new chain.
  const gaps = [];
  let prevOk = null;
  for (const event of all) {
    if (!event) continue;
    if (event.type === 'break') prevOk = null;
    else if (event.type === 'ok' && Number.isFinite(event.at)) {
      if (prevOk !== null) gaps.push((event.at - prevOk) * 1000);
      prevOk = event.at;
    }
  }
  return {
    clicks,
    ok,
    misses: count('miss'),
    orderErrors: count('order'),
    wrongTargets: count('wrongTarget'),
    accuracy: clicks > 0 ? ok / clicks : 0,
    medianSwitchMs: gaps.length && ok >= MIN_OK ? median(gaps) : null,
    pairs: Math.floor(ok / 2),
    empty: clicks === 0,
    insufficient: ok < MIN_OK
  };
}

export function compareKey(cfg, arena) {
  const c = cfg || {};
  return JSON.stringify({
    tool: 'kite',
    size: c.size,
    speed: c.speed,
    duration: c.duration,
    map: c.map,
    arenaW: Math.floor(((arena && arena.w) || 0) / 100) * 100,
    arenaH: Math.floor(((arena && arena.h) || 0) / 100) * 100,
    measureVersion: MEASURE_VERSION
  });
}
