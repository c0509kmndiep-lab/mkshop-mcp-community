import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const base = mkdtempSync(path.join(os.tmpdir(), 'mkshop-mcp-community-test-'));
const profile = path.join(base, 'profile');
const oldProfile = process.env.AKI_MCP_DATA_DIR;
const oldRoots = process.env.MCP_DATA_DIR;
process.env.AKI_MCP_DATA_DIR = profile;
delete process.env.MCP_DATA_DIR;

try {
  const [{ getRoots }, { loadAllowlistDirs, loadAllowlist, DEFAULT_ALLOWLIST }, { USER_DIR, SETTINGS_PATH }] = await Promise.all([
    import('../scripts/roots.js'),
    import('../scripts/allowlist.js'),
    import('../scripts/userdata.js'),
  ]);
  assert.equal(USER_DIR, profile);
  const roots = getRoots();
  assert.deepEqual(roots, [path.join(profile, 'workspace')]);
  assert.equal(existsSync(roots[0]), true);
  assert.deepEqual(loadAllowlistDirs(), []);
  assert.equal(roots.some(p => p === os.homedir()), false);

  // Default shell policy must remain inspection-first. Project-controlled package scripts/test runners
  // are execution surfaces and therefore require an explicit owner opt-in.
  assert.deepEqual(DEFAULT_ALLOWLIST.npm, ['list', 'ls', 'outdated']);
  assert.equal('npx' in DEFAULT_ALLOWLIST, false);
  assert.equal(DEFAULT_ALLOWLIST.npm.includes('run'), false);
  assert.equal(DEFAULT_ALLOWLIST.npm.includes('test'), false);

  // Malformed manual settings must fail closed. A non-array/non-null value used to reach shell-mcp
  // as an unrestricted entry because "not an array" was interpreted as "all subcommands".
  writeFileSync(SETTINGS_PATH, JSON.stringify({ shell: { allowlist: { overrides: { git: 42 }, revoked: [] } } }));
  const malformed = loadAllowlist();
  assert.equal('git' in malformed, false, 'malformed allowlist entry must be removed, never widened');

  console.log('PASS: isolated roots and execution-safe, fail-closed shell defaults');
} finally {
  if (oldProfile === undefined) delete process.env.AKI_MCP_DATA_DIR; else process.env.AKI_MCP_DATA_DIR = oldProfile;
  if (oldRoots === undefined) delete process.env.MCP_DATA_DIR; else process.env.MCP_DATA_DIR = oldRoots;
  rmSync(base, { recursive: true, force: true });
}
