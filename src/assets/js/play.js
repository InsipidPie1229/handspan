import {
  AREAS, TABLES, RULES_VERSION, MEMORY_MAX, scoreAll, totalScore, gameAge, gamerType, median, mean, rng,
  memorySequence, encodeResult, decodeResult, quantize, createTimingRun,
} from './lib/physical.js';

const I18N = JSON.parse(document.getElementById('i18n').textContent);
const LANG = document.documentElement.lang;
const $ = (id) => document.getElementById(id);
function t(key, vars = {}) {
  const text = I18N[key] ?? key;
  return text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

const arena = $('arena');
const stage = $('stage');
const layer = $('layer');
const panel = $('panel');
const now = () => performance.now();

const NAMES = {
  reaction: t('play.reactionName'), aim: t('play.aimName'), track: t('play.trackName'),
  timing: t('play.timingName'), color: t('play.colorName'), memory: t('play.memoryName'),
};
const HOWTO = {
  reaction: t('play.reactionHow'), aim: t('play.aimHow'), track: t('play.trackHow'),
  timing: t('play.timingHow'), color: t('play.colorHow'), memory: t('play.memoryHow'),
};
const TYPES = {
  reaction: [t('play.typeReaction'), t('play.typeReactionDesc')],
  aim: [t('play.typeAim'), t('play.typeAimDesc')],
  track: [t('play.typeTrack'), t('play.typeTrackDesc')],
  timing: [t('play.typeTiming'), t('play.typeTimingDesc')],
  color: [t('play.typeColor'), t('play.typeColorDesc')],
  memory: [t('play.typeMemory'), t('play.typeMemoryDesc')],
  allround: [t('play.typeAllround'), t('play.typeAllroundDesc')],
  relaxed: [t('play.typeRelaxed'), t('play.typeRelaxedDesc')],
};
const INPUT_NAMES = {
  mouse: t('play.inputMouse'), touch: t('play.inputTouch'), pen: t('play.inputPen'),
  keyboard: t('play.inputKeyboard'), mixed: t('play.inputMixed'),
};

// ---- run state -----------------------------------------------------------------------------
let run = null; // { idx, raw, inputs:Set, ctrl:AbortController }
const inputs = new Set();

function noteInput(e) {
  if (e.type.startsWith('key')) inputs.add('keyboard');
  else if (e.pointerType) inputs.add(e.pointerType);
}

function inputKind() {
  const pointer = [...inputs].filter((x) => x !== 'keyboard');
  if (pointer.length === 1 && !inputs.has('keyboard')) return pointer[0] === 'pen' ? 'pen' : pointer[0] === 'touch' ? 'touch' : 'mouse';
  if (pointer.length === 0 && inputs.has('keyboard')) return 'keyboard';
  return inputs.size ? 'mixed' : 'mouse';
}

/** Timers and listeners bound to one test attempt; abort() cancels all of them. */
function scope(signal) {
  return {
    signal,
    later(fn, ms) {
      const id = setTimeout(() => { if (!signal.aborted) fn(); }, ms);
      signal.addEventListener('abort', () => clearTimeout(id), { once: true });
    },
    frame(fn) {
      let id = 0;
      const loop = (ts) => { if (signal.aborted) return; if (fn(ts) !== false) id = requestAnimationFrame(loop); };
      id = requestAnimationFrame(loop);
      signal.addEventListener('abort', () => cancelAnimationFrame(id), { once: true });
    },
    on(target, type, fn, opts = {}) {
      target.addEventListener(type, fn, { ...opts, signal });
    },
  };
}

function showPanel(html, buttons) {
  panel.innerHTML = html;
  const row = document.createElement('div');
  row.className = 'row';
  for (const [label, fn, go] of buttons) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn' + (go ? ' go' : '');
    b.textContent = label;
    b.addEventListener('click', fn, { once: true });
    row.append(b);
  }
  panel.append(row);
  layer.hidden = false;
  row.querySelector('button')?.focus();
}

