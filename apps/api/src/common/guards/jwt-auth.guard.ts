import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';
import type { AuthUser } from '../decorators/current-user.decorator.js';
import { TenantContext } from '../context/tenant-context.js';
import type { Env } from '../../config/env.schema.js';

interface AccessPayload {
  sub: string;
  tenantId: string;
  type: string;
  permissions?: string[];
  modules?: string[];
  email?: string;
  fullName?: string;
}

/**
 * Verifies the access JWT, populates `req.user` and mutates the request's
 * TenantContext store so downstream Prisma queries are tenant-scoped.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  canActivate(ctx: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest();
    const header: string | undefined = req.headers?.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      throw new UnauthorizedException('Erişim jetonu bulunamadı');
    }

    let payload: AccessPayload;
    try {
      payload = this.jwt.verify<AccessPayload>(header.slice(7), {
        secret: this.config.get('JWT_ACCESS_SECRET', { infer: true }),
      });
    } catch {
      throw new UnauthorizedException('Geçersiz veya süresi dolmuş jeton');
    }
    if (payload.type !== 'access') {
      throw new UnauthorizedException('Yanlış jeton türü');
    }

    const user: AuthUser = {
      userId: payload.sub,
      tenantId: payload.tenantId,
      email: payload.email,
      fullName: payload.fullName,
      permissions: (payload.permissions ?? []) as AuthUser['permissions'],
      modules: payload.modules ?? [],
    };
    req.user = user;
    TenantContext.set({
      tenantId: user.tenantId,
      userId: user.userId,
      permissions: user.permissions,
      modules: user.modules,
    });
    return true;
  }
}
