import { median } from './stats.js';

export const FLICK_TIMEOUT = 4;
/** Minimum hits per candidate (over both repeats) before a round can name a winner. */
export const MIN_HITS = 5;

function shuffle(list, rng) {
  for (let i = list.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

/** Candidates closer than this (cm) to a value the player marked uncomfortable are not offered again. */
export const EXCLUDE_NEAR_CM = 0.5;

export function makeRound(lo, hi, snapFn, rng = Math.random, excluded = []) {
  // Keep the original target next to the settable value; drop values that cannot be set (NaN),
  // duplicates, and values near ones the player marked uncomfortable.
  const seen = new Set();
  const values = [lo, (lo + hi) / 2, hi]
    .map((target) => ({ target, cm: +(+snapFn(target)).toFixed(3) }))
    .filter(({ cm }) => Number.isFinite(cm) && !seen.has(cm) && seen.add(cm))
    .filter(({ cm }) => !excluded.some((x) => Math.abs(x - cm) < EXCLUDE_NEAR_CM));
  const cands = shuffle(values, rng).map(({ target, cm }, index) => ({
    cm,
    target,
    label: 'ABC'[index],
    reps: [],
    feels: [],
    score: 0,
    feel: null,
    ep: NaN,
    res: null
  }));
  const order = cands.map((_, index) => index);
  return {
    lo,
    hi,
    cands,
    queue: [...order, ...order.slice().reverse()],
    winner: null,
    tie: false,
    noise: 0
  };
}

export function ratioNow(yaw, pitch, flick) {
  const vx = flick.y - flick.y0;
  const vy = flick.p - flick.p0;
  const length2 = vx * vx + vy * vy || 1;
  return ((yaw - flick.y0) * vx + (pitch - flick.p0) * vy) / length2;
}

export function pooled(cand) {
  const flicks = cand.reps.flatMap((rep) => rep.flicks);
  const hits = flicks.filter((flick) => flick.hit);
  const shots = cand.reps.reduce((sum, rep) => sum + (rep.shots || 0), 0) + flicks.filter((flick) => !flick.hit).length;
  const on = cand.reps.reduce((sum, rep) => sum + (rep.on || 0), 0);
  const time = cand.reps.reduce((sum, rep) => sum + (rep.time || 0), 0);
  return {
    acc: hits.length / Math.max(1, shots),
    medT: hits.length ? median(hits.map((flick) => flick.t)) : FLICK_TIMEOUT,
    track: on / Math.max(1e-6, time),
    ep: median(flicks.map((flick) => flick.ratio).filter((ratio) => Number.isFinite(ratio)))
  };
}

export function scoreRound(cands, mid) {
  const reps = cands.flatMap((cand) => cand.reps);
  const flickMax = Math.max(...reps.map((rep) => rep.flick), 1e-9);
  const trackMax = Math.max(...reps.map((rep) => rep.track), 1e-9);

  reps.forEach((rep) => {
    rep.score = (50 * rep.flick) / flickMax + (50 * rep.track) / trackMax;
  });

  cands.forEach((cand) => {
    cand.score = cand.reps.length
      ? cand.reps.reduce((sum, rep) => sum + rep.score, 0) / cand.reps.length
      : 0;
    cand.res = pooled(cand);
    cand.ep = cand.res.ep;
    cand.feel = cand.feels.find((feel) => feel !== 'ok') || 'ok';
  });

  const noise = cands.reduce(
    (sum, cand) => sum + (cand.reps.length > 1 ? Math.abs(cand.reps[0].score - cand.reps[1].score) : 0),
    0
  ) / Math.max(1, cands.length) / 2;

  // No measured winner when: every candidate was marked uncomfortable, there is too little data,
  // or the best candidate is not ahead of the others by more than the repeat-to-repeat noise.
  const comfortable = cands.filter((cand) => cand.feel === 'ok');
  if (!comfortable.length) return { noise, tie: false, close: [], winner: null, reason: 'allExcluded' };
  const hitsOf = (cand) => cand.reps.reduce((sum, rep) => sum + rep.flicks.filter((f) => f.hit).length, 0);
  if (flickMax <= 1e-9 && trackMax <= 1e-9) return { noise, tie: false, close: [], winner: null, reason: 'insufficient' };
  if (comfortable.some((cand) => hitsOf(cand) < MIN_HITS)) return { noise, tie: false, close: [], winner: null, reason: 'insufficient' };
  const pool = comfortable.slice().sort((a, b) => b.score - a.score);
  const best = pool[0];
  const close = pool.filter((cand) => best.score - cand.score <= noise);
  if (close.length > 1) return { noise, tie: true, close, winner: null, reason: 'indistinct' };
  return { noise, tie: false, close, winner: best, reason: null };
}

/** Narrower range around the winner, or null when there is no valid range (no winner or lo > hi). */
export function nextRange(round, minC, maxC) {
  if (!Number.isFinite(round.winner)) return null;
  const half = (round.hi - round.lo) / 4;
  const lo = Math.max(minC, round.winner - half);
  const hi = Math.min(maxC, round.winner + half);
  return lo <= hi ? { lo, hi } : null;
}

export function finalRange(round, minC, maxC) {
  if (!Number.isFinite(round.winner)) return null;
  const half = (round.hi - round.lo) / 4;
  const lo = Math.max(minC, round.winner - half / 2);
  const hi = Math.min(maxC, round.winner + half / 2);
  return lo <= hi ? { lo, hi } : null;
}
