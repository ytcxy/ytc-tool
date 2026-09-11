import { connect, content, report, parseOptions } from './shared.mjs';
import { readSnapshot, buildPlan, applyContent } from './import-content.mjs';
let db;
try {
 const { args, database } = parseOptions(process.argv.slice(2), ['--validate', '--apply', '--accept-changes']);
 const data = await content();
 if (args.has('--validate')) {
  console.log(JSON.stringify({ valid: true, episodes: data.episodes.length, sentences: data.episodes.reduce((n, e) => n + e.sentences.length, 0) }));
 } else {
  db = await connect(database);
  if (args.has('--apply')) {
   await applyContent(db, data, { acceptChanges: args.has('--accept-changes'),
    onPlan: plan => console.log(JSON.stringify({ mode: 'apply', ...plan }, null, 2)) });
   console.log('Import complete. Numeric IDs and existing progress preserved.');
  } else console.log(JSON.stringify({ mode: 'dry-run', ...buildPlan(data, await readSnapshot(db, data.sourceKey)) }, null, 2));
 }
} catch (error) { report(error); }
finally { if (db) await db.end(); }
