import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { MongoClient, ObjectId, type Db } from 'mongodb';
import type { FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import { buildApp, ipKey, renamePending, voteWeight } from '../src/app.ts';
import { ensureIndexes } from '../src/db.ts';
import type { Naming } from '../src/gemini.ts';
import { ollamaNamer } from '../src/namer.ts';
import { elevenLabsTts, envBudget, TtsBudgetError, type Tts } from '../src/tts.ts';
import { TAXONOMY } from '../src/taxonomy.ts';
import { PROBES } from './probes.ts';

const CROP = Buffer.from('not-really-a-jpeg').toString('base64');
const BASE = { lat: 25.7566, lng: -80.3739 };
const M_PER_DEG = (6378100 * Math.PI) / 180; // Mongo's spherical earth radius
const north = (m: number) => BASE.lat + m / M_PER_DEG;

const SCOOTER: Naming = {
  type: 'e-scooter', category: 'moving', heightBand: 'ground', severity: 2,
};

let rs: MongoMemoryReplSet;
let client: MongoClient;
let db: Db;
let app: FastifyInstance;
let naming: Naming | null;
let namerCalls = 0;

let lastNamerArgs: unknown[] = [];
const namer = async (...args: unknown[]) => {
  namerCalls++;
  lastNamerArgs = args;
  return naming;
};
const hashId = (id: string) => createHash('sha256').update(id).digest('hex').slice(0, 10);

beforeAll(async () => {
  rs = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  client = await MongoClient.connect(rs.getUri());
  db = client.db('stepsafe_test');
  await ensureIndexes(db);
  app = buildApp({ db, rateLimitPerMin: 100_000, ipWriteRateLimitPerMin: 100_000 });
  await app.ready();
}, 120_000);

afterAll(async () => {
  await app?.close();
  await client?.close();
  await rs?.stop();
});

beforeEach(async () => {
  naming = SCOOTER;
  namerCalls = 0;
  await Promise.all(['hazards', 'votes', 'users', 'reclassifications', 'reports'].map((c) => db.collection(c).deleteMany({})));
});

async function create(body: Record<string, unknown> = {}) {
  const res = await app.inject({
    method: 'POST',
    url: '/hazards',
    payload: { crop: CROP, ...BASE, heading: 90, heightBand: 'ground', deviceId: 'dev-A', ...body },
  });
  return { status: res.statusCode, body: res.json() };
}
const vote = (id: string, deviceId: string, v: 'up' | 'down', source = 'scout') =>
  app.inject({ method: 'POST', url: `/hazards/${id}/votes`, payload: { vote: v, source, deviceId } }).then((r) => r.json());
const detail = (id: string) => app.inject({ url: `/hazards/${id}` }).then((r) => r.json());

describe('POST /hazards', () => {
  it('creates an "obstacle" with needsNaming at once, never calling the namer', async () => {
    const { status, body } = await create({ measurements: { clearanceM: 1.8 } });
    expect(status).toBe(200);
    expect(body).toEqual({ id: expect.any(String), label: 'obstacle', merged: false });
    expect(namerCalls).toBe(0);
    const d = await detail(body.id);
    expect(d).toMatchObject({
      id: body.id, type: 'obstacle', category: 'temporary', heightBand: 'ground', status: 'active',
      lat: BASE.lat, lng: BASE.lng, confidence: 1, sample: false, label: 'obstacle',
      spokenLabel_es: 'obstáculo', severity: 2, meshUrl: null, crop: CROP,
      measurements: { clearanceM: 1.8 }, pendingReclassifications: [],
    });
    expect(d.votes).toHaveLength(1);
    expect(d.votes[0]).toMatchObject({ deviceId: hashId('dev-A'), vote: 'up', source: 'walker', weight: 1 });
    const lifespan = new Date(d.expiresAt).getTime() - new Date(d.createdAt).getTime();
    expect(lifespan).toBe(7 * 24 * 3600_000); // temporary
    expect(await db.collection('hazards').findOne({ _id: new ObjectId(body.id) })).toMatchObject({ needsNaming: true });
  });

  it('labels the fallback for the phone band, even for a crop the model would call a person', async () => {
    naming = { type: 'person', category: 'moving', heightBand: 'ground', severity: 2 };
    const head = await create({ heightBand: 'head' });
    expect(head.body).toMatchObject({ label: 'obstacle at head height', merged: false });
    const drop = await create({ heightBand: 'dropoff', lat: north(50), deviceId: 'dev-B' });
    expect(drop.body).toMatchObject({ label: 'drop-off', merged: false });
    expect(await db.collection('hazards').countDocuments({ type: 'obstacle', needsNaming: true })).toBe(2);
    expect(namerCalls).toBe(0);
  });

  it('the renamer names the new obstacle later', async () => {
    const { body } = await create();
    expect(await renamePending(db, namer)).toBe(1);
    expect(namerCalls).toBe(1);
    expect(await detail(body.id)).toMatchObject({ type: 'e-scooter', category: 'moving', label: 'e-scooter', spokenLabel_es: 'patinete eléctrico' });
    expect(await db.collection('hazards').findOne({ _id: new ObjectId(body.id) })).toMatchObject({ needsNaming: false });
    // a later report merges into the named pin and gets its real name back
    const merged = await create({ lat: north(8), deviceId: 'dev-B' });
    expect(merged.body).toEqual({ id: body.id, label: 'e-scooter', merged: true });
  });

  it('merges a same-band report within 10 m as an upvote', async () => {
    const first = await create();
    const second = await create({ lat: north(8), deviceId: 'dev-B' });
    expect(second.body).toEqual({ id: first.body.id, label: 'obstacle', merged: true });
    expect(namerCalls).toBe(0);
    expect((await detail(first.body.id)).confidence).toBeCloseTo(2);
    expect(await db.collection('hazards').countDocuments()).toBe(1);
  });

  it('does not merge at 15 m or across height bands', async () => {
    const first = await create();
    const far = await create({ lat: north(15), deviceId: 'dev-B' });
    const otherBand = await create({ heightBand: 'head', deviceId: 'dev-C' });
    expect(far.body.merged).toBe(false);
    expect(otherBand.body.merged).toBe(false);
    expect(new Set([first.body.id, far.body.id, otherBand.body.id]).size).toBe(3);
  });

  it('rejects bad input with 400', async () => {
    for (const bad of [
      { lat: 91 },
      { lng: -181 },
      { heightBand: 'knee' },
      { crop: 'not base64!!' },
      { crop: 'A'.repeat(300_000) },
      { deviceId: undefined },
      { measurements: { clearanceM: -1 } },
      { lat: null },
      { lng: null },
      { lat: '25.75' },
      { heightBand: null },
    ]) {
      const { status, body } = await create(bad);
      expect(status, JSON.stringify(bad).slice(0, 60)).toBe(400);
      expect(body.error).toBe('bad_request');
    }
    const near = await app.inject({ url: '/hazards/near?lat=abc&lng=1' });
    expect(near.statusCode).toBe(400);
    const voteRes = await app.inject({ method: 'POST', url: `/hazards/${new ObjectId()}/votes`, payload: { vote: 'sideways', source: 'walker', deviceId: 'x' } });
    expect(voteRes.statusCode).toBe(400);
    const oldSource = await app.inject({ method: 'POST', url: `/hazards/${new ObjectId()}/votes`, payload: { vote: 'up', source: 'spotter', deviceId: 'x' } });
    expect(oldSource.statusCode).toBe(400); // role renamed to scout
  });
});

describe('votes', () => {
  it('a passive walker miss weighs a fixed 0.6: 1 -> 0.4, the same device again stays 0.4, a second device clears', async () => {
    const { body } = await create();
    await db.collection('users').insertOne({ deviceId: 'dev-B', displayName: 'B', karma: 3 }); // karma does not scale it
    const first = await vote(body.id, 'dev-B', 'down', 'walker');
    expect(first.status).toBe('active');
    expect(first.confidence).toBeCloseTo(0.4, 9);
    const again = await vote(body.id, 'dev-B', 'down', 'walker'); // one vote per device per pin
    expect(again.status).toBe('active');
    expect(again.confidence).toBeCloseTo(0.4, 9);
    const d = await detail(body.id);
    expect(d.votes).toHaveLength(2);
    expect(d.votes.find((v: { vote: string }) => v.vote === 'down').weight).toBe(0.6);
    const second = await vote(body.id, 'dev-C', 'down', 'walker');
    expect(second.status).toBe('cleared');
    expect(second.confidence).toBeCloseTo(-0.2, 9);
  });

  it('a scout down-vote still uses the karma weight; re-votes replace', async () => {
    const first = await create();
    await db.collection('users').insertOne({ deviceId: 'dev-B', displayName: 'B', karma: 3 });
    const wB = voteWeight(3);
    expect(wB).toBeCloseTo(1 + Math.log(4));
    expect((await vote(first.body.id, 'dev-B', 'up')).confidence).toBeCloseTo(1 + wB);
    const res = await vote(first.body.id, 'dev-B', 'down'); // replaces dev-B's upvote
    expect(res.confidence).toBeCloseTo(1 - wB);
    expect(res.status).toBe('cleared');
    expect((await detail(first.body.id)).votes).toHaveLength(2);

    const second = await create({ lat: north(50), deviceId: 'dev-X' });
    expect(await vote(second.body.id, 'dev-C', 'down')).toEqual({ confidence: 0, status: 'active' }); // weight 1: not below 0
  });

  it('clears below 0 and settles karma', async () => {
    const { body } = await create();
    expect(await vote(body.id, 'dev-B', 'down')).toEqual({ confidence: 0, status: 'active' });
    const res = await vote(body.id, 'dev-C', 'down');
    expect(res).toEqual({ confidence: -1, status: 'cleared' });

    const karma = Object.fromEntries((await db.collection('users').find().toArray()).map((u) => [u.deviceId, u.karma]));
    expect(karma).toEqual({ 'dev-A': -1, 'dev-B': 1, 'dev-C': 1 });
    const d = await detail(body.id);
    expect(d.status).toBe('cleared');
    expect(new Date(d.expiresAt).getTime() - Date.now()).toBeGreaterThan(23.9 * 3600_000);
    // votes on a cleared hazard are rejected, so karma cannot settle twice
    const again = await app.inject({ method: 'POST', url: `/hazards/${body.id}/votes`, payload: { vote: 'down', source: 'scout', deviceId: 'dev-F' } });
    expect(again.statusCode).toBe(400);
    expect(again.json()).toEqual({ error: 'bad_request', message: 'hazard cleared' });
    expect((await db.collection('users').findOne({ deviceId: 'dev-B' }))!.karma).toBe(1);
    // cleared hazards drop out of /near
    const near = await app.inject({ url: `/hazards/near?lat=${BASE.lat}&lng=${BASE.lng}` });
    expect(near.json()).toEqual([]);
  });

  it('404s for unknown or malformed ids', async () => {
    for (const id of [new ObjectId().toHexString(), 'nope']) {
      const res = await app.inject({ method: 'POST', url: `/hazards/${id}/votes`, payload: { vote: 'up', source: 'walker', deviceId: 'x' } });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: 'not_found' });
      expect((await app.inject({ url: `/hazards/${id}` })).statusCode).toBe(404);
    }
  });
});

