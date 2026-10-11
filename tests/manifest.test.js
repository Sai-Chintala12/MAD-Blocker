// Guards the security posture of manifest.json. If a future change adds a risky
// permission or CSP, this test fails and CI blocks the change.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = (p) => fileURLToPath(new URL('../' + p, import.meta.url));
const manifest = JSON.parse(readFileSync(root('manifest.json'), 'utf8'));

// Add to this list only after a deliberate review (and update docs/SECURITY.md).
const ALLOWED_PERMISSIONS = ['storage', 'declarativeNetRequest', 'activeTab'];
// Optional permissions are asked for at runtime, only when the user picks a feature that needs them.
const ALLOWED_OPTIONAL_PERMISSIONS = ['contentSettings'];

test('uses Manifest V3', () => {
  assert.equal(manifest.manifest_version, 3);
});

test('permissions are on the reviewed allowlist', () => {
  for (const p of manifest.permissions ?? []) {
    assert.ok(ALLOWED_PERMISSIONS.includes(p), `Unreviewed permission: ${p}`);
  }
});

test('optional permissions are on the reviewed allowlist', () => {
  for (const p of manifest.optional_permissions ?? []) {
    assert.ok(ALLOWED_OPTIONAL_PERMISSIONS.includes(p), `Unreviewed optional permission: ${p}`);
  }
});

test('no broad host access, optional hosts, or external messaging', () => {
  assert.equal(manifest.host_permissions, undefined, 'host_permissions must not be used');
  assert.equal(manifest.optional_host_permissions, undefined);
  assert.equal(manifest.externally_connectable, undefined, 'web pages must not be able to message the extension');
  assert.equal(manifest.web_accessible_resources, undefined);
  assert.equal(manifest.update_url, undefined);
});

test('CSP stays strict', () => {
  const csp = manifest.content_security_policy?.extension_pages ?? '';
  assert.ok(csp.includes("script-src 'self'"));
  for (const bad of ['unsafe-eval', 'unsafe-inline', 'http:', '*']) {
    assert.ok(!csp.includes(bad), `CSP contains ${bad}`);
  }
});

test('content scripts only target http(s) and are not run on every scheme', () => {
  for (const cs of manifest.content_scripts ?? []) {
    for (const m of cs.matches) assert.match(m, /^https?:\/\/\*\/\*$|^\*:\/\/\*\/\*$/);
  }
});

test('every file the manifest references exists', () => {
  const files = [
    manifest.background.service_worker,
    manifest.action.default_popup,
    manifest.options_page,
    ...Object.values(manifest.icons),
    ...Object.values(manifest.action.default_icon),
    ...manifest.declarative_net_request.rule_resources.map((r) => r.path),
    ...manifest.content_scripts.flatMap((c) => [...(c.js ?? []), ...(c.css ?? [])])
  ];
  for (const f of files) assert.ok(existsSync(root(f)), `Missing file: ${f}`);
});

test('no source file uses eval, new Function, innerHTML or remote scripts', async () => {
  const { readdirSync, statSync } = await import('node:fs');
  const { join } = await import('node:path');
  const walk = (dir) => readdirSync(dir).flatMap((n) => {
    const full = join(dir, n);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
  const banned = [/\beval\s*\(/, /new\s+Function\s*\(/, /\.innerHTML\s*=/, /\.outerHTML\s*=/, /insertAdjacentHTML/, /document\.write\s*\(/, /<script[^>]+src=["']https?:/i];
  for (const file of walk(root('src')).filter((f) => /\.(js|html)$/.test(f))) {
    const text = readFileSync(file, 'utf8');
    for (const re of banned) assert.ok(!re.test(text), `${file} matches ${re}`);
  }
});

test('local files referenced by the popup and options pages exist', () => {
  for (const page of [manifest.action.default_popup, manifest.options_page]) {
    const html = readFileSync(root(page), 'utf8');
    const dir = page.slice(0, page.lastIndexOf('/') + 1);
    for (const [, ref] of html.matchAll(/(?:src|href)="([^"#?]+)"/g)) {
      assert.ok(!/^https?:|^\/\//.test(ref), `${page} loads a remote file: ${ref}`);
      const full = fileURLToPath(new URL(dir + ref, new URL('../', import.meta.url)));
      assert.ok(existsSync(full), `${page} references a missing file: ${ref}`);
    }
  }
});
