// Testable core of one sensitivity-finder trial (flicks, then tracking) on one timeline.
// The page wires pointer-lock mouse events, drawing and overlays to these functions.
//
// Aim: every mouse move advances the timeline to its timestamp first, then applies the movement.
// Between move events the aim is the last observed position (the mouse did not report movement),
// so no aim is interpolated or invented between frames.
import { createClock } from './session.js';
import { ratioNow, FLICK_TIMEOUT } from './finder.js';
import { makeTrack, stepTrack, angDist } from './track.js';
import { median } from './stats.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
/** A flick's first movement ends when no movement above STILL_SPEED (deg/s) arrives for STILL_SEC. */
const MOVE_SPEED = 40;
const STILL_SPEED = 8;
const STILL_SEC = 0.04;

export function createFindRun({ session, spec, perCount, rng = Math.random, onDone = () => {} }) {
  const run = {
    yaw: 0,
    pitch: 0,
    stage: null,
    tr: { spec, shots: 0, flicks: [], n: 0, f: null, trk: null },
    resumed: false,
    lastMoveAt: 0, // session elapsed of the last movement above STILL_SPEED
    prevMoveAt: 0 // session elapsed of the previous move event (any size): speed uses event spacing only
  };

  function spawnFlick() {
    const distance = 10 + rng() * 52;
    const angle = rng() * Math.PI * 2;
    run.tr.f = {
      y0: run.yaw,
      p0: run.pitch,
      y: run.yaw + distance * Math.cos(angle),
      p: clamp(run.pitch + distance * Math.sin(angle) * 0.55, -24, 24),
      r: 1.4,
      tt: 0,
      moving: false,
      primary: null
    };
    run.prevMoveAt = session.elapsed;
  }

  function startTrack() {
    run.stage = 'track';
    run.tr.f = null;
    run.tr.trk = makeTrack(run.yaw, run.pitch, rng);
    // The trial ends exactly when the measured tracking time reaches its length.
    session.limit = session.elapsed + run.tr.trk.grace + spec.track;
  }

  function nextFlick() {
    run.tr.n += 1;
    if (run.tr.n >= spec.flicks) startTrack();
    else spawnFlick();
  }

  function update(step) {
    if (run.stage === 'flick' && run.tr.f) {
      const f = run.tr.f;
      f.tt += step;
      if (f.primary === null && f.moving && session.elapsed - run.lastMoveAt >= STILL_SEC) {
        f.primary = ratioNow(run.yaw, run.pitch, f);
      }
      if (f.tt >= FLICK_TIMEOUT) {
        run.tr.flicks.push({ t: FLICK_TIMEOUT, hit: false, ratio: f.primary ?? NaN });
        nextFlick();
      }
    } else if (run.stage === 'track' && run.tr.trk) {
      stepTrack(run.tr.trk, step, run.yaw, run.pitch);
    }
  }

  run.clock = createClock(session, update);

  /** Call from the Session onChange callback. */
  run.onState = (state, prev) => {
    if (state === 'countdown') {
      if (prev === 'paused') run.resumed = true;
      run.clock.reset(null);
    } else if (state === 'running' && prev === 'countdown') {
      if (!run.stage) {
        if (spec.flicks > 0) {
          run.stage = 'flick';
          spawnFlick();
        } else {
          startTrack();
        }
      } else if (run.resumed && run.stage === 'flick') {
        spawnFlick(); // the target stayed visible while paused: discard it
      }
      run.resumed = false;
    } else if (state === 'done' && run.stage === 'track') {
      run.stage = 'done';
      onDone(run.result());
    }
  };

  run.frame = (ts) => run.clock.advanceTo(ts);

  /** Mouse movement in counts at timestamp ts. */
  run.move = (ts, dx, dy) => {
    run.clock.advanceTo(ts);
    if (session.state !== 'running' && session.state !== 'countdown') return;
    const dYaw = dx * perCount;
    const dPitch = -dy * perCount;
    run.yaw += dYaw;
    run.pitch = clamp(run.pitch + dPitch, -70, 70);
    if (session.state !== 'running') return;
    // Speed is measured between move events (or since the target appeared), never since the last
    // frame or press, so adding frames cannot change it.
    const dt = Math.max(1e-3, session.elapsed - run.prevMoveAt);
    run.prevMoveAt = session.elapsed;
    const speed = Math.hypot(dYaw, dPitch) / dt;
    if (speed > STILL_SPEED) run.lastMoveAt = session.elapsed;
    if (speed > MOVE_SPEED && run.stage === 'flick' && run.tr.f) run.tr.f.moving = true;
  };

  /** Left press at timestamp ts. Returns 'hit', 'miss' or null (ignored). */
  run.down = (ts, button) => {
    run.clock.advanceTo(ts);
    if (button !== 0 || session.state !== 'running' || run.stage !== 'flick' || !run.tr.f) return null;
    const f = run.tr.f;
    run.tr.shots += 1;
    if (angDist(run.yaw, run.pitch, f.y, f.p) <= f.r) {
      run.tr.flicks.push({ t: f.tt, hit: true, ratio: f.primary ?? ratioNow(run.yaw, run.pitch, f) });
      nextFlick();
      return 'hit';
    }
    return 'miss';
  };

  run.result = () => {
    const tr = run.tr;
    const track = tr.trk || { on: 0, time: 0 };
    const hits = tr.flicks.filter((f) => f.hit);
    const accuracy = hits.length / Math.max(1, tr.shots + tr.flicks.length - hits.length);
    const medT = hits.length ? median(hits.map((f) => f.t)) : FLICK_TIMEOUT;
    return {
      flicks: tr.flicks,
      shots: tr.shots,
      on: track.on,
      time: track.time,
      flick: accuracy / medT,
      track: track.on / Math.max(1e-6, track.time),
      score: 0
    };
  };

  return run;
}
