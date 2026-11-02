import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { buildApp } from './app';

const here = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '0.0.0.0';
const dbPath = process.env.DB_PATH ?? resolve(here, '../data.db');
const webDist = process.env.WEB_DIST ?? resolve(here, '../../web/dist');

const { app, games } = await buildApp({ dbPath, webDist, logger: true });

// 턴 마감 스케줄러
const timer = setInterval(() => {
  try {
    const n = games.tick();
    if (n) app.log.info(`resolved ${n} game(s) by deadline`);
  } catch (e) {
    app.log.error(e);
  }
}, Number(process.env.TICK_MS ?? 15_000));

const shutdown = async () => {
  clearInterval(timer);
  await app.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ port, host });
