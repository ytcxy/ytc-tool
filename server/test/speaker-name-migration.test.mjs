import { test } from 'node:test';
import assert from 'node:assert/strict';
import { migrateSpeakerName } from '../scripts/sentence-speaker-name.mjs';

function fixture({ table = true, column = null, busy = false, fail = false } = {}) {
 const calls = [];
 const run = async sql => {
  calls.push(sql);
  if (sql.includes('GET_LOCK')) return [[{ acquired: busy ? 0 : 1 }]];
  if (sql.includes('RELEASE_LOCK')) return [[{ released: 1 }]];
  if (sql.includes('information_schema.tables')) return [table ? [{}] : []];
  if (sql.includes('information_schema.columns')) return [column ? [column] : []];
  assert.match(sql, /ALTER TABLE el_sentences ADD COLUMN speaker_name VARCHAR\(80\) NOT NULL DEFAULT ''/);
  assert.doesNotMatch(sql, /DROP|DELETE|REPLACE|UPDATE|INSERT|el_.*_progress/i);
  if (fail) throw new Error('DDL failed');
  column = { columnType: 'varchar(80)', nullable: 'NO', defaultValue: '' };
  return [{}];
 };
 return { db: { query: run, execute: run }, calls };
}
test('speaker-name migration plan is read-only and apply is additive and repeatable', async () => {
 const f = fixture();
 assert.equal((await migrateSpeakerName(f.db)).addSpeakerName, true);
 assert.ok(f.calls.every(sql => sql.startsWith('SELECT') && !sql.includes('GET_LOCK')));
 await migrateSpeakerName(f.db, { apply: true });
 assert.equal((await migrateSpeakerName(f.db, { apply: true })).addSpeakerName, false);
 assert.equal(f.calls.filter(sql => sql.includes('ALTER TABLE')).length, 1);
});
test('speaker-name migration refuses absent tables and incompatible columns without DDL', async () => {
 for (const options of [
  { table: false },
  { column: { columnType: 'int unsigned', nullable: 'NO', defaultValue: '' } },
  { column: { columnType: 'varchar(80)', nullable: 'YES', defaultValue: '' } },
  { column: { columnType: 'varchar(80)', nullable: 'NO', defaultValue: '1' } },
 ]) {
  const f = fixture(options);
  await assert.rejects(migrateSpeakerName(f.db, { apply: true }), /Initialize|differs/);
  assert.ok(!f.calls.some(sql => sql.includes('ALTER TABLE')));
  assert.match(f.calls.at(-1), /RELEASE_LOCK/);
 }
});
test('concurrent speaker-name migrations stop and DDL failures release the lock', async () => {
 const busy = fixture({ busy: true });
 await assert.rejects(migrateSpeakerName(busy.db, { apply: true }), /Another/);
 assert.equal(busy.calls.length, 1);
 const failed = fixture({ fail: true });
 await assert.rejects(migrateSpeakerName(failed.db, { apply: true }), /DDL failed/);
 assert.match(failed.calls.at(-1), /RELEASE_LOCK/);
});
