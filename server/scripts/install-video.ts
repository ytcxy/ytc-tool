import 'reflect-metadata';
import { constants, copyFileSync, existsSync, mkdirSync, readFileSync, unlinkSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { VideoLibrary } from '../src/video/video.service';
async function main(){
 const args=process.argv.slice(2);
 if(args.some(a=>a!=='--apply'&&!a.startsWith('--source=')&&!a.startsWith('--directory=')))throw Error('Unknown option');
 if(args.filter(a=>a.startsWith('--source=')).length>1||args.filter(a=>a.startsWith('--directory=')).length>1)throw Error('Duplicate option');
 const root=resolve(process.env.VIDEO_DIR||'video'),sourceArg=args.find(a=>a.startsWith('--source='))?.slice(9),directory=args.find(a=>a.startsWith('--directory='))?.slice(12);
 const target=directory?resolve(directory):root;
 const manifest=readFileSync(join(root,'manifest.json'));
 new VideoLibrary(root); // Validate metadata and any already installed files.
 if(!sourceArg)throw Error('Specify --source=/path/to/episode.mp4');
 const source=resolve(sourceArg),hash=createHash('sha256');for await(const chunk of createReadStream(source))hash.update(chunk);
 const sha256=hash.digest('hex');const entry=JSON.parse(manifest.toString()).entries.find((e:{sha256:string})=>e.sha256===sha256);
 if(!entry)throw Error('Source file hash does not match the configured manifest');
 const file=join(target,'files',entry.file),targetManifest=join(target,'manifest.json');
 if(existsSync(targetManifest)&&!readFileSync(targetManifest).equals(manifest))throw Error('Existing manifest differs; review and version the mapping before replacing it');
 console.log(JSON.stringify({mode:args.includes('--apply')?'apply':'dry-run',source,destination:file,episode:entry.episodeKey,sha256,clips:entry.clips.length,exists:existsSync(file)},null,2));
 if(!args.includes('--apply'))return;
 mkdirSync(join(target,'files'),{recursive:true});
 if(!existsSync(file)){
  const temp=join(target,'files',`.${randomUUID()}.tmp`);
  try{copyFileSync(source,temp,constants.COPYFILE_EXCL);copyFileSync(temp,file,constants.COPYFILE_EXCL);}finally{if(existsSync(temp))unlinkSync(temp);}
 }
 if(!existsSync(targetManifest))copyFileSync(join(root,'manifest.json'),targetManifest,constants.COPYFILE_EXCL);
 const installed=new VideoLibrary(target);
 if(!installed.find(entry))throw Error('Installed video validation failed');
 console.log('Video installed and verified. Run video:plan / video:import to manage database mappings. No database writes were performed.');
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
