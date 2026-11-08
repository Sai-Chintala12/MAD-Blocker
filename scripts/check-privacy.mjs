// Looks for personal information before you push or publish. Run:  npm run check:privacy
//
//   npm run check:privacy -- --names "Your Name,yourhandle"
//
// What it checks:
//   1. Email addresses in the project files (placeholders such as you@example.com and GitHub
//      "noreply" addresses are fine).
//   2. Personal folder paths such as C:\Users\<name>\ or /home/<name>/ (placeholders are fine).
//   3. Any extra words you pass with --names (your real name, user name, email start...), ignoring case.
//   4. Hidden metadata in images (PNG text and EXIF blocks, JPEG EXIF). Screenshots can carry it.
//   5. Git: the email in your Git settings and in every commit author or committer line.
//      Once a commit is pushed to a public repo, its email is public for good. Check BEFORE you push.
//
// It only reads. It sends nothing anywhere. Exit code 1 means something was found.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
const OK_EMAIL_DOMAIN = /(^|\.)(example\.(com|org|net)|users\.noreply\.github\.com)$/i;
const OK_EMAIL_LOCAL = /^(noreply|no-reply)$/i;
// A user name stops at spaces, slashes and the punctuation Windows does not allow in user names.
const NAME = '([^\\\\/\\s"\'`<>|*?:,;=+()\\[\\]]+)';
const USER_PATH_RE = [
  new RegExp(`\\b[A-Za-z]:[\\\\/]+Users[\\\\/]+${NAME}`, 'g'), // Windows, with either kind of slash
  new RegExp(`(?<![\\w.:-])/Users/${NAME}`, 'g'), //             macOS (the ":" stops it matching C:/Users twice)
  new RegExp(`(?<![\\w.:-])/home/${NAME}`, 'g') //               Linux
];
const OK_PATH_NAME = /^(you|your-?name|user-?name|username|user|name|me|<.*>|%.*%|\$.*|public|default|shared|runner)$/i;
const TEXT_EXT = new Set(['.js', '.mjs', '.cjs', '.json', '.md', '.html', '.css', '.svg', '.txt', '.yml', '.yaml', '.xml', '.cfg', '.toml']);
const TEXT_NAMES = new Set(['LICENSE', '.gitignore', '.gitattributes', '.npmrc', '.editorconfig']);
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg']);
const SKIP_DIRS = new Set(['node_modules', '.git', '_metadata', 'coverage']);

/** Problems found in one text file. Pure, so it can be tested. */
export function scanText(file, text, names = []) {
  const found = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    const at = `${file}:${i + 1}`;
    for (const m of line.matchAll(EMAIL_RE)) {
      const [local, domain] = [m[0].slice(0, m[0].lastIndexOf('@')), m[0].slice(m[0].lastIndexOf('@') + 1)];
      if (OK_EMAIL_DOMAIN.test(domain) || OK_EMAIL_LOCAL.test(local)) continue;
      found.push({ at, kind: 'email address', text: m[0] });
    }
    for (const re of USER_PATH_RE) {
      for (const m of line.matchAll(re)) {
        if (!OK_PATH_NAME.test(m[1])) found.push({ at, kind: 'personal folder path', text: m[0] });
      }
    }
    for (const name of names) {
      if (name && line.toLowerCase().includes(name.toLowerCase())) found.push({ at, kind: `your word "${name}"`, text: line.trim().slice(0, 100) });
    }
  });
  return found;
}

/** Hidden metadata in an image file (a Buffer). Returns a list of short descriptions. */
export function scanImage(buffer) {
  const found = [];
  if (buffer.length > 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    for (let pos = 8; pos + 8 <= buffer.length;) {
      const length = buffer.readUInt32BE(pos);
      const type = buffer.toString('latin1', pos + 4, pos + 8);
      if (['tEXt', 'zTXt', 'iTXt', 'eXIf'].includes(type)) found.push(`PNG ${type} block (${length} bytes)`);
      if (type === 'IEND' || length > buffer.length) break;
      pos += 12 + length;
    }
  } else if (buffer.length > 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    if (buffer.subarray(0, Math.min(buffer.length, 65536)).includes(Buffer.from('Exif\0\0', 'latin1'))) found.push('JPEG EXIF block');
  }
  return found;
}

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) yield* walk(path.join(dir, entry.name));
    } else {
      yield path.join(dir, entry.name);
    }
  }
}