function esc(v) {
  return String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function hud(info) {
  $('hud').hidden = false;
  $('steps').innerHTML = AREAS.map((k, i) => `<i class="${i < run.idx ? 'done' : i === run.idx ? 'on' : ''}"></i>`).join('');
  $('hudName').textContent = `${run.idx + 1}/${AREAS.length} · ${NAMES[AREAS[run.idx]]}`;
  $('hudInfo').textContent = info ?? '';
}

// The address bar only ever carries the result on screen: drop any older ?r= when it no longer applies.
function clearResultParam() {
  if (location.search) history.replaceState(null, '', location.pathname);
}

function startRun() {
  clearResultParam();
  inputs.clear();
  run = { idx: 0, raw: {}, ctrl: null };
  $('result').hidden = true;
  intro();
}

function intro() {
  const key = AREAS[run.idx];
  stage.innerHTML = '';
  hud('');
  showPanel(`<h2>${esc(NAMES[key])}</h2><p>${esc(HOWTO[key])}</p>`, [[t('play.go'), () => begin(key), true]]);
}

function begin(key) {
  layer.hidden = true;
  run.ctrl = new AbortController();
  const s = scope(run.ctrl.signal);
  s.on(arena, 'pointerdown', noteInput, { capture: true });
  s.on(window, 'keydown', noteInput, { capture: true });
  TESTS[key](s, (raw) => {
    run.ctrl.abort();
    run.raw[key] = raw;
    run.idx++;
    if (run.idx < AREAS.length) intro();
    else finish();
  });
}

/** Leaving the tab or window invalidates the current attempt; the user restarts it. */
function interrupt() {
  if (!run || !run.ctrl || run.ctrl.signal.aborted) return;
  run.ctrl.abort();
  stage.innerHTML = '';
  showPanel(`<h2>${esc(t('play.pausedH'))}</h2><p>${esc(t('play.pausedBody'))}</p>`, [[t('play.resume'), () => begin(AREAS[run.idx]), true]]);
}
document.addEventListener('visibilitychange', () => { if (document.hidden) interrupt(); });
window.addEventListener('blur', interrupt);

function msg(html) {
  let el = stage.querySelector('.msg');
  if (!el) { el = document.createElement('div'); el.className = 'msg'; stage.append(el); }
  el.innerHTML = html;
}

function rect() {
  return stage.getBoundingClientRect();
}

// ---- tests ---------------------------------------------------------------------------------
const TESTS = {
  reaction(s, done) {
    const PRACTICE = 2;
    const VALID = 7;
    const times = [];
    let trial = 0;
    let falseStarts = 0;
    let state = 'idle';
    let shownAt = 0;
    let goTimer = 0;
    s.signal.addEventListener('abort', () => clearTimeout(goTimer), { once: true });
    const box = document.createElement('div');
    box.className = 'reactbox';
    stage.append(box);
    const label = () => (trial < PRACTICE ? t('play.practice', { n: trial + 1, of: PRACTICE }) : t('play.trial', { n: trial - PRACTICE + 1, of: VALID }));
    function next() {
      state = 'wait';
      box.className = 'reactbox';
      box.textContent = t('play.reactionWait');
      hud(label());
      goTimer = setTimeout(() => {
        if (s.signal.aborted || state !== 'wait') return;
        state = 'go';
        box.className = 'reactbox go';
        box.textContent = t('play.reactionNow');
        shownAt = now();
      }, 1200 + Math.random() * 2300);
    }
    function press(e) {
      if (e.type === 'keydown' && (e.repeat || e.code !== 'Space')) return;
      if (e.type === 'keydown') e.preventDefault();
      if (state === 'wait') {
        // Too early: cancel the pending signal and redo this attempt.
        clearTimeout(goTimer);
        falseStarts++;
        state = 'early';
        box.textContent = t('play.tooEarly');
        s.later(next, 1000);
        return;
      }
      if (state !== 'go') return;
      const rt = (e.timeStamp || now()) - shownAt;
      state = 'shown';
      if (rt > 1500) {
        // Far too late to be a reaction (looked away): redo this attempt.
        box.textContent = t('play.tooLate');
        s.later(next, 1000);
        return;
      }
      if (trial >= PRACTICE) times.push(rt);
      box.className = 'reactbox';
      box.textContent = `${Math.round(rt)} ms`;
      trial++;
      if (times.length >= VALID) s.later(() => done({ medianMs: median(times), n: times.length, falseStarts }), 700);
      else s.later(next, 900);
    }
    s.on(stage, 'pointerdown', press);
    s.on(window, 'keydown', press);
    next();
  },

  aim(s, done) {
    const HITS = 15;
    const R = 22;
    let hits = 0;
    let misses = 0;
    let firstAt = 0;
    let lastAt = 0;
    let target = null;
    const el = document.createElement('div');
    el.className = 'tgt';
    el.style.width = el.style.height = `${R * 2}px`;
    stage.append(el);
    function place() {
      const r = rect();
      const m = R + 50;
      target = { x: m + Math.random() * Math.max(1, r.width - 2 * m), y: m + Math.random() * Math.max(1, r.height - 2 * m) };
      el.style.left = `${target.x}px`;
      el.style.top = `${target.y}px`;
      hud(t('play.aimInfo', { n: hits, of: HITS }));
    }
    s.on(stage, 'pointerdown', (e) => {
      const r = rect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      if (Math.hypot(x - target.x, y - target.y) <= R) {
        const at = e.timeStamp || now();
        if (hits === 0) firstAt = at;
        lastAt = at;
        hits++;
        if (hits >= HITS) {
          // Time per target is measured from the first hit, so the reading time of the intro is excluded.
          done({ meanMs: (lastAt - firstAt) / (HITS - 1), hitRate: hits / (hits + misses), hits, misses });
          return;
        }
        place();
      } else if (hits > 0) misses++;
    });
    place();
  },

  track(s, done) {
    const DURATION = 15000;
    const R = 30;
    const el = document.createElement('div');
    el.className = 'tgt track';
    el.style.width = el.style.height = `${R * 2}px`;
    stage.append(el);
    // inside: the pointer is over the arena with a known position. Leaving or cancelling clears it.
    const p = { x: 0, y: 0, down: false, inside: false, type: 'mouse' };
    const ph = [Math.random() * 6, Math.random() * 6, Math.random() * 6, Math.random() * 6];
    let start = 0;
    let last = 0;
    let on = 0;
    s.on(stage, 'pointermove', (e) => { const r = rect(); p.x = e.clientX - r.left; p.y = e.clientY - r.top; p.type = e.pointerType; p.inside = true; });
    s.on(stage, 'pointerdown', (e) => { const r = rect(); p.x = e.clientX - r.left; p.y = e.clientY - r.top; p.down = true; p.type = e.pointerType; p.inside = true; });
    s.on(stage, 'pointerup', () => { p.down = false; });
    for (const ev of ['pointercancel', 'pointerleave']) s.on(stage, ev, () => { p.down = false; p.inside = false; });
    msg(t('play.trackGetReady'));
    s.later(() => {
      msg('');
      s.frame((ts) => {
        if (!start) { start = ts; last = ts; }
        const el2 = ts - start;
        const tt = el2 / 1000;
        const r = rect();
        const cx = r.width / 2 + (r.width / 2 - R - 20) * (0.6 * Math.sin(tt * 0.9 + ph[0]) + 0.4 * Math.sin(tt * 1.7 + ph[1]));
        const cy = r.height / 2 + (r.height / 2 - R - 40) * (0.6 * Math.sin(tt * 0.7 + ph[2]) + 0.4 * Math.sin(tt * 1.3 + ph[3]));
        el.style.left = `${cx}px`;
        el.style.top = `${cy}px`;
        // Touch counts only while the finger is down; a lifted or cancelled touch is never "on".
        const active = p.inside && (p.type === 'touch' ? p.down : true);
        const isOn = active && Math.hypot(p.x - cx, p.y - cy) <= R;
        el.classList.toggle('on', isOn);
        const dt = Math.min(ts - last, 100);
        if (isOn) on += dt;
        last = ts;
        hud(t('play.trackInfo', { s: Math.max(0, Math.ceil((DURATION - el2) / 1000)) }));
        if (el2 >= DURATION) {
          done({ pct: (on / DURATION) * 100 });
          return false;
        }
        return true;
      });
    }, 1500);
  },

  timing(s, done) {
    const TRIALS = 5;
    const tr = createTimingRun({ trials: TRIALS, sweep: 1400 });
    const bar = document.createElement('div');
    bar.className = 'bar';
    bar.innerHTML = '<div class="zone"></div><div class="needle"></div>';
    stage.append(bar);
    const zone = bar.querySelector('.zone');
    const needle = bar.querySelector('.needle');
    function next() {
      const frac = 0.55 + Math.random() * 0.3;
      zone.style.left = `${frac * 100}%`;
      needle.style.left = '0%';
      hud(t('play.trial', { n: tr.round + 1, of: TRIALS }));
      let started = false;
      s.frame((ts) => {
        if (!started) { started = tr.start(ts, frac); if (!started) return false; }
        if (tr.state !== 'running') return false;
        needle.style.left = `${Math.min(1, tr.progress(ts)) * 100}%`;
        const r = tr.tick(ts);
        if (r) { after(r); return false; }
        return true;
      });
    }
    function after(r) {
      // Runs exactly once per round: the core ignores any later press or tick for that round.
      if (!r.missed) {
        msg(`${r.err > 0 ? '+' : ''}${Math.round(r.err)} ms`);
        s.later(() => msg(''), 700);
      }
      if (r.done) s.later(() => done(tr.result()), 700);
      else s.later(next, 800);
    }
    function press(e) {
      if (e.type === 'keydown' && (e.repeat || e.code !== 'Space')) return;
      if (e.type === 'keydown') e.preventDefault();
      const r = tr.press(e.timeStamp || now());
      if (r) after(r);
    }
    s.on(stage, 'pointerdown', press);
    s.on(window, 'keydown', press);
    next();
  },

  color(s, done) {
    const TRIALS = 16;
    const COLORS = [
      ['red', '#E5534B', t('play.cRed')], ['blue', '#4C8DF6', t('play.cBlue')],
      ['green', '#3FB76F', t('play.cGreen')], ['yellow', '#F2C230', t('play.cYellow')],
    ];
    let trial = 0;
    let correct = 0;
    const rts = [];
    let shownAt = 0;
    let answer = '';
    let locked = true;
    const word = document.createElement('div');
    word.className = 'word';
    const choices = document.createElement('div');
    choices.className = 'choices';
    choices.innerHTML = COLORS.map(([id, , name], i) => `<button type="button" data-c="${id}">${esc(name)}<kbd>${i + 1}</kbd></button>`).join('');
    stage.append(word, choices);
    function next() {
      const ink = COLORS[Math.floor(Math.random() * 4)];
      // About a quarter of trials match, the rest conflict.
      const text = Math.random() < 0.25 ? ink : COLORS.filter((c) => c !== ink)[Math.floor(Math.random() * 3)];
      word.textContent = text[2];
      word.style.color = ink[1];
      answer = ink[0];
      shownAt = now();
      locked = false;
      hud(t('play.trial', { n: trial + 1, of: TRIALS }));
    }
    function pick(id, e) {
      if (locked) return;
      locked = true;
      const rt = (e.timeStamp || now()) - shownAt;
      if (id === answer) { correct++; rts.push(rt); }
      trial++;
      word.textContent = '';
      if (trial >= TRIALS) done({ medianMs: correct ? median(rts) : NaN, accuracy: correct / TRIALS, correct, n: TRIALS });
      else s.later(next, 350);
    }
    s.on(choices, 'pointerdown', (e) => {
      const b = e.target.closest('button');
      if (b) { e.preventDefault(); pick(b.dataset.c, e); }
    });
    s.on(window, 'keydown', (e) => {
      if (e.repeat) return;
      const i = Number(e.key) - 1;
      if (i >= 0 && i < 4) pick(COLORS[i][0], e);
    });
    s.later(next, 600);
  },

  memory(s, done) {
    const rand = rng((Math.random() * 2 ** 32) >>> 0);
    const seq = memorySequence(rand, MEMORY_MAX);
    let len = 3;
    let pos = 0;
    let longest = 0;
    let accepting = false;
    const grid = document.createElement('div');
    grid.className = 'grid9';
    grid.innerHTML = Array.from({ length: 9 }, (_, i) => `<button type="button" data-i="${i}" aria-label="${i + 1}"></button>`).join('');
    stage.append(grid);
    const cells = [...grid.children];
    function show() {
      accepting = false;
      pos = 0;
      hud(t('play.memoryInfo', { n: len }));
      msg(`<small>${esc(t('play.memoryWatch'))}</small>`);
      seq.slice(0, len).forEach((c, i) => {
        s.later(() => cells[c].classList.add('lit'), 700 + i * 650);
        s.later(() => cells[c].classList.remove('lit'), 700 + i * 650 + 420);
      });
      s.later(() => { accepting = true; msg(`<small>${esc(t('play.memoryYour'))}</small>`); }, 700 + len * 650);
    }
    s.on(grid, 'pointerdown', (e) => {
      const b = e.target.closest('button');
      if (!b || !accepting) return;
      e.preventDefault();
      const i = Number(b.dataset.i);
      if (i === seq[pos]) {
        b.classList.add('lit');
        s.later(() => b.classList.remove('lit'), 160);
        pos++;
        if (pos === len) {
          longest = len;
          accepting = false;
          if (len >= MEMORY_MAX) { s.later(() => done({ longest }), 500); return; }
          len++;
          s.later(show, 700);
        }
      } else {
        accepting = false;
        b.classList.add('bad');
        s.later(() => done({ longest }), 800);
      }
    });
    show();
  },
};

// ---- result --------------------------------------------------------------------------------
function finish() {
  $('hud').hidden = true;
  stage.innerHTML = '';
  const kind = inputKind();
  showPanel(`<h2>${esc(t('play.doneH'))}</h2><p>${esc(t('play.doneBody'))}</p>`, [[t('play.again'), startRun, false]]);
  const r = run.raw;
  const measured = {
    ...r,
    meta: {
      falseStarts: r.reaction.falseStarts, aimHits: r.aim.hits, aimMisses: r.aim.misses,
      timingN: r.timing.n, timingMisses: r.timing.misses, colorCorrect: r.color.correct, colorN: r.color.n,
    },
  };
  // Score exactly what the share link carries, so the page, link and card always agree.
  let shown = null;
  try { shown = quantize(measured, kind); } catch { shown = null; }
  if (shown) {
    const code = encodeResult(shown.raw, kind);
    render(shown.raw, kind, false, code);
    history.replaceState(null, '', location.pathname + '?r=' + code);
  } else {
    clearResultParam();
    render(measured, kind, false, null);
  }
  $('result').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function fmtRaw(key, raw) {
  const m = raw.meta;
  const na = t('play.noInfo');
  switch (key) {
    case 'reaction': return t('play.rawReaction', { ms: Math.round(raw.reaction.medianMs), n: raw.reaction.n, fs: m ? m.falseStarts : na });
    case 'aim': return t('play.rawAim', { ms: Math.round(raw.aim.meanMs), pct: Math.round(raw.aim.hitRate * 100), hits: m ? m.aimHits : na, misses: m ? m.aimMisses : na });
    case 'track': return t('play.rawTrack', { pct: Math.round(raw.track.pct) });
    case 'timing': return t('play.rawTiming', { ms: Math.round(raw.timing.meanErrMs), miss: m ? m.timingMisses : na, n: m ? m.timingN : na });
    case 'color': {
      const cnt = m ? `${m.colorCorrect}/${m.colorN}` : na;
      return raw.color.accuracy > 0
        ? t('play.rawColor', { ms: Math.round(raw.color.medianMs), pct: Math.round(raw.color.accuracy * 100), cnt })
        : t('play.rawColorNone', { cnt });
    }
    default: return t('play.rawMemory', { n: raw.memory.longest });
  }
}

let current = null;

/** code: the share code for this result (null when it cannot be shared). */
let previewUrl = '';
/** Shows the share card under the buttons so people see what they will post. */
async function preview() {
  try {
    const blob = await card();
    if (!blob) return;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = URL.createObjectURL(blob);
    $('cardImg').src = previewUrl;
    $('cardImg').alt = t('play.cardAlt', { age: current.age, type: TYPES[current.type][0] });
    $('cardFig').hidden = false;
  } catch {
    $('cardFig').hidden = true;
  }
}

function render(raw, kind, shared, code) {
  const shareable = code !== null;
  const scores = scoreAll(raw);
  const total = totalScore(scores);
  const age = gameAge(total);
  const type = gamerType(scores);
  current = { raw, kind, scores, total, age, type, shareable, code };
  for (const id of ['shareBtn', 'copyBtn']) $(id).disabled = !shareable;
  $('xBtn').hidden = !shareable;
  $('result').hidden = false;
  $('sharedBanner').hidden = !shared;
  $('ageNum').textContent = String(age);
  $('typeName').textContent = TYPES[type][0];
  $('typeDesc').textContent = TYPES[type][1];
  $('areas').innerHTML = AREAS.map((k) => `<li><span class="lbl">${esc(NAMES[k])}<small>${esc(fmtRaw(k, raw))}</small></span><span class="track"><i style="width:${scores[k]}%"></i></span><span class="num">${scores[k]}</span></li>`).join('');
  $('inputNote').textContent = t('play.inputNote', { input: INPUT_NAMES[kind], total, v: RULES_VERSION });
  preview();
  $('shareStatus').textContent = shareable ? '' : t('play.cannotShare');
  if (!shareable) return;
  const url = shareUrl();
  $('xBtn').href = 'https://twitter.com/intent/tweet?' + new URLSearchParams({ text: shareText(), url }).toString();
}

function shareUrl() {
  return location.origin + location.pathname + '?r=' + current.code;
}

function shareText() {
  return t('play.shareText', { age: current.age, type: TYPES[current.type][0] });
}

function rulesTable() {
  const head = `<tr><th>${esc(t('play.rulesArea'))}</th><th>${esc(t('play.rulesPoints'))}</th></tr>`;
  const rows = AREAS.map((k) => `<tr><td>${esc(NAMES[k])}</td><td>${TABLES[k].map(([x, y]) => `${x}→${y}`).join(' · ')}</td></tr>`).join('');
  $('rulesTable').innerHTML = `<table>${head}${rows}</table>`;
}

// ---- share card ----------------------------------------------------------------------------
async function card() {
  const c = document.createElement('canvas');
  c.width = 1080;
  c.height = 1350;
  const g = c.getContext('2d');
  try { await document.fonts.ready; } catch { /* fonts optional */ }
  const NUM = '"Archivo","IBM Plex Sans KR",system-ui,sans-serif';
  const TXT = '"IBM Plex Sans KR",system-ui,sans-serif';
  const MONO = '"IBM Plex Mono",ui-monospace,monospace';
  g.fillStyle = '#121315';
  g.fillRect(0, 0, 1080, 1350);
  g.fillStyle = '#F2C230';
  g.fillRect(0, 0, 1080, 14);
  g.fillStyle = '#B4B7B2';
  g.font = `500 40px ${TXT}`;
  g.fillText(t('play.cardTitle'), 80, 130);
  g.fillStyle = '#F2C230';
  g.font = `800 300px ${NUM}`;
  g.fillText(String(current.age), 70, 420);
  const w = g.measureText(String(current.age)).width;
  g.fillStyle = '#E9EAE6';
  g.font = `600 64px ${TXT}`;
  g.fillText(t('play.ageUnit'), 90 + w, 410);
  g.font = `700 60px ${TXT}`;
  g.fillText(TYPES[current.type][0], 80, 530);
  let y = 640;
  for (const k of AREAS) {
    g.fillStyle = '#E9EAE6';
    g.font = `600 36px ${TXT}`;
    g.fillText(NAMES[k], 80, y);
    g.fillStyle = '#83878A';
    g.font = `400 28px ${MONO}`;
    g.fillText(fmtRaw(k, current.raw), 80, y + 40);
    g.fillStyle = '#2A2D31';
    g.fillRect(560, y - 26, 360, 18);
    g.fillStyle = '#F2C230';
    g.fillRect(560, y - 26, 3.6 * current.scores[k], 18);
    g.fillStyle = '#E9EAE6';
    g.font = `600 36px ${MONO}`;
    g.textAlign = 'right';
    g.fillText(String(current.scores[k]), 1000, y);
    g.textAlign = 'left';
    y += 96;
  }
  g.fillStyle = '#83878A';
  g.font = `400 26px ${TXT}`;
  g.fillText(t('play.cardNote', { input: INPUT_NAMES[current.kind], v: RULES_VERSION }), 80, 1250);
  g.fillStyle = '#E9EAE6';
  g.font = `600 30px ${MONO}`;
  g.fillText(location.host + location.pathname, 80, 1296);
  return new Promise((res) => c.toBlob(res, 'image/png'));
}

function status(m) {
  $('shareStatus').textContent = m;
}

async function saveImage() {
  const blob = await card();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `handspan-game-age-${current.age}.png`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  status(t('play.saved'));
}

async function copyLink() {
  try {
    await navigator.clipboard.writeText(shareUrl());
    status(t('play.copied'));
  } catch {
    status(t('play.copyFail', { url: shareUrl() }));
  }
}

async function share() {
  const url = shareUrl();
  const text = shareText();
  try {
    const blob = await card();
    const file = new File([blob], `handspan-game-age-${current.age}.png`, { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], text: `${text} ${url}` });
      return;
    }
    if (navigator.share) {
      await navigator.share({ text, url });
      return;
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return; // user closed the share sheet
  }
  // No share sheet: fall back to saving the image and copying the link.
  await saveImage();
  await copyLink();
  status(t('play.shareFallback'));
}

// ---- boot ----------------------------------------------------------------------------------
$('startAll').addEventListener('click', startRun);
$('againBtn').addEventListener('click', () => { arena.scrollIntoView({ behavior: 'smooth' }); startRun(); });
$('shareBtn').addEventListener('click', share);
$('saveBtn').addEventListener('click', saveImage);
$('copyBtn').addEventListener('click', copyLink);
rulesTable();

const r = new URLSearchParams(location.search).get('r');
if (r !== null) {
  const decoded = decodeResult(r);
  // A shared link is passed on unchanged (older v1 links have no counts to re-encode).
  if (decoded) { render(decoded.raw, decoded.input, true, r); $('result').scrollIntoView({ block: 'start' }); }
  else showPanel(`<h2>${esc(t('play.badLinkH'))}</h2><p>${esc(t('play.badLinkBody'))}</p>`, [[t('play.start'), startRun, true]]);
}
