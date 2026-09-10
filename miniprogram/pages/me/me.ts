import { request,getToken,clearSession,errorMessage,avatarUrl } from '../../utils/request';
import { Profile,Summary } from '../../types';
Page({
 data:{loggedIn:false,loading:false,loggingIn:false,error:'',profile:null as Profile|null,summary:null as Summary|null},
 onShow(){this.load();},
 async load(){const loggedIn=!!getToken();this.setData({loggedIn,error:'',profile:null,summary:null});if(!loggedIn)return;this.setData({loading:true});try{const [profile,summary]=await Promise.all([request<Profile>('/me'),request<Summary>('/me/summary')]);this.setData({profile:{...profile,avatarUrl:avatarUrl(profile.avatarPath)},summary});}catch(e){this.setData({error:errorMessage(e),loggedIn:!!getToken()});}finally{this.setData({loading:false});}},
 async login(){if(this.data.loggingIn)return;this.setData({loggingIn:true,error:''});try{const code=await new Promise<string>((resolve,reject)=>wx.login({success:r=>r.code?resolve(r.code):reject(new Error('未获取到微信登录凭证')),fail:()=>reject(new Error('微信登录失败，请重试'))}));const result=await request<{token:string}>('/auth/wechat','POST',{code});wx.setStorageSync('sessionToken',result.token);await this.load();}catch(e){this.setData({error:errorMessage(e)});}finally{this.setData({loggingIn:false});}},
 edit(){wx.navigateTo({url:'/pages/profile/profile'});},
 review(){wx.navigateTo({url:'/pages/review/review'});},
 open(event:WechatMiniprogram.BaseEvent){wx.navigateTo({url:'/pages/episode/episode?id='+event.currentTarget.dataset.id});},
 logout(){wx.showModal({title:'退出登录？',content:'已经同步的学习记录会保留，下次登录可继续。',success:async r=>{if(!r.confirm)return;this.setData({loading:true});try{await request('/auth/logout','POST',{});clearSession();await this.load();}catch(e){this.setData({error:errorMessage(e)});}finally{this.setData({loading:false});}}});}
});
