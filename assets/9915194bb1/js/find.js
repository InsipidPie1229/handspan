import { settableSens, settableDpi } from './lib/sens.js';
import { makeRound, scoreRound, pooled, nextRange, finalRange } from './lib/finder.js';
import { Session, bindPauseTriggers } from './lib/session.js';
import { createFindRun } from './lib/findRun.js';

const I18N = JSON.parse(document.getElementById('i18n').textContent);
const LANG = document.documentElement.lang;
const $ = (id) => document.getElementById(id);
const K = 914.4;
const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
const VF = 2 * Math.atan(Math.tan((103 / 2) * D2R) * 9 / 16);
const ROUNDS = 2;
const TRIAL = { warm: { flicks: 10, track: 10 }, test: { flicks: 20, track: 20 } };
const FEEL = { ok: 'find.feelOk', wrist: 'find.feelWrist', shoulder: 'find.feelShoulder' };
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

function t(key, vars = {}) {
  const text = I18N[key] ?? key;
  return text.replace(/\{(\w+)\}/g, (match, name) => (name in vars ? String(vars[name]) : match));
}

function esc(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}


function storeGet(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch (error) {
    return fallback;
  }
}

function storeSet(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    // Storage can be unavailable; the test still runs without history.
  }
}

let games = [];
let byId = new Map();
let cfg = Object.assign({ mode: 'sens', game: 'ow', actual: 1600, fixSens: 4, step: 50, minC: 43.5, maxC: 66 }, storeGet('hs-find-cfg', {}));
let hist = storeGet('hs-find-history', []);
if (!Array.isArray(hist)) hist = [];

const cv = $('cv');
const ctx = cv.getContext('2d');
const stage = $('stage');
const setupEls = [$('modeSens'), $('modeFix'), $('game'), $('actualDpi'), $('fixSens'), $('dpiStep'), $('minC'), $('maxC')];

const S = {
  phase: 'setup',
  run: null,
  excluded: [],
  raw: null,
  curCm: 56,
  rounds: [],
  ri: 0,
  qi: 0,
  warm: false,
  active: false,
  flash: null,
  locked: false
};

const session = new Session({ onChange: onSessionChange });

// Drawing reads the current trial's aim and targets from the run core.
Object.defineProperties(S, {
  yaw: { get: () => (S.run ? S.run.yaw : 0) },
  pitch: { get: () => (S.run ? S.run.pitch : 0) },
  tr: { get: () => (S.run ? S.run.tr : null) },
  stage: { get: () => (S.run ? S.run.stage : null) }
});
bindPauseTriggers(session, { canvas: cv });

const round = () => S.rounds[S.ri];
const cand = () => round().cands[round().queue[S.qi]];
const game = () => byId.get(cfg.game);
const shortName = (g) => (g ? (g.short || g.id || '').toUpperCase() : '');
const modeNow = () => ($('modeFix').checked ? 'fix' : 'sens');

function reasonText(reason) {
  if (reason === 'allExcluded') return t('find.reason.allExcluded');
  if (reason === 'insufficient') return t('find.reason.insufficient');
  if (reason === 'indistinct') return t('find.reason.indistinct');
  if (reason === 'noCandidates') return t('find.reason.noCandidates');
  return '';
}

// All settable values go through lib/sens.js so rounding, limits and error are computed one way.
function fixDpi(cm) {
  return settableDpi(cm, cfg.fixSens, game().yaw, cfg.step || 50);
}

function sensAt(cm, dpi, g = game()) {
  return settableSens(cm, dpi, g.yaw, g.decimals);
}

/** Real cm/360 of the settable value for a target, or NaN when it cannot be set within tolerance. */
function snap(cm) {
  const r = cfg.mode === 'fix' ? fixDpi(cm) : sensAt(cm, cfg.actual);
  return r.ok && !r.clamped ? r.cm : NaN;
}

/** Settable sensitivity text; values outside the temporary tolerance are marked and not recommended. */
function sensText(cm, dpi, g = game()) {
  const r = sensAt(cm, dpi, g);
  const v = r.sens.toFixed(g.decimals);
  return r.ok ? v : `${v} ${t('find.offSuffix', { err: (r.errPct > 0 ? '+' : '') + r.errPct.toFixed(1) })}`;
}

function valueLabel(cm) {
  if (cfg.mode === 'fix') return t('find.labelDpi', { dpi: fixDpi(cm).dpi });
  const g = game();
  return t('find.labelSens', {
    short: shortName(g),
    sens: sensAt(cm, cfg.actual, g).sens.toFixed(g.decimals)
  });
}

