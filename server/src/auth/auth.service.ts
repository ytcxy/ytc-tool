import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../database.service';
import { WechatService } from './wechat.service';
export const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
export interface Identity { id: string; tokenHash: string }
@Injectable()
export class AuthService {
 constructor(private readonly db: DatabaseService, private readonly wechat: WechatService) {}
 async login(code: string) {
  const identity = await this.wechat.exchange(code);
  const connection = await this.db.pool.getConnection();
  try {
   await connection.beginTransaction();
   // Duplicate identity retains its numeric ID; a deleted user must never be recreated.
   await connection.execute(`INSERT INTO el_users(appid,openid) VALUES(?,?)
     ON DUPLICATE KEY UPDATE id=id`, [identity.appid, identity.openid]);
   const [rows] = await connection.execute<RowDataPacket[]>(
    'SELECT id,is_del FROM el_users WHERE appid=? AND openid=? FOR UPDATE', [identity.appid, identity.openid]);
   if (rows[0].is_del !== 0) throw new ForbiddenException('账号已停用，请联系管理员');
   const userId = rows[0].id;
   await connection.execute('UPDATE el_users SET last_login_at=UTC_TIMESTAMP(3) WHERE id=? AND is_del=0', [userId]);
   const token = randomBytes(32).toString('hex');
   await connection.execute(`INSERT INTO el_sessions(token_hash,user_id,expires_at)
     VALUES(?,?,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 30 DAY))`, [tokenHash(token), userId]);
   await connection.commit();
   return { token, expiresIn: 30 * 86400 };
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
 }
 async authenticate(header: unknown): Promise<Identity> {
  if (typeof header !== 'string' || !/^Bearer [a-f0-9]{64}$/.test(header)) throw new UnauthorizedException('请先登录');
  const hash = tokenHash(header.slice(7));
  const [rows] = await this.db.pool.execute<RowDataPacket[]>(`SELECT s.user_id
    FROM el_sessions s JOIN el_users u ON u.id=s.user_id
    WHERE s.token_hash=? AND s.is_del=0 AND u.is_del=0
      AND s.revoked_at IS NULL AND s.expires_at>UTC_TIMESTAMP(3)`, [hash]);
  if (!rows.length) throw new UnauthorizedException('登录已过期或账号不可用，请重新登录');
  return { id: rows[0].user_id, tokenHash: hash };
 }
 async logout(identity: Identity) {
  await this.db.pool.execute(`UPDATE el_sessions SET revoked_at=UTC_TIMESTAMP(3)
    WHERE token_hash=? AND user_id=? AND is_del=0`, [identity.tokenHash, identity.id]);
  return { ok: true };
 }
}
