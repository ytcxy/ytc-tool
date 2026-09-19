import 'reflect-metadata';
import { NestExpressApplication } from '@nestjs/platform-express';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { configureHttp } from './http';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get(ConfigService);
  if (config.get<boolean>('TRUST_LOOPBACK_PROXY')) app.getHttpAdapter().getInstance().set('trust proxy', 'loopback');
  configureHttp(app);
  app.enableShutdownHooks();
  await app.listen(config.getOrThrow<number>('PORT'), config.getOrThrow<string>('BIND_HOST'));
}
void bootstrap();
