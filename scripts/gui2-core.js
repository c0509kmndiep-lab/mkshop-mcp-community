// GUI Automation 2.0: scoped HWND, deterministic UIA-first actions, explicit image/coordinate
// fallback, verifications, and a cross-process, expiring exclusive input lease.
import cp from 'node:child_process';
import fss from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { USER_DIR } from './userdata.js';
import { resolveRealUnderRoot } from './roots.js';
import { cliArguments, runWinApp } from './windows-gui-mcp.js';

const ROOT=path.join(USER_DIR,'gui2');
const LEASE=path.join(ROOT,'lease.json');
const PYTHON=process.env.AKI_GUI2_PYTHON||'python';
const MATCHER=fileURLToPath(new URL('./gui2-template-match.py', import.meta.url));
export const MUTATIONS=new Set(['invoke','click','set_value','send_keys','scroll','focus','hover','drag']);
export const GUI_ACTIONS=new Set([...MUTATIONS,'get_value','search','wait_for','inspect','screenshot','assert_value','assert_window','locate_template']);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

function processAlive(pid){
  if(!Number.isInteger(pid)||pid<=0)return false;
  try {process.kill(pid,0);return true;}catch(e){return e.code==='EPERM';}
}
export async function acquireGuiLease({waitMs=5000, ttlMs=100000}={}){
  if(!Number.isInteger(waitMs)||waitMs<0||waitMs>15000)throw Error('Invalid lease wait');
  if(!Number.isInteger(ttlMs)||ttlMs<1000||ttlMs>120000)throw Error('Invalid lease TTL');
  await fs.mkdir(ROOT,{recursive:true,mode:0o700});
  const token=randomUUID(),deadline=Date.now()+waitMs;
  for(;;){
    try {
      const fd=await fs.open(LEASE,'wx',0o600);
      try {await fd.writeFile(JSON.stringify({token,pid:process.pid,expires:Date.now()+ttlMs}));}
      finally {await fd.close();}
      return {token,release:async()=>{
        try{const record=JSON.parse(await fs.readFile(LEASE,'utf8'));
          if(record.token===token)await fs.unlink(LEASE);
        }catch(e){if(e.code!=='ENOENT')throw e}
      }};
    }catch(e){
      if(e.code!=='EEXIST')throw e;
      let existing;
      try{existing=JSON.parse(await fs.readFile(LEASE,'utf8'))}catch{}
      if(!existing||typeof existing.expires!=='number'||existing.expires<Date.now()||!processAlive(existing.pid)){
        // Re-check identity to avoid removing a newly acquired lock.
        try{const check=JSON.parse(await fs.readFile(LEASE,'utf8'));
          if(JSON.stringify(check)===JSON.stringify(existing))await fs.unlink(LEASE);
        }catch{}
      }else if(Date.now()>=deadline)throw Error('GUI_BUSY: another workflow holds desktop input lease');
      if(Date.now()>=deadline)throw Error('GUI_BUSY: lease acquisition timed out');
      await sleep(90);
    }
  }
}
async function win(verb,items=[],hwnd){
  const raw=await runWinApp(cliArguments(verb,items,hwnd),Math.min(35000,verb==='wait-for'?35000:20000));
  try{return JSON.parse(raw)}catch{return {raw}}
}
async function activeWindow(hwnd){
  const wins=await win('list-windows');
  if(!Array.isArray(wins))throw Error('Invalid window listing');
  const w=wins.find(x=>x.hwnd===hwnd);
  if(!w||!w.processId)throw Error('WINDOW_NOT_FOUND: HWND unavailable or changed');
  return w;
}
function getSelector(a){return a.selector||a.query||null;}
async function resolveSelector(hwnd,a){
  if(a.selector)return a.selector;
  if(!a.query)throw Error('Selector or query required');
  const result=await win('search',[a.query],hwnd);
  const found=result.matches||[];
  if(found.length!==1)throw Error('UIA_SELECTOR_AMBIGUOUS: '+found.length+' matches for '+a.query);
  const item=found[0];
  if(item.isEnabled===false||item.isOffscreen===true)throw Error('UIA element disabled/offscreen');
  const selector=item.automationId||item.selector;
  if(!selector)throw Error('UIA found element but it has no stable selector');
  return selector;
}
function compare(actual,expect){
  if(!expect)return {passed:true};
  if(typeof expect.equals==='string' && actual!==expect.equals)return {passed:false,reason:'expected exact value'};
  if(typeof expect.contains==='string' && !actual.includes(expect.contains))return {passed:false,reason:'expected substring'};
  if(typeof expect.notContains==='string' && actual.includes(expect.notContains))return {passed:false,reason:'unexpected substring'};
  return {passed:true};
}
async function valueAt(hwnd,selector){
  const v=await win('get-value',[selector],hwnd);
  if(typeof v.text==='string')return v.text;
  if(typeof v.value==='string')return v.value;
  throw Error('ValuePattern returned no readable text');
}
async function snapshotFile(hwnd){
  const folder=path.join(ROOT,'tmp');
  await fs.mkdir(folder,{recursive:true,mode:0o700});
  const filename=path.join(folder,randomUUID()+'.png');
  try{
    await runWinApp(cliArguments('screenshot',['--output',filename,'--capture-screen'],hwnd),30000);
    const stat=await fs.stat(filename);
    if(stat.size<128||stat.size>12*1024*1024)throw Error('Invalid screenshot bytes');
    return filename;
  }catch(e){await fs.unlink(filename).catch(()=>{});throw e}
}
export async function locateTemplate({hwnd,templatePath}){
  if(typeof templatePath!=='string'||!templatePath.toLowerCase().endsWith('.png'))throw Error('PNG templatePath required');
  const actual=await resolveRealUnderRoot(templatePath);
  const size=(await fs.stat(actual)).size;
  if(size<128||size>2*1024*1024)throw Error('Invalid template image size');
  await activeWindow(hwnd);
  const screenshot=await snapshotFile(hwnd);
  try{
    const output=await new Promise((resolve,reject)=>{
      cp.execFile(PYTHON,[MATCHER,String(hwnd),screenshot,actual],{
        windowsHide:true,timeout:15000,maxBuffer:1e6,
      },(err,stdout,stderr)=>err?reject(Error('template match: '+String(stderr||err.message).slice(0,600))):resolve(stdout));
    });
    return JSON.parse(output);
  }finally{await fs.unlink(screenshot).catch(()=>{})}
}
function validatePoint(x,y){if(!Number.isInteger(x)||!Number.isInteger(y)||x<0||y<0)throw Error('Nonnegative screen x,y required');}
async function checkedPoint(hwnd,x,y){
  validatePoint(x,y);
  const tree=await win('inspect',['--depth','1'],hwnd);
  const root=tree.windows?.[0]?.elements?.[0];
  if(!root||![root.x,root.y,root.width,root.height].every(Number.isFinite))throw Error('Cannot verify HWND bounds');
  // UIA Window root excludes a few pixels of non-client frame.
  if(x<root.x-12||y<root.y-45||x>=root.x+root.width+12||y>=root.y+root.height+12)
    throw Error('Coordinates outside HWND UIA bounds');
}
export async function performGuiAction(a,{mutationsAllowed=false,alreadyLocked=false}={}){
  if(!a||typeof a!=='object'||!GUI_ACTIONS.has(a.action))throw Error('Unsupported GUI 2.0 action');
  if(!Number.isSafeInteger(a.hwnd)||a.hwnd<=0)throw Error('Positive HWND required');
  await activeWindow(a.hwnd);
  const changing=MUTATIONS.has(a.action);
  if(changing&&!mutationsAllowed)throw Error('MUTATION_REQUIRES_APPROVAL: confirmMutations required');
  // Screenshot and template matching also foreground a window: serialize them with input.
  const lease=(changing||a.action==='screenshot'||a.action==='locate_template')&&!alreadyLocked
    ?await acquireGuiLease():null;
  try{
    const hwnd=a.hwnd,action=a.action;
    if(action==='assert_window')return {found:true,action,hwnd};
    if(action==='inspect')return {action,result:await win('inspect',['--depth',String(a.depth||2)],hwnd)};
    if(action==='search')return {action,result:await win('search',[a.query],hwnd)};
    if(action==='locate_template')return {action,match:await locateTemplate(a)};
    if(action==='screenshot'){
      const screenshot=await snapshotFile(hwnd);
      const dest=path.join(ROOT,'captures',randomUUID()+'.png');
      await fs.mkdir(path.dirname(dest),{recursive:true,mode:0o700});
      await fs.rename(screenshot,dest);
      return {action,filePath:dest,bytes:(await fs.stat(dest)).size};
    }
    let sel;let executionMethod='uia';let result;
    if(['get_value','assert_value','wait_for','invoke','set_value','focus','hover','click','scroll'].includes(action) &&
      (a.selector||a.query||['get_value','assert_value','wait_for','invoke','set_value','focus','hover'].includes(action))){
      try{sel=await resolveSelector(hwnd,a)}catch(e){
        if(action!=='click'||!a.fallback)throw e;
        // Explicit fallback only; never guess a match or arbitrary coordinates.
        sel=null;
      }
    }
    if(action==='get_value'||action==='assert_value'){
      const value=await valueAt(hwnd,sel);
      const check=compare(value,a.expect);
      if(!check.passed)throw Error('VERIFY_FAILED: '+check.reason);
      return {action,hwnd,selector:sel,value,verified:true};
    }
    if(action==='wait_for'){
      const args=[sel,'--timeout',String(a.timeoutMs||4000)];
      if(a.expect?.equals)args.push('--value',a.expect.equals);
      result=await win('wait-for',args,hwnd);
      if(result.found!==true||result.timedOut===true)throw Error('WAIT_TIMEOUT: '+sel);
      return {action,hwnd,selector:sel,found:true,waitedMs:result.waitedMs};
    }
    if(action==='send_keys'){
      if(typeof a.keys!=='string'||!a.keys||a.keys.length>4096)throw Error('keys required, max 4096 chars');
      result=await win('send-keys',[a.keys,...(a.verbatim?['--verbatim']:[]),...(a.viaSendInput?['--via','send-input']:[])],hwnd);
    } else if(action==='drag'){
      if(!a.from||!a.to)throw Error('from and to required');
      result=await win('drag',[a.from,a.to],hwnd);
    } else {
      let verb=action, args;
      if(action==='set_value'){
        if(typeof a.value!=='string'||a.value.length>4096)throw Error('value must be a string <= 4096');
        args=[sel,a.value];
      }else if(action==='scroll'){
        const fields=[a.direction?['--direction',a.direction]:[],a.to?['--to',a.to]:[],
          Number.isInteger(a.wheel)&&a.wheel!==0?['--wheel',String(a.wheel)]:[]];
        if(fields.filter(f=>f.length).length!==1)throw Error('Specify one scroll direction/to/wheel');
        args=[...(sel?[sel]:[]),...fields.flat()];
      }else if(action==='click'&&!sel){
        let x=a.x,y=a.y;
        if((!Number.isInteger(x)||!Number.isInteger(y))&&a.fallback){
          if(a.fallback.mode==='coordinates'){x=a.fallback.x;y=a.fallback.y}
          else if(a.fallback.mode==='template'){
            const match=await locateTemplate({hwnd,templatePath:a.fallback.templatePath});
            if(!match.reliable)throw Error('VISION_UNCERTAIN: score='+match.score+' runnerUp='+match.runnerUp+' geometry='+match.geometryAligned);
            x=match.x;y=match.y;
          }else throw Error('Unsupported fallback');
          executionMethod=a.fallback.mode;
        }else executionMethod='coordinates';
        validatePoint(x,y);await checkedPoint(hwnd,x,y);
        // WinApp click accepts selectors only; drag from==to performs a point mouse press/release.
        verb='drag';args=[x+','+y,x+','+y];
      }else args=[sel];
      try{result=await win(verb,args,hwnd)}
      catch(e){
        if(action!=='click'||!a.fallback)throw e;
        let point;
        if(a.fallback.mode==='coordinates'){
          point={x:a.fallback.x,y:a.fallback.y};
          await checkedPoint(hwnd,point.x,point.y);
        } else if(a.fallback.mode==='template'){
          const match=await locateTemplate({hwnd,templatePath:a.fallback.templatePath});
          if(!match.reliable)throw Error('VISION_UNCERTAIN: score='+match.score+' runnerUp='+match.runnerUp+' geometry='+match.geometryAligned);
          point={x:match.x,y:match.y};
          await checkedPoint(hwnd,point.x,point.y);
        }else throw Error('Unsupported explicit fallback mode');
        result=await win('drag',[point.x+','+point.y,point.x+','+point.y],hwnd);
        executionMethod=a.fallback.mode;
      }
    }
    let verified=false;
    if(a.verify?.selector){
      const expected=a.verify;
      let check={passed:false,reason:'value not yet updated'};
      for(let i=0;i<8;i++){
        const read=await valueAt(hwnd,expected.selector);
        check=compare(read,expected);
        if(check.passed)break;
        await sleep(120);
      }
      if(!check.passed)throw Error('VERIFY_FAILED_AFTER_ACTION: '+check.reason);
      verified=true;
    }
    return {action,hwnd,selector:sel||null,executionMethod,result,verified};
  }finally{if(lease)await lease.release()}
}
