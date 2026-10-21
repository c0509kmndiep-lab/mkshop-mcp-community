// Bounded declarative GUI Workflow Engine with per-step receipts, retry, conditions,
// explicit mutation consent, resume checkpoints, and one desktop lease per execution.
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { USER_DIR } from './userdata.js';
import { acquireGuiLease, performGuiAction, MUTATIONS, GUI_ACTIONS } from './gui2-core.js';

const ROOT=path.join(USER_DIR,'gui2','workflows');
const running=new Map();
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const MUTATING=new Set([...MUTATIONS,'screenshot','locate_template']);
const READ_ONLY=new Set(['assert_window','assert_value','get_value','search','inspect','wait_for']);
const MAX_STEPS=20, MAX_TIMEOUT=90000;
function validId(id){if(!/^[a-zA-Z0-9_-]{5,80}$/.test(id))throw Error('Invalid workflowId')}
function fileFor(id){validId(id);return path.join(ROOT,id+'.json')}
function fingerprint(steps){return createHash('sha256').update(JSON.stringify(steps)).digest('hex')}
async function saveReceipt(r){
  await fs.mkdir(ROOT,{recursive:true,mode:0o700});
  const dest=fileFor(r.workflowId),tmp=dest+'.'+randomUUID()+'.tmp';
  await fs.writeFile(tmp,JSON.stringify(r,null,2),{mode:0o600,flag:'wx'});
  await fs.rename(tmp,dest);
}
async function loadReceipt(id){try{return JSON.parse(await fs.readFile(fileFor(id),'utf8'))}
 catch(e){if(e.code==='ENOENT')return null;throw e}}
