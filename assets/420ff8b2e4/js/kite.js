import {
  SIZES,
  SPEEDS,
  DURATIONS,
  MAPPINGS,
  summarize,
  compareKey
} from './lib/kite.js';
import { Session, bindPauseTriggers } from './lib/session.js';
import { createKiteRun } from './lib/kiteRun.js';


const I18N = JSON.parse(document.getElementById('i18n').textContent);
const $ = (id) => document.getElementById(id);
const SIZE_KEYS = ['S', 'M', 'L'];
const SPEED_KEYS = ['still', 'slow', 'fast'];
const MAP_KEYS = ['rl', 'lr', 'll'];
const SIZE_TEXT = {
  S: t('kite.sizeS'),
  M: t('kite.sizeM'),
  L: t('kite.sizeL')
};
const SPEED_TEXT = {
  still: t('kite.speedStill'),
  slow: t('kite.speedSlow'),
  fast: t('kite.speedFast')
};
const MAP_TEXT = {
  rl: t('kite.mapRl'),
  lr: t('kite.mapLr'),
  ll: t('kite.mapLl')
};
const START_TEXT = {
  30: t('kite.start30'),
  60: t('kite.start60')
};

function t(key, vars = {}) {
  const text = I18N[key] ?? key;
  return text.replace(/\{(\w+)\}/g, (match, name) => (name in vars ? String(vars[name]) : match));
}

function esc(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
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
    // Storage can be unavailable; the practice still runs without history.
  }
}

