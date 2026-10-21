// Probe actual MCP SDK initialization and tool listing, without using OAuth credentials.
// Requires a private watchdog header at the gatekeeper route.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createToolsServer } from './tools-server.js';

const REQUIRED = ['aki__run_cmd', 'aki__gui_list_windows', 'aki__gui2_workflow_execute','aki__conpty_start'];
let current = null;
let cached = null;
let expires = 0;
export async function probeMcpTools(){
  if (cached && Date.now()<expires) return cached;
  if(current) return current;
  current=(async()=>{
    const server = createToolsServer();
    const client = new Client({ name:'mkshop-internal-health-probe',version:'1.0.0' });
    const [ct,st]=InMemoryTransport.createLinkedPair();
    try{
      await Promise.all([server.connect(st), client.connect(ct)]);
      const found=(await client.listTools()).tools.map(t=>t.name);
      const missing=REQUIRED.filter(n=>!found.includes(n));
      const result={healthy:missing.length===0,tools:found.length,missing,uptimeSeconds:Math.round(process.uptime())};
      if(result.healthy){cached=result;expires=Date.now()+12000;}
      return result;
    }finally{
      try{await client.close()}catch{}
      try{await server.close()}catch{}
    }
  })();
  try {return await current;} finally {current=null;}
}
