// Converter state <-> URL query, and named profiles kept in localStorage.
// Pure apart from the storage object passed in, so it can be tested in Node.

export const DEFAULTS = { mode: 'sens', g: 'ow', dpi: '800', s: '4', to: '800', cm: '' };
// Long enough for any value a number input accepts as typed (e.g. 25 significant digits).
const MAX_FIELD = 64;

function field(params, key, fallback) {
  const v = params.get(key);
  if (v === null) return fallback;
  const t = v.trim();
  return t === '' || t.length > MAX_FIELD ? fallback : t;
}

/**
 * Reads the converter state from a query string. Values stay text (inputs show them as typed);
 * validation happens in the page. Unknown games fall back to `fallbackGame`.
 */
export function parseState(search, gameIds, fallbackGame = DEFAULTS.g) {
  const params = new URLSearchParams(search);
  const ids = new Set(gameIds);
  const wanted = field(params, 'g', DEFAULTS.g);
  const g = ids.has(wanted) ? wanted : ids.has(fallbackGame) ? fallbackGame : (gameIds[0] ?? DEFAULTS.g);
  const mode = params.get('m') === 'cm' ? 'cm' : 'sens';
  const st = {
    mode,
    g,
    dpi: field(params, 'dpi', DEFAULTS.dpi),
    s: field(params, 's', DEFAULTS.s),
    to: field(params, 'to', DEFAULTS.to),
    cm: field(params, 'cm', DEFAULTS.cm),
  };
  // A sensitivity-mode state that names a game we don't have must not be silently recomputed
  // with another game: report it so the page can say so.
  if (mode === 'sens' && params.has('g') && g !== wanted) st.missing = wanted;
  return st;
}

/** Finite numbers are written in their shortest exact form (any length typed reads back the same). */
export function normNum(v) {
  const t = String(v ?? '').trim();
  const n = Number(t);
  return t !== '' && Number.isFinite(n) ? String(n) : t;
}

/** Query string for a state. Only the keys the current mode uses are written. */
export function serializeState(st) {
  const p = new URLSearchParams();
  if (st.mode === 'cm') {
    p.set('m', 'cm');
    p.set('cm', normNum(st.cm));
  } else {
    p.set('g', st.g);
    p.set('dpi', normNum(st.dpi));
    p.set('s', normNum(st.s));
  }
  p.set('to', normNum(st.to));
  return p.toString();
}

export const PROFILE_KEY = 'hs.convert.profiles.v1';
export const MAX_PROFILES = 20;
export const MAX_NAME = 40;

