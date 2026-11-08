// Game physical test: scoring rules (v1), result encoding for share links, small helpers.
// The "game age" is handspan's own fun grade, not an estimate of anyone's real age.

export const RULES_VERSION = 'v1';

/** Piecewise-linear map through [x, y] points (x ascending); clamps outside the range. */
export function interp(points, x) {
  if (!Number.isFinite(x)) return 0;
  if (x <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [x1, y1] = points[i];
    if (x <= x1) {
      const [x0, y0] = points[i - 1];
      return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
    }
  }
  return points[points.length - 1][1];
}

/** Score tables (raw value -> 0..100). Published on the page; change RULES_VERSION when editing. */
export const TABLES = {
  reaction: [[180, 100], [220, 85], [260, 70], [300, 55], [350, 35], [450, 10], [600, 0]], // median ms
  aim: [[450, 100], [600, 80], [800, 60], [1000, 40], [1400, 15], [2000, 0]], // mean ms per target
  track: [[10, 0], [30, 20], [45, 40], [60, 60], [75, 80], [90, 100]], // % time on target
  timing: [[10, 100], [20, 85], [35, 65], [50, 50], [80, 25], [150, 0]], // mean |error| ms
  color: [[600, 100], [800, 80], [1000, 60], [1300, 40], [1800, 15], [2500, 0]], // median correct ms
  memory: [[2, 0], [3, 10], [5, 40], [7, 65], [9, 85], [11, 100]], // longest sequence
};

export const AREAS = ['reaction', 'aim', 'track', 'timing', 'color', 'memory'];

/**
 * Raw results -> per-area scores. Accuracy-based penalties:
 * aim × (0.5 + 0.5 × hit rate), color × accuracy².
 */
export function scoreAll(raw) {
  const s = {
    reaction: interp(TABLES.reaction, raw.reaction.medianMs),
    aim: interp(TABLES.aim, raw.aim.meanMs) * (0.5 + 0.5 * clamp01(raw.aim.hitRate)),
    track: interp(TABLES.track, raw.track.pct),
    timing: interp(TABLES.timing, raw.timing.meanErrMs),
    // No correct answers: median is not measurable and the area scores 0.
    color: raw.color.accuracy > 0 ? interp(TABLES.color, raw.color.medianMs) * clamp01(raw.color.accuracy) ** 2 : 0,
    memory: interp(TABLES.memory, raw.memory.longest),
  };
  for (const k of AREAS) s[k] = Math.round(s[k]);
  return s;
}

function clamp01(v) {
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
}

export function totalScore(scores) {
  return Math.round(AREAS.reduce((a, k) => a + scores[k], 0) / AREAS.length);
}

/** Fun grade: total 100 -> 16, each point below adds half a year, capped at 66. */
export function gameAge(total) {
  return Math.min(66, Math.max(16, Math.round(16 + (100 - total) * 0.5)));
}

/** Type key: balanced high, low overall, or the strongest area. */
export function gamerType(scores) {
  const vals = AREAS.map((k) => scores[k]);
  const total = totalScore(scores);
  if (total >= 75 && Math.max(...vals) - Math.min(...vals) <= 20) return 'allround';
  if (total < 35) return 'relaxed';
  let best = AREAS[0];
  for (const k of AREAS) if (scores[k] > scores[best]) best = k;
  return best;
}

