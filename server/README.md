# StepSafe API server

Node + TypeScript (Fastify, official `mongodb` driver, `@google/genai`), run with `tsx`.

```sh
cd server
npm install
cp .env.example .env      # fill in MONGODB_URI (replica set / Atlas) and GEMINI_API_KEY
npm start                 # http://127.0.0.1:8787
npm run seed:demo         # 18 sample hazards around FIU Graham Center (idempotent)
npm test                  # vitest + MongoMemoryReplSet, Gemini mocked
npx tsc --noEmit
```

Env: `MONGODB_URI` (required), `MONGODB_DB` (default `stepsafe`), `GEMINI_API_KEY` (optional; without it every new
hazard is saved as "unknown obstacle" and the background renamer is off), `GEMINI_MODEL` (default
`gemini-2.5-flash`), `PORT` (default 8787), `HOST` (default `127.0.0.1`: cloudflared runs on the same box; set
`0.0.0.0` only for LAN testing, since it lets outsiders spoof `cf-connecting-ip`).
Startup awaits index creation and exits if Mongo is unreachable.
`GET /events` needs a replica set (Atlas is one; locally `docker run -p 27017:27017 mongo:7 --replSet rs0` then
`rs.initiate()`). The seed script lives in `scripts/` and imports from `server/src`, so it resolves
dependencies from `server/node_modules`.

## Layout

- `src/app.ts` all routes, rate limit, SSE, `renamePending`. `buildApp({db, namer})` so tests inject a fake namer.
- `src/db.ts` doc types, lifespans, indexes, `openDb()` (loads `server/.env` via `process.loadEnvFile`).
- `src/gemini.ts` Gemini naming (image, or text only when there is no crop) with a 4 s timeout; `null` on failure.
- `src/index.ts` entry point; runs the renamer every 30 s when a Gemini key is set.
- `test/api.test.ts` API tests.

## Decisions (where the brief left room)

- **Merge rule.** Type is unknown until Gemini names the crop, and the brief says to skip Gemini when a merge
  target exists. So a report merges into any *active, non-sample* hazard with the **same heightBand within 10 m**
  (`$nearSphere`, closest wins), regardless of type. It counts as a walker upvote from that device and returns the
  existing label with `merged: true`. Otherwise Gemini is called (outside any lock), then the merge query runs again
  and the insert happens under one global in-process mutex, so concurrent reports never make duplicate pins and
  nobody waits on someone else's Gemini call. Two simultaneous reports at one spot may both call Gemini; only one pin
  results. If the merge target vanishes mid-request (TTL), a new pin is created. Real reports never merge into seed
  data (`sample: true`).
- **heightBand** always comes from the phone (depth sensor), not from Gemini's guess.
- **heading** is never a reason to reject a report: it is stored when it is a number in `[0, 360)`, else `null`.
- **Gemini failure** (no key, timeout, error, output failing validation): type/label `unknown obstacle`,
  Spanish label `obstáculo desconocido`, category `temporary`, severity 2, `needsNaming: true`.
- **Renamer.** With `GEMINI_API_KEY` set, every 30 s up to 5 `needsNaming` hazards are retried, least recently
  attempted first (`renameAttemptAt` ascending, never-attempted first). Each attempt sets `renameAttempts` and
  `renameAttemptAt`; after 3 failures it gives up (`needsNaming: false`). Once any reclassification has applied,
  the hazard is `humanLocked`: the renamer regenerates only labels and severity and never touches type, category or
  heightBand (even for "unknown obstacle"). Without a crop it asks Gemini text-only for labels of the agreed type;
  with neither a crop nor a type there is nothing to name and the flag is cleared.
- **Confidence** is recomputed from the `votes` collection on every vote (sum of signed weights; creation stores an
  up vote from the creator as source `walker`). Weight = `1 + ln(1 + max(karma, 0))`, halved for walker downvotes.
  Re-voting replaces the device's previous vote (unique `(hazardId, deviceId)`). Vote `source` is
  `walker | scout | verifier` (the Spotter role was renamed Scout; `spotter` is rejected).
