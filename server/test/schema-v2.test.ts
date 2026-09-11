import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { AuthService } from '../src/auth/auth.service';
import { WechatService } from '../src/auth/wechat.service';
import { DatabaseService } from '../src/database.service';
import { CatalogService } from '../src/catalog/catalog.service';
import { ProgressService } from '../src/progress/progress.service';
import { statusCode, statusName } from '../src/progress/status';
import { id } from '../src/common/input';

test('all seven tables use numeric primary keys and common audit/soft-delete fields',()=>{
 const sql=readFileSync(resolve(__dirname,'../migrations/001_learning.sql'),'utf8');
 const tables=[...sql.matchAll(/CREATE TABLE (el_\w+) \(([\s\S]*?)\) ENGINE/g)];
 assert.equal(tables.length,7);
 for(const [,name,ddl] of tables){
  assert.match(ddl,/id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT/,name);
  assert.match(ddl,/PRIMARY KEY \(id\)/,name);
  assert.match(ddl,/created_at DATETIME\(3\) NOT NULL DEFAULT CURRENT_TIMESTAMP\(3\)/,name);
  assert.match(ddl,/ON UPDATE CURRENT_TIMESTAMP\(3\)/,name);
  assert.match(ddl,/is_del TINYINT UNSIGNED NOT NULL DEFAULT 0/,name);
 }
 assert.doesNotMatch(sql,/deleted_at|active BOOLEAN|ON DELETE CASCADE|CHAR\(36\)/);
 for(const match of sql.matchAll(/UNIQUE KEY[^\n]+/g))assert.ok(!match[0].includes('is_del'));
});
test('BIGINT IDs validate losslessly and reject numbers, old source keys, zero and overflow',()=>{
 for(const value of ['1','9007199254740993','18446744073709551615'])assert.equal(id(value),value);
 for(const value of ['0','01','-1','1.0','1e3','18446744073709551616','daily-200',42,' 1'])assert.throws(()=>id(value),BadRequestException);
});
test('learning status uses numeric storage while preserving the API vocabulary',()=>{
 for(const [name,code] of [['unseen',0],['learning',1],['mastered',2]] as const){assert.equal(statusCode(name),code);assert.equal(statusName(code),name);}
 assert.throws(()=>statusName(3));
});
function authFixture(deleted:boolean){
 const calls:{sql:string;values:unknown[]}[]=[];const events:string[]=[];
 const connection={beginTransaction:async()=>events.push('begin'),execute:async(sql:string,values:unknown[])=>{
  calls.push({sql,values});return sql.startsWith('SELECT')?[[{id:'9007199254740993',is_del:deleted?1:0}],[]]:[{},[]];
 },commit:async()=>events.push('commit'),rollback:async()=>events.push('rollback'),release:()=>events.push('release')};
 const db={pool:{getConnection:async()=>connection}} as unknown as DatabaseService;
 const wechat={exchange:async()=>({appid:'wx-test',openid:'open-test'})} as unknown as WechatService;
 return {service:new AuthService(db,wechat),calls,events};
}
test('deleted WeChat identity cannot log in or get a new session',async()=>{
 const f=authFixture(true);await assert.rejects(f.service.login('code'),ForbiddenException);
 assert.ok(!f.calls.some(c=>c.sql.includes('INSERT INTO el_sessions')));
 assert.ok(!f.calls.some(c=>/is_del\s*=\s*0/.test(c.sql)));
 assert.deepEqual(f.events,['begin','rollback','release']);
});
test('login stores the exact numeric user ID and updates only the last-login activity',async()=>{
 const f=authFixture(false);const result=await f.service.login('code');
 assert.equal(result.token.length,64);
 assert.equal(f.calls.find(c=>c.sql.includes('INSERT INTO el_sessions'))?.values[1],'9007199254740993');
 assert.ok(f.calls.some(c=>c.sql.includes('last_login_at=UTC_TIMESTAMP(3)')));
});
test('authentication requires both live session and live user plus expiry and revocation',async()=>{
 let sql='';const db={pool:{execute:async(q:string)=>{sql=q;return [[],[]];}}} as unknown as DatabaseService;
 await assert.rejects(new AuthService(db,{} as WechatService).authenticate('Bearer '+'a'.repeat(64)));
 for(const predicate of ['s.is_del=0','u.is_del=0','s.revoked_at IS NULL','s.expires_at>UTC_TIMESTAMP(3)'])assert.ok(sql.includes(predicate));
});
for(const deletedTable of ['episode','sentence'])test(`deleted ${deletedTable} progress rejects writes instead of restoring`,async()=>{
 const calls:string[]=[];let rolledBack=false;
 const connection={beginTransaction:async()=>{},execute:async(sql:string)=>{
  calls.push(sql);if(sql.startsWith('SELECT'))return [[{is_del:sql.includes('el_'+deletedTable+'_progress')?1:0}],[]];return [{},[]];
 },commit:async()=>{throw new Error('must not commit');},rollback:async()=>{rolledBack=true;},release:()=>{}};
 const db={pool:{getConnection:async()=>connection}} as unknown as DatabaseService;
 const catalog={sentence:async()=>({episodeId:'2'})} as unknown as CatalogService;
 await assert.rejects(new ProgressService(db,catalog).saveSentence('1','3',{status:'mastered'}),ConflictException);
 assert.ok(rolledBack);assert.ok(!calls.some(sql=>sql.startsWith('UPDATE')));
});
test('catalog SQL checks publication and soft deletion along every parent link',async()=>{
 const queries:string[]=[];
 const execute=async(sql:string)=>{queries.push(sql);return [[{id:'1',title:'test',description:'test',total:0}],[]];};
 const db={pool:{execute,query:execute}} as unknown as DatabaseService;
 const service=new CatalogService(db);
 await service.collections(0,20);await service.episodes('1',0,20);await service.episode('1');await service.sentences('1');await service.sentence('1');
 assert.ok(queries.some(sql=>sql.includes('s.speaker')));
 for(const sql of queries){
  assert.ok(sql.includes('c.is_del=0')&&sql.includes('c.status=1'));
  if(sql.includes('JOIN el_episodes e')||sql.includes('FROM el_episodes e'))assert.ok(sql.includes('e.is_del=0')&&sql.includes('e.status=1'));
  if(sql.includes('JOIN el_sentences s')||sql.includes('FROM el_sentences s'))assert.ok(sql.includes('s.is_del=0'));
 }
});
test('progress reads hide deleted records and use business timestamps for recency',async()=>{
 const queries:string[]=[];
 const execute=async(sql:string)=>{queries.push(sql);return sql.includes('COUNT(*)')?[[{count:0,total:0}],[]]:[[],[]];};
 const db={pool:{execute,query:execute}} as unknown as DatabaseService;
 const catalog={episode:async()=>({}),collection:async()=>({})} as unknown as CatalogService;
 const service=new ProgressService(db,catalog);
 await service.episode('1','2');await service.summary('1');await service.collection('1','2');await service.review('1',0,20);
 for(const sql of queries){assert.ok(sql.includes('p.is_del=0'));assert.ok(sql.includes('e.is_del=0')&&sql.includes('c.is_del=0'));assert.ok(sql.includes('e.status=1')&&sql.includes('c.status=1'));}
 assert.ok(queries.some(sql=>sql.includes('ORDER BY p.last_studied_at DESC')));
 assert.ok(queries.some(sql=>sql.includes('LEFT JOIN el_sentences s')&&sql.includes('s.is_del=0')));
 assert.ok(!queries.some(sql=>sql.includes('ORDER BY p.updated_at')));
 assert.ok(queries.some(sql=>sql.includes('s.speaker')));
});

test('catalog preserves BIGINT IDs as strings but returns count fields as numbers',async()=>{
 const execute=async(sql:string)=>{
  if(sql.includes('AS episodeCount'))return [[{id:'9007199254740993',episodeCount:'200'}],[]];
  if(sql.includes('AS sentenceCount'))return [[{id:'9007199254740995',sentenceCount:'8'}],[]];
  if(sql.includes('COUNT(*) AS total'))return [[{total:'1'}],[]];
  return [[{id:'9007199254740993',title:'test',description:''}],[]];
 };
 const db={pool:{execute,query:execute}} as unknown as DatabaseService;
 const service=new CatalogService(db);
 const collections=await service.collections(0,20);const episodes=await service.episodes('9007199254740993',0,20);
 assert.equal(collections.items[0].id,'9007199254740993');assert.equal(collections.items[0].episodeCount,200);
 assert.equal(episodes.items[0].id,'9007199254740995');assert.equal(episodes.items[0].sentenceCount,8);
});
