import { AdminImportService } from './admin-import.service';
import { Body, Controller, Delete, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { id } from '../common/input';
import { AdminRequest } from './admin-auth.service';
import { AdminGuard } from './admin.guard';
import { resource } from './content-input';
import { AdminContentService } from './admin-content.service';
import { AdminUsersService } from './admin-users.service';
@Controller('admin') @UseGuards(AdminGuard)
export class AdminController {
 constructor(private readonly content:AdminContentService,private readonly users:AdminUsersService,private readonly importer:AdminImportService){}
 @Post('episodes/import/preview') previewImport(@Req() req:AdminRequest,@Body() body:unknown){return this.importer.run(req.admin,body);}
 @Post('episodes/import') importEpisode(@Req() req:AdminRequest,@Body() body:unknown){return this.importer.run(req.admin,body,true);}
 @Get('content/:kind') list(@Param('kind') kind:string,@Query() query:Record<string,unknown>){return this.content.list(resource(kind),query);}
 @Post('content/:kind/batch-publish') batchPublish(@Req() req:AdminRequest,@Param('kind') kind:string,@Body() body:unknown){return this.content.batchPublish(req.admin,resource(kind),body);}
 @Post('content/:kind') create(@Req() req:AdminRequest,@Param('kind') kind:string,@Body() body:unknown){return this.content.mutate(req.admin,resource(kind),null,body);}
 @Put('content/:kind/:id') update(@Req() req:AdminRequest,@Param('kind') kind:string,@Param('id') value:string,@Body() body:unknown){return this.content.mutate(req.admin,resource(kind),id(value),body);}
 @Delete('content/:kind/:id') remove(@Req() req:AdminRequest,@Param('kind') kind:string,@Param('id') value:string,@Body() body:unknown){return this.content.mutate(req.admin,resource(kind),id(value),body,true);}
 @Get('content/:kind/:id/impact') impact(@Param('kind') kind:string,@Param('id') value:string){return this.content.impact(resource(kind),id(value));}
 @Get('collections/:id/export') export(@Param('id') value:string){return this.content.export(id(value));}
 @Get('users') listUsers(@Query() query:Record<string,unknown>){return this.users.list(query);}
 @Put('users/:id') updateUser(@Req() req:AdminRequest,@Param('id') value:string,@Body() body:unknown){return this.users.update(req.admin,id(value),body);}
 @Get('progress') progress(@Query() query:Record<string,unknown>){return this.users.progress(query);}
 @Get('audit') logs(@Query() query:Record<string,unknown>){return this.users.logs(query);}
}