- **Expiry.** An upvote on an active hazard sets `expiresAt = max(expiresAt, now + lifespan)` (moving 6 h,
  temporary 7 d, permanent 90 d). Below -2 the hazard becomes `cleared`, `expiresAt = now + 24 h`, and karma
  settles once (down voters +1, everyone else -1, creator included). Votes on a cleared hazard return
  `400 {error: "bad_request", message: "hazard cleared"}`. Karma does not settle on TTL expiry. `/near` also
  filters `expiresAt > now` because Mongo's TTL sweep runs only every ~60 s.
- **Reclassify.** One live proposal per device per hazard (a new one replaces the old). A change applies when 3
  devices proposed the identical `{type, category, heightBand}` (absent fields must also match). Types are trimmed,
  lowercased, whitespace-collapsed and must match `^[a-z0-9 -]{1,40}$` (they become spoken labels); an empty
  proposal is 400. On apply: provided fields are set, `humanLocked: true`, `needsNaming: true` with
  `renameAttempts: 0` (the type is a placeholder label until the renamer writes real EN/ES labels), a category
  change sets `expiresAt = max(lastSeen + new lifespan, now + 1 h)`, and pending proposals are cleared. Votes are
  untouched. The "walker proposal counts as first" rule is not implemented: the request carries no source.
- **Rate limit.** Fixed 60 s window per key. Writes count against two buckets: 30 per body `deviceId` (when it
  matches `^[A-Za-z0-9._:-]{1,128}$`, otherwise a per-IP stand-in) and 120 per client IP, so rotating deviceIds
  does not help. GETs: 300 per client IP (the venue NAT puts many people behind one IP). The IP is
  `cf-connecting-ip` when present, because behind `cloudflared` every request arrives from localhost. `/health`,
  `/events` and CORS preflights are exempt. In-memory, single process; past 10k keys, expired windows are evicted
  (at most once a second), live ones never.
- **Users.** `GET /users/:deviceId` never writes; unknown devices get `{displayName: "Neighbor-xxxx", karma: 0}`.
  The user row is created on the first write (new hazard, vote, reclassify, report).
- **Vote privacy.** `HazardDetail.votes[].deviceId` is the first 10 hex chars of `sha256(deviceId)`; the raw id
  works as a credential and is never returned.
- **Validation.** Bodies are validated without type coercion (Fastify's default turns JSON `null` into `0`), so
  `{lat: null}` or `{lat: "25.7"}` is 400. Querystrings and path params are still coerced.
- **Errors.** Every 4xx other than 404/429 (schema validation, bad JSON, body over 1 MB) is
  `400 {error: "bad_request", message}`. Malformed hazard ids return 404. Unknown routes 404.
- **CORS.** All origins. `@fastify/cors` answers JSON POST preflights; the hijacked `/events` response sets
  `Access-Control-Allow-Origin: *` itself. Both are tested.
- **Crop** accepts plain base64 or a `data:image/...;base64,` URL, max 200 KB decoded, stored as `Binary`.
  It is never included in `/near` results or SSE events, only in `GET /hazards/:id`.
- **`/near`** caps results at 500 rows; `heading` is accepted and ignored.
- **SSE** uses one change stream (`fullDocument: "updateLookup"`, crop projected out) shared by all clients. It
  restarts after 2 s on error with `startAfter` the last seen token, so no events are lost (history-lost errors
  start fresh). At most 200 clients total and 5 per IP (more get `429 {error: "rate_limited"}`). A client whose
  write throws or returns `false` (slow reader, full buffer) is dropped; `EventSource` reconnects. A new client
  gets `retry: 3000` and then only live changes, so the map should load `/near` first. `: ping` every 15 s.
- **Seed data** (`sample: true`) expires 30 days after seeding so moving hazards survive until the demo;
  each sample has `confidence` up votes from `sample-seed-N` devices so later real votes recompute sensibly.
  Crops are `null`.

## Known gaps

Transactions (hazard + creator vote are two writes), `$inc`-delta confidence (recompute can race), karma on TTL
expiry, report moderation and the -5 karma penalty, a vote racing the clearing vote, concurrent category-change
expiry races, the global creation mutex (per-cell + neighbour locks if throughput matters), in-memory single-process
rate limits and locks, ElevenLabs, OSM seed, mesh files. Each has a `ponytail:` note in the code where relevant.
