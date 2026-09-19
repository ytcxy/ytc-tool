import 'reflect-metadata';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {BadRequestException,ConflictException} from '@nestjs/common';
import {AdminImportService,episodeImport} from '../src/admin/admin-import.service';
import {AdminIdentity} from '../src/admin/admin-auth.service';
import {DatabaseService} from '../src/database.service';
const admin={id:'9007199254740993',tokenHash:'a'.repeat(64)} as AdminIdentity;
const input=()=>({parentId:'9007199254740994',episode:{sourceKey:'episode-json-1',title:'咖啡馆',sequence:2,sentences:[{sourceKey:'line-1',sequence:1,zh:'谢谢',en:'Thank you.',speaker:1,speakerName:'奥利',context:'点单'}]}});
function store(options:{duplicate?:number;deletedParent?:boolean;order?:boolean;failSentence?:boolean;failAudit?:boolean;lock?:boolean}={}){
 const writes:{sql:string;values:any[]}[]=[],events:string[]=[],reads:string[]=[];
 const execute=async(sql:string,values:any[]=[])=>{
  reads.push(sql);
  if(sql.includes('GET_LOCK'))return [[{acquired:options.lock===false?0:1}]];
  if(sql.includes('RELEASE_LOCK')){events.push('unlock');return [[]];}
  if(sql.startsWith('SELECT u.id'))return [[{id:admin.id,admin_must_change_password:0}]];
  if(sql.startsWith('SELECT id,title'))return [[{id:input().parentId,title:'合集',source_key:'collection',is_del:options.deletedParent?1:0}]];
  if(sql.startsWith('SELECT id,is_del FROM el_episodes'))return [options.duplicate===undefined?[]:[{id:'20',is_del:options.duplicate}]];
  if(sql.includes('AND sequence=?'))return [options.order?[{id:'20'}]:[]];
  if(sql.startsWith('SELECT id FROM el_episodes'))return [[{id:'9007199254740995'}]];
  if(sql.startsWith('INSERT')){writes.push({sql,values});if(sql.startsWith('INSERT INTO el_sentences')&&options.failSentence)throw Error('sentence failed');if(sql.startsWith('INSERT INTO el_admin_audit_logs')&&options.failAudit)throw Error('audit failed');return [{insertId:1}];}
  throw Error('Unexpected SQL '+sql);
 };
 const connection={execute,beginTransaction:async()=>events.push('begin'),commit:async()=>events.push('commit'),rollback:async()=>events.push('rollback'),release:()=>events.push('release')};
 return {writes,events,reads,service:new AdminImportService({pool:{getConnection:async()=>connection}} as unknown as DatabaseService)};
}
test('episode JSON validates shape, draft status, IDs, duplicate keys/order and limits',()=>{
 const valid=episodeImport(input());assert.equal(valid.fields.status,0);assert.equal(valid.sentences[0].speaker_name,'奥利');
 for(const modify of [(v:any)=>v.episode.status=1,(v:any)=>v.episode.id='1',(v:any)=>v.parentId=123,(v:any)=>v.episode.sentences=[],(v:any)=>v.episode.sentences.push({...v.episode.sentences[0]}),(v:any)=>v.episode.sentences[0].speaker=4,(v:any)=>v.episode.sentences[0].sourceKey='../bad',(v:any)=>v.episode.sourceUrl='http://example.com',(v:any)=>v.episode.sentences=Array(201).fill(v.episode.sentences[0]),(v:any)=>v.episode.extra='x'.repeat(1024*1024)]){
  const value=input();modify(value);assert.throws(()=>episodeImport(value),BadRequestException);
 }
});
test('preview reports draft content and never inserts, while apply preserves exact foreign keys and audits',async()=>{
 const db=store(),preview=await db.service.run(admin,input());assert.equal(db.writes.length,0);assert.equal(preview.sentenceCount,1);assert.equal(preview.status,0);assert.ok('previewHash' in preview);
 const applied=await db.service.run(admin,{...input(),previewHash:(preview as any).previewHash},true);assert.equal((applied as any).id,'9007199254740995');
 assert.equal(db.writes.length,3);assert.ok(db.writes[0].values.includes(input().parentId));assert.equal(db.writes[1].values.at(-1),'9007199254740995');assert.equal(db.writes[2].values[0],admin.id);assert.ok(db.events.includes('commit'));assert.ok(db.events.includes('unlock'));
});
test('changed preview payload, duplicate/deleted source keys, deleted parents and order collisions are refused',async()=>{
 const value=input(),hash=episodeImport(value).previewHash;value.episode.title='changed';await assert.rejects(store().service.run(admin,{...value,previewHash:hash},true),ConflictException);
 for(const options of [{duplicate:0},{duplicate:1},{deletedParent:true},{order:true},{lock:false}]){const db=store(options);await assert.rejects(db.service.run(admin,{...input(),previewHash:episodeImport(input()).previewHash},true),ConflictException);assert.equal(db.writes.length,0);assert.ok(!db.events.includes('commit'));}
});
test('sentence or audit failure rolls back the entire episode and releases its import lock',async()=>{
 for(const options of [{failSentence:true},{failAudit:true}]){const db=store(options);await assert.rejects(db.service.run(admin,{...input(),previewHash:episodeImport(input()).previewHash},true));assert.ok(db.events.includes('rollback'));assert.ok(!db.events.includes('commit'));assert.deepEqual(db.events.slice(-2),['unlock','release']);}
});
