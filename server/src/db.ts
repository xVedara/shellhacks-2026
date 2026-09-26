import { fileURLToPath } from 'node:url';
import { Binary, MongoClient, ObjectId, type Db } from 'mongodb';

export { Binary, MongoClient, ObjectId };

export const CATEGORIES = ['moving', 'temporary', 'permanent'] as const;
export const HEIGHT_BANDS = ['ground', 'head', 'dropoff'] as const;
export type Category = (typeof CATEGORIES)[number];
export type HeightBand = (typeof HEIGHT_BANDS)[number];

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
  spokenLabel_en: string;
  spokenLabel_es: string;
  needsNaming: boolean;
  /** Set once a reclassification applied: type/category/heightBand are people-chosen. */
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

export async function ensureIndexes(db: Db) {
  await Promise.all([
    db.collection('hazards').createIndexes([
      { key: { location: '2dsphere' } },
      { key: { expiresAt: 1 }, expireAfterSeconds: 0 },
      { key: { sample: 1 } },
    ]),
    db.collection('votes').createIndexes([
      { key: { hazardId: 1 } },
      { key: { hazardId: 1, deviceId: 1 }, unique: true },
    ]),
    db.collection('reclassifications').createIndexes([
      { key: { hazardId: 1 } },
      { key: { hazardId: 1, deviceId: 1 }, unique: true },
    ]),
    db.collection('users').createIndex({ deviceId: 1 }, { unique: true }),
    db.collection('reports').createIndex({ status: 1 }),
  ]);
}
