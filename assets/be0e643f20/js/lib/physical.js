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
// r=v1.<reaction>.<reactionN>.<aimMs>.<hit%>.<track%>.<timingMs>.<colorMs>.<colorAcc%>.<memory>.<input>
// Values are integers. Anything malformed or out of range decodes to null.

const INPUTS = ['mouse', 'touch', 'pen', 'keyboard', 'mixed'];
export const MEMORY_MAX = 12;
// colorMs 0 means "not measurable" (no correct answers) and is only valid with accuracy 0.
const LIMITS = [
  [100, 2000], [1, 50], [100, 10000], [0, 100], [0, 100], [0, 1000], [0, 10000], [0, 100], [0, MEMORY_MAX],
];

export function encodeResult(raw, input) {
  const colorMs = raw.color.accuracy > 0 ? raw.color.medianMs : 0;
  const v = [
    raw.reaction.medianMs, raw.reaction.n, raw.aim.meanMs, raw.aim.hitRate * 100, raw.track.pct,
    raw.timing.meanErrMs, colorMs, raw.color.accuracy * 100, raw.memory.longest,
  ].map((x, i) => {
    if (!Number.isFinite(x)) throw new RangeError('incomplete result');
    return Math.min(LIMITS[i][1], Math.max(LIMITS[i][0], Math.round(x)));
  });
  return [RULES_VERSION, ...v, INPUTS.includes(input) ? input : 'mixed'].join('.');
}

export function decodeResult(str) {
  if (typeof str !== 'string' || str.length > 120) return null;
  const parts = str.split('.');
  if (parts.length !== 11 || parts[0] !== RULES_VERSION || !INPUTS.includes(parts[10])) return null;
  const v = parts.slice(1, 10).map((p) => (/^\d{1,5}$/.test(p) ? Number(p) : NaN));
  if (v.some((x, i) => !Number.isInteger(x) || x < LIMITS[i][0] || x > LIMITS[i][1])) return null;
  if ((v[6] === 0) !== (v[7] === 0)) return null;
  return {
    raw: {
      reaction: { medianMs: v[0], n: v[1] },
      aim: { meanMs: v[2], hitRate: v[3] / 100 },
      track: { pct: v[4] },
      timing: { meanErrMs: v[5] },
      color: { medianMs: v[6] === 0 ? NaN : v[6], accuracy: v[7] / 100 },
      memory: { longest: v[8] },
    },
    input: parts[10],
  };
}
