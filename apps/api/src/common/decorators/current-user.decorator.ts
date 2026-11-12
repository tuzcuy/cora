import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Permission } from '@cora/shared';

export interface AuthUser {
  userId: string;
  tenantId: string;
  email?: string;
  fullName?: string;
  permissions: Permission[];
  modules: string[];
}

/** Injects the authenticated user (set by JwtAuthGuard) into a handler param. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const req = ctx.switchToHttp().getRequest();
    return req.user as AuthUser;
  },
);
