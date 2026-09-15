import { BadRequestException, Controller, Get, Headers, NotFoundException, Param, Query, Res, StreamableFile } from '@nestjs/common';
import { id } from '../common/input';
import { CatalogService } from '../catalog/catalog.service';
import { AudioService, AudioSentence } from './audio.service';
interface Response { status(code:number):Response; setHeader(name:string,value:string|number):void }
@Controller()
export class AudioController {
 constructor(private readonly catalog:CatalogService,private readonly audio:AudioService){}
 @Get('sentences/:id/audio')
 async play(@Param('id') value:string,@Query('version') version:unknown,@Headers('range') range:string|undefined,@Res({passthrough:true}) response:Response){
  const sentenceId=id(value);
  if(typeof version!=='string'||!/^[a-f0-9]{64}$/.test(version))throw new BadRequestException('无效的音频版本');
  // This query checks deletion and publication of the sentence, episode AND collection.
  const sentence=await this.catalog.sentence(sentenceId);
  const clip=await this.audio.find(sentence as AudioSentence);
  if(!clip||clip.entry.sha256!==version)throw new NotFoundException('本句音频尚未准备或内容已更新');
  const length=clip.buffer.length;
  response.setHeader('X-Content-Type-Options','nosniff');
  response.setHeader('Cache-Control','private, no-cache');
  response.setHeader('Accept-Ranges','bytes');
  let start=0,end=length-1;
  if(range!==undefined){
   const match=/^bytes=(\d*)-(\d*)$/.exec(range);
   if(match&&(match[1]||match[2])){
    if(match[1]){start=Number(match[1]);end=match[2]?Math.min(Number(match[2]),length-1):length-1;}
    else start=Math.max(0,length-Number(match[2]));
   }else start=length;
   if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>=length||start>end){
    response.status(416);response.setHeader('Content-Range',`bytes */${length}`);
    return new StreamableFile(Buffer.alloc(0),{type:clip.type,length:0});
   }
   response.status(206);response.setHeader('Content-Range',`bytes ${start}-${end}/${length}`);
  }
  const buffer=clip.buffer.subarray(start,end+1);
  return new StreamableFile(buffer,{type:clip.type,length:buffer.length});
 }
}
