import test from 'node:test';
import assert from 'node:assert/strict';
import { cm360, convert, convertCm, validateCm, validateSens, CM_MIN, CM_MAX } from '../src/assets/js/lib/sens.js';
import { parseState, serializeState, createProfiles, PROFILE_KEY, MAX_PROFILES, MAX_NAME } from '../src/assets/js/lib/convertState.js';

const games = [
  { id: 'ow', yaw: 0.0066, decimals: 2 },
  { id: 'cs', yaw: 0.022, decimals: 2 },
  { id: 'val', yaw: 0.07, decimals: 3 },
  { id: 'r6', yaw: 0.00572957795, decimals: 0 },
];
const ids = games.map((g) => g.id);

test('cm input gives the same rows as the equivalent sensitivity input', () => {
  for (const [from, dpi, sens, to] of [['ow', 800, 4, 800], ['cs', 400, 2.1, 1600], ['val', 1600, 0.25, 800]]) {
    const a = convert(from, dpi, sens, to, games);
    const b = convertCm(cm360(dpi, sens, games.find((g) => g.id === from).yaw), to, games);
    assert.deepEqual(b, a);
  }
});

test('validateCm accepts only finite values in range', () => {
  assert.equal(validateCm(CM_MIN), null);
  assert.equal(validateCm(CM_MAX), null);
  for (const v of [0, -5, CM_MIN - 0.01, CM_MAX + 0.01, NaN, Infinity, -Infinity]) assert.equal(validateCm(v), 'err.cm');
});

test('extreme sensitivities pass validateSens but convertCm refuses their cm/360', () => {
  // OpenClaw repro: 1e308 gave Infinity/NaN rows; Number.MIN_VALUE gave cm = Infinity.
  for (const sens of [1e308, Number.MIN_VALUE, 1e-9, 1e9]) {
    assert.equal(validateSens(sens), null);
    const cm = cm360(800, sens, 0.0066);
    assert.notEqual(validateCm(cm), null, `sens ${sens} -> cm ${cm}`);
    assert.throws(() => convertCm(cm, 800, games), RangeError);
    assert.throws(() => convert('ow', 800, sens, 800, games), RangeError);
  }
});

test('every row is finite across the accepted cm and DPI range', () => {
  for (const cm of [CM_MIN, 10, 43.3, 300, CM_MAX]) {
    for (const dpi of [100, 800, 32000]) {
      for (const row of convertCm(cm, dpi, games).rows) {
        for (const v of [row.sens, row.edpi, row.cm, row.errPct]) assert.ok(Number.isFinite(v), JSON.stringify(row));
        assert.ok(row.sens > 0);
      }
    }
  }
});

test('state round-trips through the query string in both modes', () => {
  const sens = { mode: 'sens', g: 'cs', dpi: '400', s: '2.1', to: '1600', cm: '' };
  assert.deepEqual(parseState(serializeState(sens), ids), sens);
  const cmMode = { mode: 'cm', g: 'ow', dpi: '800', s: '4', to: '800', cm: '34.5' };
  const back = parseState(serializeState(cmMode), ids);
  assert.equal(back.mode, 'cm');
  assert.equal(back.cm, '34.5');
  assert.equal(back.to, '800');
  assert.ok(!serializeState(cmMode).includes('dpi='), 'cm mode does not write unused fields');
});

test('long but valid values survive the URL round trip (OpenClaw repro)', () => {
  const st = { mode: 'sens', g: 'cs', dpi: '800', s: '2.1234567890123456789012345', to: '800', cm: '' };
  assert.deepEqual(parseState(serializeState(st), ids), st);
  const cm = { mode: 'cm', g: 'ow', dpi: '800', s: '4', to: '800', cm: String(cm360(800, 0.185, 0.0066)) };
  assert.equal(parseState(serializeState(cm), ids).cm, cm.cm);
});

test('switching modes with full-precision cm keeps every row (OpenClaw repro: OW 800 / 0.185)', () => {
  const cm = cm360(800, 0.185, 0.0066);
  assert.deepEqual(convertCm(Number(String(cm)), 800, games), convert('ow', 800, 0.185, 800, games));
});

