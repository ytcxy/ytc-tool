import { connect, content, report } from './shared.mjs';
import { readSnapshot, buildPlan, applyContent } from './import-content.mjs';
let db;
try {
 const args = new Set(process.argv.slice(2));
 for (const arg of args) if (!['--validate', '--apply', '--accept-changes'].includes(arg)) throw new Error('Unknown option: ' + arg);
 if (args.has('--validate') && args.size > 1) throw new Error('--validate cannot be combined with write options');
 if (args.has('--accept-changes') && !args.has('--apply')) throw new Error('--accept-changes requires --apply');
 const data = await content();
 if (args.has('--validate')) {
  console.log(JSON.stringify({ valid: true, episodes: data.episodes.length, sentences: data.episodes.reduce((n, e) => n + e.sentences.length, 0) }));
 } else {
  db = await connect();
  if (args.has('--apply')) {
   await applyContent(db, data, { acceptChanges: args.has('--accept-changes'),
    onPlan: plan => console.log(JSON.stringify({ mode: 'apply', ...plan }, null, 2)) });
   console.log('Import complete. Numeric IDs and existing progress preserved.');
  } else console.log(JSON.stringify({ mode: 'dry-run', ...buildPlan(data, await readSnapshot(db, data.sourceKey)) }, null, 2));
 }
} catch (error) { report(error); }
finally { if (db) await db.end(); }
