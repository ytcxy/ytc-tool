import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

function episodePage() {
 let definition:any;
 let token='session-a';
 const writes:{path:string;body:unknown}[]=[];
 let fail=false;
 const wx={nextTick:()=>{},pageScrollTo:()=>{},switchTab:()=>{}};
 const api={getToken:()=>token,requireLogin:()=>!!token,errorMessage:(e:Error)=>e.message,request:async(path:string,method:string,body:unknown)=>{writes.push({path,body});if(fail)throw new Error('offline');return {ok:true};}};
 const source=readFileSync(resolve(__dirname,'../../miniprogram/pages/episode/episode.ts'),'utf8');
 const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(compiled,{exports:{},require:()=>api,Page:(options:unknown)=>{definition=options;},wx,setTimeout,clearTimeout,Promise,Map,Error});
 const page={...definition,data:JSON.parse(JSON.stringify(definition.data)),setData(values:unknown){Object.assign(this.data,values);}};
 page._session='session-a';page.data.id='9007199254740993';
 page.data.sentences=[{id:'9007199254740995',sequence:1,zh:'你好',en:'Hi.',context:'',status:'unseen',revealed:false},{id:'9007199254740996',sequence:2,zh:'谢谢',en:'Thanks.',context:'',status:'mastered',revealed:false}];
 page.recordPosition=()=>{};
 return {page,writes,setFailure:(value:boolean)=>{fail=value;},setToken:(value:string)=>{token=value;}};
}
test('revealing reference English never marks a sentence as mastered',()=>{
 const {page,writes}=episodePage();page.toggle({currentTarget:{dataset:{id:'9007199254740995'}}});
 assert.equal(page.data.sentences[0].revealed,true);assert.equal(page.data.sentences[0].status,'unseen');assert.equal(writes.length,0);
 page.toggleAll();assert.ok(page.data.sentences.every((s:any)=>s.revealed));page.toggleAll();assert.ok(page.data.sentences.every((s:any)=>!s.revealed));
});
test('unmastered filter includes unseen and learning but excludes mastered',()=>{
 const {page}=episodePage();page.filter();assert.equal(page.data.visibleCount,1);page.filter();assert.equal(page.data.visibleCount,2);
});
test('failed progress is visible and only changes local status after retry succeeds',async()=>{
 const {page,writes,setFailure}=episodePage();setFailure(true);
 page.mark({currentTarget:{dataset:{id:'9007199254740995',status:'mastered'}}});await page._queue;
 assert.equal(page.data.sentences[0].status,'unseen');assert.match(page.data.saveError,/未同步/);
 setFailure(false);page.retry();await page._queue;
 assert.equal(page.data.sentences[0].status,'mastered');assert.equal(page.data.saveError,'');assert.equal(writes.length,2);
});
test('queued saves stop on first failure instead of hiding an unsynced action',async()=>{
 const {page,setFailure,writes}=episodePage();setFailure(true);
 page.mark({currentTarget:{dataset:{id:'9007199254740995',status:'mastered'}}});
 page.complete();await page._queue;
 assert.equal(writes.length,1);assert.match(page.data.saveError,/未同步/);assert.equal(page.data.completed,false);
});
test('queued writes never run under a different account session',async()=>{
 const {page,writes,setToken}=episodePage();page.complete();setToken('session-b');await page._queue;assert.equal(writes.length,0);
});

test('large numeric IDs remain exact strings in front-end progress requests',async()=>{
 const {page,writes}=episodePage();
 page.mark({currentTarget:{dataset:{id:'9007199254740995',status:'learning'}}});await page._queue;
 assert.equal(writes[0].path,'/me/sentences/9007199254740995/progress');
 assert.equal(page.data.sentences[0].id,'9007199254740995');
});
