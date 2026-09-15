import { Injectable, Optional } from '@nestjs/common';
import { DatabaseService } from '../database.service';
import { RowDataPacket } from 'mysql2/promise';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

export interface AudioSentence { id:string; en:string; collectionKey:string; episodeKey:string; sentenceKey:string }
interface Entry { collectionKey:string; episodeKey:string; sentenceKey:string; textHash:string; file:string; sha256:string; duration:number; voice:string; rate:number }
export const hash=(data:string|Buffer)=>createHash('sha256').update(data).digest('hex');
const key=(s:{collectionKey:string;episodeKey:string;sentenceKey:string})=>JSON.stringify([s.collectionKey,s.episodeKey,s.sentenceKey]);
const regular=(file:string,max:number)=>{const stat=lstatSync(file);if(!stat.isFile()||stat.size>max)throw Error('Invalid audio file: '+file);return readFileSync(file);};

// Only manifest-listed files are read. Never construct a filesystem path from a request.
export class AudioLibrary {
 private readonly clips=new Map<string,Entry>();
 constructor(protected readonly root:string,loadManifest=true){
  if(!loadManifest)return;
  const manifest=join(root,'manifest.json');
  if(!existsSync(manifest))return;
  if(!lstatSync(root).isDirectory()||!lstatSync(join(root,'files')).isDirectory())throw Error('Invalid audio directory');
  const data=JSON.parse(regular(manifest,4*1024*1024).toString('utf8'));
  if(data.version!==1||!Array.isArray(data.entries)||data.entries.length>10000)throw Error('Invalid audio manifest');
  for(const entry of data.entries as Entry[]){
   if(!entry||![entry.collectionKey,entry.episodeKey,entry.sentenceKey].every(v=>typeof v==='string'&&v.length>0&&v.length<=200)||
    !/^[a-f0-9]{64}$/.test(entry.textHash)||!/^[a-f0-9]{64}$/.test(entry.sha256)||
    ![entry.sha256+'.wav',entry.sha256+'.mp3'].includes(entry.file)||!Number.isFinite(entry.duration)||entry.duration<=0||entry.duration>120||
    typeof entry.voice!=='string'||!entry.voice||!Number.isFinite(entry.rate)||entry.rate<=0)throw Error('Invalid audio entry');
   this.read(entry);
   if(this.clips.has(key(entry)))throw Error('Duplicate audio sentence');
   this.clips.set(key(entry),entry);
  }
 }
 protected read(entry:Entry){
  if(![entry.sha256+'.wav',entry.sha256+'.mp3'].includes(entry.file)||!/^[a-f0-9]{64}$/.test(entry.sha256))throw Error('Invalid audio path');
  const buffer=regular(join(this.root,'files',entry.file),12*1024*1024),wav=entry.file.endsWith('.wav');
  if(hash(buffer)!==entry.sha256||buffer.length<44||(wav&&(buffer.toString('ascii',0,4)!=='RIFF'||buffer.toString('ascii',8,12)!=='WAVE')))throw Error('Audio integrity check failed');
  return {entry,buffer,type:wav?'audio/wav':'audio/mpeg'};
 }
 match(sentence:AudioSentence){const entry=this.clips.get(key(sentence));return entry&&entry.textHash===hash(sentence.en)?this.read(entry):null;}
 url(sentence:AudioSentence){const entry=this.clips.get(key(sentence));return entry&&entry.textHash===hash(sentence.en)?`/sentences/${sentence.id}/audio?version=${entry.sha256}`:null;}
 async urls(sentences:AudioSentence[]):Promise<Map<string,string|null>>{return new Map(sentences.map(s=>[s.id,this.url(s)]));}
 async find(sentence:AudioSentence){return this.match(sentence);}
 get size(){return this.clips.size;}
}
@Injectable()
export class AudioService extends AudioLibrary {
 private readonly databaseMode:boolean;
 constructor(@Optional() private readonly db?:DatabaseService){
  const mode=process.env.AUDIO_SOURCE||'manifest';
  if(!['manifest','database'].includes(mode))throw Error('Invalid AUDIO_SOURCE');
  super(process.env.AUDIO_DIR||resolve(__dirname,'../../audio'),mode==='manifest');
  this.databaseMode=mode==='database';
 }
 private async mappings(ids:string[]){
  if(!this.db)throw Error('Audio database unavailable');
  if(!ids.length)return [];
  try{const [rows]=await this.db.pool.execute<RowDataPacket[]>(`SELECT sentence_id AS sentenceId,text_sha256 AS textHash,file_name AS file,
   file_sha256 AS sha256,duration_ms AS durationMs,voice,rate FROM el_sentence_audio WHERE is_del=0 AND sentence_id IN (${ids.map(()=>'?').join(',')})`,ids);
  return rows;
  }catch(error){if((error as NodeJS.ErrnoException).code==='ER_NO_SUCH_TABLE')return [];throw error;}
 }
 async urls(sentences:AudioSentence[]):Promise<Map<string,string|null>>{
  if(!this.databaseMode)return super.urls(sentences);
  const rows=await this.mappings(sentences.map(s=>s.id)),mapping=new Map(rows.map(row=>[row.sentenceId,row]));
  return new Map(sentences.map(s=>{const row=mapping.get(s.id);return [s.id,row&&row.textHash===hash(s.en)&&/^[a-f0-9]{64}$/.test(row.sha256)?`/sentences/${s.id}/audio?version=${row.sha256}`:null];}));
 }
 async find(sentence:AudioSentence){
  if(!this.databaseMode)return super.find(sentence);
  const [row]=await this.mappings([sentence.id]);
  if(!row||row.textHash!==hash(sentence.en))return null;
  try{return this.read({...sentence,textHash:row.textHash,file:row.file,sha256:row.sha256,voice:row.voice,rate:row.rate,duration:row.durationMs/1000});}
  catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;}
 }
}
