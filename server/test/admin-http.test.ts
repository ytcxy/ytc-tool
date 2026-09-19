import {test} from 'node:test';
import assert from 'node:assert/strict';
import {adminTestApp} from './helpers/admin-app';
test('same-port admin HTTP flow covers static assets, login, CSRF, mutation and logout with an isolated database',async()=>{
 const {app,url,calls}=await adminTestApp();
 try {
  const page=await fetch(url+'/admin/');assert.equal(page.status,200);assert.match(page.headers.get('content-security-policy')!,/frame-ancestors 'none'/);assert.match(await page.text(),/拾句英语/);
  assert.equal((await fetch(url+'/admin/app.js')).status,200);
  assert.equal((await fetch(url+'/api/admin/content/collections')).status,401);
  const login=(origin:string)=>fetch(url+'/api/admin/auth/login',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify({username:'admin',password:'test-only-password'})});
  assert.equal((await login('https://evil.test')).status,403);
  const response=await login(url);assert.equal(response.status,200);const user=await response.json();assert.equal(user.id,'9007199254740993');assert.ok(!('token' in user));
  const setCookie=response.headers.get('set-cookie')!;assert.match(setCookie,/HttpOnly; SameSite=Strict; Path=\/api\/admin/);const cookie=setCookie.split(';')[0];
  const headers={Cookie:cookie,Origin:url,'Content-Type':'application/json','X-CSRF-Token':user.csrf};
  const list=await fetch(url+'/api/admin/content/collections',{headers});assert.equal(list.status,200);assert.equal(list.headers.get('cache-control'),'no-store');assert.equal((await list.json()).items[0].id,'100');
  const mutation={updatedAt:'2026-09-19 08:00:00.000',zh:'改过的中文',en:'Updated English',sequence:1};
  assert.equal((await fetch(url+'/api/admin/content/sentences/102',{method:'PUT',headers:{...headers,'X-CSRF-Token':'bad'},body:JSON.stringify(mutation)})).status,403);
  const saved=await fetch(url+'/api/admin/content/sentences/102',{method:'PUT',headers,body:JSON.stringify(mutation)});assert.equal(saved.status,200);assert.equal((await saved.json()).zh,'改过的中文');assert.ok(calls.some(c=>c.sql.startsWith('INSERT INTO el_admin_audit_logs')));
  assert.equal((await fetch(url+'/api/admin/content/sentences/102',{method:'PUT',headers,body:JSON.stringify(mutation)})).status,409);
  const batchBody={items:[{id:'100',updatedAt:'2026-09-19 08:00:00.000'}]};
  assert.equal((await fetch(url+'/api/admin/content/collections/batch-publish',{method:'POST',headers:{...headers,'X-CSRF-Token':'bad'},body:JSON.stringify(batchBody)})).status,403);
  const published=await fetch(url+'/api/admin/content/collections/batch-publish',{method:'POST',headers,body:JSON.stringify(batchBody)});
  assert.equal(published.status,201);assert.deepEqual(await published.json(),{published:1,skipped:0});
  const refreshed=await fetch(url+'/api/admin/content/collections',{headers});assert.equal((await refreshed.json()).items[0].status,1);
  assert.equal((await fetch(url+'/api/admin/episodes/import/preview',{method:'POST',headers,body:'{bad json'})).status,400);
  assert.equal((await fetch(url+'/api/admin/episodes/import/preview',{method:'POST',headers,body:JSON.stringify({payload:'x'.repeat(2*1024*1024)})})).status,413);
  const importBody={parentId:'100',episode:{sourceKey:'json-import',title:'导入单集',sequence:2,sentences:[{sourceKey:'line-1',sequence:1,zh:'谢谢',en:'Thank you.'}]}};
  assert.equal((await fetch(url+'/api/admin/episodes/import/preview',{method:'POST',headers:{...headers,'X-CSRF-Token':'bad'},body:JSON.stringify(importBody)})).status,403);
  const previewResponse=await fetch(url+'/api/admin/episodes/import/preview',{method:'POST',headers,body:JSON.stringify(importBody)});assert.equal(previewResponse.status,201);
  const preview=await previewResponse.json();assert.equal(preview.status,0);assert.equal(preview.sentenceCount,1);
  const applyBody={...importBody,previewHash:preview.previewHash};
  const imported=await fetch(url+'/api/admin/episodes/import',{method:'POST',headers,body:JSON.stringify(applyBody)});assert.equal(imported.status,201);assert.equal((await imported.json()).status,0);
  assert.equal((await fetch(url+'/api/admin/episodes/import',{method:'POST',headers,body:JSON.stringify(applyBody)})).status,409);
  assert.equal((await fetch(url+'/api/admin/auth/logout',{method:'POST',headers})).status,200);
  assert.equal((await fetch(url+'/api/admin/auth/me',{headers})).status,401);
 }finally{await app.close();}
});
