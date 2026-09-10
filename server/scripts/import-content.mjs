import { createHash } from 'node:crypto';
import { validateContent } from './shared.mjs';

export async function readSnapshot(db, sourceKey) {
 const [collections] = await db.execute(`SELECT id,source_key AS sourceKey,title,description,source_url AS sourceUrl,
   sort_order AS sortOrder,status,is_del FROM el_collections WHERE source_key=?`, [sourceKey]);
 if (!collections.length) return { collection: null, episodes: [], sentences: [] };
 const collection = collections[0];
 const [episodes] = await db.execute(`SELECT id,collection_id AS collectionId,source_key AS sourceKey,title,sequence,
   source_url AS sourceUrl,status,is_del FROM el_episodes WHERE collection_id=?`, [collection.id]);
 const [sentences] = await db.execute(`SELECT s.id,s.episode_id AS episodeId,e.source_key AS episodeSourceKey,
   s.source_key AS sourceKey,s.sequence,s.zh,s.en,s.context,s.is_del FROM el_sentences s
   JOIN el_episodes e ON e.id=s.episode_id WHERE e.collection_id=?`, [collection.id]);
 return { collection, episodes, sentences };
}

export function buildPlan(input, snapshot) {
 const data = validateContent(input);
 const changes = [], deletedConflicts = [], missing = [];
 const plan = { sourceKey: data.sourceKey, collectionAdded: !snapshot.collection,
  episodesAdded: 0, sentencesAdded: 0, changes, deletedConflicts, missing,
  publication: { collection: data.status, publishedEpisodes: data.episodes.filter(e => e.status === 1).length,
   draftEpisodes: data.episodes.filter(e => e.status === 0).length } };
 const compare = (type, sourceKey, before, after, fields) => {
  if (before.is_del !== 0) { deletedConflicts.push({ type, sourceKey }); return; }
  const diff = {};
  for (const field of fields) if (before[field] !== after[field]) diff[field] = { before: before[field], after: after[field] };
  if (Object.keys(diff).length) changes.push({ type, sourceKey, databaseId: before.id, diff });
 };
 if (snapshot.collection) compare('collection', data.sourceKey, snapshot.collection, data,
  ['title', 'description', 'sourceUrl', 'sortOrder', 'status']);
 const oldEpisodes = new Map(snapshot.episodes.map(e => [e.sourceKey, e]));
 const sentenceKey = (episodeKey, key) => `${episodeKey}/${key}`;
 const oldSentences = new Map(snapshot.sentences.map(s => [sentenceKey(s.episodeSourceKey, s.sourceKey), s]));
 const incomingEpisodes = new Set(), incomingSentences = new Set();
 for (const episode of data.episodes) {
  incomingEpisodes.add(episode.sourceKey);
  const old = oldEpisodes.get(episode.sourceKey);
  if (!old) plan.episodesAdded++;
  else compare('episode', episode.sourceKey, old, episode, ['title', 'sequence', 'sourceUrl', 'status']);
  for (const sentence of episode.sentences) {
   const key = sentenceKey(episode.sourceKey, sentence.sourceKey);
   incomingSentences.add(key);
   const before = oldSentences.get(key);
   if (!before) plan.sentencesAdded++;
   else compare('sentence', key, before, sentence, ['sequence', 'zh', 'en', 'context']);
  }
 }
 for (const e of snapshot.episodes) if (e.is_del === 0 && !incomingEpisodes.has(e.sourceKey)) missing.push({ type: 'episode', sourceKey: e.sourceKey });
 for (const s of snapshot.sentences) {
  const key = sentenceKey(s.episodeSourceKey, s.sourceKey);
  if (s.is_del === 0 && !incomingSentences.has(key)) missing.push({ type: 'sentence', sourceKey: key });
 }
 return plan;
}

const ensureLive = (row) => {
 if (row && row.is_del !== 0) throw new Error('Soft-deleted content requires manual review; it will not be restored');
};
const ensureId = (row) => {
 if (!row || typeof row.id !== 'string' || !/^[1-9]\d*$/.test(row.id)) throw new Error('Expected a BIGINT ID string from MySQL');
 return row.id;
};

