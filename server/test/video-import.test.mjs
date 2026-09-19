import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { videoPlan,syncVideo,videoSchema } from '../scripts/video-import.mjs';
const sha='a'.repeat(64),sentence={sentenceId:'9007199254740995',sentenceKey:'sentence-1',en:'Hello.',zh:'你好',speakerName:'奥利',sentenceDeleted:0,clipId:null};
const hash=createHash('sha256').update(JSON.stringify([sentence.en,sentence.zh,sentence.speakerName])).digest('hex');
const entry={collectionKey:'collection-1',episodeKey:'episode-1',sha256:sha,file:sha+'.mp4',durationMs:3000,width:1280,height:720,clips:[{sentenceKey:'sentence-1',textHash:hash,startMs:100,endMs:2000}]};
const parent={episodeId:'9007199254740993',episodeDeleted:0,collectionDeleted:0,episodeStatus:1,collectionStatus:1};
const snapshot={parent,video:null,sentences:[sentence]};
function fake({exists=true,state=snapshot,lockedState=state,fail=false,busy=false}={}){
 const calls=[];const present={el_episode_video:exists,el_sentence_video:exists};
 return {calls,execute:async(sql,values)=>{
  calls.push({sql,values});
  if(sql.includes('information_schema.tables'))return [present[values[0]]?[{}]:[]];
  if(sql.includes('information_schema.columns')&&sql.includes("TABLE_NAME IN"))return [[{type:'bigint unsigned'},{type:'bigint unsigned'}]];
  if(sql.includes('information_schema.columns'))return [Object.entries(videoSchema[values[0]].columns).map(([name,type])=>({name,type,nullable:'NO',def:name==='is_del'?'0':['created_at','updated_at'].includes(name)?'CURRENT_TIMESTAMP(3)':null,extra:name==='id'?'auto_increment':name==='updated_at'?'on update CURRENT_TIMESTAMP(3)':'',collation:'ascii_bin'}))];
  if(sql.includes('information_schema.statistics'))return [[{name:'PRIMARY',cols:'id',nonUnique:0},{name:'unique',cols:videoSchema[values[0]].unique,nonUnique:0}]];
  if(sql.includes('information_schema.key_column_usage'))return [Object.entries(videoSchema[values[0]].foreign).map(([col,targetTable])=>({col,targetTable,targetCol:'id',deleteRule:'RESTRICT'}))];
  const current=sql.includes('FOR UPDATE')?lockedState:state;
  if(sql.startsWith('SELECT e.id'))return [current.parent?[current.parent]:[]];
  if(sql.startsWith('SELECT id,episode_id'))return [current.video?[current.video]:[]];
  if(sql.startsWith('SELECT s.id'))return [current.sentences];
  if(sql.startsWith('SELECT id FROM el_episode_video'))return [[{id:'9007199254740997'}]];
  if(fail&&sql.startsWith('INSERT INTO el_sentence_video'))throw Error('write failed');
  return [{insertId:999}];
 },query:async(sql)=>{calls.push({sql});if(sql.startsWith('CREATE TABLE'))present[/^CREATE TABLE (\w+)/.exec(sql)[1]]=true;return [[{acquired:busy?0:1}]];},beginTransaction:async()=>calls.push({sql:'BEGIN'}),commit:async()=>calls.push({sql:'COMMIT'}),rollback:async()=>calls.push({sql:'ROLLBACK'})};
}
test('video dry-run reports two missing tables and performs no DDL or transaction',async()=>{const db=fake({exists:false});const p=await syncVideo(db,[entry]);assert.equal(p.createTables.length,2);assert.equal(p.episodes[0].insert,1);assert.ok(db.calls.every(c=>c.sql.startsWith('SELECT')));});
test('video import verifies files before DDL, resolves BIGINT ID and commits atomically',async()=>{const db=fake({exists:false});await syncVideo(db,[entry],{apply:true,verify:()=>db.calls.push({sql:'VERIFY'})});const sql=db.calls.map(c=>c.sql);assert.ok(sql.indexOf('VERIFY')<sql.findIndex(s=>s.startsWith('CREATE TABLE')));const insert=db.calls.find(c=>c.sql.startsWith('INSERT INTO el_sentence_video'));assert.equal(insert.values[0],'9007199254740997');assert.equal(insert.values.at(-1),sentence.sentenceId);assert.ok(sql.indexOf('BEGIN')<sql.indexOf(insert.sql));assert.ok(sql.includes('COMMIT'));});
test('video import refuses missing files before creating tables',async()=>{const db=fake({exists:false});await assert.rejects(()=>syncVideo(db,[entry],{apply:true,verify:()=>{throw Error('missing file');}}),/missing file/);assert.ok(!db.calls.some(c=>/^(CREATE|INSERT|UPDATE)/.test(c.sql)));});
test('video conflicts cover missing, hidden, changed, deleted and wrong-owner resources',()=>{
 for(const state of [{...snapshot,parent:null},{...snapshot,parent:{...parent,episodeStatus:0}},{...snapshot,parent:{...parent,collectionDeleted:1}},{...snapshot,video:{deleted:1}},{...snapshot,sentences:[{...sentence,sentenceDeleted:1}]},{...snapshot,sentences:[{...sentence,clipDeleted:1}]},{...snapshot,sentences:[{...sentence,en:'changed'}]},{...snapshot,sentences:[{...sentence,clipId:'9',videoId:'other'}]}])assert.ok(videoPlan(entry,state).conflicts.length);
});
const existing={...snapshot,video:{...entry,id:'9007199254740997',deleted:0},sentences:[{...sentence,clipId:'9007199254740999',videoId:'9007199254740997',videoSha256:sha,...entry.clips[0]}]};
test('reimport is idempotent; accepted edits preserve both numeric IDs',async()=>{
 const db=fake({state:existing});const plan=await syncVideo(db,[entry],{apply:true});assert.equal(plan.episodes[0].unchanged,1);assert.ok(!db.calls.some(c=>/^(INSERT|UPDATE)/.test(c.sql)));
 const changed={...entry,clips:[{...entry.clips[0],endMs:2100}]};await assert.rejects(()=>syncVideo(fake({state:existing}),[changed],{apply:true}),/accept-changes/);
 const update=fake({state:existing});await syncVideo(update,[changed],{apply:true,acceptChanges:true});assert.equal(update.calls.find(c=>c.sql.startsWith('UPDATE el_sentence_video')).values.at(-1),'9007199254740999');
});
test('omitted existing clips are reported and never silently deleted',()=>{const plan=videoPlan({...entry,clips:[]},existing);assert.deepEqual(plan.missing,['sentence-1']);assert.ok(plan.conflicts.length);});
test('failed write or concurrent soft-delete rolls back; importer lock is released',async()=>{
 for(const opts of [{fail:true},{lockedState:{...snapshot,sentences:[{...sentence,clipDeleted:1}]}}]){const db=fake(opts);await assert.rejects(()=>syncVideo(db,[entry],{apply:true}));assert.ok(db.calls.some(c=>c.sql==='ROLLBACK'));assert.ok(db.calls.at(-1).sql.includes('RELEASE_LOCK'));}
});
test('parallel importer is refused before touching schema or rows',async()=>{const db=fake({busy:true});await assert.rejects(()=>syncVideo(db,[entry],{apply:true}),/Another/);assert.equal(db.calls.length,1);});
