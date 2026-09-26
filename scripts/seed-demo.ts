// Inserts 18 sample hazards (sample: true) within ~300 m of FIU Graham Center.
// Idempotent: removes previous sample hazards and their votes first.
// Run: cd server && npm run seed:demo   (reads MONGODB_URI from server/.env)
// Imports go through server/src so `mongodb` resolves from server/node_modules.
import { ensureIndexes, LIFESPAN_MS, ObjectId, openDb, type Category, type HazardDoc, type HeightBand } from '../server/src/db.ts';
import { isTypeId, labelsFor } from '../server/src/taxonomy.ts';

const CENTER = { lat: 25.7566, lng: -80.3739 };
const M_PER_DEG_LAT = 111_320;
const DAY = 24 * 3600_000;

// [taxonomy id, category, heightBand, east m, north m, severity, confidence]
// Labels come from labelsFor(id, band), exactly as for real reports.
type Row = [string, Category, HeightBand, number, number, 1 | 2 | 3, number];
const ROWS: Row[] = [
  ['e-scooter', 'moving', 'ground', 40, 25, 2, 3],
  ['trash-bin', 'moving', 'ground', -85, 60, 1, 2],
  ['umbrella', 'moving', 'head', 120, -40, 2, 1], // food cart umbrella
  ['open-car-door', 'moving', 'head', -150, -90, 2, 1], // open truck door
  ['open-hatch', 'moving', 'dropoff', 200, 110, 3, 2], // open cellar hatch
  ['ramp', 'moving', 'dropoff', -60, -180, 2, 1], // loading ramp edge
  ['construction-barrier', 'temporary', 'ground', 75, -120, 2, 4],
  ['fallen-branch', 'temporary', 'ground', -200, 30, 1, 2], // fallen palm frond
  ['scaffolding', 'temporary', 'head', 10, 170, 3, 3],
  ['low-branch', 'temporary', 'head', -110, 150, 2, 2],
  ['open-trench', 'temporary', 'dropoff', 240, -60, 3, 3],
  ['open-manhole', 'temporary', 'dropoff', -30, 90, 3, 2], // missing drain cover
  ['broken-sidewalk', 'permanent', 'ground', 150, 40, 2, 4],
  ['tree-root', 'permanent', 'ground', -240, -120, 2, 3], // raised tree root
  ['low-sign', 'permanent', 'head', 60, 230, 2, 3],
  ['low-branch', 'permanent', 'head', -170, 210, 1, 2], // low tree canopy
  ['ramp-missing', 'permanent', 'dropoff', 100, -220, 3, 4], // missing curb ramp
  ['step-down', 'permanent', 'dropoff', -120, -30, 2, 2], // uneven step down
];
for (const [id] of ROWS) if (!isTypeId(id)) throw new Error(`seed type ${id} is not in the taxonomy`);

async function main() {
  const { client, db } = openDb();
  try {
    await ensureIndexes(db);
    const hazards = db.collection<HazardDoc>('hazards');
    const old = await hazards.find({ sample: true }, { projection: { _id: 1 } }).map((h) => h._id).toArray();
    await Promise.all(['votes', 'reclassifications', 'reports'].map((c) => db.collection(c).deleteMany({ hazardId: { $in: old } })));
    await hazards.deleteMany({ sample: true });

    const now = Date.now();
    const docs: HazardDoc[] = ROWS.map(([type, category, heightBand, east, north, severity, confidence], i) => {
      const lastSeen = new Date(now - (i % 6) * 20 * 60_000);
      return {
        _id: new ObjectId(),
        type,
        category,
        heightBand,
        location: {
          type: 'Point',
          coordinates: [
            CENTER.lng + east / (M_PER_DEG_LAT * Math.cos((CENTER.lat * Math.PI) / 180)),
            CENTER.lat + north / M_PER_DEG_LAT,
          ],
        },
        heading: null,
        measurements: heightBand === 'head' ? { clearanceM: 1.6 + (i % 3) * 0.1 } : null,
        crop: null,
        meshUrl: null,
        severity,
        ...labelsFor(type, heightBand),
        needsNaming: false,
        confidence,
        status: 'active',
        sample: true,
        createdBy: 'sample-seed',
        createdAt: new Date(now - (i + 1) * 3600_000),
        lastSeen,
        // samples outlive their category lifespan so they survive until the demo; rerun to refresh
        expiresAt: new Date(now + Math.max(LIFESPAN_MS[category], 30 * DAY)),
      };
    });
    await hazards.insertMany(docs);
    // back each sample's confidence with matching up votes so later real votes recompute sensibly
    const votes = docs.flatMap((h) =>
      Array.from({ length: h.confidence }, (_, k) => ({
        hazardId: h._id, deviceId: `sample-seed-${k + 1}`, vote: 'up', source: 'scout', weight: 1, at: h.lastSeen,
      })),
    );
    await db.collection('votes').insertMany(votes);
    console.log(`removed ${old.length} old sample hazards, inserted ${docs.length} (+${votes.length} votes)`);
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
