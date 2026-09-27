import { fileURLToPath } from 'node:url';
import { Binary, MongoClient, ObjectId, type Collection, type Db } from 'mongodb';

export { Binary, MongoClient, ObjectId };

export const CATEGORIES = ['moving', 'temporary', 'permanent'] as const;
export const HEIGHT_BANDS = ['ground', 'head', 'dropoff'] as const;
export type Category = (typeof CATEGORIES)[number];
export type HeightBand = (typeof HEIGHT_BANDS)[number];
export type LockableField = 'type' | 'category' | 'heightBand';

const HOUR = 3600_000;
export const LIFESPAN_MS: Record<Category, number> = {
  moving: 6 * HOUR,
  temporary: 7 * 24 * HOUR,
  permanent: 90 * 24 * HOUR,
};
export const CLEARED_TTL_MS = 24 * HOUR;

export interface HazardDoc {
  _id: ObjectId;
  type: string;
  category: Category;
  heightBand: HeightBand;
  location: { type: 'Point'; coordinates: [number, number] }; // [lng, lat]
  heading: number | null;
  measurements: { clearanceM?: number; widthM?: number } | null;
  crop: Binary | null;
  meshUrl: null;
  severity: number;
  /** Written for reference only; every response derives labels from type + heightBand (`spokenLabels`). */
  spokenLabel_en: string;
  spokenLabel_es: string;
  needsNaming: boolean;
  /** Fields people chose through reclassification (sorted); the renamer never changes them. */
  lockedFields?: LockableField[];
  /** Legacy (before lockedFields): true meant every field was locked. Read, never written. */
  humanLocked?: boolean;
  renameAttempts?: number;
  renameAttemptAt?: Date;
  confidence: number;
  status: 'active' | 'cleared';
  sample: boolean;
  createdBy: string;
  createdAt: Date;
  lastSeen: Date;
  expiresAt: Date;
}

/** Loads server/.env (if present) and returns a lazily-connecting client. */
export function openDb() {
  try {
    process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url)));
  } catch {
    // no .env file: rely on the real environment
  }
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is not set; copy server/.env.example to server/.env');
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
  return { client, db: client.db(process.env.MONGODB_DB || 'stepsafe') };
}

/** IndexNotFound: the redundant index was already gone (a fresh database never had it). */
const isMissingIndex = (err: unknown) => {
  const e = err as { code?: number; codeName?: string };
  return e.code === 27 || e.codeName === 'IndexNotFound';
};

async function dropIfExists(coll: Collection, name: string) {
  await coll.dropIndex(name).catch((err: unknown) => {
    if (!isMissingIndex(err)) throw err;
  });
}

/**
 * One report per device per hazard. If older rows already duplicated that pair, keep the newest
 * and retry — a unique build would otherwise throw and the process would exit at startup.
 */
async function ensureUniqueReports(reports: Collection) {
  const key = { hazardId: 1, deviceId: 1 } as const;
  try {
    await reports.createIndex(key, { unique: true });
  } catch (err) {
    if ((err as { code?: number }).code !== 11000) throw err;
    const dupes = await reports.aggregate<{ ids: ObjectId[] }>([
      { $sort: { at: -1 } },
      { $group: { _id: { hazardId: '$hazardId', deviceId: '$deviceId' }, ids: { $push: '$_id' }, n: { $sum: 1 } } },
      { $match: { n: { $gt: 1 } } },
    ]).toArray();
    const extra = dupes.flatMap((d) => d.ids.slice(1));
    if (extra.length) await reports.deleteMany({ _id: { $in: extra } });
    await reports.createIndex(key, { unique: true });
  }
}

export async function ensureIndexes(db: Db) {
  const hazards = db.collection('hazards');
  const votes = db.collection('votes');
  const reclass = db.collection('reclassifications');
  const reports = db.collection('reports');
  await Promise.all([
    hazards.createIndexes([
      { key: { location: '2dsphere' } },
      { key: { expiresAt: 1 }, expireAfterSeconds: 0 },
      { key: { sample: 1 } },
      // rename pass: needsNaming, oldest attempt first. Partial so named pins are not in the index.
      { key: { renameAttemptAt: 1 }, partialFilterExpression: { needsNaming: true } },
    ]),
    // (hazardId, deviceId) unique already serves hazardId-only lookups; a second hazardId index
    // is written on every vote and reclassify.
    votes.createIndex({ hazardId: 1, deviceId: 1 }, { unique: true }),
    reclass.createIndex({ hazardId: 1, deviceId: 1 }, { unique: true }),
    db.collection('users').createIndex({ deviceId: 1 }, { unique: true }),
    reports.createIndex({ status: 1 }),
    ensureUniqueReports(reports),
  ]);
  await Promise.all([
    dropIfExists(votes, 'hazardId_1'),
    dropIfExists(reclass, 'hazardId_1'),
  ]);
}
