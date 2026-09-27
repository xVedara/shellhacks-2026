import { createHash } from 'node:crypto';
import type { ServerResponse } from 'node:http';
import Fastify, { type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import Ajv from 'ajv';
import type { ChangeStream, Db, ResumeToken, UpdateFilter } from 'mongodb';
import {
  Binary,
  CATEGORIES,
  CLEARED_TTL_MS,
  HEIGHT_BANDS,
  LIFESPAN_MS,
  ObjectId,
  type Category,
  type HazardDoc,
  type HeightBand,
  type LockableField,
} from './db.ts';
import type { Namer } from './gemini.ts';
import { isTypeId, labelsFor, NEVER_PINNED, OBSTACLE, TAXONOMY, taxonomyEntry, TYPE_IDS } from './taxonomy.ts';
import { normalizeTtsText, TTS_LANGS, TtsBudgetError, type Tts, type TtsLang } from './tts.ts';

declare module 'fastify' {
  interface FastifyInstance {
    /** Resolves once the /events change stream is open (tests wait on it). */
    eventsReady: Promise<void>;
  }
}

export interface AppOptions {
  db: Db;
  /** ElevenLabs TTS; absent (no key) means GET /tts answers 503 and the phone uses its built-in voice. */
  tts?: Tts;
  /** ElevenLabs cache misses per minute per client IP (hits are free). */
  ttsMissPerMin?: number;
  /** Characters sent to ElevenLabs per UTC day, all clients together (misses only). */
  ttsDailyChars?: number;
  /** Characters sent to ElevenLabs per UTC day per client IP (misses only). */
  ttsIpDailyChars?: number;
  /** Non-GET requests per minute per deviceId (or IP when the body has no valid deviceId). */
  rateLimitPerMin?: number;
  /** GET requests per minute per IP (venue NAT puts many people behind one IP). */
  getRateLimitPerMin?: number;
  /** Non-GET requests per minute per IP, whatever deviceIds they carry. */
  ipWriteRateLimitPerMin?: number;
  logger?: boolean;
}

type Vote = 'up' | 'down';
type Source = 'walker' | 'scout' | 'verifier';
interface VoteDoc { hazardId: ObjectId; deviceId: string; vote: Vote; source: Source; weight: number; at: Date }
interface UserDoc { deviceId: string; displayName: string; karma: number; createdAt: Date }
interface ReclassDoc {
  hazardId: ObjectId; deviceId: string;
  type: string | null; category: Category | null; heightBand: HeightBand | null; at: Date;
}

const MERGE_RADIUS_M = 10;
const CROP_MAX_BYTES = 200 * 1024;
const NEAR_MAX_ROWS = 500;
const TTS_MAX_CHARS = 200;
const RATE_KEYS_MAX = 10_000;
const HOUR_MS = 3600_000;
const RENAME_MAX_ATTEMPTS = 3;
const SSE_MAX_CLIENTS = 200;
const SSE_MAX_PER_IP = 5;
/** Spoken labels, derived on every read from type + band; a legacy or unknown type reads as "obstacle". */
export const spokenLabels = (h: Pick<HazardDoc, 'type' | 'heightBand'>) => labelsFor(taxonomyEntry(h.type).id, h.heightBand);
const lockedFields = (h: HazardDoc): LockableField[] =>
  h.lockedFields ?? (h.humanLocked ? ['type', 'category', 'heightBand'] : []);

const DEVICE_RE = /^[A-Za-z0-9._:-]{1,128}$/;
const deviceId = { type: 'string', pattern: DEVICE_RE.source };
const lat = { type: 'number', minimum: -90, maximum: 90 };
const lng = { type: 'number', minimum: -180, maximum: 180 };
const idParams = { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] };

export const voteWeight = (karma: number) => 1 + Math.log(1 + Math.max(karma, 0));
/**
 * A walker down-vote is only ever the phone's passive "walked right past, saw nothing" (walkers have no down button).
 * Fixed weight, not karma-scaled: a reporter's weight-1 pin survives one miss (0.4) and clears after a second
 * device's miss (-0.2). One vote per device per pin, so the same walker passing twice does not stack.
 */
export const WALKER_MISS_WEIGHT = 0.6;
/**
 * A pin clears below -2 (explicit scout/verifier votes, so one remote click never erases a hazard), or below 0 once
 * at least 2 different walkers passed it and saw nothing ("deleted if 2 people walk past and see nothing").
 */
export const shouldClear = (confidence: number, walkerMisses: number) =>
  confidence < -2 || (confidence < 0 && walkerMisses >= 2);
