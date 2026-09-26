// Single-node MongoDB replica set for local demo bring-up (change streams need a replica set).
// Lives in server/scripts/ (not scripts/) so the bare `mongodb-memory-server` import resolves
// from server/node_modules, where it is already a devDependency.
//
// Run from anywhere with: node server/scripts/dev-mongo.mjs
// Port: MONGO_PORT env var, default 27018. Prints the connection URI on one line, then stays
// alive until killed (SIGINT/SIGTERM stop the replica set and its data dir cleanly).
import { MongoMemoryReplSet } from 'mongodb-memory-server';

const port = Number(process.env.MONGO_PORT) || 27018;

const rs = await MongoMemoryReplSet.create({
  replSet: { count: 1, storageEngine: 'wiredTiger' },
  instanceOpts: [{ port }],
});

// dev-up.sh greps this line for the URI; keep the prefix stable.
console.log(`MONGO_URI=${rs.getUri()}`);

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.once(sig, async () => {
    await rs.stop();
    process.exit(0);
  });
}