let col = {};
function readCols() {
  const cs = getComputedStyle(document.documentElement);
  const get = (name, fallback) => cs.getPropertyValue(name).trim() || fallback;
  col = {
    sky: get('--arena', '#0B0C0D'),
    floor: get('--arena-2', '#17191B'),
    target: get('--tape', '#F2C230'),
    targetOn: get('--ok', '#6CC08C'),
    targetCore: get('--arena-ink', '#E9EAE6'),
    cross: get('--arena-ink', '#E9EAE6'),
    hud: get('--arena-ink', '#E9EAE6'),
    bad: get('--err', '#F2827A'),
    grid: 'rgba(233,234,230,.08)',
    horizon: 'rgba(233,234,230,.22)'
  };
}

// The arena size is fixed for a whole search. A change (window resize or entering/leaving
// fullscreen) during a search invalidates it: no recommendation, history or result is produced.
function searchInProgress() {
  return S.phase !== 'setup' && S.phase !== 'final' && S.rounds.length > 0;
}

function invalidateSearch() {
  S.active = false;
  S.rounds = [];
  S.run = null;
  S.phase = 'setup';
  if (session.state !== 'idle' && session.state !== 'done') session.finish();
  if (document.pointerLockElement) document.exitPointerLock();
  $('finalSec').hidden = true;
  setSetupDisabled(false);
  $('startBtn').textContent = t('find.start');
  renderProg();
  overlay(t('find.invalidK'), t('find.invalidT'), t('common.invalidArena'), []);
}

function resize() {
  if (searchInProgress() && S.startArena &&
      (Math.abs(cv.clientWidth - S.startArena.w) >= 1 || Math.abs(cv.clientHeight - S.startArena.h) >= 1)) {
    invalidateSearch();
  }
  const density = devicePixelRatio || 1;
  cv.width = Math.max(1, Math.round(cv.clientWidth * density));
  cv.height = Math.max(1, Math.round(cv.clientHeight * density));
}

function readCfg() {
  const actual = +$('actualDpi').value;
  const minC = +$('minC').value;
  const maxC = +$('maxC').value;
  const fixSens = +$('fixSens').value;
  const mode = modeNow();
  let message = null;
  if (!(actual >= 100 && actual <= 32000)) message = t('find.errDpi');
  else if (mode === 'fix' && !(fixSens > 0)) message = t('find.errFix');
  else if (!Number.isFinite(minC) || !Number.isFinite(maxC) || minC < 10 || maxC > 150) message = t('find.errRange');
  else if (maxC - minC < 4) message = t('find.errGap');
  if (message) return message;
  cfg = { mode, game: $('game').value, actual, fixSens: fixSens || 4, step: +$('dpiStep').value || 50, minC, maxC };
  storeSet('hs-find-cfg', cfg);
  return null;
}

function showSetupMsg(message) {
  const el = $('setupMsg');
  el.hidden = !message;
  el.textContent = message || '';
}

function renderSetup() {
  const message = readCfg();
  showSetupMsg(message);
  $('fixField').hidden = modeNow() !== 'fix';
  $('stepField').hidden = modeNow() !== 'fix';
  const minC = +$('minC').value;
  const maxC = +$('maxC').value;
  $('rangeHint').textContent = minC > 0 && maxC > 0
    ? t('find.rangeHint', { lo: Math.round(K / (0.0066 * minC)), hi: Math.round(K / (0.0066 * maxC)) })
    : '';
  if (message) {
    $('preview').innerHTML = `<span>${esc(t('find.previewWait'))}</span>`;
    return;
  }
  $('preview').innerHTML = [cfg.minC, (cfg.minC + cfg.maxC) / 2, cfg.maxC]
    .map((cm) => {
      const snapped = snap(cm);
      if (!Number.isFinite(snapped)) return `<span>${esc(t('find.previewUnset', { cm: cm.toFixed(1) }))}</span>`;
      return `<span>${esc(valueLabel(snapped))} · ${snapped.toFixed(1)}cm</span>`;
    })
    .join('');
}

function setRawChip() {
  const chip = $('rawChip');
  if (S.raw === true) {
    chip.className = 'chip ok';
    chip.textContent = t('find.rawOk');
  } else if (S.raw === false) {
    chip.className = 'chip warn';
    chip.textContent = t('find.rawWarn');
  } else {
    chip.className = 'chip';
    chip.textContent = t('find.rawPending');
  }
}

function renderHist() {
  const el = $('hist');
  if (!hist.length) {
    el.innerHTML = `<li><span>${esc(t('find.histEmpty'))}</span></li>`;
    return;
  }
  el.innerHTML = hist.slice(-8).reverse().map((entry) =>
    `<li><span>${esc(entry.date)}</span><span>${esc(entry.cmLo)}–${esc(entry.cmHi)}cm · ${esc(entry.label)}</span></li>`
  ).join('');
}

function setSetupDisabled(disabled) {
  setupEls.forEach((el) => { el.disabled = disabled; });
}

