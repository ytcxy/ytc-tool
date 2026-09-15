import { request,errorMessage,getToken } from '../../utils/request';
import { syncTheme,themeState } from '../../utils/theme';
import { Sentence } from '../../types';
Page({
 data:{...themeState(),items:[] as Sentence[],loading:false,error:'',total:0,page:1},
 onShow(){syncTheme(this);if(!getToken()){wx.switchTab({url:'/pages/me/me'});return;}this.load();},
 async load(){this.setData({loading:true,error:''});try{const result=await request<{items:Sentence[];total:number}>('/me/review?limit=20');this.setData({items:result.items.map(s=>({...s,revealed:false})),total:result.total,page:1});}catch(e){this.setData({error:errorMessage(e)});}finally{this.setData({loading:false});}},
 async more(){if(this.data.loading)return;this.setData({loading:true,error:''});try{const page=this.data.page+1;const result=await request<{items:Sentence[];total:number}>(`/me/review?limit=20&page=${page}`);this.setData({items:[...this.data.items,...result.items.map(s=>({...s,revealed:false}))],total:result.total,page});}catch(e){this.setData({error:errorMessage(e)});}finally{this.setData({loading:false});}},
 toggle(event:WechatMiniprogram.BaseEvent){const id=event.currentTarget.dataset.id;this.setData({items:this.data.items.map(s=>s.id===id?{...s,revealed:!s.revealed}:s)});},
 open(event:WechatMiniprogram.BaseEvent){wx.navigateTo({url:'/pages/episode/episode?id='+event.currentTarget.dataset.id});}
});
