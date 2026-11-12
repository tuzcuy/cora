import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import type { Request, Response, CookieOptions } from 'express';
import { AuthService } from './auth.service.js';
import { LoginSchema, type LoginDto } from './dto/auth.dto.js';
import { LoginThrottleGuard } from './login-throttle.guard.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { Public } from '../../common/decorators/public.decorator.js';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator.js';
import type { Env } from '../../config/env.schema.js';

const REFRESH_COOKIE = 'cora_rt';

@ApiTags('auth')
@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  @Public()
  @UseGuards(LoginThrottleGuard)
  @Post('login')
  @ApiOperation({ summary: 'E-posta + şifre ile giriş; access token döner, refresh cookie yazar' })
  async login(
    @Body(new ZodValidationPipe(LoginSchema)) dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { accessToken, refreshToken, user } = await this.auth.login(dto.email, dto.password);
    res.cookie(REFRESH_COOKIE, refreshToken, this.cookieOptions());
    return { accessToken, user };
  }

  @Public()
  @Post('refresh')
  @ApiOperation({ summary: 'Refresh cookie ile yeni access token (rotating refresh)' })
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = req.cookies?.[REFRESH_COOKIE];
    if (!token) throw new UnauthorizedException('Yenileme jetonu yok');
    const { accessToken, refreshToken, user } = await this.auth.refresh(token);
    res.cookie(REFRESH_COOKIE, refreshToken, this.cookieOptions());
    return { accessToken, user };
  }

  @Public()
  @Post('logout')
  @ApiOperation({ summary: 'Refresh cookie temizler' })
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(REFRESH_COOKIE, { ...this.cookieOptions(), maxAge: undefined });
    return { ok: true };
  }

  @Get('me')
  @ApiOperation({ summary: 'Oturum açan kullanıcı + izinler + lisans modülleri' })
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user.userId);
  }

  private cookieOptions(): CookieOptions {
    const domain = this.config.get('COOKIE_DOMAIN', { infer: true });
    const sameSite = this.config.get('COOKIE_SAMESITE', { infer: true });
    // SameSite=None requires Secure (browsers reject None without Secure).
    const secure = sameSite === 'none' ? true : this.config.get('COOKIE_SECURE', { infer: true });
    const opts: CookieOptions = {
      httpOnly: true,
      secure,
      sameSite,
      path: '/',
      maxAge: 30 * 24 * 60 * 60 * 1000,
    };
    if (domain && domain !== 'localhost') opts.domain = domain;
    return opts;
  }
}