export function cleanName(name) {
  return String(name ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * Named profiles: [{ name, q }] where q is a serialized state. `storage` is localStorage or
 * anything with getItem/setItem; every access may throw (blocked storage), and stored data may
 * be corrupt. Neither stops the converter: the store reports a status instead.
 */
export function createProfiles(getStorage) {
  function storage() {
    try {
      return getStorage();
    } catch {
      return null;
    }
  }

  function load() {
    const st = storage();
    if (!st) return { list: [], status: 'unavailable' };
    let raw;
    try {
      raw = st.getItem(PROFILE_KEY);
    } catch {
      return { list: [], status: 'unavailable' };
    }
    if (raw === null) return { list: [], status: 'ok' };
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return { list: [], status: 'corrupt' };
    }
    if (!Array.isArray(data)) return { list: [], status: 'corrupt' };
    const list = [];
    const seen = new Set();
    for (const item of data) {
      if (!item || typeof item.name !== 'string' || typeof item.q !== 'string') continue;
      const name = cleanName(item.name).slice(0, MAX_NAME);
      if (!name || seen.has(name) || item.q.length > 400) continue;
      seen.add(name);
      list.push({ name, q: item.q });
      if (list.length >= MAX_PROFILES) break;
    }
    return { list, status: list.length === data.length ? 'ok' : 'corrupt' };
  }

  function write(list) {
    const st = storage();
    if (!st) return 'unavailable';
    try {
      st.setItem(PROFILE_KEY, JSON.stringify(list));
      return null;
    } catch {
      return 'quota';
    }
  }

  function save(name, q) {
    const n = cleanName(name);
    if (!n || n.length > MAX_NAME) return { ok: false, error: 'name' };
    const cur = load();
    if (cur.status === 'unavailable') return { ok: false, error: 'unavailable' };
    const list = cur.list.filter((p) => p.name !== n);
    if (list.length >= MAX_PROFILES) return { ok: false, error: 'full' };
    list.push({ name: n, q });
    const err = write(list);
    return err ? { ok: false, error: err } : { ok: true, name: n };
  }

  function remove(name) {
    const cur = load();
    if (cur.status === 'unavailable') return { ok: false, error: 'unavailable' };
    const err = write(cur.list.filter((p) => p.name !== name));
    return err ? { ok: false, error: err } : { ok: true };
  }

  return { load, save, remove };
}

// ---- Games the user measured themselves -------------------------------------------------------
export const CUSTOM_KEY = 'hs.convert.custom.v2';
const CUSTOM_ID = /^c[0-9a-z]{6,20}$/;
function newId() {
  return 'c' + Date.now().toString(36) + Math.floor(Math.random() * 36 ** 4).toString(36).padStart(4, '0');
}
export const MAX_CUSTOM = 20;
const K = 914.4;

/**
 * Yaw from an in-game measurement: at `dpi` and `sens`, one full turn took `cm`.
 * Returns null unless every input and the result are finite and in range.
 */
export function yawFromMeasurement(dpi, sens, cm) {
  if (!(Number.isFinite(dpi) && dpi >= 100 && dpi <= 32000)) return null;
  if (!(Number.isFinite(sens) && sens > 0)) return null;
  if (!(Number.isFinite(cm) && cm >= 1 && cm <= 1000)) return null;
  const yaw = K / (dpi * sens * cm);
  return Number.isFinite(yaw) && yaw >= 1e-6 && yaw <= 100 ? yaw : null;
}

/** Custom games as converter entries: { id: 'c1'.., name, yaw, decimals: 3, custom: true }. */
export function createCustomGames(getStorage) {
  const store = createProfilesLike(getStorage, CUSTOM_KEY);
  function load() {
    const { data, status } = store.read();
    const list = [];
    const ids = new Set();
    for (const item of Array.isArray(data) ? data : []) {
      if (!item || typeof item.name !== 'string' || typeof item.id !== 'string' || !CUSTOM_ID.test(item.id)) continue;
      const name = cleanName(item.name).slice(0, MAX_NAME);
      const m = item.measured;
      const yaw = m ? yawFromMeasurement(m.dpi, m.sens, m.cm) : null;
      if (!name || ids.has(item.id) || yaw === null) continue;
      ids.add(item.id);
      list.push({ id: item.id, name, yaw, measured: { dpi: m.dpi, sens: m.sens, cm: m.cm } });
      if (list.length >= MAX_CUSTOM) break;
    }
    const bad = status === 'ok' && data !== null && (!Array.isArray(data) || list.length !== data.length);
    return { list, status: bad ? 'corrupt' : status };
  }
  /** measured: { dpi, sens, cm } from one in-game turn; the yaw is derived and never stored alone. */
  function add(name, measured, makeId = newId) {
    const n = cleanName(name);
    if (!n || n.length > MAX_NAME) return { ok: false, error: 'name' };
    const m = measured || {};
    const yaw = yawFromMeasurement(m.dpi, m.sens, m.cm);
    if (yaw === null) return { ok: false, error: 'value' };
    const cur = load();
    if (cur.status === 'unavailable') return { ok: false, error: 'unavailable' };
    if (cur.list.length >= MAX_CUSTOM) return { ok: false, error: 'full' };
    // Ids are never reused, so a saved setting can't silently point at a different game.
    let id = makeId();
    while (cur.list.some((g) => g.id === id)) id = makeId();
    if (!CUSTOM_ID.test(id)) return { ok: false, error: 'value' };
    const item = { id, name: n, yaw, measured: { dpi: m.dpi, sens: m.sens, cm: m.cm } };
    const err = store.write([...cur.list.map(({ id: i, name: nm, measured: ms }) => ({ id: i, name: nm, measured: ms })),
      { id, name: n, measured: item.measured }]);
    return err ? { ok: false, error: err } : { ok: true, item };
  }
  function remove(id) {
    const cur = load();
    if (cur.status === 'unavailable') return { ok: false, error: 'unavailable' };
    const err = store.write(cur.list.filter((g) => g.id !== id).map(({ id: i, name: nm, measured: ms }) => ({ id: i, name: nm, measured: ms })));
    return err ? { ok: false, error: err } : { ok: true };
  }
  return { load, add, remove };
}

function createProfilesLike(getStorage, key) {
  function storage() {
    try {
      return getStorage();
    } catch {
      return null;
    }
  }
  return {
    read() {
      const st = storage();
      if (!st) return { data: null, status: 'unavailable' };
      let raw;
      try {
        raw = st.getItem(key);
      } catch {
        return { data: null, status: 'unavailable' };
      }
      if (raw === null) return { data: null, status: 'ok' };
      try {
        return { data: JSON.parse(raw), status: 'ok' };
      } catch {
        return { data: null, status: 'corrupt' };
      }
    },
    write(list) {
      const st = storage();
      if (!st) return 'unavailable';
      try {
        st.setItem(key, JSON.stringify(list));
        return null;
      } catch {
        return 'quota';
      }
    },
  };
}
