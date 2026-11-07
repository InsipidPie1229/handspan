// Tracking target simulation for the sensitivity finder. Pure: no DOM, rng injected.
//
// Measurement rule (docs/DESIGN.md "측정 규칙"): the aim passed in for each sub-step is an
// estimate interpolated between the aim at the start and the end of the frame. It is not an
// observed path. Frames longer than the stall threshold never reach this code.

const D2R = Math.PI / 180;

function dir(yaw, pitch) {
  const a = yaw * D2R;
  const b = pitch * D2R;
  return [Math.cos(b) * Math.sin(a), Math.sin(b), Math.cos(b) * Math.cos(a)];
}

export function angDist(y1, p1, y2, p2) {
  const u = dir(y1, p1);
  const v = dir(y2, p2);
  const d = Math.max(-1, Math.min(1, u[0] * v[0] + u[1] * v[1] + u[2] * v[2]));
  return Math.acos(d) / D2R;
}

const rand = (rng, a, b) => a + rng() * (b - a);
const PATH_HZ = 1000;
const PATH_SECONDS = 60;

/**
 * The target path is generated once, at 1 ms resolution, when tracking starts. Position is then a
 * function of time only, so it does not depend on frame rate or sub-step size.
 */
export function makeTrack(yaw, pitch, rng = Math.random) {
  const bp = Math.max(-10, Math.min(10, pitch));
  const path = new Float32Array(PATH_HZ * PATH_SECONDS + 1);
  let y = yaw;
  let v = (rng() < 0.5 ? -1 : 1) * rand(rng, 22, 40);
  let sw = rand(rng, 0.3, 0.9);
  const dt = 1 / PATH_HZ;
  path[0] = y;
  for (let i = 1; i < path.length; i += 1) {
    y += v * dt;
    sw -= dt;
    if (sw <= 0) {
      v = -Math.sign(v) * rand(rng, 20, 42);
      sw = rand(rng, 0.25, 0.85);
    }
    if (Math.abs(y - yaw) > 35) v = -Math.sign(y - yaw) * Math.abs(v);
    path[i] = y;
  }
  return { cy: yaw, y: yaw, bp, p: bp, r: 1.8, path, t: 0, grace: 1, time: 0, on: 0, onNow: false };
}

/** Target position at time t (s) since tracking started. */
export function trackAt(trk, t) {
  const f = Math.max(0, Math.min(trk.path.length - 1, t * PATH_HZ));
  const i = Math.floor(f);
  const j = Math.min(trk.path.length - 1, i + 1);
  return { y: trk.path[i] + (trk.path[j] - trk.path[i]) * (f - i), p: trk.bp + 2.5 * Math.sin(t * 1.7) };
}

/** Advance one sub-step of `dt` seconds with the (estimated) aim at the end of that sub-step. Mutates trk. */
export function stepTrack(trk, dt, aimYaw, aimPitch) {
  trk.t += dt;
  const pos = trackAt(trk, trk.t);
  trk.y = pos.y;
  trk.p = pos.p;
  trk.onNow = angDist(aimYaw, aimPitch, trk.y, trk.p) <= trk.r;
  if (trk.grace > 0) {
    trk.grace -= dt;
  } else {
    trk.time += dt;
    if (trk.onNow) trk.on += dt;
  }
  return trk;
}
