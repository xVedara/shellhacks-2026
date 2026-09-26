// Bundled StepSafe-voice clips for every fixed on-device phrase (iOS PhrasePlayer).
// Source of truth: ios/StepSafe/Phrases/phrases.json. Writes ios/StepSafe/Phrases/<id>.<lang>.mp3.
// Idempotent: existing files are skipped, so a rerun costs nothing. After changing a phrase's text, delete its
// mp3 (or give it a new id) so it is re-recorded. .mts: an ES module wherever it runs (top-level await).
//
//   cd server && npm run gen:phrases --dry-run        # count characters, call nothing (also: -- --dry-run)
//   cd server && npm run gen:phrases                  # generate missing clips
//   options: --force (ignore MAX_CHARS), MAX_CHARS=12000 (env)
//
// Key: ELEVENLABS_API_KEY from server/.env (or the environment). It is never printed.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'ios', 'StepSafe', 'Phrases');
const spec = JSON.parse(readFileSync(join(dir, 'phrases.json'), 'utf8')) as {
  voice: string;
  model: string;
  phrases: { id: string; en: string; es: string }[];
};
const LANGS = ['en', 'es'] as const;
const FORMAT = 'mp3_44100_64';
// `npm run gen:phrases --dry-run` gives the flag to npm, which passes it on as npm_config_dry_run.
const dryRun = process.argv.includes('--dry-run') || process.env.npm_config_dry_run === 'true';
const force = process.argv.includes('--force') || process.env.npm_config_force === 'true';
const maxChars = Number(process.env.MAX_CHARS ?? 12000);

const jobs = spec.phrases.flatMap((p) =>
  LANGS.map((lang) => ({ id: p.id, lang, text: p[lang], file: join(dir, `${p.id}.${lang}.mp3`) })),
);
const todo = jobs.filter((j) => !existsSync(j.file));
const chars = todo.reduce((n, j) => n + j.text.length, 0);
const allChars = jobs.reduce((n, j) => n + j.text.length, 0);
console.log(`${jobs.length} clips (${allChars} chars in all); ${todo.length} missing = ${chars} chars to generate`);

if (dryRun) process.exit(0);
if (chars > maxChars && !force) {
  console.error(`refusing: ${chars} chars > MAX_CHARS ${maxChars} (use --force)`);
  process.exit(1);
}
if (todo.length === 0) process.exit(0);

let key = process.env.ELEVENLABS_API_KEY;
const envFile = join(root, 'server', '.env');
if (!key && existsSync(envFile)) {
  process.loadEnvFile(envFile);
  key = process.env.ELEVENLABS_API_KEY;
}
if (!key) {
  console.error('ELEVENLABS_API_KEY is not set (server/.env)');
  process.exit(1);
}

let used = 0;
for (const j of todo) {
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${spec.voice}?output_format=${FORMAT}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'xi-api-key': key, 'content-type': 'application/json', accept: 'audio/mpeg' },
    body: JSON.stringify({ text: j.text, model_id: spec.model }),
  });
  if (!res.ok) {
    // The body is ElevenLabs' error JSON; it never contains the key.
    console.error(`${j.id}.${j.lang}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    process.exit(1);
  }
  writeFileSync(j.file, Buffer.from(await res.arrayBuffer()));
  used += j.text.length;
  console.log(`${j.id}.${j.lang}.mp3  "${j.text}"`);
}
console.log(`done: ${todo.length} clips, ${used} characters used`);
