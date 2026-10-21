#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// userdata.js reads AKI_MCP_DATA_DIR at import: an empty dir means the DEFAULT allowlist, never the machine owner's edited one.
process.env.AKI_MCP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'shell-mcp-test-'));
const { Shell } = await import('../scripts/shell-mcp.js');

async function run() {
  const shell = new Shell();

  // Fix 2: shell metacharacters INSIDE quotes are inert argv literals (execFile never spawns a shell), so a quoted `|`/`$` must NOT be rejected and must tokenize to the real bin.
  const parsed = shell.parse("grep -E '^(name|description):' file");
  assert.equal(parsed.bin, 'grep', 'quoted metacharacters must not block the grep command');
  assert.deepEqual(
    parsed.args,
    ['-E', '^(name|description):', 'file'],
    'quotes must be stripped, leaving the pattern as one argv literal',
  );

  // A quoted trailing `$` is likewise inert.
  assert.doesNotThrow(
    () => shell.parse("grep -E 'foo$' file"),
    'a quoted $ must not be rejected',
  );

  // The guard still holds for metacharacters OUTSIDE quotes: real chaining/redirection is rejected.
  assert.throws(
    () => shell.parse('a | b'),
    /chaining\/redirection/,
    'an unquoted pipe must still be rejected',
  );
  assert.throws(
    () => shell.parse('echo $HOME'),
    /chaining\/redirection/,
    'an unquoted $ must still be rejected',
  );

  // Default allowlist: git's write forms are refused, read forms pass, and the refusal says why.
  const allowed = (cmd) => { const { bin, args } = shell.parse(cmd); shell.checkPermission(bin, args); };
  for (const cmd of ['git branch -a', 'git branch', 'git tag', "git tag -l 'v*'", 'git remote -v', 'git remote get-url origin', 'git status', 'git log -5']) {
    assert.doesNotThrow(() => allowed(cmd), cmd);
  }
  for (const cmd of ['git branch -D x', 'git branch newbranch', 'git tag -d v1', 'git tag v9', 'git remote set-url origin x', 'git remote add o x', 'git diff --output=/tmp/x']) {
    assert.throws(() => allowed(cmd), /write form/, cmd);
  }
  assert.throws(() => allowed('git push'), /"git" is limited to: .*status/, 'a blocked subcommand names what is allowed');
  assert.throws(() => allowed('docker ps'), /not in the allowlist.*control panel/, 'a blocked binary says where to add it');

  // A failing command returns what it printed AND why it failed; a passing one returns stdout only.
  const node = (code) => shell.run(process.execPath, ['-e', code], process.cwd());
  const failed = await node('console.log("OUT-LINE");console.error("ERR-LINE");process.exit(3)');
  assert.equal(failed.isError, true);
  assert.equal(failed.content[0].text, '[exit code 3]\nOUT-LINE\nERR-LINE', 'stdout, stderr and exit code all survive');
  const silent = await node('process.exit(1)');
  assert.equal(silent.content[0].text, '[exit code 1]', 'no output still says why');
  const passed = await node('console.log("fine");console.error("warn")');
  assert.equal(passed.isError, undefined);
  assert.equal(passed.content[0].text, 'fine\n');
  assert.equal((await node('')).content[0].text, '(no output)');
  const flood = await node('for (let i=0;i<20000;i++) console.log("line "+i+" "+"z".repeat(30))');
  assert.match(flood.content[0].text.split('\n')[0], /^\[output cut: /, 'a flood is cut and announced on line 1');

  // Root enforcement must cover explicit file operands, not only process cwd.
  // "cat C:\\Windows\\win.ini" previously bypassed filesystem root checks.
  const isolated = fs.mkdtempSync(path.join(os.tmpdir(), 'shell-safe-root-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'shell-private-root-'));
  try {
    const safeFile = path.join(isolated, 'safe.txt');
    const secretFile = path.join(outside, 'private.txt');
    fs.writeFileSync(safeFile, 'OK');
    fs.writeFileSync(secretFile, 'PRIVATE');
    fs.writeFileSync(path.join(process.env.AKI_MCP_DATA_DIR, 'setting.json'), JSON.stringify({ folders: [isolated] }));
    assert.doesNotThrow(() => shell.checkOperandBoundaries([safeFile], isolated));
    assert.throws(() => shell.checkOperandBoundaries([secretFile], isolated), /outside the allowed roots/);
    const blocked = await shell.execute(`cat "${secretFile}"`, isolated);
    assert.equal(blocked.isError, true, 'shell must reject reading outside configured roots');
  } finally {
    fs.rmSync(isolated, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }

  console.log('shell-mcp.test.js: ok');
}

run().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
