import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { buildZip, collectFiles, crc32, manifestFiles } from '../scripts/package.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const readJson = (p) => JSON.parse(readFileSync(root + p, 'utf8'));

// A small independent zip reader, so the tests do not trust the code that wrote the file.
function readZip(buf) {
  let end = buf.length - 22;
  while (end >= 0 && buf.readUInt32LE(end) !== 0x06054b50) end--;
  assert.ok(end >= 0, 'end-of-archive record found');
  const count = buf.readUInt16LE(end + 10);
  let at = buf.readUInt32LE(end + 16);
  const out = [];
  for (let i = 0; i < count; i++) {
    assert.equal(buf.readUInt32LE(at), 0x02014b50, 'central directory entry');
    const flags = buf.readUInt16LE(at + 8);
    const method = buf.readUInt16LE(at + 10);
    const crc = buf.readUInt32LE(at + 16);
    const packed = buf.readUInt32LE(at + 20);
    const size = buf.readUInt32LE(at + 24);
    const nameLen = buf.readUInt16LE(at + 28);
    const extraLen = buf.readUInt16LE(at + 30);
    const commentLen = buf.readUInt16LE(at + 32);
    const localAt = buf.readUInt32LE(at + 42);
    const name = buf.subarray(at + 46, at + 46 + nameLen).toString('utf8');
    assert.equal(buf.readUInt32LE(localAt), 0x04034b50, 'local header');
    const localName = buf.subarray(localAt + 30, localAt + 30 + buf.readUInt16LE(localAt + 26)).toString('utf8');
    assert.equal(localName, name, 'local and central names agree');
    const dataAt = localAt + 30 + buf.readUInt16LE(localAt + 26) + buf.readUInt16LE(localAt + 28);
    const raw = buf.subarray(dataAt, dataAt + packed);
    const data = method === 8 ? inflateRawSync(raw) : raw;
    assert.equal(data.length, size, `${name}: size`);
    assert.equal(crc32(data), crc, `${name}: crc`);
    out.push({ name, data, flags, method });
    at += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

test('crc32 gives the standard check value', () => {
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
  assert.equal(crc32(Buffer.alloc(0)), 0);
});

test('a zip round-trips tricky names and contents exactly', () => {
  const entries = [
    { name: 'a/b/c.txt', data: Buffer.from('hello hello hello hello hello hello hello') },
    { name: 'empty.txt', data: Buffer.alloc(0) },
    { name: 'binary.bin', data: randomBytes(5000) },
    { name: 'unicode-é-日本.txt', data: Buffer.from('ünï') },
    { name: 'big.css', data: Buffer.from('.ad { display: none }\n'.repeat(5000)) }
  ];
  const back = readZip(buildZip(entries));
  assert.deepEqual(back.map((e) => e.name), entries.map((e) => e.name));
  for (let i = 0; i < entries.length; i++) assert.ok(back[i].data.equals(entries[i].data), entries[i].name);
  assert.ok(back.every((e) => (e.flags & 0x0800) !== 0), 'names are flagged as UTF-8');
  assert.equal(back.find((e) => e.name === 'big.css').method, 8, 'compressible files are deflated');
  assert.equal(back.find((e) => e.name === 'binary.bin').method, 0, 'incompressible files are stored');
});

test('the same files always give a byte-identical zip', () => {
  const entries = [{ name: 'a.txt', data: Buffer.from('one') }, { name: 'b.txt', data: Buffer.from('two') }];
  assert.ok(buildZip(entries).equals(buildZip(entries)));
});

test('refuses absurd input instead of writing a broken zip', () => {
  assert.throws(() => buildZip(Array.from({ length: 65536 }, (_, i) => ({ name: `f${i}`, data: Buffer.alloc(0) }))), /Too many/);
});

test('the real package has the manifest at the top and only extension files, with forward slashes', () => {
  const files = collectFiles(root);
  const names = files.map((f) => f.name);
  assert.ok(names.includes('manifest.json'));
  assert.ok(names.includes('src/background/service-worker.js'));
  assert.ok(names.includes('rules/default-rules.json'));
  assert.ok(names.includes('icons/icon128.png'));
  for (const name of names) {
    assert.match(name, /^(manifest\.json|(rules|src|icons)\/.+)$/, `unexpected file in the package: ${name}`);
    assert.ok(!name.includes('\\') && !name.startsWith('/') && !name.includes('..'), name);
    assert.ok(!name.split('/').some((part) => part.startsWith('.')), `hidden file: ${name}`);
  }
  assert.deepEqual(names, [...names].sort(), 'sorted, so the zip is reproducible');
  assert.ok(buildZip(files).length < 1024 * 1024, 'package stays well under 1 MB');
});

test('the real package contains every file the manifest points to', () => {
  const names = new Set(collectFiles(root).map((f) => f.name));
  const needed = manifestFiles(readJson('manifest.json'));
  assert.ok(needed.length >= 10);
  for (const file of needed) assert.ok(names.has(file), `missing from the package: ${file}`);
  // ...and the files the popup and settings pages load
  for (const page of ['src/popup/popup.html', 'src/options/options.html']) {
    const html = readFileSync(root + page, 'utf8');
    for (const [, ref] of html.matchAll(/(?:src|href)="([^"#?]+)"/g)) {
      const resolved = new URL(ref, `https://x/${page}`).pathname.slice(1);
      assert.ok(names.has(resolved), `${page} loads ${resolved}, which is not in the package`);
    }
  }
});

test('the package can be read back and the files match the project', () => {
  const files = collectFiles(root);
  const back = readZip(buildZip(files));
  assert.equal(back.length, files.length);
  assert.ok(back.find((e) => e.name === 'manifest.json').data.equals(readFileSync(root + 'manifest.json')));
});

test('manifest.json and package.json have the same version', () => {
  assert.equal(readJson('manifest.json').version, readJson('package.json').version);
});
