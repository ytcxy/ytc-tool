import { API_BASE_URL } from '../config';
export class ApiError extends Error {constructor(message:string,public status=0){super(message);}}
export const getToken=():string=>wx.getStorageSync('sessionToken')||'';
export function clearSession(){wx.removeStorageSync('sessionToken');}
export function request<T>(path:string,method:'GET'|'POST'|'PUT'='GET',data?:Record<string,unknown>):Promise<T>{
 const token=getToken();
 return new Promise((resolve,reject)=>{
  wx.request({url:API_BASE_URL+path,method,data,timeout:12000,header:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},
   success(response){
    if(response.statusCode>=200&&response.statusCode<300){resolve(response.data as T);return;}
    if(response.statusCode===401&&getToken()===token)clearSession();
    const body=response.data as {message?:string};
    reject(new ApiError(body?.message||'请求失败，请重试',response.statusCode));
   },fail(){reject(new ApiError('网络连接失败，请检查网络后重试'));}
  });
 });
}
export const errorMessage=(error:unknown)=>error instanceof Error?error.message:'操作失败，请重试';
export function requireLogin():boolean{
 if(getToken())return true;
 wx.showModal({title:'登录后保存学习进度',content:'可以继续浏览内容。登录后可同步掌握状态和学习位置。',confirmText:'去登录',success:r=>{if(r.confirm)wx.switchTab({url:'/pages/me/me'});}});return false;
}
export const audioUrl=(path:string)=>/^\/sentences\/[1-9][0-9]*\/audio\?version=[a-f0-9]{64}$/.test(path)?API_BASE_URL+path:'';
export const avatarUrl=(path:string|null)=>path?API_BASE_URL+path:'';
export function uploadAvatar(filePath:string):Promise<{avatarPath:string|null}>{
 const token=getToken();
 return new Promise((resolve,reject)=>wx.uploadFile({url:API_BASE_URL+'/me/avatar',filePath,name:'file',header:{Authorization:`Bearer ${token}`},timeout:15000,
  success(res){
   let data:{avatarPath:string|null;message?:string};try{data=JSON.parse(res.data);}catch{reject(new ApiError('头像上传响应异常'));return;}
   if(res.statusCode>=200&&res.statusCode<300)resolve(data);
   else{if(res.statusCode===401&&getToken()===token)clearSession();reject(new ApiError(data.message||'头像上传失败',res.statusCode));}
  },fail(){reject(new ApiError('头像上传失败，请重试'));}
 }));
}

export const videoUrl=(path:string)=>/^\/episodes\/[1-9][0-9]*\/video\?version=[a-f0-9]{64}$/.test(path)?API_BASE_URL+path:'';
