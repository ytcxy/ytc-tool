import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { ErrorsFilter } from './common/errors.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);
  if (config.get<boolean>('TRUST_LOOPBACK_PROXY')) app.getHttpAdapter().getInstance().set('trust proxy', 'loopback');
  app.setGlobalPrefix('api');
  app.useGlobalFilters(new ErrorsFilter());
  app.enableShutdownHooks();
  await app.listen(config.getOrThrow<number>('PORT'), config.getOrThrow<string>('BIND_HOST'));
}
void bootstrap();
