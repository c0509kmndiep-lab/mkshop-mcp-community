// Factory for the one shared McpServer hosting every in-house tool (shell, agy, kiro, search,
// filesystem) — replaces local-tools-mcp.js's role as a separately spawned stdio child now that
// mcp-hub is gone (docs/plan/done/2.0.0-improve.md #7, Stage 2 phase 2). Each domain's logic stays in
// its own register(server) module behind a stable contract, unchanged from Stage 1.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { register as registerShell } from './shell-mcp.js';
import { register as registerAgy } from './agy-mcp.js';
import { register as registerKiro } from './kiro-mcp.js';
import { register as registerSearch } from './search-mcp.js';
import { register as registerFilesystem } from './filesystem-mcp.js';
import { register as registerPostman } from './postman/postman-mcp.js';
import { register as registerCdp } from './cdp-mcp.js';
import { register as registerPort } from './port-mcp.js';
import { register as registerGit } from './git-mcp.js';
import { register as registerSqlite } from './sqlite-mcp.js';
import { register as registerChrome } from './chrome-mcp.js';
import { register as registerFetch } from './fetch-mcp.js';
import { register as registerSystem } from './system-mcp.js';
import { register as registerWindowsGui } from './windows-gui-mcp.js';
import { register as registerGui2 } from './gui2-mcp.js';
import { register as registerTask } from './task-mcp.js';
import { register as registerTerminal } from './terminal-mcp.js';
import { register as registerConpty } from './conpty-mcp.js';
import { register as registerRuleContext, RULE_CONTEXT_INSTRUCTIONS } from './rule-context-mcp.js';

// Tools are prefixed with `aki__` centrally here so served tool names
// (aki__run_cmd, aki__find_path, …) are consistent across all connected AI clients.
function prefixedServer(server, prefix) {
  return new Proxy(server, {
    get(target, prop, receiver) {
      if (prop !== 'registerTool') return Reflect.get(target, prop, receiver);
      return (name, ...rest) => target.registerTool(`${prefix}${name}`, ...rest);
    },
  });
}

export function createToolsServer() {
  const server = new McpServer(
    { name: 'aki-mcp', version: '2.0.2', title: 'MKShop MCP', icons: [{ src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAwBAMAAAClLOS0AAAAMFBMVEX///////79///+/f38/fzx7e3IsLG2e35MQkPmCRXkBhPiBxPiAg3LERs3NzcuLi/qWQlPAAAB70lEQVR42t3SzWsTQRjH8e/sLiQGkkwI9CA2Wd/AguKmUQ+ipX+AgkdBRC++nIwv2EMPgpdSeijkKlIoePDlYq+eatWCh5JNKwUhxph6kiYdNmBa3N3xkGTjwb+gz2EY5jO/B2Z4YJ+XwHQgcAGKwBrWJGy7EQ+WYcI0b4JfX+aIfQz08/FsAb42XAtxGxKXwfv5rCETNT02y941sCBwOeMkXcdsfTNqhpffYXfJxwIyojK6g3+iaqda783PSsxdWMYA0PJWU3y6Lzuy5N9VHNhS9IDAs4vjLdQiZ20I37oDMDZzqXNVXYixXkJMX2QAOv+oc0+IRImr/U59EC1vvZ32FiUOhEtuBIjfU4JCTHVvIKZPEkFe+hMNEmmAva3+l1grP46mK1rZzdqMAuIpf5gog9QZBSCePCgO4VcO1FgDQDefVocQZhWdBamAeNy75EQQlDMiUwMQc4WYLSMw3uXCg18A9GZJz3yIwM9lO8kcQDyuMK440QODspgPATF/GLqjMgLj9fkVBejad9CPP/ZAYNBeSAIkXryUkJ2MEn5Q0QD69EQZuoecARDWFQDudgX08Q0MoO0CNHo3Nl5JeAgGmEUHqAMZKeBUGXavOxb6DRoFuCN30AH+6ir8+c80m/8O9VrvqLcrMpjyfV1/AcgisvB3rhP6AAAAAElFTkSuQmCC', mimeType: 'image/png', sizes: ['48x48'] }] },
    { instructions: RULE_CONTEXT_INSTRUCTIONS },
  );
  const prefixed = prefixedServer(server, 'aki__');
  for (const register of [
    registerRuleContext,
    registerShell,
    registerAgy,
    registerKiro,
    registerSearch,
    registerFilesystem,
    registerPostman,
    registerCdp,
    registerChrome,
    registerFetch,
    registerSystem,
    registerWindowsGui,
    registerGui2,
    registerTask,
    registerTerminal,
    registerConpty,
    registerPort,
    registerGit,
    registerSqlite,
  ]) register(prefixed);
  return server;
}
