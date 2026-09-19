import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
function setup(){
 let def:any;const calls:any[]=[],events:any[]=[],timers=new Map<number,()=>void>();let next=0;
 const context={pause:()=>calls.push(['pause']),seek:(n:number)=>calls.push(['seek',n]),play:()=>calls.push(['play'])};
 const src=readFileSync(resolve(__dirname,'../../miniprogram/components/episode-video/index.ts'),'utf8');
 vm.runInNewContext(ts.transpileModule(src,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:{},require:()=>({videoUrl:(p:string)=>'https://example.test'+p}),Component:(v:any)=>def=v,wx:{createVideoContext:()=>context,showActionSheet:()=>{}},setTimeout:(cb:()=>void)=>{timers.set(++next,cb);return next;},clearTimeout:(id:number)=>timers.delete(id)});
 const p:any={...def.methods,data:{...def.data,episode:{video:{url:'/episodes/1/video',version:'a',durationMs:30000}},sentences:[{id:'9007199254740993',status:'unseen',videoClip:{version:'a',startMs:1000,endMs:3000}},{id:'9007199254740995',status:'unseen',videoClip:{version:'a',startMs:5000,endMs:7000}}],onlyUnmastered:false},setData(v:any,cb?:()=>void){Object.assign(this.data,v);cb?.();},triggerEvent:(name:string,data:any)=>events.push({name,data})};
 def.lifetimes.attached.call(p);const tap=(id='9007199254740993')=>p.playSentence({currentTarget:{dataset:{id}}});return {p,tap,calls,events,timers,def};
}
test('load, seek, play, stop at sentence end; replay preserves mastery',()=>{const {p,tap,calls,events}=setup();tap();assert.equal(calls.length,0);p.loaded();assert.deepEqual(calls.at(-1),['seek',1]);p.seekComplete();assert.deepEqual(calls.at(-1),['play']);p.playing();p.timeUpdate({detail:{currentTime:2}});assert.equal(p.data.state,'playing');p.timeUpdate({detail:{currentTime:3.1}});assert.equal(p.data.state,'ended');assert.deepEqual(calls.at(-1),['pause']);assert.ok(!events.some(e=>e.name==='mark'));tap();assert.deepEqual(calls.at(-1),['seek',1]);p.stop();});
test('rapid clicks serialize seeks; stale time events cannot stop or play a different sentence',()=>{const {p,tap,calls}=setup();tap();p.loaded();tap('9007199254740995');assert.equal(calls.filter(c=>c[0]==='seek').length,1);p.timeUpdate({detail:{currentTime:20}});assert.equal(p.data.state,'loading');p.seekComplete();assert.deepEqual(calls.at(-1),['seek',5]);assert.ok(!calls.some(c=>c[0]==='play'));p.seekComplete();assert.equal(p.data._target.id,'9007199254740995');p.stop();});
test('cancel and page hide prevent late seek-complete from restarting playback',()=>{for(const hide of [false,true]){const {p,tap,calls,def}=setup();tap();p.loaded();if(hide)def.pageLifetimes.hide.call(p);else p.pause();p.seekComplete();p.playing();assert.ok(!calls.some(c=>c[0]==='play'));assert.equal(p.data._target,null);}});
test('timeout exposes error, and retry reloads before seeking',()=>{const {p,tap,timers}=setup();tap();[...timers.values()][0]();assert.equal(p.data.state,'error');assert.ok(p.data.playError);p.retryVideo();assert.equal(p.data.state,'loading');assert.equal(p.data.playError,'');p.loaded();p.seekComplete();assert.ok(p.data._target);p.stop();});
test('whole playback highlights current sentence but respects manual scrolling',()=>{const {p}=setup();p.playWhole();p.loaded();p.seekComplete();p.timeUpdate({detail:{currentTime:1.4}});assert.equal(p.data.scrollTarget,'video-s-9007199254740993');p.manualScroll();p.timeUpdate({detail:{currentTime:5.4}});assert.equal(p.data.activeId,'9007199254740995');assert.equal(p.data.scrollTarget,'video-s-9007199254740993');p.returnToCurrent();assert.equal(p.data.scrollTarget,'video-s-9007199254740995');p.stop();});
test('mismatched video version cannot be played',()=>{const {p,tap,calls}=setup();p.data.sentences[0].videoClip.version='b';tap();assert.equal(p.data.src,'');assert.equal(calls.length,0);});
