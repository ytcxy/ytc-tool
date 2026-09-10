import { Body, Controller, Get, Param, Put, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard, UserRequest } from '../auth/auth.guard';
import { id,pagination } from '../common/input';
import { ProgressService } from './progress.service';
@Controller('me') @UseGuards(AuthGuard)
export class ProgressController {
 constructor(private readonly progress:ProgressService){}
 @Get('summary') summary(@Req() req:UserRequest){return this.progress.summary(req.user.id);}
 @Get('collections/:id/progress') collection(@Req() req:UserRequest,@Param('id') value:string){return this.progress.collection(req.user.id,id(value));}
 @Get('episodes/:id/progress') episode(@Req() req:UserRequest,@Param('id') value:string){return this.progress.episode(req.user.id,id(value));}
 @Put('episodes/:id/progress') saveEpisode(@Req() req:UserRequest,@Param('id') value:string,@Body() body:unknown){return this.progress.saveEpisode(req.user.id,id(value),body);}
 @Put('sentences/:id/progress') saveSentence(@Req() req:UserRequest,@Param('id') value:string,@Body() body:unknown){return this.progress.saveSentence(req.user.id,id(value),body);}
 @Get('review') review(@Req() req:UserRequest,@Query('page') page:unknown,@Query('limit') limit:unknown){const p=pagination(page,limit);return this.progress.review(req.user.id,p.offset,p.limit);}
}