function pick(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

const params = new URLSearchParams(location.search);
const S = {
  run: null,
  sizeKey: pick(params.get('size'), SIZE_KEYS, 'M'),
  speedKey: pick(params.get('speed'), SPEED_KEYS, 'still'),
  mapKey: pick(params.get('map'), MAP_KEYS, 'rl'),
  duration: pick(Number(params.get('dur')), DURATIONS, 30),
  active: false,
  restarting: false,
  pair: null,
  events: [],
  oks: 0,
  orders: 0,
  runCfg: null,
  result: null,
  key: null
};

let hist = storeGet('hs-kite-history', []);
if (!Array.isArray(hist)) hist = [];

const arena = $('arena');
const cv = $('cv');
const ctx = cv.getContext('2d');
const hud = $('hud');

const session = new Session({ onChange: onSessionChange });
bindPauseTriggers(session);

let col = {};
function readCols() {
  const cs = getComputedStyle(document.documentElement);
  const get = (name, fallback) => cs.getPropertyValue(name).trim() || fallback;
  col = {
    arena: get('--arena', '#0B0C0D'),
    grid: get('--arena-2', '#17191B'),
    tape: get('--tape', '#F2C230'),
    border: '#121314',
    move: '#B4B7B2',
    ink: get('--arena-ink', '#E9EAE6')
  };
}

function arenaSize() {
  return { w: arena.clientWidth || 0, h: arena.clientHeight || 0, top: 48 };
}

// The comparison key (arena size included) is fixed when a run starts. If the arena changes size
// mid-run the run ends and is discarded: not saved, no image or link, no normal result.
function checkArenaChange() {
  if (!S.active || !S.startArena) return;
  const now = arenaSize();
  if (Math.abs(now.w - S.startArena.w) >= 1 || Math.abs(now.h - S.startArena.h) >= 1) {
    S.invalid = true;
    session.finish();
  }
}

function renderInvalid() {
  $('resBody').innerHTML = `<p class="cond">${esc(t('common.invalidArena'))}</p>`;
}

function resize() {
  checkArenaChange();
  const density = devicePixelRatio || 1;
  cv.width = Math.max(1, Math.round((cv.clientWidth || 1) * density));
  cv.height = Math.max(1, Math.round((cv.clientHeight || 1) * density));
}

function runCfg() {
  return {
    sizeKey: S.sizeKey,
    speedKey: S.speedKey,
    mapKey: S.mapKey,
    duration: S.duration,
    size: SIZES[S.sizeKey],
    speed: SPEEDS[S.speedKey]
  };
}

function updateControls() {
  document.querySelectorAll('[data-size]').forEach((button) => {
    button.setAttribute('aria-pressed', button.dataset.size === S.sizeKey ? 'true' : 'false');
  });
  document.querySelectorAll('[data-speed]').forEach((button) => {
    button.setAttribute('aria-pressed', button.dataset.speed === S.speedKey ? 'true' : 'false');
  });
  document.querySelectorAll('[data-map]').forEach((button) => {
    button.setAttribute('aria-pressed', button.dataset.map === S.mapKey ? 'true' : 'false');
  });
  document.querySelectorAll('[data-dur]').forEach((button) => {
    button.setAttribute('aria-pressed', Number(button.dataset.dur) === S.duration ? 'true' : 'false');
  });
  $('startBtn').textContent = START_TEXT[S.duration];
}

function syncUrl() {
  const next = new URLSearchParams();
  next.set('size', S.sizeKey);
  next.set('speed', S.speedKey);
  next.set('dur', String(S.duration));
  next.set('map', S.mapKey);
  history.replaceState(null, '', location.pathname + '?' + next.toString());
}

function hideLayers() {
  $('ready').hidden = true;
  $('paused').hidden = true;
  $('result').hidden = true;
}

function remaining() {
  return Math.max(0, S.duration - session.elapsed);
}

function updateHud() {
  const show = S.active && (session.state === 'running' || session.state === 'paused');
  hud.hidden = !show;
  if (!show) return;
  $('hOk').innerHTML = t('kite.hudOk', { n: `<b>${S.run?.oks ?? 0}</b>` });
  $('hOrder').innerHTML = t('kite.hudOrder', { n: `<b>${S.run?.orders ?? 0}</b>` });
  $('hTime').innerHTML = t('kite.hudTime', { s: `<b>${remaining().toFixed(1)}</b>` });
}

function startRun() {
  S.active = true;
  S.invalid = false;
  S.resumed = false;
  S.startArena = arenaSize();
  S.startKey = null;
  S.result = null;
  S.runCfg = runCfg();
  S.run = createKiteRun({ session, cfg: S.runCfg, arena: arenaSize });
  $('copyMsg').hidden = true;
  $('linkInput').hidden = true;
  updateHud();
  hideLayers();
  S.startKey = compareKey({ size: S.runCfg.size, speed: S.runCfg.speed, duration: S.runCfg.duration, map: S.runCfg.mapKey }, S.startArena);
  session.start();
}

function restartRun() {
  S.restarting = true;
  session.finish();
  S.restarting = false;
  startRun();
}

function onSessionChange(state, prev) {
  if (S.run) S.run.onState(state, prev);
  if (state === 'countdown') {
    hideLayers();
  } else if (state === 'running' && prev === 'countdown') {
    hideLayers();
    updateHud();
  } else if (state === 'paused') {
    if (S.active) showPaused();
  } else if (state === 'done') {
    if (S.active && !S.restarting) finishRun();
  }
}

function showPaused() {
  $('pausedBody').textContent = t('kite.pausedBody', { s: remaining().toFixed(1) });
  $('ready').hidden = true;
  $('result').hidden = true;
  $('paused').hidden = false;
}

function condText(cfg) {
  return t('kite.cond', {
    size: SIZE_TEXT[cfg.sizeKey],
    speed: SPEED_TEXT[cfg.speedKey],
    map: MAP_TEXT[cfg.mapKey],
    dur: cfg.duration
  });
}

function finishRun() {
  S.active = false;
  const cfg = S.runCfg;
  S.result = summarize(S.run ? S.run.events : []);
  S.key = S.startKey || compareKey({ size: cfg.size, speed: cfg.speed, duration: cfg.duration, map: cfg.mapKey }, S.startArena || arenaSize());
  if (S.invalid) {
    renderInvalid();
  } else {
    renderResult();
  }
  $('saveBtn').hidden = $('copyBtn').hidden = !!S.invalid;
  if (!S.invalid && !S.result.empty) saveHistory();
  else renderHistory();
  $('ready').hidden = true;
  $('paused').hidden = true;
  $('result').hidden = false;
  updateHud();
}

function switchText(value) {
  return value == null ? t('kite.sampleShort') : `${Math.round(value)}${t('kite.unitMs')}`;
}

function resultStats(result) {
  return [
    [t('kite.statAccuracy'), `${Math.round(result.accuracy * 100)}${t('kite.unitPct')}`],
    [t('kite.statOrder'), `${result.orderErrors}${t('kite.unitCount')}`],
    [t('kite.statWrong'), `${result.wrongTargets}${t('kite.unitCount')}`],
    [t('kite.statSwitch'), switchText(result.medianSwitchMs)],
    [t('kite.statPairs'), `${result.pairs}${t('kite.unitCount')}`],
    [t('kite.statMisses'), `${result.misses}${t('kite.unitCount')}`]
  ];
}

function renderResult() {
  const result = S.result;
  const cfg = S.runCfg;
  $('resTitle').textContent = t('kite.resultTitle', { n: cfg.duration });
  $('resCond').textContent = condText(cfg);
  $('copyMsg').hidden = true;
  $('linkInput').hidden = true;

  if (result.empty) {
    $('resBody').innerHTML = `<p class="cond">${esc(t('kite.empty'))}</p>`;
    return;
  }

  let html = `<dl class="res">${resultStats(result).map(([label, value]) => {
    const short = value === t('kite.sampleShort');
    return `<div><dt>${esc(label)}</dt><dd>${short ? `<span class="short">${esc(value)}</span>` : esc(value)}</dd></div>`;
  }).join('')}</dl>`;
  if (result.insufficient) html += `<p class="cond">${esc(t('kite.insufficient'))}</p>`;
  $('resBody').innerHTML = html;
}

function dateLabel() {
  const now = new Date();
  return `${now.getMonth() + 1}/${now.getDate()} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

function saveHistory() {
  hist.push({
    date: dateLabel(),
    key: S.key,
    accuracy: S.result.accuracy,
    orderErrors: S.result.orderErrors,
    medianSwitchMs: S.result.medianSwitchMs
  });
  if (hist.length > 50) hist = hist.slice(-50);
  storeSet('hs-kite-history', hist);
  renderHistory();
}

function renderHistory() {
  const same = hist.filter((entry) => entry && entry.key === S.key).slice(-5).reverse();
  let html = `<span class="cond">${esc(t('kite.histHeading'))}</span>`;
  if (!same.length) {
    html += `<p class="cond">${esc(t('kite.histEmpty'))}</p>`;
  } else {
    html += `<ul>${same.map((entry) => `<li><span>${esc(entry.date)}</span><span>${esc(t('kite.histRow', {
      acc: Math.round((entry.accuracy || 0) * 100),
      order: entry.orderErrors || 0,
      med: switchText(entry.medianSwitchMs)
    }))}</span></li>`).join('')}</ul>`;
  }
  $('resHist').innerHTML = html;
}

function drawMove(target, active) {
  ctx.save();
  ctx.globalAlpha = active ? 1 : 0.35;
  ctx.strokeStyle = col.move;
  ctx.lineWidth = active ? 4 : 2;
  ctx.beginPath();
  ctx.arc(target.x, target.y, target.r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = active ? 2 : 1;
  ctx.beginPath();
  ctx.moveTo(target.x - target.r * 0.6, target.y);
  ctx.lineTo(target.x + target.r * 0.6, target.y);
  ctx.moveTo(target.x, target.y - target.r * 0.6);
  ctx.lineTo(target.x, target.y + target.r * 0.6);
  ctx.stroke();
  ctx.restore();
}

function drawAttack(target, active) {
  ctx.save();
  ctx.globalAlpha = active ? 1 : 0.35;
  ctx.beginPath();
  ctx.arc(target.x, target.y, target.r, 0, Math.PI * 2);
  ctx.fillStyle = col.tape;
  ctx.fill();
  ctx.lineWidth = active ? 5 : 2;
  ctx.strokeStyle = col.border;
  ctx.stroke();
  ctx.restore();
}

function draw() {
  const W = cv.clientWidth;
  const H = cv.clientHeight;
  if (!W || !H) return;
  const density = devicePixelRatio || 1;
  ctx.setTransform(density, 0, 0, density, 0, 0);
  ctx.fillStyle = col.arena;
  ctx.fillRect(0, 0, W, H);

  ctx.strokeStyle = col.grid;
  ctx.lineWidth = 1;
  for (let x = 0; x <= W; x += 48) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
  }
  for (let y = 0; y <= H; y += 48) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }

  const visible = S.run?.pair && (S.active || session.state === 'paused' || session.state === 'countdown');
  if (visible) {
    drawMove(S.run?.pair.move, S.run?.pair.turn === 'move');
    drawAttack(S.run?.pair.attack, S.run?.pair.turn === 'attack');
  }

  if (session.state === 'countdown') {
    ctx.fillStyle = col.ink;
    ctx.font = '700 64px Archivo, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(Math.ceil(session.countdownLeft)), W / 2, H / 2);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }
}

function onDown(event) {
  if (!S.active || !S.run) return;
  const rect = cv.getBoundingClientRect();
  // The run advances to event.timeStamp before judging (one timeline for frames and input).
  const kind = S.run.down(event.timeStamp, event.button, event.clientX - rect.left, event.clientY - rect.top);
  if (kind) updateHud();
}

function showCopyMsg(text) {
  const el = $('copyMsg');
  el.textContent = text;
  el.hidden = false;
}

async function copyLink() {
  const url = location.href;
  try {
    await navigator.clipboard.writeText(url);
    showCopyMsg(t('kite.copyOk'));
  } catch (error) {
    const input = $('linkInput');
    input.value = url;
    input.hidden = false;
    input.focus();
    input.select();
    showCopyMsg(t('kite.copyFail'));
  }
}

function saveImage() {
  const result = S.result;
  const cfg = S.runCfg;
  const scale = 2;
  const canvas = document.createElement('canvas');
  canvas.width = 1000 * scale;
  canvas.height = 620 * scale;
  const g = canvas.getContext('2d');
  g.scale(scale, scale);
  g.fillStyle = '#111214';
  g.fillRect(0, 0, 1000, 620);
  g.fillStyle = '#F2C230';
  g.fillRect(0, 0, 1000, 8);
  g.fillStyle = '#E9EAE6';
  g.font = '800 34px Archivo, sans-serif';
  g.fillText('handspan', 60, 84);
  g.fillStyle = '#83878A';
  g.font = '500 20px "IBM Plex Sans KR", sans-serif';
  g.fillText(t('kite.resultTitle', { n: cfg.duration }), 60, 122);

  if (result.empty) {
    g.fillStyle = '#B4B7B2';
    g.font = '500 26px "IBM Plex Sans KR", sans-serif';
    g.fillText(t('kite.empty'), 60, 240);
  } else {
    resultStats(result).forEach(([label, value], index) => {
      const x = 60 + (index % 3) * 310;
      const y = 200 + Math.floor(index / 3) * 140;
      g.fillStyle = '#83878A';
      g.font = '500 18px "IBM Plex Sans KR", sans-serif';
      g.fillText(label, x, y, 290);
      g.fillStyle = '#E9EAE6';
      g.font = '800 54px Archivo, sans-serif';
      g.fillText(value, x, y + 68, 290);
    });
  }

  g.fillStyle = '#B4B7B2';
  g.font = '400 17px "IBM Plex Sans KR", sans-serif';
  g.fillText(condText(cfg), 60, 548, 880);
  g.fillStyle = '#83878A';
  g.font = '500 15px "IBM Plex Mono", monospace';
  g.fillText('handspan', 60, 590);

  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'handspan-kite.png';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, 'image/png');
}

function bindGroup(attr, apply) {
  document.querySelectorAll(`[data-${attr}]`).forEach((button) => {
    button.addEventListener('click', () => {
      apply(button.dataset[attr]);
      updateControls();
      syncUrl();
    });
  });
}

function init() {
  readCols();
  resize();
  updateControls();
  syncUrl();
  renderHistory();
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(resize).observe(cv);
  addEventListener('resize', resize);
  addEventListener('themechange', () => {
    readCols();
    draw();
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', readCols);
  new MutationObserver(readCols).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  bindGroup('size', (value) => { S.sizeKey = value; });
  bindGroup('speed', (value) => { S.speedKey = value; });
  bindGroup('map', (value) => { S.mapKey = value; });
  bindGroup('dur', (value) => { S.duration = Number(value); });

  $('startBtn').addEventListener('click', startRun);
  $('resumeBtn').addEventListener('click', () => session.resume());
  $('restartBtn').addEventListener('click', restartRun);
  $('againBtn').addEventListener('click', startRun);
  $('saveBtn').addEventListener('click', saveImage);
  $('copyBtn').addEventListener('click', copyLink);

  cv.addEventListener('contextmenu', (event) => event.preventDefault());
  cv.addEventListener('pointerdown', onDown);

  function frame(now) {
    if (S.active && S.run) S.run.frame(now);
    draw();
    updateHud();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

init();