function overlay(kicker, title, text, buttons) {
  $('ov').hidden = false;
  $('ovK').textContent = kicker;
  $('ovT').textContent = title;
  $('ovX').textContent = text;
  const box = $('ovB');
  box.innerHTML = '';
  (buttons || []).forEach(([label, handler, primary]) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn' + (primary ? ' go' : '');
    button.textContent = label;
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      handler();
    });
    box.appendChild(button);
  });
}

function hideOverlay() {
  $('ov').hidden = true;
}

function setReadyOverlay() {
  if (S.warm) {
    overlay(t('find.warmK'), t('find.warmT'), t('find.warmX'), [[t('find.warmStart'), beginTrial, true]]);
    return;
  }
  const r = round();
  const c = cand();
  const title = c.reps.length
    ? t('find.trialTSecond', { label: c.label })
    : t('find.trialT', { label: c.label });
  overlay(
    t('find.trialK', { round: S.ri + 1, rounds: ROUNDS, i: S.qi + 1, n: r.queue.length }),
    title,
    t('find.trialX', { flicks: TRIAL.test.flicks, track: TRIAL.test.track }),
    [[t('find.trialStart', { label: c.label }), beginTrial, true]]
  );
}

function setFeelOverlay() {
  const c = cand();
  overlay(t('find.feelK'), t('find.feelT', { label: c.label }), t('find.feelX'), [
    [t('find.feelOk'), () => pickFeel('ok'), true],
    [t('find.feelWrist'), () => pickFeel('wrist')],
    [t('find.feelShoulder'), () => pickFeel('shoulder')]
  ]);
}

function setRoundDoneOverlay() {
  const r = round();
  overlay(
    t('find.roundDoneK', { round: S.ri + 1 }),
    r.winner === null ? t('find.roundNoWinner') : t('find.roundDoneT', { value: valueLabel(r.winner), cm: r.winner.toFixed(1) }),
    t('find.roundDoneX'),
    [[S.ri + 1 >= ROUNDS || r.winner === null ? t('find.showFinal') : t('find.next'), nextRound, true]]
  );
}

function setFinalOverlay() {
  overlay(t('find.finalK'), t('find.finalT'), t('find.finalX'), []);
}

function onSessionChange(state, prev) {
  if (S.run) S.run.onState(state, prev);
  if (state === 'running' && prev === 'countdown') {
    hideOverlay();
  } else if (state === 'paused') {
    if (S.active) showPause();
  } else if (state === 'countdown' && prev === 'paused') {
    hideOverlay();
  }
}

function showPause() {
  const text = S.warm ? t('find.pauseWarmT') : t('find.pauseT', { label: cand().label });
  overlay(t('find.pauseK'), text, t('find.pauseX'), [[t('find.resume'), resume, true]]);
}

async function lock() {
  if (document.pointerLockElement === cv) {
    setRawChip();
    return true;
  }
  try {
    const request = cv.requestPointerLock({ unadjustedMovement: true });
    if (request && request.then) {
      await request;
      S.raw = true;
    } else {
      S.raw = null;
    }
  } catch (error) {
    if (error && error.name === 'NotSupportedError') {
      try {
        const fallback = cv.requestPointerLock();
        if (fallback && fallback.then) await fallback;
        S.raw = false;
      } catch (second) {
        return false;
      }
    } else {
      return false;
    }
  }
  setRawChip();
  return true;
}

function lockFail(retry) {
  overlay(t('find.lockFailK'), t('find.lockFailT'), t('find.lockFailX'), [[t('find.retry'), retry, true]]);
}

async function beginTrial() {
  if (!(await lock())) {
    lockFail(beginTrial);
    return;
  }
  const r = round();
  S.curCm = S.warm ? (r.lo + r.hi) / 2 : cand().cm;
  S.flash = null;
  S.run = createFindRun({
    session,
    spec: S.warm ? TRIAL.warm : TRIAL.test,
    perCount: K / (S.curCm * cfg.actual), // degrees per mouse count for this candidate
    onDone: endTrial
  });
  S.active = true;
  S.phase = 'trial';
  hideOverlay();
  renderProg();
  session.start();
}

async function resume() {
  if (!(await lock())) {
    lockFail(resume);
    return;
  }
  session.resume();
  hideOverlay();
}




function endTrial(result) {
  if (!S.active) return; // discarded (e.g. the search was invalidated)
  S.active = false;
  if (document.pointerLockElement) document.exitPointerLock();
  if (S.warm) {
    S.warm = false;
    S.phase = 'ready';
    setReadyOverlay();
    renderProg();
    return;
  }
  cand().reps.push(result);
  S.phase = 'feel';
  setFeelOverlay();
  renderProg();
}


function dir(yaw, pitch) {
  const a = yaw * D2R;
  const b = pitch * D2R;
  return [Math.cos(b) * Math.sin(a), Math.sin(b), Math.cos(b) * Math.cos(a)];
}

function angDist(yaw1, pitch1, yaw2, pitch2) {
  const u = dir(yaw1, pitch1);
  const v = dir(yaw2, pitch2);
  return Math.acos(clamp(u[0] * v[0] + u[1] * v[1] + u[2] * v[2], -1, 1)) * R2D;
}

