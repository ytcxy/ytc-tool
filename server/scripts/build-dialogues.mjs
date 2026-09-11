import { readFile, writeFile } from 'node:fs/promises';
import { serverRoot, report } from './shared.mjs';
import { assembleDialogues, renderDialogues } from './dialogue-content.mjs';

try {
 const args = process.argv.slice(2);
 if (args.length !== 1 || !['--check', '--write'].includes(args[0])) throw new Error('Use --check or --write; no database connection is made');
 const original = JSON.parse(await readFile(serverRoot + 'content/source/daily-200-original.json', 'utf8'));
 const completions = JSON.parse(await readFile(serverRoot + 'content/source/daily-200-completions.json', 'utf8'));
 const data = assembleDialogues(original.manifest, completions);
 const outputs = [
  [serverRoot + 'content/daily-200.json', JSON.stringify(data, null, 2) + '\n'],
  [serverRoot + '../docs/dialogues-completed.md', renderDialogues(data)],
 ];
 for (const [file, expected] of outputs) {
  if (args[0] === '--write') await writeFile(file, expected);
  else if (await readFile(file, 'utf8') !== expected) throw new Error('Generated content differs: ' + file + '; review sources and run content:build');
 }
 console.log(JSON.stringify({ valid: true, episodes: data.episodes.length, sentences: data.episodes.reduce((sum, e) => sum + e.sentences.length, 0), mode: args[0].slice(2) }));
} catch (error) { report(error); }