describe('reclassify, report, users', () => {
  it('applies when 3 devices agree on the identical change, keeping votes', async () => {
    const { body } = await create();
    const propose = (deviceId: string, p: Record<string, string>) =>
      app.inject({ method: 'POST', url: `/hazards/${body.id}/reclassify`, payload: { ...p, deviceId } }).then((r) => r.json());
    const change = { type: 'trash-bin', category: 'moving' };
    expect(await propose('dev-B', change)).toEqual({ applied: false, agreeing: 1 });
    expect(await propose('dev-C', { type: 'trash-bin' })).toEqual({ applied: false, agreeing: 1 }); // differs: no category
    expect(await propose('dev-B', change)).toEqual({ applied: false, agreeing: 1 }); // same device again
    expect((await detail(body.id)).pendingReclassifications).toEqual(
      expect.arrayContaining([{ type: 'trash-bin', category: 'moving', count: 1 }, { type: 'trash-bin', count: 1 }]),
    );
    expect(await propose('dev-D', change)).toEqual({ applied: false, agreeing: 2 });
    expect(await propose('dev-E', change)).toEqual({ applied: true, agreeing: 3 });
    const d = await detail(body.id);
    expect(d).toMatchObject({
      type: 'trash-bin', category: 'moving', heightBand: 'ground', label: 'trash bin', spokenLabel_es: 'cubo de basura',
      pendingReclassifications: [],
    });
    expect(d.votes).toHaveLength(1);
    const h = (await db.collection('hazards').findOne({ _id: new ObjectId(body.id) }))!;
    expect(h.needsNaming).toBe(true);
    expect(h.expiresAt.getTime() - h.lastSeen.getTime()).toBe(6 * 3600_000); // moving lifespan from lastSeen

    for (const bad of [{}, { type: '   ' }, { type: '' }, { type: null }, { category: null }]) {
      const res = await app.inject({ method: 'POST', url: `/hazards/${body.id}/reclassify`, payload: { ...bad, deviceId: 'dev-F' } });
      expect(res.statusCode, JSON.stringify(bad)).toBe(400);
    }
  });

  it('stores reports as open, one per device; a second report replaces the reason', async () => {
    const { body } = await create();
    const send = (reason: string) =>
      app.inject({ method: 'POST', url: `/hazards/${body.id}/report`, payload: { reason, deviceId: 'dev-B' } });
    expect((await send('spam')).json()).toEqual({ ok: true });
    expect((await send('abuse')).json()).toEqual({ ok: true });
    const all = await db.collection('reports').find().toArray();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ reason: 'abuse', status: 'open', deviceId: 'dev-B' });
  });

  it('GET /users returns a default for unknown devices without writing', async () => {
    const res = await app.inject({ url: '/users/abcdef-123' });
    expect(res.json()).toEqual({ displayName: 'Neighbor-abcd', karma: 0 });
    expect(await db.collection('users').countDocuments()).toBe(0);
    await create({ deviceId: 'abcdef-123' }); // first write creates the user
    expect(await db.collection('users').countDocuments({ deviceId: 'abcdef-123' })).toBe(1);
    expect((await app.inject({ url: '/users/bad%20id' })).statusCode).toBe(400);
  });

  it('renamer names an "obstacle" but never overrides a reclassified category', async () => {
    naming = null;
    const { body } = await create();
    for (const d of ['dev-B', 'dev-C', 'dev-D']) {
      await app.inject({ method: 'POST', url: `/hazards/${body.id}/reclassify`, payload: { category: 'permanent', deviceId: d } });
    }
    naming = { ...SCOOTER, severity: 3 }; // the model would say moving
    expect(await renamePending(db, namer)).toBe(1);
    const h = (await db.collection('hazards').findOne({ _id: new ObjectId(body.id) }))!;
    expect(h).toMatchObject({
      type: 'e-scooter', category: 'permanent', heightBand: 'ground', lockedFields: ['category'],
      spokenLabel_en: 'e-scooter', severity: 3, needsNaming: false, // type was not chosen by people: named
    });
  });

  it('renamer deletes a fallback obstacle that turns out to be a person or a dog, with its votes', async () => {
    for (const type of ['person', 'dog']) {
      const { body } = await create();
      await create({ lat: north(5), deviceId: 'dev-B' }); // an upvote on the same pin
      expect(await db.collection('votes').countDocuments({ hazardId: new ObjectId(body.id) })).toBe(2);
      naming = { type, category: 'moving', heightBand: 'ground', severity: 2 };
      await renamePending(db, namer);
      expect(await db.collection('hazards').countDocuments(), type).toBe(0);
      expect(await db.collection('votes').countDocuments(), type).toBe(0);
    }
  });

  it('renamer keeps a drop-off with a person in the crop as an obstacle', async () => {
    const { body } = await create({ heightBand: 'dropoff' });
    naming = { type: 'person', category: 'moving', heightBand: 'dropoff', severity: 3 };
    await renamePending(db, namer);
    expect(await db.collection('hazards').countDocuments({ type: 'person' })).toBe(0);
    expect(await db.collection('hazards').findOne({ _id: new ObjectId(body.id) })).toMatchObject({
      type: 'obstacle', category: 'temporary', heightBand: 'dropoff', spokenLabel_en: 'drop-off', severity: 3, needsNaming: false,
    });
  });

  it('renames needsNaming hazards, keeping a people-chosen type', async () => {
    naming = null;
    const unknown = await create();
    const named = await create({ lat: north(50), deviceId: 'dev-B' });
    await db.collection('hazards').updateOne(
      { _id: new ObjectId(named.body.id) },
      { $set: { type: 'bench', lockedFields: ['type'], spokenLabel_en: 'bench', spokenLabel_es: 'banco' } },
    );
    naming = { ...SCOOTER, heightBand: 'head' } as Naming;
    expect(await renamePending(db, namer)).toBe(2);
    const u = (await db.collection('hazards').findOne({ _id: new ObjectId(unknown.body.id) }))!;
    // labels from the taxonomy for the phone's band (ground), not the model's band
    expect(u).toMatchObject({ type: 'e-scooter', category: 'moving', spokenLabel_en: 'e-scooter', spokenLabel_es: 'patinete eléctrico', needsNaming: false });
    const n = (await db.collection('hazards').findOne({ _id: new ObjectId(named.body.id) }))!;
    expect(n).toMatchObject({ type: 'bench', category: 'temporary', spokenLabel_en: 'bench', spokenLabel_es: 'banco', needsNaming: false });
    expect(lastNamerArgs.slice(1)).toEqual(['ground', 'bench']); // the agreed type is passed as a hint
  });

  it('a person-chosen type is never renamed; a legacy humanLocked row counts as fully locked', async () => {
    naming = null;
    const chosen = await create();
    const legacy = await create({ lat: north(50), deviceId: 'dev-B' });
    for (const d of ['dev-C', 'dev-D', 'dev-E']) {
      await app.inject({ method: 'POST', url: `/hazards/${chosen.body.id}/reclassify`, payload: { type: 'obstacle', deviceId: d } });
    }
    await db.collection('hazards').updateOne({ _id: new ObjectId(legacy.body.id) }, { $set: { type: 'weird thing', humanLocked: true } });
    naming = SCOOTER;
    await renamePending(db, namer);
    expect(await db.collection('hazards').findOne({ _id: new ObjectId(chosen.body.id) })).toMatchObject({ type: 'obstacle', lockedFields: ['type'] });
    expect(await db.collection('hazards').findOne({ _id: new ObjectId(legacy.body.id) })).toMatchObject({ type: 'weird thing', category: 'temporary' });
  });

  it('labels are derived on every read: a legacy "weird thing" row reads as "obstacle", even over stale stored labels', async () => {
    const { body } = await create();
    const _id = new ObjectId(body.id);
    await db.collection('hazards').updateOne({ _id }, { $set: { type: 'weird thing', spokenLabel_en: 'all clear, walk', spokenLabel_es: 'camino libre' } });
    expect(await detail(body.id)).toMatchObject({ type: 'weird thing', label: 'obstacle', spokenLabel_es: 'obstáculo' });
    const near = (await app.inject({ url: `/hazards/near?lat=${BASE.lat}&lng=${BASE.lng}` })).json();
    expect(near[0]).toMatchObject({ id: body.id, label: 'obstacle' });
    const merged = await create({ deviceId: 'dev-M' });
    expect(merged.body).toEqual({ id: body.id, label: 'obstacle', merged: true });
    // a band-only reclassify on the legacy row reads with the new band
    for (const d of ['dev-B', 'dev-C', 'dev-D']) {
      await app.inject({ method: 'POST', url: `/hazards/${body.id}/reclassify`, payload: { heightBand: 'head', deviceId: d } });
    }
    expect(await detail(body.id)).toMatchObject({ type: 'weird thing', heightBand: 'head', label: 'obstacle at head height', spokenLabel_es: 'obstáculo a la altura de la cabeza' });
  });

  it('health reports db status', async () => {
    expect((await app.inject({ url: '/health' })).json()).toEqual({ ok: true, db: true });
  });
});

