import { readFile } from 'node:fs/promises';

export async function migrateSpeakerName(db, { apply = false, onPlan = () => {} } = {}) {
 let locked = false;
 try {
  if (apply) {
   const [locks] = await db.query("SELECT GET_LOCK(CONCAT(DATABASE(),':sentence-speaker-name'),0) AS acquired");
   if (Number(locks[0]?.acquired) !== 1) throw new Error('Another speaker-name migration is running');
   locked = true;
  }
  const [tables] = await db.execute("SELECT TABLE_NAME FROM information_schema.tables WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='el_sentences'");
  if (!tables.length) throw new Error('Initialize the learning tables first');
  const [rows] = await db.execute("SELECT COLUMN_TYPE AS columnType,IS_NULLABLE AS nullable,COLUMN_DEFAULT AS defaultValue FROM information_schema.columns WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='el_sentences' AND COLUMN_NAME='speaker_name'");
  if (rows.length && (rows[0].columnType.toLowerCase() !== 'varchar(80)' || rows[0].nullable !== 'NO' || rows[0].defaultValue !== '')) throw new Error('Existing speaker_name column differs; review schema manually');
  const plan = { mode: apply ? 'apply' : 'dry-run', addSpeakerName: !rows.length, existingRowsDefaultSpeakerName: '' };
  onPlan(plan);
  if (apply && !rows.length) await db.query(await readFile(new URL('../migrations/004_sentence_speaker_name.sql', import.meta.url), 'utf8'));
  return plan;
 } finally {
  if (locked) await db.query("SELECT RELEASE_LOCK(CONCAT(DATABASE(),':sentence-speaker-name')) AS released");
 }
}
