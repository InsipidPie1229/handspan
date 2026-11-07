import {
  SIZES,
  SPEEDS,
  DURATIONS,
  summarize,
  compareKey
} from './lib/click.js';
import { Session, bindPauseTriggers } from './lib/session.js';
import { createClickRun } from './lib/clickRun.js';


const I18N = JSON.parse(document.getElementById('i18n').textContent);
const LANG = document.documentElement.lang;
const $ = (id) => document.getElementById(id);
const SIZE_KEYS = ['S', 'M', 'L'];
const SPEED_KEYS = ['still', 'slow', 'fast'];
const SIZE_TEXT = {
  S: t('click.sizeS'),
  M: t('click.sizeM'),
  L: t('click.sizeL')
};
const SPEED_TEXT = {
  still: t('click.speedStill'),
  slow: t('click.speedSlow'),
  fast: t('click.speedFast')
};
const START_TEXT = {
  30: t('click.start30'),
  60: t('click.start60')
};
const BIN_TEXT = [
  t('click.bin0'),
  t('click.bin1'),
  t('click.bin2'),
  t('click.bin3'),
  t('click.bin4')
];

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
    // Storage can be unavailable; the test still runs without history.
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
  duration: pick(Number(params.get('dur')), DURATIONS, 30),
  active: false,
  restarting: false,
  target: null,
  cursor: null,
  events: [],
  hits: 0,
  misses: 0,
  spawnAt: 0,
  spawnDist: 0,
  runCfg: null,
  result: null,
  key: null
};

let hist = storeGet('hs-click-history', []);
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
  $('hHit').innerHTML = t('click.hudHits', { n: `<b>${S.run?.hits ?? 0}</b>` });
  $('hMiss').innerHTML = t('click.hudMisses', { n: `<b>${S.run?.misses ?? 0}</b>` });
  $('hTime').innerHTML = t('click.hudTime', { s: `<b>${remaining().toFixed(1)}</b>` });
}


function startRun() {
  S.active = true;
  S.invalid = false;
  S.resumed = false;
  S.startArena = arenaSize();
  S.startKey = null;
  S.result = null;
  S.runCfg = runCfg();
  S.run = createClickRun({ session, cfg: S.runCfg, arena: arenaSize });
  $('copyMsg').hidden = true;
  $('linkInput').hidden = true;
  updateHud();
  hideLayers();
  S.startKey = compareKey({ size: S.runCfg.size, speed: S.runCfg.speed, duration: S.runCfg.duration }, S.startArena);
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
  $('pausedBody').textContent = t('click.pausedBody', { s: remaining().toFixed(1) });
  $('ready').hidden = true;
  $('result').hidden = true;
  $('paused').hidden = false;
}

function finishRun() {
  S.active = false;
  const cfg = S.runCfg;
  S.result = summarize(S.run ? S.run.events : [], cfg);
  S.key = S.startKey || compareKey({ size: cfg.size, speed: cfg.speed, duration: cfg.duration }, S.startArena || arenaSize());
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

function medianText(value) {
  return value == null ? t('click.sampleShort') : `${Math.round(value)}${t('click.unitMs')}`;
}

function renderResult() {
  const result = S.result;
  const cfg = S.runCfg;
  $('resTitle').textContent = t('click.resultTitle', { n: cfg.duration });
  $('resCond').textContent = t('click.cond', {
    size: SIZE_TEXT[cfg.sizeKey],
    speed: SPEED_TEXT[cfg.speedKey],
    dur: cfg.duration
  });
  $('copyMsg').hidden = true;
  $('linkInput').hidden = true;

  if (result.empty) {
    $('resBody').innerHTML = `<p class="cond">${esc(t('click.empty'))}</p>`;
    return;
  }

  const acquire = result.medianAcquire == null
    ? `<span class="short">${esc(t('click.sampleShort'))}</span>`
    : `${Math.round(result.medianAcquire)}<small>${esc(t('click.unitMs'))}</small>`;
  let html = `<dl class="res">
    <div><dt>${esc(t('click.statAccuracy'))}</dt><dd>${Math.round(result.accuracy * 100)}<small>${esc(t('click.unitPct'))}</small></dd></div>
    <div><dt>${esc(t('click.statMisses'))}</dt><dd>${result.misses}<small>${esc(t('click.unitCount'))}</small></dd></div>
    <div><dt>${esc(t('click.statAcquire'))}</dt><dd>${acquire}</dd></div>
  </dl>`;

  const max = Math.max(1, ...result.bins.map((bin) => bin.median || 0));
  html += `<div class="dist">
    <span class="cond">${esc(t('click.distHeading'))}</span>
    <div class="bars">${result.bins.map((bin) => {
      const height = bin.median == null ? 0 : Math.max(4, Math.round((bin.median / max) * 100));
      const value = bin.median == null ? t('click.sampleShort') : `${Math.round(bin.median)}${t('click.unitMs')}`;
      return `<i style="height:${height}%"><em>${esc(value)}</em></i>`;
    }).join('')}</div>
    <div class="lbl">${result.bins.map((bin, index) => `<span>${esc(BIN_TEXT[index])}<br>${esc(t('click.nLabel', { n: bin.n }))}</span>`).join('')}</div>
  </div>`;

  if (result.insufficient) html += `<p class="cond">${esc(t('click.insufficient'))}</p>`;
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
    misses: S.result.misses,
    medianAcquire: S.result.medianAcquire
  });
  if (hist.length > 50) hist = hist.slice(-50);
  storeSet('hs-click-history', hist);
  renderHistory();
}

