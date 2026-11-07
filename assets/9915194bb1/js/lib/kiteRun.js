// Testable core of the move/attack page: targets, timing and judging on one timeline.
import { spawnPair, stepPair, judge, MAPPINGS } from './kite.js';
import { createClock } from './session.js';

export function createKiteRun({ session, cfg, arena, rng = Math.random }) {
  const run = { pair: null, events: [], oks: 0, orders: 0, resumed: false };
  const mapping = MAPPINGS[cfg.mapKey] || MAPPINGS.rl;

  run.clock = createClock(session, (step) => {
    if (run.pair) run.pair = stepPair(run.pair, step, arena());
    if (session.elapsed >= cfg.duration) session.finish();
  });

  /** Call from the Session onChange callback. */
  run.onState = (state, prev) => {
    if (state === 'countdown') {
      if (prev === 'paused') run.resumed = true;
      run.clock.reset(null);
    } else if (state === 'running' && prev === 'countdown') {
      session.limit = cfg.duration; // the run ends exactly at its duration
      if (run.resumed) {
        // Targets stayed visible while paused: replace them and do not count a switch across the pause.
        run.pair = spawnPair(arena(), cfg.size, cfg.speed, rng);
        run.events.push({ type: 'break', at: session.elapsed });
      } else if (!run.pair) {
        run.pair = spawnPair(arena(), cfg.size, cfg.speed, rng);
      }
      run.resumed = false;
    }
  };

  run.frame = (ts) => run.clock.advanceTo(ts);

  /** Judge a press at timestamp `ts` after advancing to it. Returns the judge kind or null (ignored). */
  run.down = (ts, button, x, y) => {
    if (button !== 0 && button !== 2) return null;
    run.clock.advanceTo(ts);
    if (session.state !== 'running' || !run.pair) return null;
    if (mapping.move === mapping.attack && button !== mapping.move) return null;
    const result = judge(run.pair, button, x, y, mapping, { arena: arena(), size: cfg.size, speed: cfg.speed, rng });
    run.events.push({ type: result.kind, at: session.elapsed });
    run.pair = result.next;
    if (result.kind === 'ok') run.oks += 1;
    if (result.kind === 'order') run.orders += 1;
    return result.kind;
  };

  return run;
}
