import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../database.service';
import { id, object, pagination, string } from '../common/input';
import { AdminIdentity, assertAdmin, audit } from './admin-auth.service';
import { expectedVersion, present, versionSelect } from './content-input';
import { hashPassword, password, username } from './password';
const userFields='t.id,t.nickname,t.admin_username AS adminUsername,t.is_admin AS isAdmin,t.admin_must_change_password AS mustChangePassword,t.is_del AS isDel,t.last_login_at AS lastLoginAt';
@Injectable()
export class AdminUsersService {
 constructor(private readonly db:DatabaseService){}
 async list(query:Record<string,unknown>) {
  const p=pagination(query.page,query.limit),where=['1=1'],values:(string|number|null)[]=[];
  if(query.q){const q=string(query.q,'关键词',100);where.push('(t.nickname LIKE ? OR t.admin_username LIKE ? OR CAST(t.id AS CHAR)=?)');values.push('%'+q+'%','%'+q+'%',q);}
  if(query.admin!==undefined){if(query.admin!=='1')throw new BadRequestException('管理员筛选不正确');where.push('t.is_admin=1');}
  const from='FROM el_users t WHERE '+where.join(' AND ');
  const [items]=await this.db.pool.query<RowDataPacket[]>(`SELECT ${userFields},${versionSelect('t')} ${from} ORDER BY t.id LIMIT ? OFFSET ?`,[...values,p.limit,p.offset]);
  const [counts]=await this.db.pool.execute<RowDataPacket[]>(`SELECT COUNT(*) AS total ${from}`,values);
  return {items:items.map(present),total:Number(counts[0].total)};
 }
 async update(identity:AdminIdentity,target:string,body:unknown) {
  const data=object(body),version=expectedVersion(data),action=data.action;
  if(!['grant','revoke','reset-password','disable'].includes(String(action)))throw new BadRequestException('未知用户操作');
  if(target===identity.id && (action==='disable'||action==='revoke'))throw new ConflictException('不能停用自己或取消自己的管理权限');
  const name=action==='grant'?username(data.username):null;
  const hash=action==='grant'||action==='reset-password'?await hashPassword(password(data.password)):null;
  const connection=await this.db.pool.getConnection();let locked=false;
  try {
   const [locks]=await connection.execute<RowDataPacket[]>("SELECT GET_LOCK('learning-admin-users',0) AS acquired");locked=Number(locks[0]?.acquired)===1;
   if(!locked)throw new ConflictException('正在修改管理员，请稍后重试');
   await connection.beginTransaction();await assertAdmin(connection,identity);
   const [rows]=await connection.execute<RowDataPacket[]>(`SELECT ${userFields},${versionSelect('t')} FROM el_users t WHERE t.id=? FOR UPDATE`,[target]);
   if(!rows.length)throw new NotFoundException('用户不存在');const before=present(rows[0]);
   if(before.isDel)throw new ConflictException('用户已停用，不支持自动恢复');
   if(before.updatedAt!==version)throw new ConflictException('用户资料已变化，请刷新后重试');
   const [admins]=await connection.execute<RowDataPacket[]>('SELECT id FROM el_users WHERE is_admin=1 AND is_del=0 AND admin_username IS NOT NULL AND admin_password_hash IS NOT NULL ORDER BY id FOR UPDATE');
   if(before.isAdmin && ['revoke','disable'].includes(String(action)) && !admins.some(u=>u.id!==target))throw new ConflictException('不能停用或取消最后一个管理员');
   if(action==='grant'&&before.isAdmin)throw new ConflictException('该用户已经是管理员');
   if(action==='reset-password'&&!before.isAdmin)throw new ConflictException('该用户不是管理员');
   const increment='updated_at=GREATEST(NOW(3),DATE_ADD(updated_at,INTERVAL 1000 MICROSECOND))';
   if(action==='grant')await connection.execute(`UPDATE el_users SET admin_username=?,admin_password_hash=?,is_admin=1,admin_must_change_password=1,${increment} WHERE id=?`,[name,hash,target]);
   if(action==='reset-password')await connection.execute(`UPDATE el_users SET admin_password_hash=?,admin_must_change_password=1,${increment} WHERE id=?`,[hash,target]);
   if(action==='revoke')await connection.execute(`UPDATE el_users SET is_admin=0,admin_password_hash=NULL,admin_must_change_password=0,${increment} WHERE id=?`,[target]);
   if(action==='disable')await connection.execute(`UPDATE el_users SET is_del=1,${increment} WHERE id=?`,[target]);
   await connection.execute(`UPDATE el_sessions SET revoked_at=NOW(3) WHERE user_id=? AND revoked_at IS NULL${action==='disable'?'':" AND session_type='admin'"}`,[target]);
   await audit(connection,identity.id,String(action),'user',target,{isAdmin:before.isAdmin,adminUsername:before.adminUsername,isDel:before.isDel},{action,username:name});
   await connection.commit();return {ok:true};
  }catch(error){await connection.rollback();if((error as {code?:string}).code==='ER_DUP_ENTRY')throw new ConflictException('管理账号已被占用');throw error;}
  finally{try{if(locked)await connection.execute("SELECT RELEASE_LOCK('learning-admin-users')");}finally{connection.release();}}
 }
 async progress(query:Record<string,unknown>) {
  const p=pagination(query.page,query.limit),kind=query.kind??'sentences';if(!['sentences','episodes'].includes(String(kind)))throw new BadRequestException('进度类型不正确');
  const where=['p.is_del=0','u.is_del=0','e.is_del=0','e.status=1','c.is_del=0','c.status=1'],values:(string|number|null)[]=[];
  if(query.userId){where.push('u.id=?');values.push(id(query.userId));}if(query.collectionId){where.push('c.id=?');values.push(id(query.collectionId));}if(query.episodeId){where.push('e.id=?');values.push(id(query.episodeId));}
  const sentences=kind==='sentences';if(sentences)where.push('s.is_del=0');
  const from=`FROM ${sentences?'el_sentence_progress':'el_episode_progress'} p JOIN el_users u ON u.id=p.user_id ${sentences?'JOIN el_sentences s ON s.id=p.sentence_id JOIN el_episodes e ON e.id=s.episode_id':'JOIN el_episodes e ON e.id=p.episode_id'} JOIN el_collections c ON c.id=e.collection_id WHERE ${where.join(' AND ')}`;
  const fields=sentences?"s.zh,s.en,CASE p.status WHEN 0 THEN 'unseen' WHEN 1 THEN 'learning' WHEN 2 THEN 'mastered' END AS status,p.last_reviewed_at AS activityAt":'p.completed_at AS completedAt,p.last_studied_at AS activityAt';
  const [items]=await this.db.pool.query<RowDataPacket[]>(`SELECT p.id,u.id AS userId,u.nickname,c.title AS collectionTitle,e.title AS episodeTitle,${fields} ${from} ORDER BY activityAt DESC,p.id DESC LIMIT ? OFFSET ?`,[...values,p.limit,p.offset]);
  const [counts]=await this.db.pool.execute<RowDataPacket[]>(`SELECT COUNT(*) AS total ${from}`,values);return {items,total:Number(counts[0].total)};
 }
 async logs(query:Record<string,unknown>) {
  const p=pagination(query.page,query.limit),where=['a.is_del=0'],values:(string|number|null)[]=[];
  if(query.actorId){where.push('a.actor_id=?');values.push(id(query.actorId));}
  if(query.targetId){where.push('a.target_id=?');values.push(id(query.targetId));}
  const from=`FROM el_admin_audit_logs a JOIN el_users u ON u.id=a.actor_id WHERE ${where.join(' AND ')}`;
  const [items]=await this.db.pool.query<RowDataPacket[]>(`SELECT a.id,a.actor_id AS actorId,u.nickname,a.action,a.target_type AS targetType,a.target_id AS targetId,a.details,a.created_at AS createdAt ${from} ORDER BY a.id DESC LIMIT ? OFFSET ?`,[...values,p.limit,p.offset]);
  const [counts]=await this.db.pool.execute<RowDataPacket[]>(`SELECT COUNT(*) AS total ${from}`,values);return {items,total:Number(counts[0].total)};
 }
}
