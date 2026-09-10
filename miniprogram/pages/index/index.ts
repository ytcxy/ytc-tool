import { request,getToken,errorMessage } from '../../utils/request';
import { Collection,Summary,Episode } from '../../types';
Page({
 data:{loading:true,error:'',progressError:'',items:[] as Collection[],recent:null as Episode|null,page:1,total:0},
 onShow(){this.load();},
 async load(){
  this.setData({loading:true,error:'',recent:null,progressError:''});
  try{const result=await request<{items:Collection[];total:number}>('/collections?limit=20');this.setData({items:result.items,total:result.total,page:1});}
  catch(e){this.setData({error:errorMessage(e)});}finally{this.setData({loading:false});}
  if(getToken())try{const result=await request<Summary>('/me/summary');this.setData({recent:result.recent[0]||null});}catch(e){this.setData({progressError:errorMessage(e)});}
 },
 async more(){if(this.data.loading)return;this.setData({loading:true});try{const page=this.data.page+1;const result=await request<{items:Collection[];total:number}>(`/collections?limit=20&page=${page}`);this.setData({items:[...this.data.items,...result.items],page,total:result.total});}catch(e){this.setData({error:errorMessage(e)});}finally{this.setData({loading:false});}},
 open(event:WechatMiniprogram.BaseEvent){wx.navigateTo({url:'/pages/collection/collection?id='+event.currentTarget.dataset.id});},
 resume(){if(this.data.recent)wx.navigateTo({url:'/pages/episode/episode?id='+this.data.recent.id});}
});
