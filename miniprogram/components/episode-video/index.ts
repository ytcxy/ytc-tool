import { Episode, Sentence, Status } from '../../types';
import { videoUrl } from '../../utils/request';
type Target={id:string;startMs:number;endMs:number};
Component({
 options:{styleIsolation:'apply-shared',pureDataPattern:/^_/},
 properties:{
  episode:{type:Object,value:{} as Episode},sentences:{type:Array,value:[] as Sentence[]},
  onlyUnmastered:Boolean,allRevealed:Boolean,loggedIn:Boolean,completed:Boolean,saving:Boolean,
  savingSentenceId:String,saveError:String,progressError:String,lastSentenceId:String,mastered:Number,
 },
 data:{src:'',state:'idle',activeId:'',mode:'clip',scrollTarget:'',follow:true,playError:'',timeLabel:'00:00',durationLabel:'00:00',
 _context:null as WechatMiniprogram.VideoContext|null,_ready:false,_visible:true,
 _target:null as Target|null,_seeking:null as Target|null,_queued:null as Target|null,
 _timer:0 as ReturnType<typeof setTimeout>|0,_lastTime:0},
 lifetimes:{attached(){this.data._context=wx.createVideoContext('lesson-video',this);},detached(){this.stop();this.data._context=null;}},
 pageLifetimes:{hide(){this.data._visible=false;this.stop();},show(){this.data._visible=true;}},
 observers:{'episode.video.url':function(){this.stop();this.data._seeking=null;this.data._ready=false;this.setData({src:'',activeId:'',state:'idle',playError:'',durationLabel:this.clock(this.data.episode?.video?.durationMs||0)});}},
 methods:{
  clock(ms:number){const seconds=Math.floor(ms/1000);return `${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;},
  clearTimer(){if(this.data._timer)clearTimeout(this.data._timer);this.data._timer=0;},
  armTimeout(){this.clearTimer();this.data._timer=setTimeout(()=>this.fail('视频加载或定位超时，请重试'),15000);},
  stop(){this.clearTimer();this.data._target=null;this.data._queued=null;this.data._context?.pause();if(this.data.state==='playing'||this.data.state==='loading')this.setData({state:'paused'});},
  fail(message='视频播放失败，请检查网络后重试'){this.stop();this.setData({state:'error',playError:message});},
  playSentence(event:WechatMiniprogram.BaseEvent){
   const id=event.currentTarget.dataset.id as string;
   if(this.data.mode==='clip'&&id===this.data.activeId&&(this.data.state==='playing'||this.data.state==='loading')){this.stop();return;}
   const s=this.data.sentences.find((s:Sentence)=>s.id===id),clip=s?.videoClip,video=this.data.episode?.video;
   if(!clip||!video||clip.version!==video.version)return;
   this.setData({mode:'clip',activeId:id});this.start({id,startMs:clip.startMs,endMs:clip.endMs});this.triggerEvent('position',{id});
  },
  playWhole(){this.setData({mode:'whole',activeId:''});const video=this.data.episode?.video;if(video)this.start({id:'',startMs:0,endMs:video.durationMs});},
  pause(){this.stop();},
  retryVideo(){
   const target=this.data.mode==='whole'?{id:'',startMs:0,endMs:this.data.episode?.video?.durationMs||0}:this.sentenceTarget(this.data.activeId);
   if(!target)return;this.data._seeking=null;this.data._ready=false;this.setData({src:''},()=>this.start(target));
  },
  sentenceTarget(id:string):Target|null{const s=this.data.sentences.find((s:Sentence)=>s.id===id);return s?.videoClip?{id,startMs:s.videoClip.startMs,endMs:s.videoClip.endMs}:null;},
  start(target:Target){
   if(!this.data._visible)return;
   const src=videoUrl(this.data.episode?.video?.url||'');if(!src){this.fail('视频地址不可用');return;}
   this.triggerEvent('videostart');this.data._queued=target;this.setData({state:'loading',playError:''});this.armTimeout();
   if(!this.data.src){this.setData({src});return;}
   this.seekLatest();
  },
  loaded(){this.data._ready=true;this.seekLatest();},
  seekLatest(){
   if(!this.data._visible||!this.data._ready||this.data._seeking||!this.data._queued)return;
   const target=this.data._queued;this.data._queued=null;this.data._seeking=target;this.data._target=null;
   this.data._context?.pause();this.data._context?.seek(target.startMs/1000);
  },
  seekComplete(){
   if(!this.data._seeking)return;
   const target=this.data._seeking;this.data._seeking=null;
   if(!this.data._visible)return;
   // Native seek events have no request ID. Serialize seeks, then play only the latest click.
   if(this.data._queued){this.seekLatest();return;}
   if(this.data.state!=='loading')return;
   this.data._target=target;this.data._lastTime=target.startMs;this.data._context?.play();
  },
  playing(){if(!this.data._target||!this.data._visible){this.data._context?.pause();return;}this.armTimeout();this.setData({state:'playing'});},
  waiting(){if(!this.data._target&&!this.data._seeking)return;this.setData({state:'loading'});this.armTimeout();},
  playbackError(){this.fail();},
  ended(){if(this.data._seeking||this.data._queued)return;this.stop();this.setData({state:'ended'});},
  timeUpdate(event:WechatMiniprogram.CustomEvent<{currentTime:number}>){
   const target=this.data._target,ms=event.detail.currentTime*1000;
   if(!target||this.data._seeking||this.data._queued||!Number.isFinite(ms)||ms<target.startMs-150)return;
   this.data._lastTime=ms;this.armTimeout();
   if(ms>=target.endMs){this.stop();this.setData({state:'ended',timeLabel:this.clock(target.endMs)});return;}
   const updates:Record<string,unknown>={};const label=this.clock(ms);if(label!==this.data.timeLabel)updates.timeLabel=label;
   if(this.data.state!=='playing')updates.state='playing';
   if(this.data.mode==='whole'){
    const sentence=this.data.sentences.find((s:Sentence)=>s.videoClip&&s.videoClip.version===this.data.episode?.video?.version&&ms>=s.videoClip.startMs&&ms<s.videoClip.endMs);
    const id=sentence?.id||'';
    if(id!==this.data.activeId){updates.activeId=id;if(id){this.triggerEvent('position',{id});if(this.data.follow&&(!this.data.onlyUnmastered||sentence?.status!=='mastered'))updates.scrollTarget='video-s-'+id;}}
   }
   if(Object.keys(updates).length)this.setData(updates);
  },
  manualScroll(){if(this.data.follow)this.setData({follow:false});},
  bringToSentence(id:string){this.setData({scrollTarget:''},()=>this.setData({scrollTarget:'video-s-'+id,follow:true}));},
  returnToCurrent(){if(!this.data.activeId)return;this.triggerEvent('showall');this.bringToSentence(this.data.activeId);},
  reveal(event:WechatMiniprogram.BaseEvent){this.triggerEvent('reveal',{id:event.currentTarget.dataset.id});},
  revealAll(){this.triggerEvent('revealall');},
  filter(){this.stop();this.triggerEvent('filter');},
  chooseStatus(event:WechatMiniprogram.BaseEvent){
   if(this.data.saving||this.data.saveError||this.data.progressError)return;
   const id=event.currentTarget.dataset.id as string;
   wx.showActionSheet({itemList:['未练习','还不熟','已掌握'],success:({tapIndex})=>{const status=(['unseen','learning','mastered'] as Status[])[tapIndex];if(status)this.triggerEvent('mark',{id,status});}});
  },
  resume(){this.triggerEvent('resume');},login(){this.triggerEvent('login');},complete(){this.triggerEvent('complete');},
  retrySave(){this.triggerEvent('retrysave');},reloadProgress(){this.triggerEvent('reload');},
 },
});
