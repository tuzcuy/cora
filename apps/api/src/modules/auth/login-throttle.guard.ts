import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';

/**
 * Minimal in-memory login rate limiter (per IP + email). A Redis-backed
 * distributed limiter is a V1.5 follow-up (docs/DECISIONS.md).
 */
@Injectable()
export class LoginThrottleGuard implements CanActivate {
  private readonly attempts = new Map<string, { count: number; resetAt: number }>();
  private readonly max = 5;
  private readonly windowMs = 60_000;

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    const key = `${req.ip ?? 'unknown'}:${req.body?.email ?? ''}`;
    const now = Date.now();
    const entry = this.attempts.get(key);

    if (!entry || entry.resetAt < now) {
      this.attempts.set(key, { count: 1, resetAt: now + this.windowMs });
      return true;
    }
    entry.count += 1;
    if (entry.count > this.max) {
      throw new HttpException(
        'Çok fazla giriş denemesi. Lütfen biraz bekleyin.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }
}
