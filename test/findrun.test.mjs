import test from 'node:test';
import assert from 'node:assert/strict';
import { Session } from '../src/assets/js/lib/session.js';
import { createFindRun } from '../src/assets/js/lib/findRun.js';
import { createClickRun } from '../src/assets/js/lib/clickRun.js';
import { makeTrack, trackAt } from '../src/assets/js/lib/track.js';

function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function startFind(spec, perCount, rng) {
  let run;
  let result = null;
  const session = new Session({ countdown: 0.000001, onChange: (s, p) => run && run.onState(s, p) });
  run = createFindRun({ session, spec, perCount, rng, onDone: (r) => { result = r; } });
  session.start();
  run.frame(0);
  run.frame(1); // running at ts 1 ms
  return { session, run, get result() { return result; } };
}

test('end boundary: clock and simulation stop together at the limit (OpenClaw repro)', () => {
  let run;
  const session = new Session({ countdown: 0.000001, onChange: (s, p) => run && run.onState(s, p) });
  run = createClickRun({ session, cfg: { size: 22, speed: 100, duration: 1 }, arena: () => ({ w: 4000, h: 4000, top: 0 }), rng: seeded(1) });
  session.start();
  run.frame(0);
  run.frame(1);
  for (let ts = 17; ts <= 951; ts += 16) run.frame(ts); // elapsed ≈ 0.95 s
  const e0 = session.elapsed;
  const p0 = { x: run.target.x, y: run.target.y };
  run.frame(951 + 100); // 100 ms more, but only (1 - e0) s remain
  assert.equal(session.state, 'done');
  assert.ok(Math.abs(session.elapsed - 1) < 1e-9, `elapsed ${session.elapsed}`);
  const moved = Math.hypot(run.target.x - p0.x, run.target.y - p0.y);
  assert.ok(Math.abs(moved - 100 * (1 - e0)) < 1e-6, `moved ${moved}, expected ${100 * (1 - e0)}`);
});

test('find: a press between frames is timed at the press', () => {
  const f = startFind({ flicks: 3, track: 5 }, 0.01, seeded(2));
  for (let ts = 17; ts <= 1001; ts += 16) f.run.frame(ts);
  const flick = f.run.tr.f;
  const before = flick.tt;
  // Aim exactly at the target with one move event, then press 30 ms later, before the next frame.
  f.run.move(1010, (flick.y - f.run.yaw) / 0.01, -(flick.p - f.run.pitch) / 0.01);
  f.run.down(1040, 0);
  assert.equal(f.run.tr.flicks.length, 1);
  assert.ok(f.run.tr.flicks[0].hit);
  // spawned at 1 ms (running start), pressed at 1040 ms; last frame was at 993 ms
  assert.ok(before < 1, `tt at the last frame ${before}`);
  assert.ok(Math.abs(f.run.tr.flicks[0].t - 1.039) < 1e-9, `t ${f.run.tr.flicks[0].t}`);
});

// Fixed target path + timestamped mouse-move recording, replayed through the find run core
// (frames, moves and the clock interleaved by time) at different frame rates.
function recordMoves(seconds, perCount) {
  const ref = makeTrack(0, 0, seeded(7));
  const moves = []; // { ts (ms), dx (counts) }
  let yaw = 0;
  for (let ms = 2; ms <= seconds * 1000; ms += 1) {
    const want = trackAt(ref, Math.max(0, ms - 1 - 20) / 1000).y + 0.3 * Math.sin(ms / 200);
    const dx = Math.round((want - yaw) / perCount);
    if (dx !== 0) {
      moves.push({ ts: ms, dx });
      yaw += dx * perCount;
    }
  }
  return moves;
}

function replayFind(moves, fps, seconds, perCount) {
  const f = startFind({ flicks: 0, track: seconds - 2 }, perCount, seeded(7));
  const frameMs = 1000 / fps;
  let m = 0;
  for (let k = 1; k * frameMs <= seconds * 1000; k += 1) {
    const ts = 1 + k * frameMs;
    while (m < moves.length && moves[m].ts <= ts) {
      f.run.move(moves[m].ts, moves[m].dx, 0);
      m += 1;
    }
    f.run.frame(ts);
  }
  return f.result || f.run.result();
}

test('find: the same move recording gives the same tracking at 10, 30 and 60 fps', () => {
  const perCount = 0.005;
  const moves = recordMoves(20, perCount);
  const r = Object.fromEntries([10, 30, 60].map((fps) => [fps, replayFind(moves, fps, 20, perCount)]));
  console.log(`find tracking ratio  10fps ${r[10].track.toFixed(4)}  30fps ${r[30].track.toFixed(4)}  60fps ${r[60].track.toFixed(4)}  (time ${r[60].time.toFixed(3)} s)`);
  assert.ok(r[60].track > 0.3);
  for (const fps of [10, 30]) assert.ok(Math.abs(r[fps].track - r[60].track) < 0.05, `fps ${fps}`);
  for (const fps of [10, 30, 60]) assert.ok(Math.abs(r[fps].time - 18) < 1e-6, `measured time at ${fps} fps: ${r[fps].time}`);
});

test('find: inserting frames does not change moving, primary or the flick score (OpenClaw repro)', () => {
  const play = (extraFrames) => {
    const f = startFind({ flicks: 1, track: 1 }, 0.01, seeded(5));
    const flick = f.run.tr.f;
    const toTargetX = (flick.y - flick.y0) / 0.01;
    const toTargetY = -(flick.p - flick.p0) / 0.01;
    // 0.2° at 21 ms (the repro), then the rest of the way at 60 ms, still, press at 140 ms.
    const steps = [[21, 20, 0], [60, toTargetX - 20, toTargetY]];
    const frames = extraFrames ? [20, 40, 50, 80, 100, 120] : [];
    const timeline = [...steps.map((s) => ({ ts: s[0], kind: 'move', s })), ...frames.map((ts) => ({ ts, kind: 'frame' })), { ts: 140, kind: 'down' }]
      .sort((a, b) => a.ts - b.ts);
    const seen = [];
    for (const e of timeline) {
      if (e.kind === 'move') {
        f.run.move(e.ts, e.s[1], e.s[2]);
        seen.push(f.run.tr.f ? f.run.tr.f.moving : null);
      } else if (e.kind === 'frame') f.run.frame(e.ts);
      else f.run.down(e.ts, 0);
    }
    return { seen, flick: f.run.tr.flicks[0] };
  };
  const a = play(false);
  const b = play(true);
  assert.deepEqual(a.seen, b.seen);
  assert.equal(a.seen[0], false, '0.2° in 20 ms is 10°/s: not a flick movement');
  assert.equal(a.flick.hit, true);
  assert.equal(a.flick.t, b.flick.t);
  assert.equal(a.flick.ratio, b.flick.ratio);
});