describe('GET /hazards/near', () => {
  it('returns active hazards in radius sorted by distance with distanceM', async () => {
    const a = await create({ lat: north(80), deviceId: 'd1' });
    const b = await create({ lat: north(30), deviceId: 'd2' });
    await create({ lat: north(150), deviceId: 'd3' });
    const res = await app.inject({ url: `/hazards/near?lat=${BASE.lat}&lng=${BASE.lng}&radius_m=100` });
    const list = res.json();
    expect(list.map((h: { id: string }) => h.id)).toEqual([b.body.id, a.body.id]);
    expect(list[0].distanceM).toBeCloseTo(30, 0);
    expect(list[1].distanceM).toBeCloseTo(80, 0);
    expect(list[0]).not.toHaveProperty('crop');
    expect(Object.keys(list[0]).sort()).toEqual(
      ['category', 'confidence', 'distanceM', 'heightBand', 'id', 'label', 'lastSeen', 'lat', 'lng', 'sample', 'status', 'type'].sort(),
    );
    // default radius 200 m includes all three
    expect((await app.inject({ url: `/hazards/near?lat=${BASE.lat}&lng=${BASE.lng}` })).json()).toHaveLength(3);
    expect((await app.inject({ url: `/hazards/near?lat=${BASE.lat}&lng=${BASE.lng}&radius_m=6000` })).statusCode).toBe(400);
  });
});