function draw(now) {
  const W = cv.width;
  const H = cv.height;
  if (!W || !H) return;
  const c = ctx;
  const dp = devicePixelRatio || 1;
  const focal = (H / 2) / Math.tan(VF / 2);
  const inArena = S.active || session.state === 'paused';
  const yaw = inArena ? S.yaw : 0;
  const pitch = inArena ? S.pitch : -4;
  const ca = Math.cos(yaw * D2R);
  const sa = Math.sin(yaw * D2R);
  const cb = Math.cos(pitch * D2R);
  const sb = Math.sin(pitch * D2R);

  const project = (y, p) => {
    const d = dir(y, p);
    const x1 = d[0] * ca - d[2] * sa;
    const z1 = d[0] * sa + d[2] * ca;
    const y2 = d[1] * cb - z1 * sb;
    const z2 = d[1] * sb + z1 * cb;
    return z2 <= 0.05 ? null : [W / 2 + focal * x1 / z2, H / 2 - focal * y2 / z2, z2];
  };

  c.fillStyle = col.sky;
  c.fillRect(0, 0, W, H);

  const horizon = [];
  for (let y = yaw - 80; y <= yaw + 80; y += 4) {
    const point = project(y, 0);
    if (point) horizon.push(point);
  }
  if (horizon.length > 1) {
    c.beginPath();
    c.moveTo(horizon[0][0], horizon[0][1]);
    horizon.forEach((point) => c.lineTo(point[0], point[1]));
    c.lineTo(W * 4, H * 4);
    c.lineTo(-W * 3, H * 4);
    c.closePath();
    c.fillStyle = col.floor;
    c.fill();
  }

  c.lineWidth = 1 * dp;
  c.strokeStyle = col.grid;
  const line = (points) => {
    c.beginPath();
    let started = false;
    points.forEach((point) => {
      if (!point) {
        started = false;
        return;
      }
      if (!started) {
        c.moveTo(point[0], point[1]);
        started = true;
      } else {
        c.lineTo(point[0], point[1]);
      }
    });
    c.stroke();
  };
  for (let y = Math.floor((yaw - 90) / 15) * 15; y <= yaw + 90; y += 15) {
    const points = [];
    for (let p = -45; p <= 45; p += 5) points.push(project(y, p));
    line(points);
  }
  for (const p of [-30, -15, 15, 30]) {
    const points = [];
    for (let y = yaw - 90; y <= yaw + 90; y += 4) points.push(project(y, p));
    line(points);
  }
  c.strokeStyle = col.horizon;
  line(horizon);

  let target = null;
  let onNow = false;
  if (S.stage === 'flick' && S.tr && S.tr.f) {
    target = S.tr.f;
  } else if (S.stage === 'track' && S.tr && S.tr.trk) {
    target = S.tr.trk;
    onNow = target.onNow;
  } else if (!S.active) {
    const phase = reduceMotion ? 0 : now / 1000;
    target = { y: 8 + 14 * Math.sin(phase * 0.9), p: -2 + 1.5 * Math.sin(phase * 1.7), r: 1.8 };
  }

  if (target) {
    const point = project(target.y, target.p);
    if (point && point[0] > -50 && point[0] < W + 50 && point[1] > -50 && point[1] < H + 50) {
      const radius = focal * Math.tan(target.r * D2R) / point[2];
      c.beginPath();
      c.arc(point[0], point[1], radius, 0, Math.PI * 2);
      c.fillStyle = onNow ? col.targetOn : col.target;
      c.fill();
      c.beginPath();
      c.arc(point[0], point[1], radius * 0.38, 0, Math.PI * 2);
      c.fillStyle = col.targetCore;
      c.fill();
    } else if (inArena) {
      const dy = ((target.y - yaw) % 360 + 540) % 360 - 180;
      const dPitch = target.p - pitch;
      const length = Math.hypot(dy, dPitch) || 1;
      const ux = dy / length;
      const uy = -dPitch / length;
      const margin = 24 * dp;
      const scale = Math.min((W / 2 - margin) / Math.abs(ux || 1e-6), (H / 2 - margin) / Math.abs(uy || 1e-6));
      const size = 10 * dp;
      c.save();
      c.translate(W / 2 + ux * scale, H / 2 + uy * scale);
      c.rotate(Math.atan2(uy, ux));
      c.beginPath();
      c.moveTo(size, 0);
      c.lineTo(-size, -size * 0.7);
      c.lineTo(-size, size * 0.7);
      c.closePath();
      c.fillStyle = col.target;
      c.fill();
      c.restore();
    }
  }

  const crossColor = S.flash ? (S.flash.hit ? col.targetOn : col.bad) : col.cross;
  const gap = 4 * dp;
  const arm = 7 * dp;
  c.strokeStyle = crossColor;
  c.lineWidth = 2 * dp;
  c.beginPath();
  c.moveTo(W / 2 - gap - arm, H / 2); c.lineTo(W / 2 - gap, H / 2);
  c.moveTo(W / 2 + gap, H / 2); c.lineTo(W / 2 + gap + arm, H / 2);
  c.moveTo(W / 2, H / 2 - gap - arm); c.lineTo(W / 2, H / 2 - gap);
  c.moveTo(W / 2, H / 2 + gap); c.lineTo(W / 2, H / 2 + gap + arm);
  c.stroke();
  c.fillStyle = crossColor;
  c.fillRect(W / 2 - dp, H / 2 - dp, 2 * dp, 2 * dp);

  if (inArena) {
    c.fillStyle = col.hud;
    c.font = `600 ${13 * dp}px "IBM Plex Mono", Consolas, monospace`;
    c.textBaseline = 'top';
    let text = S.warm
      ? t('find.hudWarm')
      : t('find.hudRound', { round: S.ri + 1, rounds: ROUNDS, label: cand().label });
    if (S.stage === 'flick' && S.tr) {
      text += `  ·  ${t('find.hudFlick', { i: S.tr.n + 1, n: S.tr.spec.flicks })}`;
    }
    if (S.stage === 'track' && S.tr && S.tr.trk) {
      const trk = S.tr.trk;
      text += trk.grace > 0
        ? `  ·  ${t('find.hudTrackReady')}`
        : `  ·  ${t('find.hudTrack', { s: Math.max(0, S.tr.spec.track - trk.time).toFixed(1), pct: Math.round(100 * trk.on / Math.max(1e-6, trk.time)) })}`;
    }
    c.fillText(text, 14 * dp, 12 * dp);
    if (session.state === 'countdown') {
      c.font = `700 ${64 * dp}px "Archivo", sans-serif`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(String(Math.ceil(session.countdownLeft)), W / 2, H / 2 - 70 * dp);
      c.textAlign = 'left';
    }
  }
}

