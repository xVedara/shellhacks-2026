import { CATEGORIES, HEIGHT_BANDS } from './db.ts';
import { TYPE_IDS } from './taxonomy.ts';
import { geminiNamer, namingPrompt, parseNaming, type Namer } from './gemini.ts';

type Fetch = typeof fetch;

/** The phone's POST /hazards timeout is 20 s; naming must finish well inside it. */
export const NAMER_TIMEOUT_CAP_MS = 15_000;
/** Concurrent Ollama calls; past this, inline naming falls back at once and the renamer names it later. */
export const MAX_CONCURRENT_NAMING = 2;
/** A 32x32 JPEG used once at startup to load the model into memory. */
export const WARMUP_JPEG =
  '/9j/4AAQSkZJRgABAQAASABIAAD/4QCwRXhpZgAATU0AKgAAAAgABAEaAAUAAAABAAAAPgEbAAUAAAABAAAARgEoAAMAAAABAAIAAIdpAAQAAAABAAAATgAAAAAAAABIAAAAAQAAAEgAAAABAAeQAAAHAAAABDAyMjGRAQAHAAAABAECAwCgAAAHAAAABDAxMDCgAQADAAAAAQABAACgAgAEAAAAAQAAACCgAwAEAAAAAQAAACCkBgADAAAAAQAAAAAAAAAA/8AAEQgAIAAgAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/bAEMAHBwcHBwcMBwcMEQwMDBEXERERERcdFxcXFxcdIt0dHR0dHSLi4uLi4uLi6enp6enp8PDw8PD29vb29vb29vb2//bAEMBIiQkODQ4YDQ0YOWbf5vl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5f/dAAQAAv/aAAwDAQACEQMRAD8AfchTOHH8WM0wrzmpLkDZnOD2qi05HCnisnrsWtC+vAxV+GEOMtWRDNuABPTr71opNheKpaCep//Qg3yyn5zxVORVjmPoTV6MQg+WpywyTVe7AbDj0/lUdShoXbyK0Yz8oArPTDKM8VoxjgYobGkf/9k=';
export const DEFAULT_TIMEOUT_MS = { gemini: 4000, ollama: 12_000 } as const;
export const DEFAULT_OLLAMA_URL = 'http://localhost:11434';
export const DEFAULT_OLLAMA_MODEL = 'qwen3.8:27b-mlx';

/** Plain JSON Schema twin of the Gemini response schema (Ollama's `format`). */
const NAMING_SCHEMA = {
  type: 'object',
  properties: {
    type: { type: 'string', enum: TYPE_IDS },
    category: { type: 'string', enum: [...CATEGORIES] },
    heightBand: { type: 'string', enum: [...HEIGHT_BANDS] },
    severity: { type: 'integer', minimum: 1, maximum: 3 },
  },
  required: ['type', 'category', 'heightBand', 'severity'],
};

