import { Controller, Get, Param, Query } from '@nestjs/common';
import { id,pagination } from '../common/input';
import { CatalogService } from './catalog.service';
@Controller()
export class CatalogController {
 constructor(private readonly catalog:CatalogService){}
 @Get('collections') collections(@Query('page') page:unknown,@Query('limit') limit:unknown) {const p=pagination(page,limit);return this.catalog.collections(p.offset,p.limit);}
 @Get('collections/:id/episodes') episodes(@Param('id') value:string,@Query('page') page:unknown,@Query('limit') limit:unknown) {const p=pagination(page,limit);return this.catalog.episodes(id(value),p.offset,p.limit);}
 @Get('episodes/:id') episode(@Param('id') value:string){return this.catalog.episode(id(value));}
 @Get('episodes/:id/sentences') sentences(@Param('id') value:string){return this.catalog.sentences(id(value));}
}
