// Converter state <-> URL query, and named profiles kept in localStorage.
// Pure apart from the storage object passed in, so it can be tested in Node.

export const DEFAULTS = { mode: 'sens', g: 'ow', dpi: '800', s: '4', to: '800', cm: '' };
const MAX_FIELD = 24;

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
  return {
    mode,
    g,
    dpi: field(params, 'dpi', DEFAULTS.dpi),
    s: field(params, 's', DEFAULTS.s),
    to: field(params, 'to', DEFAULTS.to),
    cm: field(params, 'cm', DEFAULTS.cm),
  };
}

/** Query string for a state. Only the keys the current mode uses are written. */
export function serializeState(st) {
  const p = new URLSearchParams();
  if (st.mode === 'cm') {
    p.set('m', 'cm');
    p.set('cm', st.cm);
  } else {
    p.set('g', st.g);
    p.set('dpi', st.dpi);
    p.set('s', st.s);
  }
  p.set('to', st.to);
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
