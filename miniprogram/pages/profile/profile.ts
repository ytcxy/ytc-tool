import { request,uploadAvatar,avatarUrl,errorMessage,getToken } from '../../utils/request';
import { syncTheme,themeState } from '../../utils/theme';
import { Profile } from '../../types';
Page({
 data:{...themeState(),nickname:'',avatar:'',loading:true,saving:false,error:'',uploading:false},
 onLoad(){syncTheme(this);this.load();},
 async load(){if(!getToken()){wx.switchTab({url:'/pages/me/me'});return;}this.setData({loading:true,error:''});try{const p=await request<Profile>('/me');this.setData({nickname:p.nickname,avatar:avatarUrl(p.avatarPath)});}catch(e){this.setData({error:errorMessage(e)});}finally{this.setData({loading:false});}},
 async choose(event:WechatMiniprogram.CustomEvent<{avatarUrl:string}>){if(this.data.uploading)return;this.setData({uploading:true,error:''});try{const result=await uploadAvatar(event.detail.avatarUrl);this.setData({avatar:avatarUrl(result.avatarPath)});wx.showToast({title:'头像已保存'});}catch(e){this.setData({error:errorMessage(e)});}finally{this.setData({uploading:false});}},
 input(event:WechatMiniprogram.Input){this.setData({nickname:event.detail.value});},
 async save(event:WechatMiniprogram.CustomEvent<{value:{nickname:string}}>){if(this.data.saving||this.data.uploading)return;const nickname=(event.detail.value.nickname||this.data.nickname).trim();if(!nickname||nickname.length>32){this.setData({error:'请输入 1–32 个字符的昵称'});return;}this.setData({saving:true,error:''});try{await request('/me','PUT',{nickname});wx.showToast({title:'资料已保存'});wx.navigateBack();}catch(e){this.setData({error:errorMessage(e)});}finally{this.setData({saving:false});}}
});
