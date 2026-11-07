import { binBy, median } from './stats.js';

export const SIZES = { S: 14, M: 22, L: 32 };
export const SPEEDS = { still: 0, slow: 120, fast: 260 };
export const DURATIONS = [30, 60];
export const DIST_EDGES = [100, 200, 300, 400];
export const MEASURE_VERSION = 1;

const BIN_LABELS = ['≤100', '100–200', '200–300', '300–400', '>400'];
const MIN_SPAWN_DIST = 60;
const EDGE_MARGIN = 8;
const MIN_BIN_SAMPLES = 3;
export const MIN_HITS = 5;

function randomBetween(rng, min, max) {
  return min + rng() * Math.max(0, max - min);
}

export function spawnTarget(prev, arena, size, rng = Math.random, speed = 0) {
  const w = arena && Number.isFinite(arena.w) ? arena.w : 0;
  const h = arena && Number.isFinite(arena.h) ? arena.h : 0;
  let radius = Number.isFinite(size) ? size : 0;
  let moveSpeed = speed;
  if (size && typeof size === 'object') {
    radius = Number.isFinite(size.r) ? size.r : (Number.isFinite(size.radius) ? size.radius : 0);
    if (!moveSpeed) moveSpeed = Number.isFinite(size.speed) ? size.speed : 0;
  }
  const pad = Math.min(radius + EDGE_MARGIN, w / 2, h / 2);
  const xMin = pad;
  const xMax = Math.max(pad, w - pad);
  const top = arena && Number.isFinite(arena.top) ? arena.top : 0; // keeps targets clear of the HUD band
  const yMin = Math.min(pad + top, h - pad);
  const yMax = Math.max(yMin, h - pad);

  let best = { x: (xMin + xMax) / 2, y: (yMin + yMax) / 2 };
  let bestDist = -1;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const x = randomBetween(rng, xMin, xMax);
    const y = randomBetween(rng, yMin, yMax);
    const dist = prev ? Math.hypot(x - prev.x, y - prev.y) : Infinity;
    if (dist >= MIN_SPAWN_DIST) {
      best = { x, y };
      bestDist = dist;
      break;
    }
    if (dist > bestDist) {
      bestDist = dist;
      best = { x, y };
    }
  }

  let vx = 0;
  let vy = 0;
  if (moveSpeed > 0) {
    const angle = rng() * Math.PI * 2;
    vx = Math.cos(angle) * moveSpeed;
    vy = Math.sin(angle) * moveSpeed;
  }

  return { x: best.x, y: best.y, vx, vy, r: radius };
}

export function stepTarget(t, dt, arena) {
  if (!t) return t;
  const step = Number.isFinite(dt) && dt > 0 ? dt : 0;
  const w = arena && Number.isFinite(arena.w) ? arena.w : 0;
  const h = arena && Number.isFinite(arena.h) ? arena.h : 0;
  const r = Number.isFinite(t.r) ? t.r : 0;
  let vx = Number.isFinite(t.vx) ? t.vx : 0;
  let vy = Number.isFinite(t.vy) ? t.vy : 0;
  let x = t.x + vx * step;
  let y = t.y + vy * step;

  const xMin = r;
  const xMax = w - r;
  const yMin = r + (arena && Number.isFinite(arena.top) ? arena.top : 0);
  const yMax = h - r;

  if (xMax < xMin) {
    x = w / 2;
    vx = 0;
  } else if (x < xMin) {
    x = xMin;
    vx = Math.abs(vx);
  } else if (x > xMax) {
    x = xMax;
    vx = -Math.abs(vx);
  }

  if (yMax < yMin) {
    y = h / 2;
    vy = 0;
  } else if (y < yMin) {
    y = yMin;
    vy = Math.abs(vy);
  } else if (y > yMax) {
    y = yMax;
    vy = -Math.abs(vy);
  }

  return { ...t, x, y, vx, vy };
}

export function isHit(t, x, y) {
  if (!t) return false;
  const radius = Number.isFinite(t.r) ? t.r : 0;
  return Math.hypot(x - t.x, y - t.y) <= radius;
}

export function summarize(events, cfg = {}) {
  const list = Array.isArray(events) ? events : [];
  const clicks = list.length;
  const hitEvents = list.filter((event) => event && event.type === 'hit');
  const hits = hitEvents.length;
  const misses = clicks - hits;
  const accuracy = clicks > 0 ? hits / clicks : 0;
  const times = hitEvents.map((event) => event.t).filter(Number.isFinite);
  const medianAcquire = times.length ? median(times) * 1000 : null;

  const withDist = hitEvents.filter((event) => Number.isFinite(event.dist));
  const grouped = binBy(withDist.map((event) => event.dist), DIST_EDGES);
  const bins = grouped.map((group, index) => {
    const values = withDist
      .filter((event) => {
        let bin = 0;
        while (bin < DIST_EDGES.length && event.dist > DIST_EDGES[bin]) bin += 1;
        return bin === index;
      })
      .map((event) => event.t)
      .filter(Number.isFinite);
    const n = values.length;
    return {
      label: BIN_LABELS[index],
      n,
      median: n >= MIN_BIN_SAMPLES ? median(values) * 1000 : null
    };
  });

  // Below MIN_HITS no representative time is produced anywhere (screen, history, image).
  const insufficient = hits < MIN_HITS;
  return {
    clicks,
    hits,
    misses,
    accuracy,
    medianAcquire: insufficient ? null : medianAcquire,
    bins: insufficient ? bins.map((bin) => ({ ...bin, median: null })) : bins,
    empty: clicks === 0,
    insufficient
  };
}

export function compareKey(cfg, arena) {
  const c = cfg || {};
  return JSON.stringify({
    tool: 'click',
    size: c.size,
    speed: c.speed,
    duration: c.duration,
    arenaW: Math.floor(((arena && arena.w) || 0) / 100) * 100,
    arenaH: Math.floor(((arena && arena.h) || 0) / 100) * 100,
    measureVersion: MEASURE_VERSION
  });
}
