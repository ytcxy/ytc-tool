import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AudioLibrary } from '../src/audio/audio.service';
const root=resolve(__dirname,'../audio'),library=new AudioLibrary(root);
const content=JSON.parse(readFileSync(resolve(__dirname,'../content/daily-200.json'),'utf8'));
const episodes=content.episodes.slice(0,50);
const expected=episodes.reduce((n:number,e:any)=>n+e.sentences.length,0);
if(library.size!==expected)throw Error(`Expected ${expected} clips for first 50 episodes, got ${library.size}`);
for(const episode of episodes)for(const sentence of episode.sentences){
 if(!library.match({id:'1',en:sentence.en,collectionKey:content.sourceKey,episodeKey:episode.sourceKey,sentenceKey:sentence.sourceKey}))throw Error('Missing/stale audio: '+sentence.sourceKey);
}
console.log(`Audio validated: 50 episodes, ${library.size} sentences; no database connection.`);
