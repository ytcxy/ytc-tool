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
 let gate:Promise<void>|null=null;
 const updates:any[]=[];const observations:boolean[]=[];
 const wx={nextTick:()=>{},pageScrollTo:()=>{},switchTab:()=>{}};
 const api={getToken:()=>token,requireLogin:()=>!!token,errorMessage:(e:Error)=>e.message,request:async(path:string,method:string,body:unknown)=>{writes.push({path,body});if(gate)await gate;if(fail)throw new Error('offline');
 if(!method){
  if(path.endsWith('/sentences'))return {items:[{id:'9007199254740995',sequence:1,speaker:0,zh:'你好',en:'Hi.',context:''}]};
  if(path.endsWith('/progress'))return {completed:false,lastSentenceId:null,sentences:[]};
  return {id:'9007199254740993',sequence:1,title:'Example'};
 }
 return {ok:true};}};
 const source=readFileSync(resolve(__dirname,'../../miniprogram/pages/episode/episode.ts'),'utf8');
 const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(compiled,{exports:{},require:()=>api,Page:(options:unknown)=>{definition=options;},wx,setTimeout,clearTimeout,Promise,Map,Error});
 const page={...definition,data:JSON.parse(JSON.stringify(definition.data)),setData(values:unknown,callback?:()=>void){updates.push(values);Object.assign(this.data,values);callback?.();},createIntersectionObserver(){observations.push(this.data.loading);return {disconnect(){},relativeToViewport(){return this;},observe(){}};}};
 page._session='session-a';page.data.id='9007199254740993';
 page.data.sentences=[{id:'9007199254740995',sequence:1,zh:'你好',en:'Hi.',context:'',status:'unseen',revealed:false},{id:'9007199254740996',sequence:2,zh:'谢谢',en:'Thanks.',context:'',status:'mastered',revealed:false}];
 const recordPosition=page.recordPosition.bind(page);page.recordPosition=()=>{};
 return {page,writes,updates,observations,recordPosition,setGate:(value:Promise<void>)=>{gate=value;},setFailure:(value:boolean)=>{fail=value;},setToken:(value:string)=>{token=value;}};
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


test('returning to a loaded episode preserves revealed English and filter without fetching again',async()=>{
 const {page,writes}=episodePage();page.data.loading=false;page.data.episode={id:page.data.id};
 page.data.sentences[0].revealed=true;page.data.onlyUnmastered=true;
 await page.onShow();page.onHide();await page.onShow();
 assert.equal(writes.length,0);assert.equal(page.data.sentences[0].revealed,true);
 assert.equal(page.data.onlyUnmastered,true);assert.equal(page.data.loading,false);
});
test('account change reloads progress; hiding during a queued save does not start a hidden reload',async()=>{
 const {page,setToken}=episodePage();page.data.episode={id:page.data.id};let loads=0;
 page.load=async()=>{loads++;};setToken('session-b');await page.onShow();assert.equal(loads,1);
 let release!:()=>void;page._queue=new Promise<void>(resolve=>{release=resolve;});
 const show=page.onShow();page.onHide();release();await show;assert.equal(loads,1);
});
test('concurrent loads share requests and observation starts after loading UI has rendered',async()=>{
 const {page,writes,setGate,observations}=episodePage();page._visible=true;
 let release!:()=>void;setGate(new Promise<void>(resolve=>{release=resolve;}));
 const first=page.load(),second=page.load();assert.equal(first,second);
 release();await first;assert.equal(writes.length,3);assert.equal(page.data.loading,false);
 assert.equal(observations.length,1);assert.equal(observations[0],false);
});
test('background position saves do not toggle button state or rewrite the page',async()=>{
 const {page,writes,updates}=episodePage();page._position='9007199254740995';
 page.flushPosition();await page._queue;
 assert.equal(writes.length,1);assert.equal(page._savedPosition,'9007199254740995');
 assert.equal(updates.length,0);assert.equal(page.data.saving,false);
 page._position='9007199254740995';page.flushPosition();await page._queue;assert.equal(writes.length,1);
});
test('failed background saves remain visible and retry without flashing buttons',async()=>{
 const {page,updates,setFailure}=episodePage();setFailure(true);page._position='9007199254740995';
 page.flushPosition();await page._queue;assert.match(page.data.saveError,/未同步/);
 setFailure(false);page.retry();await page._queue;assert.equal(page.data.saveError,'');
 assert.equal(page._savedPosition,'9007199254740995');assert.ok(updates.every(v=>!('saving' in v)));
});
test('repeated observations of the saved position do not schedule new saves',()=>{
 const {page,recordPosition}=episodePage();page._savedPosition='9007199254740995';
 recordPosition('9007199254740995');assert.equal(page._positionTimer,0);
});
