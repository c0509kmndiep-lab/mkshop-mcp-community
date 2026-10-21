// Opens the default browser at `url`. The one unavoidable per-OS seam in this project — kept
// here as a single small helper instead of the `open` npm package, since 3 platform commands
// don't need a dependency.
import { execFile } from 'node:child_process';

const LAUNCHER = {
  darwin: ['open', []],
  win32: ['cmd', ['/c', 'start', '']], // empty '' is the `start` window-title arg; without it a url with spaces/special chars is misread as the title
  linux: ['xdg-open', []],
};

export function openBrowser(url) {
  const [cmd, prefixArgs] = LAUNCHER[process.platform] ?? LAUNCHER.linux;
  return new Promise((resolve, reject) => {
    execFile(cmd, [...prefixArgs, url], (err) => (err ? reject(err) : resolve()));
  });
}
