import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { AdminAuthService, AdminRequest, checkCsrf } from './admin-auth.service';
@Injectable()
export class AdminGuard implements CanActivate {
 constructor(private readonly auth:AdminAuthService){}
 async canActivate(context:ExecutionContext) {
  const req=context.switchToHttp().getRequest<AdminRequest>();req.admin=await this.auth.authenticate(req.headers.cookie);
  if(!['GET','HEAD'].includes(req.method))checkCsrf(req);
  if(req.admin.mustChangePassword && !['me','changePassword','logout'].includes(context.getHandler().name))throw new ForbiddenException('请先修改初始密码');
  return true;
 }
}