describe('rate limit', () => {
  const report = (a: FastifyInstance, deviceId: string, ip = '127.0.0.1') =>
    a.inject({ method: 'POST', url: `/hazards/${new ObjectId()}/report`, remoteAddress: ip, payload: { reason: 'spam', deviceId } });

  it('returns 429 after 30 writes per device per minute', async () => {
    const limited = buildApp({ db });
    await limited.ready();
    try {
      for (let i = 0; i < 30; i++) expect((await report(limited, 'dev-rl')).statusCode).toBe(404);
      const res = await report(limited, 'dev-rl');
      expect(res.statusCode).toBe(429);
      expect(res.json()).toEqual({ error: 'rate_limited' });
      expect((await report(limited, 'dev-other')).statusCode).toBe(404);
    } finally {
      await limited.close();
    }
  });

  it('keys invalid deviceIds by IP, and limits GETs per IP separately', async () => {
    const limited = buildApp({ db, rateLimitPerMin: 3, getRateLimitPerMin: 5 });
    await limited.ready();
    try {
      // junk deviceIds cannot mint fresh buckets: all share the IP bucket
      for (const junk of ['bad id 1', 'bad id 2', 'x'.repeat(200)]) expect((await report(limited, junk, '10.0.0.1')).statusCode).toBe(400);
      expect((await report(limited, 'bad id 4', '10.0.0.1')).statusCode).toBe(429);
      expect((await report(limited, 'bad id 5', '10.0.0.2')).statusCode).toBe(400);
      // GETs: per IP, own limit, independent of the write buckets
      for (let i = 0; i < 5; i++) expect((await limited.inject({ url: '/users/dev-g', remoteAddress: '10.0.0.1' })).statusCode).toBe(200);
      expect((await limited.inject({ url: '/users/dev-g2', remoteAddress: '10.0.0.1' })).statusCode).toBe(429);
      expect((await limited.inject({ url: '/users/dev-g', remoteAddress: '10.0.0.3' })).statusCode).toBe(200);
    } finally {
      await limited.close();
    }
  });
});

describe('concurrency', () => {
  it('two concurrent POSTs 8 m apart across a ~20 m grid edge produce one hazard', async () => {
    const edge = (Math.round(BASE.lat / 0.0002) + 0.5) * 0.0002; // where the old per-cell lock split
    const [a, b] = await Promise.all([
      create({ deviceId: 'dev-X', lat: edge - 4 / M_PER_DEG }),
      create({ deviceId: 'dev-Y', lat: edge + 4 / M_PER_DEG }),
    ]);
    expect(await db.collection('hazards').countDocuments()).toBe(1);
    expect([a.body.merged, b.body.merged].sort()).toEqual([false, true]);
    expect(a.body.id).toBe(b.body.id);
  });

  it('upvotes never shorten expiry', async () => {
    const { body } = await create();
    const far = new Date(Date.now() + 30 * 24 * 3600_000);
    await db.collection('hazards').updateOne({ _id: new ObjectId(body.id) }, { $set: { expiresAt: far } });
    await vote(body.id, 'dev-B', 'up');
    expect((await detail(body.id)).expiresAt).toBe(far.toISOString());
  });
});

