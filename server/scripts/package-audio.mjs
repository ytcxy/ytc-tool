import { resolve,join } from 'node:path';
import { mkdirSync,copyFileSync,writeFileSync } from 'node:fs';
import { readManifest } from './audio-manifest.mjs';
const [source,target,mode]=process.argv.slice(2);
if(!source||!target||!['plan','apply'].includes(mode))throw Error('Usage: package-audio.mjs SOURCE NEW_TARGET plan|apply');
const manifest=readManifest(resolve(source));mkdirSync(target,{recursive:false,mode:0o700});
writeFileSync(join(target,'manifest.json'),JSON.stringify(manifest));
// Carry the reviewed SQL with the update, so an older API image can run the fix.
copyFileSync(new URL('../migrations/003_sentence_audio.sql',import.meta.url),join(target,'audio-schema.sql'));
writeFileSync(join(target,'files.txt'),[...new Set(manifest.entries.map(e=>e.file))].join('\n')+'\n');
if(mode==='apply'){mkdirSync(join(target,'files'));for(const e of manifest.entries)copyFileSync(join(source,'files',e.file),join(target,'files',e.file));}
console.log(`Verified ${manifest.entries.length} audio mappings; package mode ${mode}`);
