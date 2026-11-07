// Zoom / scope sensitivity matching. Pure functions; angles in degrees.
//
// A zoomed view with a narrower field of view (FOV) cannot match hip fire everywhere at once.
// Methods:
//   'turn'  — same mouse distance per 360° turn (multiplier 1)
//   'mdh'   — same mouse distance to reach a point at fraction x (0..1] of the half screen width
//             (x → 0 is the "near the crosshair" / focal-length match)
// The multiplier applies to the hip-fire yaw (or sensitivity).

const RAD = Math.PI / 180;

/** Horizontal FOV from vertical FOV for an aspect ratio (width/height). */
export function vToH(v, aspect) {
  return (2 * Math.atan(Math.tan((v * RAD) / 2) * aspect)) / RAD;
}

export function hToV(h, aspect) {
  return (2 * Math.atan(Math.tan((h * RAD) / 2) / aspect)) / RAD;
}

/** Angle (deg) from the screen centre to a point at fraction x of the half width, for horizontal FOV h. */
function angleAt(h, x) {
  return Math.atan(x * Math.tan((h * RAD) / 2)) / RAD;
}

/**
 * Multiplier for the zoomed sensitivity relative to hip fire.
 * hipH, zoomH: horizontal FOVs in (0, 180). x in [0, 1] for 'mdh' (0 = focal-length match).
 */
export function zoomMultiplier(hipH, zoomH, method, x = 0) {
  for (const f of [hipH, zoomH]) if (!(f > 0 && f < 180)) throw new RangeError('FOV out of range');
  if (method === 'turn') return 1;
  if (method !== 'mdh') throw new RangeError('unknown method');
  if (!(x >= 0 && x <= 1)) throw new RangeError('x out of range');
  if (x === 0) return Math.tan((zoomH * RAD) / 2) / Math.tan((hipH * RAD) / 2);
  return angleAt(zoomH, x) / angleAt(hipH, x);
}

/** Zoom FOV for a magnification relative to hip fire (focal-length definition). */
export function fovForMagnification(hipH, mag) {
  if (!(mag >= 1)) throw new RangeError('magnification must be >= 1');
  return (2 * Math.atan(Math.tan((hipH * RAD) / 2) / mag)) / RAD;
}

// ---- Overwatch 2 -----------------------------------------------------------------------------
// FOV setting: horizontal degrees at 16:9 (80..103). "Relative aim sensitivity while zoomed" is a
// percentage of hip-fire sensitivity. Zoomed vertical FOVs are back-calculated from the widely
// cited 103-FOV values (Widowmaker/Ana 37.89%, Ashe 51.47%): 30° and 40°.
export const OW = {
  fovMin: 80,
  fovMax: 103,
  aspect: 16 / 9,
  heroes: {
    widow: { zoomV: 30 },
    ana: { zoomV: 30 },
    ashe: { zoomV: 40 },
  },
};

export function owZoomPercent(hero, fov, method, x = 0) {
  const h = OW.heroes[hero];
  if (!h) throw new RangeError('unknown hero');
  if (!(fov >= OW.fovMin && fov <= OW.fovMax)) throw new RangeError('FOV setting out of range');
  const zoomH = vToH(h.zoomV, OW.aspect);
  return zoomMultiplier(fov, zoomH, method, x) * 100;
}