const toId = (s: string) => (/^[a-f0-9]{24}$/i.test(s) ? new ObjectId(s) : null);
const defaultName = (id: string) => `Neighbor-${id.slice(0, 4)}`;
/** Public stand-in for a device id: the raw id works as a credential, so never echo it. */
const publicId = (id: string) => createHash('sha256').update(id).digest('hex').slice(0, 10);

export function summary(h: HazardDoc, distanceM?: number) {
  return {
    id: h._id.toHexString(),
    type: h.type,
    category: h.category,
    lat: h.location.coordinates[1],
    lng: h.location.coordinates[0],
    heightBand: h.heightBand,
    confidence: h.confidence,
    lastSeen: h.lastSeen.toISOString(),
    status: h.status,
    label: spokenLabels(h).spokenLabel_en,
    sample: h.sample,
    ...(distanceM === undefined ? {} : { distanceM: Math.round(distanceM * 10) / 10 }),
  };
}

/** Expiry after a category change: the new lifespan from lastSeen, but never less than an hour from now. */
export const expiryAfterCategoryChange = (lastSeen: Date, category: Category) =>
  new Date(Math.max(lastSeen.getTime() + LIFESPAN_MS[category], Date.now() + HOUR_MS));

/**
 * The only place a model names hazards (POST /hazards never does, for latency): asks the model for up to `limit`
 * hazards flagged needsNaming (every new report, and reclassified ones), least recently attempted first. Severity is
 * always refreshed. The type (and, with it, the category) is replaced only when it is not a real taxonomy type yet
 * (legacy text or "obstacle") and people did not choose it; fields in lockedFields are never touched. A person or dog
 * deletes the pin, except in the drop-off band, where it stays "obstacle". Hazards without a crop are skipped. Gives up
 * after RENAME_MAX_ATTEMPTS failures. Stops early while `busy()` (a model call is already running, e.g. a warm-up).
 */
export async function renamePending(db: Db, namer: Namer, limit = 5, busy: () => boolean = () => false) {
  const hazards = db.collection<HazardDoc>('hazards');
  const pending = await hazards
    .find({ needsNaming: true }, { sort: { renameAttemptAt: 1 }, limit }) // missing renameAttemptAt sorts first
    .toArray();
  let renamed = 0;
  for (const h of pending) {
    if (busy()) break; // a model call is running: stand aside, the next pass continues
    if (!h.crop) {
      await hazards.updateOne({ _id: h._id }, { $set: { needsNaming: false } }); // nothing to look at
      continue;
    }
    const locked = lockedFields(h);
    const attempts = (h.renameAttempts ?? 0) + 1;
    const typeLocked = locked.includes('type');
    const n = await namer(h.crop.toString('base64'), h.heightBand, typeLocked && isTypeId(h.type) ? h.type : undefined);
    if (!n) {
      // Match the row we read. A reclassify during the model call resets renameAttempts (and usually
      // lockedFields). Writing the failure anyway can set needsNaming false and skip the rename they asked for.
      await hazards.updateOne(
        {
          _id: h._id,
          needsNaming: true,
          type: h.type,
          lockedFields: h.lockedFields ?? { $exists: false },
          renameAttempts: h.renameAttempts ?? { $exists: false },
        },
        { $set: { renameAttempts: attempts, renameAttemptAt: new Date(), needsNaming: attempts < RENAME_MAX_ATTEMPTS } },
      );
      continue;
    }
    const set: Partial<HazardDoc> = { severity: n.severity, needsNaming: false, renameAttempts: attempts, renameAttemptAt: new Date() };
    if (!typeLocked && (!isTypeId(h.type) || h.type === OBSTACLE)) {
      const type = taxonomyEntry(n.type).id;
      if (NEVER_PINNED.has(type)) {
        // A fallback "obstacle" that turns out to be a person or dog is never kept. Same filter as the rename
        // below, so a reclassification that landed meanwhile wins.
        if (h.heightBand !== 'dropoff') {
          const del = await hazards.deleteOne({ _id: h._id, type: h.type, needsNaming: true, lockedFields: h.lockedFields ?? { $exists: false } });
          if (del.deletedCount) await db.collection('votes').deleteMany({ hazardId: h._id });
          continue;
        }
        // A person cannot make a drop in the depth data: a passer-by at a curb leaves a real drop-off, which stays
        // a generic obstacle (read "drop-off") so no person is ever recorded.
      } else {
        Object.assign(set, { type, ...labelsFor(type, h.heightBand) });
        if (!locked.includes('category') && n.category !== h.category) {
          set.category = n.category;
          if (h.status === 'active') set.expiresAt = expiryAfterCategoryChange(h.lastSeen, n.category);
        }
      }
    }
    // filters make a reclassification that landed meanwhile win over this rename
    const res = await hazards.updateOne(
      { _id: h._id, type: h.type, needsNaming: true, lockedFields: h.lockedFields ?? { $exists: false } },
      { $set: set },
    );
    renamed += res.modifiedCount;
  }
  return renamed;
}

