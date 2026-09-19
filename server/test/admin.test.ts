import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BadRequestException, ConflictException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { hashPassword, password, username, verifyPassword } from '../src/admin/password';
import { AdminAuthService, AdminIdentity, AdminRequest, checkCsrf, checkOrigin, csrfFor } from '../src/admin/admin-auth.service';
import { AdminGuard } from '../src/admin/admin.guard';
import { AdminContentService, collectionLock } from '../src/admin/admin-content.service';
import { AdminUsersService } from '../src/admin/admin-users.service';
import { contentInput, expectedVersion, resource } from '../src/admin/content-input';
import { DatabaseService } from '../src/database.service';
import { AuthService, tokenHash } from '../src/auth/auth.service';
import { WechatService } from '../src/auth/wechat.service';
const admin:AdminIdentity={id:'9007199254740993',username:'admin',mustChangePassword:false,tokenHash:'a'.repeat(64),csrf:'b'.repeat(64)};
const version='2026-09-19 08:00:00.000';
function fake(handler:(sql:string,args:any[])=>any){
 const calls:{sql:string;args:any[]}[]=[],events:string[]=[];
 const execute=async(sql:string,args:any[]=[])=>{calls.push({sql,args});return [await handler(sql,args),[]];};
 const connection={execute,query:execute,beginTransaction:async()=>{events.push('begin');},commit:async()=>{events.push('commit');},rollback:async()=>{events.push('rollback');},release:()=>{events.push('release');}};
 return {calls,events,db:{pool:{execute,query:execute,getConnection:async()=>connection}} as unknown as DatabaseService};
}
test('admin password is salted, verifies safely, and enforces account input',async()=>{
 const a=await hashPassword('a-long-password'),b=await hashPassword('a-long-password');assert.notEqual(a,b);assert.ok(await verifyPassword('a-long-password',a));assert.equal(await verifyPassword('wrong-password',a),false);assert.equal(await verifyPassword('a-long-password','scrypt$1$1$1$broken'),false);
 assert.throws(()=>password('12345'),BadRequestException);assert.equal(password('123456'),'123456');assert.equal(password('a'.repeat(128)).length,128);assert.throws(()=>password('a'.repeat(129)),BadRequestException);
 assert.throws(()=>password('short'),BadRequestException);assert.throws(()=>username('Admin'),BadRequestException);assert.throws(()=>username('a OR 1=1'),BadRequestException);assert.equal(username('admin_01'),'admin_01');
});
test('admin cookie and miniapp bearer queries isolate session types and preserve exact IDs',async()=>{
 const store=fake(sql=>sql.includes("session_type='admin'")?[{id:admin.id,admin_username:'admin',admin_must_change_password:1}]:[]);
 const auth=new AdminAuthService(store.db),token='f'.repeat(64);const identity=await auth.authenticate('other=value; ytc_admin='+token);
 assert.equal(identity.id,admin.id);assert.equal(identity.mustChangePassword,true);assert.equal(identity.csrf,csrfFor(token));assert.equal(store.calls[0].args[0],tokenHash(token));assert.ok(!store.calls[0].args.includes(token));
 assert.match(store.calls[0].sql,/u.is_admin=1/);assert.match(store.calls[0].sql,/u.is_del=0/);assert.match(store.calls[0].sql,/s.revoked_at IS NULL/);
 await assert.rejects(auth.authenticate('ytc_admin=bad'),UnauthorizedException);
 const mini=new AuthService(store.db,{} as WechatService);await assert.rejects(mini.authenticate('Bearer '+token),UnauthorizedException);assert.match(store.calls.at(-1)!.sql,/session_type='miniapp'/);
});
test('CSRF requires exact origin plus session-derived token',()=>{
 const req={headers:{origin:'http://localhost:3000',host:'localhost:3000','x-csrf-token':admin.csrf},admin} as AdminRequest;
 checkCsrf(req);assert.throws(()=>checkCsrf({...req,headers:{...req.headers,'x-csrf-token':'0'.repeat(64)}}),ForbiddenException);
 assert.throws(()=>checkOrigin({...req,headers:{...req.headers,origin:'https://evil.test'}}),ForbiddenException);
 assert.throws(()=>checkOrigin({...req,headers:{host:'localhost:3000'}}),ForbiddenException);
});
test('first-login guard blocks content until password is changed',async()=>{
 const guard=new AdminGuard({authenticate:async()=>({...admin,mustChangePassword:true})} as unknown as AdminAuthService);
 const request={headers:{},method:'GET'};const context=(name:string)=>({switchToHttp:()=>({getRequest:()=>request}),getHandler:()=>({name})}) as any;
 await assert.rejects(guard.canActivate(context('list')),ForbiddenException);assert.equal(await guard.canActivate(context('me')),true);
});
test('password reset revokes all admin sessions and audit never includes secrets',async()=>{
 const oldHash=await hashPassword('old-password-123');
 const store=fake(sql=>sql.includes('SELECT u.id')?[{id:admin.id,admin_must_change_password:1}]:sql.startsWith('SELECT admin_password_hash')?[{admin_password_hash:oldHash}]:{});
 await new AdminAuthService(store.db).changePassword(admin,{oldPassword:'old-password-123',password:'new-password-123'});
 assert.ok(store.events.includes('commit'));assert.ok(store.calls.some(c=>c.sql.includes("session_type='admin'")&&c.sql.startsWith('UPDATE el_sessions')));
 const audit=store.calls.find(c=>c.sql.startsWith('INSERT INTO el_admin_audit_logs'))!;assert.ok(!JSON.stringify(audit.args).includes('password-123'));assert.ok(!JSON.stringify(audit.args).includes('scrypt$'));
});
test('content input rejects unsupported resources, IDs as ordering, bad URLs and huge text',()=>{
 assert.throws(()=>resource('__proto__'),BadRequestException);assert.throws(()=>resource('el_users'),BadRequestException);
 assert.throws(()=>contentInput('collections',{title:'a',description:'b',sortOrder:'9007199254740993'}),BadRequestException);
 assert.throws(()=>contentInput('episodes',{title:'a',sequence:1,sourceUrl:'javascript:alert(1)'}),BadRequestException);
 assert.throws(()=>contentInput('sentences',{zh:'a',en:'b',sequence:1,speaker:2}),BadRequestException);
 assert.throws(()=>expectedVersion({updatedAt:'bad'}),BadRequestException);
 const fields=contentInput('sentences',{zh:'a',en:'b',sequence:1,speakerName:'奥利',sourceKey:'hijack',episodeId:'100'});assert.equal(fields.speaker_name,'奥利');assert.ok(!('source_key' in fields));assert.ok(!('episode_id' in fields));
});
function contentStore({deleted=0,parentDeleted=0,storedVersion=version,failAudit=false,lock=1}={}){
 return fake((sql,args)=>{
  if(sql.includes('GET_LOCK'))return [{acquired:lock}];
  if(sql.startsWith('SELECT c.id,c.source_key'))return [{id:'10',source_key:'daily'}];
  if(sql.startsWith('SELECT u.id'))return [{id:admin.id,admin_must_change_password:0}];
  if(sql.startsWith('SELECT is_del FROM el_collections'))return [{is_del:parentDeleted}];
  if(sql.startsWith('SELECT is_del FROM el_episodes'))return [{is_del:0}];
  if(sql.startsWith('SELECT t.id'))return [{id:'9007199254740995',episodeId:'12',sourceKey:'existing',sequence:1,zh:'中文',en:'English',speaker:0,isDel:deleted,versionRaw:storedVersion+'000'}];
  if(sql.startsWith('SELECT id FROM el_sentences'))return [];
  if(sql.startsWith('INSERT INTO el_admin_audit_logs')&&failAudit)throw Error('audit unavailable');
  return {};
 });
}
test('content rejects stale versions and deleted parents/rows before any update',async()=>{
 for(const options of [{storedVersion:'2026-09-19 08:00:01.000'},{deleted:1},{parentDeleted:1}]){
  const store=contentStore(options);await assert.rejects(new AdminContentService(store.db).mutate(admin,'sentences','9007199254740995',{updatedAt:version,zh:'new',en:'new',sequence:1}),ConflictException);
  assert.ok(!store.calls.some(c=>c.sql.startsWith('UPDATE')));assert.ok(store.events.includes('rollback'));
 }
});
test('content edits preserve ID/sourceKey and roll back when audit fails',async()=>{
 const store=contentStore({failAudit:true});await assert.rejects(new AdminContentService(store.db).mutate(admin,'sentences','9007199254740995',{updatedAt:version,zh:'new',en:'new',sequence:1,sourceKey:'overwritten',userId:'other'}),/audit unavailable/);
 const update=store.calls.find(c=>c.sql.startsWith('UPDATE el_sentences'))!;assert.equal(update.args.at(-1),'9007199254740995');assert.ok(!update.sql.includes('source_key='));assert.ok(!update.args.includes('other'));assert.ok(!store.events.includes('commit'));assert.ok(store.events.includes('rollback'));assert.ok(store.calls.some(c=>c.sql.includes('RELEASE_LOCK')));
});
test('delete only soft-deletes selected content, never deletes historical progress',async()=>{
 const store=contentStore();await new AdminContentService(store.db).mutate(admin,'sentences','9007199254740995',{updatedAt:version},true);
 const updates=store.calls.filter(c=>c.sql.startsWith('UPDATE'));assert.equal(updates.length,1);assert.match(updates[0].sql,/is_del=\?/);assert.equal(updates[0].args[0],1);assert.ok(!store.calls.some(c=>/DELETE FROM|REPLACE INTO/.test(c.sql)));assert.ok(store.events.includes('commit'));
});
test('import contention prevents content write transaction',async()=>{
 const store=contentStore({lock:0});await assert.rejects(new AdminContentService(store.db).mutate(admin,'sentences','9007199254740995',{updatedAt:version},true),ConflictException);assert.ok(!store.events.includes('begin'));assert.equal(collectionLock('daily').length,56);
});
test('last administrator and self-disable protections prevent writes',async()=>{
 const store=fake(sql=>sql.includes('GET_LOCK')?[{acquired:1}]:sql.startsWith('SELECT u.id')?[{id:admin.id,admin_must_change_password:0}]:sql.startsWith('SELECT t.id')?[{id:'2',isAdmin:1,isDel:0,versionRaw:version+'000'}]:sql.startsWith('SELECT id FROM el_users')?[{id:'2'}]:{});
 const users=new AdminUsersService(store.db);await assert.rejects(users.update(admin,'2',{action:'revoke',updatedAt:version}),ConflictException);assert.ok(!store.calls.some(c=>c.sql.startsWith('UPDATE')));
 await assert.rejects(users.update(admin,admin.id,{action:'disable',updatedAt:version}),ConflictException);
});
test('progress and user lists never expose secrets and enforce full publication chain',async()=>{
 const store=fake(sql=>sql.includes('COUNT(*)')?[{total:0}]:[]),service=new AdminUsersService(store.db);
 await service.list({q:'admin'});assert.ok(store.calls.every(c=>!c.sql.includes('password_hash')&&!c.sql.includes('openid')));
 await service.progress({userId:admin.id});const sql=store.calls.find(c=>c.sql.includes('el_sentence_progress'))!.sql;
 for(const condition of ['s.is_del=0','e.is_del=0','c.is_del=0','u.is_del=0','p.is_del=0','e.status=1','c.status=1'])assert.ok(sql.includes(condition));assert.ok(store.calls.some(c=>c.args.includes(admin.id)));
});
function batchStore({stale=false,deleted=false,parentDeleted=false,failAudit=false,failLock=false,wrongParent=false}={}){
 return fake((sql,args)=>{
  if(sql.includes('GET_LOCK'))return [{acquired:failLock?0:1}];
  if(sql.startsWith('SELECT c.id,c.source_key'))return [{id:wrongParent?'11':'10',source_key:'daily'}];
  if(sql.startsWith('SELECT u.id'))return [{id:admin.id,admin_must_change_password:0}];
  if(sql.startsWith('SELECT is_del'))return [{is_del:parentDeleted?1:0}];
  if(sql.startsWith('SELECT t.id'))return [{id:args[0],collectionId:'10',status:args[0]==='9007199254740994'?1:0,isDel:deleted?1:0,versionRaw:(stale&&args[0]==='9007199254740994'?'2026-09-19 08:00:01.000':version)+'000'}];
  if(sql.startsWith('INSERT INTO el_admin_audit_logs')&&failAudit)throw Error('audit failed');
  return {};
 });
}
const batchBody={parentId:'10',items:[{id:'9007199254740993',updatedAt:version},{id:'9007199254740994',updatedAt:version}]};
test('batch publishing changes only selected drafts, preserves BIGINT IDs and audits each changed record',async()=>{
 const store=batchStore();const result=await new AdminContentService(store.db).batchPublish(admin,'episodes',batchBody);
 assert.deepEqual(result,{published:1,skipped:1});const writes=store.calls.filter(c=>c.sql.startsWith('UPDATE'));
 assert.equal(writes.length,1);assert.match(writes[0].sql,/UPDATE el_episodes SET status=1/);assert.deepEqual(writes[0].args,['9007199254740993']);
 assert.equal(store.calls.filter(c=>c.sql.startsWith('INSERT INTO el_admin_audit_logs')).length,1);assert.ok(store.events.includes('commit'));
 assert.equal(store.calls.filter(c=>c.sql.includes('GET_LOCK')).length,1);assert.ok(store.calls.some(c=>c.sql.includes('RELEASE_LOCK')));
});
test('batch rejects stale, deleted and wrong-parent records without partial publication',async()=>{
 for(const options of [{stale:true},{deleted:true},{parentDeleted:true},{wrongParent:true},{failLock:true}]){
  const store=batchStore(options);await assert.rejects(new AdminContentService(store.db).batchPublish(admin,'episodes',batchBody));
  assert.ok(!store.calls.some(c=>c.sql.startsWith('UPDATE')));assert.ok(!store.events.includes('commit'));
 }
});
test('batch audit failure rolls back the whole transaction and releases import locks',async()=>{
 const store=batchStore({failAudit:true});await assert.rejects(new AdminContentService(store.db).batchPublish(admin,'episodes',batchBody),/audit failed/);
 assert.ok(store.events.includes('rollback'));assert.ok(!store.events.includes('commit'));assert.ok(store.calls.some(c=>c.sql.includes('RELEASE_LOCK')));
});
test('batch validates count, uniqueness, ID type and versions before accessing database',async()=>{
 const store=fake(()=>{throw Error('must not access database');}),service=new AdminContentService(store.db);
 for(const body of [{items:[]},{items:Array(101).fill(batchBody.items[0])},{items:[batchBody.items[0],batchBody.items[0]]},{items:[{id:1,updatedAt:version}]},{items:[{id:'1'}]}])await assert.rejects(service.batchPublish(admin,'collections',body),BadRequestException);
 await assert.rejects(service.batchPublish(admin,'sentences',batchBody),BadRequestException);assert.equal(store.calls.length,0);
});
test('batch releases already acquired collection locks if a later lock is busy',async()=>{
 const store=fake((sql,args)=>{
  if(sql.startsWith('SELECT c.id,c.source_key'))return [{id:args[0],source_key:'key-'+args[0]}];
  if(sql.includes('GET_LOCK'))return [{acquired:args[0]===collectionLock('key-1')?1:0}];return {};
 });
 await assert.rejects(new AdminContentService(store.db).batchPublish(admin,'collections',{items:[{id:'2',updatedAt:version},{id:'1',updatedAt:version}]}),ConflictException);
 assert.deepEqual(store.calls.filter(c=>c.sql.includes('GET_LOCK')).map(c=>c.args[0]),[collectionLock('key-1'),collectionLock('key-2')]);
 assert.deepEqual(store.calls.filter(c=>c.sql.includes('RELEASE_LOCK')).map(c=>c.args[0]),[collectionLock('key-1')]);assert.ok(!store.events.includes('begin'));
});
