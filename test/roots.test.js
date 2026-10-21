#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveUnderRoot, resolveRealWritable, resolveRealWritableDir, getRoots, containedIn } from '../scripts/roots.js';

async function run() {
  const home = os.homedir();
  const homeInRoots = getRoots().some((root) => containedIn(home, root));

  // Fix 1: a bare "~" must expand to the home directory, not a literal ".../~" path.
  if (homeInRoots) {
    assert.equal(resolveUnderRoot('~'), home, '"~" must expand to os.homedir()');
    assert.equal(
      resolveUnderRoot('~/x'),
      path.join(home, 'x'),
      '"~/x" must expand under os.homedir()',
    );
  }

  // A drive root must include every descendant, not only the drive root itself.
  // Keep sibling prefix protection for narrower roots (C:\\work != C:\\workspace).
  if (process.platform === 'win32') {
    assert.equal(containedIn('C:\\Users\\demo', 'C:\\'), true, 'drive root covers descendants');
    assert.equal(containedIn('d:\\Work\\hub', 'D:\\'), true, 'drive comparison ignores case');
    assert.equal(containedIn('C:\\workspace', 'C:\\work'), false, 'sibling prefix must be rejected');
    assert.equal(containedIn('D:\\work\\file.txt', 'D:\\work'), true, 'ordinary directory still works');
  }

  // The boundary still holds: an expanded "~/..." path that lands outside every root must throw.
  const escape = path.join(home, '..', '..', 'definitely-not-a-configured-root-xyz');
  const escapeTarget = '~/' + path.relative(home, escape);
  if (!getRoots().some((root) => containedIn(escape, root))) {
    assert.throws(
      () => resolveUnderRoot(escapeTarget),
      /outside the allowed roots/,
      'a ~/... path that escapes all roots must still throw',
    );
  } else {
    assert.equal(resolveUnderRoot(escapeTarget), escape, 'a drive-wide root intentionally allows same-drive descendants');
  }

  // create_directory is mkdir -p: resolveRealWritableDir must resolve a target whose parent chain is missing several levels, where resolveRealWritable (single-level only) rejects it.
  if (homeInRoots) {
    const base = fs.mkdtempSync(path.join(home, '.aki-mkdirp-test-'));
    try {
      const deep = path.join(base, 'a', 'b', 'c', 'd');
      const real = await resolveRealWritableDir(deep);
      assert.equal(
        real,
        path.join(fs.realpathSync(base), 'a', 'b', 'c', 'd'),
        'resolveRealWritableDir must resolve a deep path built on the nearest existing ancestor',
      );
      await assert.rejects(
        resolveRealWritable(deep),
        /parent directory does not exist/,
        'resolveRealWritable must still reject a multi-level-missing path',
      );
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  }

  // The root boundary still holds for the mkdir -p resolver.
  if (!getRoots().some((root) => containedIn(escape, root))) {
    await assert.rejects(
      resolveRealWritableDir(escapeTarget),
      /outside the allowed roots/,
      'resolveRealWritableDir must reject a path that escapes every root',
    );
  }

  console.log('roots.test.js: ok');
}

run().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
