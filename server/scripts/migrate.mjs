import { readFile } from 'node:fs/promises';
import { connect, serverRoot, report } from './shared.mjs';
const names=['el_users','el_sessions','el_collections','el_episodes','el_sentences','el_episode_progress','el_sentence_progress'];
let db;
try {
 db=await connect();
 const [rows]=await db.execute('SELECT table_name AS name FROM information_schema.tables WHERE table_schema=DATABASE()');
 const existing=rows.map(r=>r.name).filter(n=>names.includes(n));
 console.log(JSON.stringify({database:'ytc-tool',existing,create:names.filter(n=>!existing.includes(n)),mode:process.argv.includes('--apply')?'apply':'dry-run'}));
 if(process.argv.includes('--apply')) {
  if(existing.length) throw new Error('Learning tables already exist. Refusing automatic schema changes; inspect the current schema first.');
  const sql=await readFile(serverRoot+'migrations/001_learning.sql','utf8');
  for(const statement of sql.split(';').map(s=>s.trim()).filter(Boolean)) await db.query(statement);
  console.log('Created 7 learning tables. MySQL DDL is not transactional; a partial failure needs inspection.');
 }
} catch(e) {report(e);} finally {if(db) await db.end();}
