import { BadRequestException, Body, Controller, Get, Header, Param, Put, Post, Req, StreamableFile, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthGuard, UserRequest } from '../auth/auth.guard';
import { UsersService } from './users.service';
@Controller()
export class UsersController {
 constructor(private readonly users:UsersService){}
 @Get('me') @UseGuards(AuthGuard) me(@Req() req:UserRequest){return this.users.me(req.user.id);}
 @Put('me') @UseGuards(AuthGuard) update(@Req() req:UserRequest,@Body() body:unknown){return this.users.update(req.user.id,body);}
 @Post('me/avatar') @UseGuards(AuthGuard)
 @UseInterceptors(FileInterceptor('file',{limits:{fileSize:2*1024*1024,files:1,fields:0,parts:2}}))
 avatar(@Req() req:UserRequest,@UploadedFile() file?:{buffer:Buffer}){
  if(!file?.buffer)throw new BadRequestException('请选择头像');return this.users.avatar(req.user.id,file.buffer);
 }
 @Get('avatars/:key') @Header('X-Content-Type-Options','nosniff') @Header('Cache-Control','private, max-age=3600')
 async file(@Param('key') key:string){const data=await this.users.avatarFile(key);return new StreamableFile(data.buffer,{type:data.mime});}
}
