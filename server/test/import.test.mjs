import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateContent } from '../scripts/shared.mjs';
import { buildPlan, readSnapshot, applyContent } from '../scripts/import-content.mjs';

const content = () => ({
 sourceKey: 'daily', title: 'Daily', description: 'Practice', status: 1, sortOrder: 1, sourceUrl: null,
 episodes: [{ sourceKey: 'episode', title: 'One', sequence: 1, status: 1, sourceUrl: null,
  sentences: [{ sourceKey: 'sentence', sequence: 1, zh: '你好', en: 'Hi.', context: '' }] }],
});

// Deliberately returns an unsafe numeric insertId; application code must SELECT string IDs instead.
function memoryDatabase() {
 let state = { collections: [], episodes: [], sentences: [] }, before, next = 9007199254740993n;
 const calls = [];
 let failBulk = false, locked = false;
 const allocate = () => (next++).toString();
 const db = {
  calls,
  get state() { return state; },
  set failBulk(value) { failBulk = value; },
  async beginTransaction() { before = structuredClone(state); },
  async commit() { before = undefined; },
  async rollback() { if (before) state = before; before = undefined; },
  async execute(query, values = []) {
   const sql = query.replace(/\s+/g, ' ').trim(); calls.push({ sql, values });
   if (sql.includes('GET_LOCK')) { if (locked) return [[{ acquired: 0 }]]; locked = true; return [[{ acquired: 1 }]]; }
   if (sql.includes('RELEASE_LOCK')) { locked = false; return [[{ released: 1 }]]; }
   if (sql.startsWith('SELECT') && sql.includes('FROM el_collections')) return [state.collections.filter(c => c.sourceKey === values[0]).map(c => ({ ...c }))];
   if (sql.startsWith('SELECT') && sql.includes('FROM el_episodes')) return [state.episodes.filter(e => e.collectionId === values[0] && (values.length < 2 || e.sourceKey === values[1])).map(e => ({ ...e }))];
   if (sql.startsWith('SELECT') && sql.includes('FROM el_sentences')) {
    if (sql.includes('JOIN el_episodes')) return [state.sentences.flatMap(s => {
     const episode = state.episodes.find(e => e.id === s.episodeId);
     return episode?.collectionId === values[0] ? [{ ...s, episodeSourceKey: episode.sourceKey }] : [];
    })];
    return [state.sentences.filter(s => s.episodeId === values[0]).map(s => ({ ...s }))];
   }
   if (sql.startsWith('INSERT INTO el_collections')) {
    const [sourceKey, title, description, sourceUrl, sortOrder, status] = values;
    const row = state.collections.find(c => c.sourceKey === sourceKey);
    if (row) Object.assign(row, { title, description, sourceUrl, sortOrder, status });
    else state.collections.push({ id: allocate(), sourceKey, title, description, sourceUrl, sortOrder, status, is_del: 0 });
    return [{ insertId: Number(next - 1n) }];
   }
   if (sql.startsWith('INSERT INTO el_episodes')) {
    const [collectionId, sourceKey, title, sequence, sourceUrl, status] = values;
    assert.ok(state.collections.some(c => c.id === collectionId), 'numeric string parent ID must exist');
    const row = state.episodes.find(e => e.collectionId === collectionId && e.sourceKey === sourceKey);
    if (row) Object.assign(row, { title, sequence, sourceUrl, status });
    else state.episodes.push({ id: allocate(), collectionId, sourceKey, title, sequence, sourceUrl, status, is_del: 0 });
    return [{ insertId: Number(next - 1n) }];
   }
   throw new Error('Unexpected test query: ' + sql);
  },
  async query(query, values) {
   assert.match(query, /^INSERT INTO el_sentences/);calls.push({ sql: query, values });
   if (failBulk) throw new Error('simulated write failure');
   for (const [episodeId, sourceKey, sequence, zh, en, context] of values[0]) {
    assert.ok(state.episodes.some(e => e.id === episodeId));
    const row = state.sentences.find(s => s.episodeId === episodeId && s.sourceKey === sourceKey);
    if (row) Object.assign(row, { sequence, zh, en, context });
    else state.sentences.push({ id: allocate(), episodeId, sourceKey, sequence, zh, en, context, is_del: 0 });
   }
   return [{}];
  },
 };
 return db;
}

