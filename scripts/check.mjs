import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { ROOT } from '../lib/config.mjs';
let checked = 0;
for (const folder of ['bin', 'lib', 'cloudflare', 'ui', 'scripts', 'test']) {
  for (const file of await readdir(resolve(ROOT, folder))) {
    if (!/\.(mjs|js)$/.test(file)) continue;
    const result = spawnSync(process.execPath, ['--check', resolve(ROOT, folder, file)], { encoding: 'utf8' });
    if (result.status !== 0) { console.error(result.stderr); process.exitCode = 1; }
    checked++;
  }
}
console.log(`Checked ${checked} JavaScript files.`);