let lastFrame = null;
function frame(now) {
  const dt = lastFrame === null ? 0 : Math.max(0, (now - lastFrame) / 1000);
  lastFrame = now;
  if (S.flash) {
    S.flash.t -= dt;
    if (S.flash.t <= 0) S.flash = null;
  }
  if (S.active && S.run) S.run.frame(now);
  draw(now);
  requestAnimationFrame(frame);
}

function epCell(ep) {
  if (!Number.isFinite(ep)) return '–';
  const cls = ep > 1.06 ? 'ep-hi' : ep < 0.94 ? 'ep-lo' : 'ep-ok';
  return `<span class="${cls}">${ep.toFixed(2)}×</span>`;
}

function renderProg() {
  const el = $('prog');
  if (!S.rounds.length) {
    el.innerHTML = `<p class="empty">${esc(t('find.progEmpty'))}</p>`;
    return;
  }
  const total = ROUNDS * 6;
  const base = S.rounds.slice(0, S.ri).length * 6;
  const currentDone = (S.phase === 'final' || S.phase === 'roundDone') ? round().queue.length : S.qi;
  const doneN = base + currentDone;
  let html = `<div class="steps" role="img" aria-label="${esc(t('find.stepsAria', { done: doneN, total }))}">${Array.from({ length: total }, (_, index) => `<i class="${index < doneN ? 'done' : index === doneN && !S.warm ? 'now' : ''}"></i>`).join('')}</div>`;
  if (S.warm) html += `<p class="note">${t('find.warmNote')}</p>`;

  S.rounds.forEach((r, ri) => {
    const done = !!r.scored;
    const canPick = ri === S.ri && S.phase === 'roundDone' && !r.reason;
    html += `<div class="rhead"><b>${esc(t('find.roundLabel', { n: ri + 1 }))}</b><span>${r.lo.toFixed(1)}–${r.hi.toFixed(1)}cm</span></div>`;
    html += `<div class="tbl"><table><thead><tr><th>${t('find.tblCand')}</th><th>${t('find.tblValue')}</th><th>${t('find.tblHit')}</th><th>${t('find.tblTime')}</th><th>${t('find.tblTrack')}</th><th>${t('find.tblEp')}</th><th>${t('find.tblScore')}</th><th>${t('find.tblFeel')}</th>${canPick ? '<th></th>' : ''}</tr></thead><tbody>`;
    r.cands.forEach((c) => {
      const res = done ? c.res : (c.reps.length ? pooled(c) : null);
      const feel = done ? c.feel : (c.feels.find((value) => value !== 'ok') || 'ok');
      const feelText = done || c.feels.length ? t(FEEL[feel]) : '–';
      html += `<tr class="${done && c.cm === r.winner ? 'win' : ''}"><td>${c.label} <span style="color:var(--ink-3)">${c.reps.length}/2</span></td>`;
      html += `<td>${done ? `${esc(valueLabel(c.cm))} · ${c.cm.toFixed(1)}cm` : '?'}</td>`;
      html += `<td>${res ? Math.round(res.acc * 100) + '%' : '–'}</td>`;
      html += `<td>${res ? Math.round(res.medT * 1000) + 'ms' : '–'}</td>`;
      html += `<td>${res ? Math.round(res.track * 100) + '%' : '–'}</td>`;
      html += `<td>${res ? epCell(res.ep) : '–'}</td>`;
      html += `<td>${done ? Math.round(c.score) : '–'}</td>`;
      html += `<td><span class="feel ${done ? c.feel : ''}">${esc(feelText)}</span></td>`;
      if (canPick) {
        html += `<td>${c.cm === r.winner || c.feel !== 'ok' ? '' : `<button class="pick" type="button" data-pick="${c.cm}">${t('find.tblPick')}</button>`}</td>`;
      }
      html += '</tr>';
    });
    html += '</tbody></table></div>';
    if (done) {
      let note = t('find.noiseNote', { n: r.noise.toFixed(1) });
      if (r.reason) note += ' · ' + reasonText(r.reason);
      html += `<p class="note">${esc(note)}</p>`;
    }
  });

  if (S.phase === 'roundDone') {
    html += `<p class="note">${t('find.scoreNote')}</p>`;
    html += `<button class="btn go" id="nextBtn" type="button">${S.ri + 1 >= ROUNDS ? t('find.showFinal') : t('find.next')}</button>`;
  }
  el.innerHTML = html;
  el.querySelectorAll('[data-pick]').forEach((button) => {
    button.addEventListener('click', () => {
      const picked = round().cands.find((c) => c.cm === +button.dataset.pick);
      if (!picked || picked.feel !== 'ok' || round().reason) return;
      round().winner = picked.cm;
      round().reason = null;
      round().manual = true;
      renderProg();
    });
  });
  const nextButton = $('nextBtn');
  if (nextButton) nextButton.addEventListener('click', nextRound);
}

