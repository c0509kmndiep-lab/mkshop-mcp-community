// Funnel state, read one way for everyone. `AllowFunnel` is keyed by the public port (443), never by the local
// port being proxied, so matching the gatekeeper port against that key silently never matches — the proxy
// target under `Web` is the only place the local port appears.
import { execFile } from 'node:child_process';

const run = (args) =>
  new Promise((resolve) =>
    execFile('tailscale', args, { timeout: 8000, windowsHide: true }, (err, stdout, stderr) =>
      resolve({ ok: !err, out: err ? stderr || err.message : stdout }),
    ),
  );

async function query(args) {
  const { ok, out } = await run(args);
  if (!ok) return null;
  try {
    return JSON.parse(out);
  } catch {
    return null;
  }
}

export async function funnelStatus(gatePort) {
  const status = await query(['status', '--json']);
  if (!status) return { installed: false, running: false, host: null, funnel: false };

  const host = (status.Self?.DNSName || '').replace(/\.$/, '') || null;
  const running = status.BackendState === 'Running';
  const funnel = await query(['funnel', 'status', '--json']);
  const served = Object.entries(funnel?.Web ?? {}).some(
    ([target, cfg]) =>
      funnel.AllowFunnel?.[target] &&
      Object.values(cfg.Handlers ?? {}).some((h) => h.Proxy?.endsWith(`:${gatePort}`)),
  );
  return { installed: true, running, host, funnel: served };
}

export const enableFunnel = (gatePort) => run(['funnel', '--bg', String(gatePort)]);

export const bringUp = () => run(['up']);
