import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync } from 'node:fs';
import { resolve,join } from 'node:path';
import { spawnSync } from 'node:child_process';
const root=resolve(import.meta.dirname,'../..');
for(const apply of [false,true])test('audio uploader '+(apply?'apply':'preview')+' packages correct files and only dispatches explicit flags',()=>{
 const dir=mkdtempSync('/tmp/ytc-upload-test.');
 try{
  const bin=join(dir,'bin');mkdirSync(bin);const trace=join(dir,'trace');
  writeFileSync(join(bin,'ssh'),`#!/usr/bin/env node
const fs=require('fs'),a=process.argv.slice(2);if(a.includes('-O'))process.exit(0);if(a.at(-1).includes('mktemp'))console.log('/tmp/ytc-audio-upload.Fixture01');else{const script=fs.readFileSync(0,'utf8');fs.appendFileSync(process.env.UPLOAD_TRACE,JSON.stringify({args:a,script})+'\\n');}
`,{mode:0o755});
  writeFileSync(join(bin,'scp'),`#!/usr/bin/env node
const fs=require('fs'),a=process.argv.slice(2);fs.appendFileSync(process.env.UPLOAD_TRACE,JSON.stringify({files:fs.readdirSync(a.at(-2)),args:a})+'\\n');
`,{mode:0o755});
  const args=[join(root,'sync-audio.sh'),'--host','example.test','--database=ytc-tool-prod',...(apply?['--apply','--accept-changes']:[])];
  const result=spawnSync('bash',args,{env:{...process.env,PATH:bin+':'+process.env.PATH,UPLOAD_TRACE:trace},encoding:'utf8',timeout:30000});
  assert.equal(result.status,0,result.stderr);const records=readFileSync(trace,'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(records[0].files.sort(),['audio-schema.sql','files.txt','manifest.json']);
  const remoteRecord=records.find(r=>r.script?.includes('docker run'));
  assert.ok(remoteRecord);
  if(apply)assert.match(result.stdout,/All audio files already uploaded/);
  assert.equal(remoteRecord.args.at(-2),apply?'apply':'plan');assert.equal(remoteRecord.args.at(-1),apply?'true':'false');
  assert.ok(!records[0].args.includes('-q'));assert.ok(records[0].args.some(a=>a.startsWith('ControlPath=')));assert.ok(remoteRecord.args.includes('ControlMaster=auto'));
  assert.match(result.stdout,/\[3\/4\]/);assert.match(result.stdout,/Upload complete/);
  assert.match(remoteRecord.script,/target=\/bundle,readonly/);assert.match(remoteRecord.script,/target=\/app\/server\/migrations\/003_sentence_audio.sql,readonly/);assert.match(remoteRecord.script,/flock -n/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
for(const mode of ['plan','apply'])test('remote shell executes without local SSH variables: '+mode,()=>{
 const stage=mkdtempSync('/tmp/ytc-audio-upload.');
 const harness=mkdtempSync('/tmp/ytc-audio-shell-test.');
 try{
  const bin=join(harness,'bin');mkdirSync(bin);const trace=join(harness,'docker.json');
  writeFileSync(join(bin,'flock'),'#!/bin/sh\nexit 0\n',{mode:0o755});
  writeFileSync(join(bin,'docker'),`#!/bin/sh
if [ "$1" = inspect ]; then
 case "$3" in *Config.Image*) echo 'ytc-tool-api:20260913T120000Z-123';; *) echo '/opt/ytc-tool/audio:false';; esac
elif [ "$1" = run ]; then
 printf '%s\\n' "$@" > "$DOCKER_TRACE"
else exit 1
fi
`,{mode:0o755});
  const source=readFileSync(join(root,'sync-audio.sh'),'utf8');
  const script=source.split("<<'REMOTE'\n")[1].split('\nREMOTE\n')[0].replace('$EUID == 0','0 == 0').replace('/run/lock/ytc-tool-docker.lock',join(harness,'lock'));
  const env={...process.env,PATH:bin+':'+process.env.PATH,DOCKER_TRACE:trace};delete env.ssh_port;delete env.host;
  const result=spawnSync('bash',['-s','--',stage,'ytc-tool-prod',mode,mode==='apply'?'true':'false'],{input:script,env,encoding:'utf8',timeout:10000});
  assert.equal(result.status,0,result.stderr);const args=readFileSync(trace,'utf8').trim().split('\n');
  assert.ok(args.includes('--database=ytc-tool-prod'));assert.equal(args.includes('--apply'),mode==='apply');assert.equal(args.includes('--accept-changes'),mode==='apply');
 }finally{rmSync(stage,{recursive:true,force:true});rmSync(harness,{recursive:true,force:true});}
});
