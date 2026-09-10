import { request,getToken,errorMessage } from '../../utils/request';
import { Episode } from '../../types';
Page({
 data:{id:'',title:'合集目录',description:'',items:[] as Episode[],total:0,page:1,loading:false,error:'',progressError:''},
 _progress:{} as Record<string,string>,
 onLoad(query:Record<string,string|undefined>){this.setData({id:query.id||''});},
 onShow(){this.load();},
 async load(){
  if(this.data.loading)return;this.setData({loading:true,error:'',progressError:''});this._progress={};
  if(getToken())try{const result=await request<{items:{id:string;completedAt:string|null}[]}>(`/me/collections/${this.data.id}/progress`);for(const p of result.items)this._progress[p.id]=p.completedAt?'已完成':'学习中';}catch(e){this.setData({progressError:errorMessage(e)});}
  try{const result=await request<{collection:{title:string;description:string};items:Episode[];total:number}>(`/collections/${this.data.id}/episodes?limit=30`);this.setData({title:result.collection.title,description:result.collection.description,items:result.items.map(e=>({...e,state:this._progress[e.id]||'未开始'})),total:result.total,page:1});}
  catch(e){this.setData({error:errorMessage(e)});}finally{this.setData({loading:false});}
 },
 async more(){if(this.data.loading)return;this.setData({loading:true,error:''});try{const page=this.data.page+1;const result=await request<{items:Episode[];total:number}>(`/collections/${this.data.id}/episodes?limit=30&page=${page}`);this.setData({items:[...this.data.items,...result.items.map(e=>({...e,state:this._progress[e.id]||'未开始'}))],page,total:result.total});}catch(e){this.setData({error:errorMessage(e)});}finally{this.setData({loading:false});}},
 open(event:WechatMiniprogram.BaseEvent){wx.navigateTo({url:'/pages/episode/episode?id='+event.currentTarget.dataset.id});}
});
