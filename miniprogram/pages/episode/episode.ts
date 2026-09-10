import { request,getToken,requireLogin,errorMessage } from '../../utils/request';
import { Sentence,Episode,EpisodeProgress,Status } from '../../types';
Page({
 data:{id:'',episode:null as Episode|null,sentences:[] as Sentence[],loading:true,error:'',saveError:'',progressError:'',saving:false,loggedIn:false,mastered:0,visibleCount:0,onlyUnmastered:false,allRevealed:false,completed:false,lastSentenceId:''},
 _session:'',_queue:Promise.resolve() as Promise<void>,_retry:null as (()=>Promise<void>)|null,_position:'',_savedPosition:'',_positionTimer:0 as ReturnType<typeof setTimeout>|0,_observer:null as WechatMiniprogram.IntersectionObserver|null,
 onLoad(query:Record<string,string|undefined>){this.setData({id:query.id||''});},
 async onShow(){await this._queue;if(this._retry&&getToken()===this._session){this.observe();return;}this.load();},
 onHide(){this._observer?.disconnect();if(this._positionTimer)clearTimeout(this._positionTimer);this._positionTimer=0;this.flushPosition();},
 onUnload(){this._observer?.disconnect();if(this._positionTimer)clearTimeout(this._positionTimer);this._positionTimer=0;this.flushPosition();},
 async load(){
  this._observer?.disconnect();this._session=getToken();this._retry=null;
  this.setData({loading:true,error:'',saveError:'',progressError:'',loggedIn:!!this._session,completed:false,lastSentenceId:'',onlyUnmastered:false,allRevealed:false});
  try{
   const [episode,result]=await Promise.all([request<Episode>(`/episodes/${this.data.id}`),request<{items:Sentence[]}>(`/episodes/${this.data.id}/sentences`)]);
   let progress:EpisodeProgress={completed:false,lastSentenceId:null,sentences:[]};
   if(this._session)try{progress=await request<EpisodeProgress>(`/me/episodes/${this.data.id}/progress`);}catch(e){this.setData({progressError:errorMessage(e),loggedIn:!!getToken()});}
   const states=new Map(progress.sentences.map(s=>[s.id,s.status]));
   this.setData({episode,sentences:result.items.map(s=>({...s,status:states.get(s.id)||'unseen',revealed:false})),completed:progress.completed,lastSentenceId:progress.lastSentenceId||''});
   this._savedPosition=progress.lastSentenceId||'';this._position='';this.recount();wx.nextTick(()=>this.observe());
  }catch(e){this.setData({error:errorMessage(e)});}finally{this.setData({loading:false});}
 },
 recount(){const sentences=this.data.sentences;this.setData({mastered:sentences.filter(s=>s.status==='mastered').length,visibleCount:sentences.filter(s=>!this.data.onlyUnmastered||s.status!=='mastered').length,allRevealed:sentences.length>0&&sentences.every(s=>s.revealed)});},
 toggle(event:WechatMiniprogram.BaseEvent){const id=event.currentTarget.dataset.id;this.setData({sentences:this.data.sentences.map(s=>s.id===id?{...s,revealed:!s.revealed}:s)});this.recount();this.recordPosition(id);},
 toggleAll(){const revealed=!this.data.allRevealed;this.setData({sentences:this.data.sentences.map(s=>({...s,revealed}))});this.recount();},
 filter(){this.setData({onlyUnmastered:!this.data.onlyUnmastered});this.recount();wx.nextTick(()=>this.observe());},
 enqueue(job:()=>Promise<void>){
  const token=this._session;
  this._queue=this._queue.then(async()=>{
   if(!token||getToken()!==token||(this._retry&&job!==this._retry))return;
   this.setData({saving:true});
   try{await job();this._retry=null;this.setData({saveError:''});}
   catch(e){this._retry=job;this.setData({saveError:'未同步：'+errorMessage(e),loggedIn:!!getToken()});}
   finally{this.setData({saving:false});}
  });
 },
 retry(){if(this._retry&&requireLogin())this.enqueue(this._retry);},
 mark(event:WechatMiniprogram.BaseEvent){
  if(this.data.saving||this.data.saveError||!requireLogin())return;
  const id=event.currentTarget.dataset.id as string,status=event.currentTarget.dataset.status as Status;
  this.enqueue(async()=>{await request(`/me/sentences/${id}/progress`,'PUT',{status});this.setData({sentences:this.data.sentences.map(s=>s.id===id?{...s,status}:s)});this._savedPosition=id;this.recount();});
 },
 complete(){if(this.data.saving||this.data.saveError||!requireLogin())return;const completed=!this.data.completed;this.enqueue(async()=>{await request(`/me/episodes/${this.data.id}/progress`,'PUT',{completed});this.setData({completed});});},
 resume(){this.setData({onlyUnmastered:false});this.recount();wx.nextTick(()=>wx.pageScrollTo({selector:'#s-'+this.data.lastSentenceId,duration:250,offsetTop:-20}));},
 observe(){
  this._observer?.disconnect();if(!getToken()||this.data.progressError)return;
  this._observer=this.createIntersectionObserver({observeAll:true,thresholds:[0.5]});
  this._observer.relativeToViewport().observe('.sentence',(r)=>{if(r.intersectionRatio>=0.5&&r.dataset.id)this.recordPosition(String(r.dataset.id));});
 },
 recordPosition(id:string){if(!this._session||this.data.saveError||this.data.progressError)return;this._position=id;if(!this._positionTimer)this._positionTimer=setTimeout(()=>{this._positionTimer=0;this.flushPosition();},2000);},
 flushPosition(){const id=this._position;if(!id||id===this._savedPosition||this.data.saveError||this.data.progressError)return;this._position='';this.enqueue(async()=>{await request(`/me/episodes/${this.data.id}/progress`,'PUT',{lastSentenceId:id});this._savedPosition=id;});},
 login(){wx.switchTab({url:'/pages/me/me'});}
});