/** Limiter key for an address: IPv4 (also IPv4-mapped IPv6) as is, other IPv6 collapsed to its /64 prefix. */
export function ipKey(ip: string) {
  const addr = ip.replace(/%.*$/, ''); // zone id
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(addr);
  if (mapped) return mapped[1];
  if (!addr.includes(':')) return addr;
  const [head, tail] = addr.split('::');
  const h = head ? head.split(':') : [];
  const t = tail ? tail.split(':') : [];
  const groups = tail === undefined ? h : [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t];
  return `${groups.slice(0, 4).map((g) => (parseInt(g, 16) || 0).toString(16)).join(':')}::/64`;
}

export function buildApp({
  db, tts, ttsMissPerMin = 20, ttsDailyChars = 20_000, ttsIpDailyChars = 2000, rateLimitPerMin = 30, getRateLimitPerMin = 300, ipWriteRateLimitPerMin = 120, logger = false,
}: AppOptions) {
  const app = Fastify({ logger, bodyLimit: 1024 * 1024 });
  const hazards = db.collection<HazardDoc>('hazards');
  const votes = db.collection<VoteDoc>('votes');
  const users = db.collection<UserDoc>('users');
  const reclass = db.collection<ReclassDoc>('reclassifications');
  const reports = db.collection('reports');

  // Bodies are validated strictly (Fastify's default coercion turns JSON null into 0 for numbers);
  // querystrings and params still need coercion because they arrive as strings.
  const strictAjv = new Ajv({ coerceTypes: false, useDefaults: true, allowUnionTypes: true });
  const coerceAjv = new Ajv({ coerceTypes: 'array', useDefaults: true, removeAdditional: true, allowUnionTypes: true });
  app.setValidatorCompiler(({ schema, httpPart }) => (httpPart === 'body' ? strictAjv : coerceAjv).compile(schema));

  app.register(cors, { origin: '*' });

  app.setErrorHandler((err: { statusCode?: number; message: string }, req, reply) => {
    const code = err.statusCode ?? 500;
    if (code >= 400 && code < 500) return reply.code(400).send({ error: 'bad_request', message: err.message });
    req.log.error(err);
    return reply.code(500).send({ error: 'internal' });
  });
  app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: 'not_found' }));
  const notFound = { error: 'not_found' };
  const badRequest = (message: string) => ({ error: 'bad_request', message });

  // ---- rate limit: fixed 60 s window per key ----
  // ponytail: in-memory, single process; move to Mongo/Redis if this ever runs as more than one instance.
  const hits = new Map<string, { start: number; n: number }>();
  let lastSweep = 0;
  const sweep = (now: number) => {
    if (hits.size > RATE_KEYS_MAX && now - lastSweep > 1000) {
      lastSweep = now;
      for (const [k, w] of hits) if (now - w.start >= 60_000) hits.delete(k);
    }
  };
  /** Hits already recorded for this key in the current window (0 when the window has expired). */
  const windowCount = (key: string, now: number) => {
    const w = hits.get(key);
    return w && now - w.start < 60_000 ? w.n : 0;
  };
  /** Counts a hit; true when the key is over its limit. */
  const over = (key: string, limit: number, now: number) => {
    let w = hits.get(key);
    if (!w || now - w.start >= 60_000) hits.set(key, (w = { start: now, n: 0 }));
    return ++w.n > limit;
  };
  // cf-connecting-ip is honoured only from a loopback socket (cloudflared on the same box); anyone else could forge it.
  // IPv6 clients are keyed by their /64: one subscriber usually owns a whole /64 and could rotate within it.
  const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
  const clientIp = (req: FastifyRequest) => {
    const cf = req.headers['cf-connecting-ip'];
    const sock = req.socket.remoteAddress ?? req.ip;
    return ipKey(typeof cf === 'string' && LOOPBACK.has(sock) && /^[0-9A-Fa-f:.]{2,45}$/.test(cf) ? cf : sock);
  };
  // Writes from an IP that is already over its cap never reach the JSON parser (body limit is 1 MB).
  app.addHook('onRequest', async (req, reply) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return;
    if (req.url.startsWith('/health') || req.url.startsWith('/events')) return;
    const now = Date.now();
    sweep(now);
    if (windowCount(`wip:${clientIp(req)}`, now) >= ipWriteRateLimitPerMin) {
      return reply.code(429).send({ error: 'rate_limited' });
    }
  });

  app.addHook('preValidation', async (req, reply) => {
    if (req.method === 'OPTIONS' || req.url.startsWith('/health') || req.url.startsWith('/events')) return;
    const now = Date.now();
    sweep(now);
    const ip = clientIp(req);
    if (req.method === 'GET' || req.method === 'HEAD') {
      if (over(`get:${ip}`, getRateLimitPerMin, now)) return reply.code(429).send({ error: 'rate_limited' });
      return;
    }
    const dev = (req.body as { deviceId?: unknown } | undefined)?.deviceId;
    const devKey = typeof dev === 'string' && DEVICE_RE.test(dev) ? `dev:${dev}` : `ipdev:${ip}`;
    // A device already over its own cap must not also burn the shared IP budget: one phone
    // retrying 429s would lock every other walker behind the same venue NAT. Rotating deviceIds
    // still count here, because each of those requests is under its own device cap.
    if (over(devKey, rateLimitPerMin, now)) return reply.code(429).send({ error: 'rate_limited' });
    if (over(`wip:${ip}`, ipWriteRateLimitPerMin, now)) return reply.code(429).send({ error: 'rate_limited' });
  });

  // ---- one global mutex around the merge check + insert so concurrent reports cannot duplicate pins ----
  // POST /hazards never calls a model, so the lock is held only for a few DB round trips.
  // ponytail: global lock; switch to per-cell locks that also lock neighbour cells if throughput matters,
  // or a DB claim for multiple instances.
  let createChain: Promise<unknown> = Promise.resolve();
  function serialized<T>(fn: () => Promise<T>): Promise<T> {
    const run = createChain.then(fn);
    createChain = run.catch(() => {});
    return run;
  }

  // ---- domain helpers ----
  /** Creates the user row on first write (vote, report, new hazard). Reads never create users. */
  async function ensureUser(id: string): Promise<UserDoc> {
    const doc = await users.findOneAndUpdate(
      { deviceId: id },
      { $setOnInsert: { deviceId: id, displayName: defaultName(id), karma: 0, createdAt: new Date() } },
      { upsert: true, returnDocument: 'after', projection: { _id: 0 } },
    );
    return doc!;
  }

  /** Records (or replaces) a device's vote and recomputes confidence, expiry, and clearing. Null if the hazard is gone. */
  async function castVote(h: HazardDoc, dev: string, vote: Vote, source: Source) {
    const user = await ensureUser(dev);
    const weight = vote === 'down' && source === 'walker' ? WALKER_MISS_WEIGHT : voteWeight(user.karma);
    const now = new Date();
    await votes.replaceOne(
      { hazardId: h._id, deviceId: dev },
      { hazardId: h._id, deviceId: dev, vote, source, weight, at: now },
      { upsert: true },
    );
    // ponytail: recompute-then-set can lose a concurrent vote's contribution until the next vote;
    // switch to a $inc of the signed delta if votes on one hazard ever race in practice.
    // misses: walker down-votes, one per device (the upsert above), so this counts distinct devices
    const [agg] = await votes
      .aggregate<{ c: number; misses: number }>([
        { $match: { hazardId: h._id } },
        {
          $group: {
            _id: null,
            c: { $sum: { $cond: [{ $eq: ['$vote', 'up'] }, '$weight', { $multiply: ['$weight', -1] }] } },
            misses: { $sum: { $cond: [{ $and: [{ $eq: ['$vote', 'down'] }, { $eq: ['$source', 'walker'] }] }, 1, 0] } },
          },
        },
      ])
      .toArray();
    const confidence = agg?.c ?? 0;
    const update: UpdateFilter<HazardDoc> = { $set: vote === 'up' ? { confidence, lastSeen: now } : { confidence } };
    if (vote === 'up') {
      // $max: an upvote never shortens a pin's life
      if (h.status === 'active') update.$max = { expiresAt: new Date(now.getTime() + LIFESPAN_MS[h.category]) };
    }
    let updated = await hazards.findOneAndUpdate({ _id: h._id }, update, { returnDocument: 'after', projection: { crop: 0 } });
    if (!updated) {
      await votes.deleteMany({ hazardId: h._id }); // hazard vanished (TTL) mid-request: drop the orphan vote
      return null;
    }
    if (updated.status === 'active' && shouldClear(confidence, agg?.misses ?? 0)) {
      // conditional on status so only one concurrent voter settles karma
      const cleared = await hazards.findOneAndUpdate(
        { _id: h._id, status: 'active' },
        { $set: { status: 'cleared', expiresAt: new Date(now.getTime() + CLEARED_TTL_MS) } },
        { returnDocument: 'after', projection: { crop: 0 } },
      );
      if (cleared) {
        updated = cleared;
        // ponytail: karma settles only on clearing, not on TTL expiry; add a sweeper if expiry karma matters.
        const voters = await votes.find({ hazardId: h._id }).toArray();
        await users.bulkWrite(
          voters.map((v) => ({
            updateOne: { filter: { deviceId: v.deviceId }, update: { $inc: { karma: v.vote === 'down' ? 1 : -1 } } },
          })),
        );
      }
    }
    return { confidence: updated.confidence, status: updated.status };
  }

  // ---- routes ----
  app.get('/health', async () => {
    let ok = false;
    try {
      await db.command({ ping: 1 });
      ok = true;
    } catch {}
    return { ok: true, db: ok };
  });

  app.post<{
    Body: {
      crop: string; lat: number; lng: number; heading?: unknown; heightBand: HeightBand;
      measurements?: { clearanceM?: number; widthM?: number } | null; deviceId: string;
    };
  }>(
    '/hazards',
    {
      schema: {
        body: {
          type: 'object',
          required: ['crop', 'lat', 'lng', 'heightBand', 'deviceId'],
          properties: {
            crop: { type: 'string', minLength: 4, pattern: '^(data:image/[a-z]+;base64,)?[A-Za-z0-9+/]+={0,2}$' },
            lat,
            lng,
            heading: {}, // anything; stored only when a number in [0, 360), never a reason to reject
            heightBand: { type: 'string', enum: HEIGHT_BANDS },
            measurements: {
              type: ['object', 'null'],
              properties: {
                clearanceM: { type: 'number', minimum: 0, maximum: 100 },
                widthM: { type: 'number', minimum: 0, maximum: 100 },
              },
              additionalProperties: false,
            },
            deviceId,
          },
        },
      },
    },
    async (req, reply) => {
      const b = req.body;
      const b64 = b.crop.replace(/^data:image\/[a-z]+;base64,/, '');
      // Encoded length first: the body limit is 1 MB, and Buffer.from would decode all of it.
      const maxB64 = 4 * Math.ceil(CROP_MAX_BYTES / 3);
      if (b64.length > maxB64 || b64.length % 4 !== 0) {
        return reply.code(400).send(badRequest('crop must be base64 JPEG under 200 KB'));
      }
      const bytes = Buffer.from(b64, 'base64');
      if (bytes.length > CROP_MAX_BYTES) {
        return reply.code(400).send(badRequest('crop must be base64 JPEG under 200 KB'));
      }
      const point = { type: 'Point' as const, coordinates: [b.lng, b.lat] as [number, number] };

      // Merge: any active same-band pin within 10 m (band + distance; the type is only known after the renamer).
      // Inside the lock so two reports at one spot cannot both create a pin.
      return serialized(async () => {
        const target = await hazards.findOne(
          {
            status: 'active',
            heightBand: b.heightBand,
            sample: { $ne: true }, // a real report never merges into seed data
            expiresAt: { $gt: new Date() },
            location: { $nearSphere: { $geometry: point, $maxDistance: MERGE_RADIUS_M } },
          },
          { projection: { crop: 0 } },
        );
        if (target && (await castVote(target, b.deviceId, 'up', 'walker'))) { // gone mid-request: create instead
          return { id: target._id.toHexString(), label: spokenLabels(target).spokenLabel_en, merged: true };
        }

        const now = new Date();
        const user = await ensureUser(b.deviceId);
        const weight = voteWeight(user.karma);
        // Never named inline (latency): a generic obstacle that the renamer names within seconds.
        const category: Category = 'temporary';
        const doc: HazardDoc = {
          _id: new ObjectId(),
          type: OBSTACLE,
          category,
          heightBand: b.heightBand, // the phone's depth-derived band; the renamer never changes it
          location: point,
          heading: typeof b.heading === 'number' && b.heading >= 0 && b.heading < 360 ? b.heading : null,
          measurements: b.measurements ?? null,
          crop: new Binary(bytes),
          meshUrl: null,
          severity: 2,
          ...labelsFor(OBSTACLE, b.heightBand),
          needsNaming: true,
          confidence: weight,
          status: 'active',
          sample: false,
          createdBy: b.deviceId,
          createdAt: now,
          lastSeen: now,
          expiresAt: new Date(now.getTime() + LIFESPAN_MS[category]),
        };
        // ponytail: hazard + creator vote are two writes, not a transaction; a crash between them
        // leaves a pin whose confidence is not backed by a vote until the next vote recomputes it.
        await hazards.insertOne(doc);
        await votes.insertOne({ hazardId: doc._id, deviceId: b.deviceId, vote: 'up', source: 'walker', weight, at: now });
        return { id: doc._id.toHexString(), label: spokenLabels(doc).spokenLabel_en, merged: false };
      });
    },
  );

  app.get<{ Querystring: { lat: number; lng: number; radius_m: number; heading?: number } }>(
    '/hazards/near',
    {
      schema: {
        querystring: {
          type: 'object',
          required: ['lat', 'lng'],
          properties: {
            lat,
            lng,
            radius_m: { type: 'number', minimum: 1, maximum: 5000, default: 200 },
            heading: { type: 'number' }, // accepted, ignored for now
          },
        },
      },
    },
    async (req) => {
      const { lat: la, lng: ln, radius_m } = req.query;
      const docs = await hazards
        .aggregate<HazardDoc & { distanceM: number }>([
          {
            $geoNear: {
              near: { type: 'Point', coordinates: [ln, la] },
              key: 'location',
              distanceField: 'distanceM',
              maxDistance: radius_m,
              spherical: true,
              query: { status: 'active', expiresAt: { $gt: new Date() } },
            },
          },
          { $limit: NEAR_MAX_ROWS },
          { $project: { crop: 0 } },
        ])
        .toArray();
      return docs.map((d) => summary(d, d.distanceM));
    },
  );

  app.get<{ Params: { id: string } }>('/hazards/:id', { schema: { params: idParams } }, async (req, reply) => {
    const _id = toId(req.params.id);
    const h = _id && (await hazards.findOne({ _id }));
    if (!h) return reply.code(404).send(notFound);
    const [voteList, pending] = await Promise.all([
      votes.find({ hazardId: h._id }).sort({ at: 1 }).toArray(),
      reclass
        .aggregate<{ _id: { type: string | null; category: string | null; heightBand: string | null }; count: number }>([
          { $match: { hazardId: h._id } },
          { $group: { _id: { type: '$type', category: '$category', heightBand: '$heightBand' }, count: { $sum: 1 } } },
          { $sort: { count: -1 } },
        ])
        .toArray(),
    ]);
    return {
      ...summary(h),
      measurements: h.measurements ?? null,
      crop: h.crop ? h.crop.toString('base64') : null,
      meshUrl: null,
      spokenLabel_es: spokenLabels(h).spokenLabel_es,
      severity: h.severity,
      createdAt: h.createdAt.toISOString(),
      expiresAt: h.expiresAt.toISOString(),
      votes: voteList.map((v) => ({
        deviceId: publicId(v.deviceId), vote: v.vote, source: v.source, weight: v.weight, at: v.at.toISOString(),
      })),
      pendingReclassifications: pending.map(({ _id: p, count }) => ({
        ...(p.type ? { type: p.type } : {}),
        ...(p.category ? { category: p.category } : {}),
        ...(p.heightBand ? { heightBand: p.heightBand } : {}),
        count,
      })),
    };
  });

  app.post<{ Params: { id: string }; Body: { vote: Vote; source: Source; deviceId: string } }>(
    '/hazards/:id/votes',
    {
      schema: {
        params: idParams,
        body: {
          type: 'object',
          required: ['vote', 'source', 'deviceId'],
          properties: {
            vote: { type: 'string', enum: ['up', 'down'] },
            source: { type: 'string', enum: ['walker', 'scout', 'verifier'] },
            deviceId,
          },
        },
      },
    },
    async (req, reply) => {
      const _id = toId(req.params.id);
      const h = _id && (await hazards.findOne({ _id }, { projection: { crop: 0 } }));
      if (!h) return reply.code(404).send(notFound);
      // ponytail: status is read before castVote, so a vote racing the clearing vote can still land; harmless (karma settles once)
      if (h.status === 'cleared') return reply.code(400).send(badRequest('hazard cleared'));
      const res = await castVote(h, req.body.deviceId, req.body.vote, req.body.source);
      return res ?? reply.code(404).send(notFound);
    },
  );

  app.post<{ Params: { id: string }; Body: { type?: string; category?: Category; heightBand?: HeightBand; deviceId: string } }>(
    '/hazards/:id/reclassify',
    {
      schema: {
        params: idParams,
        body: {
          type: 'object',
          required: ['deviceId'],
          anyOf: [{ required: ['type'] }, { required: ['category'] }, { required: ['heightBand'] }],
          properties: {
            type: { type: 'string', enum: TYPE_IDS }, // a taxonomy id (GET /taxonomy); free text never becomes a label
            category: { type: 'string', enum: CATEGORIES },
            heightBand: { type: 'string', enum: HEIGHT_BANDS },
            deviceId,
          },
        },
      },
    },
    async (req, reply) => {
      const _id = toId(req.params.id);
      const h = _id &&
        (await hazards.findOne({ _id }, { projection: { _id: 1, status: 1, lastSeen: 1, type: 1, heightBand: 1, lockedFields: 1, humanLocked: 1 } }));
      if (!h) return reply.code(404).send(notFound);
      const b = req.body;
      const proposal = {
        type: b.type ?? null,
        category: b.category ?? null,
        heightBand: b.heightBand ?? null,
      };
      if (!proposal.type && !proposal.category && !proposal.heightBand) {
        return reply.code(400).send(badRequest('proposal is empty'));
      }
      await ensureUser(b.deviceId);
      await reclass.replaceOne(
        { hazardId: h._id, deviceId: b.deviceId },
        { hazardId: h._id, deviceId: b.deviceId, ...proposal, at: new Date() },
        { upsert: true },
      );
      const agreeing = await reclass.countDocuments({ hazardId: h._id, ...proposal });
      if (agreeing < 3) return { applied: false, agreeing };
      // lock only what people chose; the renamer never overrides those fields
      const chosen = (['type', 'category', 'heightBand'] as const).filter((f) => proposal[f]);
      const set: Partial<HazardDoc> = {
        needsNaming: true, renameAttempts: 0, lockedFields: [...new Set([...lockedFields(h), ...chosen])].sort(),
        ...spokenLabels({ type: proposal.type ?? h.type, heightBand: proposal.heightBand ?? h.heightBand }),
      };
      if (proposal.type) set.type = proposal.type;
      if (proposal.category) {
        set.category = proposal.category;
        // ponytail: concurrent category changes/upvotes can race on expiresAt; last writer wins
        if (h.status === 'active') set.expiresAt = expiryAfterCategoryChange(h.lastSeen, proposal.category);
      }
      if (proposal.heightBand) set.heightBand = proposal.heightBand;
      await hazards.updateOne({ _id: h._id }, { $set: set });
      await reclass.deleteMany({ hazardId: h._id });
      return { applied: true, agreeing };
    },
  );

  app.post<{ Params: { id: string }; Body: { reason: string; deviceId: string } }>(
    '/hazards/:id/report',
    {
      schema: {
        params: idParams,
        body: {
          type: 'object',
          required: ['reason', 'deviceId'],
          properties: { reason: { type: 'string', enum: ['spam', 'abuse', 'other'] }, deviceId },
        },
      },
    },
    async (req, reply) => {
      const _id = toId(req.params.id);
      const h = _id && (await hazards.findOne({ _id }, { projection: { _id: 1 } }));
      if (!h) return reply.code(404).send(notFound);
      await ensureUser(req.body.deviceId);
      // ponytail: reports are only stored; no moderation queue or -5 karma for upheld reports yet.
      // One row per device: a double-tap replaces the reason instead of inserting another open report.
      const report = { hazardId: h._id, deviceId: req.body.deviceId, reason: req.body.reason, status: 'open', at: new Date() };
      const filter = { hazardId: h._id, deviceId: req.body.deviceId };
      try {
        await reports.replaceOne(filter, report, { upsert: true });
      } catch (err) {
        if ((err as { code?: number }).code !== 11000) throw err;
        await reports.replaceOne(filter, report); // the other upsert won the unique index
      }
      return { ok: true };
    },
  );

  app.get<{ Params: { deviceId: string } }>(
    '/users/:deviceId',
    { schema: { params: { type: 'object', properties: { deviceId }, required: ['deviceId'] } } },
    async (req) => {
      const id = req.params.deviceId;
      const u = await users.findOne({ deviceId: id });
      return u ? { displayName: u.displayName, karma: u.karma } : { displayName: defaultName(id), karma: 0 };
    },
  );

  const taxonomyJson = JSON.stringify(TAXONOMY);
  app.get('/taxonomy', async (_req, reply) =>
    reply.type('application/json').header('cache-control', 'public, max-age=3600').send(taxonomyJson));

  // TTS budgets protect the ElevenLabs quota; they count only cache misses (hits never reach ElevenLabs).
  // ponytail: in-memory like the rate limit, so a restart resets the daily count.
  const ttsDay = { day: '', chars: 0, perIp: new Map<string, number>() }; // perIp is cleared daily
  app.get<{ Querystring: { text: string; lang: TtsLang } }>(
    '/tts',
    {
      schema: {
        querystring: {
          type: 'object',
          required: ['text'],
          // lang is validated for the contract but unused: the multilingual model detects the language
          properties: { text: { type: 'string', maxLength: 2000 }, lang: { type: 'string', enum: TTS_LANGS, default: 'en' } },
        },
      },
    },
    async (req, reply) => {
      const text = normalizeTtsText(req.query.text);
      if (!text || text.length > TTS_MAX_CHARS) {
        return reply.code(400).send(badRequest(`text must be 1-${TTS_MAX_CHARS} characters`));
      }
      if (!tts) return reply.code(503).send({ error: 'tts_unavailable' });
      const charge = (chars: number) => {
        const today = new Date().toISOString().slice(0, 10);
        if (ttsDay.day !== today) Object.assign(ttsDay, { day: today, chars: 0, perIp: new Map() });
        const ip = clientIp(req);
        const ipChars = ttsDay.perIp.get(ip) ?? 0;
        if (chars < 0) {
          // Refund a reservation after a failed upstream call. Does not touch the per-minute miss counter.
          ttsDay.chars = Math.max(0, ttsDay.chars + chars);
          const next = Math.max(0, ipChars + chars);
          if (next === 0) ttsDay.perIp.delete(ip);
          else ttsDay.perIp.set(ip, next);
          return true;
        }
        if (ttsDay.chars + chars > ttsDailyChars || ipChars + chars > ttsIpDailyChars) return false;
        if (over(`ttsmiss:${ip}`, ttsMissPerMin, Date.now())) return false;
        ttsDay.chars += chars;
        ttsDay.perIp.set(ip, ipChars + chars);
        return true;
      };
      try {
        const audio = await tts(text, charge);
        return reply.type('audio/mpeg').header('cache-control', 'public, max-age=86400').send(audio);
      } catch (err) {
        if (err instanceof TtsBudgetError) return reply.code(429).send({ error: 'tts_budget' });
        req.log.warn({ err }, 'tts failed');
        return reply.code(502).send({ error: 'tts_failed' });
      }
    },
  );

  // ---- live events: one change stream fanned out to every SSE client ----
  const clients = new Map<ServerResponse, string>(); // response -> client IP
  const perIp = new Map<string, number>();
  let stream: ChangeStream | null = null;
  let lastToken: ResumeToken | undefined;
  let retry: NodeJS.Timeout | undefined;
  let ping: NodeJS.Timeout | undefined;
  let closing = false;
  let markReady: () => void = () => {};
  app.decorate('eventsReady', new Promise<void>((r) => (markReady = r)));

  const drop = (c: ServerResponse) => {
    const ip = clients.get(c);
    if (ip === undefined) return;
    clients.delete(c);
    const n = (perIp.get(ip) ?? 1) - 1;
    if (n > 0) perIp.set(ip, n);
    else perIp.delete(ip);
    c.destroy();
  };
  /** Writes to one client; a closed socket, a throw, or a full buffer (slow reader) drops it. */
  const send = (c: ServerResponse, msg: string) => {
    try {
      if (c.destroyed || c.writableEnded || !c.write(msg)) drop(c);
    } catch {
      drop(c);
    }
  };
  const broadcast = (payload: unknown) => {
    const msg = `event: hazard\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const c of [...clients.keys()]) send(c, msg);
  };

  function startStream() {
    if (closing) return;
    stream = hazards.watch([{ $project: { 'fullDocument.crop': 0 } }], {
      fullDocument: 'updateLookup',
      ...(lastToken ? { startAfter: lastToken } : {}),
    });
    // the driver only forwards resumeTokenChanged/end/close from its cursor; the first token means the stream is open
    stream.on('resumeTokenChanged', (token) => {
      lastToken = token;
      markReady();
    });
    stream.on('change', (ch) => {
      lastToken = ch._id;
      if (ch.operationType === 'delete') broadcast({ op: 'remove', id: ch.documentKey._id.toHexString() });
      else if ((ch.operationType === 'insert' || ch.operationType === 'update' || ch.operationType === 'replace') && ch.fullDocument)
        broadcast({ op: 'upsert', hazard: summary(ch.fullDocument as HazardDoc) });
    });
    stream.on('error', (err) => {
      app.log.warn({ err }, 'hazards change stream failed; retrying in 2 s');
      if ((err as { code?: number }).code === 286) lastToken = undefined; // ChangeStreamHistoryLost: start fresh
      stream?.close().catch(() => {});
      clearTimeout(retry);
      if (!closing) {
        retry = setTimeout(startStream, 2000);
        retry.unref();
      }
    });
  }

  app.addHook('onReady', async () => {
    startStream();
    ping = setInterval(() => [...clients.keys()].forEach((c) => send(c, ': ping\n\n')), 15_000);
    ping.unref();
  });
  app.addHook('preClose', async () => {
    closing = true;
    clearTimeout(retry);
    clearInterval(ping);
    for (const c of clients.keys()) c.end();
    clients.clear();
    perIp.clear();
    await stream?.close();
  });

  app.get('/events', (req, reply) => {
    const ip = clientIp(req);
    if (clients.size >= SSE_MAX_CLIENTS || (perIp.get(ip) ?? 0) >= SSE_MAX_PER_IP) {
      return reply.code(429).send({ error: 'rate_limited' });
    }
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 3000\n\n');
    clients.set(res, ip);
    perIp.set(ip, (perIp.get(ip) ?? 0) + 1);
    req.raw.on('close', () => drop(res));
    res.on('error', () => drop(res));
  });

  return app;
}
