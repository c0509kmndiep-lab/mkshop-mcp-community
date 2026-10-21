// Detached native ConPTY broker. Owns terminal sessions independently of ChatGPT/MCP lifecycle.
// Loopback-only HTTP RPC with a random bearer secret stored under the existing Aki data dir.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createRequire } from 'node:module';
import { USER_DIR } from './userdata.js';
import { Shell } from './shell-mcp.js';
import { resolveUnderRoot } from './roots.js';

const require = createRequire(import.meta.url);
const pty = require('node-pty');
const { Terminal } = require('@xterm/headless');
const brokerRoot = path.join(USER_DIR, 'conpty');
const endpointPath = path.join(brokerRoot, 'endpoint.json');
const logRoot = path.join(brokerRoot, 'logs');
const token = randomBytes(32).toString('hex');
const shell = new Shell();
const sessions = new Map();
const MAX_ACTIVE = 12, MAX_HISTORY = 1024, MAX_LOG = 16 * 1024 * 1024;
const MAX_OUTPUT_CHARS = 40000;
const API_VERSION = 1;
let server;

function isAlive(pid) {
  if (!pid || !Number.isInteger(pid)) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}
function onlyValidId(id) { if (typeof id !== 'string' || !/^conpty_[\da-f]{32}$/.test(id)) throw Error('Unknown ConPTY sessionId'); }
function getSession(id) { onlyValidId(id); const s = sessions.get(id); if (!s) throw Error('Unknown ConPTY sessionId'); return s; }
function makeRecord(s) {
  return {
    sessionId:s.id, pid:s.pid, status:s.status, command:s.command, cwd:s.cwd,
    cols:s.cols, rows:s.rows, startedAt:s.startedAt, endedAt:s.endedAt,
    exitCode:s.exitCode, exitSignal:s.exitSignal, firstSeq:s.events[0]?.seq ?? s.seq + 1,
    lastSeq:s.seq, logFile:s.logFile, logTruncated:s.logTruncated, logBytes:s.logBytes,
  };
}
function pushData(s, data) {
  s.terminal.write(data,()=>{s.screenSeq=s.seq});
  for (const part of data.match(/[\s\S]{1,2048}/gu)||[]) {
    const event = { seq: ++s.seq, data:part };
    s.events.push(event);
    if (s.events.length > MAX_HISTORY) s.events.shift();
    if (!s.logTruncated) {
      const line = Buffer.from(JSON.stringify(event)+'\n');
      if (s.logBytes+line.length > MAX_LOG) s.logTruncated=true;
      else { try { fs.appendFileSync(s.logFile,line); s.logBytes+=line.length; } catch {s.logTruncated=true;} }
    }
  }
}
function start(args) {
  if (process.platform !== 'win32') throw Error('ConPTY requires Windows');
  const live = [...sessions.values()].filter(s=>s.status==='running').length;
  if (live >= MAX_ACTIVE) throw Error('ConPTY limit reached (12 running sessions)');
  const { command, cwd, cols=120, rows=30 } = args;
  if (typeof command!=='string' || !command.trim()) throw Error('command required');
  if (!Number.isInteger(cols)||cols<20||cols>300||!Number.isInteger(rows)||rows<10||rows>120) throw Error('Invalid terminal size');
  const {bin, args:argv}=shell.parse(command);
  shell.checkPermission(bin,argv);
  const dir=fs.realpathSync(resolveUnderRoot(cwd));
  resolveUnderRoot(dir);
  const checked= /^cmd(?:\.exe)?$/i.test(path.basename(bin)) ? argv.filter(x=>!/^\/(?:Q|K|D|C|S|A|U)$/i.test(x)) : argv;
  shell.checkOperandBoundaries(checked,dir);
  const id='conpty_'+randomBytes(16).toString('hex');
  const logFile=path.join(logRoot,id+'.jsonl');
  fs.writeFileSync(logFile,'',{flag:'wx',mode:0o600});
  const record={id,pid:null,process:null,command,cwd:dir,cols,rows,seq:0,cursor:0,screenSeq:0,
    terminal:new Terminal({cols,rows,scrollback:500,allowProposedApi:true}),events:[],status:'running',
    startedAt:new Date().toISOString(),endedAt:null,exitCode:null,exitSignal:null,logFile,logTruncated:false,logBytes:0};
  try {
    // node-pty's Windows ConPTY CreateProcess does not resolve bare aliases such as `pwsh`.
    const executable=process.platform==='win32' && !path.extname(bin) ? bin+'.exe' : bin;
    const proc=pty.spawn(executable,argv,{name:'xterm-256color',cwd:dir,cols,rows,env:{...process.env,TERM:'xterm-256color'},useConpty:true});
    record.process=proc;record.pid=proc.pid;
    proc.onData(data=>pushData(record,data));
    proc.onExit(({exitCode,signal})=>{
      record.exitCode=exitCode;record.exitSignal=signal;record.endedAt=new Date().toISOString();
      if(record.status==='running')record.status=exitCode===0?'completed':'exited';
    });
    sessions.set(id,record);
  } catch(e) {
    try {fs.unlinkSync(logFile)}catch{}
    throw e;
  }
  return makeRecord(record);
}
function write(args){
  const s=getSession(args.sessionId);
  if(s.status!=='running')throw Error('ConPTY session not running');
  if(typeof args.input!=='string'||Buffer.byteLength(args.input,'utf8')>8192)throw Error('Invalid input (max 8192 UTF-8 bytes)');
  if(args.input.includes('\0'))throw Error('NUL not supported');
  const payload=args.input+(args.appendEnter===false?'':'\r');
  s.process.write(payload);
  return {sessionId:s.id,bytesWritten:Buffer.byteLength(payload),status:s.status};
}
function read(args){
  const s=getSession(args.sessionId);
  const cursor=args.cursor??s.cursor,maxChars=args.maxChars??20000;
  if(!Number.isSafeInteger(cursor)||cursor<0||cursor>s.seq)throw Error('Invalid cursor');
  if(!Number.isInteger(maxChars)||maxChars<2048||maxChars>MAX_OUTPUT_CHARS)throw Error('Invalid maxChars');
  const first=s.events[0]?.seq ?? s.seq+1;
  const dropped=cursor<first-1;
  let position=Math.max(cursor,first-1),length=0;
  const events=[];
  for(const e of s.events){
    if(e.seq<=position)continue;
    if(events.length&&length+e.data.length>maxChars)break;
    if(e.data.length>maxChars) throw Error('output chunk exceeded maxChars');
    events.push(e);length+=e.data.length;position=e.seq;
  }
  if(args.cursor===undefined)s.cursor=position;
  return {...makeRecord(s),cursor,events,nextCursor:position,hasMore:position<s.seq,dropped,
    text:events.map(e=>e.data).join('')};
}
function resize(args){
  const s=getSession(args.sessionId);
  const {cols,rows}=args;
  if(s.status!=='running')throw Error('ConPTY session not running');
  if(!Number.isInteger(cols)||cols<20||cols>300||!Number.isInteger(rows)||rows<10||rows>120)throw Error('Invalid terminal size');
  s.process.resize(cols,rows);s.terminal.resize(cols,rows);s.cols=cols;s.rows=rows;
  return makeRecord(s);
}
function screen({sessionId,trim=true}){
  const s=getSession(sessionId);
  const buffer=s.terminal.buffer.active;
  const lines=[];
  for(let row=0;row<s.rows;row++){
    const line=buffer.getLine(buffer.viewportY+row);
    lines.push(line?.translateToString(!!trim)??'');
  }
  return {...makeRecord(s),screenSeq:s.screenSeq,cursorX:buffer.cursorX,cursorY:buffer.cursorY,
    viewportY:buffer.viewportY,lines,screen:lines.join('\n')};
}
function manage({action,sessionId}){
  if(action==='list')return [...sessions.values()].map(makeRecord);
  if(action==='shutdown'){
    if([...sessions.values()].some(s=>s.status==='running'))throw Error('Cannot shutdown broker with live sessions');
    setTimeout(()=>server.close(()=>process.exit(0)),50).unref();
    return {shuttingDown:true};
  }
  const s=getSession(sessionId);
  if(action==='status')return makeRecord(s);
  if(action==='stop'){
    if(s.status==='running'){
      s.process.kill();s.status='stopped';s.endedAt=new Date().toISOString();
    }
    return makeRecord(s);
  }
  if(action==='delete'){
    if(s.status==='running')throw Error('Stop running session before delete');
    sessions.delete(s.id);
    try{fs.unlinkSync(s.logFile)}catch{}
    return {sessionId,deleted:true};
  }
  throw Error('Unknown action');
}
function route(payload){
  if(!payload||typeof payload!=='object'||typeof payload.action!=='string'||!payload.params||typeof payload.params!=='object')throw Error('Invalid RPC request');
  switch(payload.action){
    case 'start':return start(payload.params);
    case 'write':return write(payload.params);
    case 'read':return read(payload.params);
    case 'manage':return manage(payload.params);
    case 'resize':return resize(payload.params);
    case 'screen':return screen(payload.params);
    default:throw Error('Unknown RPC action');
  }
}
function validToken(v){
  if(typeof v!=='string'||v.length!==token.length)return false;
  return timingSafeEqual(Buffer.from(v),Buffer.from(token));
}
function respond(res,code,obj){
  res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
  res.end(JSON.stringify(obj));
}
fs.mkdirSync(logRoot,{recursive:true,mode:0o700});
server=http.createServer((req,res)=>{
  if(req.socket.remoteAddress!=='127.0.0.1'&&req.socket.remoteAddress!=='::ffff:127.0.0.1')return respond(res,403,{error:'Loopback only'});
  if(!validToken(req.headers['x-aki-broker-token']))return respond(res,401,{error:'Unauthorized'});
  if(req.method==='GET'&&req.url==='/health')return respond(res,200,{ok:true,version:API_VERSION,pid:process.pid,active:[...sessions.values()].filter(s=>s.status==='running').length});
  if(req.method!=='POST'||req.url!=='/rpc')return respond(res,404,{error:'Not found'});
  let payload='',size=0;
  req.on('data',buf=>{size+=buf.length;if(size>32768){req.destroy();return}payload+=buf.toString('utf8')});
  req.on('end',()=>{try{respond(res,200,{ok:true,result:route(JSON.parse(payload))})}catch(e){respond(res,400,{ok:false,error:e.message})}});
});
server.listen(0,'127.0.0.1',()=>{
  const file={pid:process.pid,port:server.address().port,token,version:API_VERSION,createdAt:new Date().toISOString()};
  const tmp=endpointPath+'.'+process.pid+'.tmp';
  fs.writeFileSync(tmp,JSON.stringify(file),{mode:0o600,flag:'wx'});
  fs.renameSync(tmp,endpointPath);
});
process.on('exit',()=>{
  try{const current=JSON.parse(fs.readFileSync(endpointPath,'utf8'));if(current.pid===process.pid)fs.unlinkSync(endpointPath)}catch{}
  for(const s of sessions.values()){if(s.status==='running')try{s.process.kill()}catch{}}
});
