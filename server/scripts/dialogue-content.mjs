import { validateContent } from './shared.mjs';

// Paragraph numbers refer to top-level Word paragraphs, counted from 1.
export function assembleDialogues(original, completions) {
 const base = validateContent(original);
 const fail = message => { throw new Error('Dialogue source mismatch: ' + message); };
 if (completions.sourceCounts?.episodes !== base.episodes.length || completions.episodes?.length !== base.episodes.length) fail('episodes');
 const seenParagraphs = new Set();
 let originals = 0, generated = 0;
 const claimParagraph = value => {
  if (!Number.isSafeInteger(value) || value < 1 || seenParagraphs.has(value)) fail('duplicate or invalid paragraph');
  seenParagraphs.add(value);
 };
 const episodes = base.episodes.map((episode, index) => {
  const source = completions.episodes[index];
  if (source.sourceKey !== episode.sourceKey || source.sequence !== episode.sequence) fail('episode identity');
  if (source.originalParagraphs.length !== episode.sentences.length) fail('original paragraph count');
  const existingKeys = new Set(episode.sentences.map(s => s.sourceKey));
  const entries = episode.sentences.map((sentence, i) => {
   const originalSource = source.originalParagraphs[i];
   if (originalSource.sourceKey !== sentence.sourceKey || originalSource.paragraphs.length !== 2) fail('original identity');
   originalSource.paragraphs.forEach(claimParagraph);
   if (originalSource.paragraphs[0] >= originalSource.paragraphs[1]) fail('original paragraph order');
   originals++;
   return { paragraph: originalSource.paragraphs[0], end: originalSource.paragraphs[1], sentence: { ...sentence, speaker: 0 } };
  });
  let previousMarker = 0;
  for (const reply of source.replies) {
   claimParagraph(reply.sourceParagraph);
   if (reply.sourceParagraph <= previousMarker) fail('AI marker order');
   previousMarker = reply.sourceParagraph;
   if (existingKeys.has(reply.sourceKey) || !reply.sourceKey.startsWith(episode.sourceKey + '-ai')) fail('AI sourceKey');
   existingKeys.add(reply.sourceKey);
   if (entries.some(entry => entry.paragraph < reply.sourceParagraph && entry.end >= reply.sourceParagraph)) fail('marker inside bilingual pair');
   const previous = entries.filter(entry => entry.end < reply.sourceParagraph).at(-1);
   if ((previous?.sentence.sourceKey ?? null) !== reply.afterSourceKey) fail('AI position');
   generated++;
  }
  for (const reply of source.replies) {
   const previous = episode.sentences.find(s => s.sourceKey === reply.afterSourceKey);
   entries.push({ paragraph: reply.sourceParagraph, end: reply.sourceParagraph, sentence: {
    sourceKey: reply.sourceKey, zh: reply.zh, en: reply.en,
    context: previous?.context ?? episode.sentences[0].context, speaker: 1,
   } });
  }
  entries.sort((a, b) => a.paragraph - b.paragraph);
  return { ...episode, sentences: entries.map((entry, i) => ({ ...entry.sentence, sequence: i + 1 })) };
 });
 if (originals !== completions.sourceCounts.originalSentences || generated !== completions.sourceCounts.aiMarkers || originals + generated !== completions.sourceCounts.expectedSentencesAfterCompletion) fail('totals');
 return validateContent({ ...base, episodes });
}

export function renderDialogues(data) {
 const lines = ['# 200 集完整对话校对稿', '',
  '共 200 集：原有 1,589 条 + AI 补写 1,541 条 = 3,130 条双语台词。', '',
  '“你”为原文台词；“AI”为根据空标记和上下文补写的学习参考，不是原视频转录。保留原文措辞不等于核实其中的事实。', '',
  '原始标识、段落位置和补写文本见 `server/content/source/daily-200-completions.json`。图片场景以文字提示保留。', ''];
 for (const episode of data.episodes) {
  lines.push(`## 第 ${episode.sequence} 集 · ${episode.title}`, '');
  let lastContext = '';
  for (const sentence of episode.sentences) {
   if (sentence.context && sentence.context !== lastContext) lines.push(`> ${sentence.context}`, '');
   lastContext = sentence.context;
   lines.push(`**${sentence.sequence}. ${sentence.speaker === 1 ? 'AI' : '你'}** ${sentence.zh}`, '', sentence.en, '');
  }
 }
 return lines.join('\n') + '\n';
}
