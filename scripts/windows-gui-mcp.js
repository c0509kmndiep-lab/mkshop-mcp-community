// Windows native GUI Automation bridge, backed by Microsoft's winapp CLI 0.7.1+.
// Calls an executable with argv (never a shell). All mutating operations require a specific HWND.
import cp from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ok, fail } from './mcp-tool.js';
import { USER_DIR } from './userdata.js';

const HWND = z.number().int().positive();
const STRING = z.string().min(1);
const CLI = process.env.AKI_WINAPP_PATH ||
  path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
    'Microsoft', 'WindowsApps', 'winapp.exe');
const MAX_TEXT = 60000;

export function cliArguments(verb, items = [], hwnd, app) {
  const args = ['ui', verb, ...items];
  if (hwnd) args.push('--window', String(hwnd));
  else if (app) args.push('--app', app);
  args.push('--json');
  return args;
}

export function runWinApp(args, timeoutMs = 45000) {
  if (process.platform !== 'win32') return Promise.reject(new Error('Windows GUI automation requires Windows'));
  return new Promise((resolve, reject) => {
    cp.execFile(CLI, args, {
      timeout: timeoutMs,
      maxBuffer: 12 * 1024 * 1024,
      windowsHide: true,
      env: { ...process.env, WINAPP_CLI_TELEMETRY_OPTOUT: '1' },
    }, (error, stdout, stderr) => {
      if (error) {
        const detail = String(stderr || stdout || error.message).trim().slice(0, 12000);
        reject(new Error('winapp GUI failed (exit ' + (error.code ?? '?') + '): ' + detail));
        return;
      }
      resolve(String(stdout || '').trim());
    });
  });
}

function trimOutput(value) {
  return value.length > MAX_TEXT
    ? value.slice(0, MAX_TEXT) + '\n[TRUNCATED; narrow HWND/selector or reduce depth]'
    : value;
}

function addTextTool(server, name, description, inputSchema, argv) {
  server.registerTool(name, { title: name, description, inputSchema }, async (v) => {
    try { return ok(trimOutput(await runWinApp(argv(v)))); }
    catch (e) { return fail(e); }
  });
}

