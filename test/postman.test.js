#!/usr/bin/env node
// One entry for every Postman-only test (they live next to the code in scripts/postman/test/).
// Each runs in its own process: postman-mcp.test.js mocks cp.spawn and the pid file, which must not leak into the rest.
import { readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('../scripts/postman/test/', import.meta.url));
const files = readdirSync(dir).filter((f) => /\.test\.c?js$/.test(f)).sort();
for (const f of files) {
  console.log(`> ${f}`);
  execFileSync(process.execPath, [dir + f], { stdio: 'inherit' });
}
console.log(`postman.test.js: ${files.length} files ok`);
