import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
@Injectable()
export class WechatService {
 constructor(private readonly config:ConfigService) {}
 async exchange(code:string):Promise<{appid:string;openid:string}> {
  const appid=this.config.get<string>('WECHAT_APP_ID');
  const secret=this.config.get<string>('WECHAT_APP_SECRET');
  if(!appid||!secret||appid==='touristappid') throw new ServiceUnavailableException('微信登录尚未配置，请联系管理员');
  let data:{openid?:unknown;errcode?:number};
  try {
   const params=new URLSearchParams({appid,secret,js_code:code,grant_type:'authorization_code'});
   const response=await fetch(`https://api.weixin.qq.com/sns/jscode2session?${params}`,{signal:AbortSignal.timeout(8000)});
   if(!response.ok) throw new Error('WECHAT_HTTP_ERROR');
   data=await response.json() as typeof data;
  } catch {throw new ServiceUnavailableException('微信服务暂时不可用，请重试');}
  if(data.errcode===40029||data.errcode===40163) throw new BadRequestException('登录凭证已失效，请重新登录');
  if(data.errcode||typeof data.openid!=='string'||!data.openid||data.openid.length>128) throw new ServiceUnavailableException('微信登录未成功，请重试或检查配置');
  return {appid,openid:data.openid};
 }
}