function pickFeel(value) {
  cand().feels.push(value);
  S.qi += 1;
  renderProg();
  if (S.qi < round().queue.length) setReadyOverlay();
  else finishRound();
}

function finishRound() {
  const r = round();
  const result = scoreRound(r.cands, (r.lo + r.hi) / 2);
  r.scored = true;
  r.noise = result.noise;
  r.tie = result.tie;
  r.reason = result.reason;
  r.winner = result.winner ? result.winner.cm : null;
  r.cands.forEach((c) => {
    if (c.feel !== 'ok' && !S.excluded.includes(c.cm)) S.excluded.push(c.cm);
  });
  S.phase = 'roundDone';
  setRoundDoneOverlay();
  renderProg();
}

function nextRound() {
  const r = round();
  if (S.ri + 1 >= ROUNDS || r.winner === null) {
    finalize();
    return;
  }
  const range = nextRange(r, cfg.minC, cfg.maxC);
  const next = range ? makeRound(range.lo, range.hi, snap, Math.random, S.excluded) : null;
  if (!next || next.cands.length < 2) {
    // No valid narrower round: stop here with no recommendation rather than inventing values.
    r.winner = null;
    r.reason = 'noCandidates';
    finalize();
    return;
  }
  S.rounds.push(next);
  S.ri += 1;
  S.qi = 0;
  S.phase = 'ready';
  setReadyOverlay();
  renderProg();
}

function kvRows(rows) {
  return rows.map(([key, value]) => `<dt>${esc(key)}</dt><dd>${esc(value)}</dd>`).join('');
}

