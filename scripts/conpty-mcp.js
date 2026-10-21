// ConPTY MCP tools with an independent broker. Restarting MCP does not end native terminals.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { USER_DIR } from './userdata.js';
import { ok, fail } from './mcp-tool.js';

const ROOT=path.join(USER_DIR,'conpty');
const ENDPOINT=path.join(ROOT,'endpoint.json');
const LOCK=path.join(ROOT,'spawn.lock');
const BROKER_SCRIPT=fileURLToPath(new URL('./conpty-broker.js',import.meta.url));
const START_TIMEOUT=6000;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function isAlive(pid){
  if(!Number.isInteger(pid)||pid<=0)return false;
  try {process.kill(pid,0);return true;}catch(e){return e.code==='EPERM';}
}
function endpoint(){
  try{
    const obj=JSON.parse(fs.readFileSync(ENDPOINT,'utf8'));
    if(obj.version!==1||!Number.isInteger(obj.port)||obj.port<=0||obj.port>65535
       ||!Number.isInteger(obj.pid)||!(/^[a-f0-9]{64}$/).test(obj.token))return null;
    return obj;
  }catch{return null;}
}
async function request(ep,action,params) {
  const res=await fetch('http://127.0.0.1:'+ep.port+(action==='health'?'/health':'/rpc'),{
    method:action==='health'?'GET':'POST',
    headers:{'x-aki-broker-token':ep.token,'Content-Type':'application/json'},
    ...(action==='health'?{}:{body:JSON.stringify({action,params})}),
    signal:AbortSignal.timeout(2500),
  });
  const body=await res.json();
  if(!res.ok||!body.ok)throw Error(body.error||'ConPTY broker request failed');
  return action==='health'?body:body.result;
}
async function tryEndpoint(){
  const ep=endpoint();
  if(!ep||!isAlive(ep.pid))return null;
  try{
    const health=await request(ep,'health',{});
    return health.pid===ep.pid?ep:null;
  }catch{return null;}
}
async function ensureBroker(){
  let ep=await tryEndpoint();
  if(ep)return ep;
  fs.mkdirSync(ROOT,{recursive:true,mode:0o700});
  let locked=false;
  try{
    const fd=fs.openSync(LOCK,'wx',0o600);
    fs.writeFileSync(fd,JSON.stringify({pid:process.pid,created:Date.now()}));
    fs.closeSync(fd);locked=true;
  }catch(e){
    if(e.code!=='EEXIST')throw e;
    try{
      const meta=JSON.parse(fs.readFileSync(LOCK,'utf8'));
      if(!isAlive(meta.pid)&&Date.now()-meta.created>15000)fs.unlinkSync(LOCK);
    }catch{}
  }
  try{
    if(locked){
      const current=await tryEndpoint();
      if(current)return current;
      const log=path.join(ROOT,'broker-startup.log');
      const fd=fs.openSync(log,'a',0o600);
      let child;
      try{ child=spawn(process.execPath,[BROKER_SCRIPT],{
        cwd:path.dirname(BROKER_SCRIPT), env:process.env,
        detached:true,windowsHide:true,stdio:['ignore',fd,fd],
      });}finally{fs.closeSync(fd)}
      if(!child.pid)throw Error('ConPTY broker spawn failed');
      child.on('error',()=>{});
      child.unref();
    }
    const deadline=Date.now()+START_TIMEOUT;
    while(Date.now()<deadline){
      ep=await tryEndpoint();
      if(ep)return ep;
      await sleep(120);
    }
    throw Error('ConPTY broker unavailable after '+START_TIMEOUT+'ms; check '+path.join(ROOT,'broker-startup.log'));
  }finally{
    if(locked)try{fs.unlinkSync(LOCK)}catch{}
  }
}
export async function conptyRpc(action,params={}){
  const ep=await ensureBroker();
  return request(ep,action,params);
}
export function register(server){
  server.registerTool('conpty_start',{
    title:'Start persistent Windows ConPTY terminal',
    description:'Start native Windows ConPTY with VT/ANSI, Ctrl+C, TUI applications, resize and session persistence across MCP restart. Uses existing shell allowlist and configured roots; a local broker owns sessions.',
    inputSchema:{
      command:z.string().min(1),cwd:z.string().optional(),
      cols:z.number().int().min(20).max(300).optional(),rows:z.number().int().min(10).max(120).optional(),
    },
  },async params=>{try{return ok(JSON.stringify(await conptyRpc('start',params)))}catch(e){return fail(e)}});
  server.registerTool('conpty_write',{
    title:'Interact with Windows ConPTY terminal',
    description:'Send text or control-key VT sequences to a running ConPTY. Default appends Enter (CR). For Ctrl+C send input \\u0003 with appendEnter=false; arrows use \\u001b[A etc.',
    inputSchema:{sessionId:z.string(),input:z.string(),appendEnter:z.boolean().optional()},
  },async params=>{try{return ok(JSON.stringify(await conptyRpc('write',params)))}catch(e){return fail(e)}});
  server.registerTool('conpty_read',{
    title:'Read Windows ConPTY terminal',
    description:'Retrieve bounded incremental raw ANSI/VT screen output, event cursors and exit status. Replay via cursor, dropped flag for expired in-memory events. Output is shared across clients.',
    inputSchema:{
      sessionId:z.string(),cursor:z.number().int().nonnegative().optional(),
      maxChars:z.number().int().min(2048).max(40000).optional(),
      timeoutMs:z.number().int().min(0).max(10000).optional(),
    },
  },async params=>{
    try{
      const until=Date.now()+Math.min(params.timeoutMs??0,10000);
      let result;
      do{
        result=await conptyRpc('read',params);
        if(result.events.length||result.status!=='running'||Date.now()>=until)break;
        await sleep(Math.min(180,until-Date.now()));
      }while(true);
      return ok(JSON.stringify(result));
    }catch(e){return fail(e)}
  });
  server.registerTool('conpty_resize',{
    title:'Resize ConPTY screen',
    description:'Resize the columns/rows of a running native ConPTY (important for full-screen TUIs).',
    inputSchema:{sessionId:z.string(),cols:z.number().int().min(20).max(300),rows:z.number().int().min(10).max(120)},
  },async params=>{try{return ok(JSON.stringify(await conptyRpc('resize',params)))}catch(e){return fail(e)}});
  server.registerTool('conpty_screen',{
    title:'Read rendered ConPTY TUI screen',
    description:'Read the currently rendered terminal screen by rows, using xterm VT/ANSI emulation. Useful for OpenCode or other full-screen TUIs; includes cursor position and viewport.',
    inputSchema:{sessionId:z.string(),trim:z.boolean().optional()},
  },async params=>{try{return ok(JSON.stringify(await conptyRpc('screen',params)))}catch(e){return fail(e)}});
  server.registerTool('conpty_manage',{
    title:'Manage persistent ConPTY sessions',
    description:'List, inspect, stop or delete native ConPTY sessions. shutdown is allowed only when no live sessions remain.',
    inputSchema:{action:z.enum(['list','status','stop','delete','shutdown']),sessionId:z.string().optional()},
  },async params=>{try{return ok(JSON.stringify(await conptyRpc('manage',params)))}catch(e){return fail(e)}});
}