test('import validation rejects database IDs and duplicates within a parent, but permits local keys in other episodes', () => {
 const data = content();
 assert.throws(() => validateContent({ ...data, id: 'old-id' }), /sourceKey/);
 data.episodes.push({ ...structuredClone(data.episodes[0]), sourceKey: 'second', sequence: 2 });
 assert.equal(validateContent(data).episodes.length, 2);
 data.episodes[0].sentences.push(structuredClone(data.episodes[0].sentences[0]));
 assert.throws(() => validateContent(data), /duplicate/);
});
test('omitted publish status is draft and explicit publication appears in dry-run', () => {
 const data = content();delete data.status;delete data.episodes[0].status;
 const normalized = validateContent(data);
 assert.equal(normalized.status, 0);assert.equal(normalized.episodes[0].status, 0);
 const plan = buildPlan(content(), { collection: null, episodes: [], sentences: [] });
 assert.deepEqual(plan.publication, { collection: 1, publishedEpisodes: 1, draftEpisodes: 0 });
});
test('dry-run queries do not write; repeat imports preserve numeric IDs above 2^53', async () => {
 const db = memoryDatabase(), data = content();
 buildPlan(data, await readSnapshot(db, data.sourceKey));
 assert.ok(db.calls.every(c => c.sql.startsWith('SELECT')));
 await applyContent(db, data);
 const ids = [db.state.collections[0].id, db.state.episodes[0].id, db.state.sentences[0].id];
 assert.deepEqual(ids, ['9007199254740993', '9007199254740994', '9007199254740995']);
 const second = await applyContent(db, data);
 assert.equal(second.sentencesAdded, 0);assert.equal(second.changes.length, 0);
 assert.deepEqual([db.state.collections[0].id, db.state.episodes[0].id, db.state.sentences[0].id], ids);
});
for (const table of ['collections', 'episodes', 'sentences']) test(`import refuses soft-deleted ${table} even with accept-changes`, async () => {
 const db = memoryDatabase(), data = content();await applyContent(db, data);
 db.state[table][0].is_del = 1;db.calls.length = 0;
 await assert.rejects(applyContent(db, data, { acceptChanges: true }), /Soft-deleted/);
 assert.equal(db.state[table][0].is_del, 1);
 assert.ok(!db.calls.some(c => c.sql.startsWith('INSERT') || c.sql.startsWith('UPDATE')));
});
test('metadata and publish-state changes require review, with IDs unchanged on acceptance', async () => {
 const db = memoryDatabase(), data = content();await applyContent(db, data);
 const id = db.state.episodes[0].id;data.episodes[0].status = 0;data.title = 'Revised';
 const plan = buildPlan(data, await readSnapshot(db, data.sourceKey));
 assert.ok(plan.changes.some(c => c.type === 'episode' && c.diff.status));
 await assert.rejects(applyContent(db, data), /accept-changes/);
 await applyContent(db, data, { acceptChanges: true });
 assert.equal(db.state.episodes[0].id, id);assert.equal(db.state.episodes[0].status, 0);
});
test('missing sourceKey cannot silently delete or replace existing content', async () => {
 const db = memoryDatabase(), data = content();await applyContent(db, data);
 data.episodes[0].sentences[0].sourceKey = 'replacement';
 await assert.rejects(applyContent(db, data, { acceptChanges: true }), /Missing sourceKeys/);
 assert.equal(db.state.sentences[0].sourceKey, 'sentence');
});
test('sentence failure rolls back its episode; a later retry can acquire the import lock', async () => {
 const db = memoryDatabase(), data = content();db.failBulk = true;
 await assert.rejects(applyContent(db, data), /simulated/);
 assert.equal(db.state.episodes.length, 0);assert.equal(db.state.sentences.length, 0);
 db.failBulk = false;await applyContent(db, data);assert.equal(db.state.sentences.length, 1);
});