export function median(xs) {
  const a = xs.filter(Number.isFinite).sort((x, y) => x - y);
  if (!a.length) return NaN;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

export function mean(xs) {
  const a = xs.filter(Number.isFinite);
  return a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN;
}

/** Deterministic PRNG (mulberry32) so tests can replay a run. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Memory sequence over a 3×3 grid; no cell repeats immediately. */
export function memorySequence(rand, length) {
  const seq = [];
  while (seq.length < length) {
    const c = Math.floor(rand() * 9);
    if (c !== seq[seq.length - 1]) seq.push(c);
  }
  return seq;
}

/** Signed timing error in ms: needle position vs. target, given needle speed (units per ms). */
export function timingError(pos, target, speed) {
  return (pos - target) / speed;
}

// ---- Share links -------------------------------------------------------------------------
// v2 (current): r=v2.<reactMs>.<reactN>.<falseStarts>.<aimMs>.<aimHits>.<aimMisses>.<track%>
//                  .<timingMs>.<timingN>.<timingMisses>.<colorMs>.<colorCorrect>.<colorN>.<memory>.<input>
// v1 (older links): r=v1.<reactMs>.<reactN>.<aimMs>.<hit%>.<track%>.<timingMs>.<colorMs>.<acc%>.<memory>.<input>
// All values are integers; ratios are stored as counts so they come back exactly. v1 links have no
// counts (meta is null) and must be shown as "no information", never filled in.
// colorMs 0 means "not measurable" and goes with 0 correct answers.

const INPUTS = ['mouse', 'touch', 'pen', 'keyboard', 'mixed'];
export const MEMORY_MAX = 12;
const V1_LIMITS = [
  [100, 2000], [1, 50], [100, 10000], [0, 100], [0, 100], [0, 1000], [0, 10000], [0, 100], [0, MEMORY_MAX],
];
const V2_LIMITS = [
  [100, 2000], [1, 50], [0, 99], [1, 60000], [1, 99], [0, 999], [0, 100],
  [0, 1000], [1, 50], [0, 50], [0, 60000], [0, 99], [1, 99], [0, MEMORY_MAX],
];

function ints(parts, limits) {
  const v = parts.map((p) => (/^\d{1,5}$/.test(p) ? Number(p) : NaN));
  return v.every((x, i) => Number.isInteger(x) && x >= limits[i][0] && x <= limits[i][1]) ? v : null;
}

export function encodeResult(raw, input) {
  const m = raw.meta;
  if (!m) throw new RangeError('measurement counts missing');
  const colorMs = m.colorCorrect > 0 ? raw.color.medianMs : 0;
  const v = [
    raw.reaction.medianMs, raw.reaction.n, m.falseStarts, raw.aim.meanMs, m.aimHits, m.aimMisses, raw.track.pct,
    raw.timing.meanErrMs, m.timingN, m.timingMisses, colorMs, m.colorCorrect, m.colorN, raw.memory.longest,
  ].map((x, i) => {
    // Units: whole ms, whole % (tracking), counts. Out-of-range values are refused, never clamped.
    const r = Math.round(x);
    if (!Number.isFinite(x) || r < V2_LIMITS[i][0] || r > V2_LIMITS[i][1]) throw new RangeError('result cannot be shared');
    return r;
  });
  return ['v2', ...v, INPUTS.includes(input) ? input : 'mixed'].join('.');
}

export function decodeResult(str) {
  if (typeof str !== 'string' || str.length > 160) return null;
  const parts = str.split('.');
  const input = parts[parts.length - 1];
  if (!INPUTS.includes(input)) return null;
  if (parts[0] === 'v2' && parts.length === 16) {
    const v = ints(parts.slice(1, 15), V2_LIMITS);
    if (!v) return null;
    const [rMs, rN, fs, aMs, hits, misses, track, tMs, tN, tMiss, cMs, cCorrect, cN, mem] = v;
    if (tMiss > tN || cCorrect > cN || (cMs === 0) !== (cCorrect === 0)) return null;
    return {
      raw: {
        reaction: { medianMs: rMs, n: rN },
        aim: { meanMs: aMs, hitRate: hits / (hits + misses) },
        track: { pct: track },
        timing: { meanErrMs: tMs },
        color: { medianMs: cMs === 0 ? NaN : cMs, accuracy: cCorrect / cN },
        memory: { longest: mem },
        meta: { falseStarts: fs, aimHits: hits, aimMisses: misses, timingN: tN, timingMisses: tMiss, colorCorrect: cCorrect, colorN: cN },
      },
      input,
    };
  }
  if (parts[0] === 'v1' && parts.length === 11) {
    const v = ints(parts.slice(1, 10), V1_LIMITS);
    if (!v || (v[6] === 0) !== (v[7] === 0)) return null;
    return {
      raw: {
        reaction: { medianMs: v[0], n: v[1] },
        aim: { meanMs: v[2], hitRate: v[3] / 100 },
        track: { pct: v[4] },
        timing: { meanErrMs: v[5] },
        color: { medianMs: v[6] === 0 ? NaN : v[6], accuracy: v[7] / 100 },
        memory: { longest: v[8] },
        meta: null,
      },
      input,
    };
  }
  return null;
}

/** The result exactly as a share link will carry it, so the page, link and card agree. */
export function quantize(raw, input) {
  return decodeResult(encodeResult(raw, input));
}

// ---- Timing game core ------------------------------------------------------------------------
/**
 * Timing rounds as a state machine (times in ms on one clock). Each round: start(t) begins a sweep,
 * press(t) or tick(t) past the timeout ends it exactly once. Input between rounds is ignored.
 */
export function createTimingRun({ trials = 5, sweep = 1400, timeoutFrac = 1.15, cap = 150 } = {}) {
  const errs = [];
  let misses = 0;
  let round = 0;
  let state = 'idle'; // idle | running | done
  let startAt = 0;
  let targetAt = 0;
  function finishRound(err, missed) {
    if (state !== 'running') return null;
    state = round + 1 >= trials ? 'done' : 'idle';
    round++;
    if (missed) misses++;
    errs.push(Math.min(cap, Math.abs(err)));
    return { err, missed, round, done: state === 'done' };
  }
  return {
    get state() { return state; },
    get round() { return round; },
    start(t, frac) {
      if (state !== 'idle') return false;
      state = 'running';
      startAt = t;
      targetAt = t + frac * sweep;
      return true;
    },
    progress(t) { return (t - startAt) / sweep; },
    press(t) { return finishRound(t - targetAt, false); },
    tick(t) { return (t - startAt) / sweep >= timeoutFrac ? finishRound(cap, true) : null; },
    result() { return { meanErrMs: mean(errs), n: round, misses }; },
  };
}
