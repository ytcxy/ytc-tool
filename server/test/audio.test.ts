import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync,mkdtempSync,cpSync,mkdirSync,writeFileSync,rmSync,unlinkSync,symlinkSync } from 'node:fs';
import { resolve,join } from 'node:path';
import { AudioLibrary,AudioService,hash } from '../src/audio/audio.service';
import { AudioController } from '../src/audio/audio.controller';
import { CatalogService } from '../src/catalog/catalog.service';
const root=resolve(__dirname,'../audio'),library=new AudioLibrary(root);
const content=JSON.parse(readFileSync(resolve(__dirname,'../content/daily-200.json'),'utf8')),episode=content.episodes[0];
const manifest=JSON.parse(readFileSync(join(root,'manifest.json'),'utf8'));
const sentence={id:'9007199254740995',en:episode.sentences[0].en,collectionKey:content.sourceKey,episodeKey:episode.sourceKey,sentenceKey:episode.sentences[0].sourceKey};
test('all first episode sentences have matching, verified audio; parent keys and English must match',()=>{
 assert.equal(library.size,manifest.entries.length);
 for(const s of episode.sentences)assert.ok(library.match({...sentence,sentenceKey:s.sourceKey,en:s.en}));
 assert.match(library.url(sentence)!,/^\/sentences\/9007199254740995\/audio\?version=[a-f0-9]{64}$/);
 for(const change of [{en:'edited'}, {episodeKey:'other'}, {collectionKey:'other'}, {sentenceKey:'other'}])assert.equal(library.url({...sentence,...change}),null);
});
for(const mode of ['path','duplicate','corrupt','symlink','stale'])test('audio manifest rejects '+mode,()=>{
 const dir=mkdtempSync('/tmp/ytc-audio-test.');
 try{
  const data=JSON.parse(JSON.stringify({...manifest,entries:manifest.entries.slice(0,1)}));mkdirSync(join(dir,'files'));const file=join(dir,'files',data.entries[0].file);cpSync(join(root,'files',data.entries[0].file),file);
  if(mode==='path')data.entries[0].file='../manifest.json';
  if(mode==='duplicate')data.entries.push(data.entries[0]);
  if(mode==='corrupt')writeFileSync(file,'not audio');
  if(mode==='symlink'){unlinkSync(file);symlinkSync(join(root,'files',manifest.entries[0].file),file);}
  if(mode==='stale')data.entries[0].sha256='b'.repeat(64);
  writeFileSync(join(dir,'manifest.json'),JSON.stringify(data));assert.throws(()=>new AudioLibrary(dir));
 }finally{rmSync(dir,{recursive:true,force:true});}
});
function response(){return {code:200,headers:{} as Record<string,string|number>,status(code:number){this.code=code;return this;},setHeader(k:string,v:string|number){this.headers[k]=v;}};}
test('audio endpoint validates ID/version, checks visibility, and streams byte ranges',async()=>{
 const calls:string[]=[];let hidden=false;
 const controller=new AudioController({sentence:async(id:string)=>{calls.push(id);if(hidden)throw Error('not visible');return sentence;}} as unknown as CatalogService,library as AudioService);
 const clip=library.match(sentence)!;const version=clip.entry.sha256;
 const res=response();const file=await controller.play(sentence.id,version,undefined,res);assert.equal(file.getHeaders().length,clip.buffer.length);assert.equal(res.code,200);
 assert.equal(calls[0],sentence.id);assert.equal(res.headers['Cache-Control'],'private, no-cache');
 const partial=response();const bytes=await controller.play(sentence.id,version,'bytes=0-15',partial);assert.equal(partial.code,206);assert.equal(bytes.getHeaders().length,16);
 const suffix=response();assert.equal((await controller.play(sentence.id,version,'bytes=-10',suffix)).getHeaders().length,10);
 for(const range of ['bytes=99999999-','bytes=-0','bytes=1-0','bytes=0-1,2-3','bad']){const res=response();await controller.play(sentence.id,version,range,res);assert.equal(res.code,416);}
 await assert.rejects(()=>controller.play('../secret',version,undefined,response()));
 await assert.rejects(()=>controller.play(sentence.id,{},undefined,response()));
 await assert.rejects(()=>controller.play(sentence.id,'0'.repeat(64),undefined,response()));
 hidden=true;await assert.rejects(()=>controller.play(sentence.id,version,undefined,response()),/not visible/);
});
test('catalog audio query retains full publication/deletion guards and strips private mapping fields',async()=>{
 const queries:string[]=[];
 const db={pool:{execute:async(sql:string)=>{queries.push(sql);return [[{...sentence,sequence:1,zh:'你好',speaker:0,context:''}]];}}};
 const catalog=new CatalogService(db as any,library as AudioService);const result=await catalog.sentences('1');
 assert.ok(result.items[0].audioUrl);assert.ok(!('sentenceKey' in result.items[0]));await catalog.sentence(sentence.id);
 for(const sql of queries.slice(1))for(const predicate of ['s.is_del=0','e.is_del=0','e.status=1','c.is_del=0','c.status=1'])assert.ok(sql.includes(predicate));
});

test('database audio uses one batched query, exact BIGINT IDs and no startup manifest',async()=>{
 const oldSource=process.env.AUDIO_SOURCE,oldDir=process.env.AUDIO_DIR;
 try{
  process.env.AUDIO_SOURCE='database';process.env.AUDIO_DIR=root;const calls:any[]=[];let rows:any[]=[{sentenceId:sentence.id,...manifest.entries[0],durationMs:1000}];
  const service=new AudioService({pool:{execute:async(sql:string,ids:string[])=>{calls.push({sql,ids});return [rows];}}} as any);
  assert.equal(service.size,0);const urls=await service.urls([sentence]);assert.ok(urls.get(sentence.id));assert.deepEqual(calls[0].ids,[sentence.id]);assert.match(calls[0].sql,/is_del=0/);
  assert.ok(await service.find(sentence));rows=[];assert.equal((await service.urls([sentence])).get(sentence.id),null);assert.equal(await service.find(sentence),null);
 }finally{if(oldSource===undefined)delete process.env.AUDIO_SOURCE;else process.env.AUDIO_SOURCE=oldSource;if(oldDir===undefined)delete process.env.AUDIO_DIR;else process.env.AUDIO_DIR=oldDir;}
});

test('database audio missing migration hides audio without breaking catalog',async()=>{
 const old=process.env.AUDIO_SOURCE;process.env.AUDIO_SOURCE='database';
 try{const service=new AudioService({pool:{execute:async()=>{throw Object.assign(Error('missing'),{code:'ER_NO_SUCH_TABLE'});}}} as any);assert.equal((await service.urls([sentence])).get(sentence.id),null);}
 finally{if(old===undefined)delete process.env.AUDIO_SOURCE;else process.env.AUDIO_SOURCE=old;}
});
