import 'reflect-metadata';
import { resolve } from 'node:path';
import { VideoLibrary,readVideoManifest } from '../src/video/video.service';
// CLI modules share the existing mysql2 connection and explicit production guard.
// @ts-ignore Existing CLI implementation is JavaScript.
import { connect,parseOptions,report,serverRoot } from './shared.mjs';
// @ts-ignore Existing CLI implementation is JavaScript.
import { syncVideo } from './video-import.mjs';
async function main(){
 const {args,database}=parseOptions(process.argv.slice(2),['--apply','--accept-changes']);
 const root=process.env.VIDEO_DIR||resolve(serverRoot,'video');
 const manifest=readVideoManifest(root),library=new VideoLibrary(root);
 const verify=()=>{for(const entry of manifest.entries)if(!library.find(entry))throw Error('Install and verify all video files before importing');};
 verify();const db=await connect(database);
 try{await syncVideo(db,manifest.entries,{apply:args.has('--apply'),acceptChanges:args.has('--accept-changes'),verify,onPlan:(plan:unknown)=>console.log(JSON.stringify({mode:args.has('--apply')?'apply':'dry-run',plan},null,2))});}
 finally{await db.end();}
}
main().catch(report);
