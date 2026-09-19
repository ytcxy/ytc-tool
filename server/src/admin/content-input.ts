import { BadRequestException } from '@nestjs/common';
import { object, string } from '../common/input';
export const resources={collections:'el_collections',episodes:'el_episodes',sentences:'el_sentences'} as const;
export type Resource=keyof typeof resources;
export function resource(value:string):Resource {if(!Object.hasOwn(resources,value))throw new BadRequestException('未知内容类型');return value as Resource;}
export function integer(value:unknown,name:string,max=4294967295,min=1):number {if(typeof value!=='number'||!Number.isInteger(value)||value<min||value>max)throw new BadRequestException(name+'不正确');return value;}
export function optionalText(value:unknown,name:string,max:number) {if(typeof value!=='string'||value.length>max)throw new BadRequestException(name+'不正确');return value.trim();}
export function contentInput(kind:Resource,body:unknown) {
 const data=object(body);const fields:Record<string,string|number|null>={};
 if(kind==='sentences') {
  fields.zh=string(data.zh,'中文',4000);fields.en=string(data.en,'英文',8000);fields.context=optionalText(data.context??'','场景',500);
  fields.speaker=integer(data.speaker??0,'角色',1,0);fields.speaker_name=optionalText(data.speakerName??'','人物名',80);
 } else {
  fields.title=string(data.title,'标题',160);fields.status=integer(data.status??0,'发布状态',1,0);
  const url=data.sourceUrl||null;
  if(url!==null){let parsed:URL;try{parsed=new URL(string(url,'来源链接',512));}catch{throw new BadRequestException('来源链接不正确');}if(parsed.protocol!=='https:'||parsed.username||parsed.password)throw new BadRequestException('来源链接须为不含账号密码的 HTTPS 地址');}
  fields.source_url=url as string|null;
  if(kind==='collections')fields.description=string(data.description,'简介',2000);
 }
 fields[kind==='collections'?'sort_order':'sequence']=integer(data[kind==='collections'?'sortOrder':'sequence'],'排序');
 return fields;
}
export function expectedVersion(body:unknown) {const value=object(body).updatedAt;if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/.test(value))throw new BadRequestException('缺少有效的编辑版本，请刷新');return value;}
export const versionSelect=(alias:string)=>`DATE_FORMAT(${alias}.updated_at,'%Y-%m-%d %H:%i:%s.%f') AS versionRaw`;
export const present=(row:Record<string,any>):Record<string,any>=>{const {versionRaw,...rest}=row;return {...rest,updatedAt:versionRaw?.slice(0,23)};};
