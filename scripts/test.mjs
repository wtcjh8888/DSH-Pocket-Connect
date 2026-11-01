import { readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { ROOT } from '../lib/config.mjs';

const files = (await readdir(resolve(ROOT, 'test'))).filter(name => name.endsWith('.test.mjs')).sort();
const child = spawn(process.execPath, ['--test', ...files.map(name => resolve(ROOT, 'test', name))], { cwd: ROOT, stdio: 'inherit', shell: false });
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('close', code => { process.exitCode = code ?? 1; });