const isNoreply = (email) => /@users\.noreply\.github\.com$/i.test(email.trim()) || OK_EMAIL_LOCAL.test(email.split('@')[0]);

/** Checks Git settings and commit history. Returns { found, notes }. */
function scanGit(root) {
  const found = [];
  const notes = [];
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  try {
    git('rev-parse', '--is-inside-work-tree');
  } catch {
    return { found, notes: ['Git: this folder is not a Git repository (or Git is not installed), so no commit history was checked.'] };
  }
  try {
    const email = git('config', 'user.email');
    if (email && !isNoreply(email)) found.push({ at: 'git config user.email', kind: 'email address in Git settings', text: email });
    if (!email) notes.push('Git: no user.email is set yet. Set a GitHub "noreply" address before your first commit.');
  } catch { notes.push('Git: no user.email is set yet. Set a GitHub "noreply" address before your first commit.'); }
  try {
    const log = git('log', '--all', '--format=%an <%ae>%n%cn <%ce>');
    const people = new Set(log.split('\n').filter(Boolean));
    for (const person of people) {
      const email = /<(.*)>$/.exec(person)?.[1] ?? '';
      if (email && !isNoreply(email)) found.push({ at: 'git log', kind: 'email address in commit history', text: person });
    }
    notes.push(`Git: checked ${people.size} distinct author or committer line(s) in the history.`);
  } catch { notes.push('Git: there are no commits yet.'); }
  return { found, notes };
}

export function scanProject(root, { names = [], git = true } = {}) {
  const found = [];
  let files = 0;
  for (const file of walk(root)) {
    const rel = path.relative(root, file).split(path.sep).join('/');
    const ext = path.extname(file).toLowerCase();
    if (statSync(file).size > 5_000_000) continue;
    if (TEXT_EXT.has(ext) || TEXT_NAMES.has(path.basename(file))) {
      files++;
      for (const f of scanText(rel, readFileSync(file, 'utf8'), names)) found.push(f);
    } else if (IMAGE_EXT.has(ext)) {
      files++;
      for (const d of scanImage(readFileSync(file))) found.push({ at: rel, kind: 'hidden image metadata', text: d });
    }
  }
  const gitResult = git ? scanGit(root) : { found: [], notes: [] };
  found.push(...gitResult.found);
  return { found, files, notes: gitResult.notes };
}

// ---- command line --------------------------------------------------------------------------------
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const nameIndex = args.indexOf('--names');
  const names = nameIndex >= 0 ? (args[nameIndex + 1] ?? '').split(',').map((s) => s.trim()).filter(Boolean) : [];
  const root = fileURLToPath(new URL('../', import.meta.url));
  const { found, files, notes } = scanProject(root, { names, git: !args.includes('--no-git') });
  console.log(`Checked ${files} project files${names.length ? ` for ${names.length} extra word(s)` : ''}.`);
  for (const n of notes) console.log(n);
  if (found.length === 0) {
    console.log('Nothing personal found.');
    if (names.length === 0) console.log('Tip: add your own words, for example  --names "Your Name,yourhandle,yourmailname"');
  } else {
    console.log(`\nFound ${found.length} thing(s) to look at:`);
    for (const f of found) console.log(`  ${f.at}  [${f.kind}]  ${f.text}`);
    console.log('\nIf one is an example or a placeholder, change it to one (for example you@example.com).');
    if (found.some((f) => f.at.startsWith('git'))) {
      console.log('For Git: set a private GitHub address with  git config --global user.email "ID+username@users.noreply.github.com"');
      console.log('Commits that are already made keep the old address. Fix the history BEFORE you push anything public.');
    }
    process.exitCode = 1;
  }
}
