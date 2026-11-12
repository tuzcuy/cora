import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { PrismaService } from '../../prisma/prisma.service.js';
import { TenantContext } from '../../common/context/tenant-context.js';
import type { Env } from '../../config/env.schema.js';

export interface AuthResult {
  accessToken: string;
  refreshToken: string;
  user: PublicUser;
}

export interface PublicUser {
  id: string;
  email: string;
  fullName: string;
  tenantId: string;
  tenantName: string;
  repCode: string | null;
  permissions: string[];
  modules: string[];
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  static hashPassword(plain: string): Promise<string> {
    return argon2.hash(plain);
  }

  async login(email: string, password: string): Promise<AuthResult> {
    // Login happens before a tenant is known -> system mode (no tenant filter).
    const user = await TenantContext.runSystem(() =>
      this.prisma.db.user.findFirst({
        where: { email, isActive: true, deletedAt: null },
        include: this.userInclude(),
      }),
    );
    if (!user) throw new UnauthorizedException('E-posta veya şifre hatalı');

    const ok = await argon2.verify(user.passwordHash, password).catch(() => false);
    if (!ok) throw new UnauthorizedException('E-posta veya şifre hatalı');

    await TenantContext.runSystem(() =>
      this.prisma.db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } }),
    );

    return this.issue(user);
  }

  async refresh(refreshToken: string): Promise<AuthResult> {
    let payload: { sub: string; tenantId: string; type: string };
    try {
      payload = await this.jwt.verifyAsync(refreshToken, {
        secret: this.config.get('JWT_REFRESH_SECRET', { infer: true }),
      });
    } catch {
      throw new UnauthorizedException('Yenileme jetonu geçersiz veya süresi dolmuş');
    }
    if (payload.type !== 'refresh') throw new UnauthorizedException('Yanlış jeton türü');

    const user = await TenantContext.runSystem(() =>
      this.prisma.db.user.findFirst({
        where: { id: payload.sub, isActive: true, deletedAt: null },
        include: this.userInclude(),
      }),
    );
    if (!user) throw new UnauthorizedException('Kullanıcı bulunamadı');
    return this.issue(user);
  }

  async me(userId: string): Promise<PublicUser> {
    const user = await this.prisma.db.user.findFirst({
      where: { id: userId },
      include: this.userInclude(),
    });
    if (!user) throw new UnauthorizedException('Kullanıcı bulunamadı');
    return this.toPublicUser(user);
  }

  // ── helpers ──────────────────────────────────────────────

  private userInclude() {
    return {
      tenant: {
        include: {
          licenses: { orderBy: { validUntil: 'desc' as const }, take: 1 },
        },
      },
      roles: { include: { role: { include: { permissions: true } } } },
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private toPublicUser(user: any): PublicUser {
    const permissions = [
      ...new Set<string>(
        user.roles.flatMap((ur: any) => ur.role.permissions.map((rp: any) => rp.permissionCode)),
      ),
    ];
    const license = user.tenant.licenses[0];
    const modules: string[] =
      license && new Date(license.validUntil).getTime() >= Date.now() ? license.modules : [];
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      tenantId: user.tenantId,
      tenantName: user.tenant.name,
      repCode: user.repCode ?? null,
      permissions,
      modules,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async issue(user: any): Promise<AuthResult> {
    const pub = this.toPublicUser(user);
    const accessToken = await this.jwt.signAsync(
      {
        sub: pub.id,
        tenantId: pub.tenantId,
        type: 'access',
        email: pub.email,
        fullName: pub.fullName,
        permissions: pub.permissions,
        modules: pub.modules,
      },
      {
        secret: this.config.get('JWT_ACCESS_SECRET', { infer: true }),
        expiresIn: this.config.get('JWT_ACCESS_TTL', { infer: true }),
      } as JwtSignOptions,
    );
    const refreshToken = await this.jwt.signAsync(
      { sub: pub.id, tenantId: pub.tenantId, type: 'refresh' },
      {
        secret: this.config.get('JWT_REFRESH_SECRET', { infer: true }),
        expiresIn: this.config.get('JWT_REFRESH_TTL', { infer: true }),
      } as JwtSignOptions,
    );
    return { accessToken, refreshToken, user: pub };
  }
}
