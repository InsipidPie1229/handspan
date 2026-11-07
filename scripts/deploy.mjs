// Deploy: test, build for the project sub-path, commit dist/ to the gh-pages
// branch through a worktree in .deploy/, push, then check the live URLs.
// GitHub Actions is unavailable for this account, so Pages serves the
// gh-pages branch ("Deploy from a branch").
//
//   node scripts/deploy.mjs            # full deploy
//   node scripts/deploy.mjs --dry-run  # everything except push and URL check
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SITE = 'https://insipidpie1229.github.io';
const BASE = '/handspan/';
const BRANCH = 'gh-pages';
const WT = '.deploy';
const dry = process.argv.includes('--dry-run');

const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { stdio: 'inherit', ...opts });
const out = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { encoding: 'utf8', ...opts }).trim();

if (out('git', ['status', '--porcelain'])) {
  console.error('working tree is dirty; commit first so the deploy matches a commit');
  process.exit(1);
}
const head = out('git', ['rev-parse', '--short', 'HEAD']);

run(process.execPath, ['--test', ...readdirSync('test').filter((f) => f.endsWith('.test.mjs')).map((f) => join('test', f))]);
run(process.execPath, ['build.mjs'], { env: { ...process.env, HS_SITE: SITE, HS_BASE: BASE } });
writeFileSync(join('dist', '.nojekyll'), '');

run('git', ['fetch', 'origin', BRANCH]);
if (!existsSync(WT)) run('git', ['worktree', 'add', WT, `origin/${BRANCH}`, '--detach']);
run('git', ['checkout', '--detach', `origin/${BRANCH}`], { cwd: WT });
for (const name of readdirSync(WT)) {
  if (name !== '.git') rmSync(join(WT, name), { recursive: true, force: true });
}
cpSync('dist', WT, { recursive: true });
run('git', ['add', '-A'], { cwd: WT });
if (!out('git', ['status', '--porcelain'], { cwd: WT })) {
  console.log('gh-pages already matches this build');
  process.exit(0);
}
run('git', ['commit', '-q', '-m', `deploy: build of ${head}`], { cwd: WT });
if (dry) {
  console.log('dry run: committed in .deploy, not pushed');
  process.exit(0);
}
run('git', ['push', 'origin', `HEAD:${BRANCH}`], { cwd: WT });

// Pages rebuilds asynchronously; poll the home page until it carries this build's asset id.
const assetId = readdirSync(join('dist', 'assets'))[0];
const deadline = Date.now() + 5 * 60_000;
for (;;) {
  const res = await fetch(`${SITE}${BASE}ko/?t=${Date.now()}`).catch(() => null);
  const body = res && res.ok ? await res.text() : '';
  if (body.includes(`${BASE}assets/${assetId}/`)) break;
  if (Date.now() > deadline) {
    console.error(`live site does not show asset id ${assetId} after 5 minutes`);
    process.exit(1);
  }
  await new Promise((r) => setTimeout(r, 15_000));
}
const paths = ['', 'ko/', 'en/', 'ko/convert/', 'en/find/', 'sitemap.xml', `assets/${assetId}/base.css`];
let bad = 0;
for (const p of paths) {
  const res = await fetch(`${SITE}${BASE}${p}`).catch(() => null);
  const code = res ? res.status : 'ERR';
  if (code !== 200) bad++;
  console.log(`${code} ${SITE}${BASE}${p}`);
}
process.exit(bad ? 1 : 0);
