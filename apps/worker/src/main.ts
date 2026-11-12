import { Worker, Queue, type ConnectionOptions } from 'bullmq';
import pino from 'pino';

const logger = pino({
  transport:
    process.env.NODE_ENV !== 'production'
      ? { target: 'pino-pretty', options: { singleLine: true } }
      : undefined,
});

function redisConnection(): ConnectionOptions {
  const url = new URL(process.env.REDIS_URL ?? 'redis://localhost:6379');
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    ...(url.password ? { password: url.password } : {}),
  };
}

const connection = redisConnection();

/**
 * BullMQ worker skeleton. Real processors (PDF, mail, TCMB FX, reports,
 * backup-verify) are added in later packages (CORA_MIMARI §10-12).
 */
export const QUEUES = ['pdf', 'mail', 'fx-rates', 'reports'] as const;

const queues = QUEUES.map((name) => new Queue(name, { connection }));

const workers = QUEUES.map(
  (name) =>
    new Worker(
      name,
      async (job) => {
        logger.info(
          { queue: name, jobId: job.id, name: job.name },
          'job received (skeleton, no-op)',
        );
      },
      { connection },
    ),
);

logger.info({ queues: QUEUES }, 'Cora worker başladı');

async function shutdown(signal: string) {
  logger.info({ signal }, 'kapanıyor…');
  await Promise.all(workers.map((w) => w.close()));
  await Promise.all(queues.map((q) => q.close()));
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
