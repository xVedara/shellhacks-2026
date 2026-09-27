import { fileURLToPath } from 'node:url';
import { buildApp, renamePending } from './app.ts';
import { ensureIndexes, openDb } from './db.ts';
import { switchableNamer } from './namer.ts';
import { DEFAULT_TTS_MODEL, DEFAULT_VOICE_ID, elevenLabsTts, envBudget } from './tts.ts';

const { client, db } = openDb(); // also loads server/.env
const naming = await switchableNamer();
const ttsKey = process.env.ELEVENLABS_API_KEY;
const voiceId = process.env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE_ID;
const ttsModel = process.env.ELEVENLABS_MODEL || DEFAULT_TTS_MODEL;
const tts = ttsKey
  ? elevenLabsTts({ apiKey: ttsKey, voiceId, model: ttsModel, cacheDir: fileURLToPath(new URL('../.cache/tts', import.meta.url)) })
  : undefined;
const app = buildApp({
  db, tts, logger: true,
  ttsDailyChars: envBudget(process.env.TTS_DAILY_CHAR_BUDGET),
  ttsIpDailyChars: envBudget(process.env.TTS_IP_DAILY_CHAR_BUDGET),
});
app.log.info(`naming provider: ${naming.current().detail}`);

/** Loads the local model when it is not in memory (startup, and after anything unloaded it). */
async function warmUp() {
  const ms = await naming.current().warm();
  if (ms !== null) app.log.info(`naming model warm-up call took ${ms} ms`);
}
void warmUp();
app.log.info(ttsKey ? `tts: elevenlabs voice ${voiceId}, model ${ttsModel}` : 'tts: off (no ELEVENLABS_API_KEY); GET /tts answers 503');

try {
  await ensureIndexes(db);
} catch (err) {
  app.log.error({ err }, 'ensureIndexes failed (is MONGODB_URI reachable?)');
  process.exit(1);
}

// 127.0.0.1 by default: cloudflared runs on the same box; cf-connecting-ip is honoured only from loopback sockets.
await app.listen({ host: process.env.HOST || '127.0.0.1', port: Number(process.env.PORT) || 8787 });

// Every 5 s: re-probe while no provider is active, re-warm an unloaded model, then retry needsNaming hazards unless a model call is running.
let passRunning = false;
setInterval(async () => {
  if (passRunning) return;
  passRunning = true;
  try {
    if (await naming.refresh()) app.log.info(`naming provider: ${naming.current().detail}`);
    if (!naming.busy()) await warmUp(); // re-warm if the model was unloaded
    if (naming.current().provider !== 'none' && !naming.busy()) {
      const n = await renamePending(db, naming.namer, 5, naming.busy);
      if (n) app.log.info(`renamed ${n} hazard(s)`);
    }
  } catch (err) {
    app.log.warn({ err }, 'rename pass failed');
  } finally {
    passRunning = false;
  }
}, 5_000).unref();

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.once(sig, async () => {
    await app.close();
    await client.close();
    process.exit(0);
  });
}
