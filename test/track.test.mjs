import test from 'node:test';
import assert from 'node:assert/strict';
import { makeTrack, stepTrack, trackAt } from '../src/assets/js/lib/track.js';
import { Session, createClock } from '../src/assets/js/lib/session.js';

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

test('the target path depends only on time, not on step size', () => {
  const a = makeTrack(0, 0, seeded(3));
  const b = makeTrack(0, 0, seeded(3));
  for (let i = 0; i < 1000; i += 1) stepTrack(a, 0.001, 0, 0);
  for (let i = 0; i < 50; i += 1) stepTrack(b, 0.02, 0, 0);
  assert.ok(Math.abs(a.y - b.y) < 1e-4);
  assert.ok(Math.abs(trackAt(a, 1).y - a.y) < 1e-4);
});

// Fixed target path + a timestamped input recording, replayed through the real connection:
// the shared clock, with input events and frames interleaved by time.
function recordInput(seconds) {
  const ref = makeTrack(0, 0, seeded(7));
  const events = []; // { ts (ms), yaw }
  for (let ms = 0; ms <= seconds * 1000; ms += 1) {
    const lagged = trackAt(ref, Math.max(0, ms - 20) / 1000).y; // follows with a 20 ms lag
    events.push({ ts: ms, yaw: lagged + 0.3 * Math.sin(ms / 200) });
  }
  return events;
}

function replay(events, fps, seconds) {
  const session = new Session({ countdown: 0.000001 });
  const trk = makeTrack(0, 0, seeded(7));
  let aim = 0;
  let frameAim0 = 0;
  const clock = createClock(session, (dt, frac) => stepTrack(trk, dt, frameAim0 + (aim - frameAim0) * frac, 0));
  session.start();
  clock.advanceTo(-1);
  clock.advanceTo(-0.5); // countdown done
  frameAim0 = aim;
  let e = 0;
  const frameMs = 1000 / fps;
  for (let f = 1; f * frameMs <= seconds * 1000; f += 1) {
    const ts = f * frameMs;
    while (e < events.length && events[e].ts <= ts) aim = events[e++].yaw; // mouse events between frames
    clock.advanceTo(ts);
    frameAim0 = aim;
  }
  return trk.on / trk.time;
}

test('the same timestamped input scores within 5 points at 10, 30 and 60 fps (temporary tolerance)', () => {
  const events = recordInput(20);
  const s = Object.fromEntries([10, 30, 60].map((fps) => [fps, replay(events, fps, 20)]));
  assert.ok(s[60] > 0.3, `reference tracking ratio should be meaningful, got ${s[60].toFixed(3)}`);
  console.log(`tracking ratio  10fps ${s[10].toFixed(3)}  30fps ${s[30].toFixed(3)}  60fps ${s[60].toFixed(3)}`);
  for (const fps of [10, 30]) assert.ok(Math.abs(s[fps] - s[60]) < 0.05, `fps ${fps}: ${s[fps].toFixed(3)} vs 60: ${s[60].toFixed(3)}`);
});
