import test from 'node:test';
import assert from 'node:assert/strict';
import { Session, runFrame } from '../src/assets/js/lib/session.js';

test('start moves from idle to countdown, then running after three seconds', () => {
  const states = [];
  const session = new Session({ onChange: (state, prev) => states.push([state, prev]) });
  assert.equal(session.state, 'idle');
  session.start();
  assert.equal(session.state, 'countdown');
  session.tick(2.9);
  assert.equal(session.state, 'countdown');
  assert.equal(session.elapsed, 0);
  session.tick(0.2);
  assert.equal(session.state, 'running');
  assert.deepEqual(states, [['countdown', 'idle'], ['running', 'countdown']]);
});

test('tick only accumulates elapsed time while running', () => {
  const session = new Session();
  session.start();
  session.tick(3);
  session.tick(2);
  assert.equal(session.elapsed, 2);
  session.pause('esc');
  assert.equal(session.state, 'paused');
  session.tick(10);
  assert.equal(session.elapsed, 2);
});

test('resume waits for a fresh three-second countdown', () => {
  const session = new Session();
  session.start();
  session.tick(3);
  session.tick(1.5);
  session.pause('esc');
  session.resume();
  assert.equal(session.state, 'countdown');
  session.tick(2.9);
  assert.equal(session.state, 'countdown');
  assert.equal(session.elapsed, 1.5);
  session.tick(0.2);
  assert.equal(session.state, 'running');
  session.tick(0.5);
  assert.equal(session.elapsed, 2);
});

test('pause passes the reason to onChange', () => {
  const reasons = [];
  const session = new Session({ onChange: (state, prev, reason) => reasons.push(reason) });
  session.start();
  session.tick(3);
  session.pause('hidden');
  assert.deepEqual(reasons, ['start', 'countdown', 'hidden']);
});

test('finish moves to done and later pauses are ignored', () => {
  const session = new Session();
  session.start();
  session.tick(3);
  session.finish();
  assert.equal(session.state, 'done');
  session.pause('esc');
  assert.equal(session.state, 'done');
  session.resume();
  assert.equal(session.state, 'done');
  session.tick(5);
  assert.equal(session.elapsed, 0);
});

test('start can restart a finished session', () => {
  const session = new Session();
  session.start();
  session.tick(3);
  session.finish();
  session.start();
  assert.equal(session.state, 'countdown');
  assert.equal(session.elapsed, 0);
});

test('runFrame never calls update during countdown or pause (resume path)', () => {
  const session = new Session();
  let measured = 0;
  const update = (dt) => { measured += dt; };
  const until = (state) => { let n = 0; while (session.state !== state && n < 1000) { runFrame(session, 0.05, update); n += 1; } };
  session.start();
  until('running');
  assert.equal(measured, 0, 'countdown must not be measured');
  for (let i = 0; i < 100; i += 1) runFrame(session, 0.05, update); // 5 s measured
  session.pause('blur');
  for (let i = 0; i < 40; i += 1) runFrame(session, 0.05, update);
  session.resume();
  until('running');
  assert.ok(Math.abs(measured - 5) < 1e-9, `measured ${measured}`);
});

test('runFrame stall boundary: 0.24 s and exactly 0.25 s are measured, 0.26 s pauses (temporary threshold)', () => {
  for (const [gap, expectState] of [[0.24, 'running'], [0.25, 'running'], [0.26, 'paused']]) {
    const session = new Session();
    let measured = 0;
    session.start();
    while (session.state !== 'running') runFrame(session, 0.05, () => {});
    const before = session.elapsed;
    const out = runFrame(session, gap, (dt) => { measured += dt; });
    assert.equal(session.state, expectState, `gap ${gap}`);
    if (expectState === 'paused') {
      assert.equal(out, 'stall');
      assert.equal(measured, 0);
      assert.equal(session.elapsed, before, 'a stalled gap is not counted');
      assert.equal(session.reason, 'stall');
    } else {
      assert.ok(Math.abs(measured - gap) < 1e-9);
    }
  }
});

test('runFrame keeps real time at 10, 30 and 60 fps (no per-frame clamp)', () => {
  for (const fps of [10, 30, 60]) {
    const session = new Session();
    session.start();
    while (session.state !== 'running') runFrame(session, 1 / fps, () => {});
    let measured = 0;
    let steps = 0;
    for (let i = 0; i < 30 * fps; i += 1) runFrame(session, 1 / fps, (dt) => { measured += dt; steps += 1; });
    assert.ok(Math.abs(session.elapsed - 30) < 1e-6, `${fps} fps elapsed ${session.elapsed}`);
    assert.ok(Math.abs(measured - 30) < 1e-6, `${fps} fps measured ${measured}`);
    assert.ok(steps >= 30 / 0.02 - 1, 'sub-steps are at most 0.02 s');
  }
});
