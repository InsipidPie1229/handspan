import { readFile, writeFile, mkdir, rm, readdir, cp } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { cm360, settableSens } from './src/assets/js/lib/sens.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');
// Deployment settings (environment): HS_SITE = origin, HS_BASE = path prefix, e.g. '/handspan/'
// for a project page. Defaults keep local builds working at the server root.
const SITE = (process.env.HS_SITE || 'https://example.invalid').replace(/\/$/, '');
const BASE = ('/' + (process.env.HS_BASE || '/').replace(/^\/+|\/+$/g, '') + '/').replace(/\/+/g, '/');
const LANGS = ['ko', 'en'];

const PAGES = {
  about: {
    meta: { title: 'meta.about.title', description: 'meta.about.description' }
  },
  index: {
    meta: { title: 'meta.index.title', description: 'meta.index.description' }
  },
  convert: {
    meta: { title: 'meta.convert.title', description: 'meta.convert.description' }
  },
  find: {
    meta: { title: 'meta.find.title', description: 'meta.find.description' }
  },
  kite: {
    meta: { title: 'meta.kite.title', description: 'meta.kite.description' }
  },
  click: {
    meta: { title: 'meta.click.title', description: 'meta.click.description' }
  },
  sens: {
    meta: { title: 'meta.sens.title', description: 'meta.sens.description' }
  },
  play: {
    meta: { title: 'meta.play.title', description: 'meta.play.description' }
  },
  zoom: {
    meta: { title: 'meta.zoom.title', description: 'meta.zoom.description' }
  }
};
// Pair pages ("Valorant to CS2") are added to PAGES after games.json and pairs.json are read.

function fail(message) {
  console.error('build error: ' + message);
  process.exit(1);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function pathFor(lang, page) {
  return page === 'index' ? `${BASE}${lang}/` : `${BASE}${lang}/${page}/`;
}

async function walk(dir) {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(full)));
    else if (entry.name.endsWith('.js')) files.push(full);
  }
  return files;
}

async function collectJsKeys() {
  const keys = new Set();
  const pattern = /(?<![\w.$])t\(\s*['"]([^'"]+)['"]/g;
  for (const file of await walk(path.join(SRC, 'assets', 'js'))) {
    const source = await readFile(file, 'utf8');
    let match;
    while ((match = pattern.exec(source))) keys.add(match[1]);
  }
  return keys;
}

function collectTemplateKeys(template) {
  const keys = new Set();
  for (const match of template.matchAll(/\{\{([A-Za-z0-9_.]+)\}\}/g)) keys.add(match[1]);
  return keys;
}

// Fills {name} placeholders with already-escaped values (pair pages).
function fill(text, vars) {
  return vars ? text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m)) : text;
}

function makeHead(lang, page, dict) {
  const cfg = PAGES[page];
  // Title and description are escaped below, so fill them with unescaped values.
  const raw = cfg.pair ? pairVars(cfg.pair, lang, false) : null;
  const title = fill(dict[cfg.meta.title], raw);
  const description = fill(dict[cfg.meta.description], raw);
  const url = SITE + pathFor(lang, page);
  const ko = SITE + pathFor('ko', page);
  const en = SITE + pathFor('en', page);
  return [
    `<title>${escapeHtml(title)}</title>`,
    `<meta name="description" content="${escapeHtml(description)}">`,
    `<meta property="og:title" content="${escapeHtml(title)}">`,
    `<meta property="og:description" content="${escapeHtml(description)}">`,
    '<meta property="og:type" content="website">',
    `<meta property="og:url" content="${escapeHtml(url)}">`,
    `<link rel="canonical" href="${escapeHtml(url)}">`,
    `<link rel="alternate" hreflang="ko" href="${escapeHtml(ko)}">`,
    `<link rel="alternate" hreflang="en" href="${escapeHtml(en)}">`,
    `<link rel="alternate" hreflang="x-default" href="${escapeHtml(en)}">`,
    '<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">',
    `<meta property="og:locale" content="${lang === 'ko' ? 'ko_KR' : 'en_US'}">`,
    '<meta property="og:site_name" content="handspan">',
    `<meta property="og:image" content="${SITE}${BASE}assets/${BUILD_ID}/og.png">`,
    '<meta property="og:image:width" content="1200">',
    '<meta property="og:image:height" content="630">',
    `<meta property="og:image:alt" content="${escapeHtml(dict['meta.ogAlt'])}">`,
    '<meta name="twitter:card" content="summary_large_image">',
    jsonLd(lang, page, dict, raw, title, description, url)
  ].filter(Boolean).join('\n');
}