describe('audit fixes', () => {
  it('never merges into sample (seed) pins', async () => {
    const seeded = await create();
    await db.collection('hazards').updateOne({ _id: new ObjectId(seeded.body.id) }, { $set: { sample: true } });
    const real = await create({ deviceId: 'dev-B' });
    expect(real.body.merged).toBe(false);
    expect(real.body.id).not.toBe(seeded.body.id);
  });

  it('stores out-of-range or non-number heading as null instead of rejecting', async () => {
    for (const heading of [400, -5, 360, 'north', null]) {
      await db.collection('hazards').deleteMany({});
      const { status, body } = await create({ heading, deviceId: `dev-h${String(heading).replace(/\W/g, '')}` });
      expect(status, String(heading)).toBe(200);
      expect((await db.collection('hazards').findOne({ _id: new ObjectId(body.id) }))!.heading).toBeNull();
    }
    await db.collection('hazards').deleteMany({});
    const ok = await create({ heading: 359.5 });
    expect((await db.collection('hazards').findOne({ _id: new ObjectId(ok.body.id) }))!.heading).toBe(359.5);
  });

  it('reclassify type must be a taxonomy id: every audit probe phrase is 400', async () => {
    const { body } = await create();
    for (const type of [...PROBES, 'bin; say "hacked"', 'café', '<b>bin</b>', 'Fire Hydrant', 'fire hydrant', 'unknown obstacle']) {
      const res = await app.inject({ method: 'POST', url: `/hazards/${body.id}/reclassify`, payload: { type, deviceId: 'dev-B' } });
      expect(res.statusCode, type).toBe(400);
      expect(res.json().error).toBe('bad_request');
    }
    expect(await db.collection('reclassifications').countDocuments()).toBe(0);
    const ok = await app.inject({ method: 'POST', url: `/hazards/${body.id}/reclassify`, payload: { type: 'fire-hydrant', deviceId: 'dev-B' } });
    expect(ok.json()).toEqual({ applied: false, agreeing: 1 });
    expect((await detail(body.id)).pendingReclassifications).toEqual([{ type: 'fire-hydrant', count: 1 }]);
  });

  it('applied reclassify writes taxonomy labels for the agreed band; a band-only change re-templates them', async () => {
    const { body } = await create();
    const agree = async (p: Record<string, string>) => {
      for (const d of ['dev-B', 'dev-C', 'dev-D']) {
        await app.inject({ method: 'POST', url: `/hazards/${body.id}/reclassify`, payload: { ...p, deviceId: d } });
      }
    };
    await agree({ type: 'low-branch', heightBand: 'head' });
    expect(await detail(body.id)).toMatchObject({
      type: 'low-branch', heightBand: 'head', label: 'low branch at head height', spokenLabel_es: 'rama baja a la altura de la cabeza',
    });
    await agree({ heightBand: 'dropoff' });
    expect(await detail(body.id)).toMatchObject({ type: 'low-branch', label: 'drop-off', spokenLabel_es: 'desnivel' });
  });

  it('model output never reaches spoken labels, whatever the namer returns', async () => {
    for (const [i, phrase] of PROBES.slice(0, 20).entries()) {
      naming = { type: phrase, category: 'temporary', heightBand: 'ground', severity: 2, spokenLabel_en: phrase, spokenLabel_es: phrase } as unknown as Naming;
      const { body } = await create({ lat: north(20 * (i + 1)), deviceId: `dev-${i}` });
      await renamePending(db, namer);
      expect((await detail(body.id)).label, phrase).toBe('obstacle');
      expect(await db.collection('hazards').findOne({ _id: new ObjectId(body.id) })).toMatchObject({
        type: 'obstacle', spokenLabel_en: 'obstacle', spokenLabel_es: 'obstáculo',
      });
    }
  });

  it('a failed rename does not clear needsNaming that a reclassify reset while the model ran', async () => {
    naming = null;
    const { body } = await create();
    await renamePending(db, namer);
    await renamePending(db, namer); // two failures; the next one would be the give-up
    let started!: () => void;
    const startedP = new Promise<void>((r) => (started = r));
    let release!: (v: null) => void;
    const gate = new Promise<null>((r) => (release = r));
    const pending = renamePending(db, async () => {
      started();
      return gate;
    }, 1);
    await startedP;
    for (const d of ['dev-B', 'dev-C', 'dev-D']) {
      await app.inject({ method: 'POST', url: `/hazards/${body.id}/reclassify`, payload: { category: 'permanent', deviceId: d } });
    }
    release(null);
    await pending;
    const h = await db.collection('hazards').findOne({ _id: new ObjectId(body.id) });
    expect(h).toMatchObject({
      category: 'permanent', lockedFields: ['category'], needsNaming: true, renameAttempts: 0,
    });
  });

  it('renamer gives up after 3 failed attempts and tries least recently attempted first', async () => {
    naming = null;
    const a = await create();
    const b = await create({ lat: north(50), deviceId: 'dev-B' });
    const hz = () => db.collection('hazards').find().sort({ _id: 1 }).toArray();
    await renamePending(db, namer, 1);
    let [ha, hb] = await hz();
    expect([ha.renameAttempts ?? 0, hb.renameAttempts ?? 0].sort()).toEqual([0, 1]);
    await renamePending(db, namer, 1); // the unattempted one sorts first
    [ha, hb] = await hz();
    expect([ha.renameAttempts, hb.renameAttempts]).toEqual([1, 1]);
    for (let i = 0; i < 4; i++) await renamePending(db, namer);
    [ha, hb] = await hz();
    expect([ha._id.toHexString(), hb._id.toHexString()]).toEqual([a.body.id, b.body.id]);
    expect(ha).toMatchObject({ renameAttempts: 3, needsNaming: false, type: 'obstacle' });
    expect(hb).toMatchObject({ renameAttempts: 3, needsNaming: false });
  });

  it('a reclassified hazard without a crop keeps its taxonomy labels and is not sent to the model', async () => {
    const { body } = await create();
    const _id = new ObjectId(body.id);
    await db.collection('hazards').updateOne({ _id }, { $set: { crop: null } });
    for (const d of ['dev-B', 'dev-C', 'dev-D']) {
      await app.inject({ method: 'POST', url: `/hazards/${body.id}/reclassify`, payload: { type: 'bench', deviceId: d } });
    }
    expect(await detail(body.id)).toMatchObject({ label: 'bench', spokenLabel_es: 'banco' });
    namerCalls = 0;
    expect(await renamePending(db, namer)).toBe(0);
    expect(namerCalls).toBe(0);
    expect(await db.collection('hazards').findOne({ _id })).toMatchObject({ type: 'bench', spokenLabel_en: 'bench', needsNaming: false });
  });

  it('category change keeps at least an hour of life', async () => {
    const { body } = await create();
    const _id = new ObjectId(body.id);
    await db.collection('hazards').updateOne({ _id }, { $set: { lastSeen: new Date(Date.now() - 10 * 3600_000) } });
    for (const d of ['dev-B', 'dev-C', 'dev-D']) {
      await app.inject({ method: 'POST', url: `/hazards/${body.id}/reclassify`, payload: { category: 'moving', deviceId: d } });
    }
    const left = (await db.collection('hazards').findOne({ _id }))!.expiresAt.getTime() - Date.now();
    expect(left).toBeGreaterThan(59 * 60_000);
    expect(left).toBeLessThanOrEqual(3600_000);
  });

  it('a device already over its cap does not consume the shared IP write budget', async () => {
    const limited = buildApp({ db, rateLimitPerMin: 2, ipWriteRateLimitPerMin: 3 });
    await limited.ready();
    try {
      const post = (deviceId: string) =>
        limited.inject({
          method: 'POST',
          url: `/hazards/${new ObjectId()}/report`,
          remoteAddress: '10.4.0.1',
          payload: { reason: 'spam', deviceId },
        });
      expect((await post('dev-A')).statusCode).toBe(404);
      expect((await post('dev-A')).statusCode).toBe(404);
      expect((await post('dev-A')).statusCode).toBe(429);
      expect((await post('dev-A')).statusCode).toBe(429);
      expect((await post('dev-B')).statusCode).toBe(404);
    } finally {
      await limited.close();
    }
  });

  it('rejects further writes from an exhausted IP before reading the body', async () => {
    const limited = buildApp({ db, ipWriteRateLimitPerMin: 1, rateLimitPerMin: 100 });
    await limited.ready();
    try {
      const post = (payload: string | Record<string, string>) =>
        limited.inject({
          method: 'POST',
          url: `/hazards/${new ObjectId()}/report`,
          remoteAddress: '10.8.0.1',
          headers: { 'content-type': 'application/json' },
          payload,
        });
      expect((await post({ reason: 'spam', deviceId: 'dev-once' })).statusCode).toBe(404);
      const huge = await post('{' + ' '.repeat(1_100_000));
      expect(huge.statusCode).toBe(429);
      expect(huge.json()).toEqual({ error: 'rate_limited' });
    } finally {
      await limited.close();
    }
  });

  it('caps writes per IP even when deviceIds rotate', async () => {
    const limited = buildApp({ db, ipWriteRateLimitPerMin: 4 });
    await limited.ready();
    try {
      const post = (deviceId: string, ip: string) =>
        limited.inject({ method: 'POST', url: `/hazards/${new ObjectId()}/report`, remoteAddress: ip, payload: { reason: 'spam', deviceId } });
      for (let i = 0; i < 4; i++) expect((await post(`rot-${i}`, '10.1.0.1')).statusCode).toBe(404);
      expect((await post('rot-9', '10.1.0.1')).statusCode).toBe(429);
      expect((await post('rot-9', '10.1.0.2')).statusCode).toBe(404);
    } finally {
      await limited.close();
    }
  });

  it('CORS: JSON POST preflight is allowed from any origin', async () => {
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/hazards',
      headers: { origin: 'http://localhost:3000', 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' },
    });
    expect(res.statusCode).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('*');
    expect(String(res.headers['access-control-allow-methods'])).toContain('POST');
    expect(String(res.headers['access-control-allow-headers']).toLowerCase()).toContain('content-type');
  });
});

