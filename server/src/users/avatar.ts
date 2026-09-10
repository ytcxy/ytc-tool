import { BadRequestException } from '@nestjs/common';
export function imageType(buffer:Buffer):{extension:string;mime:string} {
 if(buffer.length<16||buffer.length>2*1024*1024)throw new BadRequestException('请选择 2MB 以内的图片');
 if(buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return {extension:'png',mime:'image/png'};
 if(buffer[0]===255&&buffer[1]===216&&buffer[2]===255)return {extension:'jpg',mime:'image/jpeg'};
 if(buffer.toString('ascii',0,4)==='RIFF'&&buffer.toString('ascii',8,12)==='WEBP')return {extension:'webp',mime:'image/webp'};
 throw new BadRequestException('仅支持 JPG、PNG、WebP 图片');
}
