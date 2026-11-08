import { zoomMultiplier, fovForMagnification, vToH, hToV, owZoomPercent, OW } from './lib/zoom.js';

const I18N = JSON.parse(document.getElementById('i18n').textContent);
const $ = (id) => document.getElementById(id);
function t(key, vars = {}) {
  const text = I18N[key] ?? key;
  return text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

function setErr(field, errId, message) {
  const input = $(field);
  const err = $(errId);
  input.closest('.f').classList.toggle('bad', !!message);
  input.setAttribute('aria-invalid', message ? 'true' : 'false');
  err.hidden = !message;
  err.textContent = message || '';
}

function num(id) {
  const v = $(id).value.trim();
  return v === '' ? NaN : Number(v);
}

/** Method select + point input -> [method, x]; x validated to 1..100 %. */
function method(selId, xId, fieldId, errId) {
  const m = $(selId).value;
  $(fieldId).hidden = m !== 'x';
  if (m === 'turn') { setErr(xId, errId, ''); return ['turn', 0, true]; }
  if (m === '0') { setErr(xId, errId, ''); return ['mdh', 0, true]; }
  const x = num(xId);
  const ok = Number.isFinite(x) && x >= 1 && x <= 100;
  setErr(xId, errId, ok ? '' : t('zoom.errPoint'));
  return ['mdh', x / 100, ok];
}

function ow() {
  const fov = num('owFov');
  const fovOk = Number.isFinite(fov) && fov >= OW.fovMin && fov <= OW.fovMax;
  setErr('owFov', 'eOwFov', fovOk ? '' : t('zoom.errOwFov', { min: OW.fovMin, max: OW.fovMax }));
  const [m, x, ok] = method('owMethod', 'owX', 'fOwX', 'eOwX');
  const good = fovOk && ok;
  $('owBig').classList.toggle('void', !good);
  $('owOut').textContent = good ? owZoomPercent($('owHero').value, fov, m, x).toFixed(2) : '--';
}

function gen() {
  const hip = num('gHip');
  const type = $('gHipType').value;
  const aspect = Number($('gAspect').value);
  const hipOk = Number.isFinite(hip) && hip >= 10 && hip <= 170;
  setErr('gHip', 'eGHip', hipOk ? '' : t('zoom.errFov'));
  const kind = $('gZoomKind').value;
  $('gZoomLbl').textContent = kind === 'mag' ? t('zoom.genMag') : t('zoom.genZoomFovIn');
  const z = num('gZoom');
  const hipH = hipOk ? (type === 'h' ? hip : vToH(hip, aspect)) : NaN;
  let zoomH = NaN;
  let zoomOk = false;
  if (kind === 'mag') {
    zoomOk = Number.isFinite(z) && z >= 1 && z <= 50;
    setErr('gZoom', 'eGZoom', zoomOk ? '' : t('zoom.errMag'));
    if (zoomOk && hipOk) zoomH = fovForMagnification(hipH, z);
  } else {
    zoomOk = Number.isFinite(z) && z >= 1 && z <= 170;
    setErr('gZoom', 'eGZoom', zoomOk ? '' : t('zoom.errZoomFov'));
    if (zoomOk && hipOk) zoomH = type === 'h' ? z : vToH(z, aspect);
  }
  const [m, x, ok] = method('gMethod', 'gX', 'fGX', 'eGX');
  // Hip-fire sensitivity is optional: empty means "multiplier only".
  const sensEmpty = $('gSens').value.trim() === '';
  const sens = num('gSens');
  const sensOk = !sensEmpty && Number.isFinite(sens) && sens > 0 && sens < 1e6;
  setErr('gSens', 'eGSens', sensEmpty || sensOk ? '' : t('zoom.errSens'));
  const good = hipOk && zoomOk && ok && Number.isFinite(zoomH);
  $('gBig').classList.toggle('void', !good);
  if (!good) {
    $('gOut').textContent = '--';
    $('gSensOut').textContent = '--';
    $('gFovOut').textContent = '--';
    return;
  }
  const mult = zoomMultiplier(hipH, zoomH, m, x);
  $('gOut').textContent = mult.toFixed(4);
  const zs = sens * mult;
  // The product must stay a usable positive number (tiny inputs can underflow to 0).
  const zsOk = sensOk && Number.isFinite(zs) && zs >= 1e-6;
  if (sensOk && !zsOk) setErr('gSens', 'eGSens', t('zoom.errSens'));
  $('gSensOut').textContent = zsOk ? String(+zs.toPrecision(5)) : '--';
  const zv = hToV(zoomH, aspect);
  $('gFovOut').textContent = `${zoomH.toFixed(2)}° H · ${zv.toFixed(2)}° V`;
}

['owHero', 'owFov', 'owMethod', 'owX'].forEach((id) => $(id).addEventListener('input', ow));
['gHip', 'gHipType', 'gAspect', 'gZoomKind', 'gZoom', 'gMethod', 'gX', 'gSens'].forEach((id) => $(id).addEventListener('input', gen));
ow();
gen();
