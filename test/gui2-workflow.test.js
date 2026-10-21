#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const data=fs.mkdtempSync(path.join(os.tmpdir(),'aki-gui2-test-'));
process.env.AKI_MCP_DATA_DIR=data;
const {createToolsServer}=await import('../scripts/tools-server.js');
const {workflowExecute,workflowStatus}=await import('../scripts/gui2-workflow.js');
const {acquireGuiLease}=await import('../scripts/gui2-core.js');
const {Client}=await import('@modelcontextprotocol/sdk/client/index.js');
const {InMemoryTransport}=await import('@modelcontextprotocol/sdk/inMemory.js');

const server=createToolsServer();
const names=['gui2_action','gui2_locate_template','gui2_workflow_execute','gui2_workflow_status','gui2_workflow_cancel'];
for(const n of names)assert.ok(server._registeredTools['aki__'+n]);
const [ct,st]=InMemoryTransport.createLinkedPair(),client=new Client({name:'gui2-regression',version:'1.0.0'});
await Promise.all([server.connect(st),client.connect(ct)]);
async function call(n,params){
 const r=await client.callTool({name:'aki__'+n,arguments:params});
 return {error:!!r.isError,data:r.isError?r.content[0].text:JSON.parse(r.content[0].text)};
}
try{
 const dry=await call('gui2_workflow_execute',{workflowId:'wf_gui2_dry_01',steps:[
   {id:'window',action:'assert_window',hwnd:12345},
   {id:'click',action:'click',hwnd:12345,selector:'Example',when:{stepId:'window',field:'found',equals:true}}
 ]});
 assert.equal(dry.error,false);
 assert.equal(dry.data.status,'dry_run');
 assert.equal(dry.data.mutationCount,1);
 const noMut=await call('gui2_workflow_execute',{workflowId:'wf_no_approval',steps:[
   {id:'click',action:'click',hwnd:12345,selector:'Fake'}],dryRun:false});
 assert.equal(noMut.error,true);
 assert.match(noMut.data,/MUTATION_REQUIRES_APPROVAL/);
 await assert.rejects(()=>workflowExecute({steps:[{id:'bad',action:'click',hwnd:12,retries:2}]}),/Retries prohibited/);
 await assert.rejects(()=>workflowExecute({steps:[{id:'dup',action:'assert_window',hwnd:12},{id:'dup',action:'assert_window',hwnd:12}]}),/duplicate/);
 await assert.rejects(()=>workflowExecute({steps:[{id:'a',action:'assert_window',hwnd:12,when:{stepId:'later',field:'found',equals:true}},{id:'later',action:'assert_window',hwnd:12}]}),/earlier/);
 const failure=await workflowExecute({workflowId:'wf_gui2_failure_case',steps:[
  {id:'missing',action:'assert_window',hwnd:99999999}],dryRun:false});
 assert.equal(failure.status,'failed');
 assert.match(failure.lastError,/STEP_FAILED/);
 assert.equal((await workflowStatus({workflowId:'wf_gui2_failure_case'})).status,'failed');
 const resumed=await workflowExecute({workflowId:'wf_gui2_failure_case',steps:[
  {id:'missing',action:'assert_window',hwnd:99999999}],dryRun:false,resume:true});
 assert.equal(resumed.status,'failed');
 await assert.rejects(()=>workflowExecute({workflowId:'wf_gui2_failure_case',steps:[
  {id:'different',action:'assert_window',hwnd:99999999}],resume:true}),/different steps/);
 const first=await acquireGuiLease({waitMs:500});
 await assert.rejects(()=>acquireGuiLease({waitMs:120}),/GUI_BUSY/);
 await first.release();
 const next=await acquireGuiLease({waitMs:300});await next.release();

 // Actual MCP protocol invokes real WinApp window enumeration through Windows.
 if(process.platform==='win32'){
   const read=await call('gui2_action',{action:'assert_window',hwnd:999999999});
   assert.equal(read.error,true);
   assert.match(read.data,/WINDOW_NOT_FOUND/);
 }
 console.log('gui2-workflow.test.js: registration, dry run, gating, lease, validation PASS');
}finally{
 await client.close();await server.close();
 fs.rmSync(data,{recursive:true,force:true});
}