function saveHistory(lo, hi, mid) {
  const now = new Date();
  const date = `${now.getMonth() + 1}/${now.getDate()} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const g = game();
  const label = cfg.mode === 'fix'
    ? `${shortName(g)} ${cfg.fixSens} · DPI ${fixDpi(mid).dpi}`
    : `${shortName(g)} ${sensAt(mid, cfg.actual, g).sens.toFixed(g.decimals)} @${cfg.actual}`;
  const entry = {
    date,
    measureVersion: 1,
    mode: cfg.mode,
    game: cfg.game,
    actualDpi: cfg.actual,
    minC: cfg.minC,
    maxC: cfg.maxC,
    arenaW: Math.round((stage.clientWidth || 0) / 100) * 100,
    arenaH: Math.round((stage.clientHeight || 0) / 100) * 100,
    cmLo: +lo.toFixed(1),
    cmHi: +hi.toFixed(1),
    cmMid: +mid.toFixed(1),
    label
  };
  if (cfg.mode === 'fix') {
    entry.fixSens = cfg.fixSens;
    entry.dpiStep = cfg.step;
  }
  hist.push(entry);
  if (hist.length > 50) hist = hist.slice(-50);
  storeSet('hs-find-history', hist);
  renderHist();
}

function finalizeUndecided(r) {
  const g = game();
  const none = r.reason === 'allExcluded' || r.reason === 'noCandidates';
  const sources = g.sources.length === 1 ? t('status.sourceOne') : t('status.sourceMany', { n: g.sources.length });
  const verified = g.inGameVerified ? g.inGameVerified.date : t('status.unverified');
  $('final').innerHTML = `<div class="final">
    <div class="big">${none ? esc(t('find.noneBig')) : `${r.lo.toFixed(1)}–${r.hi.toFixed(1)}<small>${t('find.finalBigUnit')}</small>`}</div>
    <p>${esc(reasonText(r.reason))}</p>
    <p class="note">${esc(none ? t('find.noneX') : t('find.undecidedX'))}</p>
    <dl class="kv"><dt>${t('find.coefHeading')}</dt><dd>${esc(t('find.coefValue', { game: g.name[LANG], sources, verified }))}</dd></dl>
  </div>`;
  $('finalSec').hidden = false;
  setSetupDisabled(false);
  $('startBtn').textContent = t('find.again');
  S.phase = 'final';
  setFinalOverlay();
  renderProg();
}

function finalize() {
  const r = round();
  if (r.winner === null) {
    finalizeUndecided(r);
    return;
  }
  const mid = r.winner;
  const fr = finalRange(r, cfg.minC, cfg.maxC);
  if (!fr) {
    r.winner = null;
    r.reason = 'noCandidates';
    finalizeUndecided(r);
    return;
  }
  const { lo, hi } = fr;
  const g = game();
  const recommended = [];

  if (cfg.mode === 'fix') {
    recommended.push([t('find.fixRec', { game: shortName(g), sens: cfg.fixSens }), t('find.dpiValue', { dpi: fixDpi(mid).dpi })]);
    recommended.push([t('find.rangeLabel'), t('find.rangeDpi', { lo: fixDpi(hi).dpi, hi: fixDpi(lo).dpi })]);
    [800, 1600].forEach((dpi) => {
      recommended.push([t('find.changeDpi', { dpi }), t('find.sensValue', { sens: sensText(mid, dpi) })]);
    });
  } else {
    [...new Set([cfg.actual, 800, 1600])].forEach((dpi) => {
      const current = dpi === cfg.actual;
      recommended.push([
        t('find.dpiRow', { dpi, current: current ? t('find.currentSuffix') : '' }),
        t('find.sensRange', {
          sens: sensText(mid, dpi),
          low: sensAt(hi, dpi).sens.toFixed(g.decimals),
          high: sensAt(lo, dpi).sens.toFixed(g.decimals)
        })
      ]);
    });
  }

  const otherDpi = cfg.mode === 'fix' ? fixDpi(mid).dpi : cfg.actual;
  // Conditions for the selected game and every game shown below, next to the recommendation.
  const shown = [g, ...[...byId.values()].filter((x) => x.id !== cfg.game)];
  const caveats = shown.filter((x) => x.caveat && x.caveat[LANG]);
  const caveatList = caveats.length
    ? `<div class="callout warn"><b>${esc(t('common.caveat'))}</b><ul>${caveats.map((x) => `<li><b>${esc(x.name[LANG])}</b> ${esc(x.caveat[LANG])}</li>`).join('')}</ul></div>`
    : '';
  const otherRows = [];
  for (const [id, other] of byId) {
    if (id === cfg.game) continue;
    otherRows.push([other.name[LANG] + (other.caveat && other.caveat[LANG] ? ' *' : ''), sensText(mid, otherDpi, other)]);
  }

  const winner = r.cands.find((c) => c.cm === mid);
  const endpoint = winner ? winner.ep : NaN;
  let endpointNote = '';
  if (Number.isFinite(endpoint)) {
    if (endpoint > 1.06) {
      endpointNote = `<p class="callout warn">${esc(t('find.epHigh', { pct: Math.round((endpoint - 1) * 100), cm: hi.toFixed(1) }))}</p>`;
    } else if (endpoint < 0.94) {
      endpointNote = `<p class="callout warn">${esc(t('find.epLow', { pct: Math.round((1 - endpoint) * 100), cm: lo.toFixed(1) }))}</p>`;
    } else {
      endpointNote = `<p class="callout">${esc(t('find.epOk', { ratio: endpoint.toFixed(2) }))}</p>`;
    }
  }

  const tieNote = r.manual ? `<p class="callout">${esc(t('find.manualNote'))}</p>` : '';
  const painNote = winner && winner.feel !== 'ok' ? `<p class="callout warn">${esc(t('find.painNote'))}</p>` : '';

  const ranked = r.cands.slice().sort((a, b) => b.score - a.score);
  const gap = ranked.length > 1 ? ranked[0].score - ranked[1].score : 0;
  const reliable = !r.tie && gap > r.noise;
  const reliability = reliable ? t('find.reliabilityGood') : t('find.reliabilityHard');
  const sources = g.sources.length === 1 ? t('status.sourceOne') : t('status.sourceMany', { n: g.sources.length });
  const verified = g.inGameVerified ? g.inGameVerified.date : t('status.unverified');
  const coef = t('find.coefValue', { game: g.name[LANG], sources, verified });

  $('final').innerHTML = `<div class="final">
    <div class="big">${lo.toFixed(1)}–${hi.toFixed(1)}<small>${t('find.finalBigUnit')}</small></div>
    <p>${esc(t('find.finalMid', { cm: mid.toFixed(1) }))}</p>
    <p class="note">${esc(t('find.basisNote'))}</p>
    <span class="sub">${esc(t('find.subDpi', { game: g.name[LANG] }))}</span>
    <dl class="kv">${kvRows(recommended)}</dl>
    <span class="sub">${esc(t('find.subOther', { dpi: otherDpi }))}</span>
    <dl class="kv">${kvRows(otherRows)}</dl>
    ${cfg.mode === 'fix' ? `<p class="note">${esc(t('find.fixNote', { step: cfg.step }))}</p>` : ''}
    ${caveatList}${endpointNote}${tieNote}${painNote}
    <dl class="kv">
      <dt>${t('find.reliabilityHeading')}</dt><dd>${esc(reliability)}</dd>
      <dt>${t('find.coefHeading')}</dt><dd>${esc(coef)}</dd>
    </dl>
    <p class="note">${esc(t('find.dpiNote'))}</p>
  </div>`;
  $('finalSec').hidden = false;
  setSetupDisabled(false);
  $('startBtn').textContent = t('find.again');
  saveHistory(lo, hi, mid);
  S.phase = 'final';
  setFinalOverlay();
  renderProg();
}

function startRun() {
  const message = readCfg();
  showSetupMsg(message);
  if (message) return;
  S.excluded = [];
  const first = makeRound(cfg.minC, cfg.maxC, snap, Math.random, S.excluded);
  if (first.cands.length < 2) {
    showSetupMsg(t('find.errNoCands'));
    return;
  }
  S.rounds = [first];
  S.startArena = { w: cv.clientWidth, h: cv.clientHeight };
  S.ri = 0;
  S.qi = 0;
  S.warm = true;
  S.active = false;
  S.run = null;
  S.phase = 'ready';
  setSetupDisabled(true);
  $('startBtn').textContent = t('find.restart');
  $('finalSec').hidden = true;
  setReadyOverlay();
  renderProg();
}

function onMove(event) {
  if (!S.locked || !S.active || !S.run) return;
  S.run.move(event.timeStamp, event.movementX, event.movementY);
}

function onDown(event) {
  if (!S.locked || !S.active || !S.run) return;
  // The run advances to the press time before judging it.
  const kind = S.run.down(event.timeStamp, event.button);
  if (kind) S.flash = { hit: kind === 'hit', t: 0.12 };
}

async function init() {
  try {
    const response = await fetch('/handspan/data/9915194bb1/games.json');
    games = await response.json();
  } catch (error) {
    games = [];
  }
  byId = new Map(games.map((g) => [g.id, g]));
  if (!byId.has(cfg.game)) cfg.game = games[0] ? games[0].id : 'ow';
  $('game').innerHTML = games.map((g) => `<option value="${esc(g.id)}">${esc(g.name[LANG])}</option>`).join('');
  $('game').value = cfg.game;
  $('actualDpi').value = cfg.actual ?? 1600;
  $('fixSens').value = cfg.fixSens ?? 4;
  $('dpiStep').value = String(cfg.step ?? 50);
  $('minC').value = cfg.minC ?? 43.5;
  $('maxC').value = cfg.maxC ?? 66;
  $(cfg.mode === 'fix' ? 'modeFix' : 'modeSens').checked = true;

  readCols();
  resize();
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(resize).observe(cv);
  addEventListener('resize', resize);
  addEventListener('themechange', () => {
    readCols();
    draw(performance.now());
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', readCols);
  new MutationObserver(readCols).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  setupEls.forEach((el) => {
    el.addEventListener('input', renderSetup);
    el.addEventListener('change', renderSetup);
  });
  $('startBtn').addEventListener('click', startRun);
  $('fsBtn').addEventListener('click', () => {
    try {
      const request = stage.requestFullscreen && stage.requestFullscreen();
      if (request && request.catch) request.catch(() => {});
    } catch (error) {
      // Fullscreen can be rejected; the stage keeps its normal size.
    }
  });
  document.addEventListener('mousemove', onMove);
  document.addEventListener('pointerlockchange', () => {
    S.locked = document.pointerLockElement === cv;
  });
  cv.addEventListener('mousedown', onDown);
  addEventListener('fullscreenchange', () => setTimeout(resize, 50));

  setRawChip();
  renderSetup();
  renderHist();
  renderProg();
  requestAnimationFrame(frame);
}

init();