describe('GET /events', () => {
  it('sends CORS headers and caps connections at 5 per IP', async () => {
    const live = buildApp({ db, rateLimitPerMin: 100_000 });
    const url = await live.listen({ port: 0, host: '127.0.0.1' });
    const abort = new AbortController();
    try {
      for (let i = 0; i < 5; i++) {
        const r = await fetch(`${url}/events`, { signal: abort.signal, headers: { origin: 'http://localhost:3000' } });
        expect(r.status).toBe(200);
        expect(r.headers.get('access-control-allow-origin')).toBe('*');
      }
      const sixth = await fetch(`${url}/events`, { signal: abort.signal });
      expect(sixth.status).toBe(429);
      expect(await sixth.json()).toEqual({ error: 'rate_limited' });
    } finally {
      abort.abort();
      await live.close();
    }
  });
  it('streams an upsert after POST /hazards and a remove after delete', async () => {
    const live = buildApp({ db, rateLimitPerMin: 100_000 });
    const url = await live.listen({ port: 0, host: '127.0.0.1' });
    const abort = new AbortController();
    try {
      const res = await fetch(`${url}/events`, { signal: abort.signal });
      expect(res.headers.get('content-type')).toBe('text/event-stream');
      await live.eventsReady;
      const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
      let buf = '';
      const waitFor = async (needle: string) => {
        const deadline = Date.now() + 10_000;
        while (!buf.includes(needle)) {
          if (Date.now() > deadline) throw new Error(`timed out waiting for ${needle}; got ${buf}`);
          const { value, done } = await reader.read();
          if (done) throw new Error('stream ended');
          buf += value;
        }
      };

      const post = await fetch(`${url}/hazards`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ crop: CROP, ...BASE, heading: 0, heightBand: 'ground', deviceId: 'dev-sse' }),
      });
      const { id } = await post.json();
      await waitFor('"op":"upsert"');
      const frame = buf.split('\n\n').find((f) => f.includes('"op":"upsert"'))!;
      expect(frame).toMatch(/^event: hazard\ndata: /m);
      const data = JSON.parse(frame.split('data: ')[1]);
      expect(data.hazard).toMatchObject({ id, type: 'obstacle', label: 'obstacle', status: 'active' });
      expect(data.hazard).not.toHaveProperty('crop');

      await db.collection('hazards').deleteOne({ _id: new ObjectId(id) });
      await waitFor(`{"op":"remove","id":"${id}"}`);
    } finally {
      abort.abort();
      await live.close();
    }
  }, 20_000);
});

