import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, openSync, readSync, closeSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../database.service';

export interface VideoIdentity { id:string; collectionKey:string; episodeKey:string }
export interface VideoSentence extends VideoIdentity { sentenceKey:string; en:string; zh:string; speakerName?:string }
export interface Clip { sentenceKey:string; textHash:string; startMs:number; endMs:number }
export interface VideoEntry { collectionKey:string; episodeKey:string; sha256:string; file:string; durationMs:number; width:number; height:number; clips:Clip[] }
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
export const videoTextHash=(sentence:Pick<VideoSentence,'en'|'zh'|'speakerName'>)=>digest(JSON.stringify([sentence.en,sentence.zh,sentence.speakerName||'']));
const key=(entry:Pick<VideoIdentity,'collectionKey'|'episodeKey'>)=>JSON.stringify([entry.collectionKey,entry.episodeKey]);
const sha=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const sourceKey=(value:unknown)=>typeof value==='string'&&/^[a-z0-9-]{1,80}$/.test(value);
export function readVideoManifest(root:string):{version:1;entries:VideoEntry[]}{
 const path=join(root,'manifest.json');
 if(!lstatSync(root).isDirectory()||!lstatSync(path).isFile()||lstatSync(path).size>1024*1024)throw Error('Invalid video manifest');
 const data=JSON.parse(readFileSync(path,'utf8'));
 if(data.version!==1||!Array.isArray(data.entries)||!data.entries.length||data.entries.length>100)throw Error('Invalid video manifest');
 const episodes=new Set<string>();
 for(const entry of data.entries as VideoEntry[]){
  if(!entry||!sourceKey(entry.collectionKey)||!sourceKey(entry.episodeKey)||!sha(entry.sha256)||entry.file!==entry.sha256+'.mp4'||
   !Number.isSafeInteger(entry.durationMs)||entry.durationMs<=0||entry.durationMs>3600000||!Array.isArray(entry.clips)||!entry.clips.length||entry.clips.length>200||
   ![entry.width,entry.height].every(v=>Number.isSafeInteger(v)&&v>0&&v<=8192))throw Error('Invalid video entry');
  const seen=new Set<string>();let lastEnd=0;
  for(const clip of entry.clips){
   if(!clip||!sourceKey(clip.sentenceKey)||seen.has(clip.sentenceKey)||!sha(clip.textHash)||!Number.isSafeInteger(clip.startMs)||!Number.isSafeInteger(clip.endMs)||clip.startMs<lastEnd||clip.endMs<=clip.startMs||clip.endMs>entry.durationMs)throw Error('Invalid video clip');
   seen.add(clip.sentenceKey);lastEnd=clip.endMs;
  }
  if(episodes.has(key(entry)))throw Error('Duplicate video episode');episodes.add(key(entry));
 }
 return data;
}
// Only immutable content-addressed files are selected. Cache verification, never media bytes.
export class VideoFiles {
 private readonly signatures=new Map<string,string>();
 constructor(private readonly root:string){}
 find(entry:{file:string;sha256:string;durationMs:number}){
  if(!sha(entry.sha256)||entry.file!==entry.sha256+'.mp4'||!Number.isSafeInteger(entry.durationMs)||entry.durationMs<=0||entry.durationMs>3600000)return null;
  const path=join(this.root,'files',entry.file);
  try{
   if(!lstatSync(this.root).isDirectory()||!lstatSync(join(this.root,'files')).isDirectory())return null;
   const stat=lstatSync(path);if(!stat.isFile()||stat.size<12||stat.size>512*1024*1024)return null;
   const signature=`${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
   if(this.signatures.get(entry.file)!==signature){
    const hash=createHash('sha256'),buffer=Buffer.alloc(64*1024),fd=openSync(path,'r');
    try{let count:number;while((count=readSync(fd,buffer,0,buffer.length,null))>0)hash.update(buffer.subarray(0,count));}finally{closeSync(fd);}
    if(hash.digest('hex')!==entry.sha256)return null;
    this.signatures.set(entry.file,signature);
   }
   return {entry,path,size:stat.size};
  }catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;}
 }
}
// Import/validation utility only. The running API never reads this JSON mapping.
export class VideoLibrary {
 private readonly entries=new Map<string,VideoEntry>();
 private readonly files:VideoFiles;
 constructor(root:string){
  this.files=new VideoFiles(root);if(!existsSync(join(root,'manifest.json')))return;
  for(const entry of readVideoManifest(root).entries){
   this.entries.set(key(entry),entry);
   if(existsSync(join(root,'files',entry.file))&&!this.files.find(entry))throw Error('Video integrity check failed');
  }
 }
 find(identity:Pick<VideoIdentity,'collectionKey'|'episodeKey'>){const entry=this.entries.get(key(identity));return entry?this.files.find(entry):null;}
 metadata(identity:VideoIdentity){const video=this.find(identity);return video?{url:`/episodes/${identity.id}/video?version=${video.entry.sha256}`,version:video.entry.sha256,durationMs:video.entry.durationMs}:null;}
 clip(sentence:VideoSentence){const entry=this.entries.get(key(sentence)),clip=entry?.clips.find(c=>c.sentenceKey===sentence.sentenceKey);return entry&&this.find(sentence)&&clip&&clip.textHash===videoTextHash(sentence)?{startMs:clip.startMs,endMs:clip.endMs,version:entry.sha256}:null;}
 async clips(sentences:VideoSentence[]){return new Map(sentences.map(s=>[s.id,this.clip(s)]));}
}
@Injectable()
export class VideoService {
 private readonly files=new VideoFiles(process.env.VIDEO_DIR||resolve(__dirname,'../../video'));
 constructor(private readonly db:DatabaseService){}
 private async rows(sql:string,values:string[]){
  try{const [rows]=await this.db.pool.execute<RowDataPacket[]>(sql,values);return rows;}
  catch(error){if((error as NodeJS.ErrnoException).code==='ER_NO_SUCH_TABLE')return [];throw error;}
 }
 async find(identity:Pick<VideoIdentity,'id'>){
  const [entry]=await this.rows(`SELECT v.file_name AS file,v.file_sha256 AS sha256,v.duration_ms AS durationMs
   FROM el_episode_video v JOIN el_episodes e ON e.id=v.episode_id JOIN el_collections c ON c.id=e.collection_id
   WHERE e.id=? AND v.is_del=0 AND e.is_del=0 AND e.status=1 AND c.is_del=0 AND c.status=1`,[identity.id]);
  return entry?this.files.find(entry as {file:string;sha256:string;durationMs:number}):null;
 }
 async metadata(identity:VideoIdentity){const video=await this.find(identity);return video?{url:`/episodes/${identity.id}/video?version=${video.entry.sha256}`,version:video.entry.sha256,durationMs:video.entry.durationMs}:null;}
 async clips(sentences:VideoSentence[]){
  const result=new Map<string,{startMs:number;endMs:number;version:string}|null>(sentences.map(s=>[s.id,null]));if(!sentences.length)return result;
  const rows=await this.rows(`SELECT s.id AS sentenceId,sv.text_sha256 AS textHash,sv.start_ms AS startMs,sv.end_ms AS endMs,
   v.file_name AS file,v.file_sha256 AS sha256,v.duration_ms AS durationMs
   FROM el_sentence_video sv JOIN el_sentences s ON s.id=sv.sentence_id
   JOIN el_episode_video v ON v.id=sv.video_id AND v.episode_id=s.episode_id AND sv.video_sha256=v.file_sha256
   JOIN el_episodes e ON e.id=s.episode_id JOIN el_collections c ON c.id=e.collection_id
   WHERE sv.is_del=0 AND v.is_del=0 AND s.is_del=0 AND e.is_del=0 AND e.status=1 AND c.is_del=0 AND c.status=1
   AND s.id IN (${sentences.map(()=>'?').join(',')})`,sentences.map(s=>s.id));
  const byId=new Map(sentences.map(s=>[s.id,s]));
  for(const row of rows){const sentence=byId.get(row.sentenceId);
   if(sentence&&row.textHash===videoTextHash(sentence)&&Number.isSafeInteger(row.startMs)&&Number.isSafeInteger(row.endMs)&&row.startMs>=0&&row.endMs>row.startMs&&row.endMs<=row.durationMs&&this.files.find(row as {file:string;sha256:string;durationMs:number}))result.set(sentence.id,{startMs:row.startMs,endMs:row.endMs,version:row.sha256});
  }
  return result;
 }
}
