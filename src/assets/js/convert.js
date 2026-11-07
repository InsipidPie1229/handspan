import { convert, validateDpi, validateSens, altDpi, TOLERANCE_PCT } from './lib/sens.js';

const I18N = JSON.parse(document.getElementById('i18n').textContent);
const LANG = document.documentElement.lang;
const $ = (id) => document.getElementById(id);
let games = [];
let byId = new Map();

function t(key, vars = {}) {
  const text = I18N[key] ?? key;
  return text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

const ERR_MESSAGES = {
  'err.dpi': t('err.dpi'),
  'err.sens': t('err.sens'),
  'err.dpiRange': t('err.dpiRange')
};

function esc(v) {
  return String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function setErr(fieldId, errId, message) {
  const field = $(fieldId);
  const err = $(errId);
  const input = field.querySelector('input');
  field.classList.toggle('bad', !!message);
  input.setAttribute('aria-invalid', message ? 'true' : 'false');
  err.hidden = !message;
  err.textContent = message || '';
}

function ruler(cm) {
  const sv = $('ruler');
  const W = Math.max(200, sv.clientWidth || 700);
  const narrow = W < 480;
  const lo = 15;
  const hi = 90;
  const x = (v) => 8 + ((v - lo) / (hi - lo)) * (W - 16);
  let s = '';
  sv.setAttribute('viewBox', `0 0 ${W} 52`);
  const step = narrow ? 5 : 1;
  const lab = narrow ? 15 : 10;
  const fs = 11;
  for (let v = lo; v <= hi; v += step) {
    const major = v % lab === 0 || v === lo;
    const mid = v % 5 === 0;
    s += `<line class="tick ${major ? 'm' : ''}" x1="${x(v)}" x2="${x(v)}" y1="30" y2="${30 - (major ? 16 : mid ? 10 : 5)}"/>`;
    if (v % lab === 0) s += `<text x="${x(v)}" y="${30 + fs + 4}" style="font-size:${fs}px" text-anchor="middle">${v}</text>`;
  }
  if (cm) {
    const c = Math.max(lo, Math.min(hi, cm));
    s += `<path class="pin" d="M${x(c)} 30 l-7 -14 h14 z"/>`;
    if (cm < lo) s += `<text class="over" x="${x(lo) + 10}" y="12">&lt;${lo}</text>`;
    if (cm > hi) s += `<text class="over" x="${x(hi) - 10}" y="12" text-anchor="end">&gt;${hi}</text>`;
  }
  sv.innerHTML = s;
}

/** Conditions that apply to a game's conversion, shown next to its row (any direction). */
function caveatNote(game) {
  if (!game.caveat || !game.caveat[LANG]) return '';
  return `<details class="cav"><summary>${t('common.caveat')}</summary>${esc(game.caveat[LANG])}</details>`;
}

function sourceText(game) {
  const n = game.sources.length;
  return n === 1 ? t('status.sourceOne') : t('status.sourceMany', { n });
}

function statusText(game) {
  const verified = game.inGameVerified ? game.inGameVerified.date : t('status.unverified');
  return verified + ' · ' + sourceText(game);
}

function calc() {
  const id = $('g').value;
  const dpi = Number($('dpi').value);
  const sens = Number($('sens').value);
  const toDpi = Number($('dpi2').value);
  const game = byId.get(id);
  const eDpi = validateDpi(dpi);
  const eSens = validateSens(sens);
  const eDpi2 = validateDpi(toDpi);
  setErr('fDpi', 'eDpi', eDpi ? ERR_MESSAGES[eDpi] : '');
  setErr('fSens', 'eSens', eSens ? ERR_MESSAGES[eSens] : '');
  setErr('fDpi2', 'eDpi2', eDpi2 ? ERR_MESSAGES[eDpi2] : '');
  const ok = !eDpi && !eSens && !eDpi2 && !!game;
  $('big').classList.toggle('void', !ok);
  const warn = $('warn');
  const notes = [];
  if (game && game.sources.length === 1) notes.push(t('convert.warnOne', { game: esc(game.name[LANG]) }));
  if (game && game.caveat && game.caveat[LANG]) notes.push(`<b>${esc(game.name[LANG])}</b> ${esc(game.caveat[LANG])}`);
  warn.hidden = notes.length === 0;
  warn.innerHTML = notes.join('<br>');
  if (!ok) {
    $('cm').textContent = '--';
    $('half').textContent = '--';
    $('edpi').textContent = '--';
    ruler(0);
    $('rows').innerHTML = `<tr><td colspan="5" class="g" style="color:var(--ink-3);padding-block:28px">${t('convert.fixPrompt')}</td></tr>`;
    return;
  }
  const result = convert(id, dpi, sens, toDpi, games);
  const cm = result.cm;
  $('cm').textContent = cm.toFixed(1);
  $('half').textContent = (cm / 2).toFixed(1) + ' cm';
  $('edpi').textContent = String(+(dpi * sens).toFixed(2));
  ruler(cm);
  $('dpiNote').textContent = t('convert.dpiNote', { dpi: toDpi });
  $('rows').innerHTML = result.rows.map((row) => {
    const g = byId.get(row.id);
    const one = g.sources.length === 1;
    const st = statusText(g);
    const off = Math.abs(row.errPct) > TOLERANCE_PCT;
    let offNote = '';
    if (off) {
      const alt = altDpi(cm, g.yaw, g.decimals, toDpi);
      const fmt = (v) => (v > 0 ? '+' : '') + v.toFixed(1);
      offNote = `<span class="off">${t('convert.offTarget', { err: fmt(row.errPct) })} · ${alt ? t('convert.offTargetAlt', { dpi: alt.dpi, sens: alt.sens.toFixed(g.decimals), err: fmt(alt.errPct) }) : t('convert.offTargetNone')}</span>`;
    }
    return `<tr class="${row.id === id ? 'from' : ''}${off ? ' offrow' : ''}"><td class="g">${esc(g.name[LANG])}<span class="st-m ${one ? 'one' : ''}">${st}</span>${offNote}${caveatNote(g)}</td><td class="s">${row.sens.toFixed(g.decimals)}</td><td class="hide-m">${row.edpi}</td><td class="hide-m">${g.yaw}</td><td class="hide-m"><span class="st ${one ? 'one' : ''}">${st}</span></td></tr>`;
  }).join('');
}

function syncUrl() {
  const params = new URLSearchParams();
  params.set('g', $('g').value);
  params.set('dpi', $('dpi').value);
  params.set('s', $('sens').value);
  params.set('to', $('dpi2').value);
  history.replaceState(null, '', location.pathname + '?' + params.toString());
}

function update() {
  calc();
  syncUrl();
}

function readParam(params, key, fallback) {
  const v = params.get(key);
  return v === null || v === '' ? fallback : v;
}

async function init() {
  const res = await fetch('/data/games.json');
  games = await res.json();
  byId = new Map(games.map((g) => [g.id, g]));
  const params = new URLSearchParams(location.search);
  const wanted = readParam(params, 'g', 'ow');
  const selected = byId.has(wanted) ? wanted : (games[0] ? games[0].id : 'ow');
  $('g').innerHTML = games.map((g) => `<option value="${esc(g.id)}">${esc(g.name[LANG])}</option>`).join('');
  $('g').value = selected;
  $('dpi').value = readParam(params, 'dpi', '800');
  $('sens').value = readParam(params, 's', '4');
  $('dpi2').value = readParam(params, 'to', '800');
  update();
  ['g', 'dpi', 'sens', 'dpi2'].forEach((id) => $(id).addEventListener('input', update));
  $('more').addEventListener('click', (e) => {
    const open = document.querySelector('.games').classList.toggle('open');
    e.currentTarget.setAttribute('aria-expanded', open ? 'true' : 'false');
    e.currentTarget.textContent = open ? t('convert.less') : t('convert.more');
  });
  addEventListener('resize', calc);
  addEventListener('themechange', calc);
}

init();
