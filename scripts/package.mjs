import { mkdir, readdir, lstat, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { ROOT } from '../lib/config.mjs';

// Explicit allow list: credentials, local state, dependencies and logs are never read.
const items = ['bin', 'cloudflare', 'lib', 'ui', 'scripts', 'test', 'docs', '.github', 'README.md', 'LICENSE', 'SECURITY.md', 'CONTRIBUTING.md', '.gitignore', '.gitattributes', '.npmrc', 'package.json', 'package-lock.json', 'connect.example.json', 'connect.cmd', 'quick-start.cmd', 'quick-start.vbs', 'start.sh'];
const entries = [];
async function collect(relative) {
  if (relative.split('/').some(part => ['data', 'node_modules', '.wrangler', 'dist', '.git'].includes(part) || part.startsWith('.env') || part.startsWith('.dev.vars') || /\.log(?:\.|$)/i.test(part))) return;
  const absolute = join(ROOT, relative);
  const stat = await lstat(absolute);
  if (stat.isSymbolicLink()) throw new Error(`源码打包不接受符号链接：${relative}`);
  if (stat.isDirectory()) {
    for (const name of await readdir(absolute)) await collect(`${relative}/${name}`);
  } else entries.push({ name: `DSH-Pocket-Connect/${relative}`, data: await readFile(absolute) });
}
for (const item of items) await collect(item);
entries.push({ name: 'DSH-Pocket-Connect/快速开始.cmd', data: await readFile(join(ROOT, 'quick-start.cmd')) });
entries.push({ name: 'DSH-Pocket-Connect/快速开始.vbs', data: await readFile(join(ROOT, 'quick-start.vbs')) });
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let value = n;
  for (let bit = 0; bit < 8; bit++) value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
const localParts = [], centralParts = [];
let offset = 0;
for (const entry of entries) {
  const name = Buffer.from(entry.name, 'utf8');
  const compressed = deflateRawSync(entry.data, { level: 9 });
  const crc = crc32(entry.data);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(8, 8);
  local.writeUInt16LE(33, 12);
  local.writeUInt32LE(crc, 14); local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(entry.data.length, 22); local.writeUInt16LE(name.length, 26);
  localParts.push(local, name, compressed);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x0800, 8); central.writeUInt16LE(8, 10); central.writeUInt16LE(33, 14);
  central.writeUInt32LE(crc, 16); central.writeUInt32LE(compressed.length, 20);
  central.writeUInt32LE(entry.data.length, 24); central.writeUInt16LE(name.length, 28);
  central.writeUInt32LE(offset, 42); centralParts.push(central, name);
  offset += local.length + name.length + compressed.length;
}
const directory = Buffer.concat(centralParts);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
const destination = resolve(ROOT, 'dist', 'DSH-Pocket-Connect-source.zip');
await mkdir(resolve(ROOT, 'dist'), { recursive: true });
await writeFile(destination, Buffer.concat([...localParts, directory, end]));
console.log(`已生成源码 ZIP（${entries.length} 个文件，不含私人配置和依赖）：${destination}`);
