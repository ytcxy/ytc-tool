import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateContent } from '../scripts/shared.mjs';
test('all 93 character names follow source attribution and recorded corrections without altering dialogue', async () => {
 const read = async path => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));
 const data = validateContent(await read('../content/forced-english-system.json'));
 const source = await read('../content/source/forced-english-system-screenshots.json');
 assert.equal(data.episodes.flatMap(e => e.sentences).length, 93);
 for (const episode of data.episodes) {
  const audit = source.episodes.find(e => e.episodeSourceKey === episode.sourceKey);
  for (const sentence of episode.sentences) {
   const original = audit.sentences.find(s => s.sourceKey === sentence.sourceKey);
   assert.equal(sentence.speakerName, (original.editedSpeaker ?? original.originalSpeaker).replace(' & ', '、'));
   assert.equal(sentence.en, original.originalEn);
   assert.equal(sentence.context, '');
  }
 }
 assert.equal(data.episodes[0].sentences[11].speakerName, '丹尼');
 assert.equal(data.episodes[4].sentences[16].speakerName, '奥利、丹尼');
});
