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
} from './db.ts';
import type { Namer } from './gemini.ts';

declare module 'fastify' {
  interface FastifyInstance {
    /** Resolves once the /events change stream is open (tests wait on it). */
    eventsReady: Promise<void>;
  }
}

export interface AppOptions {
  db: Db;
  namer: Namer;
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
const RATE_KEYS_MAX = 10_000;
const HOUR_MS = 3600_000;
const RENAME_MAX_ATTEMPTS = 3;
const SSE_MAX_CLIENTS = 200;
const SSE_MAX_PER_IP = 5;
const TYPE_RE = /^[a-z0-9 -]{1,40}$/;
export const UNKNOWN = 'unknown obstacle';

const DEVICE_RE = /^[A-Za-z0-9._:-]{1,128}$/;
const deviceId = { type: 'string', pattern: DEVICE_RE.source };
const lat = { type: 'number', minimum: -90, maximum: 90 };
const lng = { type: 'number', minimum: -180, maximum: 180 };
const idParams = { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] };

export const voteWeight = (karma: number) => 1 + Math.log(1 + Math.max(karma, 0));
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
    label: h.spokenLabel_en,
    sample: h.sample,
    ...(distanceM === undefined ? {} : { distanceM: Math.round(distanceM * 10) / 10 }),
  };
}

/** Expiry after a category change: the new lifespan from lastSeen, but never less than an hour from now. */
export const expiryAfterCategoryChange = (lastSeen: Date, category: Category) =>
  new Date(Math.max(lastSeen.getTime() + LIFESPAN_MS[category], Date.now() + HOUR_MS));

/**
 * Re-asks Gemini for up to `limit` hazards flagged needsNaming (Gemini failed at creation, or people
 * reclassified), least recently attempted first. Once a reclassification applied (humanLocked),
 * type/category/heightBand are never touched; only labels and severity are regenerated, from the crop or,
 * without one, from the type alone. Gives up after RENAME_MAX_ATTEMPTS failures.
 */
export async function renamePending(db: Db, namer: Namer, limit = 5) {
  const hazards = db.collection<HazardDoc>('hazards');
  const pending = await hazards
    .find({ needsNaming: true }, { sort: { renameAttemptAt: 1 }, limit }) // missing renameAttemptAt sorts first
    .toArray();
  let renamed = 0;
  for (const h of pending) {
    const locked = h.humanLocked === true;
    const hint = locked && h.type !== UNKNOWN ? h.type : undefined;
    if (!h.crop && !hint) {
      await hazards.updateOne({ _id: h._id }, { $set: { needsNaming: false } }); // nothing to name from
      continue;
    }
    const attempts = (h.renameAttempts ?? 0) + 1;
    const n = await namer(h.crop ? h.crop.toString('base64') : null, h.heightBand, hint);
    if (!n) {
      await hazards.updateOne(
        { _id: h._id, needsNaming: true },
        { $set: { renameAttempts: attempts, renameAttemptAt: new Date(), needsNaming: attempts < RENAME_MAX_ATTEMPTS } },
      );
      continue;
    }
    const set: Partial<HazardDoc> = {
      spokenLabel_en: n.spokenLabel_en, spokenLabel_es: n.spokenLabel_es, severity: n.severity, needsNaming: false,
      renameAttempts: attempts, renameAttemptAt: new Date(),
    };
    if (!locked) {
      set.type = n.type;
      if (n.category !== h.category) {
        set.category = n.category;
        if (h.status === 'active') set.expiresAt = expiryAfterCategoryChange(h.lastSeen, n.category);
      }
    }
    // filters make a reclassification that landed meanwhile win over this rename
    const res = await hazards.updateOne(
      { _id: h._id, type: h.type, needsNaming: true, ...(locked ? {} : { humanLocked: { $ne: true } }) },
      { $set: set },
    );
    renamed += res.modifiedCount;
  }
  return renamed;
}