// Source table for the about page, generated from games.json (all games, including excluded ones).
function sourcesTable(lang, dict) {
  const rows = games.map((g) => {
    const srcs = g.sources.map((x) => `<a href="${escapeHtml(x.url)}" rel="noopener">${escapeHtml(new URL(x.url).hostname)}</a> (${escapeHtml(x.checked)} · ${x.value}${x.note ? ' · ' + escapeHtml(x.note) : ''})`);
    (g.reports || []).forEach((r) => srcs.push(`${r.value} (${escapeHtml(r.status)} via ${escapeHtml(new URL(r.via).hostname)})`));
    const status = g.conflict
      ? `${escapeHtml(dict['about.excluded'])}: ${escapeHtml(g.conflict[lang])}`
      : [escapeHtml(dict['status.unverified']), g.caveat ? escapeHtml(g.caveat[lang]) : ''].filter(Boolean).join(' · ');
    return `<tr class="${g.conflict ? 'ex' : ''}"><td>${escapeHtml(g.name[lang])}</td><td class="n">${g.yaw}</td><td>${srcs.join('<br>')}</td><td>${status}</td></tr>`;
  });
  return `<table><thead><tr><th>${escapeHtml(dict['about.colGame'])}</th><th>${escapeHtml(dict['about.colYaw'])}</th><th>${escapeHtml(dict['about.colSources'])}</th><th>${escapeHtml(dict['about.colStatus'])}</th></tr></thead><tbody>${rows.join('')}</tbody></table>`;
}

const fmtFactor = (v) => String(+v.toPrecision(4));

// Structured data that only restates what the page visibly shows.
const TOOL_PAGES = new Set(['convert', 'zoom', 'find', 'click', 'kite', 'play']);
function ldScript(obj) {
  return `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, '\\u003c')}</script>`;
}

function jsonLd(lang, page, dict, raw, title, description, url) {
  const home = SITE + pathFor(lang, 'index');
  if (TOOL_PAGES.has(page)) {
    return ldScript({
      '@context': 'https://schema.org', '@type': 'WebApplication', name: title.replace(/ · handspan$/, ''),
      description, url, inLanguage: lang, applicationCategory: 'UtilitiesApplication', operatingSystem: 'Any',
      isAccessibleForFree: true, offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    });
  }
  const cfg = PAGES[page];
  if (!cfg.pair) return '';
  const crumbs = ldScript({
    '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'handspan', item: home },
      { '@type': 'ListItem', position: 2, name: dict['nav.pairs'], item: SITE + pathFor(lang, 'sens') },
      { '@type': 'ListItem', position: 3, name: `${raw.from} → ${raw.to}`, item: url },
    ],
  });
  const faq = ldScript({
    '@context': 'https://schema.org', '@type': 'FAQPage',
    mainEntity: pairFaq(raw, dict).map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })),
  });
  return crumbs + '\n' + faq;
}

/** FAQ entries as plain text; the page renders the same strings (escaped) in a visible section. */
function pairFaq(vars, dict) {
  return [1, 2, 3].map((i) => [fill(dict[`pair.faqQ${i}`], vars), fill(dict[`pair.faqA${i}`], vars)]);
}

function pairVars(pair, lang, escaped = true) {
  const esc = escaped ? escapeHtml : String;
  const from = gameById.get(pair.from);
  const to = gameById.get(pair.to);
  return {
    from: esc(from.name[lang]),
    to: esc(to.name[lang]),
    factor: fmtFactor(from.yaw / to.yaw),
    fromYaw: String(from.yaw),
    toYaw: String(to.yaw),
    decimals: String(to.decimals),
    sens: String(pair.samples[Math.floor(pair.samples.length / 2)]),
    example: (() => {
      const sv = pair.samples[Math.floor(pair.samples.length / 2)];
      const r = settableSens(cm360(800, sv, from.yaw), 800, to.yaw, to.decimals);
      return r.sens.toFixed(to.decimals);
    })(),
    checked: esc([...from.sources, ...to.sources].map((x) => x.checked).sort().pop())
  };
}

