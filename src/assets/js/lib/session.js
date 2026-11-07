const COUNTDOWN_SECONDS = 3;

export class Session {
  constructor({ onChange = null, countdown = COUNTDOWN_SECONDS } = {}) {
    this.state = 'idle';
    this.reason = null;
    this.elapsed = 0;
    this.countdownLeft = 0;
    this.countdownSeconds = countdown;
    this.onChange = onChange;
    /** Optional end of the measured run, in elapsed seconds. runFrame never advances past it. */
    this.limit = Infinity;
  }

  remaining() {
    return this.limit - this.elapsed;
  }

  setState(state, reason) {
    const prev = this.state;
    if (prev === state) return;
    this.state = state;
    if (this.onChange) this.onChange(state, prev, reason ?? null);
  }

  start() {
    if (this.state !== 'idle' && this.state !== 'done') return;
    this.elapsed = 0;
    this.reason = null;
    this.limit = Infinity;
    this.beginCountdown('start');
  }

  beginCountdown(reason) {
    this.countdownLeft = this.countdownSeconds;
    this.setState('countdown', reason);
  }

  pause(reason) {
    if (this.state !== 'countdown' && this.state !== 'running') return;
    this.reason = reason ?? null;
    this.setState('paused', this.reason);
  }

  resume() {
    if (this.state !== 'paused') return;
    this.reason = null;
    this.beginCountdown('resume');
  }

  finish() {
    if (this.state === 'done') return;
    this.setState('done', 'finish');
  }

  /** True only while measurements may advance (not during countdown or pause). */
  get measuring() {
    return this.state === 'running';
  }

  tick(dt) {
    if (!Number.isFinite(dt) || dt <= 0) return;
    if (this.state === 'countdown') {
      this.countdownLeft -= dt;
      if (this.countdownLeft <= 0) {
        this.countdownLeft = 0;
        this.setState('running', 'countdown');
      }
      return;
    }
    if (this.state === 'running') this.elapsed += dt;
  }
}

/** Frames longer than this (s) are treated as unobserved. Temporary operational threshold. */
export const STALL_SEC = 0.25;
/** Largest simulation sub-step (s). */
export const MAX_STEP = 0.02;

/**
 * One animation frame with the real elapsed time `dt` (not clamped).
 * - A frame that started in `running` and is longer than STALL_SEC pauses the session with
 *   reason 'stall' and measures nothing (the gap is not counted anywhere).
 * - Otherwise the session clock advances by `dt` and, if the frame started in `running`,
 *   `update(step, frac)` runs in sub-steps of at most MAX_STEP; `frac` (0..1] is the position of
 *   the sub-step end within the frame, for interpolating the aim.
 * - Countdown and pause never reach `update`.
 * Returns 'stall', 'measured' or 'idle'.
 */
export function runFrame(session, dt, update, { stallSec = STALL_SEC, maxStep = MAX_STEP } = {}) {
  if (!Number.isFinite(dt) || dt <= 0) return 'idle';
  const wasRunning = session.measuring;
  if (wasRunning && dt > stallSec) {
    session.pause('stall');
    return 'stall';
  }
  if (!wasRunning) {
    session.tick(dt); // countdown / pause / idle: nothing is measured
    return 'idle';
  }
  // The clock and the simulation advance together, sub-step by sub-step, and stop exactly at the
  // session limit (time past the end is neither counted nor simulated).
  const n = Math.max(1, Math.ceil(dt / maxStep - 1e-9));
  for (let i = 1; i <= n && session.measuring; i += 1) {
    const step = Math.min(dt / n, session.remaining());
    if (step > 0) {
      session.tick(step);
      update(step, i / n);
    }
    if (session.remaining() <= 1e-12) session.finish();
  }
  return 'measured';
}

export function bindPauseTriggers(session, { canvas } = {}) {
  if (typeof document === 'undefined') return () => {};
  const doc = document;
  const win = doc.defaultView || (typeof window !== 'undefined' ? window : null);

  const onKey = (event) => {
    if (event.key === 'Escape') session.pause('esc');
  };
  const onLock = () => {
    if (canvas && doc.pointerLockElement !== canvas) session.pause('pointerlock');
  };
  const onVisibility = () => {
    if (doc.hidden) session.pause('hidden');
  };
  const onBlur = () => session.pause('blur');

  doc.addEventListener('keydown', onKey);
  doc.addEventListener('pointerlockchange', onLock);
  doc.addEventListener('visibilitychange', onVisibility);
  if (win) win.addEventListener('blur', onBlur);

  return () => {
    doc.removeEventListener('keydown', onKey);
    doc.removeEventListener('pointerlockchange', onLock);
    doc.removeEventListener('visibilitychange', onVisibility);
    if (win) win.removeEventListener('blur', onBlur);
  };
}

/**
 * One active timeline for frames and input. Both animation frames (rAF `now`) and input events
 * (`event.timeStamp`, same clock) call `advanceTo(ts)`: the simulation and measurements advance to
 * that moment first, then the caller judges the input against the state at that moment.
 * Time already advanced is never counted again; a timestamp at or before the last one is a no-op.
 * Returns what runFrame returned ('measured' | 'stall' | 'idle').
 */
export function createClock(session, update, opts) {
  let lastTs = null;
  return {
    advanceTo(ts) {
      if (!Number.isFinite(ts)) return 'idle';
      if (lastTs === null || ts <= lastTs) {
        if (lastTs === null) lastTs = ts;
        return 'idle';
      }
      const dt = (ts - lastTs) / 1000;
      lastTs = ts;
      return runFrame(session, dt, update, opts);
    },
    reset(ts) {
      lastTs = Number.isFinite(ts) ? ts : null;
    }
  };
}