export function buildApp({
  db, namer, rateLimitPerMin = 30, getRateLimitPerMin = 300, ipWriteRateLimitPerMin = 120, logger = false,
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
  /** Counts a hit; true when the key is over its limit. */
  const over = (key: string, limit: number, now: number) => {
    let w = hits.get(key);
    if (!w || now - w.start >= 60_000) hits.set(key, (w = { start: now, n: 0 }));
    return ++w.n > limit;
  };
  // cf-connecting-ip is trustworthy only because the server binds to 127.0.0.1 behind cloudflared
  const clientIp = (req: FastifyRequest) => {
    const cf = req.headers['cf-connecting-ip'];
    return typeof cf === 'string' ? cf : req.ip;
  };
  app.addHook('preValidation', async (req, reply) => {
    if (req.method === 'OPTIONS' || req.url.startsWith('/health') || req.url.startsWith('/events')) return;
    const now = Date.now();
    if (hits.size > RATE_KEYS_MAX && now - lastSweep > 1000) {
      lastSweep = now;
      for (const [k, w] of hits) if (now - w.start >= 60_000) hits.delete(k); // evict only expired windows
    }
    const ip = clientIp(req);
    let limited: boolean;
    if (req.method === 'GET' || req.method === 'HEAD') {
      limited = over(`get:${ip}`, getRateLimitPerMin, now);
    } else {
      const dev = (req.body as { deviceId?: unknown } | undefined)?.deviceId;
      const devKey = typeof dev === 'string' && DEVICE_RE.test(dev) ? `dev:${dev}` : `ipdev:${ip}`;
      // count both buckets so one IP rotating deviceIds still hits the per-IP cap
      const ipOver = over(`wip:${ip}`, ipWriteRateLimitPerMin, now);
      limited = over(devKey, rateLimitPerMin, now) || ipOver;
    }
    if (limited) return reply.code(429).send({ error: 'rate_limited' });
  });

  // ---- one global mutex around the final merge re-check + insert so concurrent reports cannot duplicate pins ----
  // Gemini runs outside it, so the lock is held only for a couple of DB round trips.
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
    const weight = voteWeight(user.karma) * (vote === 'down' && source === 'walker' ? 0.5 : 1);
    const now = new Date();
    await votes.replaceOne(
      { hazardId: h._id, deviceId: dev },
      { hazardId: h._id, deviceId: dev, vote, source, weight, at: now },
      { upsert: true },
    );
    // ponytail: recompute-then-set can lose a concurrent vote's contribution until the next vote;
    // switch to a $inc of the signed delta if votes on one hazard ever race in practice.
    const [agg] = await votes
      .aggregate<{ c: number }>([
        { $match: { hazardId: h._id } },
        { $group: { _id: null, c: { $sum: { $cond: [{ $eq: ['$vote', 'up'] }, '$weight', { $multiply: ['$weight', -1] }] } } } },
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
    if (updated.status === 'active' && confidence < -2) {
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
      const bytes = Buffer.from(b64, 'base64');
      if (b64.length % 4 !== 0 || bytes.length > CROP_MAX_BYTES) {
        return reply.code(400).send(badRequest('crop must be base64 JPEG under 200 KB'));
      }
      const point = { type: 'Point' as const, coordinates: [b.lng, b.lat] as [number, number] };

      // Merge: any active same-band pin within 10 m. Type is unknown before Gemini, and the
      // brief says to skip Gemini when a merge target exists, so band + distance decides.
      const tryMerge = async () => {
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
        if (!target || !(await castVote(target, b.deviceId, 'up', 'walker'))) return null; // gone mid-request: create instead
        return { id: target._id.toHexString(), label: target.spokenLabel_en, merged: true };
      };

      const early = await tryMerge();
      if (early) return early;
      const naming = await namer(b64, b.heightBand); // outside the lock: can take up to 4 s
      return serialized(async () => {
        const late = await tryMerge(); // another report may have landed while Gemini ran
        if (late) return late;

        const now = new Date();
        const user = await ensureUser(b.deviceId);
        const weight = voteWeight(user.karma);
        const category: Category = naming?.category ?? 'temporary';
        const doc: HazardDoc = {
          _id: new ObjectId(),
          type: naming?.type ?? UNKNOWN,
          category,
          heightBand: b.heightBand, // the phone's depth-derived band beats the model's guess
          location: point,
          heading: typeof b.heading === 'number' && b.heading >= 0 && b.heading < 360 ? b.heading : null,
          measurements: b.measurements ?? null,
          crop: new Binary(bytes),
          meshUrl: null,
          severity: naming?.severity ?? 2,
          spokenLabel_en: naming?.spokenLabel_en ?? UNKNOWN,
          spokenLabel_es: naming?.spokenLabel_es ?? 'obstáculo desconocido',
          needsNaming: !naming,
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
        return { id: doc._id.toHexString(), label: doc.spokenLabel_en, merged: false };
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
      spokenLabel_es: h.spokenLabel_es,
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
            type: { type: 'string', minLength: 1, maxLength: 60 }, // content checked against TYPE_RE below
            category: { type: 'string', enum: CATEGORIES },
            heightBand: { type: 'string', enum: HEIGHT_BANDS },
            deviceId,
          },
        },
      },
    },
    async (req, reply) => {
      const _id = toId(req.params.id);
      const h = _id && (await hazards.findOne({ _id }, { projection: { _id: 1, status: 1, lastSeen: 1 } }));
      if (!h) return reply.code(404).send(notFound);
      const b = req.body;
      const proposal = {
        type: b.type?.trim().toLowerCase().replace(/\s+/g, ' ') || null,
        category: b.category ?? null,
        heightBand: b.heightBand ?? null,
      };
      if (b.type !== undefined && !(proposal.type && TYPE_RE.test(proposal.type))) {
        return reply.code(400).send(badRequest('type must be 1-40 characters of a-z, 0-9, space or hyphen'));
      }
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
      // humanLocked: the renamer may regenerate labels but never override what people chose
      const set: Partial<HazardDoc> = { needsNaming: true, humanLocked: true, renameAttempts: 0 };
      // the type is only a placeholder label until the renamer writes real EN/ES labels
      if (proposal.type) Object.assign(set, { type: proposal.type, spokenLabel_en: proposal.type, spokenLabel_es: proposal.type });
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
      await reports.insertOne({ hazardId: h._id, deviceId: req.body.deviceId, reason: req.body.reason, status: 'open', at: new Date() });
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
