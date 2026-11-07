const K = 914.4;

export function cm360(dpi, sens, yaw) {
  return K / (dpi * sens * yaw);
}

export function sensFor(cm, dpi, yaw) {
  return K / (cm * dpi * yaw);
}

export function roundSens(v, decimals) {
  const f = 10 ** decimals;
  return Math.round(v * f) / f;
}

function round2(v) {
  return Math.round(v * 100) / 100;
}

export function convert(fromId, dpi, sens, toDpi, games) {
  const from = games.find((g) => g.id === fromId);
  if (!from) throw new Error('unknown game: ' + fromId);
  const cm = cm360(dpi, sens, from.yaw);
  const rows = games.map((g) => {
    const r = settableSens(cm, toDpi, g.yaw, g.decimals);
    return { id: g.id, sens: r.sens, edpi: round2(r.sens * toDpi), cm: r.cm, errPct: r.errPct };
  });
  return { cm, rows };
}

export function validateDpi(x) {
  return Number.isFinite(x) && x >= 100 && x <= 32000 ? null : 'err.dpi';
}

export function validateSens(x) {
  return Number.isFinite(x) && x > 0 ? null : 'err.sens';
}

export function roundDpi(v, step) {
  const rounded = Math.round(v / step) * step;
  if (rounded > 32000) return { error: 'err.dpiRange' };
  if (rounded < step) return { dpi: step };
  return { dpi: rounded };
}

/** Temporary recommendation tolerance (%). Not a verified perceptual threshold. */
export const TOLERANCE_PCT = 3;

/**
 * The value a player can actually enter for a target cm/360: sensitivity rounded to the game's
 * step (never below one step), the cm/360 that value really gives, and the error vs. the target.
 * `ok` is false when the error exceeds the temporary tolerance.
 */
export function settableSens(cm, dpi, yaw, decimals, tol = TOLERANCE_PCT) {
  const sens = Math.max(roundSens(sensFor(cm, dpi, yaw), decimals), 10 ** -decimals);
  const real = cm360(dpi, sens, yaw);
  const errPct = (real / cm - 1) * 100;
  return { sens, cm: real, errPct, ok: Math.abs(errPct) <= tol };
}

/** Same for a fixed in-game sensitivity: DPI rounded to `step` and kept within [step, 32000]. */
export function settableDpi(cm, sens, yaw, step, tol = TOLERANCE_PCT) {
  const raw = 914.4 / (yaw * sens * cm);
  const dpi = Math.min(Math.floor(32000 / step) * step, Math.max(step, Math.round(raw / step) * step));
  const real = cm360(dpi, sens, yaw);
  const errPct = (real / cm - 1) * 100;
  return { dpi, cm: real, errPct, ok: Math.abs(errPct) <= tol, clamped: raw > 32000 || raw < step };
}

/** Nearest DPI (multiple of 100, 100..32000) at which this game's settable sensitivity lands within tol% of cm. */
export function altDpi(cm, yaw, decimals, near, tol = TOLERANCE_PCT) {
  const list = [];
  for (let dpi = 100; dpi <= 32000; dpi += 100) list.push(dpi);
  list.sort((a, b) => Math.abs(a - near) - Math.abs(b - near) || a - b);
  for (const dpi of list) {
    const r = settableSens(cm, dpi, yaw, decimals, tol);
    if (r.ok) return { dpi, sens: r.sens, errPct: r.errPct };
  }
  return null;
}
