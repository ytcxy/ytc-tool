import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { AuthService, Identity } from './auth.service';
export interface UserRequest {user:Identity;headers:{authorization?:string};ip?:string}
@Injectable()
export class AuthGuard implements CanActivate {
 constructor(private readonly auth:AuthService){}
 async canActivate(context:ExecutionContext) {
  const req=context.switchToHttp().getRequest<UserRequest>();
  req.user=await this.auth.authenticate(req.headers.authorization);return true;
 }
}
