import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { assembleDialogues } from '../scripts/dialogue-content.mjs';
const read=(name:string)=>JSON.parse(readFileSync(resolve(__dirname,'../content/'+name),'utf8'));
const data=read('daily-200.json');
const original=read('source/daily-200-original.json').manifest;
const completions=read('source/daily-200-completions.json');
test('complete corpus has 200 episodes, all 1589 originals and exactly 1541 AI replies',()=>{
 assert.equal(data.episodes.length,200);
 const sentences=data.episodes.flatMap((e:any)=>e.sentences);
 assert.equal(sentences.length,3130);assert.equal(new Set(sentences.map((s:any)=>s.sourceKey)).size,3130);
 assert.equal(sentences.filter((s:any)=>s.speaker===0).length,1589);
 assert.equal(sentences.filter((s:any)=>s.speaker===1).length,1541);
 assert.ok(sentences.every((s:any)=>s.zh.trim()&&s.en.trim()&&!('raw_zh' in s)&&!('images' in s)&&!('sourceParagraphs' in s)));
 for(const e of data.episodes)assert.deepEqual(e.sentences.map((s:any)=>s.sequence),e.sentences.map((_:any,i:number)=>i+1));
});
test('original text, context and sourceKeys survive completion without replacement',()=>{
 for(const e of original.episodes){
  const completed=data.episodes.find((v:any)=>v.sourceKey===e.sourceKey);
  assert.ok(completed);
  assert.deepEqual(completed.sentences.filter((s:any)=>s.speaker===0).map(({sequence,speaker,...rest}:any)=>rest),e.sentences.map(({sequence,...rest}:any)=>rest));
 }
 assert.deepEqual(assembleDialogues(original,completions),data);
});
test('AI opening and consecutive user lines retain original paragraph positions',()=>{
 for(const n of [15,191])assert.equal(data.episodes[n-1].sentences[0].speaker,1);
 for(const e of completions.episodes){
  const rows=data.episodes[e.sequence-1].sentences;
  const paragraph=new Map<string,number>(e.originalParagraphs.map((s:any)=>[s.sourceKey,s.paragraphs[0]]));
  for(const r of e.replies)paragraph.set(r.sourceKey,r.sourceParagraph);
  assert.deepEqual(rows.map((s:any)=>paragraph.get(s.sourceKey)),[...paragraph.values()].sort((a,b)=>a-b));
 }
 assert.ok(data.episodes.some((e:any)=>e.sentences.some((s:any,i:number)=>i>0&&s.speaker===0&&e.sentences[i-1].speaker===0)));
});
test('source mapping rejects missing replies, wrong anchors and duplicate markers',()=>{
 const missing=structuredClone(completions);missing.episodes[0].replies.pop();
 assert.throws(()=>assembleDialogues(original,missing),/totals/);
 const anchor=structuredClone(completions);anchor.episodes[0].replies[0].afterSourceKey='not-the-original';
 assert.throws(()=>assembleDialogues(original,anchor),/AI position/);
 const duplicate=structuredClone(completions);duplicate.episodes[0].replies[1].sourceParagraph=duplicate.episodes[0].replies[0].sourceParagraph;
 assert.throws(()=>assembleDialogues(original,duplicate),/duplicate/);
});
test('scenario changes are kept at their original sourceKeys',()=>{
 const e=data.episodes.find((e:any)=>e.sequence===3);
 assert.match(e.sentences.find((s:any)=>s.sourceKey==='daily-200-e003-s001').context,/桃子/);
 assert.match(e.sentences.find((s:any)=>s.sourceKey==='daily-200-e003-s005').context,/草莓和西瓜/);
});
test('repeated everyday phrases remain separate cards in their own episodes',()=>{
 const greetings=data.episodes.flatMap((e:any)=>e.sentences).filter((s:any)=>s.speaker===0&&s.zh==='你好'&&s.en==='Hi.');
 assert.equal(greetings.length,3);assert.equal(new Set(greetings.map((s:any)=>s.sourceKey)).size,3);
});
