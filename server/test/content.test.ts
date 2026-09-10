import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const data=JSON.parse(readFileSync(resolve(__dirname,'../content/daily-200.json'),'utf8'));
test('source corpus preserves 200 episodes and 1589 unique stable sourceKeys',()=>{
 assert.equal(data.episodes.length,200);
 const sentences=data.episodes.flatMap((e:any)=>e.sentences);
 assert.equal(sentences.length,1589);assert.equal(new Set(sentences.map((s:any)=>s.sourceKey)).size,1589);
 assert.ok(sentences.every((s:any)=>s.zh.trim()&&s.en.trim()&&!('raw_zh' in s)&&!('images' in s)));
});
test('scenario changes are kept at their sentence positions',()=>{
 const e=data.episodes.find((e:any)=>e.sequence===3);
 assert.match(e.sentences[0].context,/桃子/);assert.match(e.sentences[4].context,/草莓和西瓜/);
});
test('repeated everyday phrases remain separate cards in their own episodes',()=>{
 const greetings=data.episodes.flatMap((e:any)=>e.sentences).filter((s:any)=>s.zh==='你好'&&s.en==='Hi.');
 assert.equal(greetings.length,3);assert.equal(new Set(greetings.map((s:any)=>s.sourceKey)).size,3);
});
