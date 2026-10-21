import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createToolsServer } from '../scripts/tools-server.js';

const server = createToolsServer();
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
await server.connect(serverTransport);
const client = new Client({ name:'gui-live-smoke', version:'1.0' });
await client.connect(clientTransport);

const catalog = await client.listTools();
const gui = catalog.tools.filter(x => x.name.startsWith('aki__gui_'));
assert.equal(gui.length, 15, 'GUI tool count');
console.log('GUI_MCP_LIST=PASS tools=' + gui.length);

const list = await client.callTool({ name: 'aki__gui_list_windows', arguments: {} });
assert.equal(list.isError, undefined, 'GUI list failed');
const windows = JSON.parse(list.content.find(x => x.type === 'text').text);
const win = windows.find(w => w.title && w.width > 200 && w.height > 100 && w.processName === 'explorer');
assert.ok(win, 'Explorer window missing');
console.log('GUI_MCP_WINDOW=PASS ' + win.title + ' hwnd=' + win.hwnd);

const inspect = await client.callTool({ name: 'aki__gui_inspect',
  arguments: { hwnd:win.hwnd, depth:1 } });
assert.equal(inspect.isError, undefined, 'GUI inspect failed');
const tree = JSON.parse(inspect.content.find(x => x.type === 'text').text);
assert.ok(tree.windows[0].elementCount > 0);
console.log('GUI_MCP_INSPECT=PASS elements=' + tree.windows[0].elementCount);

const snap = await client.callTool({ name: 'aki__gui_screenshot',
  arguments: { hwnd:win.hwnd } });
assert.equal(snap.isError, undefined, 'GUI screenshot failed');
const pic = snap.content.find(x => x.type === 'image');
assert.ok(pic && pic.mimeType === 'image/png', 'missing PNG image response');
assert.ok(Buffer.from(pic.data, 'base64').subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])));
console.log('GUI_MCP_SCREENSHOT=PASS bytes=' + Buffer.from(pic.data,'base64').length);
await client.close();
await server.close();