function pairTable(pair, lang, dict, vars) {
  const from = gameById.get(pair.from);
  const to = gameById.get(pair.to);
  const rows = pair.samples.map((sv) => {
    const cm = cm360(800, sv, from.yaw);
    const r = settableSens(cm, 800, to.yaw, to.decimals);
    const err = Math.abs(r.errPct) >= 0.05 ? ` <span class="small">(${r.errPct > 0 ? '+' : ''}${r.errPct.toFixed(1)}%)</span>` : '';
    return `<tr><td>${sv.toFixed(from.decimals)}</td><td class="s${r.ok ? '' : ' off'}">${r.sens.toFixed(to.decimals)}${err}</td><td>${cm.toFixed(1)}</td><td>${(cm / 2).toFixed(1)}</td></tr>`;
  });
  const head = ['pair.colFrom', 'pair.colTo', 'pair.colCm800', 'pair.colCm1600'].map((k) => `<th>${fill(dict[k], vars)}</th>`).join('');
  return `<table><thead><tr>${head}</tr></thead><tbody>${rows.join('')}</tbody></table>`;
}

function pairSources(pair, lang) {
  return [pair.from, pair.to].map((id) => {
    const g = gameById.get(id);
    const links = g.sources.map((x) => `<a href="${escapeHtml(x.url)}" rel="noopener">${escapeHtml(new URL(x.url).hostname)}</a> (${escapeHtml(x.checked)})`).join(', ');
    return `<li><b>${escapeHtml(g.name[lang])}</b> ${g.yaw}: ${links}</li>`;
  }).join('');
}

function pairCaveats(pair, lang) {
  return [pair.from, pair.to].map((id) => gameById.get(id)).filter((g) => g.caveat && g.caveat[lang])
    .map((g) => `<p class="note"><b>${escapeHtml(g.name[lang])}</b> ${escapeHtml(g.caveat[lang])}</p>`).join('');
}

function pairLinks(lang, exceptSlug) {
  return pairs.filter((p) => p.slug !== exceptSlug).map((p) => {
    const v = pairVars(p, lang);
    return `<a href="${pathFor(lang, 'sens/' + p.slug)}">${v.from} → ${v.to}</a>`;
  }).join('');
}

function pairList(lang) {
  return pairs.map((p) => {
    const v = pairVars(p, lang);
    return `<li><a href="${pathFor(lang, 'sens/' + p.slug)}">${v.from} → ${v.to}<span>× ${v.factor}</span></a></li>`;
  }).join('');
}

function renderPair(out, pair, lang, dict) {
  const vars = pairVars(pair, lang);
  const params = new URLSearchParams({ g: pair.from, dpi: '800', s: vars.sens, to: '800' });
  const blocks = {
    '@table': pairTable(pair, lang, dict, vars),
    '@sources': pairSources(pair, lang),
    '@caveats': pairCaveats(pair, lang),
    '@others': pairLinks(lang, pair.slug),
    '@faq': pairFaq(pairVars(pair, lang, false), dict).map(([q, a]) => `<div><h3>${escapeHtml(q)}</h3><p>${escapeHtml(a)}</p></div>`).join(''),
    '@convertHref': `${BASE}${lang}/convert/?${escapeHtml(params.toString())}`
  };
  out = out.replace(/\{(@\w+)\}/g, (m, k) => (k in blocks ? blocks[k] : m));
  return fill(out, vars);
}

function render(template, lang, page, dict) {
  let out = template;
  out = out.replace(/\{\{@lang\}\}/g, lang);
  out = out.replace(/\{\{@base\}\}/g, `${BASE}${lang}/`);
  out = out.replace(/\{\{@head\}\}/g, makeHead(lang, page, dict));
  out = out.replace(/\{\{@sources\}\}/g, () => sourcesTable(lang, dict));
  out = out.replace(/\{\{@pairs\}\}/g, () => pairList(lang));
  out = out.replace(/\{\{@gameCount\}\}/g, String(keptGames.length));
  out = out.replace(/\{\{@pairCount\}\}/g, String(pairs.length));
  out = out.replace(/\{\{@i18nJson\}\}/g, JSON.stringify(dict).replace(/</g, '\\u003c'));
  out = out.replace(/\{\{([A-Za-z0-9_.]+)\}\}/g, (match, key) => {
    if (!(key in dict)) throw new Error(`missing key: ${key}`);
    return dict[key];
  });
  out = out.replace(/<a href="#" data-lang="(ko|en)">/g, (match, target) => {
    const current = target === lang ? ' aria-current="true"' : '';
    return `<a href="${pathFor(target, page)}" data-lang="${target}"${current}>`;
  });
  if (PAGES[page].pair) out = renderPair(out, PAGES[page].pair, lang, dict);
  return out;
}

