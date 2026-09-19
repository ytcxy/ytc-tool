import { BadRequestException, Controller, Get, Headers, NotFoundException, Param, Query, Res, StreamableFile } from '@nestjs/common';
import { createReadStream } from 'node:fs';
import { id } from '../common/input';
import { CatalogService } from '../catalog/catalog.service';
import { VideoService } from './video.service';
interface Response { status(code:number):Response; setHeader(name:string,value:string|number):void }
export function videoRange(value:string|undefined,size:number):{start:number;end:number}|null {
 if(value===undefined)return {start:0,end:size-1};
 const match=/^bytes=(\d*)-(\d*)$/.exec(value);if(!match||(!match[1]&&!match[2]))return null;
 const first=match[1]?Number(match[1]):null,last=match[2]?Number(match[2]):null;
 if((first!==null&&!Number.isSafeInteger(first))||(last!==null&&!Number.isSafeInteger(last)))return null;
 const start=first===null?Math.max(0,size-(last||0)):first,end=first===null||last===null?size-1:Math.min(last,size-1);
 return start>=size||start>end?null:{start,end};
}
@Controller()
export class VideoController {
 constructor(private readonly catalog:CatalogService,private readonly video:VideoService){}
 @Get('episodes/:id/video')
 async play(@Param('id') value:string,@Query('version') version:unknown,@Headers('range') range:string|undefined,@Res({passthrough:true}) response:Response){
  const episodeId=id(value);
  if(typeof version!=='string'||!/^[a-f0-9]{64}$/.test(version))throw new BadRequestException('无效的视频版本');
  const episode=await this.catalog.videoIdentity(episodeId);
  const video=await this.video.find(episode);
  if(!video||video.entry.sha256!==version)throw new NotFoundException('视频尚未准备或版本已更新');
  response.setHeader('X-Content-Type-Options','nosniff');response.setHeader('Cache-Control','private, no-cache');response.setHeader('Accept-Ranges','bytes');
  const bytes=videoRange(range,video.size);
  if(!bytes){response.status(416);response.setHeader('Content-Range',`bytes */${video.size}`);return new StreamableFile(Buffer.alloc(0),{type:'video/mp4',length:0});}
  if(range!==undefined){response.status(206);response.setHeader('Content-Range',`bytes ${bytes.start}-${bytes.end}/${video.size}`);}
  return new StreamableFile(createReadStream(video.path,bytes),{type:'video/mp4',length:bytes.end-bytes.start+1});
 }
}
