# macOS offline generation; resumes completed episodes after interruption.
from pathlib import Path
import json,hashlib,subprocess,tempfile,wave,struct,os
r=Path(__file__).resolve().parents[2];root=r/'server/audio';data=json.loads((r/'server/content/daily-200.json').read_text());old=json.loads((root/'manifest.json').read_text());cache={ (x['collectionKey'],x['episodeKey'],x['sentenceKey']):x for x in old['entries'] };entries=[]
(root/'files').mkdir(parents=True,exist_ok=True)
checkpoint=root/'generation-checkpoint.json'
if checkpoint.exists():
 for x in json.loads(checkpoint.read_text())['entries']:cache[(x['collectionKey'],x['episodeKey'],x['sentenceKey'])]=x
for episode in data['episodes'][:50]:
 for s in episode['sentences']:
  digest=hashlib.sha256(s['en'].encode()).hexdigest();key=(data['sourceKey'],episode['sourceKey'],s['sourceKey']);entry=cache.get(key)
  if entry and entry['textHash']==digest and (root/'files'/entry['file']).exists() and hashlib.sha256((root/'files'/entry['file']).read_bytes()).hexdigest()==entry['sha256']:entries.append(entry);continue
  with tempfile.TemporaryDirectory(prefix='ytc-voice-') as tmp:
   tmp=Path(tmp);(tmp/'text.txt').write_text(s['en']);subprocess.run(['say','-v','Samantha','-r','145','-f',str(tmp/'text.txt'),'-o',str(tmp/'clip.aiff')],check=True,capture_output=True);subprocess.run(['afconvert','-f','WAVE','-d','LEI16@22050','-c','1',str(tmp/'clip.aiff'),str(tmp/'clip.wav')],check=True,capture_output=True)
   with wave.open(str(tmp/'clip.wav')) as w:
    frames=w.readframes(w.getnframes());duration=w.getnframes()/w.getframerate();assert duration>.2 and any(struct.unpack('<'+'h'*(len(frames)//2),frames))
   audio=(tmp/'clip.wav').read_bytes();sha=hashlib.sha256(audio).hexdigest();(root/'files'/(sha+'.wav')).write_bytes(audio)
   entries.append(dict(collectionKey=key[0],episodeKey=key[1],sentenceKey=key[2],textHash=digest,file=sha+'.wav',sha256=sha,duration=round(duration,3),voice='macOS Samantha',rate=145))
 checkpoint.write_text(json.dumps(dict(version=1,entries=entries),ensure_ascii=False,indent=2)+'\n')
 print('Generated episode',episode['sequence'],'total clips',len(entries),flush=True)
(root/'manifest.json').write_text(json.dumps(dict(version=1,entries=entries),ensure_ascii=False,indent=2)+'\n');checkpoint.unlink(missing_ok=True)
print('COMPLETE',len(entries),'sentences',round(sum(x['duration'] for x in entries)/60,1),'minutes',flush=True)