test('parseState falls back for unknown games and odd values', () => {
  const st = parseState('?g=<script>&dpi=&s=%20&to=' + '9'.repeat(70) + '&m=evil', ids);
  assert.equal(st.g, 'ow');
  assert.equal(st.dpi, '800');
  assert.equal(st.s, '4');
  assert.equal(st.to, '800');
  assert.equal(st.mode, 'sens');
  assert.equal(parseState('?g=nope', ['cs', 'val']).g, 'cs');
  assert.equal(parseState('?g=nope', ['cs', 'val'], 'val').g, 'val');
});

function memStorage(init = {}) {
  const data = { ...init };
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
  };
}

test('profiles save, replace by name, load and remove', () => {
  const st = memStorage();
  const p = createProfiles(() => st);
  assert.deepEqual(p.load(), { list: [], status: 'ok' });
  assert.equal(p.save('  my   main ', 'g=ow&dpi=800&s=4&to=800').name, 'my main');
  p.save('alt', 'm=cm&cm=30&to=800');
  p.save('my main', 'g=cs&dpi=800&s=1.2&to=800');
  const { list } = p.load();
  assert.deepEqual(list.map((x) => x.name), ['alt', 'my main']);
  assert.equal(list[1].q, 'g=cs&dpi=800&s=1.2&to=800');
  p.remove('alt');
  assert.deepEqual(p.load().list.map((x) => x.name), ['my main']);
});

test('profile names are validated and stored as plain text', () => {
  const st = memStorage();
  const p = createProfiles(() => st);
  assert.deepEqual(p.save('   ', 'q'), { ok: false, error: 'name' });
  assert.deepEqual(p.save('x'.repeat(MAX_NAME + 1), 'q'), { ok: false, error: 'name' });
  const xss = '<img src=x onerror=alert(1)>';
  assert.equal(p.save(xss, 'q').name, xss, 'kept verbatim; the page renders it with textContent');
});

test('profile limit', () => {
  const st = memStorage();
  const p = createProfiles(() => st);
  for (let i = 0; i < MAX_PROFILES; i++) assert.ok(p.save('p' + i, 'q').ok);
  assert.deepEqual(p.save('one more', 'q'), { ok: false, error: 'full' });
  assert.ok(p.save('p3', 'q2').ok, 'replacing an existing name is allowed when full');
});

test('blocked, throwing, corrupt and full storage never throw', () => {
  const blocked = createProfiles(() => { throw new Error('SecurityError'); });
  assert.deepEqual(blocked.load(), { list: [], status: 'unavailable' });
  assert.deepEqual(blocked.save('a', 'q'), { ok: false, error: 'unavailable' });
  assert.deepEqual(blocked.remove('a'), { ok: false, error: 'unavailable' });

  const getThrows = createProfiles(() => ({ getItem() { throw new Error('x'); }, setItem() {} }));
  assert.equal(getThrows.load().status, 'unavailable');

  for (const raw of ['{', '42', '"str"', 'null', '{"a":1}']) {
    const st = memStorage({ [PROFILE_KEY]: raw });
    const p = createProfiles(() => st);
    const r = p.load();
    assert.deepEqual(r.list, []);
    assert.equal(r.status, 'corrupt');
    assert.ok(p.save('fresh', 'q').ok, 'saving replaces corrupt data');
    assert.deepEqual(p.load(), { list: [{ name: 'fresh', q: 'q' }], status: 'ok' });
  }

  const mixed = createProfiles(() => memStorage({ [PROFILE_KEY]: JSON.stringify([{ name: 'ok', q: 'g=ow' }, { name: 5 }, null, { name: 'ok', q: 'dup' }]) }));
  const r = mixed.load();
  assert.deepEqual(r.list, [{ name: 'ok', q: 'g=ow' }]);
  assert.equal(r.status, 'corrupt');

  const full = createProfiles(() => ({ getItem: () => null, setItem() { throw new Error('QuotaExceededError'); } }));
  assert.deepEqual(full.save('a', 'q'), { ok: false, error: 'quota' });
});
