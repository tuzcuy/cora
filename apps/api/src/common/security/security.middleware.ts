import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

/**
 * Security headers (P10), written by hand rather than pulling in helmet: the API
 * serves JSON and a Swagger page, so the useful set is small and explicit.
 *
 * The web app is a separate static origin, so a strict CSP here only has to
 * cover the API's own responses (JSON and /api/docs).
 */
@Injectable()
export class SecurityHeadersMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-DNS-Prefetch-Control', 'off');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=(), payment=()');
    // HSTS only matters over TLS; Render terminates TLS in front of us.
    if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
      res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
    }
    // Swagger needs inline styles/scripts; everything else gets the tight policy.
    const isDocs = req.path.startsWith('/api/docs');
    res.setHeader(
      'Content-Security-Policy',
      isDocs
        ? "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; frame-ancestors 'none'"
        : "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
    );
    next();
  }
}

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * Per-IP rate limit for the whole API (P10). Deliberately in-memory: one API
 * instance, no Redis on the target host. Login has its own stricter guard.
 * Read-only requests get a wider budget than writes.
 */
@Injectable()
export class RateLimitMiddleware implements NestMiddleware {
  private readonly buckets = new Map<string, Bucket>();
  private readonly windowMs = Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000);
  private readonly readMax = Number(process.env.RATE_LIMIT_READ ?? 600);
  private readonly writeMax = Number(process.env.RATE_LIMIT_WRITE ?? 180);

  use(req: Request, res: Response, next: NextFunction) {
    // /api/health must answer even under a flood, or the host restarts us.
    if (req.path.startsWith('/api/health') || req.path.startsWith('/api/ready')) return next();

    const isWrite = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    const limit = isWrite ? this.writeMax : this.readMax;
    const ip = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() || req.ip || 'unknown';
    const key = `${ip}:${isWrite ? 'w' : 'r'}`;
    const now = Date.now();

    let bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + this.windowMs };
      this.buckets.set(key, bucket);
    }
    bucket.count += 1;

    res.setHeader('X-RateLimit-Limit', String(limit));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(limit - bucket.count, 0)));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));

    if (bucket.count > limit) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
      res.setHeader('Retry-After', String(retryAfter));
      res.status(429).json({
        status: 429,
        title: 'Çok fazla istek',
        detail: `Dakikada ${limit} istek sınırı aşıldı. ${retryAfter} saniye sonra tekrar deneyin.`,
      });
      return;
    }

    // Keep the map from growing without bound on a long-lived process.
    if (this.buckets.size > 5_000) {
      for (const [k, b] of this.buckets) if (b.resetAt <= now) this.buckets.delete(k);
    }
    next();
  }
}
