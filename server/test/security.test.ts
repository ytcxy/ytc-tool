import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BadRequestException, UnauthorizedException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { id, pagination, learningStatus } from '../src/common/input';
import { imageType } from '../src/users/avatar';
import { AuthService, tokenHash } from '../src/auth/auth.service';
import { WechatService } from '../src/auth/wechat.service';
import { DatabaseService } from '../src/database.service';
import { CatalogService } from '../src/catalog/catalog.service';
import { ProgressService } from '../src/progress/progress.service';

test('rejects path traversal, malformed pagination and invalid progress status',()=>{
 for(const value of ['../users','x?userId=other','',{},'a'.repeat(81)])assert.throws(()=>id(value),BadRequestException);
 for(const value of ['0','-1','1.5','1 OR 1=1',['1']])assert.throws(()=>pagination(value,'20'),BadRequestException);
 assert.throws(()=>pagination('1','101'),BadRequestException);
 assert.throws(()=>learningStatus('complete'),BadRequestException);
 assert.deepEqual(pagination(undefined,undefined),{page:1,limit:20,offset:0});
});
test('avatar rejects executable/SVG payloads and oversized bytes',()=>{
 assert.throws(()=>imageType(Buffer.from('<svg onload="evil()"></svg>')),BadRequestException);
 assert.throws(()=>imageType(Buffer.alloc(2*1024*1024+1)),BadRequestException);
 const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.alloc(20)]);
 assert.equal(imageType(png).mime,'image/png');
});
test('missing WeChat secret fails closed and never creates a user',async()=>{
 const service=new WechatService(new ConfigService({WECHAT_APP_ID:'wx-test'}));
 await assert.rejects(service.exchange('a-code'),ServiceUnavailableException);
});
test('bearer validation rejects bad or unknown tokens; only hashes reach SQL',async()=>{
 const calls:unknown[][]=[];
 const db={pool:{execute:async(_sql:string,values:unknown[])=>{calls.push(values);return [[],[]];}}} as unknown as DatabaseService;
 const service=new AuthService(db,{} as WechatService);
 await assert.rejects(service.authenticate(undefined),UnauthorizedException);
 await assert.rejects(service.authenticate('Bearer root'),UnauthorizedException);
 assert.equal(calls.length,0);
 const token='a'.repeat(64);
 await assert.rejects(service.authenticate('Bearer '+token),UnauthorizedException);
 assert.equal(calls[0][0],tokenHash(token));assert.notEqual(calls[0][0],token);
});
test('cannot save a resume position from a different episode',async()=>{
 const db={pool:{getConnection:()=>{throw new Error('must not write');}}} as unknown as DatabaseService;
 const catalog={episode:async()=>({}),sentence:async()=>({episodeId:'other'})} as unknown as CatalogService;
 const service=new ProgressService(db,catalog);
 await assert.rejects(service.saveEpisode('user-a','episode-a',{lastSentenceId:'2'}),BadRequestException);
});
test('a failed progress transaction rolls back and releases its connection',async()=>{
 const events:string[]=[];
 const connection={beginTransaction:async()=>events.push('begin'),execute:async()=>{throw new Error('db failed');},commit:async()=>events.push('commit'),rollback:async()=>events.push('rollback'),release:()=>events.push('release')};
 const db={pool:{getConnection:async()=>connection}} as unknown as DatabaseService;
 const catalog={sentence:async()=>({episodeId:'episode-a'})} as unknown as CatalogService;
 await assert.rejects(new ProgressService(db,catalog).saveSentence('user-a','sentence-a',{status:'mastered'}),/db failed/);
 assert.deepEqual(events,['begin','rollback','release']);
});
test('client supplied userId cannot replace authenticated user in writes',async()=>{
 const calls:{sql:string;values:unknown[]}[]=[];
 const connection={beginTransaction:async()=>{},execute:async(sql:string,values:unknown[])=>{
  calls.push({sql,values});return sql.startsWith('SELECT')?[[{is_del:0}],[]]:[{},[]];
 },commit:async()=>{},rollback:async()=>{},release:()=>{}};
 const db={pool:{getConnection:async()=>connection}} as unknown as DatabaseService;
 const catalog={sentence:async()=>({episodeId:'701'})} as unknown as CatalogService;
 await new ProgressService(db,catalog).saveSentence('901','801',{userId:'victim',status:'mastered'});
 assert.ok(calls.every(call=>!call.values.includes('victim')));
 const write=calls.find(call=>call.sql.startsWith('UPDATE el_sentence_progress'))!;
 assert.deepEqual(write.values,[2,'901','801']);
});
