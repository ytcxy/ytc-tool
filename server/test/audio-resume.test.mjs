import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,existsSync } from 'node:fs';
import { join,resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
const root=resolve(import.meta.dirname,'../..');
test('resume reuses verified final and legacy uploads, rejecting incomplete files',()=>{
 const stage=mkdtempSync('/tmp/ytc-audio-upload.'),fixture=mkdtempSync('/tmp/ytc-audio-resume.');
 try{
  const final=join(fixture,'final'),legacy=join(fixture,'legacy'),bin=join(fixture,'bin');
  for(const dir of [final,legacy,bin,join(stage,'bundle')])mkdirSync(dir,{recursive:true});
  const contents=['final audio','legacy audio','incomplete audio','missing audio'];const names=contents.map(c=>createHash('sha256').update(c).digest('hex')+'.wav');
  writeFileSync(join(final,names[0]),contents[0]);writeFileSync(join(legacy,names[1]),contents[1]);writeFileSync(join(legacy,names[2]),'partial');
  writeFileSync(join(stage,'bundle/files.txt'),names.join('\n')+'\n');
  writeFileSync(join(bin,'sha256sum'),'#!/bin/sh\nexec shasum -a 256 "$@"\n',{mode:0o755});
  const script=readFileSync(join(root,'deploy/prepare-audio-upload.sh'),'utf8').replace('/opt/ytc-tool/audio/files/',final+'/').replace('/tmp/ytc-audio-upload.*/bundle/files/',legacy+'/');
  const run=()=>spawnSync('bash',['-s','--',stage],{input:script,env:{...process.env,PATH:bin+':'+process.env.PATH},encoding:'utf8'});
  const result=run();assert.equal(result.status,0,result.stderr);assert.deepEqual(result.stdout.trim().split('\n'),names.slice(2));assert.match(result.stderr,/reused 2, need upload 2/);
  for(let i=0;i<2;i++)assert.equal(readFileSync(join(stage,'bundle/files',names[i]),'utf8'),contents[i]);
  assert.ok(!existsSync(join(stage,'bundle/files',names[2])));assert.equal(readFileSync(join(legacy,names[2]),'utf8'),'partial');
  writeFileSync(join(final,names[2]),contents[2]);writeFileSync(join(final,names[3]),contents[3]);const complete=run();assert.equal(complete.status,0,complete.stderr);assert.equal(complete.stdout,'');assert.match(complete.stderr,/reused 4, need upload 0/);
 }finally{rmSync(stage,{recursive:true,force:true});rmSync(fixture,{recursive:true,force:true});}
});
test('missing-file response cannot select paths outside the manifest',()=>{
 const dir=mkdtempSync('/tmp/ytc-audio-select.');try{
  writeFileSync(join(dir,'manifest.json'),JSON.stringify({entries:[{file:'a'.repeat(64)+'.wav'}]}));writeFileSync(join(dir,'missing.txt'),'../../secret\n');
  const result=spawnSync(process.execPath,[join(root,'server/scripts/select-audio-upload.mjs'),dir,dir,join(dir,'missing.txt'),join(dir,'out')],{encoding:'utf8'});
  assert.notEqual(result.status,0);assert.match(result.stderr,/Invalid missing-file response/);assert.ok(!existsSync(join(dir,'out')));
 }finally{rmSync(dir,{recursive:true,force:true});}
});