export function register(server) {
  addTextTool(server, 'gui_list_windows',
    'List Windows desktop windows with HWND/PID/title/foreground, including non-browser apps. Read-only.',
    { app: STRING.optional() },
    (v) => cliArguments('list-windows', [], null, v.app));

  addTextTool(server, 'gui_inspect',
    'Inspect native Windows UI Automation tree, semantic selectors, bounds and accessibility properties. Specify HWND from gui_list_windows. Read-only; use low depth first.',
    { hwnd: HWND.optional(), app: STRING.optional(), depth: z.number().int().min(1).max(8).optional(),
      interactive: z.boolean().optional() },
    (v) => cliArguments('inspect', [
      ...(v.depth ? ['--depth', String(v.depth)] : ['--depth', '2']),
      ...(v.interactive ? ['--interactive'] : []),
    ], v.hwnd, v.app));

  addTextTool(server, 'gui_search',
    'Find accessibility controls by name, selector or automation ID within a known HWND. Read-only.',
    { hwnd: HWND, query: STRING },
    (v) => cliArguments('search', [v.query], v.hwnd));

  addTextTool(server, 'gui_get_value',
    'Read text/value of a specific accessible element in a known window without changing UI state.',
    { hwnd: HWND, selector: STRING },
    (v) => cliArguments('get-value', [v.selector], v.hwnd));

  addTextTool(server, 'gui_get_focused',
    'Read the currently focused UI Automation element inside a specific HWND.',
    { hwnd: HWND },
    (v) => cliArguments('get-focused', [], v.hwnd));

  addTextTool(server, 'gui_invoke',
    'Activate an accessible control using UI Automation patterns. Changes app state; select HWND and inspect selector first.',
    { hwnd: HWND, selector: STRING },
    (v) => cliArguments('invoke', [v.selector], v.hwnd));

  addTextTool(server, 'gui_set_value',
    'Set a text/number control using UIA ValuePattern where possible (no keyboard focus required). Changes app state.',
    { hwnd: HWND, selector: STRING, value: z.string() },
    (v) => cliArguments('set-value', [v.selector, v.value], v.hwnd));

  addTextTool(server, 'gui_focus',
    'Bring a specific accessible UI element to foreground and verify keyboard focus.',
    { hwnd: HWND, selector: STRING },
    (v) => cliArguments('focus', [v.selector], v.hwnd));

  addTextTool(server, 'gui_hover',
    'Move mouse cursor over an element to reveal hover controls or tooltips. Foreground unlocked desktop required.',
    { hwnd: HWND, selector: STRING },
    (v) => cliArguments('hover', [v.selector], v.hwnd));

  addTextTool(server, 'gui_click',
    'Real mouse click at an element selector or x,y pixel location within a specific HWND. Foreground unlocked desktop required. Changes app state.',
    { hwnd: HWND, selector: STRING.optional(), x: z.number().int().optional(), y: z.number().int().optional() },
    (v) => {
      if (!v.selector && (!Number.isInteger(v.x) || !Number.isInteger(v.y))) throw new Error('provide selector or both x and y');
      // WinApp ui click only accepts selectors; drag from==to sends real point mouse press/release.
      if (!v.selector) { const point=String(v.x)+','+String(v.y);return cliArguments('drag',[point,point],v.hwnd); }
      return cliArguments('click',[v.selector],v.hwnd);
    });

  addTextTool(server, 'gui_drag',
    'Real mouse drag between element selectors or x,y coordinates within a specific HWND. Foreground unlocked desktop required.',
    { hwnd: HWND, from: STRING, to: STRING, holdMs: z.number().int().min(0).max(10000).optional() },
    (v) => cliArguments('drag', [v.from, v.to,
      ...(v.holdMs ? ['--hold-ms', String(v.holdMs)] : [])], v.hwnd));

  addTextTool(server, 'gui_send_keys',
    'Send keys to a specific HWND. Grammar: enter, tab, ctrl+a, down down enter; use verbatim for literal text. send-input requires unlocked foreground desktop; default post-message targets window.',
    { hwnd: HWND, keys: STRING, verbatim: z.boolean().optional(), viaSendInput: z.boolean().optional(),
      target: STRING.optional() },
    (v) => cliArguments('send-keys', [v.keys,
      ...(v.verbatim ? ['--verbatim'] : []),
      ...(v.viaSendInput ? ['--via', 'send-input'] : []),
      ...(v.target ? ['--target', v.target] : []),
    ], v.hwnd));

  addTextTool(server, 'gui_scroll',
    'Scroll an accessibility element in a given window via UIA ScrollPattern. May change visible UI.',
    { hwnd: HWND, selector: STRING.optional(), direction: z.enum(['up', 'down', 'left', 'right']).optional(),
      to: z.enum(['top', 'bottom']).optional(), wheel: z.number().int().min(-30).max(30).optional() },
    (v) => {
      if (!v.direction && !v.to && !v.wheel) throw new Error('direction, to or wheel required');
      return cliArguments('scroll', [
        ...(v.selector ? [v.selector] : []),
        ...(v.direction ? ['--direction', v.direction] : []),
        ...(v.to ? ['--to', v.to] : []),
        ...(v.wheel ? ['--wheel', String(v.wheel)] : []),
      ], v.hwnd);
    });

  addTextTool(server, 'gui_wait_for',
    'Wait for a UI Automation element to appear inside a specific HWND. Read-only.',
    { hwnd: HWND, selector: STRING, timeoutMs: z.number().int().min(100).max(30000).optional(),
      value: STRING.optional() },
    (v) => cliArguments('wait-for', [v.selector,
      ...(v.timeoutMs ? ['--timeout', String(v.timeoutMs)] : []),
      ...(v.value ? ['--value', v.value] : []),
    ], v.hwnd));

  server.registerTool('gui_screenshot', {
    title: 'Screenshot Windows App',
    description: 'Capture a native Windows window and return PNG image content directly to the model. Default uses --capture-screen, which brings the target window to foreground for reliable pixels; set captureScreen=false for offscreen window composition (which may be blank). Require HWND; may reveal sensitive on-screen data.',
    inputSchema: { hwnd: HWND, selector: STRING.optional(), captureScreen: z.boolean().optional() },
  }, async ({ hwnd, selector, captureScreen }) => {
    const dir = path.join(USER_DIR, 'gui-captures');
    const filename = path.join(dir, randomUUID() + '.png');
    try {
      await fs.mkdir(dir, { recursive: true });
      const args = cliArguments('screenshot', [
        ...(selector ? [selector] : []),
        '--output', filename,
        ...(captureScreen !== false ? ['--capture-screen'] : []),
      ], hwnd);
      const result = await runWinApp(args, 45000);
      const stat = await fs.stat(filename);
      if (!stat.size || stat.size > 8 * 1024 * 1024) throw new Error('invalid screenshot size ' + stat.size);
      const data = await fs.readFile(filename);
      return { content: [
        { type: 'text', text: 'Windows GUI screenshot HWND=' + hwnd + '\n' + trimOutput(result) },
        { type: 'image', data: data.toString('base64'), mimeType: 'image/png' },
      ] };
    } catch (e) { return fail(e); }
    finally { await fs.unlink(filename).catch(() => {}); }
  });
}
