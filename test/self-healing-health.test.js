#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
const home=fs.mkdtempSync(path.join(os.tmpdir(),'mkshop-heal-test-'));
process.env.AKI_MCP_DATA_DIR=home;
process.env.GATEKEEPER_PORT='0';
fs.writeFileSync(path.join(home,'setting.json'),JSON.stringify({folders:[process.cwd()]}));
const {startGatekeeper}=await import('../scripts/gatekeeper.js');
const server=startGatekeeper(null,()=>{throw Error('fatal listen')});
try{
 await once(server,'listening');
 const root='http://127.0.0.1:'+server.address().port;
 const key=fs.readFileSync(path.join(home,'internal-health.key'),'utf8').trim();
 assert.match(key,/^[a-f0-9]{64}$/);
 const noKey=await fetch(root+'/_internal/mcp-health');
 assert.equal(noKey.status,404);
 const wrong=await fetch(root+'/_internal/mcp-health',{headers:{'X-MKShop-Health-Key':'0'.repeat(64)}});
 assert.equal(wrong.status,404);
 const valid=await fetch(root+'/_internal/mcp-health',{headers:{'X-MKShop-Health-Key':key},signal:AbortSignal.timeout(4000)});
 assert.equal(valid.status,200);
 const body=await valid.json();
 assert.equal(body.ok,true);
 assert.ok(body.tools>=35,'Expected MCP SDK handshake with tool registry: '+JSON.stringify(body));
 assert.equal(body.missing.length,0);
 const status=await fetch(root+'/mcp',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
 assert.equal(status.status,401,'OAuth protection on regular MCP must remain intact');
 console.log('SELF_HEAL_GATEKEEPER_PASS real MCP SDK tools/list, watchdog secret, OAuth unchanged, toolCount='+body.tools);
}finally{
 await new Promise(resolve=>server.close(resolve));
 fs.rmSync(home,{recursive:true,force:true});
}
