import { pathToFileURL } from 'node:url';

const self = import.meta.url;
const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (entry !== self) {
  await import('./sens.test.mjs');
  await import('./stats.test.mjs');
  await import('./session.test.mjs');
  await import('./finder.test.mjs');
  await import('./click.test.mjs');
  await import('./kite.test.mjs');
  await import('./track.test.mjs');
  await import('./runs.test.mjs');
  await import('./findrun.test.mjs');
}
