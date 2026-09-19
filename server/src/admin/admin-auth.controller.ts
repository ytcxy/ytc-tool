import { Body, Controller, Get, HttpCode, HttpException, Post, Req, Res, UseGuards } from '@nestjs/common';
import { AdminAuthService, AdminRequest, checkOrigin, cookieName } from './admin-auth.service';
import { AdminGuard } from './admin.guard';
interface Response {setHeader(name:string,value:string):void}
const cookie=(token:string,maxAge:number)=>`${cookieName}=${token}; HttpOnly; SameSite=Strict; Path=/api/admin; Max-Age=${maxAge}${process.env.NODE_ENV==='production'?'; Secure':''}`;
@Controller('admin/auth')
export class AdminAuthController {
 private readonly attempts=new Map<string,{count:number;reset:number}>();
 constructor(private readonly auth:AdminAuthService){}
 @Post('login') @HttpCode(200)
 async login(@Req() req:AdminRequest,@Body() body:unknown,@Res({passthrough:true}) res:Response) {
  checkOrigin(req);const now=Date.now(),key=req.ip||'unknown';
  for(const [ip,item] of this.attempts)if(item.reset<=now)this.attempts.delete(ip);
  const item=this.attempts.get(key)||{count:0,reset:now+60000};
  if(item.count>=10 || (!this.attempts.has(key)&&this.attempts.size>=5000))throw new HttpException('登录过于频繁，请稍后重试',429);
  item.count++;this.attempts.set(key,item);
  const result=await this.auth.login(body);res.setHeader('Set-Cookie',cookie(result.token,8*3600));return result.user;
 }
 @Get('me') @UseGuards(AdminGuard)
 me(@Req() req:AdminRequest){const {tokenHash,...user}=req.admin;return user;}
 @Post('logout') @HttpCode(200) @UseGuards(AdminGuard)
 async logout(@Req() req:AdminRequest,@Res({passthrough:true}) res:Response){const result=await this.auth.logout(req.admin);res.setHeader('Set-Cookie',cookie('',0));return result;}
 @Post('password') @HttpCode(200) @UseGuards(AdminGuard)
 async changePassword(@Req() req:AdminRequest,@Body() body:unknown,@Res({passthrough:true}) res:Response){const result=await this.auth.changePassword(req.admin,body);res.setHeader('Set-Cookie',cookie('',0));return result;}
}
