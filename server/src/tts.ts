import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rename, stat, unlink, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const TTS_LANGS = ['en', 'es'] as const;
export type TtsLang = (typeof TTS_LANGS)[number];

/**
 * Returns MP3 bytes for already-normalized text. On a cache miss it first calls `charge(chars)`; false means
 * a budget ran out and it throws TtsBudgetError without calling ElevenLabs. Cache hits are free.
 * Throws any other error when the upstream call fails.
 */
export type Tts = (text: string, charge: (chars: number) => boolean) => Promise<Buffer>;
export class TtsBudgetError extends Error {}

/** Premade "Sarah - Mature, Reassuring, Confident": calm and clear, works with eleven_multilingual_v2 in EN and ES. */
export const DEFAULT_VOICE_ID = 'EXAVITQu4vr4xnSDxMaL';
export const DEFAULT_TTS_MODEL = 'eleven_multilingual_v2';
export const MAX_AUDIO_BYTES = 1024 * 1024;
export const CACHE_MAX_BYTES = 200 * 1024 * 1024;
export const CACHE_MAX_FILES = 5000;

/** NFC, control/format characters removed, whitespace collapsed, trimmed: equal phrases share one cache entry. */
export const normalizeTtsText = (s: string) =>
  s.normalize('NFC').replace(/[\p{Cc}\p{Cf}]/gu, ' ').replace(/\s+/g, ' ').trim();

/** An env budget: unset or blank means the default (undefined); "0" means 0; junk means the default. */
export const envBudget = (v: string | undefined) => {
  if (v === undefined || v.trim() === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
};

export interface ElevenLabsOptions {
  apiKey: string;
  voiceId?: string;
  model?: string;
  cacheDir: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxCacheBytes?: number;
  maxCacheFiles?: number;
}

/** Reads a response body, giving up past `limit` bytes so a hostile or broken upstream cannot fill memory. */
async function readCapped(res: Response, limit: number) {
  if (!res.body) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    total += chunk.length;
    if (total > limit) {
      await res.body.cancel().catch(() => {});
      throw new Error(`elevenlabs audio over ${limit} bytes`);
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/** Deletes least recently used files (by mtime; hits touch it) until the cache fits both caps. */
async function evict(dir: string, maxBytes: number, maxFiles: number) {
  const names = (await readdir(dir)).filter((n) => n.endsWith('.mp3'));
  const files = (
    await Promise.all(names.map((n) => stat(join(dir, n)).then((s) => ({ n, size: s.size, t: s.mtimeMs }), () => null)))
  ).filter((f) => f !== null);
  let bytes = files.reduce((a, f) => a + f.size, 0);
  let count = files.length;
  files.sort((a, b) => a.t - b.t);
  for (const f of files) {
    if (bytes <= maxBytes && count <= maxFiles) break;
    await unlink(join(dir, f.n)).catch(() => {});
    bytes -= f.size;
    count--;
  }
}

/**
 * ElevenLabs TTS with a disk cache keyed by sha256(text|voice|model). Language is not in the key:
 * eleven_multilingual_v2 detects it from the text. Each phrase is generated once, a hit never touches the
 * network, and concurrent requests for one key share a single upstream call. The cache is LRU-capped.
 */
export function elevenLabsTts({
  apiKey, voiceId = DEFAULT_VOICE_ID, model = DEFAULT_TTS_MODEL, cacheDir, fetchImpl = fetch, timeoutMs = 15_000,
  maxCacheBytes = CACHE_MAX_BYTES, maxCacheFiles = CACHE_MAX_FILES,
}: ElevenLabsOptions): Tts {
  const inflight = new Map<string, Promise<Buffer>>();

  async function load(key: string, text: string, charge: (chars: number) => boolean) {
    const file = join(cacheDir, `${key}.mp3`);
    try {
      const hit = await readFile(file);
      const now = new Date();
      utimes(file, now, now).catch(() => {}); // LRU touch
      return hit;
    } catch {
      // miss: generate below
    }
    if (!charge(text.length)) throw new TtsBudgetError('tts budget exhausted');
    const res = await fetchImpl(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`,
      {
        method: 'POST',
        headers: { 'xi-api-key': apiKey, 'content-type': 'application/json', accept: 'audio/mpeg' },
        body: JSON.stringify({ text, model_id: model }),
        signal: AbortSignal.timeout(timeoutMs),
      },
    );
    // the error body is ElevenLabs' JSON ({detail: {status, message}}); it never contains the key
    if (!res.ok) {
      // capped read: an error body is only a hint; a huge one is dropped after recording the status
      const detail = await readCapped(res, 4096).then((b) => b.toString('utf8').slice(0, 300), () => '(body too large)');
      throw new Error(`elevenlabs HTTP ${res.status}: ${detail}`);
    }
    const type = res.headers.get('content-type') ?? '';
    if (!type.startsWith('audio/mpeg')) {
      await res.body?.cancel().catch(() => {});
      throw new Error(`elevenlabs returned ${type || 'no content-type'}, not audio/mpeg`);
    }
    const audio = await readCapped(res, MAX_AUDIO_BYTES);
    if (!audio.length) throw new Error('elevenlabs returned empty audio');
    await mkdir(cacheDir, { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`; // rename is atomic: a reader never sees half a file
    await writeFile(tmp, audio);
    await rename(tmp, file);
    await evict(cacheDir, maxCacheBytes, maxCacheFiles).catch(() => {});
    return audio;
  }

  return (text, charge) => {
    const key = createHash('sha256').update(`${text}|${voiceId}|${model}`).digest('hex');
    let p = inflight.get(key);
    if (!p) {
      p = load(key, text, charge).finally(() => inflight.delete(key));
      inflight.set(key, p);
    }
    return p;
  };
}
