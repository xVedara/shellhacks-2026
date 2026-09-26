import { buildApp, renamePending } from './app.ts';
import { ensureIndexes, openDb } from './db.ts';
import { geminiNamer } from './gemini.ts';

const { client, db } = openDb();
const apiKey = process.env.GEMINI_API_KEY;
const namer = geminiNamer(apiKey, process.env.GEMINI_MODEL || 'gemini-2.5-flash');
const app = buildApp({ db, namer, logger: true });

try {
  await ensureIndexes(db);
} catch (err) {
  app.log.error({ err }, 'ensureIndexes failed (is MONGODB_URI reachable?)');
  process.exit(1);
}

// 127.0.0.1 by default: cloudflared runs on the same box, and it keeps cf-connecting-ip unspoofable.
await app.listen({ host: process.env.HOST || '127.0.0.1', port: Number(process.env.PORT) || 8787 });

if (apiKey) {
  let busy = false;
  setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      const n = await renamePending(db, namer);
      if (n) app.log.info(`renamed ${n} hazard(s)`);
    } catch (err) {
      app.log.warn({ err }, 'rename pass failed');
    } finally {
      busy = false;
    }
  }, 30_000).unref();
} else {
  app.log.warn('GEMINI_API_KEY not set: new hazards are saved as "unknown obstacle"');
}

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.once(sig, async () => {
    await app.close();
    await client.close();
    process.exit(0);
  });
}