function evaluateWhen(step,completed){
  if(!step.when)return true;
  const item=completed.find(s=>s.id===step.when.stepId);
  if(!item||!['completed','skipped'].includes(item.status))throw Error('Condition references incomplete step '+step.when.stepId);
  const value=item.output?.[step.when.field];
  if(step.when.equals!==undefined)return value===step.when.equals;
  if(step.when.notEquals!==undefined)return value!==step.when.notEquals;
  throw Error('when requires equals/notEquals');
}
function validateSteps(steps){
  if(!Array.isArray(steps)||!steps.length||steps.length>MAX_STEPS)throw Error('Workflow requires 1..20 steps');
  const ids=new Set();
  for(const step of steps){
    if(!step||typeof step!=='object'||!/^[A-Za-z][A-Za-z0-9_-]{0,40}$/.test(step.id||'')||ids.has(step.id))throw Error('Invalid/duplicate step id');
    if(!GUI_ACTIONS.has(step.action))throw Error('Unsupported step action: '+step.action);
    if(step.hwnd!==undefined&&(!Number.isInteger(step.hwnd)||step.hwnd<=0))throw Error('Invalid HWND');
    if(!Number.isInteger(step.hwnd)||step.hwnd<=0)throw Error('Each workflow step requires an explicit HWND');
    if(step.when){
      if(!ids.has(step.when.stepId))throw Error('Condition must reference an earlier step');
      if(!['value','found','verified','executionMethod'].includes(step.when.field))throw Error('Unsupported condition field');
    }
    if(step.retries!==undefined&&(!Number.isInteger(step.retries)||step.retries<0||step.retries>3))throw Error('retries must be 0..3');
    if(step.retries&& !READ_ONLY.has(step.action))throw Error('Retries prohibited on side-effecting steps');
    if(step.timeoutMs!==undefined&&(!Number.isInteger(step.timeoutMs)||step.timeoutMs<100||step.timeoutMs>30000))throw Error('Invalid step timeout');
    ids.add(step.id);
  }
}
function publicReceipt(r){
  return {workflowId:r.workflowId,status:r.status,createdAt:r.createdAt,updatedAt:r.updatedAt,
    fingerprint:r.fingerprint,steps:r.steps,lastError:r.lastError||null};
}
export async function workflowExecute({workflowId,steps,dryRun=true,confirmMutations=false,resume=false,timeoutMs=65000}={}){
  validateSteps(steps);
  if(!Number.isInteger(timeoutMs)||timeoutMs<1000||timeoutMs>MAX_TIMEOUT)throw Error('timeoutMs must be 1000..90000');
  const id=workflowId||'wf_'+randomUUID();
  validId(id);
  const hash=fingerprint(steps),existing=await loadReceipt(id);
  if(existing&&existing.fingerprint!==hash)throw Error('Workflow ID already exists with different steps');
  if(existing&&!resume)throw Error('Workflow ID already exists; use resume=true explicitly');
  if(existing&&existing.status==='completed')return publicReceipt(existing);
  if(running.has(id))throw Error('Workflow is already executing in this MCP process');
  const hasMutations=steps.some(s=>MUTATING.has(s.action));
  if(!dryRun&&hasMutations&&!confirmMutations)throw Error('MUTATION_REQUIRES_APPROVAL: confirmMutations=true');
  const record=existing||{
    workflowId:id,fingerprint:hash,status:'pending',createdAt:new Date().toISOString(),
    updatedAt:new Date().toISOString(),steps:[],lastError:null,
  };
  if(dryRun)return {
    ...publicReceipt(record),status:'dry_run',
    planned:steps.map(s=>({id:s.id,action:s.action,hwnd:s.hwnd,retries:s.retries||0,when:s.when||null})),
    mutationCount:steps.filter(s=>MUTATING.has(s.action)).length,
  };
  // Serializes even screenshot/vision foreground changes. No mutation replay on resume.
  const hasDesktopInput=steps.some(s=>MUTATING.has(s.action));
  const lease=hasDesktopInput?await acquireGuiLease({waitMs:10000,ttlMs:Math.min(120000,timeoutMs+10000)}):null;
  const ctl=new AbortController();
  running.set(id,ctl);
  const started=Date.now();
  try{
    record.status='running';record.lastError=null;record.updatedAt=new Date().toISOString();
    await saveReceipt(record);
    for(let index=0;index<steps.length;index++){
      const step=steps[index];
      const previous=record.steps.find(x=>x.id===step.id);
      if(previous?.status==='completed'||previous?.status==='skipped')continue;
      if(previous?.status==='running'&&MUTATING.has(step.action)) {
        throw Error('UNCERTAIN_SIDE_EFFECT: mutation interrupted at '+step.id+'; review manually before resume');
      }
      if(ctl.signal.aborted)throw Error('WORKFLOW_CANCELLED');
      if(Date.now()-started>=timeoutMs)throw Error('WORKFLOW_TIMEOUT');
      if(!evaluateWhen(step,record.steps)){
        const skipped={id:step.id,action:step.action,status:'skipped',reason:'condition false'};
        record.steps.push(skipped);
        record.updatedAt=new Date().toISOString();await saveReceipt(record);
        continue;
      }
      const entry=previous||{id:step.id,action:step.action,attempts:0};
      if(!previous)record.steps.push(entry);
      entry.status='running';entry.startedAt=new Date().toISOString();
      await saveReceipt(record);
      for(let attempt=0;attempt<=(step.retries||0);attempt++){
        if(ctl.signal.aborted)throw Error('WORKFLOW_CANCELLED');
        if(Date.now()-started>=timeoutMs)throw Error('WORKFLOW_TIMEOUT');
        entry.attempts++;
        try{
          const {id:_id,when:_when,retries:_r,...params}=step;
          const output=await performGuiAction(params,{mutationsAllowed:confirmMutations,alreadyLocked:!!lease});
          // Cap persisted payload. Never store raw screenshots/base64 in JSON receipt.
          const compact=JSON.stringify(output);
          entry.output=compact.length>12000?{truncated:true,preview:compact.slice(0,11000)}:output;
          entry.status='completed';entry.endedAt=new Date().toISOString();
          delete entry.error;
          record.updatedAt=new Date().toISOString();await saveReceipt(record);
          break;
        }catch(e){
          entry.error=String(e.message).slice(0,900);
          record.updatedAt=new Date().toISOString();await saveReceipt(record);
          if(attempt>=(step.retries||0))throw Error('STEP_FAILED '+step.id+': '+entry.error);
          await sleep(Math.min(1200,200*(attempt+1)));
        }
      }
    }
    record.status='completed';record.updatedAt=new Date().toISOString();
    await saveReceipt(record);
    return publicReceipt(record);
  }catch(e){
    record.status=ctl.signal.aborted?'cancelled':'failed';
    record.lastError=String(e.message).slice(0,1200);
    record.updatedAt=new Date().toISOString();
    await saveReceipt(record);
    return publicReceipt(record);
  }finally{
    running.delete(id);
    if(lease)await lease.release();
  }
}
export async function workflowStatus({workflowId}={}){
  const r=await loadReceipt(workflowId);
  if(!r)throw Error('Workflow not found');
  return publicReceipt(r);
}
export async function workflowCancel({workflowId}={}){
  validId(workflowId);
  const ctl=running.get(workflowId);
  if(!ctl)throw Error('Workflow not running in this MCP process');
  ctl.abort();
  return {workflowId,cancelRequested:true};
}
