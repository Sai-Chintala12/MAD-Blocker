// Tests for scripts/check-privacy.mjs. Fake personal data is assembled from pieces at run time,
// so this file itself contains nothing that the checker would flag.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { scanText, scanImage, scanProject } from '../scripts/check-privacy.mjs';

const at = '@';
const email = (local, domain) => `${local}${at}${domain}`;
const bs = '\\';

test('real-looking email addresses are flagged, placeholders and noreply addresses are not', () => {
  const text = [
    `contact: ${email('someone', 'gmail.com')}`,
    `placeholder: ${email('you', 'example.com')} and ${email('a', 'example.org')}`,
    `github: ${email('12345+someone', 'users.noreply.github.com')}`,
    `bot: ${email('noreply', 'anthropic.com')}`
  ].join('\n');
  const found = scanText('x.md', text);
  assert.equal(found.length, 1);
  assert.equal(found[0].at, 'x.md:1');
  assert.equal(found[0].kind, 'email address');
});

test('personal folder paths are flagged, placeholder names are not', () => {
  const lines = [
    `C:${bs}Users${bs}${'bob'}${bs}Documents`,
    `C:/Users/${'alice'}/.ssh`,
    `/home/${'carol'}/project`,
    `/Users/${'dave'}/project`,
    `C:/Users/YOU/.ssh/id_ed25519.pub`,
    `C:${bs}Users${bs}USERNAME${bs}x`,
    `/home/runner/work`,
    `src/home/page.js and a/Users/path`
  ];
  const found = scanText('x.md', lines.join('\n'));
  assert.deepEqual(found.map((f) => f.at), ['x.md:1', 'x.md:2', 'x.md:3', 'x.md:4']);
  assert.ok(found.every((f) => f.kind === 'personal folder path'));
});

test('extra words are matched without regard to case', () => {
  const found = scanText('x.md', 'Written by Some Person\nnothing here', ['some person', '']);
  assert.equal(found.length, 1);
  assert.equal(found[0].at, 'x.md:1');
});

test('PNG text and EXIF blocks are found, a plain PNG is clean', () => {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const head = Buffer.alloc(4);
    head.writeUInt32BE(data.length);
    return Buffer.concat([head, body, Buffer.alloc(4)]); // crc is not checked
  };
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const plain = Buffer.concat([sig, chunk('IHDR', Buffer.alloc(13)), chunk('IDAT', Buffer.alloc(5)), chunk('IEND', Buffer.alloc(0))]);
  assert.deepEqual(scanImage(plain), []);
  const tagged = Buffer.concat([sig, chunk('IHDR', Buffer.alloc(13)), chunk('tEXt', Buffer.from('Author\0Somebody')), chunk('eXIf', Buffer.alloc(8)), chunk('IEND', Buffer.alloc(0))]);
  assert.equal(scanImage(tagged).length, 2);
  assert.deepEqual(scanImage(Buffer.from('not an image')), []);
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0, 20]), Buffer.from('Exif\0\0'), Buffer.alloc(20)]);
  assert.equal(scanImage(jpeg).length, 1);
  assert.doesNotThrow(() => scanImage(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0xff, 0xff, 0xff, 0, 0, 0, 0])));
});

test('scanProject walks folders, skips node_modules, and reports the file and line', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'mad-privacy-'));
  try {
    mkdirSync(path.join(dir, 'docs'));
    mkdirSync(path.join(dir, 'node_modules'));
    writeFileSync(path.join(dir, 'docs', 'a.md'), `fine\n${email('x', 'gmail.com')}\n`);
    writeFileSync(path.join(dir, 'node_modules', 'b.js'), `${email('y', 'gmail.com')}\n`);
    writeFileSync(path.join(dir, 'c.bin'), `${email('z', 'gmail.com')}\n`);
    const result = scanProject(dir, { git: false });
    assert.equal(result.found.length, 1);
    assert.equal(result.found[0].at, 'docs/a.md:2');
    assert.equal(result.files, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the project itself contains no personal information', () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const result = scanProject(root, { git: false });
  assert.deepEqual(result.found, []);
});
