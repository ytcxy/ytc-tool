import { request,getToken,requireLogin,errorMessage,audioUrl } from '../../utils/request';
import { syncTheme,themeState } from '../../utils/theme';
import { Sentence,Episode,EpisodeProgress,Status } from '../../types';
Page({
 data:{...themeState(),audioSentenceId:'',audioState:'idle',audioError:'',id:'',episode:null as Episode|null,sentences:[] as Sentence[],loading:true,error:'',saveError:'',progressError:'',saving:false,savingSentenceId:'',loggedIn:false,mastered:0,visibleCount:0,onlyUnmastered:false,allRevealed:false,completed:false,lastSentenceId:''},
 _audio:null as WechatMiniprogram.InnerAudioContext|null,_audioTimer:0 as ReturnType<typeof setTimeout>|0,
 _visible:false,_loadPromise:null as Promise<void>|null,_retrySilent:false,_retrySentenceId:'',_pendingMark:false,
 _session:'',_queue:Promise.resolve() as Promise<void>,_retry:null as (()=>Promise<void>)|null,_position:'',_savedPosition:'',_positionTimer:0 as ReturnType<typeof setTimeout>|0,_observer:null as WechatMiniprogram.IntersectionObserver|null,
 onLoad(query:Record<string,string|undefined>){syncTheme(this);this.setData({id:query.id||''});},
 async onShow(){
  syncTheme(this);this._visible=true;await this._queue;if(this._loadPromise)await this._loadPromise;
  if(!this._visible)return;
  if(this.data.episode&&!this.data.error&&getToken()===this._session){this.observe();return;}
  await this.load();
 },
 onHide(){this.stopAudio();this._visible=false;this._observer?.disconnect();if(this._positionTimer)clearTimeout(this._positionTimer);this._positionTimer=0;this.flushPosition();},
 onUnload(){this.stopAudio();this._visible=false;this._observer?.disconnect();if(this._positionTimer)clearTimeout(this._positionTimer);this._positionTimer=0;this.flushPosition();},
 load():Promise<void>{
  if(this._loadPromise)return this._loadPromise;
  this._loadPromise=this.loadContent().finally(()=>{this._loadPromise=null;});
  return this._loadPromise;
 },
 async loadContent(){
  this.stopAudio();
  this._observer?.disconnect();this._session=getToken();this._retry=null;this._retrySilent=false;
  this.setData({loading:true,error:'',saveError:'',progressError:'',loggedIn:!!this._session,completed:false,lastSentenceId:'',onlyUnmastered:false,allRevealed:false});
  try{
   const [episode,result]=await Promise.all([request<Episode>(`/episodes/${this.data.id}`),request<{items:Sentence[]}>(`/episodes/${this.data.id}/sentences`)]);
   let progress:EpisodeProgress={completed:false,lastSentenceId:null,sentences:[]};
   if(this._session)try{progress=await request<EpisodeProgress>(`/me/episodes/${this.data.id}/progress`);}catch(e){this.setData({progressError:errorMessage(e),loggedIn:!!getToken()});}
   const states=new Map(progress.sentences.map(s=>[s.id,s.status]));
   this.setData({episode,sentences:result.items.map(s=>({...s,status:states.get(s.id)||'unseen',revealed:false})),completed:progress.completed,lastSentenceId:progress.lastSentenceId||''});
   this._savedPosition=progress.lastSentenceId||'';this._position='';this.recount();
  }catch(e){this.setData({error:errorMessage(e)});}finally{this.setData({loading:false},()=>{if(!this.data.error)this.observe();});}
 },
 recount(){const sentences=this.data.sentences;this.setData({mastered:sentences.filter(s=>s.status==='mastered').length,visibleCount:sentences.filter(s=>!this.data.onlyUnmastered||s.status!=='mastered').length,allRevealed:sentences.length>0&&sentences.every(s=>s.revealed)});},
 toggle(event:WechatMiniprogram.BaseEvent){const id=event.currentTarget.dataset.id;const index=this.data.sentences.findIndex(s=>s.id===id);if(index<0)return;this.setData({[`sentences[${index}].revealed`]:!this.data.sentences[index].revealed});this.recount();this.recordPosition(id);},
 toggleAll(){const revealed=!this.data.allRevealed;this.setData({sentences:this.data.sentences.map(s=>({...s,revealed}))});this.recount();},
 filter(){this.stopAudio();this.setData({onlyUnmastered:!this.data.onlyUnmastered});this.recount();wx.nextTick(()=>this.observe());},
 enqueue(job:()=>Promise<void>,silent=false,sentenceId=''){
  const token=this._session;
  this._queue=this._queue.then(async()=>{
   if(!token||getToken()!==token||(this._retry&&job!==this._retry))return;
   if(!silent)this.setData({saving:true,savingSentenceId:sentenceId});
   try{await job();this._retry=null;this._retrySilent=false;if(this.data.saveError)this.setData({saveError:''});}
   catch(e){this._retry=job;this._retrySilent=silent;this._retrySentenceId=sentenceId;this.setData({saveError:'未同步：'+errorMessage(e),loggedIn:!!getToken()});}
   finally{if(!silent)this.setData({saving:false,savingSentenceId:''});}
  });
 },
 retry(){if(this._retry&&requireLogin())this.enqueue(this._retry,this._retrySilent,this._retrySentenceId);},
 mark(event:WechatMiniprogram.BaseEvent){
  if(this._pendingMark||this.data.saving||this.data.saveError||this.data.progressError||!requireLogin())return;
  const id=event.currentTarget.dataset.id as string,requested=event.currentTarget.dataset.status as string;
  const sentence=this.data.sentences.find(s=>s.id===id);
  const status:Status=requested==='toggle-mastered'?(sentence?.status==='mastered'?'unseen':'mastered'):requested as Status;
  if(!sentence||!['unseen','learning','mastered'].includes(status)||sentence.status===status)return;
  this._pendingMark=true;
  this.enqueue(async()=>{
   await request(`/me/sentences/${id}/progress`,'PUT',{status});
   const index=this.data.sentences.findIndex(s=>s.id===id);
   if(index>=0)this.setData({[`sentences[${index}].status`]:status});
   if(this.data.onlyUnmastered&&status==='mastered'&&this.data.audioSentenceId===id)this.stopAudio();
   this._savedPosition=id;this.recount();
  },false,id);
  void this._queue.finally(()=>{this._pendingMark=false;});
 },
 complete(){if(this.data.saving||this.data.saveError||!requireLogin())return;const completed=!this.data.completed;this.enqueue(async()=>{await request(`/me/episodes/${this.data.id}/progress`,'PUT',{completed});this.setData({completed});});},
 resume(){this.setData({onlyUnmastered:false});this.recount();wx.nextTick(()=>wx.pageScrollTo({selector:'#s-'+this.data.lastSentenceId,duration:250,offsetTop:-20}));},
 observe(){
  this._observer?.disconnect();if(!this._visible||this.data.loading||!getToken()||getToken()!==this._session||this.data.progressError)return;
  this._observer=this.createIntersectionObserver({observeAll:true,thresholds:[0.5]});
  this._observer.relativeToViewport().observe('.sentence',(r)=>{if(r.intersectionRatio>=0.5&&r.dataset.id)this.recordPosition(String(r.dataset.id));});
 },
 recordPosition(id:string){if(!this._session||this.data.saveError||this.data.progressError||id===(this._position||this._savedPosition))return;this._position=id;if(!this._positionTimer)this._positionTimer=setTimeout(()=>{this._positionTimer=0;this.flushPosition();},2000);},
 flushPosition(){const id=this._position;if(!id||id===this._savedPosition||this.data.saveError||this.data.progressError)return;this._position='';this.enqueue(async()=>{await request(`/me/episodes/${this.data.id}/progress`,'PUT',{lastSentenceId:id});this._savedPosition=id;},true);},
 stopAudio(){
  const audio=this._audio;this._audio=null;
  if(this._audioTimer)clearTimeout(this._audioTimer);this._audioTimer=0;
  if(audio){audio.stop();audio.destroy();}
  if(this.data.audioSentenceId)this.setData({audioSentenceId:'',audioState:'idle',audioError:''});
 },
 playAudio(event:WechatMiniprogram.BaseEvent){
  const id=event.currentTarget.dataset.id as string;
  if(this.data.audioSentenceId===id&&this.data.audioState!=='error'){this.stopAudio();return;}
  const sentence=this.data.sentences.find(s=>s.id===id);
  if(!sentence?.audioUrl)return;
  const src=audioUrl(sentence.audioUrl);if(!src)return;
  this.stopAudio();this.setData({audioSentenceId:id,audioState:'loading',audioError:''});
  try{
   const audio=wx.createInnerAudioContext();this._audio=audio;
   const current=()=>this._audio===audio;
   const clearTimer=()=>{if(this._audioTimer)clearTimeout(this._audioTimer);this._audioTimer=0;};
   const failed=(result?:WechatMiniprogram.InnerAudioContextOnErrorListenerResult)=>{
    if(!current())return;
    const reason=result?.errCode===10002?'网络错误，请检查网络和音频域名配置':result?.errCode===10003?'音频文件错误':result?.errCode===10004?'音频格式错误':result?.errCode===10001?'系统音频错误':'音频加载超时或播放失败';
    const code=result?.errCode?`（${result.errCode}）`:'';
    this.stopAudio();this.setData({audioSentenceId:id,audioState:'error',audioError:`${reason}${code}，点击喇叭重试`});
   };
   const loading=()=>{if(!current())return;clearTimer();this.setData({audioState:'loading'});this._audioTimer=setTimeout(()=>failed(),15000);};
   audio.onPlay(()=>{if(current()){clearTimer();this.setData({audioState:'playing'});}});
   audio.onTimeUpdate(()=>{if(current()&&audio.currentTime>0){clearTimer();if(this.data.audioState!=='playing')this.setData({audioState:'playing'});}});
   audio.onWaiting(loading);audio.onError(failed);
   audio.onEnded(()=>{if(current())this.stopAudio();});
   audio.onStop(()=>{if(current())this.stopAudio();});
   audio.onPause(()=>{if(current())this.stopAudio();});
   audio.loop=false;audio.autoplay=false;
   loading();audio.src=src;audio.play();
  }catch{this.stopAudio();this.setData({audioSentenceId:id,audioState:'error',audioError:'播放器启动失败，点击喇叭重试'});}
 },
 login(){wx.switchTab({url:'/pages/me/me'});}
});
