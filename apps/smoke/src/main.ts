import 'reflect-metadata';
import { connect } from 'node:net';
import { Controller, Get, Logger, Module, NotFoundException, Query } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { turkishFold } from '@cora/shared';

/**
 * Smoke + environment probe. Proves the host can install this pnpm workspace,
 * resolve @cora/shared, run NestJS and honor $PORT — AND (critical for the API
 * on Hostinger) whether OUTBOUND TCP to Supabase/Upstash is allowed.
 * Deploy first; read the build log and /probe output before deploying api/web.
 */
interface ProbeResult {
  host: string;
  port: number;
  ok: boolean;
  ms: number;
  error?: string;
}

function tcpProbe(host: string, port: number, timeoutMs = 5000): Promise<ProbeResult> {
  return new Promise((resolve) => {
    const start = Date.now();
    const socket = connect({ host, port });
    let done = false;
    const finish = (ok: boolean, error?: string) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve({ host, port, ok, ms: Date.now() - start, error });
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false, 'timeout'));
    socket.once('error', (e: Error) => finish(false, e.message));
  });
}

@Controller()
class SmokeController {
  @Get()
  root() {
    return {
      ok: true,
      node: process.version,
      port: process.env.PORT ?? null,
      sharedImport: turkishFold('ŞİŞE') === 'sise',
    };
  }

  /**
   * GET /probe?token=<PROBE_TOKEN>&targets=host:port,host:port
   * Token-gated (PROBE_TOKEN env) — otherwise 404 so the Supabase/Upstash hosts
   * in `targets` are never exposed publicly. Tests outbound TCP reachability
   * (e.g. Supabase pooler:6543, direct:5432, Upstash:6379).
   */
  @Get('probe')
  async probe(@Query('token') token?: string, @Query('targets') targets?: string) {
    const expected = process.env.PROBE_TOKEN;
    if (!expected || token !== expected) throw new NotFoundException();
    const raw = targets ?? process.env.PROBE_TARGETS ?? '';
    const list = raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const results = await Promise.all(
      list.map((t) => {
        const [host, portStr] = t.split(':');
        return tcpProbe(host ?? '', Number(portStr ?? 0));
      }),
    );
    return { ok: results.length > 0 && results.every((r) => r.ok), node: process.version, results };
  }
}

@Module({ controllers: [SmokeController] })
class SmokeModule {}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(SmokeModule, { logger: ['log', 'error', 'warn'] });
  const port = process.env.PORT ? Number(process.env.PORT) : 3009;
  await app.listen(port, '0.0.0.0');
  new Logger('Smoke').log(`smoke up on 0.0.0.0:${port} (GET / , GET /probe)`);
}

void bootstrap();
