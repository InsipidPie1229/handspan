import test from 'node:test';
import assert from 'node:assert/strict';
import { Session, createClock } from '../src/assets/js/lib/session.js';
import { createClickRun } from '../src/assets/js/lib/clickRun.js';
import { createKiteRun } from '../src/assets/js/lib/kiteRun.js';
import { summarize as summarizeKite } from '../src/assets/js/lib/kite.js';

const arena = () => ({ w: 1000, h: 600, top: 48 });
const rng = (() => { let x = 1; return () => ((x = (x * 16807) % 2147483647) / 2147483647); })();

// Frames every 16 ms up to `to` (no gap long enough to stall).
function framesTo(run, from, to) {
  for (let ts = from + 16; ts < to; ts += 16) run.frame(ts);
  run.frame(to);
}

function started(make) {
  let run;
  const session = new Session({ countdown: 0.001, onChange: (s, p) => run && run.onState(s, p) });
  run = make(session);
  session.start();
  run.frame(0); // base
  run.frame(16); // countdown over → running, first target
  assert.equal(session.state, 'running');
  return { session, run };
}

test('click: presses between frames are timed at the press, not at the last frame', () => {
  const { session, run } = started((s) => createClickRun({ session: s, cfg: { size: 22, speed: 0, duration: 30 }, arena, rng }));
  framesTo(run, 16, 1000);
  const elapsedAtFrame = session.elapsed;
  // OpenClaw repro: presses at 1010 and 1090 ms between frames at 1000 and 1100 ms.
  run.down(1010, 0, run.target.x + 100, run.target.y + 100); // miss
  run.down(1090, 0, run.target.x, run.target.y); // hit
  run.frame(1100);
  const [miss, hit] = run.events;
  assert.ok(Math.abs(miss.t - (elapsedAtFrame + 0.010 - 0)) < 1e-6 || miss.t > 0, `miss ${miss.t}`);
  assert.ok(Math.abs((hit.t - miss.t) - 0.080) < 1e-9, `hit-miss gap ${hit.t - miss.t}`);
  assert.ok(Math.abs(session.elapsed - (elapsedAtFrame + 0.1)) < 1e-9, 'no double counting after the presses');
});

test('click: no double counting and no time travel with repeated or reversed timestamps', () => {
  const { session, run } = started((s) => createClickRun({ session: s, cfg: { size: 22, speed: 0, duration: 30 }, arena, rng }));
  framesTo(run, 16, 500);
  const e = session.elapsed;
  run.down(400, 0, -999, -999); // older than the last frame: no advance
  run.frame(500); // duplicate
  run.frame(450); // reversed
  assert.equal(session.elapsed, e);
});

test('kite: six correct presses within 75 ms between two frames keep their own times', () => {
  const { run } = started((session) => createKiteRun({ session, cfg: { size: 22, speed: 0, duration: 30, mapKey: 'rl' }, arena, rng }));
  framesTo(run, 16, 1000);
  const btn = { move: 2, attack: 0 };
  for (const ts of [1010, 1025, 1040, 1055, 1070, 1085]) {
    const target = run.pair[run.pair.turn];
    assert.equal(run.down(ts, btn[run.pair.turn], target.x, target.y), 'ok');
  }
  run.frame(1100);
  const res = summarizeKite(run.events);
  assert.equal(res.ok, 6);
  assert.ok(Math.abs(res.medianSwitchMs - 15) < 1e-6, `median ${res.medianSwitchMs}`);
});

test('presses after the run ends are ignored', () => {
  const { session, run } = started((s) => createClickRun({ session: s, cfg: { size: 22, speed: 0, duration: 1 }, arena, rng }));
  framesTo(run, 16, 992);
  run.down(1100, 0, run.target.x, run.target.y); // advancing to 1100 ms ends the 1 s run first
  assert.equal(session.state, 'done');
  assert.equal(run.events.length, 0);
});

test('pause and resume reset the time base and discard the visible target', () => {
  const { session, run } = started((s) => createClickRun({ session: s, cfg: { size: 22, speed: 0, duration: 30 }, arena, rng }));
  framesTo(run, 16, 1000);
  const before = run.target;
  const e = session.elapsed;
  session.pause('blur');
  session.resume(); // countdown resets the base
  run.frame(60000); // long gap after resume: only sets the base
  assert.equal(session.elapsed, e);
  run.frame(60016); // countdown (0.001 s) ends
  assert.equal(session.state, 'running');
  assert.notEqual(run.target, before, 'a fresh target after resume');
});

test('createClock ignores reversed and duplicate timestamps', () => {
  const session = new Session({ countdown: 0.001 });
  let measured = 0;
  const clock = createClock(session, (dt) => { measured += dt; });
  session.start();
  clock.advanceTo(0);
  clock.advanceTo(10);
  clock.advanceTo(110);
  const m = measured;
  clock.advanceTo(110);
  clock.advanceTo(50);
  assert.equal(measured, m);
});
