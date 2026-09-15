import { randomUUID } from 'node:crypto';
import { resolve,join } from 'node:path';
import { existsSync,lstatSync,mkdirSync,copyFileSync,chmodSync,linkSync,unlinkSync,constants } from 'node:fs';
import { connect,parseOptions,report,serverRoot } from './shared.mjs';
import { readManifest,verifyFile } from './audio-manifest.mjs';
import { syncAudio } from './audio-import.mjs';
let db;
try{
 const {args,database}=parseOptions(process.argv.slice(2),['--apply','--accept-changes']);
 const apply=args.has('--apply'),bundle=process.env.AUDIO_BUNDLE||resolve(serverRoot,'audio'),target=process.env.AUDIO_DIR||bundle;
 const manifest=readManifest(bundle,{files:apply});
 db=await connect(database);
 await syncAudio(db,manifest.entries,{apply,acceptChanges:args.has('--accept-changes'),onPlan:p=>console.log(JSON.stringify({mode:apply?'apply':'dry-run',...p},null,2)),install:()=>{
  const files=join(target,'files');mkdirSync(files,{recursive:true,mode:0o755});
  if(!lstatSync(files).isDirectory())throw Error('Invalid audio destination');
  for(const entry of manifest.entries){
   const dest=join(files,entry.file);
   if(existsSync(dest)){verifyFile(dest,entry);continue;}
   const temporary=join(files,'.upload-'+randomUUID());
   try{copyFileSync(join(bundle,'files',entry.file),temporary,constants.COPYFILE_EXCL);chmodSync(temporary,0o644);verifyFile(temporary,entry);linkSync(temporary,dest);}
   finally{if(existsSync(temporary))unlinkSync(temporary);}
  }
 }});
 console.log(apply?'Audio update complete. Sentence IDs and progress unchanged.':'Preview only. No files installed or database writes.');
}catch(error){report(error);}finally{if(db)await db.end();}
