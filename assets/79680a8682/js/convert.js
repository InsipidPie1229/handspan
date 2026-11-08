import { cm360, convertCm, validateDpi, validateSens, validateCm, altDpi, TOLERANCE_PCT, CM_MIN, CM_MAX } from './lib/sens.js';
import { parseState, serializeState, createProfiles, createCustomGames, yawFromMeasurement, MAX_NAME } from './lib/convertState.js';

const I18N = JSON.parse(document.getElementById('i18n').textContent);
const LANG = document.documentElement.lang;
const $ = (id) => document.getElementById(id);
let games = [];
let byId = new Map();
let mode = 'sens';
let lastCm = NaN;
const profiles = createProfiles(() => window.localStorage);
const customs = createCustomGames(() => window.localStorage);
let baseGames = [];

function t(key, vars = {}) {
  const text = I18N[key] ?? key;
  return text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

const ERR_MESSAGES = {
  'err.dpi': t('err.dpi'),
  'err.sens': t('err.sens'),
  'err.dpiRange': t('err.dpiRange'),
  'err.cm': t('err.cm', { min: CM_MIN, max: CM_MAX }),
  'err.sensRange': t('err.sensRange', { min: CM_MIN, max: CM_MAX })
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
  if (game.custom) return t('status.custom');
  if (game.experimental) return t('status.experimental');
  const verified = game.inGameVerified ? game.inGameVerified.date : t('status.unverified');
  return verified + ' · ' + sourceText(game);
}

function calc() {
  const id = $('g').value;
  const toDpi = Number($('dpi2').value);
  const game = byId.get(id);
  const eDpi2 = validateDpi(toDpi);
  setErr('fDpi2', 'eDpi2', eDpi2 ? ERR_MESSAGES[eDpi2] : '');
  let cm = NaN;
  let ok = !eDpi2;
  let dpi = NaN;
  let sens = NaN;
  if (mode === 'cm') {
    cm = Number($('cmIn').value);
    const eCm = validateCm(cm);
    setErr('fCm', 'eCm', eCm ? ERR_MESSAGES[eCm] : '');
    ok = ok && !eCm;
  } else {
    dpi = Number($('dpi').value);
    sens = Number($('sens').value);
    const eDpi = validateDpi(dpi);
    let eSens = validateSens(sens);
    if (!eDpi && !eSens && game) {
      cm = cm360(dpi, sens, game.yaw);
      // Extreme sensitivities give cm/360 outside any usable range (or Infinity): reject them.
      if (validateCm(cm)) eSens = 'err.sensRange';
    }
    setErr('fDpi', 'eDpi', eDpi ? ERR_MESSAGES[eDpi] : '');
    setErr('fSens', 'eSens', eSens ? ERR_MESSAGES[eSens] : '');
    ok = ok && !eDpi && !eSens && !!game;
  }
  $('big').classList.toggle('void', !ok);
  const warn = $('warn');
  const notes = [];
  if (mode === 'sens' && game && !game.custom && game.sources.length === 1) notes.push(t('convert.warnOne', { game: esc(game.name[LANG]) }));
  if (mode === 'sens' && game && game.caveat && game.caveat[LANG]) notes.push(`<b>${esc(game.name[LANG])}</b> ${esc(game.caveat[LANG])}`);
  warn.hidden = notes.length === 0;
  warn.innerHTML = notes.join('<br>');
  lastCm = ok ? cm : NaN;
  if (!ok) {
    $('cm').textContent = '--';
    $('half').textContent = '--';
    $('edpi').textContent = '--';
    ruler(0);
    $('rows').innerHTML = `<tr><td colspan="5" class="g" style="color:var(--ink-3);padding-block:28px">${t('convert.fixPrompt')}</td></tr>`;
    return;
  }
  const result = convertCm(cm, toDpi, games);
  $('cm').textContent = cm.toFixed(1);
  $('half').textContent = (cm / 2).toFixed(1) + ' cm';
  $('edpi').textContent = mode === 'cm' ? '--' : String(+(dpi * sens).toFixed(2));
  ruler(cm);
  $('dpiNote').textContent = t('convert.dpiNote', { dpi: toDpi });
  $('rows').innerHTML = result.rows.map((row) => {
    const g = byId.get(row.id);
    const one = !g.custom && g.sources.length === 1;
    const st = statusText(g);
    const off = !row.unrounded && Math.abs(row.errPct) > TOLERANCE_PCT;
    let offNote = '';
    if (off) {
      const alt = altDpi(cm, g.yaw, g.decimals, toDpi);
      const fmt = (v) => (v > 0 ? '+' : '') + v.toFixed(1);
      offNote = `<span class="off">${t('convert.offTarget', { err: fmt(row.errPct) })} · ${alt ? t('convert.offTargetAlt', { dpi: alt.dpi, sens: alt.sens.toFixed(g.decimals), err: fmt(alt.errPct) }) : t('convert.offTargetNone')}</span>`;
    }
    return `<tr data-name="${esc(g.name[LANG].toLowerCase())}" class="${mode === 'sens' && row.id === id ? 'from' : ''}${off ? ' offrow' : ''}"><td class="g">${esc(g.name[LANG])}<span class="st-m ${one ? 'one' : ''}">${st}</span>${offNote}${caveatNote(g)}</td><td class="s">${row.unrounded ? fmtExact(row.sens) : row.sens.toFixed(g.decimals)}${row.unrounded ? `<span class="st-m unr">${t('convert.stepUnverified')}</span>` : ''}</td><td class="hide-m">${row.edpi}</td><td class="hide-m">${g.yaw}</td><td class="hide-m"><span class="st ${one ? 'one' : ''}">${st}</span></td></tr>`;
  }).join('');
  applyFilter();
}

function fmtExact(v) {
  return String(+v.toPrecision(4));
}

function applyFilter() {
  const q = $('filter').value.trim().toLowerCase();
  let shown = 0;
  for (const tr of $('rows').querySelectorAll('tr[data-name]')) {
    // The source game's row always stays visible.
    const match = !q || tr.dataset.name.includes(q);
    tr.classList.toggle('hiddenrow', !match && !tr.classList.contains('from'));
    if (match) shown++;
  }
  $('filterNone').hidden = !q || shown > 0;
}

function loadGames() {
  const { list, status: st } = customs.load();
  const custom = list.map((c) => ({
    id: c.id, name: { ko: c.name, en: c.name }, yaw: c.yaw, decimals: 3, sources: [], custom: true, stepUnverified: true,
    caveat: { [LANG]: t('convert.customCaveat', { dpi: c.measured.dpi, sens: c.measured.sens, cm: c.measured.cm }) },
  }));
  games = [...baseGames, ...custom];
  byId = new Map(games.map((g) => [g.id, g]));
  const cur = $('g').value;
  $('g').innerHTML = games.map((g) => `<option value="${esc(g.id)}">${esc(g.name[LANG])}${g.custom ? ' · ' + esc(t('status.custom')) : ''}</option>`).join('');
  if (byId.has(cur)) $('g').value = cur;
  const ul = $('customList');
  ul.textContent = '';
  for (const c of list) {
    const li = document.createElement('li');
    const b = document.createElement('b');
    b.textContent = c.name;
    const yaw = document.createElement('span');
    yaw.textContent = t('convert.customMeasured', { dpi: c.measured.dpi, sens: c.measured.sens, cm: c.measured.cm, yaw: +c.yaw.toPrecision(5) });
    const del = document.createElement('button');
    del.type = 'button';
    del.textContent = t('convert.profDel');
    del.addEventListener('click', () => {
      const r = customs.remove(c.id);
      $('customStatus').textContent = r.ok ? t('convert.customDeleted', { name: c.name }) : PROFILE_ERRORS[r.error]();
      loadGames();
      update();
    });
    li.append(b, yaw, del);
    ul.append(li);
  }
  $('cAdd').disabled = st === 'unavailable';
  if (st === 'unavailable') $('customStatus').textContent = t('convert.profUnavailable');
}

function setupCustom() {
  $('cName').maxLength = MAX_NAME;
  $('customForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const measured = { dpi: Number($('cDpi').value), sens: Number($('cSens').value), cm: Number($('cCm').value) };
    if (yawFromMeasurement(measured.dpi, measured.sens, measured.cm) === null) { $('customStatus').textContent = t('convert.customErr'); return; }
    const r = customs.add($('cName').value, measured);
    if (!r.ok) { $('customStatus').textContent = PROFILE_ERRORS[r.error](); return; }
    $('cName').value = '';
    $('customStatus').textContent = t('convert.customAdded', { name: r.item.name });
    loadGames();
    update();
  });
  $('filter').addEventListener('input', applyFilter);
}