// Content hash of assets and data. Assets are served from /assets/<id>/ and data from /data/<id>/
// so a new build never mixes with modules the browser cached from an older one.
async function hashDir(dir, h) {
  for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await hashDir(full, h);
    else h.update(entry.name).update(await readFile(full));
  }
}
const buildHash = createHash('sha256');
await hashDir(path.join(SRC, 'assets'), buildHash);
await hashDir(path.join(SRC, 'data'), buildHash);
const BUILD_ID = buildHash.digest('hex').slice(0, 10);
const versioned = (html) => html
  .replace(/(["'(])\/assets\//g, `$1${BASE}assets/${BUILD_ID}/`)
  .replace(/(["'(])\/data\/games\.json/g, `$1${BASE}data/${BUILD_ID}/games.json`)
  .replace(/href="\/(ko|en)\/"/g, `href="${BASE}$1/"`);

const i18n = {};
for (const lang of LANGS) {
  i18n[lang] = JSON.parse(await readFile(path.join(SRC, 'i18n', `${lang}.json`), 'utf8'));
}

const koKeys = Object.keys(i18n.ko).sort();
const enKeys = Object.keys(i18n.en).sort();
if (JSON.stringify(koKeys) !== JSON.stringify(enKeys)) {
  fail('i18n key sets differ between ko.json and en.json');
}

const jsKeys = await collectJsKeys();
const games = JSON.parse(await readFile(path.join(SRC, 'data', 'games.json'), 'utf8'));
// Games without sources, or whose sources disagree (conflict), are not calculated or recommended.
const keptGames = games.filter((game) => Array.isArray(game.sources) && game.sources.length > 0 && !game.conflict);
for (const game of games) if (game.conflict) console.warn(`warning: game "${game.id}" has conflicting sources; excluded from dist/data/games.json`);
for (const game of games) {
  if (!Array.isArray(game.sources) || game.sources.length === 0) {
    console.warn(`warning: game "${game.id}" has no sources; excluded from dist/data/games.json`);
  }
}
const gameById = new Map(keptGames.map((g) => [g.id, g]));
const pairs = JSON.parse(await readFile(path.join(SRC, 'data', 'pairs.json'), 'utf8'));
for (const pair of pairs) {
  if (!gameById.has(pair.from) || !gameById.has(pair.to) || pair.from === pair.to) fail(`pairs.json: ${pair.slug} uses a missing, excluded or identical game`);
  if (!/^[a-z0-9-]+$/.test(pair.slug)) fail(`pairs.json: bad slug ${pair.slug}`);
  if (!pair.samples.length || !pair.samples.every((v) => Number.isFinite(v) && v > 0)) fail(`pairs.json: bad samples in ${pair.slug}`);
  PAGES['sens/' + pair.slug] = { template: 'pair', pair, meta: { title: 'meta.pair.title', description: 'meta.pair.description' } };
}

let existing = [];
try {
  existing = await readdir(DIST);
} catch (error) {
  existing = [];
}
for (const entry of existing) {
  await rm(path.join(DIST, entry), { recursive: true, force: true });
}
await mkdir(DIST, { recursive: true });

const allUsed = new Set();
for (const [page, cfg] of Object.entries(PAGES)) {
  const template = await readFile(path.join(SRC, 'pages', `${cfg.template || page}.html`), 'utf8');
  const templateKeys = collectTemplateKeys(template);
  for (const lang of LANGS) {
    const dict = i18n[lang];
    const used = new Set([...templateKeys, ...jsKeys, ...Object.values(cfg.meta)]);
    const missing = [...used].filter((key) => !(key in dict));
    used.forEach((key) => allUsed.add(key));
    if (missing.length) fail(`${lang}/${page}: missing keys: ${missing.join(', ')}`);
    let html;
    try {
      html = render(template, lang, page, dict);
    } catch (error) {
      fail(`${lang}/${page}: ${error.message}`);
    }
    const outDir = page === 'index' ? path.join(DIST, lang) : path.join(DIST, lang, page);
    await mkdir(outDir, { recursive: true });
    await writeFile(path.join(outDir, 'index.html'), versioned(html));
  }
}

['notfound.title', 'notfound.body', 'notfound.home', 'meta.ogAlt', 'pair.faqQ1', 'pair.faqA1', 'pair.faqQ2', 'pair.faqA2', 'pair.faqQ3', 'pair.faqA3', 'pair.colFrom', 'pair.colTo', 'pair.colCm800', 'pair.colCm1600', 'about.colGame', 'about.colYaw', 'about.colSources', 'about.colStatus', 'about.excluded'].forEach((key) => allUsed.add(key));
const unusedKeys = Object.keys(i18n.ko).filter((key) => !allUsed.has(key));
if (unusedKeys.length) fail(`unused keys: ${unusedKeys.join(', ')}`);

await cp(path.join(SRC, 'assets'), path.join(DIST, 'assets', BUILD_ID), { recursive: true });
await mkdir(path.join(DIST, 'data', BUILD_ID), { recursive: true });
// JS modules fetch games.json by absolute path; rewrite it to the versioned location.
for (const file of await walk(path.join(DIST, 'assets', BUILD_ID))) {
  const src = await readFile(file, 'utf8');
  if (src.includes('/data/games.json')) await writeFile(file, versioned(src));
}
await writeFile(path.join(DIST, 'data', BUILD_ID, 'games.json'), JSON.stringify(keptGames, null, 2) + '\n');

const ko = i18n.ko;
const en = i18n.en;
const root = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(en['meta.index.title'])}</title>
<meta name="description" content="${escapeHtml(en['meta.index.description'])}">
<link rel="canonical" href="${SITE}${BASE}en/">
<link rel="alternate" hreflang="ko" href="${SITE}${BASE}ko/">
<link rel="alternate" hreflang="en" href="${SITE}${BASE}en/">
<link rel="alternate" hreflang="x-default" href="${SITE}${BASE}en/">
<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/assets/base.css">
</head>
<body>
<main class="wrap" style="padding-block:80px;display:grid;gap:16px">
<h1>handspan</h1>
<p><a href="/ko/">한국어</a> · <a href="/en/">English</a></p>
</main>
</body>
</html>
`;
await writeFile(path.join(DIST, 'index.html'), versioned(root));

const notFound = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>404 · handspan</title>
<meta name="robots" content="noindex">
<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/assets/base.css">
</head>
<body>
<main class="wrap" style="padding-block:80px;display:grid;gap:24px">
<section lang="ko"><h1>${escapeHtml(ko['notfound.title'])}</h1><p>${escapeHtml(ko['notfound.body'])}</p><p><a href="/ko/">${escapeHtml(ko['notfound.home'])}</a></p></section>
<section lang="en"><h2>${escapeHtml(en['notfound.title'])}</h2><p>${escapeHtml(en['notfound.body'])}</p><p><a href="/en/">${escapeHtml(en['notfound.home'])}</a></p></section>
</main>
</body>
</html>
`;
await writeFile(path.join(DIST, '404.html'), versioned(notFound));

// sitemap.xml with hreflang alternates for every page in both languages
const NL = String.fromCharCode(10);
const urls = Object.keys(PAGES).flatMap((page) => LANGS.map((lang) => {
  const alt = LANGS.map((l) => `    <xhtml:link rel="alternate" hreflang="${l}" href="${SITE}${pathFor(l, page)}"/>`);
  return [`  <url>`, `    <loc>${SITE}${pathFor(lang, page)}</loc>`, ...alt,
    `    <xhtml:link rel="alternate" hreflang="x-default" href="${SITE}${pathFor('en', page)}"/>`, `  </url>`].join(NL);
}));
await writeFile(path.join(DIST, 'sitemap.xml'), ['<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
  ...urls, '</urlset>', ''].join(NL));
await writeFile(path.join(DIST, 'robots.txt'), ['User-agent: *', 'Allow: /', `Sitemap: ${SITE}${BASE}sitemap.xml`, ''].join(NL));

console.log('built dist/');
