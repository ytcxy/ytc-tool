import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { audioPlan,syncAudio } from '../scripts/audio-import.mjs';
import { sha256 } from '../scripts/audio-manifest.mjs';
const entry={collectionKey:'daily-200',episodeKey:'episode-1',sentenceKey:'sentence-1',textHash:sha256('Hello.'),file:'a'.repeat(64)+'.wav',sha256:'a'.repeat(64),voice:'Samantha',rate:145,duration:2};
const row={...entry,sentenceId:'9007199254740995',en:'Hello.',sentenceDeleted:0,episodeDeleted:0,collectionDeleted:0,episodeStatus:1,collectionStatus:1,audioId:null};
const types={id:'bigint unsigned',sentence_id:'bigint unsigned',text_sha256:'char(64)',file_name:'varchar(80)',file_sha256:'char(64)',voice:'varchar(100)',rate:'smallint unsigned',duration_ms:'int unsigned',created_at:'datetime(3)',updated_at:'datetime(3)',is_del:'tinyint unsigned'};
function fake({exists=true,rows=[row],fail=false,busy=false,lockedRows}={}){
 const calls=[];const db={calls,
  execute:async(sql,values)=>{calls.push({sql,values});
   if(sql.includes('information_schema.tables'))return [exists?[{}]:[]];
   if(sql.includes('information_schema.columns'))return [Object.entries(types).map(([name,type])=>({name,type}))];
   if(sql.includes('information_schema.statistics'))return [[{name:'PRIMARY',cols:'id',nonUnique:0},{name:'uk',cols:'sentence_id',nonUnique:0}]];
   if(sql.includes('information_schema.key_column_usage'))return [[{col:'sentence_id',targetTable:'el_sentences',targetCol:'id'}]];
   if(sql.startsWith('SELECT s.id'))return [sql.includes('FOR UPDATE')&&lockedRows?lockedRows:rows];
   if(fail&&sql.startsWith('INSERT'))throw Error('write failed');return [{}];},
  query:async(sql)=>{calls.push({sql});return [[{acquired:busy?0:1}]];},
  beginTransaction:async()=>calls.push({sql:'BEGIN'}),commit:async()=>calls.push({sql:'COMMIT'}),rollback:async()=>calls.push({sql:'ROLLBACK'})};return db;
}
test('audio preview missing table has no DDL, transaction or installation',async()=>{
 const db=fake({exists:false});const plan=await syncAudio(db,[entry],{install:()=>{throw Error('not allowed');}});
 assert.equal(plan.createTable,true);assert.equal(plan.insert,1);assert.ok(db.calls.every(c=>c.sql.startsWith('SELECT')));
});
test('audio plan rejects missing, stale, unpublished and soft-deleted mappings',()=>{
 for(const rows of [[],[{...row,en:'edited'}],[{...row,sentenceDeleted:1}],[{...row,episodeStatus:0}],[{...row,collectionDeleted:1}],[{...row,audioDeleted:1}]])assert.equal(audioPlan([entry],rows,true).conflicts.length,1);
});
test('audio apply installs before DDL and inserts with exact ID inside transaction',async()=>{
 const db=fake({exists:false});await syncAudio(db,[entry],{apply:true,install:()=>db.calls.push({sql:'INSTALL'})});
 const sql=db.calls.map(c=>c.sql);assert.ok(sql.indexOf('INSTALL')<sql.findIndex(s=>s.startsWith('CREATE TABLE')));
 const insert=db.calls.find(c=>c.sql.startsWith('INSERT'));assert.equal(insert.values.at(-1),'9007199254740995');assert.ok(sql.indexOf('BEGIN')<sql.indexOf(insert.sql));assert.ok(sql.includes('COMMIT'));
});
test('audio reimport is idempotent and changes require explicit acceptance',async()=>{
 const existing={...row,audioId:'9007199254740997',durationMs:2000};
 const db=fake({rows:[existing]});const result=await syncAudio(db,[entry],{apply:true});assert.equal(result.unchanged,1);assert.ok(!db.calls.some(c=>/^(INSERT|UPDATE)/.test(c.sql)));
 const changed={...entry,voice:'Other'};await assert.rejects(()=>syncAudio(fake({rows:[existing]}),[changed],{apply:true}),/accept-changes/);
 const update=fake({rows:[existing]});await syncAudio(update,[changed],{apply:true,acceptChanges:true});assert.equal(update.calls.find(c=>c.sql.startsWith('UPDATE')).values.at(-1),existing.audioId);
});
test('audio import aborts before writes on conflicts and refuses soft-delete restoration',async()=>{
 const db=fake({rows:[{...row,audioDeleted:1}]});await assert.rejects(()=>syncAudio(db,[entry],{apply:true,acceptChanges:true}),/conflicts/);assert.ok(!db.calls.some(c=>/^(INSERT|UPDATE|CREATE)/.test(c.sql)));
});
test('audio import rolls back failed writes and rechecks content under locks',async()=>{
 for(const opts of [{fail:true},{lockedRows:[{...row,en:'changed during preview'}]}]){
  const db=fake(opts);await assert.rejects(()=>syncAudio(db,[entry],{apply:true}));assert.ok(db.calls.some(c=>c.sql==='ROLLBACK'));assert.ok(db.calls.at(-1).sql.includes('RELEASE_LOCK'));
 }
});
test('concurrent audio updater is refused before any write',async()=>{
 const db=fake({busy:true});await assert.rejects(()=>syncAudio(db,[entry],{apply:true}),/Another/);assert.equal(db.calls.length,1);
});

test('audio schema and upload bundle use the same MySQL 5.7 compatible collation as learning tables',()=>{
 const sql=readFileSync(new URL('../migrations/003_sentence_audio.sql',import.meta.url),'utf8');
 assert.match(sql,/COLLATE=utf8mb4_unicode_ci/);assert.ok(!sql.includes('0900'));assert.ok(!sql.includes('CHECK'));
 assert.match(sql,/FOREIGN KEY \(sentence_id\) REFERENCES el_sentences\(id\)/);
});
