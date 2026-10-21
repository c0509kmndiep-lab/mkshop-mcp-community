#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const data=fs.mkdtempSync(path.join(os.tmpdir(),'aki-conpty-test-'));
process.env.AKI_MCP_DATA_DIR=data;
fs.writeFileSync(path.join(data,'setting.json'),JSON.stringify({
 folders:[process.cwd()],shell:{allowlist:{added:['node','cmd.exe'],revoked:[]}}
}));
const {createToolsServer}=await import('../scripts/tools-server.js');
const {conptyRpc}=await import('../scripts/conpty-mcp.js');
const {Client}=await import('@modelcontextprotocol/sdk/client/index.js');
const {InMemoryTransport}=await import('@modelcontextprotocol/sdk/inMemory.js');
const server=createToolsServer();
for(const n of ['start','write','read','screen','resize','manage']){
  assert.ok(server._registeredTools['aki__conpty_'+n],'Unregistered: '+n);
}
if(process.platform!=='win32'){console.log('conpty-mcp.test.js: registration PASS, runtime SKIP');process.exit(0);}
const [ct,st]=InMemoryTransport.createLinkedPair();
const client=new Client({name:'conpty-e2e',version:'1.0.0'});
await Promise.all([server.connect(st),client.connect(ct)]);
let id=null;
async function call(name,args){
 const r=await client.callTool({name:'aki__conpty_'+name,arguments:args});
 assert.equal(r.isError,undefined,JSON.stringify(r));
 return JSON.parse(r.content[0].text);
}
try{
 const names=(await client.listTools()).tools.map(t=>t.name);
 for(const n of ['start','write','read','screen','resize','manage']){
   assert.ok(names.includes('aki__conpty_'+n));
 }
 const s=await call('start',{command:'cmd.exe /Q /K',cwd:process.cwd(),cols:80,rows:24});
 id=s.sessionId;
 assert.ok(s.pid>0);
 await call('write',{sessionId:id,input:'set CPT=84'});
 await call('write',{sessionId:id,input:'echo CPT_%CPT%'});
 let text='';
 for(let i=0;i<30;i++){
   const r=await call('read',{sessionId:id});
   text+=r.text;
   if(text.includes('CPT_84'))break;
   await new Promise(resolve=>setTimeout(resolve,120));
 }
 assert.ok(text.includes('CPT_84'),'Did not execute command');
 await call('resize',{sessionId:id,cols:110,rows:35});
 let screen=await call('screen',{sessionId:id});
 for(let i=0;i<8&&!screen.screen.includes('CPT_84');i++){
   await new Promise(resolve=>setTimeout(resolve,100));
   screen=await call('screen',{sessionId:id});
 }
 assert.equal(screen.lines.length,35);
 assert.ok(screen.screen.includes('CPT_84'));
 const endpoint=JSON.parse(fs.readFileSync(path.join(data,'conpty','endpoint.json'),'utf8'));
 const unauthorized=await fetch('http://127.0.0.1:'+endpoint.port+'/health');
 assert.equal(unauthorized.status,401);
 await call('manage',{action:'stop',sessionId:id});
 await call('manage',{action:'delete',sessionId:id});
 id=null;
 console.log('conpty-mcp.test.js: MCP protocol + ConPTY + xterm + auth PASS');
}finally{
 if(id){
   try{await conptyRpc('manage',{action:'stop',sessionId:id})}catch{}
   try{await conptyRpc('manage',{action:'delete',sessionId:id})}catch{}
 }
 try{await conptyRpc('manage',{action:'shutdown'})}catch{}
 await client.close();await server.close();
 // Detached broker exits after shutdown; avoid deleting its metadata before close.
 await new Promise(resolve=>setTimeout(resolve,400));
 fs.rmSync(data,{recursive:true,force:true});
}
