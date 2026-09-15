import { readFile } from 'node:fs/promises';
import { audioKey,sha256 } from './audio-manifest.mjs';
export async function audioTableExists(db){
 const [tables]=await db.execute("SELECT TABLE_NAME FROM information_schema.tables WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='el_sentence_audio'");
 if(!tables.length)return false;
 const [columns]=await db.execute("SELECT COLUMN_NAME AS name,COLUMN_TYPE AS type FROM information_schema.columns WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='el_sentence_audio'");
 const types=new Map(columns.map(c=>[c.name,c.type.toLowerCase()]));
 const expected={id:'bigint unsigned',sentence_id:'bigint unsigned',text_sha256:'char(64)',file_name:'varchar(80)',file_sha256:'char(64)',voice:'varchar(100)',rate:'smallint unsigned',duration_ms:'int unsigned',created_at:'datetime(3)',updated_at:'datetime(3)',is_del:'tinyint unsigned'};
 for(const [name,type] of Object.entries(expected))if(types.get(name)?.replace(/\((?:\d+)\)(?= unsigned)/,'')!==type)throw Error('Existing audio table differs: '+name);
 const [indexes]=await db.execute("SELECT INDEX_NAME AS name,GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS cols,MAX(NON_UNIQUE) AS nonUnique FROM information_schema.statistics WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='el_sentence_audio' GROUP BY INDEX_NAME");
 if(!indexes.some(i=>i.name==='PRIMARY'&&i.cols==='id')||!indexes.some(i=>Number(i.nonUnique)===0&&i.cols==='sentence_id'))throw Error('Audio table lacks expected unique keys');
 const [foreignKeys]=await db.execute("SELECT COLUMN_NAME AS col,REFERENCED_TABLE_NAME AS targetTable,REFERENCED_COLUMN_NAME AS targetCol FROM information_schema.key_column_usage WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='el_sentence_audio' AND REFERENCED_TABLE_NAME IS NOT NULL");
 if(!foreignKeys.some(k=>k.col==='sentence_id'&&k.targetTable==='el_sentences'&&k.targetCol==='id'))throw Error('Audio table lacks sentence foreign key');
 return true;
}
export async function readAudioRows(db,entries,exists,{lock=false}={}){
 const collections=[...new Set(entries.map(e=>e.collectionKey))];
 const audio=exists?'a.id AS audioId,a.is_del AS audioDeleted,a.text_sha256 AS textHash,a.file_name AS file,a.file_sha256 AS sha256,a.voice,a.rate,a.duration_ms AS durationMs':'NULL AS audioId';
 const [rows]=await db.execute(`SELECT s.id AS sentenceId,s.en,s.is_del AS sentenceDeleted,e.is_del AS episodeDeleted,e.status AS episodeStatus,c.is_del AS collectionDeleted,c.status AS collectionStatus,
 s.source_key AS sentenceKey,e.source_key AS episodeKey,c.source_key AS collectionKey,${audio}
 FROM el_sentences s JOIN el_episodes e ON e.id=s.episode_id JOIN el_collections c ON c.id=e.collection_id
 ${exists?'LEFT JOIN el_sentence_audio a ON a.sentence_id=s.id':''}
 WHERE c.source_key IN (${collections.map(()=>'?').join(',')})${lock?' FOR UPDATE':''}`,collections);
 return rows;
}
export function audioPlan(entries,rows,exists){
 const map=new Map(rows.map(r=>[audioKey(r),r])),changes=[],conflicts=[];
 for(const entry of entries){
  const row=map.get(audioKey(entry));
  let reason='';
  if(!row)reason='sentence missing';
  else if(row.sentenceDeleted||row.episodeDeleted||row.collectionDeleted||row.episodeStatus!==1||row.collectionStatus!==1)reason='sentence/parent deleted or unpublished';
  else if(row.audioDeleted)reason='audio soft-deleted; refusing restore';
  else if(sha256(row.en)!==entry.textHash)reason='English differs';
  if(reason){conflicts.push({sentenceKey:entry.sentenceKey,episodeKey:entry.episodeKey,reason});continue;}
  const changed=row.audioId&&(['textHash','file','sha256','voice','rate'].some(k=>String(row[k])!==String(entry[k]))||Number(row.durationMs)!==Math.round(entry.duration*1000));
  changes.push({entry,sentenceId:String(row.sentenceId),audioId:row.audioId?String(row.audioId):null,action:!row.audioId?'insert':changed?'update':'unchanged'});
 }
 return {createTable:!exists,insert:changes.filter(c=>c.action==='insert').length,update:changes.filter(c=>c.action==='update').length,unchanged:changes.filter(c=>c.action==='unchanged').length,conflicts,changes};
}
export async function syncAudio(db,entries,{apply=false,acceptChanges=false,onPlan=()=>{},install=()=>{}}={}){
 let locked=false,transaction=false;
 try{
  if(apply){const [rows]=await db.query("SELECT GET_LOCK(CONCAT(DATABASE(),':sentence-audio'),0) AS acquired");if(Number(rows[0]?.acquired)!==1)throw Error('Another audio update is running');locked=true;}
  let exists=await audioTableExists(db);
  let plan=audioPlan(entries,await readAudioRows(db,entries,exists),exists);
  const report=({changes,...rest})=>rest;onPlan(report(plan));
  if(!apply)return report(plan);
  if(plan.conflicts.length)throw Error('Resolve audio import conflicts before applying');
  if(plan.update&&!acceptChanges)throw Error('Existing audio changes require --accept-changes');
  // Install immutable files before making their mappings visible; never delete old files.
  await install();
  if(!exists){await db.query(await readFile(new URL('../migrations/003_sentence_audio.sql',import.meta.url),'utf8'));exists=true;}
  await db.beginTransaction();transaction=true;
  plan=audioPlan(entries,await readAudioRows(db,entries,exists,{lock:true}),exists);
  if(plan.conflicts.length||(plan.update&&!acceptChanges))throw Error('Content changed during audio update; preview again');
  for(const c of plan.changes){
   if(c.action==='unchanged')continue;
   const e=c.entry,values=[e.textHash,e.file,e.sha256,e.voice,e.rate,Math.round(e.duration*1000)];
   if(c.action==='insert')await db.execute('INSERT INTO el_sentence_audio (text_sha256,file_name,file_sha256,voice,rate,duration_ms,sentence_id) VALUES (?,?,?,?,?,?,?)',[...values,c.sentenceId]);
   else await db.execute('UPDATE el_sentence_audio SET text_sha256=?,file_name=?,file_sha256=?,voice=?,rate=?,duration_ms=? WHERE id=? AND is_del=0',[...values,c.audioId]);
  }
  await db.commit();transaction=false;return report(plan);
 }finally{
  if(transaction)await db.rollback();
  if(locked)await db.query("SELECT RELEASE_LOCK(CONCAT(DATABASE(),':sentence-audio')) AS released");
 }
}
