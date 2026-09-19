import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { connect, content, report, parseOptions, serverRoot, validateContent } from './shared.mjs';
import { readSnapshot, buildPlan, applyContent } from './import-content.mjs';
let db;
try {
 const argv = process.argv.slice(2);
 const files = argv.filter(arg => arg.startsWith('--file='));
 if (files.length > 1 || (files.length === 1 && !files[0].slice(7).trim())) throw new Error('Expected one non-empty --file path');
 const { args, database } = parseOptions(argv.filter(arg => !arg.startsWith('--file=')), ['--validate', '--apply', '--accept-changes']);
 const data = files.length
  ? validateContent(JSON.parse(await readFile(resolve(serverRoot, files[0].slice(7)), 'utf8')))
  : await content();
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
