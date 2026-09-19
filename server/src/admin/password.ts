import { randomBytes, scrypt as derive, timingSafeEqual } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
export function password(value: unknown): string {
 if (typeof value !== 'string' || value.length < 6 || value.length > 128) throw new BadRequestException('密码须为 6–128 位');
 return value;
}
export function username(value: unknown): string {
 if(typeof value !== 'string' || !/^[a-z][a-z0-9_-]{2,39}$/.test(value)) throw new BadRequestException('账号须为 3–40 位小写字母、数字、下划线或短横线，以字母开头');
 return value;
}
const scrypt = (value:string,salt:string) => new Promise<Buffer>((resolve,reject)=>derive(value,salt,64,{N:16384,r:8,p:1},(error,key)=>error?reject(error):resolve(key)));
export async function hashPassword(value:string) { const salt=randomBytes(16).toString('hex'); return `scrypt$16384$8$1$${salt}$${(await scrypt(value,salt)).toString('hex')}`; }
export async function verifyPassword(value:string,stored:string|null) {
 const parts=(stored||'').split('$');
 const valid=parts.length===6 && parts.slice(0,4).join('$')==='scrypt$16384$8$1' && /^[a-f0-9]{32}$/.test(parts[4]) && /^[a-f0-9]{128}$/.test(parts[5]);
 const actual=await scrypt(value,valid?parts[4]:'0'.repeat(32));
 return valid && timingSafeEqual(actual,Buffer.from(parts[5],'hex'));
}
