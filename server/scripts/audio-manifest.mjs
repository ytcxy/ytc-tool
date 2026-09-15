import { readFileSync,lstatSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
export const sha256=data=>createHash('sha256').update(data).digest('hex');
export const audioKey=e=>JSON.stringify([e.collectionKey,e.episodeKey,e.sentenceKey]);
export function readManifest(root,{files=true}={}){
 const path=join(root,'manifest.json'),stat=lstatSync(path);
 if(!stat.isFile()||stat.size>8*1024*1024)throw Error('Invalid manifest file');
 const data=JSON.parse(readFileSync(path,'utf8')),seen=new Set();
 if(data.version!==1||!Array.isArray(data.entries)||!data.entries.length||data.entries.length>10000)throw Error('Invalid audio manifest');
 for(const e of data.entries){
  if(!e||![e.collectionKey,e.episodeKey,e.sentenceKey].every(v=>typeof v==='string'&&/^[a-z0-9-]{1,80}$/.test(v))||
   !/^[a-f0-9]{64}$/.test(e.textHash)||!/^[a-f0-9]{64}$/.test(e.sha256)||![e.sha256+'.wav',e.sha256+'.mp3'].includes(e.file)||
   !Number.isFinite(e.duration)||e.duration<=0||e.duration>120||typeof e.voice!=='string'||!e.voice||e.voice.length>100||
   !Number.isInteger(e.rate)||e.rate<1||e.rate>1000||seen.has(audioKey(e)))throw Error('Invalid/duplicate audio entry');
  seen.add(audioKey(e));if(files)verifyFile(join(root,'files',e.file),e);
 }
 return data;
}
export function verifyFile(path,entry){
 const stat=lstatSync(path);
 if(!stat.isFile()||stat.size<44||stat.size>12*1024*1024)throw Error('Invalid audio file');
 const data=readFileSync(path);
 if(sha256(data)!==entry.sha256)throw Error('Audio checksum mismatch: '+entry.file);
 if(entry.file.endsWith('.wav')&&(data.toString('ascii',0,4)!=='RIFF'||data.toString('ascii',8,12)!=='WAVE'))throw Error('Invalid WAV');
 return data.length;
}