/** Local multimodal naming through Ollama's /api/chat. Null on timeout, HTTP error or junk output. */
export function ollamaNamer(url: string, model: string, timeoutMs: number, fetchImpl: Fetch = fetch): Namer {
  return async (cropBase64, heightBand, typeHint) => {
    try {
      const res = await fetchImpl(`${url}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: AbortSignal.timeout(timeoutMs), // aborting disconnects, and Ollama then stops generating
        body: JSON.stringify({
          model,
          stream: false,
          think: false,
          keep_alive: -1, // stay loaded: a cold 27B load costs far more than the inline timeout
          format: NAMING_SCHEMA,
          options: { temperature: 0.1 },
          messages: [
            {
              role: 'user',
              content: namingPrompt(heightBand, typeHint),
              images: [cropBase64],
            },
          ],
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const content = String(((await res.json()) as { message?: { content?: unknown } }).message?.content ?? '');
      // MLX models do not always honor `format` and may wrap the JSON in a ```json fence
      return parseNaming(JSON.parse(content.slice(content.indexOf('{'), content.lastIndexOf('}') + 1)));
    } catch (err) {
      console.warn('ollama naming failed:', (err as Error).message);
      return null;
    }
  };
}

/**
 * Caps concurrent calls at `max`. When saturated the call returns null at once (the "obstacle"
 * fallback, renamed later) instead of queueing behind a slow local model. `busy()` lets the renamer stand aside.
 */
export function limitConcurrency(namer: Namer, max = MAX_CONCURRENT_NAMING) {
  let active = 0;
  const limited: Namer = async (...args) => {
    if (active >= max) return null;
    active++;
    try {
      return await namer(...args);
    } finally {
      active--;
    }
  };
  return { namer: limited, busy: () => active > 0 };
}

/** scheme://host:port only, so credentials or paths in OLLAMA_URL never reach the logs. */
export const redactUrl = (url: string) => {
  try {
    return new URL(url).origin;
  } catch {
    return '(invalid url)';
  }
};

export interface NamerChoice {
  provider: 'gemini' | 'ollama' | 'none';
  namer: Namer;
  /** True while a model call is running; the renamer skips its pass then. */
  busy: () => boolean;
  /**
   * Loads the model when it is not in memory (Ollama: checks /api/ps, then makes one naming call with a tiny image).
   * Resolves to the warm-up time in ms, or null when nothing was needed.
   */
  warm: () => Promise<number | null>;
  /** Human-readable, for the startup log. Never contains a key. */
  detail: string;
}

/** GEMINI_API_KEY wins; else a reachable Ollama that has OLLAMA_MODEL; else no naming ("obstacle"). */
export async function selectNamer(env: NodeJS.ProcessEnv = process.env, fetchImpl: Fetch = fetch): Promise<NamerChoice> {
  const timeout = (fallback: number) =>
    Math.min(NAMER_TIMEOUT_CAP_MS, Number(env.NAMER_TIMEOUT_MS) > 0 ? Number(env.NAMER_TIMEOUT_MS) : fallback);
  if (env.GEMINI_API_KEY) {
    const model = env.GEMINI_MODEL || 'gemini-2.5-flash';
    const ms = timeout(DEFAULT_TIMEOUT_MS.gemini);
    // ponytail: no concurrency cap for Gemini (cloud, 4 s timeout); wrap it in limitConcurrency if quota bites
    return {
      provider: 'gemini', namer: geminiNamer(env.GEMINI_API_KEY, model, ms), busy: () => false, warm: async () => null,
      detail: `gemini ${model}, timeout ${ms} ms`,
    };
  }
  const url = (env.OLLAMA_URL || DEFAULT_OLLAMA_URL).replace(/\/+$/, '');
  const model = env.OLLAMA_MODEL || DEFAULT_OLLAMA_MODEL;
  const where = redactUrl(url);
  let why: string;
  try {
    const res = await fetchImpl(`${url}/api/tags`, { signal: AbortSignal.timeout(2000) });
    const tags = (await res.json()) as { models?: { name?: string }[] };
    if (tags.models?.some((m) => m.name === model || m.name === `${model}:latest`)) {
      const ms = timeout(DEFAULT_TIMEOUT_MS.ollama);
      const limited = limitConcurrency(ollamaNamer(url, model, ms, fetchImpl));
      const warm = async () => {
        try {
          const ps = (await (await fetchImpl(`${url}/api/ps`, { signal: AbortSignal.timeout(2000) })).json()) as { models?: { name?: string }[] };
          if (ps.models?.some((m) => m.name === model || m.name === `${model}:latest`)) return null;
        } catch {
          // cannot tell: warm anyway, it is one small call
        }
        const t = Date.now();
        await limited.namer(WARMUP_JPEG, 'ground');
        return Date.now() - t;
      };
      return {
        provider: 'ollama', ...limited, warm,
        detail: `ollama ${model} at ${where}, timeout ${ms} ms, max ${MAX_CONCURRENT_NAMING} concurrent`,
      };
    }
    why = `ollama at ${where} has no model ${model}`;
  } catch {
    why = `no GEMINI_API_KEY and ollama at ${where} is not answering`;
  }
  return {
    provider: 'none', namer: async () => null, busy: () => false, warm: async () => null,
    detail: `none (${why}): new hazards are saved as "obstacle"; retrying every 30 s`,
  };
}

/** The active naming provider; while it is 'none', `refresh()` re-runs selection (Ollama may start later). */
export async function switchableNamer(select: () => Promise<NamerChoice> = () => selectNamer()) {
  let choice = await select();
  return {
    namer: ((...args) => choice.namer(...args)) as Namer,
    busy: () => choice.busy(),
    current: () => choice,
    /** True when a provider just became active. */
    async refresh() {
      if (choice.provider !== 'none') return false;
      const next = await select();
      if (next.provider === 'none') return false;
      choice = next;
      return true;
    },
  };
}
