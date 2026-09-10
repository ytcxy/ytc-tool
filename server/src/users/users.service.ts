import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { mkdir,writeFile,unlink,readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../database.service';
import { object,string } from '../common/input';
import { imageType } from './avatar';
@Injectable()
export class UsersService {
 private readonly uploadDir:string;
 constructor(private readonly db:DatabaseService,config:ConfigService){this.uploadDir=resolve(config.get<string>('UPLOAD_DIR')||resolve(__dirname,'../../uploads'));}
 async me(userId:string){
  const [rows]=await this.db.pool.execute<RowDataPacket[]>('SELECT id,nickname,avatar_key AS avatarKey FROM el_users WHERE id=? AND is_del=0',[userId]);
  if(!rows.length)throw new NotFoundException('用户不存在');
  const user=rows[0];return {id:user.id,nickname:user.nickname,avatarPath:user.avatarKey?`/avatars/${user.avatarKey}`:null};
 }
 async update(userId:string,body:unknown){
  const nickname=string(object(body).nickname,'昵称',32);
  if(/[\x00-\x1f\x7f]/.test(nickname))throw new BadRequestException('昵称格式不正确');
  await this.db.pool.execute('UPDATE el_users SET nickname=? WHERE id=? AND is_del=0',[nickname,userId]);return this.me(userId);
 }
 async avatar(userId:string,buffer:Buffer){
  const type=imageType(buffer);const key=`${randomUUID()}.${type.extension}`;
  const connection=await this.db.pool.getConnection();let old:string|undefined;let written=false;
  try{
   await mkdir(this.uploadDir,{recursive:true});await writeFile(resolve(this.uploadDir,key),buffer,{flag:'wx',mode:0o600});written=true;
   await connection.beginTransaction();
   const [rows]=await connection.execute<RowDataPacket[]>('SELECT avatar_key FROM el_users WHERE id=? AND is_del=0 FOR UPDATE',[userId]);
   if(!rows.length)throw new NotFoundException('用户不存在');old=rows[0].avatar_key;
   await connection.execute('UPDATE el_users SET avatar_key=? WHERE id=? AND is_del=0',[key,userId]);await connection.commit();
  }catch(e){await connection.rollback();if(written)await unlink(resolve(this.uploadDir,key)).catch(()=>{});throw e;}finally{connection.release();}
  if(old&&/^[a-f0-9-]{36}\.(png|jpg|webp)$/.test(old))await unlink(resolve(this.uploadDir,old)).catch(()=>{});
  return this.me(userId);
 }
 async avatarFile(key:string){
  if(!/^[a-f0-9-]{36}\.(png|jpg|webp)$/.test(key))throw new NotFoundException('头像不存在');
  const [owners] = await this.db.pool.execute<RowDataPacket[]>(
   'SELECT id FROM el_users WHERE avatar_key=? AND is_del=0 LIMIT 1', [key]);
  if (!owners.length) throw new NotFoundException('头像不存在');
  try {const buffer=await readFile(resolve(this.uploadDir,key));return {buffer,...imageType(buffer)};}catch{throw new NotFoundException('头像不存在');}
 }
}
