import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
@Catch()
export class ErrorsFilter implements ExceptionFilter {
 private readonly logger=new Logger('API');
 catch(error: unknown, host: ArgumentsHost) {
  let status=500,message='服务暂时不可用，请稍后重试';
  if(error instanceof HttpException) {
   status=error.getStatus(); const response=error.getResponse();
   const value=typeof response==='string'?response:(response as {message?:unknown}).message;
   message=typeof value==='string'?value:Array.isArray(value)?value.join('；'):message;
  } else {
   const code=(error as {code?:string})?.code;
   if(code==='ER_NO_SUCH_TABLE') {status=503;message='学习内容尚未初始化，请稍后再试';}
   this.logger.error(code || 'UNEXPECTED_ERROR');
  }
  host.switchToHttp().getResponse().status(status).json({statusCode:status,message});
 }
}
