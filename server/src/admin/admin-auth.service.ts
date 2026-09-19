import { BadRequestException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../database.service';
import { tokenHash } from '../auth/auth.service';
import { object } from '../common/input';
import { hashPassword, password, username, verifyPassword } from './password';
export interface AdminIdentity { id:string; tokenHash:string; username:string; mustChangePassword:boolean; csrf:string }
export interface AdminRequest { headers:Record<string,string|undefined>; method:string; path:string; ip?:string; admin:AdminIdentity }
export const cookieName='ytc_admin';
export const csrfFor=(token:string)=>createHash('sha256').update('admin-csrf:'+token).digest('hex');
export function checkOrigin(req:AdminRequest) {
 let origin:URL; try { origin=new URL(req.headers.origin||''); } catch { throw new ForbiddenException('请求来源无效'); }
 if(origin.host!==req.headers.host || !['http:','https:'].includes(origin.protocol) || (process.env.NODE_ENV==='production' && origin.protocol!=='https:')) throw new ForbiddenException('请求来源无效');
}
export function checkCsrf(req:AdminRequest) {
 checkOrigin(req); const supplied=req.headers['x-csrf-token'];
 if(!supplied || !/^[a-f0-9]{64}$/.test(supplied) || !timingSafeEqual(Buffer.from(supplied),Buffer.from(req.admin.csrf))) throw new ForbiddenException('页面已失效，请刷新后重试');
}
export async function assertAdmin(connection:PoolConnection,identity:AdminIdentity,allowPasswordChange=false) {
 const [rows]=await connection.execute<RowDataPacket[]>(`SELECT u.id,u.admin_must_change_password FROM el_users u JOIN el_sessions s ON s.user_id=u.id
 WHERE u.id=? AND u.is_del=0 AND u.is_admin=1 AND s.token_hash=? AND s.session_type='admin'
 AND s.is_del=0 AND s.revoked_at IS NULL AND s.expires_at>NOW(3) FOR UPDATE`,[identity.id,identity.tokenHash]);
 if(!rows.length)throw new UnauthorizedException('管理登录已失效');
 if(rows[0].admin_must_change_password && !allowPasswordChange)throw new ForbiddenException('请先修改初始密码');
}
export async function audit(connection:PoolConnection,actor:string,action:string,kind:string,target:string,before:unknown=null,after:unknown=null) {
 await connection.execute(`INSERT INTO el_admin_audit_logs(actor_id,action,target_type,target_id,details) VALUES(?,?,?,?,?)`,[actor,action,kind,target,JSON.stringify({before,after})]);
}
@Injectable()
export class AdminAuthService {
 constructor(private readonly db:DatabaseService){}
 async login(body:unknown) {
  const data=object(body),name=username(data.username),secret=password(data.password);
  const [users]=await this.db.pool.execute<RowDataPacket[]>('SELECT id,admin_password_hash FROM el_users WHERE admin_username=? AND is_admin=1 AND is_del=0',[name]);
  const user=users[0];
  if(!await verifyPassword(secret,user?.admin_password_hash??null))throw new UnauthorizedException('账号或密码错误');
  const connection=await this.db.pool.getConnection();
  try {
   await connection.beginTransaction();
   const [current]=await connection.execute<RowDataPacket[]>('SELECT id,admin_username,admin_must_change_password FROM el_users WHERE id=? AND is_admin=1 AND is_del=0 AND admin_password_hash=? FOR UPDATE',[user.id,user.admin_password_hash]);
   if(!current.length)throw new UnauthorizedException('账号或密码错误');
   const token=randomBytes(32).toString('hex');
   await connection.execute(`INSERT INTO el_sessions(user_id,token_hash,session_type,expires_at) VALUES(?,?,'admin',DATE_ADD(NOW(3),INTERVAL 8 HOUR))`,[user.id,tokenHash(token)]);
   await audit(connection,user.id,'login','user',user.id);
   await connection.commit(); return {token,user:{id:user.id,username:current[0].admin_username,mustChangePassword:!!current[0].admin_must_change_password,csrf:csrfFor(token)}};
  }catch(error){await connection.rollback();throw error;}finally{connection.release();}
 }
 async authenticate(cookie:unknown):Promise<AdminIdentity> {
  const token=typeof cookie==='string'?cookie.split(';').map(v=>v.trim()).find(v=>v.startsWith(cookieName+'='))?.slice(cookieName.length+1):undefined;
  if(!token || !/^[a-f0-9]{64}$/.test(token))throw new UnauthorizedException('请先登录管理端');
  const hash=tokenHash(token);
  const [rows]=await this.db.pool.execute<RowDataPacket[]>(`SELECT u.id,u.admin_username,u.admin_must_change_password FROM el_sessions s JOIN el_users u ON u.id=s.user_id
   WHERE s.token_hash=? AND s.session_type='admin' AND s.is_del=0 AND s.revoked_at IS NULL AND s.expires_at>NOW(3) AND u.is_del=0 AND u.is_admin=1`,[hash]);
  if(!rows.length)throw new UnauthorizedException('管理登录已过期或账号不可用');
  return {id:rows[0].id,username:rows[0].admin_username,mustChangePassword:!!rows[0].admin_must_change_password,tokenHash:hash,csrf:csrfFor(token)};
 }
 async logout(identity:AdminIdentity) {await this.db.pool.execute(`UPDATE el_sessions SET revoked_at=NOW(3) WHERE token_hash=? AND user_id=? AND session_type='admin'`,[identity.tokenHash,identity.id]);return {ok:true};}
 async changePassword(identity:AdminIdentity,body:unknown) {
  const data=object(body),old=password(data.oldPassword),next=password(data.password);
  if(old===next)throw new BadRequestException('新密码不能与原密码相同');
  const hash=await hashPassword(next),connection=await this.db.pool.getConnection();
  try {
   await connection.beginTransaction(); await assertAdmin(connection,identity,true);
   const [rows]=await connection.execute<RowDataPacket[]>('SELECT admin_password_hash FROM el_users WHERE id=? FOR UPDATE',[identity.id]);
   if(!await verifyPassword(old,rows[0].admin_password_hash))throw new BadRequestException('原密码错误');
   await connection.execute('UPDATE el_users SET admin_password_hash=?,admin_must_change_password=0 WHERE id=?',[hash,identity.id]);
   await connection.execute(`UPDATE el_sessions SET revoked_at=NOW(3) WHERE user_id=? AND session_type='admin' AND revoked_at IS NULL`,[identity.id]);
   await audit(connection,identity.id,'change-password','user',identity.id);
   await connection.commit();return {ok:true};
  }catch(error){await connection.rollback();throw error;}finally{connection.release();}
 }
}
