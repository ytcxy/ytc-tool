import { BadRequestException } from '@nestjs/common';
export function object(value: unknown): Record<string, unknown> {
 if(!value || typeof value!=='object' || Array.isArray(value)) throw new BadRequestException('请求内容格式错误');
 return value as Record<string,unknown>;
}
export function string(value: unknown, name: string, max=80): string {
 if(typeof value!=='string' || !value.trim() || value.length>max) throw new BadRequestException(`${name}格式不正确`);
 return value.trim();
}
// Keep unsigned BIGINT IDs as decimal strings, including values above 2^53.
export function id(value: unknown): string {
 if (typeof value !== 'string' || !/^[1-9]\d{0,19}$/.test(value)
     || BigInt(value) > 18446744073709551615n) {
  throw new BadRequestException('标识必须为有效的正整数字符串');
 }
 return value;
}
export function pagination(page: unknown, limit: unknown) {
 const number=(v:unknown,d:number,max:number)=>{
  if(v===undefined)return d;
  if(typeof v!=='string'||!/^\d+$/.test(v)||Number(v)<1||Number(v)>max) throw new BadRequestException('分页参数不正确');
  return Number(v);
 };
 const p=number(page,1,10000),size=number(limit,20,100);
 return {page:p,limit:size,offset:(p-1)*size};
}
export function learningStatus(value:unknown): 'unseen'|'learning'|'mastered' {
 if(value!=='unseen'&&value!=='learning'&&value!=='mastered') throw new BadRequestException('掌握状态不正确');
 return value;
}