function renderHistory() {
  const same = hist.filter((entry) => entry && entry.key === S.key).slice(-5).reverse();
  let html = `<span class="cond">${esc(t('click.histHeading'))}</span>`;
  if (!same.length) {
    html += `<p class="cond">${esc(t('click.histEmpty'))}</p>`;
  } else {
    html += `<ul>${same.map((entry) => {
      const med = entry.medianAcquire == null ? t('click.sampleShort') : `${Math.round(entry.medianAcquire)}${t('click.unitMs')}`;
      return `<li><span>${esc(entry.date)}</span><span>${esc(t('click.histRow', {
        acc: Math.round((entry.accuracy || 0) * 100),
        miss: entry.misses || 0,
        med
      }))}</span></li>`;
    }).join('')}</ul>`;
  }
  $('resHist').innerHTML = html;
}

function draw(now) {
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

  const visible = S.run?.target && (S.active || session.state === 'paused' || session.state === 'countdown');
  if (visible) {
    ctx.beginPath();
    ctx.arc(S.run?.target.x, S.run?.target.y, S.run?.target.r, 0, Math.PI * 2);
    ctx.fillStyle = col.tape;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = col.border;
    ctx.stroke();
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
    showCopyMsg(t('click.copyOk'));
  } catch (error) {
    const input = $('linkInput');
    input.value = url;
    input.hidden = false;
    input.focus();
    input.select();
    showCopyMsg(t('click.copyFail'));
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
  g.fillText(t('click.resultTitle', { n: cfg.duration }), 60, 122);

  if (result.empty) {
    g.fillStyle = '#B4B7B2';
    g.font = '500 26px "IBM Plex Sans KR", sans-serif';
    g.fillText(t('click.empty'), 60, 240);
  } else {
    const stats = [
      [t('click.statAccuracy'), `${Math.round(result.accuracy * 100)}${t('click.unitPct')}`],
      [t('click.statMisses'), `${result.misses}${t('click.unitCount')}`],
      [t('click.statAcquire'), result.medianAcquire == null ? t('click.sampleShort') : `${Math.round(result.medianAcquire)}${t('click.unitMs')}`]
    ];
    stats.forEach(([label, value], index) => {
      const x = 60 + index * 310;
      g.fillStyle = '#83878A';
      g.font = '500 18px "IBM Plex Sans KR", sans-serif';
      g.fillText(label, x, 208);
      g.fillStyle = '#E9EAE6';
      g.font = '800 54px Archivo, sans-serif';
      g.fillText(value, x, 276);
    });
  }

  const cond = t('click.cond', {
    size: SIZE_TEXT[cfg.sizeKey],
    speed: SPEED_TEXT[cfg.speedKey],
    dur: cfg.duration
  });
  g.fillStyle = '#B4B7B2';
  g.font = '400 17px "IBM Plex Sans KR", sans-serif';
  g.fillText(cond, 60, 548, 880);
  g.fillStyle = '#83878A';
  g.font = '500 15px "IBM Plex Mono", monospace';
  g.fillText('handspan', 60, 590);

  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'handspan-click.png';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, 'image/png');
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
    draw(performance.now());
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', readCols);
  new MutationObserver(readCols).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  document.querySelectorAll('[data-size]').forEach((button) => {
    button.addEventListener('click', () => {
      S.sizeKey = button.dataset.size;
      updateControls();
      syncUrl();
    });
  });
  document.querySelectorAll('[data-speed]').forEach((button) => {
    button.addEventListener('click', () => {
      S.speedKey = button.dataset.speed;
      updateControls();
      syncUrl();
    });
  });
  document.querySelectorAll('[data-dur]').forEach((button) => {
    button.addEventListener('click', () => {
      S.duration = Number(button.dataset.dur);
      updateControls();
      syncUrl();
    });
  });

  $('startBtn').addEventListener('click', startRun);
  $('resumeBtn').addEventListener('click', () => session.resume());
  $('restartBtn').addEventListener('click', restartRun);
  $('againBtn').addEventListener('click', startRun);
  $('saveBtn').addEventListener('click', saveImage);
  $('copyBtn').addEventListener('click', copyLink);

  cv.addEventListener('pointermove', (event) => {
    const rect = cv.getBoundingClientRect();
    if (S.run) S.run.move(event.clientX - rect.left, event.clientY - rect.top);
  });
  cv.addEventListener('pointerdown', onDown);

  function frame(now) {
    if (S.active && S.run) S.run.frame(now);
    draw(now);
    updateHud();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

init();
