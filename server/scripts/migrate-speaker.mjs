import { connect, report, parseOptions } from './shared.mjs';
import { migrateSpeaker } from './sentence-speaker.mjs';
let db;
try {
 const { args, database } = parseOptions(process.argv.slice(2), ['--apply']);
 db = await connect(database);
 await migrateSpeaker(db, { apply: args.has('--apply'), onPlan: plan => console.log(JSON.stringify(plan)) });
} catch (error) { report(error); } finally { if (db) await db.end(); }