function readState() {
  const st = { mode, g: $('g').value, dpi: $('dpi').value, s: $('sens').value, to: $('dpi2').value, cm: $('cmIn').value };
  // A game measured in this browser does not exist elsewhere: save and share its distance instead.
  const game = byId.get(st.g);
  if (mode === 'sens' && game && game.custom && Number.isFinite(lastCm)) return { ...st, mode: 'cm', cm: String(lastCm) };
  return st;
}

function syncUrl() {
  history.replaceState(null, '', location.pathname + '?' + serializeState(readState()));
}

function setMode(next) {
  mode = next === 'cm' ? 'cm' : 'sens';
  document.querySelectorAll('#modeSeg button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.mode === mode ? 'true' : 'false'));
  ['fG', 'fDpi', 'fSens'].forEach((f) => { $(f).hidden = mode === 'cm'; });
  $('fCm').hidden = mode !== 'cm';
}

function applyState(st) {
  $('g').value = st.g;
  $('dpi').value = st.dpi;
  $('sens').value = st.s;
  $('dpi2').value = st.to;
  $('cmIn').value = st.cm;
  setMode(st.mode);
}

function update() {
  calc();
  syncUrl();
}

let statusTimer = 0;
function status(msg) {
  const el = $('profStatus');
  el.textContent = msg;
  clearTimeout(statusTimer);
  if (msg) statusTimer = setTimeout(() => { el.textContent = ''; }, 6000);
}

function renderProfiles(selected) {
  const { list, status: st } = profiles.load();
  const sel = $('profList');
  sel.textContent = '';
  const first = document.createElement('option');
  first.value = '';
  first.textContent = list.length ? t('convert.profPick') : t('convert.profEmpty');
  sel.append(first);
  for (const p of list) {
    const o = document.createElement('option');
    o.value = p.name;
    o.textContent = p.name;
    sel.append(o);
  }
  sel.value = list.some((p) => p.name === selected) ? selected : '';
  const unavailable = st === 'unavailable';
  ['profName', 'profSave', 'profList', 'profLoad', 'profDel'].forEach((id) => { $(id).disabled = unavailable; });
  $('profNote').textContent = unavailable ? t('convert.profUnavailable') : st === 'corrupt' ? t('convert.profCorrupt') : '';
  return list;
}

const PROFILE_ERRORS = {
  name: () => t('convert.profErrName', { max: MAX_NAME }),
  full: () => t('convert.profErrFull'),
  quota: () => t('convert.profErrQuota'),
  unavailable: () => t('convert.profUnavailable')
};

function setupProfiles() {
  $('profName').maxLength = MAX_NAME;
  renderProfiles('');
  $('profForm').addEventListener('submit', (e) => {
    e.preventDefault();
    if (!Number.isFinite(lastCm)) return status(t('convert.profErrInvalid'));
    const r = profiles.save($('profName').value, serializeState(readState()));
    if (!r.ok) return status(PROFILE_ERRORS[r.error]());
    $('profName').value = '';
    renderProfiles(r.name);
    status(t('convert.profSaved', { name: r.name }));
  });
  $('profLoad').addEventListener('click', () => {
    const name = $('profList').value;
    const p = renderProfiles(name).find((x) => x.name === name);
    if (!p) return status(t('convert.profPick'));
    const st = parseState(p.q, games.map((g) => g.id), $('g').value);
    applyState(st);
    update();
    status(st.missing ? t('convert.missingGame') : t('convert.profLoaded', { name: p.name }));
  });
  $('profDel').addEventListener('click', () => {
    const name = $('profList').value;
    if (!name) return status(t('convert.profPick'));
    const r = profiles.remove(name);
    if (!r.ok) return status(PROFILE_ERRORS[r.error]());
    renderProfiles('');
    status(t('convert.profDeleted', { name }));
  });
  $('share').addEventListener('click', async () => {
    if (!Number.isFinite(lastCm)) return status(t('convert.profErrInvalid'));
    syncUrl();
    const url = location.href;
    try {
      await navigator.clipboard.writeText(url);
      status(t('convert.shareCopied'));
    } catch {
      const box = $('shareBox');
      box.hidden = false;
      box.value = url;
      box.focus();
      box.select();
      status(t('convert.shareManual'));
    }
  });
}

async function init() {
  const res = await fetch('/handspan/data/79680a8682/games.json');
  baseGames = await res.json();
  loadGames();
  setupCustom();
  const st0 = parseState(location.search, games.map((g) => g.id));
  applyState(st0);
  update();
  if (st0.missing) { $('warn').hidden = false; $('warn').textContent = t('convert.missingGame'); }
  ['g', 'dpi', 'sens', 'dpi2', 'cmIn'].forEach((id) => $(id).addEventListener('input', update));
  document.querySelectorAll('#modeSeg button').forEach((b) => b.addEventListener('click', () => {
    // Carry the current distance over so switching to cm mode keeps the same target.
    if (b.dataset.mode === 'cm' && mode === 'sens') {
      // Full precision: a rounded value can move a row across a rounding boundary.
      if (Number.isFinite(lastCm)) $('cmIn').value = String(lastCm);
    }
    setMode(b.dataset.mode);
    update();
  }));
  setupProfiles();
  $('more').addEventListener('click', (e) => {
    const open = document.querySelector('.games').classList.toggle('open');
    e.currentTarget.setAttribute('aria-expanded', open ? 'true' : 'false');
    e.currentTarget.textContent = open ? t('convert.less') : t('convert.more');
  });
  addEventListener('resize', calc);
  addEventListener('themechange', calc);
}

init();
