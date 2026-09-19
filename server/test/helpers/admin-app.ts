import {AdminImportService} from '../../src/admin/admin-import.service';
import 'reflect-metadata';
import {Module} from '@nestjs/common';
import {NestFactory} from '@nestjs/core';
import {NestExpressApplication} from '@nestjs/platform-express';
import {AdminAuthService} from '../../src/admin/admin-auth.service';
import {AdminAuthController} from '../../src/admin/admin-auth.controller';
import {AdminController} from '../../src/admin/admin.controller';
import {AdminGuard} from '../../src/admin/admin.guard';
import {AdminContentService} from '../../src/admin/admin-content.service';
import {AdminUsersService} from '../../src/admin/admin-users.service';
import {hashPassword} from '../../src/admin/password';
import {DatabaseService} from '../../src/database.service';
import {configureHttp} from '../../src/http';
// In-memory test fixture only. Never imports config or opens a MySQL connection.
export async function adminTestApp(port=0){
 const user={id:'9007199254740993',admin_username:'admin',admin_must_change_password:0,admin_password_hash:await hashPassword('test-only-password')};
 const calls:{sql:string;args:any[]}[]=[],sessions=new Set<string>();
 const collection={id:'100',sourceKey:'fixture-collection',title:'日常生活英语',description:'从真实场景开始，让表达成为习惯。',sortOrder:1,status:0,isDel:0,versionRaw:'2026-09-19 08:00:00.000000'};
 const episode={id:'101',collectionId:'100',sourceKey:'fixture-episode',title:'在咖啡馆点单',sequence:1,status:0,isDel:0,versionRaw:'2026-09-19 08:00:00.000000'};
 const sentence={id:'102',episodeId:'101',sourceKey:'fixture-sentence',sequence:1,zh:'我想要一杯拿铁，谢谢。',en:'I would like a latte, please.',speaker:0,speakerName:'',context:'咖啡馆点单',isDel:0,versionRaw:'2026-09-19 08:00:00.000000'};
 const imported:Record<string,any>[]=[];
 const execute=async(sql:string,args:any[]=[])=>{
  calls.push({sql,args});let rows:any=[];
  if(sql.includes('GET_LOCK'))rows=[{acquired:1}];
  else if(sql.startsWith('SELECT id,admin_password_hash'))rows=args[0]==='admin'?[user]:[];
  else if(sql.startsWith('SELECT id,admin_username'))rows=[user];
  else if(sql.startsWith('INSERT INTO el_sessions')){sessions.add(args[1]);rows={};}
  else if(sql.includes('FROM el_sessions s JOIN el_users'))rows=sessions.has(args[0])?[user]:[];
  else if(sql.startsWith('UPDATE el_sessions')){sessions.clear();rows={};}
  else if(sql.startsWith('SELECT u.id'))rows=sessions.has(args[1])?[user]:[];
  else if(sql.startsWith('SELECT c.id,c.source_key'))rows=[{id:'100',source_key:collection.sourceKey}];
  else if(sql.startsWith('SELECT id,title'))rows=[{id:collection.id,title:collection.title,source_key:collection.sourceKey,is_del:0}];
  else if(sql.startsWith('SELECT id,is_del FROM el_episodes'))rows=imported.filter(e=>e.sourceKey===args[1]).map(e=>({id:e.id,is_del:0}));
  else if(sql.startsWith('SELECT id FROM el_episodes')&&sql.includes('sequence=?'))rows=args[1]===1?[{id:episode.id}]:imported.filter(e=>e.sequence===args[1]);
  else if(sql.startsWith('SELECT id FROM el_episodes'))rows=imported.filter(e=>e.sourceKey===args[1]).map(e=>({id:e.id}));
  else if(sql.startsWith('INSERT INTO el_episodes(')){
   const keys=sql.slice(sql.indexOf('(')+1,sql.indexOf(')')).split(',');const fields=Object.fromEntries(keys.map((key,index)=>[key,args[index]]));
   imported.push({id:String(200+imported.length),title:fields.title,sequence:fields.sequence,status:fields.status,sourceKey:fields.source_key,collectionId:fields.collection_id,isDel:0,versionRaw:collection.versionRaw});rows={};
  }
  else if(sql.startsWith('SELECT is_del'))rows=[{is_del:0}];
  else if(sql.startsWith('SELECT COUNT(*)'))rows=[{total:sql.includes('FROM el_episodes t')?1+imported.length:1}];
  else if(sql.includes('FROM el_collections t'))rows=[collection];
  else if(sql.includes('FROM el_episodes t'))rows=[episode,...imported];
  else if(sql.includes('FROM el_sentences t'))rows=[sentence];
  else if(sql.includes('FROM el_users t'))rows=[{id:user.id,nickname:'测试管理员',adminUsername:'admin',isAdmin:1,isDel:0,versionRaw:collection.versionRaw}];
  else if(sql.startsWith('UPDATE el_collections SET status=1')){collection.status=1;collection.versionRaw='2026-09-19 08:00:00.001000';rows={};}
  else if(sql.startsWith('UPDATE el_episodes SET status=1')){episode.status=1;episode.versionRaw='2026-09-19 08:00:00.001000';rows={};}
  else if(sql.startsWith('UPDATE el_sentences SET zh=')){sentence.zh=args[0];sentence.en=args[1];sentence.versionRaw='2026-09-19 08:00:00.001000';rows={};}
  return [rows,[]];
 };
 const connection={execute,query:execute,beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{},release:()=>{}};
 const db={pool:{execute,query:execute,getConnection:async()=>connection}} as unknown as DatabaseService;
 const auth=new AdminAuthService(db),content=new AdminContentService(db),users=new AdminUsersService(db);
 // tsx does not emit constructor metadata; production tsc does.
 Reflect.defineMetadata('design:paramtypes',[AdminAuthService],AdminAuthController);
 Reflect.defineMetadata('design:paramtypes',[AdminContentService,AdminUsersService,AdminImportService],AdminController);
 Reflect.defineMetadata('design:paramtypes',[AdminAuthService],AdminGuard);
 class FixtureModule{}
 Module({controllers:[AdminAuthController,AdminController],providers:[{provide:AdminImportService,useValue:new AdminImportService(db)},{provide:AdminAuthService,useValue:auth},{provide:AdminContentService,useValue:content},{provide:AdminUsersService,useValue:users},AdminGuard]})(FixtureModule);
 const app=await NestFactory.create<NestExpressApplication>(FixtureModule,{logger:false});configureHttp(app);await app.listen(port,'127.0.0.1');
 return {app,url:await app.getUrl(),calls,sessions};
}
