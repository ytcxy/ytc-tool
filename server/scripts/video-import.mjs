import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
const textHash=s=>createHash('sha256').update(JSON.stringify([s.en,s.zh,s.speakerName||''])).digest('hex');
const common={id:'bigint unsigned',created_at:'datetime(3)',updated_at:'datetime(3)',is_del:'tinyint unsigned'};
export const videoSchema={
 el_episode_video:{columns:{...common,episode_id:'bigint unsigned',file_name:'varchar(80)',file_sha256:'char(64)',duration_ms:'int unsigned',width:'smallint unsigned',height:'smallint unsigned'},unique:'episode_id',foreign:{episode_id:'el_episodes'}},
 el_sentence_video:{columns:{...common,sentence_id:'bigint unsigned',video_id:'bigint unsigned',video_sha256:'char(64)',text_sha256:'char(64)',start_ms:'int unsigned',end_ms:'int unsigned'},unique:'sentence_id',foreign:{sentence_id:'el_sentences',video_id:'el_episode_video'}},
};
export async function checkVideoSchema(db){
 const present={};
 for(const [table,expected] of Object.entries(videoSchema)){
  const [tables]=await db.execute('SELECT TABLE_NAME FROM information_schema.tables WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?',[table]);
  present[table]=!!tables.length;if(!tables.length)continue;
  const [columns]=await db.execute('SELECT COLUMN_NAME AS name,COLUMN_TYPE AS type,IS_NULLABLE AS nullable,COLUMN_DEFAULT AS def,EXTRA AS extra,COLLATION_NAME AS collation FROM information_schema.columns WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?',[table]);
  for(const [name,type] of Object.entries(expected.columns)){
   const c=columns.find(c=>c.name===name);
   if(!c||c.type.toLowerCase().replace(/\(\d+\)(?= unsigned)/,'')!==type||c.nullable!=='NO')throw Error(`Existing ${table} differs: ${name}`);
   if((name.endsWith('sha256')||name==='file_name')&&c.collation!=='ascii_bin')throw Error('Video hash/path collation differs');
   if(name==='id'&&!c.extra.includes('auto_increment'))throw Error('Video ID must auto increment');
   if(name==='is_del'&&String(c.def)!=='0')throw Error('Video soft-delete default differs');
   if(['created_at','updated_at'].includes(name)&&String(c.def).toLowerCase()!=='current_timestamp(3)')throw Error('Video timestamp default differs');
   if(name==='updated_at'&&!c.extra.toLowerCase().includes('on update current_timestamp(3)'))throw Error('Video updated_at differs');
  }
  const [indexes]=await db.execute('SELECT INDEX_NAME AS name,GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS cols,MAX(NON_UNIQUE) AS nonUnique FROM information_schema.statistics WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? GROUP BY INDEX_NAME',[table]);
  if(!indexes.some(i=>i.name==='PRIMARY'&&i.cols==='id')||!indexes.some(i=>Number(i.nonUnique)===0&&i.cols===expected.unique))throw Error('Video unique keys differ');
  const [fks]=await db.execute(`SELECT k.COLUMN_NAME AS col,k.REFERENCED_TABLE_NAME AS targetTable,k.REFERENCED_COLUMN_NAME AS targetCol,r.DELETE_RULE AS deleteRule
   FROM information_schema.key_column_usage k JOIN information_schema.referential_constraints r ON r.CONSTRAINT_SCHEMA=k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME=k.CONSTRAINT_NAME AND r.TABLE_NAME=k.TABLE_NAME
   WHERE k.TABLE_SCHEMA=DATABASE() AND k.TABLE_NAME=? AND k.REFERENCED_TABLE_NAME IS NOT NULL`,[table]);
  for(const [col,target] of Object.entries(expected.foreign))if(!fks.some(f=>f.col===col&&f.targetTable===target&&f.targetCol==='id'&&['RESTRICT','NO ACTION'].includes(f.deleteRule)))throw Error('Video foreign keys differ');
 }
 // Never run CREATE against historical string-ID parents.
 const [parents]=await db.execute("SELECT TABLE_NAME AS tableName,COLUMN_TYPE AS type FROM information_schema.columns WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('el_episodes','el_sentences') AND COLUMN_NAME='id'");
 if(parents.length!==2||parents.some(p=>p.type.toLowerCase().replace(/\(\d+\)(?= unsigned)/,'')!=='bigint unsigned'))throw Error('Expected numeric BIGINT parent IDs');
 return present;
}
export async function readVideoSnapshot(db,entry,present,{lock=false}={}){
 const [parents]=await db.execute(`SELECT e.id AS episodeId,e.is_del AS episodeDeleted,e.status AS episodeStatus,c.is_del AS collectionDeleted,c.status AS collectionStatus
  FROM el_episodes e JOIN el_collections c ON c.id=e.collection_id WHERE c.source_key=? AND e.source_key=?${lock?' FOR UPDATE':''}`,[entry.collectionKey,entry.episodeKey]);
 const parent=parents[0];if(!parent)return {parent:null,video:null,sentences:[]};
 let video=null;
 if(present.el_episode_video){const [rows]=await db.execute(`SELECT id,episode_id AS episodeId,file_name AS file,file_sha256 AS sha256,duration_ms AS durationMs,width,height,is_del AS deleted FROM el_episode_video WHERE episode_id=?${lock?' FOR UPDATE':''}`,[parent.episodeId]);video=rows[0]||null;}
 const [sentences]=await db.execute(`SELECT s.id AS sentenceId,s.source_key AS sentenceKey,s.en,s.zh,s.speaker_name AS speakerName,s.is_del AS sentenceDeleted,
  ${present.el_sentence_video?'sv.id AS clipId,sv.video_id AS videoId,sv.is_del AS clipDeleted,sv.video_sha256 AS videoSha256,sv.text_sha256 AS textHash,sv.start_ms AS startMs,sv.end_ms AS endMs':'NULL AS clipId'}
  FROM el_sentences s ${present.el_sentence_video?'LEFT JOIN el_sentence_video sv ON sv.sentence_id=s.id':''} WHERE s.episode_id=?${lock?' FOR UPDATE':''}`,[parent.episodeId]);
 return {parent,video,sentences};
}
export function videoPlan(entry,snapshot){
 const {parent,video,sentences}=snapshot,conflicts=[],clips=[],byKey=new Map(sentences.map(s=>[s.sentenceKey,s]));
 if(!parent)conflicts.push('Episode missing');
 else if(parent.episodeDeleted||parent.collectionDeleted||parent.episodeStatus!==1||parent.collectionStatus!==1)conflicts.push('Episode/collection deleted or unpublished');
 if(video?.deleted)conflicts.push('Video soft-deleted; refusing restore');
 const videoAction=!video?'insert':['file','sha256','durationMs','width','height'].some(k=>String(entry[k])!==String(video[k]))?'update':'unchanged';
 for(const clip of entry.clips){
  const s=byKey.get(clip.sentenceKey);
  if(!s){conflicts.push(`Sentence missing: ${clip.sentenceKey}`);continue;}
  if(s.sentenceDeleted||s.clipDeleted){conflicts.push(`Sentence/clip soft-deleted; refusing restore: ${clip.sentenceKey}`);continue;}
  if(textHash(s)!==clip.textHash){conflicts.push(`Text differs: ${clip.sentenceKey}`);continue;}
  if(s.clipId&&(!video||s.videoId!==video.id)){conflicts.push(`Video ownership differs: ${clip.sentenceKey}`);continue;}
  const action=!s.clipId?'insert':s.videoSha256!==entry.sha256||['textHash','startMs','endMs'].some(k=>String(clip[k])!==String(s[k]))?'update':'unchanged';
  clips.push({sentenceId:s.sentenceId,clipId:s.clipId||null,action,clip});
 }
 const missing=sentences.filter(s=>s.clipId&&!s.clipDeleted&&!entry.clips.some(c=>c.sentenceKey===s.sentenceKey)).map(s=>s.sentenceKey);
 if(missing.length)conflicts.push('Existing clips omitted; explicit removal requires a separate review');
 return {collectionKey:entry.collectionKey,episodeKey:entry.episodeKey,episodeId:parent?.episodeId||null,videoId:video?.id||null,videoAction,
  publication:parent?{collection:parent.collectionStatus,episode:parent.episodeStatus}:null,videoBefore:video,videoAfter:{file:entry.file,sha256:entry.sha256,durationMs:entry.durationMs,width:entry.width,height:entry.height},
  insert:clips.filter(c=>c.action==='insert').length,update:clips.filter(c=>c.action==='update').length,unchanged:clips.filter(c=>c.action==='unchanged').length,missing,conflicts,clips};
}
const enforce=(plan,accept)=>{if(plan.conflicts.length)throw Error('Resolve video import conflicts before applying');if((plan.videoAction==='update'||plan.update)&&!accept)throw Error('Existing video changes require --accept-changes');};
export async function syncVideo(db,entries,{apply=false,acceptChanges=false,verify=()=>{},onPlan=()=>{}}={}){
 let locked=false,transaction=false;
 try{
  if(apply){const [rows]=await db.query("SELECT GET_LOCK(CONCAT(DATABASE(),':video-import'),0) AS acquired");if(Number(rows[0]?.acquired)!==1)throw Error('Another video import is running');locked=true;}
  let present=await checkVideoSchema(db);const plans=[];
  for(const entry of entries)plans.push(videoPlan(entry,await readVideoSnapshot(db,entry,present)));
  const report={createTables:Object.keys(present).filter(t=>!present[t]),episodes:plans};onPlan(report);if(!apply)return report;
  for(const plan of plans)enforce(plan,acceptChanges);
  // Validate every installed immutable file before DDL or making any mapping visible.
  await verify();
  const sql=await readFile(new URL('../migrations/006_episode_video.sql',import.meta.url),'utf8');
  for(const statement of sql.split(';').map(s=>s.trim()).filter(Boolean)){
   const table=/^CREATE TABLE (\w+)/.exec(statement)?.[1];if(!table||!(table in present))throw Error('Unexpected migration statement');
   if(!present[table])await db.query(statement);
  }
  present=await checkVideoSchema(db);
  for(const entry of entries){
   await db.beginTransaction();transaction=true;
   const plan=videoPlan(entry,await readVideoSnapshot(db,entry,present,{lock:true}));enforce(plan,acceptChanges);
   const values=[entry.file,entry.sha256,entry.durationMs,entry.width,entry.height];
   if(plan.videoAction==='insert')await db.execute('INSERT INTO el_episode_video (file_name,file_sha256,duration_ms,width,height,episode_id) VALUES (?,?,?,?,?,?)',[...values,plan.episodeId]);
   else if(plan.videoAction==='update')await db.execute('UPDATE el_episode_video SET file_name=?,file_sha256=?,duration_ms=?,width=?,height=? WHERE id=? AND is_del=0',[...values,plan.videoId]);
   // Resolve the real BIGINT key; mysql2 insertId may already have lost precision.
   const [rows]=await db.execute('SELECT id FROM el_episode_video WHERE episode_id=? AND is_del=0 FOR UPDATE',[plan.episodeId]);
   const videoId=rows[0]?.id;if(typeof videoId!=='string'||!/^[1-9][0-9]*$/.test(videoId))throw Error('Video ID must be a decimal string');
   for(const change of plan.clips){
    if(change.action==='unchanged')continue;
    const c=change.clip,values=[videoId,entry.sha256,c.textHash,c.startMs,c.endMs];
    if(change.action==='insert')await db.execute('INSERT INTO el_sentence_video (video_id,video_sha256,text_sha256,start_ms,end_ms,sentence_id) VALUES (?,?,?,?,?,?)',[...values,change.sentenceId]);
    else await db.execute('UPDATE el_sentence_video SET video_id=?,video_sha256=?,text_sha256=?,start_ms=?,end_ms=? WHERE id=? AND is_del=0',[...values,change.clipId]);
   }
   await db.commit();transaction=false;
  }
  return report;
 }finally{if(transaction)await db.rollback();if(locked)await db.query("SELECT RELEASE_LOCK(CONCAT(DATABASE(),':video-import')) AS released");}
}
