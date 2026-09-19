import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,mkdirSync,writeFileSync,rmSync,readFileSync,unlinkSync,symlinkSync } from 'node:fs';
import { join,resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { VideoLibrary,VideoService,videoTextHash } from '../src/video/video.service';
import { VideoController,videoRange } from '../src/video/video.controller';
import { CatalogService } from '../src/catalog/catalog.service';
const identity={id:'9007199254740993',collectionKey:'test-collection',episodeKey:'test-episode'};
const sentence={...identity,id:'9007199254740995',sentenceKey:'test-sentence',en:'Hi.',zh:'你好',speakerName:'奥利'};
function fixture(){
 const root=mkdtempSync('/tmp/ytc-video-test-'),buffer=Buffer.from('0000ftyp-test-video-bytes'),sha256=createHash('sha256').update(buffer).digest('hex');
 const entry={...identity,sha256,file:sha256+'.mp4',durationMs:10000,width:1280,height:720,clips:[{sentenceKey:sentence.sentenceKey,textHash:videoTextHash(sentence),startMs:1000,endMs:3000}]};
 const manifest={version:1,entries:[entry]};mkdirSync(join(root,'files'));writeFileSync(join(root,'files',entry.file),buffer);
 const save=()=>writeFileSync(join(root,'manifest.json'),JSON.stringify(manifest));save();
 return {root,buffer,entry,manifest,save,cleanup:()=>rmSync(root,{recursive:true,force:true})};
}
function response(){return {code:200,headers:{} as Record<string,string|number>,status(code:number){this.code=code;return this;},setHeader(k:string,v:string|number){this.headers[k]=v;}};}
async function bytes(file:any){const chunks:Buffer[]=[];for await(const chunk of file.getStream())chunks.push(Buffer.from(chunk));return Buffer.concat(chunks);}
test('video keeps BIGINT IDs, scopes clips to parents and invalidates changed text/media',()=>{
 const f=fixture();try{
  const library=new VideoLibrary(f.root);assert.match(library.metadata(identity)!.url,/9007199254740993/);assert.equal(library.clip(sentence)?.startMs,1000);
  for(const delta of [{collectionKey:'other'},{episodeKey:'other'},{en:'edited'},{zh:'改动'},{speakerName:'丹尼'},{sentenceKey:'other'}])assert.equal(library.clip({...sentence,...delta}),null);
  writeFileSync(join(f.root,'files',f.entry.file),'changed');assert.equal(library.metadata(identity),null);
 }finally{f.cleanup();}
});
test('manifest rejects unsafe filenames, overlapping/out-of-range clips and duplicates',()=>{
 for(const change of ['path','overlap','end','duplicate','hash','symlink']){
  const f=fixture();try{
   if(change==='path')f.entry.file='../secret.mp4';
   if(change==='overlap')f.entry.clips.push({...f.entry.clips[0],sentenceKey:'second',startMs:2000});
   if(change==='end')f.entry.clips[0].endMs=10001;
   if(change==='duplicate')f.manifest.entries.push(f.entry);
   if(change==='hash')writeFileSync(join(f.root,'files',f.entry.file),'bad video hash');
   if(change==='symlink'){unlinkSync(join(f.root,'files',f.entry.file));symlinkSync(join(f.root,'manifest.json'),join(f.root,'files',f.entry.file));}
   f.save();assert.throws(()=>new VideoLibrary(f.root),undefined,change);
  }finally{f.cleanup();}
 }
});
test('missing media hides capability without breaking existing collections',()=>{
 const f=fixture();try{unlinkSync(join(f.root,'files',f.entry.file));const library=new VideoLibrary(f.root);assert.equal(library.metadata(identity),null);assert.equal(library.clip(sentence),null);}finally{f.cleanup();}
});
test('video endpoint streams exact ranges, rejects invalid IDs/versions and rechecks visibility',async()=>{
 const f=fixture();try{
  const library=new VideoLibrary(f.root);let hidden=false;const seen:string[]=[];
  const catalog={videoIdentity:async(id:string)=>{seen.push(id);if(hidden)throw Error('hidden parent');return identity;}};
  const controller=new VideoController(catalog as any,library as unknown as VideoService);
  const full=response();assert.deepEqual(await bytes(await controller.play(identity.id,f.entry.sha256,undefined,full)),f.buffer);
  const res=response();assert.deepEqual(await bytes(await controller.play(identity.id,f.entry.sha256,'bytes=2-8',res)),f.buffer.subarray(2,9));assert.equal(res.code,206);
  for(const range of ['bytes=-0','bytes=100-','bytes=4-2','bytes=1-2,3-4','bytes=99999999999999999999-','oops']){const r=response();await controller.play(identity.id,f.entry.sha256,range,r);assert.equal(r.code,416,range);}
  assert.deepEqual(videoRange('bytes=-4',f.buffer.length),{start:f.buffer.length-4,end:f.buffer.length-1});
  await assert.rejects(()=>controller.play('../file',f.entry.sha256,undefined,response()));await assert.rejects(()=>controller.play(identity.id,'0'.repeat(64),undefined,response()));
  hidden=true;await assert.rejects(()=>controller.play(identity.id,f.entry.sha256,undefined,response()),/hidden parent/);assert.ok(seen.every(id=>id===identity.id));
 }finally{f.cleanup();}
});
test('catalog video response does not expose source keys and guards all parent states',async()=>{
 const f=fixture();try{
  const queries:string[]=[];const db={pool:{execute:async(sql:string)=>{queries.push(sql);return [[sql.includes('FROM el_sentences')?sentence:identity]];}}};
  const catalog=new CatalogService(db as any,undefined,new VideoLibrary(f.root) as unknown as VideoService);
  const episode=await catalog.episode(identity.id);assert.ok(episode.video);assert.equal('episodeKey' in episode,false);
  const result=await catalog.sentences(identity.id);assert.ok(result.items[0].videoClip);assert.equal('sentenceKey' in result.items[0],false);
  for(const sql of queries)for(const guard of ['e.is_del=0','e.status=1','c.is_del=0','c.status=1'])assert.ok(sql.includes(guard));
  assert.ok(queries.find(sql=>sql.includes('FROM el_sentences'))?.includes('s.is_del=0'));
 }finally{f.cleanup();}
});
test('first episode manifest covers existing 14 statements without rewriting identity',()=>{
 const manifest=JSON.parse(readFileSync(resolve(__dirname,'../video/manifest.json'),'utf8'));
 const content=JSON.parse(readFileSync(resolve(__dirname,'../content/forced-english-system.json'),'utf8'));
 const entry=manifest.entries[0];assert.equal(entry.collectionKey,content.sourceKey);assert.equal(entry.episodeKey,content.episodes[0].sourceKey);
 assert.equal(entry.clips.length,14);for(const s of content.episodes[0].sentences)assert.equal(entry.clips.find((c:any)=>c.sentenceKey===s.sourceKey)?.textHash,videoTextHash(s));
});

test('database runtime ignores JSON, batches numeric sentence IDs, and sees edits without restart',async()=>{
 const f=fixture(),old=process.env.VIDEO_DIR;
 try{
  process.env.VIDEO_DIR=f.root;writeFileSync(join(f.root,'manifest.json'),'not JSON; runtime must not read');
  const queries:{sql:string;values:string[]}[]=[];let endMs=3000,hash=videoTextHash(sentence),missing=false;
  const service=new VideoService({pool:{execute:async(sql:string,values:string[])=>{
   queries.push({sql,values});if(missing)throw Object.assign(Error('missing'),{code:'ER_NO_SUCH_TABLE'});
   return [[{file:f.entry.file,sha256:f.entry.sha256,durationMs:10000,sentenceId:sentence.id,textHash:hash,startMs:1000,endMs}]];
  }}} as any);
  assert.ok(await service.metadata(identity));assert.equal((await service.clips([sentence])).get(sentence.id)?.endMs,3000);
  endMs=3200;assert.equal((await service.clips([sentence])).get(sentence.id)?.endMs,3200);
  const query=queries.find(q=>q.sql.includes('FROM el_sentence_video'))!;assert.deepEqual(query.values,[sentence.id]);
  for(const guard of ['sv.is_del=0','v.is_del=0','s.is_del=0','e.is_del=0','e.status=1','c.is_del=0','c.status=1','v.episode_id=s.episode_id','sv.video_sha256=v.file_sha256'])assert.ok(query.sql.includes(guard));
  hash='0'.repeat(64);assert.equal((await service.clips([sentence])).get(sentence.id),null);
  missing=true;assert.equal(await service.metadata(identity),null);assert.equal((await service.clips([sentence])).get(sentence.id),null);
 }finally{if(old===undefined)delete process.env.VIDEO_DIR;else process.env.VIDEO_DIR=old;f.cleanup();}
});