describe('local naming timeout', () => {
  it('a hung Ollama call fails the rename pass quickly and leaves the hazard for the next pass', async () => {
    const hang = ((_u: unknown, init?: RequestInit) =>
      new Promise((_, reject) => init!.signal!.addEventListener('abort', () => reject(new Error('aborted'))))) as typeof fetch;
    const { body } = await create();
    const t = Date.now();
    expect(await renamePending(db, ollamaNamer('http://ollama', 'm', 100, hang))).toBe(0);
    expect(Date.now() - t).toBeLessThan(2000);
    expect(await db.collection('hazards').findOne({ _id: new ObjectId(body.id) })).toMatchObject({
      type: 'obstacle', needsNaming: true, renameAttempts: 1,
    });
  });
});

describe('GET /tts', () => {
  it('answers 503 tts_unavailable without a key, after validating input', async () => {
    const res = await app.inject({ url: '/tts?text=chair%20ahead&lang=en' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ error: 'tts_unavailable' });
  });

  it('validates text (1-200 chars after trim) and lang', async () => {
    for (const q of ['', 'text=', 'text=%20%20%20', `text=${'a'.repeat(201)}`, 'text=hi&lang=fr', 'text=a&text=b']) {
      const res = await app.inject({ url: `/tts?${q}` });
      expect(res.statusCode, q).toBe(400);
      expect(res.json().error).toBe('bad_request');
    }
  });

  it('streams audio/mpeg, normalizes text, and maps upstream failure to 502', async () => {
    const calls: string[] = [];
    let fail = false;
    const tts: Tts = async (text) => {
      calls.push(text);
      if (fail) throw new Error('upstream 500');
      return Buffer.from([0xff, 0xf3, 7]);
    };
    const withTts = buildApp({ db, tts, rateLimitPerMin: 100_000 });
    try {
      const ok = await withTts.inject({ url: `/tts?text=${encodeURIComponent(' \u0000 silla \t  adelante ')}&lang=es` });
      expect(ok.statusCode).toBe(200);
      expect(ok.headers['content-type']).toBe('audio/mpeg');
      expect([...ok.rawPayload]).toEqual([0xff, 0xf3, 7]);
      await withTts.inject({ url: `/tts?text=chair` });
      expect(calls).toEqual(['silla adelante', 'chair']);
      expect((await withTts.inject({ url: `/tts?text=${'a'.repeat(200)}` })).statusCode).toBe(200);
      fail = true;
      const bad = await withTts.inject({ url: '/tts?text=chair' });
      expect(bad.statusCode).toBe(502);
      expect(bad.json()).toEqual({ error: 'tts_failed' });
    } finally {
      await withTts.close();
    }
  });

  it('budgets cache misses: 20 per minute per IP and a daily character cap; hits stay free', async () => {
    const cached = new Set<string>();
    let upstream = 0;
    const tts: Tts = async (text, charge) => {
      if (!cached.has(text)) {
        if (!charge(text.length)) throw new TtsBudgetError('budget');
        upstream++;
        cached.add(text);
      }
      return Buffer.from([0xff]);
    };
    const withTts = buildApp({ db, tts, rateLimitPerMin: 100_000, ttsDailyChars: 500 });
    const get = (text: string, ip = '10.0.0.1') => withTts.inject({ url: `/tts?text=${text}`, headers: { 'cf-connecting-ip': ip } });
    try {
      for (let i = 0; i < 20; i++) expect((await get(`p${i}`)).statusCode).toBe(200);
      const limited = await get('p20');
      expect(limited.statusCode).toBe(429);
      expect(limited.json()).toEqual({ error: 'tts_budget' });
      expect((await get('p3')).statusCode).toBe(200); // a hit is free even when the miss budget is spent
      expect((await get('p20', '10.0.0.2')).statusCode).toBe(200); // other IPs have their own budget
      expect(upstream).toBe(21);
      // daily characters: 21 phrases of 2-3 chars used ~50 of 500; one IP per phrase so only the daily cap bites
      let i = 0;
      while ((await get('x'.repeat(100) + i, `10.1.0.${i}`)).statusCode === 200) i++;
      expect(i).toBe(4); // 4 x 101 chars fit under 500 with ~50 already used
      expect((await get('p0', '10.9.9.9')).statusCode).toBe(200); // hits still served after the daily cap
    } finally {
      await withTts.close();
    }
  });

  it('refunds the daily character budget when ElevenLabs fails, so the next miss is not 429', async () => {
    const tts = elevenLabsTts({
      apiKey: 'k',
      cacheDir: '/tmp/stepsafe-tts-refund-missing',
      fetchImpl: async () => new Response('no', { status: 500, headers: { 'content-type': 'application/json' } }),
    });
    const withTts = buildApp({ db, tts, rateLimitPerMin: 100_000, ttsDailyChars: 10, ttsMissPerMin: 100 });
    try {
      expect((await withTts.inject({ url: '/tts?text=hello' })).statusCode).toBe(502); // 5 chars, reserved then refunded
      // 6 more would exceed a budget that still held the first 5; a refund leaves room and upstream fails again
      expect((await withTts.inject({ url: '/tts?text=hello!' })).statusCode).toBe(502);
    } finally {
      await withTts.close();
    }
  });

  it('caps TTS characters per IP per day (misses only)', async () => {
    const tts: Tts = async (text, charge) => {
      if (!charge(text.length)) throw new TtsBudgetError('budget');
      return Buffer.from([0xff]);
    };
    const withTts = buildApp({ db, tts, rateLimitPerMin: 100_000, ttsIpDailyChars: 250, ttsMissPerMin: 1000 });
    const get = (text: string, ip: string) => withTts.inject({ url: `/tts?text=${text}`, headers: { 'cf-connecting-ip': ip } });
    try {
      expect((await get('a'.repeat(200), '10.2.0.1')).statusCode).toBe(200);
      expect((await get('b'.repeat(40), '10.2.0.1')).statusCode).toBe(200); // 240 of 250
      expect((await get('c'.repeat(20), '10.2.0.1')).statusCode).toBe(429); // would be 260
      expect((await get('c'.repeat(20), '10.2.0.2')).statusCode).toBe(200); // another IP is unaffected
    } finally {
      await withTts.close();
    }
  });
});

