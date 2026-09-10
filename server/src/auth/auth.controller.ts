import { Body, Controller, HttpCode, HttpException, Post, Req, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthGuard, UserRequest } from './auth.guard';
import { object,string } from '../common/input';
@Controller('auth')
export class AuthController {
 private readonly attempts=new Map<string,{count:number;reset:number}>();
 constructor(private readonly auth:AuthService){}
 @Post('wechat') @HttpCode(200)
 login(@Body() body:unknown,@Req() req:UserRequest) {
  const now=Date.now();const key=req.ip||'unknown';
  for(const [ip,value] of this.attempts) if(value.reset<=now)this.attempts.delete(ip);
  const record=this.attempts.get(key)||{count:0,reset:now+60000};
  if(record.count>=10||(!this.attempts.has(key)&&this.attempts.size>=5000)) throw new HttpException('登录请求过于频繁，请稍后再试',429);
  record.count++;this.attempts.set(key,record);
  return this.auth.login(string(object(body).code,'登录凭证',256));
 }
 @Post('logout') @HttpCode(200) @UseGuards(AuthGuard)
 logout(@Req() req:UserRequest){return this.auth.logout(req.user);}
}
