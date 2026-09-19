import { AdminImportService } from './admin/admin-import.service';
import { AdminAuthService } from './admin/admin-auth.service';
import { AdminGuard } from './admin/admin.guard';
import { AdminContentService } from './admin/admin-content.service';
import { AdminUsersService } from './admin/admin-users.service';
import { AdminController } from './admin/admin.controller';
import { AdminAuthController } from './admin/admin-auth.controller';
import { AdminAudioController } from './admin/admin-audio.controller';
import { AudioService } from './audio/audio.service';
import { AudioController } from './audio/audio.controller';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { resolve } from 'node:path';
import { validateConfig } from './config';
import { DatabaseService } from './database.service';
import { HealthController } from './health.controller';
import { AuthService } from './auth/auth.service';
import { AuthGuard } from './auth/auth.guard';
import { WechatService } from './auth/wechat.service';
import { AuthController } from './auth/auth.controller';
import { CatalogService } from './catalog/catalog.service';
import { CatalogController } from './catalog/catalog.controller';
import { ProgressService } from './progress/progress.service';
import { ProgressController } from './progress/progress.controller';
import { UsersService } from './users/users.service';
import { UsersController } from './users/users.controller';
@Module({
 imports:[ConfigModule.forRoot({isGlobal:true,envFilePath:resolve(__dirname,'../.env'),validate:validateConfig})],
 controllers:[AdminController,AdminAuthController,AdminAudioController,AudioController,HealthController,AuthController,CatalogController,ProgressController,UsersController],
 providers:[AdminImportService,AdminAuthService,AdminGuard,AdminContentService,AdminUsersService,AudioService,DatabaseService,AuthService,AuthGuard,WechatService,CatalogService,ProgressService,UsersService],
})
export class AppModule {}