describe('client IP trust', () => {
  it('honours cf-connecting-ip only from a loopback socket; a spoof from elsewhere is keyed by its socket address', async () => {
    const strict = buildApp({ db, getRateLimitPerMin: 2 });
    try {
      const fromLan = (i: number) =>
        strict.inject({ url: '/users/abc', remoteAddress: '192.168.1.50', headers: { 'cf-connecting-ip': `10.9.9.${i}` } });
      expect((await fromLan(1)).statusCode).toBe(200);
      expect((await fromLan(2)).statusCode).toBe(200);
      expect((await fromLan(3)).statusCode).toBe(429); // rotating the header does not help
      // behind cloudflared (loopback socket) the header is the client: distinct clients get distinct buckets
      const viaTunnel = (ip: string) => strict.inject({ url: '/users/abc', remoteAddress: '127.0.0.1', headers: { 'cf-connecting-ip': ip } });
      expect((await viaTunnel('8.8.8.8')).statusCode).toBe(200);
      expect((await viaTunnel('8.8.4.4')).statusCode).toBe(200);
      expect((await viaTunnel('8.8.4.4')).statusCode).toBe(200);
      expect((await viaTunnel('8.8.4.4')).statusCode).toBe(429);
      // a malformed header from loopback falls back to the socket address
      expect((await viaTunnel('not an ip; drop table')).statusCode).toBe(200);
    } finally {
      await strict.close();
    }
  });
});

describe('indexes', () => {
  it('keeps the location 2dsphere index and drops redundant hazardId indexes', async () => {
    await ensureIndexes(db); // idempotent: also drops leftovers from an older ensureIndexes
    const names = async (c: string) => (await db.collection(c).indexes()).map((i) => i.name);
    expect(await names('hazards')).toContain('location_2dsphere');
    expect(await names('hazards')).not.toContain('location_2dsphere_status_1_heightBand_1_expiresAt_1');
    expect(await names('hazards')).toContain('renameAttemptAt_1');
    expect(await names('votes')).toEqual(expect.arrayContaining(['_id_', 'hazardId_1_deviceId_1']));
    expect(await names('votes')).not.toContain('hazardId_1');
    expect(await names('reclassifications')).not.toContain('hazardId_1');
    expect(await names('reports')).toContain('hazardId_1_deviceId_1');
    const rename = (await db.collection('hazards').indexes()).find((i) => i.name === 'renameAttemptAt_1');
    expect(rename?.partialFilterExpression).toEqual({ needsNaming: true });
  });
});

describe('GET /taxonomy', () => {
  it('returns every entry as {id, en, es, category, defaultHeightBand}, cacheable', async () => {
    const res = await app.inject({ url: '/taxonomy' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=3600');
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    const list = res.json();
    expect(list).toHaveLength(TAXONOMY.length);
    for (const e of list) {
      expect(Object.keys(e).sort()).toEqual(['category', 'defaultHeightBand', 'en', 'es', 'id']);
      expect(['moving', 'temporary', 'permanent']).toContain(e.category);
      expect(['ground', 'head', 'dropoff']).toContain(e.defaultHeightBand);
    }
    expect(list).toContainEqual({ id: 'trash-bin', en: 'trash bin', es: 'cubo de basura', category: 'moving', defaultHeightBand: 'ground' });
  });
});

describe('budget env and IPv6 keys', () => {
  it('an env budget of 0 means 0: every TTS miss is refused, hits still served', async () => {
    expect(envBudget('0')).toBe(0);
    expect(envBudget(undefined)).toBeUndefined();
    expect(envBudget(' ')).toBeUndefined();
    expect(envBudget('abc')).toBeUndefined();
    expect(envBudget('-5')).toBeUndefined();
    expect(envBudget('2500')).toBe(2500);
    const cached = new Set(['hit']);
    const tts: Tts = async (text, charge) => {
      if (!cached.has(text) && !charge(text.length)) throw new TtsBudgetError('budget');
      return Buffer.from([0xff]);
    };
    const zero = buildApp({ db, tts, ttsDailyChars: envBudget('0') });
    try {
      expect((await zero.inject({ url: '/tts?text=miss' })).statusCode).toBe(429);
      expect((await zero.inject({ url: '/tts?text=hit' })).statusCode).toBe(200);
    } finally {
      await zero.close();
    }
  });

  it('ipKey collapses IPv6 to its /64; IPv4 and IPv4-mapped stay as is', () => {
    expect(ipKey('203.0.113.9')).toBe('203.0.113.9');
    expect(ipKey('::ffff:203.0.113.9')).toBe('203.0.113.9');
    expect(ipKey('2001:db8:1:2:aaaa:bbbb:cccc:dddd')).toBe('2001:db8:1:2::/64');
    expect(ipKey('2001:db8:1:2::1')).toBe('2001:db8:1:2::/64');
    expect(ipKey('2001:0db8:0001:0002:ffff::9%en0')).toBe('2001:db8:1:2::/64');
    expect(ipKey('2001:db8::1')).toBe('2001:db8:0:0::/64');
    expect(ipKey('::1')).toBe('0:0:0:0::/64');
  });

  it('rotating addresses inside one IPv6 /64 shares one rate-limit bucket', async () => {
    const strict = buildApp({ db, getRateLimitPerMin: 2 });
    try {
      const get = (ip: string) => strict.inject({ url: '/users/abc', remoteAddress: ip });
      expect((await get('2001:db8:1:2::1')).statusCode).toBe(200);
      expect((await get('2001:db8:1:2::2')).statusCode).toBe(200);
      expect((await get('2001:db8:1:2:ffff::3')).statusCode).toBe(429);
      expect((await get('2001:db8:1:3::1')).statusCode).toBe(200); // another /64
    } finally {
      await strict.close();
    }
  });
});
