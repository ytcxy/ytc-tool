import { Controller, Get, NotFoundException, Param, Query, StreamableFile, UseGuards } from '@nestjs/common';
import { RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../database.service';
import { AudioService, AudioSentence } from '../audio/audio.service';
import { CatalogService } from '../catalog/catalog.service';
import { id, pagination, string } from '../common/input';
import { AdminGuard } from './admin.guard';
@Controller('admin/audio') @UseGuards(AdminGuard)
export class AdminAudioController {
 constructor(private readonly db:DatabaseService,private readonly audio:AudioService,private readonly catalog:CatalogService){}
 @Get()
 async list(@Query() query:Record<string,unknown>) {
  const p=pagination(query.page,query.limit),where=['s.is_del=0','e.is_del=0','c.is_del=0'],values:(string|number|null)[]=[];
  if(query.q){where.push('(s.zh LIKE ? OR s.en LIKE ?)');const q='%'+string(query.q,'关键词',100)+'%';values.push(q,q);}
  if(query.episodeId){where.push('e.id=?');values.push(id(query.episodeId));}
  const from=`FROM el_sentences s JOIN el_episodes e ON e.id=s.episode_id JOIN el_collections c ON c.id=e.collection_id WHERE ${where.join(' AND ')}`;
  const [rows]=await this.db.pool.query<RowDataPacket[]>(`SELECT s.id,s.zh,s.en,e.title AS episodeTitle,c.title AS collectionTitle,e.status AS episodeStatus,c.status AS collectionStatus,s.source_key AS sentenceKey,e.source_key AS episodeKey,c.source_key AS collectionKey ${from} ORDER BY c.id,e.sequence,s.sequence,s.id LIMIT ? OFFSET ?`,[...values,p.limit,p.offset]);
  const urls=await this.audio.urls(rows as AudioSentence[]);
  const [counts]=await this.db.pool.execute<RowDataPacket[]>(`SELECT COUNT(*) AS total ${from}`,values);
  return {items:rows.map(row=>({id:row.id,zh:row.zh,en:row.en,episodeTitle:row.episodeTitle,collectionTitle:row.collectionTitle,state:!urls.get(row.id)?'未关联或需重新生成':row.episodeStatus!==1||row.collectionStatus!==1?'未发布，暂不可播放':'可播放',audioUrl:urls.get(row.id)&&row.episodeStatus===1&&row.collectionStatus===1?`/api/admin/audio/${row.id}`:null})),total:Number(counts[0].total)};
 }
 @Get(':id')
 async play(@Param('id') value:string) {
  const sentence=await this.catalog.sentence(id(value)),clip=await this.audio.find(sentence as AudioSentence);
  if(!clip)throw new NotFoundException('音频未就绪或英文已修改');return new StreamableFile(clip.buffer,{type:clip.type,length:clip.buffer.length});
 }
}
