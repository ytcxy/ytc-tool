import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../database.service';
import { id, object, pagination, string } from '../common/input';
import { AdminIdentity, assertAdmin, audit } from './admin-auth.service';
import { contentInput, expectedVersion, present, Resource, resources, versionSelect } from './content-input';

const selects:Record<Resource,string>={
 collections:'t.id,t.source_key AS sourceKey,t.title,t.description,t.source_url AS sourceUrl,t.sort_order AS sortOrder,t.status,t.is_del AS isDel',
 episodes:'t.id,t.collection_id AS collectionId,t.source_key AS sourceKey,t.title,t.sequence,t.source_url AS sourceUrl,t.status,t.is_del AS isDel',
 sentences:'t.id,t.episode_id AS episodeId,t.source_key AS sourceKey,t.sequence,t.zh,t.en,t.context,t.speaker,t.speaker_name AS speakerName,t.is_del AS isDel',
};
export const collectionLock=(key:string)=>'learning-import:'+createHash('sha256').update(key).digest('hex').slice(0,40);
@Injectable()
export class AdminContentService {
 constructor(private readonly db:DatabaseService){}
 async list(kind:Resource,query:Record<string,unknown>) {
  const p=pagination(query.page,query.limit),where:string[]=[],values:(string|number|null)[]=[];
  if(query.deleted!==undefined&&!['0','1','all'].includes(String(query.deleted)))throw new BadRequestException('删除筛选不正确');
  if(query.deleted!=='all'){where.push('t.is_del=?');values.push(query.deleted==='1'?1:0);}
  if(query.q){where.push(`t.${kind==='sentences'?'zh':'title'} LIKE ?`);values.push('%'+string(query.q,'关键词',100)+'%');}
  if(query.status!==undefined&&query.status!==''){if(kind==='sentences'||!['0','1'].includes(String(query.status)))throw new BadRequestException('发布状态不正确');where.push('t.status=?');values.push(Number(query.status));}
  if(kind!=='collections'){
   where.push(`t.${kind==='episodes'?'collection_id':'episode_id'}=?`);values.push(id(query.parentId));
  }
  const from=`FROM ${resources[kind]} t WHERE ${where.join(' AND ')||'1=1'}`;
  const [items]=await this.db.pool.query<RowDataPacket[]>(`SELECT ${selects[kind]},${versionSelect('t')} ${from} ORDER BY t.${kind==='collections'?'sort_order':'sequence'},t.id LIMIT ? OFFSET ?`,[...values,p.limit,p.offset]);
  const [counts]=await this.db.pool.execute<RowDataPacket[]>(`SELECT COUNT(*) AS total ${from}`,values);
  return {items:items.map(present),total:Number(counts[0].total),page:p.page};
 }
 private async collection(connection:PoolConnection,kind:Resource,target:string,parent:boolean) {
  const sql=kind==='collections'||(kind==='episodes'&&parent)?'SELECT c.id,c.source_key FROM el_collections c WHERE c.id=?':
   kind==='episodes'||(kind==='sentences'&&parent)?'SELECT c.id,c.source_key FROM el_episodes e JOIN el_collections c ON c.id=e.collection_id WHERE e.id=?':
   'SELECT c.id,c.source_key FROM el_sentences s JOIN el_episodes e ON e.id=s.episode_id JOIN el_collections c ON c.id=e.collection_id WHERE s.id=?';
  const [rows]=await connection.execute<RowDataPacket[]>(sql,[target]);if(!rows.length)throw new NotFoundException('内容不存在');return rows[0];
 }
 async mutate(identity:AdminIdentity,kind:Resource,target:string|null,body:unknown,remove=false) {
  const data=object(body),fields=remove?{}:contentInput(kind,data),version=target?expectedVersion(data):null;
  const parent=target?null:kind==='collections'?null:id(data.parentId);
  const connection=await this.db.pool.getConnection();let lock:string|undefined;
  try {
   const collection=target||parent?await this.collection(connection,kind,(target||parent)!,!target):null;
   const sourceKey='web-'+randomUUID();lock=collectionLock(collection?.source_key||sourceKey);
   const [locked]=await connection.execute<RowDataPacket[]>('SELECT GET_LOCK(?,0) AS acquired',[lock]);
   if(Number(locked[0]?.acquired)!==1){lock=undefined;throw new ConflictException('该合集正在导入或编辑，请稍后重试');}
   await connection.beginTransaction();await assertAdmin(connection,identity);
   if(collection){const [parents]=await connection.execute<RowDataPacket[]>('SELECT is_del FROM el_collections WHERE id=? FOR UPDATE',[collection.id]);if(parents[0]?.is_del!==0)throw new ConflictException('合集已删除');}
   let before:Record<string,any>|null=null;
   if(target){const [rows]=await connection.execute<RowDataPacket[]>(`SELECT ${selects[kind]},${versionSelect('t')} FROM ${resources[kind]} t WHERE t.id=? FOR UPDATE`,[target]);
    if(!rows.length)throw new NotFoundException('内容不存在');before=present(rows[0]);
    if(before.isDel!==0)throw new ConflictException('内容已删除，不能编辑或恢复');
    if(before.updatedAt!==version)throw new ConflictException('内容已被修改，请刷新后重新编辑');
   }
   if(kind==='sentences'){
    const episodeId=parent||before!.episodeId;
    const [episodes]=await connection.execute<RowDataPacket[]>('SELECT is_del FROM el_episodes WHERE id=? FOR UPDATE',[episodeId]);
    if(episodes[0]?.is_del!==0)throw new ConflictException('单集已删除');
    if(!target){const [counts]=await connection.execute<RowDataPacket[]>('SELECT COUNT(*) AS total FROM el_sentences WHERE episode_id=? AND is_del=0',[episodeId]);if(Number(counts[0].total)>=200)throw new ConflictException('每集最多 200 条，请拆分单集');}
   }
   if(!remove&&kind!=='collections') {
    const parentColumn=kind==='episodes'?'collection_id':'episode_id',parentId=parent||before![kind==='episodes'?'collectionId':'episodeId'];
    const [duplicates]=await connection.execute<RowDataPacket[]>(`SELECT id FROM ${resources[kind]} WHERE ${parentColumn}=? AND sequence=? AND is_del=0${target?' AND id<>?':''} LIMIT 1`,[parentId,fields.sequence,...(target?[target]:[])]);
    if(duplicates.length)throw new ConflictException('该顺序已被占用，请选择其他序号');
   }
   if(target) {
    const changes=remove?{is_del:1}:fields;
    await connection.execute(`UPDATE ${resources[kind]} SET ${Object.keys(changes).map(k=>k+'=?').join(',')},updated_at=GREATEST(NOW(3),DATE_ADD(updated_at,INTERVAL 1000 MICROSECOND)) WHERE id=?`,[...Object.values(changes),target]);
   }else{
    const values:Record<string,string|number|null>={...fields,source_key:sourceKey,...(parent?{[kind==='episodes'?'collection_id':'episode_id']:parent}:{})};
    await connection.execute(`INSERT INTO ${resources[kind]}(${Object.keys(values).join(',')}) VALUES(${Object.keys(values).map(()=>'?').join(',')})`,Object.values(values));
    const [ids]=await connection.execute<RowDataPacket[]>(`SELECT id FROM ${resources[kind]} WHERE source_key=?${parent?` AND ${kind==='episodes'?'collection_id':'episode_id'}=?`:''}`,[sourceKey,...(parent?[parent]:[])]);target=ids[0].id;
   }
   const [after]=await connection.execute<RowDataPacket[]>(`SELECT ${selects[kind]},${versionSelect('t')} FROM ${resources[kind]} t WHERE t.id=?`,[target]);
   await audit(connection,identity.id,remove?'delete':before?'update':'create',kind,target!,before,present(after[0]));
   await connection.commit();return present(after[0]);
  }catch(error){await connection.rollback();throw error;}finally{try{if(lock)await connection.execute('SELECT RELEASE_LOCK(?)',[lock]);}finally{connection.release();}}
 }
 async batchPublish(identity:AdminIdentity,kind:Resource,body:unknown) {
  if(kind==='sentences')throw new BadRequestException('条目随单集发布，请选择合集或单集');
  const data=object(body);
  if(!Array.isArray(data.items)||data.items.length<1||data.items.length>100)throw new BadRequestException('每批请选择 1–100 条记录');
  const items=data.items.map(value=>{const item=object(value);return {id:id(item.id),updatedAt:expectedVersion(item)};});
  if(new Set(items.map(item=>item.id)).size!==items.length)throw new BadRequestException('不能重复选择同一记录');
  const parentId=kind==='episodes'?id(data.parentId):null;
  items.sort((a,b)=>BigInt(a.id)<BigInt(b.id)?-1:1);
  const connection=await this.db.pool.getConnection(),locks:string[]=[];let begun=false;
  try {
   const collections=new Map<string,string>();
   for(const item of items){const collection=await this.collection(connection,kind,item.id,false);collections.set(collection.id,collection.source_key);if(parentId&&collection.id!==parentId)throw new BadRequestException('单集不属于当前合集');}
   for(const [,key] of [...collections].sort(([a],[b])=>BigInt(a)<BigInt(b)?-1:1)){
    const lock=collectionLock(key),[result]=await connection.execute<RowDataPacket[]>('SELECT GET_LOCK(?,0) AS acquired',[lock]);
    if(Number(result[0]?.acquired)!==1)throw new ConflictException('所选合集正在导入或编辑，请稍后重试');locks.push(lock);
   }
   await connection.beginTransaction();begun=true;await assertAdmin(connection,identity);
   for(const collectionId of collections.keys()){
    const [parents]=await connection.execute<RowDataPacket[]>('SELECT is_del FROM el_collections WHERE id=? FOR UPDATE',[collectionId]);
    if(parents[0]?.is_del!==0)throw new ConflictException('所选内容的合集已删除，请刷新列表');
   }
   const before:Record<string,any>[]=[];
   for(const item of items){
    const [rows]=await connection.execute<RowDataPacket[]>(`SELECT ${selects[kind]},${versionSelect('t')} FROM ${resources[kind]} t WHERE t.id=? FOR UPDATE`,[item.id]);
    if(!rows.length)throw new NotFoundException('所选内容不存在');const row=present(rows[0]);
    if(row.isDel!==0)throw new ConflictException('所选内容已删除，请刷新列表');
    if(parentId&&row.collectionId!==parentId)throw new ConflictException('单集所属合集已变化，请刷新列表');
    if(row.updatedAt!==item.updatedAt)throw new ConflictException('所选内容已被修改，本批未发布，请刷新后重试');
    before.push(row);
   }
   let published=0;
   for(const row of before){
    if(row.status===1)continue;
    await connection.execute(`UPDATE ${resources[kind]} SET status=1,updated_at=GREATEST(NOW(3),DATE_ADD(updated_at,INTERVAL 1000 MICROSECOND)) WHERE id=?`,[row.id]);
    await audit(connection,identity.id,'batch-publish',kind,row.id,{status:row.status},{status:1});published++;
   }
   await connection.commit();return {published,skipped:items.length-published};
  }catch(error){if(begun)await connection.rollback();throw error;}
  finally{try{for(const lock of locks.reverse())await connection.execute('SELECT RELEASE_LOCK(?)',[lock]);}finally{connection.release();}}
 }
 async impact(kind:Resource,target:string) {
  // Counts are informational. The write always rechecks existence and edit version.
  if(kind==='collections'){
   const [rows]=await this.db.pool.execute<RowDataPacket[]>(`SELECT (SELECT COUNT(*) FROM el_episodes WHERE collection_id=? AND is_del=0) AS episodes,
    (SELECT COUNT(*) FROM el_sentences s JOIN el_episodes e ON e.id=s.episode_id WHERE e.collection_id=? AND e.is_del=0 AND s.is_del=0) AS sentences`,[target,target]);return rows[0];
  }
  if(kind==='episodes'){const [rows]=await this.db.pool.execute<RowDataPacket[]>('SELECT COUNT(*) AS sentences FROM el_sentences WHERE episode_id=? AND is_del=0',[target]);return rows[0];}
  return {sentences:1};
 }
 async export(collectionId:string) {
  const connection=await this.db.pool.getConnection();
  try {
   await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');await connection.beginTransaction();
   const [collections]=await connection.execute<RowDataPacket[]>(`SELECT source_key AS sourceKey,title,description,source_url AS sourceUrl,sort_order AS sortOrder,status FROM el_collections WHERE id=? AND is_del=0`,[collectionId]);
   if(!collections.length)throw new NotFoundException('合集不存在或已删除');
   const [episodes]=await connection.execute<RowDataPacket[]>('SELECT id,source_key AS sourceKey,title,sequence,source_url AS sourceUrl,status FROM el_episodes WHERE collection_id=? AND is_del=0 ORDER BY sequence,id',[collectionId]);
   const [sentences]=await connection.execute<RowDataPacket[]>(`SELECT s.episode_id AS episodeId,s.source_key AS sourceKey,s.sequence,s.zh,s.en,s.context,s.speaker,s.speaker_name AS speakerName FROM el_sentences s JOIN el_episodes e ON e.id=s.episode_id WHERE e.collection_id=? AND e.is_del=0 AND s.is_del=0 ORDER BY s.sequence,s.id`,[collectionId]);
   if(!episodes.length||episodes.some(e=>!sentences.some(s=>s.episodeId===e.id)))throw new ConflictException('合集和每个单集至少需要一条内容才能导出导入清单');
   const grouped=new Map<string,Record<string,unknown>[]>();for(const row of sentences){const {episodeId,...item}=row;const group=grouped.get(episodeId)||[];group.push(item);grouped.set(episodeId,group);}
   const result={...collections[0],episodes:episodes.map(({id,...e})=>({...e,sentences:grouped.get(id)||[]}))};
   await connection.commit();return result;
  }catch(error){await connection.rollback();throw error;}finally{connection.release();}
 }
}
