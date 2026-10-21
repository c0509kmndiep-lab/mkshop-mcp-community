// High-level Windows GUI 2.0 and bounded declarative workflow MCP registrations.
import { z } from 'zod';
import { ok, fail } from './mcp-tool.js';
import { performGuiAction, locateTemplate } from './gui2-core.js';
import { workflowExecute, workflowStatus, workflowCancel } from './gui2-workflow.js';

const hwnd=z.number().int().positive();
const EXPECT=z.object({equals:z.string().optional(),contains:z.string().optional(),notContains:z.string().optional()}).strict();
const fallback=z.object({
  mode:z.enum(['coordinates','template']),
  x:z.number().int().optional(),y:z.number().int().optional(),
  templatePath:z.string().optional(),
}).strict();
const step=z.object({
  id:z.string().min(1).max(41),
  action:z.enum(['assert_window','inspect','search','get_value','assert_value','wait_for',
    'invoke','set_value','focus','hover','click','drag','send_keys','scroll','screenshot','locate_template']),
  hwnd,
  selector:z.string().optional(),query:z.string().optional(),
  x:z.number().int().optional(),y:z.number().int().optional(),
  value:z.string().optional(),keys:z.string().optional(),
  from:z.string().optional(),to:z.string().optional(),
  direction:z.enum(['up','down','left','right']).optional(),wheel:z.number().int().optional(),
  verbatim:z.boolean().optional(),viaSendInput:z.boolean().optional(),
  templatePath:z.string().optional(),fallback:fallback.optional(),
  expect:EXPECT.optional(),verify:z.object({selector:z.string().min(1),equals:z.string().optional(),
    contains:z.string().optional(),notContains:z.string().optional()}).strict().optional(),
  depth:z.number().int().min(1).max(8).optional(),
  timeoutMs:z.number().int().min(100).max(30000).optional(),
  retries:z.number().int().min(0).max(3).optional(),
  when:z.object({stepId:z.string(),field:z.enum(['value','found','verified','executionMethod']),
    equals:z.union([z.string(),z.boolean(),z.number()]).optional(),
    notEquals:z.union([z.string(),z.boolean(),z.number()]).optional()}).strict().optional(),
}).strict();

export function register(server){
  server.registerTool('gui2_action',{
    title:'GUI 2.0 verified action',
    description:'Perform a bounded Windows UIA action on explicit HWND, optionally verify value. For click, explicit coordinate/template fallback is possible only when provided; never guesses. UI mutations require confirmMutations=true. A desktop lease prevents competing flows.',
    inputSchema:{
      ...step.shape,
      id:z.string().optional(),when:z.any().optional(),retries:z.number().int().optional(),
      confirmMutations:z.boolean().optional(),
    },
  },async p=>{
    try{const {confirmMutations,id,when,retries,...a}=p;
      return ok(JSON.stringify(await performGuiAction(a,{mutationsAllowed:confirmMutations===true})));
    }catch(e){return fail(e)}
  });
  server.registerTool('gui2_locate_template',{
    title:'Locate supplied PNG in Windows window',
    description:'Read-only OpenCV screenshot template matching on HWND. Reports confidence and coordinate mapping; does not click. Requires unambiguous high-confidence match; no OCR or AI image semantics.',
    inputSchema:{hwnd,templatePath:z.string().min(1)},
  },async a=>{try{return ok(JSON.stringify(await locateTemplate(a)))}catch(e){return fail(e)}});
  server.registerTool('gui2_workflow_execute',{
    title:'Execute GUI 2.0 workflow',
    description:'Run 1..20 bounded GUI steps with condition, read-only retries, exclusive desktop lease, receipts and resumable checkpoint. Dry-run defaults true; live mutation requires confirmMutations. No automatic replay of interrupted mutation.',
    inputSchema:{
      workflowId:z.string().optional(),steps:z.array(step).min(1).max(20),
      dryRun:z.boolean().optional(),confirmMutations:z.boolean().optional(),
      resume:z.boolean().optional(),timeoutMs:z.number().int().min(1000).max(90000).optional(),
    },
  },async p=>{try{return ok(JSON.stringify(await workflowExecute(p)))}catch(e){return fail(e)}});
  server.registerTool('gui2_workflow_status',{
    title:'Read GUI workflow checkpoint',
    description:'Read persisted results and exact failed step of a workflow.',
    inputSchema:{workflowId:z.string().min(5)},
  },async p=>{try{return ok(JSON.stringify(await workflowStatus(p)))}catch(e){return fail(e)}});
  server.registerTool('gui2_workflow_cancel',{
    title:'Cancel running GUI workflow',
    description:'Request cooperative cancellation after current Windows GUI operation completes.',
    inputSchema:{workflowId:z.string().min(5)},
  },async p=>{try{return ok(JSON.stringify(await workflowCancel(p)))}catch(e){return fail(e)}});
}
