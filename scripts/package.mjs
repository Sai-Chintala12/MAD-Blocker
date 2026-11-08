// Builds the file you upload to the Chrome Web Store, or send to friends:   npm run package
//
//   npm run package -- --names "Your Name,yourhandle"    also refuse to build if those words appear
//
// Why a script and not "tar" or "Compress-Archive": the same command gives the same result on every
// computer, including Git Bash on Windows (its tar cannot make zip files), and the zip is always laid
// out the way the Web Store expects: manifest.json at the TOP of the zip, forward slashes in every
// name, and nothing else inside.
//
// What goes in:   manifest.json, rules/, src/, icons/
// What stays out: tests, docs, scripts, .git, .github, node_modules, package.json and _metadata
//                 (Chrome creates _metadata inside any folder you load as an unpacked extension).
//
// Safety checks before it writes anything:
//   - manifest.json and package.json must have the same version number
//   - every file the manifest points to must be in the zip
//   - the project files are scanned for personal information (same scan as "npm run check:privacy";
//     it does not look at Git history, so run that command too before you push)
//
// The zip is reproducible: the same files always give a byte-identical zip (fixed timestamps).
// Needs only Node. No dependencies.
import { readFileSync, writeFileSync, readdirSync, existsSync, lstatSync, mkdirSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { scanProject } from './check-privacy.mjs';

export const INCLUDE = Object.freeze(['manifest.json', 'rules', 'src', 'icons']);
const SKIP_NAMES = new Set(['Thumbs.db', 'desktop.ini']);
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const DOS_TIME = 0; //                        00:00:00
const DOS_DATE = (0 << 9) | (1 << 5) | 1; //   1980-01-01, the earliest zip date: keeps builds reproducible

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

/** CRC-32 of a Buffer, as zip files use it. */
export function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Makes a zip file from [{ name, data }]. Names use "/" and are written as UTF-8. */
export function buildZip(entries) {
  if (entries.length > 65535) throw new Error('Too many files for a zip');
  const parts = [];
  const central = [];
  let offset = 0;
  for (const { name, data } of entries) {
    if (data.length > MAX_FILE_BYTES) throw new Error(`${name} is too large (${data.length} bytes)`);
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const packed = deflateRawSync(data, { level: 9 });
    const deflated = packed.length < data.length;
    const body = deflated ? packed : data;
    const method = deflated ? 8 : 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); //            version needed
    local.writeUInt16LE(0x0800, 6); //        flags: file names are UTF-8
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); //            no extra field
    parts.push(local, nameBuf, body);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE((3 << 8) | 20, 4); // made by Unix, spec 2.0
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt16LE(method, 10);
    entry.writeUInt16LE(DOS_TIME, 12);
    entry.writeUInt16LE(DOS_DATE, 14);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(body.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(nameBuf.length, 28);
    // extra field, comment, disk number, internal attributes: all zero
    entry.writeUInt32LE((0o100644 << 16) >>> 0, 38); // regular file, rw-r--r--
    entry.writeUInt32LE(offset, 42);
    central.push(entry, nameBuf);
    offset += local.length + nameBuf.length + body.length;
  }
  const centralSize = central.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, ...central, end]);
}

/** The files that belong in the store package, sorted by name. */
export function collectFiles(root) {
  const found = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || SKIP_NAMES.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) found.push(full); // links and other special files are never included
    }
  };
  for (const item of INCLUDE) {
    const full = path.join(root, item);
    if (!existsSync(full)) throw new Error(`"${item}" is missing from the project folder`);
    if (lstatSync(full).isDirectory()) walk(full);
    else found.push(full);
  }
  return found
    .map((file) => ({ name: path.relative(root, file).split(path.sep).join('/'), data: readFileSync(file) }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** Every file the manifest points to. */
export function manifestFiles(manifest) {
  const files = [
    manifest.background?.service_worker,
    manifest.action?.default_popup,
    manifest.options_page,
    ...Object.values(manifest.icons ?? {}),
    ...Object.values(manifest.action?.default_icon ?? {}),
    ...(manifest.declarative_net_request?.rule_resources ?? []).map((r) => r.path),
    ...(manifest.content_scripts ?? []).flatMap((c) => [...(c.js ?? []), ...(c.css ?? [])])
  ];
  return [...new Set(files.filter((f) => typeof f === 'string'))];
}

function fail(message) {
  console.error(`Not built: ${message}`);
  process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const args = process.argv.slice(2);
  const nameIndex = args.indexOf('--names');
  const names = nameIndex >= 0 ? (args[nameIndex + 1] ?? '').split(',').map((s) => s.trim()).filter(Boolean) : [];

  const manifest = JSON.parse(readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  if (manifest.version !== pkg.version) {
    fail(`manifest.json says version ${manifest.version} but package.json says ${pkg.version}. Make them the same.`);
  }

  let files;
  try {
    files = collectFiles(root);
  } catch (err) {
    fail(err.message);
  }
  const included = new Set(files.map((f) => f.name));
  const missing = manifestFiles(manifest).filter((f) => !included.has(f));
  if (missing.length > 0) fail(`the manifest points to files that are not in the package: ${missing.join(', ')}`);

  const privacy = scanProject(root, { names, git: false });
  if (privacy.found.length > 0) {
    console.error('Not built: personal information was found in the project files:');
    for (const f of privacy.found) console.error(`  ${f.at}  [${f.kind}]  ${f.text}`);
    console.error('Fix these, or run  npm run check:privacy  for details.');
    process.exit(1);
  }

  const zip = buildZip(files);
  mkdirSync(path.join(root, 'dist'), { recursive: true });
  const file = `MAD-Blocker-v${manifest.version}.zip`;
  writeFileSync(path.join(root, 'dist', file), zip);
  console.log(`Wrote dist/${file}  (${files.length} files, ${Math.round(zip.length / 1024)} KB)`);
  console.log('Project files were scanned for personal information. Git history was NOT: also run  npm run check:privacy  before you push.');
}
