// Testable core of the click-accuracy page: target, timing and judging on one timeline.
// The page only wires DOM events and drawing to these functions.
import { spawnTarget, stepTarget, isHit } from './click.js';
import { createClock } from './session.js';

export function createClickRun({ session, cfg, arena, rng = Math.random }) {
  const run = { target: null, spawnAt: 0, spawnDist: 0, cursor: null, events: [], hits: 0, misses: 0, resumed: false };

  function spawn() {
    const a = arena();
    run.target = spawnTarget(run.target, a, cfg.size, rng, cfg.speed);
    run.spawnAt = session.elapsed;
    const c = run.cursor || { x: a.w / 2, y: a.h / 2 };
    run.spawnDist = Math.hypot(c.x - run.target.x, c.y - run.target.y);
  }

  run.clock = createClock(session, (step) => {
    if (run.target) run.target = stepTarget(run.target, step, arena());
    if (session.elapsed >= cfg.duration) session.finish();
  });

  /** Call from the Session onChange callback. */
  run.onState = (state, prev) => {
    if (state === 'countdown') {
      if (prev === 'paused') run.resumed = true;
      run.clock.reset(null); // the next timestamp becomes the new base
    } else if (state === 'running' && prev === 'countdown') {
      session.limit = cfg.duration; // the run ends exactly at its duration
      // A target that stayed visible during a pause is discarded; a fresh sample starts.
      if (!run.target || run.resumed) spawn();
      run.resumed = false;
    }
  };

  run.frame = (ts) => run.clock.advanceTo(ts);
  run.move = (x, y) => { run.cursor = { x, y }; };

  /** Judge a press at timestamp `ts` after advancing to it. Returns 'hit', 'miss' or null (ignored). */
  run.down = (ts, button, x, y) => {
    run.clock.advanceTo(ts);
    if (button !== 0 || session.state !== 'running' || !run.target) return null;
    run.cursor = { x, y };
    const t = Math.max(0, session.elapsed - run.spawnAt);
    const hit = isHit(run.target, x, y);
    run.events.push({ type: hit ? 'hit' : 'miss', t, dist: run.spawnDist });
    if (hit) {
      run.hits += 1;
      spawn();
    } else {
      run.misses += 1;
    }
    return hit ? 'hit' : 'miss';
  };

  return run;
}
