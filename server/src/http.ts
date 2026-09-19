import { resolve } from 'node:path';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ErrorsFilter } from './common/errors.filter';
export function configureHttp(app:NestExpressApplication) {
  app.useBodyParser('json', {limit:'2mb'});
  app.use('/api/admin', (_req: unknown, res: {setHeader(name:string,value:string):void}, next:()=>void) => {
    res.setHeader('Cache-Control','no-store'); res.setHeader('X-Content-Type-Options','nosniff'); next();
  });
  app.useStaticAssets(resolve(__dirname, process.env.NODE_ENV==='production'?'admin-web':'../admin-web'), {prefix:'/admin/', setHeaders: (res) => {
    res.setHeader('Cache-Control','no-cache');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Referrer-Policy','same-origin');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  }});
  app.setGlobalPrefix('api');
  app.useGlobalFilters(new ErrorsFilter());
}
