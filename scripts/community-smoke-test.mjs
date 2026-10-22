#!/usr/bin/env node
// Portable, read-only Community regression smoke suite.
// All subprocesses inherit isolated data roots and never open console windows.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const tests=[
 'test/community-defaults.test.js',
 'test/roots.test.js',
 'test/windows-gui-mcp.test.js',
 'test/gui2-workflow.test.js',
 'test/oauth.test.js',
 'test/streamable-bridge.test.js',
 'test/self-healing-health.test.js',
 'test/sqlite-mcp.test.js',
 'test/cdp-extensions.test.js',
 'test/font-awesome-static.test.js'
];
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'mkshop-community-smoke-'));
let passed=0;
try{
 for(let i=0;i<tests.length;i++){
  const f=tests[i];
  const env={...process.env,
    AKI_MCP_DATA_DIR:path.join(tmp,'profile-'+i),
    MCP_SKIP_BROWSER_OPEN:'1',
    MKSHOP_ENABLE_FUNNEL:'0',
    MKSHOP_ENABLE_UPDATE_CHECK:'0',
    AKI_GUI_LIVE_READ_TEST:'0'
  };
  const child=spawnSync(process.execPath,[path.join(root,f)],{
    cwd:root,env,windowsHide:true,encoding:'utf8',timeout:60000,maxBuffer:2*1024*1024
  });
  if(child.status===0){
   passed++;
   console.log('PASS '+f);
  }else{
   console.error('FAIL '+f+' (exit='+child.status+', error='+String(child.error?.message??'none')+')');
   console.error(((child.stderr||'')+'\n'+(child.stdout||'')).slice(-3000));
  }
 }
}finally{
 fs.rmSync(tmp,{recursive:true,force:true});
}
console.log('Community smoke suite: '+passed+'/'+tests.length+' passed');
if(passed!==tests.length)process.exitCode=1;
