import test from 'node:test';
import assert from 'node:assert/strict';
import {
  makeRound,
  ratioNow,
  pooled,
  scoreRound,
  nextRange,
  finalRange
} from '../src/assets/js/lib/finder.js';

const HITS = Array.from({ length: 5 }, () => ({ t: 0.4, hit: true, ratio: 1 }));

function rep(flick, track = 0, flicks = HITS) {
  return { flick, track, score: 0, flicks, shots: flicks.length, on: 0, time: 0 };
}

function cand(cm, label, flick, track, feel = 'ok') {
  return {
    cm,
    label,
    reps: [rep(flick, track)],
    feels: [feel],
    score: 0,
    feel: null,
    ep: NaN,
    res: null
  };
}

test('makeRound builds three candidates and an ABCCBA queue', () => {
  const round = makeRound(43.5, 66, (value) => value, () => 0.5);
  assert.equal(round.cands.length, 3);
  assert.equal(round.queue.map((index) => round.cands[index].label).join(''), 'ABCCBA');
});

test('makeRound snaps candidates and removes duplicates', () => {
  const round = makeRound(40, 50, (value) => Math.round(value));
  const values = round.cands.map((candidate) => candidate.cm);
  assert.equal(new Set(values).size, values.length);
  for (const value of values) assert.ok(value >= 40 && value <= 50);
});

test('ratioNow measures how far the aim travelled toward the target', () => {
  const flick = { y0: 0, p0: 0, y: 10, p: 0 };
  assert.equal(ratioNow(10, 0, flick), 1);
  assert.equal(ratioNow(5, 0, flick), 0.5);
  assert.equal(ratioNow(0, 0, flick), 0);
});

test('pooled combines both repetitions of a candidate', () => {
  const candidate = cand(50, 'A', 1, 0);
  candidate.reps[0] = {
    flick: 1,
    track: 0,
    score: 0,
    shots: 2,
    on: 1,
    time: 2,
    flicks: [{ t: 0.3, hit: true, ratio: 1 }, { t: 0.5, hit: true, ratio: 0.8 }]
  };
  const res = pooled(candidate);
  assert.equal(res.acc, 1);
  assert.equal(res.medT, 0.4);
  assert.equal(res.track, 0.5);
  assert.equal(res.ep, 0.9);
});

test('scoreRound leaves out candidates that reported body strain', () => {
  const candidates = [
    cand(50, 'A', 100, 100, 'wrist'),
    cand(55, 'B', 80, 80),
    cand(60, 'C', 40, 40)
  ];
  const result = scoreRound(candidates, 55);
  assert.equal(result.winner.label, 'B');
});

test('scoreRound picks the middle candidate when scores are tied', () => {
  const candidates = [
    { ...cand(50, 'A', 100, 0), reps: [rep(100, 0), rep(0, 0)] },
    { ...cand(60, 'B', 80, 0), reps: [rep(80, 0), rep(20, 0)] },
    { ...cand(70, 'C', 60, 0), reps: [rep(60, 0), rep(40, 0)] }
  ];
  const result = scoreRound(candidates, 60);
  assert.equal(result.tie, true);
  assert.equal(result.winner, null);
  assert.equal(result.reason, 'indistinct');
});

test('scoreRound recommends nothing when every candidate was uncomfortable', () => {
  const candidates = [cand(50, 'A', 100, 100, 'wrist'), cand(55, 'B', 80, 80, 'shoulder'), cand(60, 'C', 40, 40, 'wrist')];
  const result = scoreRound(candidates, 55);
  assert.equal(result.winner, null);
  assert.equal(result.reason, 'allExcluded');
});

test('scoreRound names no winner when all scores are zero', () => {
  const candidates = [cand(50, 'A', 0, 0), cand(55, 'B', 0, 0), cand(60, 'C', 0, 0)];
  const result = scoreRound(candidates, 55);
  assert.equal(result.winner, null);
  assert.equal(result.reason, 'insufficient');
});

test('scoreRound names no winner with too few hits', () => {
  const few = [{ t: 0.4, hit: true, ratio: 1 }];
  const candidates = [
    { ...cand(50, 'A', 100, 50), reps: [rep(100, 50, few)] },
    cand(55, 'B', 80, 40),
    cand(60, 'C', 40, 20)
  ];
  assert.equal(scoreRound(candidates, 55).reason, 'insufficient');
});

test('scoreRound treats an exact tie as indistinct even with zero noise', () => {
  const candidates = [cand(50, 'A', 80, 80), cand(55, 'B', 80, 80), cand(60, 'C', 40, 40)];
  const result = scoreRound(candidates, 55);
  assert.equal(result.winner, null);
  assert.equal(result.reason, 'indistinct');
});

test('makeRound does not offer values marked uncomfortable earlier', () => {
  const round = makeRound(50, 60, (value) => value, () => 0.5, [55.2]);
  assert.ok(round.cands.every((c) => Math.abs(c.cm - 55.2) >= 0.5));
  assert.equal(round.cands.length, 2);
});

test('nextRange stays inside the configured range', () => {
  const round = { lo: 20, hi: 80, winner: 30 };
  const range = nextRange(round, 43.5, 66);
  assert.ok(range.lo >= 43.5);
  assert.ok(range.hi <= 66);
  assert.equal(range.lo, 43.5);
  assert.equal(range.hi, 45);
});

test('finalRange stays inside the configured range', () => {
  const round = { lo: 20, hi: 80, winner: 70 };
  const range = finalRange(round, 43.5, 66);
  assert.ok(range.lo >= 43.5);
  assert.ok(range.hi <= 66);
  assert.equal(range.lo, 62.5);
  assert.equal(range.hi, 66);
});
