import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
export function imageConfigId(archive, tag) {
 const manifest=JSON.parse(execFileSync('tar',['-xOf',archive,'manifest.json'],{encoding:'utf8',maxBuffer:4*1024*1024}));
 const entries=manifest.filter(entry=>entry.RepoTags?.includes(tag));
 if(entries.length!==1)throw new Error('Expected exactly one tagged image in archive');
 const path=entries[0].Config;
 if(typeof path!=='string'||! /^(?:blobs\/sha256\/[a-f0-9]{64}|[a-f0-9]{64}\.json)$/.test(path))throw new Error('Invalid image config path');
 const bytes=execFileSync('tar',['-xOf',archive,path],{maxBuffer:16*1024*1024});
 const digest=createHash('sha256').update(bytes).digest('hex');
 const named=path.startsWith('blobs/')?path.split('/').at(-1):path.slice(0,-5);
 if(digest!==named)throw new Error('Image config content does not match its digest');
 return 'sha256:'+digest;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{if(process.argv.length!==4)throw new Error('Usage: image-config-id.mjs ARCHIVE TAG');console.log(imageConfigId(process.argv[2],process.argv[3]));}
 catch(error){console.error(error.message);process.exitCode=1;}
}
