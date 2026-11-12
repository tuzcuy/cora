import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { MODULE_KEY } from '../decorators/require-module.decorator.js';
import type { AuthUser } from '../decorators/current-user.decorator.js';

/** Blocks access (403) when the tenant's license does not include the module. */
@Injectable()
export class LicenseGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string>(MODULE_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!required) return true;

    const user: AuthUser | undefined = ctx.switchToHttp().getRequest().user;
    if (!user) throw new ForbiddenException('Kimlik doğrulama gerekli');
    if (!user.modules.includes(required)) {
      throw new ForbiddenException(`Modül lisansı yok: ${required}`);
    }
    return true;
  }
}
