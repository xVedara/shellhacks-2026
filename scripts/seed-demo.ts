// Inserts 18 sample hazards (sample: true) within ~300 m of FIU Graham Center.
// Idempotent: removes previous sample hazards and their votes first.
// Run: cd server && npm run seed:demo   (reads MONGODB_URI from server/.env)
// Imports go through server/src so `mongodb` resolves from server/node_modules.
import { ensureIndexes, LIFESPAN_MS, ObjectId, openDb, type Category, type HazardDoc, type HeightBand } from '../server/src/db.ts';

const CENTER = { lat: 25.7566, lng: -80.3739 };
const M_PER_DEG_LAT = 111_320;
const DAY = 24 * 3600_000;

// [type, category, heightBand, east m, north m, severity, confidence, label en, label es]
type Row = [string, Category, HeightBand, number, number, 1 | 2 | 3, number, string, string];
const ROWS: Row[] = [
  ['e-scooter', 'moving', 'ground', 40, 25, 2, 3, 'scooter on sidewalk', 'patinete en la acera'],
  ['trash bin', 'moving', 'ground', -85, 60, 1, 2, 'trash bin on path', 'bote de basura en el camino'],
  ['food cart umbrella', 'moving', 'head', 120, -40, 2, 1, 'umbrella at head height', 'sombrilla a la altura de la cabeza'],
  ['open truck door', 'moving', 'head', -150, -90, 2, 1, 'open truck door ahead', 'puerta de camión abierta'],
  ['open cellar hatch', 'moving', 'dropoff', 200, 110, 3, 2, 'open hatch, drop ahead', 'escotilla abierta, desnivel'],
  ['loading ramp', 'moving', 'dropoff', -60, -180, 2, 1, 'loading ramp edge', 'borde de rampa de carga'],
  ['construction barrier', 'temporary', 'ground', 75, -120, 2, 4, 'construction barrier', 'barrera de construcción'],
  ['fallen palm frond', 'temporary', 'ground', -200, 30, 1, 2, 'palm frond on path', 'hoja de palma en el camino'],
  ['scaffolding', 'temporary', 'head', 10, 170, 3, 3, 'scaffolding overhead', 'andamio arriba'],
  ['low branch', 'temporary', 'head', -110, 150, 2, 2, 'low branch ahead', 'rama baja adelante'],
  ['open trench', 'temporary', 'dropoff', 240, -60, 3, 3, 'open trench ahead', 'zanja abierta adelante'],
  ['missing drain cover', 'temporary', 'dropoff', -30, 90, 3, 2, 'missing drain cover', 'falta tapa de drenaje'],
  ['broken sidewalk', 'permanent', 'ground', 150, 40, 2, 4, 'broken sidewalk', 'acera rota'],
  ['raised tree root', 'permanent', 'ground', -240, -120, 2, 3, 'raised root, trip hazard', 'raíz levantada, cuidado'],
  ['low sign', 'permanent', 'head', 60, 230, 2, 3, 'low sign at head height', 'letrero bajo a la altura de la cabeza'],
  ['low tree canopy', 'permanent', 'head', -170, 210, 1, 2, 'low branches overhead', 'ramas bajas arriba'],
  ['missing curb ramp', 'permanent', 'dropoff', 100, -220, 3, 4, 'no curb ramp, step down', 'sin rampa, escalón abajo'],
  ['uneven step down', 'permanent', 'dropoff', -120, -30, 2, 2, 'uneven step down', 'escalón desigual abajo'],
];

async function main() {
  const { client, db } = openDb();
  try {
    await ensureIndexes(db);
    const hazards = db.collection<HazardDoc>('hazards');
    const old = await hazards.find({ sample: true }, { projection: { _id: 1 } }).map((h) => h._id).toArray();
    await Promise.all(['votes', 'reclassifications', 'reports'].map((c) => db.collection(c).deleteMany({ hazardId: { $in: old } })));
    await hazards.deleteMany({ sample: true });

    const now = Date.now();
    const docs: HazardDoc[] = ROWS.map(([type, category, heightBand, east, north, severity, confidence, en, es], i) => {
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
        spokenLabel_en: en,
        spokenLabel_es: es,
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