export async function applyContent(db, input, { acceptChanges = false, onPlan = () => {} } = {}) {
 const data = validateContent(input);
 const lockName = 'learning-import:' + createHash('sha256').update(data.sourceKey).digest('hex').slice(0, 40);
 const [locks] = await db.execute('SELECT GET_LOCK(?,0) AS acquired', [lockName]);
 if (Number(locks[0]?.acquired) !== 1) throw new Error('Another import of this collection is running');
 try {
  // Refresh under the import lock so a previous dry-run cannot make concurrent changes invisible.
  const plan = buildPlan(data, await readSnapshot(db, data.sourceKey));
  onPlan(plan);
  if (plan.deletedConflicts.length) throw new Error('Soft-deleted content requires manual review; no automatic restore');
  if (plan.missing.length) throw new Error('Missing sourceKeys require manual review; no implicit removals');
  if (plan.changes.length && !acceptChanges) throw new Error('Review changes, then explicitly use --accept-changes');
  let collectionId;
  await db.beginTransaction();
  try {
   const [rows] = await db.execute('SELECT id,is_del FROM el_collections WHERE source_key=? FOR UPDATE', [data.sourceKey]);
   ensureLive(rows[0]);
   await db.execute(`INSERT INTO el_collections(source_key,title,description,source_url,sort_order,status) VALUES(?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE title=?,description=?,source_url=?,sort_order=?,status=?`,
    [data.sourceKey, data.title, data.description, data.sourceUrl, data.sortOrder, data.status,
     data.title, data.description, data.sourceUrl, data.sortOrder, data.status]);
   const [saved] = await db.execute('SELECT id,is_del FROM el_collections WHERE source_key=? FOR UPDATE', [data.sourceKey]);
   ensureLive(saved[0]); collectionId = ensureId(saved[0]);
   await db.commit();
  } catch (error) { await db.rollback(); throw error; }
  for (const episode of data.episodes) {
   await db.beginTransaction();
   try {
    const [parents] = await db.execute('SELECT id,is_del FROM el_collections WHERE source_key=? FOR UPDATE', [data.sourceKey]);
    ensureLive(parents[0]); ensureId(parents[0]);
    const [rows] = await db.execute('SELECT id,is_del FROM el_episodes WHERE collection_id=? AND source_key=? FOR UPDATE', [collectionId, episode.sourceKey]);
    ensureLive(rows[0]);
    await db.execute(`INSERT INTO el_episodes(collection_id,source_key,title,sequence,source_url,status) VALUES(?,?,?,?,?,?)
      ON DUPLICATE KEY UPDATE title=?,sequence=?,source_url=?,status=?`,
     [collectionId, episode.sourceKey, episode.title, episode.sequence, episode.sourceUrl, episode.status,
      episode.title, episode.sequence, episode.sourceUrl, episode.status]);
    const [saved] = await db.execute('SELECT id,is_del FROM el_episodes WHERE collection_id=? AND source_key=? FOR UPDATE', [collectionId, episode.sourceKey]);
    ensureLive(saved[0]); const episodeId = ensureId(saved[0]);
    // Lock all existing child rows/range so a concurrent soft-delete cannot be overwritten.
    const [existing] = await db.execute('SELECT source_key AS sourceKey,is_del FROM el_sentences WHERE episode_id=? FOR UPDATE', [episodeId]);
    const incomingKeys = new Set(episode.sentences.map(s => s.sourceKey));
    for (const row of existing) if (incomingKeys.has(row.sourceKey)) ensureLive(row);
    const values = episode.sentences.map(s => [episodeId, s.sourceKey, s.sequence, s.zh, s.en, s.context]);
    await db.query(`INSERT INTO el_sentences(episode_id,source_key,sequence,zh,en,context) VALUES ?
      ON DUPLICATE KEY UPDATE sequence=VALUES(sequence),zh=VALUES(zh),en=VALUES(en),context=VALUES(context)`, [values]);
    await db.commit();
   } catch (error) { await db.rollback(); throw error; }
  }
  return plan;
 } finally { await db.execute('SELECT RELEASE_LOCK(?) AS released', [lockName]); }
}
