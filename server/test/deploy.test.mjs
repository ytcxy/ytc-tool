import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEnv } from '../../deploy/prepare-env.mjs';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, readlinkSync, existsSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
const source='DB_HOST=localhost\nDB_USER=test\nDB_NAME=ytc-tool-prod\nDB_PASSWORD="spaces $and `literal` # included"\nWECHAT_APP_ID=wx-test\nWECHAT_APP_SECRET=fixture-secret\n';
test('deployment env preserves quoted secrets and excludes unrelated process overrides',()=>{
 const result=normalizeEnv(source+'NODE_OPTIONS=--inspect\nPORT=9999\n');
 assert.ok(result.includes('DB_PASSWORD=spaces $and `literal` # included\n'));
 assert.ok(result.includes('DB_PORT=3306\n'));
 assert.ok(!result.includes('NODE_OPTIONS'));assert.ok(!result.includes('PORT=9999'));
 assert.throws(()=>normalizeEnv(source.replace('ytc-tool-prod','ytc-tool')),/production|prod/);
 assert.throws(()=>normalizeEnv(source+'DB_PORT=70000\n'),/DB_PORT/);
 assert.throws(()=>normalizeEnv(source+'WECHAT_APP_SECRET="line1\nline2"\n'),/Multiline/);
});
test('local plan validates config but invokes neither SSH nor Docker',()=>{
 const dir=mkdtempSync('/tmp/ytc-plan-test.');
 try {
  const env=join(dir,'production.env');writeFileSync(env,source);
  const result=spawnSync('bash',[join(root,'deploy-remote.sh'),'--host','example.test','--env-file',env,'--plan'],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/No connection or deployment/);
  assert.ok(!result.stdout.includes('fixture-secret'));
  assert.notEqual(spawnSync('bash',[join(root,'deploy-remote.sh'),'--host','host;bad','--env-file',env,'--plan']).status,0);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
// Run the real activation logic with Docker replaced by a stateful fake. Filesystem
// destinations and the root check are substituted only in this temporary test copy.
const fakeDocker=`#!/usr/bin/env node
const fs=require('fs');const a=process.argv.slice(2);const file=process.env.DEPLOY_STATE;const s=JSON.parse(fs.readFileSync(file));s.calls.push(a);let out='',code=0;
if(a[0]==='load'){fs.readFileSync(0);}
else if(a[0]==='image')out=a.includes('{{.Id}}')?'sha256:'+'a'.repeat(64):'linux/amd64';
else if(a[0]==='container')code=s.containers[a[2]]?0:1;
else if(a[0]==='inspect'){
 const c=s.containers[a.at(-1)];
 if(a[2].includes('Labels'))out='true';
 else if(a[2].includes('Health'))out=s.mode==='healthfail'?'unhealthy':'healthy';
 else out=String(c.running && !(s.mode==='healthfail' && c.fresh));
}else if(a[0]==='rename'){s.containers[a[2]]=s.containers[a[1]];delete s.containers[a[1]];}
else if(a[0]==='stop')s.containers[a[1]].running=false;
else if(a[0]==='start')s.containers[a[1]].running=true;
else if(a[0]==='create'){
 if(s.mode==='createfail')code=1;else s.containers['ytc-tool-api']={running:false,fresh:true};
}else if(a[0]==='rm')delete s.containers[a.at(-1)];
else if(a[0]==='run' && s.mode==='envfail' && a.includes('none'))code=1;
else if(a[0]==='exec' && s.mode==='catalogfail')code=1;
fs.writeFileSync(file,JSON.stringify(s));if(out)console.log(out);process.exit(code);
`;
for(const mode of ['success','envfail','createfail','healthfail','catalogfail','checksumfail'])test('remote activation: '+mode,()=>{
 const stage=mkdtempSync('/tmp/ytc-tool-upload.');
 try{
  const bin=join(stage,'bin'),base=join(stage,'app');mkdirSync(bin);mkdirSync(base);
  const old=join(base,'previous');mkdirSync(old);writeFileSync(join(old,'server.env'),'old-secret');symlinkSync(old,join(base,'current'));
  const state=join(stage,'state.json');writeFileSync(state,JSON.stringify({mode,containers:{'ytc-tool-api':{running:true,fresh:false}},calls:[]}));
  const script=readFileSync(join(root,'deploy/activate-image.sh'),'utf8')
   .replace('$EUID == 0','0 == 0').replace('/run/lock/ytc-tool-docker.lock',join(stage,'lock')).replace('base=/opt/ytc-tool','base='+base);
  const entry=join(stage,'activate.sh');writeFileSync(entry,script);
  writeFileSync(join(stage,'verify-image.sh'),readFileSync(join(root,'deploy/verify-image.sh')));
  const wrappers={docker:fakeDocker,flock:'#!/bin/sh\nexit 0\n',sha256sum:'#!/bin/sh\n[ "$DEPLOY_MODE" != checksumfail ]\n',mv:'#!/usr/bin/env node\nrequire("fs").renameSync(process.argv.at(-2),process.argv.at(-1));\n'};
  for(const [name,body]of Object.entries(wrappers))writeFileSync(join(bin,name),body,{mode:0o755});
  writeFileSync(join(stage,'server.env'),source);writeFileSync(join(stage,'SHA256SUMS'),'fixture');
  writeFileSync(join(stage,'image.tar.gz'),execFileSync('gzip',['-c'],{input:'fixture image'}));
  const version='20260910T120000Z-123';
  const result=spawnSync('bash',[entry,stage,version,'3000','sha256:'+'a'.repeat(64),'linux/amd64'],{
   env:{...process.env,PATH:bin+':'+process.env.PATH,DEPLOY_STATE:state,DEPLOY_MODE:mode},encoding:'utf8',timeout:10000,
  });
  assert.equal(result.status,mode==='success'?0:1,result.stderr);
  const end=JSON.parse(readFileSync(state));assert.equal(end.containers['ytc-tool-api'].running,true);
  assert.equal(end.containers['ytc-tool-api'].fresh,mode==='success');
  assert.equal(readlinkSync(join(base,'current')),mode==='success'?join(base,'releases',version):old);
  assert.equal(readFileSync(join(old,'server.env'),'utf8'),'old-secret');
  if(['envfail','checksumfail'].includes(mode))assert.ok(!end.calls.some(c=>['rename','stop','create'].includes(c[0])));
  assert.ok(!result.stdout.includes('fixture-secret'));assert.ok(!result.stderr.includes('fixture-secret'));
 }finally{rmSync(stage,{recursive:true,force:true});}
});
import { createHash } from 'node:crypto';
import { imageConfigId } from '../../deploy/image-config-id.mjs';
for (const format of ['classic','oci']) test('image identity handles '+format+' archives and rejects different contents',()=>{
 const dir=mkdtempSync('/tmp/ytc-identity-test.');
 try {
  const content=Buffer.from('{"architecture":"amd64","os":"linux","config":{}}');
  const digest=createHash('sha256').update(content).digest('hex');
  const configPath=format==='classic'?digest+'.json':'blobs/sha256/'+digest;
  const parts=configPath.split('/');parts.pop();if(parts.length)mkdirSync(join(dir,...parts),{recursive:true});
  writeFileSync(join(dir,configPath),content);
  writeFileSync(join(dir,'manifest.json'),JSON.stringify([{Config:configPath,RepoTags:['fixture:version'],Layers:[]}])) ;
  const archive=join(dir,'fixture.tar');
  execFileSync('tar',['-cf',archive,'-C',dir,'manifest.json',configPath]);
  assert.equal(imageConfigId(archive,'fixture:version'),'sha256:'+digest);
  assert.throws(()=>imageConfigId(archive,'wrong:tag'),/exactly one/);
  const bin=join(dir,'bin');mkdirSync(bin);
  writeFileSync(join(bin,'docker'),`#!/usr/bin/env node
const fs=require('fs'),a=process.argv.slice(2);
if(a[0]==='image')console.log('sha256:'+'b'.repeat(64));
else if(a[0]==='save')fs.copyFileSync(process.env.IMAGE_ARCHIVE,a[2]);
else process.exit(1);
`,{mode:0o755});
  const run=(id)=>spawnSync('bash',[join(root,'deploy/verify-image.sh'),'fixture:version',id],{env:{...process.env,PATH:bin+':'+process.env.PATH,IMAGE_ARCHIVE:archive},encoding:'utf8'});
  assert.equal(run('sha256:'+digest).status,0);
  assert.notEqual(run('sha256:'+'c'.repeat(64)).status,0);
  writeFileSync(join(dir,configPath),'tampered');
  execFileSync('tar',['-cf',archive,'-C',dir,'manifest.json',configPath]);
  assert.throws(()=>imageConfigId(archive,'fixture:version'),/digest/);
  assert.notEqual(run('sha256:'+digest).status,0);
 } finally {rmSync(dir,{recursive:true,force:true});}
});
