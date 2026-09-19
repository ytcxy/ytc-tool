import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../database.service';
import { id, object } from '../common/input';
import { contentInput } from './content-input';
import { AdminIdentity, assertAdmin, audit } from './admin-auth.service';
import { collectionLock } from './admin-content.service';
const sourceKey=(value:unknown)=>{if(typeof value!=='string'||!/^[a-z0-9-]{1,80}$/.test(value))throw new BadRequestException('sourceKey 须为 1–80 位小写字母、数字或短横线');return value;};
export function episodeImport(body:unknown){
 const data=object(body),parentId=id(data.parentId),episode=object(data.episode);
 if(Buffer.byteLength(JSON.stringify(episode),'utf8')>1024*1024)throw new BadRequestException('单集 JSON 不能超过 1 MB');
 if('id' in episode||'collectionId' in episode||'collection_id' in episode)throw new BadRequestException('导入文件不能指定数据库 ID 或合集归属');
 if(episode.status!==undefined&&episode.status!==0)throw new BadRequestException('新增导入只保存草稿，请导入后再发布');
 const fields=contentInput('episodes',episode),key=sourceKey(episode.sourceKey);
 if(!Array.isArray(episode.sentences)||episode.sentences.length<1||episode.sentences.length>200)throw new BadRequestException('每集需要 1–200 条双语条目');
 const keys=new Set<string>(),orders=new Set<number>();
 const sentences=episode.sentences.map((value,index):Record<string,string|number|null>=>{
  const row=object(value);if('id' in row||'episodeId' in row||'episode_id' in row)throw new BadRequestException(`第 ${index+1} 条不能指定数据库 ID 或单集归属`);
  const sentenceKey=sourceKey(row.sourceKey),normalized=contentInput('sentences',row);
  if(keys.has(sentenceKey)||orders.has(normalized.sequence as number))throw new BadRequestException('条目的 sourceKey 和 sequence 不能重复');
  keys.add(sentenceKey);orders.add(normalized.sequence as number);return {...normalized,source_key:sentenceKey};
 });
 const normalized={parentId,sourceKey:key,fields,sentences};
 const previewHash=createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
 return {...normalized,previewHash};
}
@Injectable()
export class AdminImportService {
 constructor(private readonly db:DatabaseService){}
 async run(identity:AdminIdentity,body:unknown,apply=false){
  const input=episodeImport(body),data=object(body);
  if(apply&&data.previewHash!==input.previewHash)throw new ConflictException('导入内容发生变化，请重新预览');
  const connection=await this.db.pool.getConnection();let lock:string|undefined,begun=false;
  try{
   const [parents]=await connection.execute<RowDataPacket[]>('SELECT id,title,source_key,is_del FROM el_collections WHERE id=?',[input.parentId]);
   if(!parents.length)throw new NotFoundException('合集不存在');
   lock=collectionLock(parents[0].source_key);const [locks]=await connection.execute<RowDataPacket[]>('SELECT GET_LOCK(?,0) AS acquired',[lock]);
   if(Number(locks[0]?.acquired)!==1){lock=undefined;throw new ConflictException('合集正在导入或编辑，请稍后重试');}
   await connection.beginTransaction();begun=true;await assertAdmin(connection,identity);
   const [current]=await connection.execute<RowDataPacket[]>('SELECT id,title,is_del FROM el_collections WHERE id=? FOR UPDATE',[input.parentId]);
   if(current[0]?.is_del!==0)throw new ConflictException('合集已删除，不能导入');
   const [existing]=await connection.execute<RowDataPacket[]>('SELECT id,is_del FROM el_episodes WHERE collection_id=? AND source_key=? FOR UPDATE',[input.parentId,input.sourceKey]);
   if(existing.length)throw new ConflictException(existing[0].is_del?'相同 sourceKey 的单集已删除，不能恢复':'该 sourceKey 已存在，不能重复新增或覆盖');
   const [order]=await connection.execute<RowDataPacket[]>('SELECT id FROM el_episodes WHERE collection_id=? AND sequence=? AND is_del=0 LIMIT 1',[input.parentId,input.fields.sequence]);
   if(order.length)throw new ConflictException('单集顺序已被占用，请修改 JSON 中的 sequence 后重新预览');
   const preview={previewHash:input.previewHash,collectionTitle:current[0].title,sourceKey:input.sourceKey,title:input.fields.title,sequence:input.fields.sequence,status:0,sentenceCount:input.sentences.length,sentences:input.sentences.map(s=>({sequence:s.sequence,zh:s.zh,en:s.en,speaker:s.speaker,speakerName:s.speaker_name,context:s.context}))};
   if(!apply){await connection.commit();return preview;}
   const fields={...input.fields,collection_id:input.parentId,source_key:input.sourceKey};
   await connection.execute(`INSERT INTO el_episodes(${Object.keys(fields).join(',')}) VALUES(${Object.keys(fields).map(()=>'?').join(',')})`,Object.values(fields));
   const [ids]=await connection.execute<RowDataPacket[]>('SELECT id FROM el_episodes WHERE collection_id=? AND source_key=?',[input.parentId,input.sourceKey]);
   const episodeId=id(ids[0]?.id);
   for(const row of input.sentences){const values={...row,episode_id:episodeId};await connection.execute(`INSERT INTO el_sentences(${Object.keys(values).join(',')}) VALUES(${Object.keys(values).map(()=>'?').join(',')})`,Object.values(values));}
   await audit(connection,identity.id,'import-episode','episodes',episodeId,null,{...preview,previewHash:undefined});
   await connection.commit();return {id:episodeId,title:input.fields.title,sentenceCount:input.sentences.length,status:0};
  }catch(error){if(begun)await connection.rollback();if((error as {code?:string}).code==='ER_DUP_ENTRY')throw new ConflictException('导入标识冲突，请重新预览');throw error;}
  finally{try{if(lock)await connection.execute('SELECT RELEASE_LOCK(?)',[lock]);}finally{connection.release();}}
 }
}
