# StepSafe API server

Node + TypeScript (Fastify, official `mongodb` driver, `@google/genai`), run with `tsx`.

```sh
cd server
npm install
cp .env.example .env      # fill in MONGODB_URI (replica set / Atlas) and GEMINI_API_KEY
npm start                 # http://127.0.0.1:8787
npm run seed:demo         # 18 sample hazards around FIU Graham Center (idempotent)
npm test                  # vitest + MongoMemoryReplSet; Gemini, Ollama and ElevenLabs mocked
npx tsc --noEmit
```

Env: `MONGODB_URI` (required), `MONGODB_DB` (default `stepsafe`), `PORT` (default 8787), `HOST` (default
`127.0.0.1`: cloudflared runs on the same box; `0.0.0.0` only for LAN testing). `cf-connecting-ip` is honoured
only when the socket is loopback (cloudflared on the same box) and the value looks like an IP; otherwise every
limiter keys on the socket address, so a LAN client cannot spoof it. IPv6 clients are keyed by their /64 prefix.

Naming provider, chosen at startup and logged (`naming provider: ...`; the Ollama URL is logged as scheme://host:port only):
1. `GEMINI_API_KEY` set: Gemini (`GEMINI_MODEL`, default `gemini-flash-lite-latest` (gemini-2.5-flash is retired for new keys; flash-lite answers in about 1-4 s)).
2. Else a local Ollama at `OLLAMA_URL` (default `http://localhost:11434`) that answers `/api/tags` within 2 s and
   has `OLLAMA_MODEL` (default `qwen3.8:27b-mlx`, vision capable) pulled.
3. Else none: hazards stay type "obstacle" with `needsNaming`. Selection re-runs every 5 s while the provider is
   none, so starting Ollama later needs no restart.

`NAMER_TIMEOUT_MS` is the timeout of one rename call (default 6000 for Gemini, 12000 for Ollama, capped at 15000).
`POST /hazards` never calls the model (latency); on a timeout the renamer retries the hazard on a later pass. Ollama requests send `keep_alive: -1` (stay loaded). A warm-up naming call (a 32x32 JPEG) runs at startup and
again from the 5 s loop whenever `/api/ps` shows the model unloaded, since a cold load is slow. At most 2 Ollama calls run at once, and the renamer stands aside while any call runs. Measured on the dev Mac (320 px JPEG q0.7 crops never seen
before): cold start 8.2 s, warm p50 4.7 s, p90 6.8 s; with the machine loaded (load average ~40) 9-12 s.

TTS: `ELEVENLABS_API_KEY` (optional; without it `GET /tts` answers 503), `ELEVENLABS_VOICE_ID` (default
`EXAVITQu4vr4xnSDxMaL`, premade "Sarah - Mature, Reassuring, Confident", calm and clear in English and Spanish),
`ELEVENLABS_MODEL` (default `eleven_multilingual_v2`), `TTS_DAILY_CHAR_BUDGET` (default 20000),
`TTS_IP_DAILY_CHAR_BUDGET` (default 2000). A budget of `0` means 0 (TTS served from cache only).
Startup awaits index creation and exits if Mongo is unreachable.
`GET /events` needs a replica set (Atlas is one; locally `docker run -p 27017:27017 mongo:7 --replSet rs0` then
`rs.initiate()`). The seed script lives in `scripts/` and imports from `server/src`, so it resolves
dependencies from `server/node_modules`.

## Contract additions

Additive to PLAN.md section 6; nothing existing changed shape.

- `GET /tts?text=&lang=en|es` -> `audio/mpeg` (agreed in PLAN.md section 6). Details under Decisions.
- `GET /taxonomy` -> `[{id, en, es, category, defaultHeightBand}]`, `Cache-Control: public, max-age=3600`. The fixed
  list of hazard types (`src/taxonomy.ts`). **Needs Dev's OK.** Clients use it to offer reclassify choices and to show
  names; `POST /hazards/:id/reclassify` now takes `type` only as one of these ids (400 otherwise), so the web
  reclassify form must switch from free text to this list.

## Layout

- `src/app.ts` all routes, rate limit, SSE, `renamePending`. `buildApp({db, namer})` so tests inject a fake namer.
- `src/db.ts` doc types, lifespans, indexes, `openDb()` (loads `server/.env` via `process.loadEnvFile`).
- `src/taxonomy.ts` the hazard type allowlist and `labelsFor(id, band)`, the only source of spoken labels.
- `src/gemini.ts` `Namer` type, shared prompt, `parseNaming` (validation), Gemini naming; `null` on failure.
- `src/namer.ts` Ollama naming (`/api/chat`, image + JSON schema, `think: false`) and `selectNamer()` (provider pick).
- `src/tts.ts` ElevenLabs TTS with the disk cache and in-flight dedupe.
- `src/index.ts` entry point; every 30 s re-probes the provider while none is active and runs the renamer.
- `test/api.test.ts` API tests; `test/ai.test.ts` taxonomy, provider selection, normalization, Ollama and ElevenLabs
  (fetch injected); `test/probes.ts` the audit's hostile phrases, replayed as type, label and reclassify input.

## Decisions (where the brief left room)

- **Merge rule.** The type is unknown until the renamer names the crop. So a report merges into any *active,
  non-sample* hazard with the **same heightBand within 10 m** (`$nearSphere`, closest wins), regardless of type. It
  counts as a walker upvote from that device and returns the existing label with `merged: true`. Otherwise a new pin
  is inserted. The merge query and the insert run under one global in-process mutex (a few DB round trips; no model
  call), so concurrent reports never make duplicate pins. If the merge target vanishes mid-request (TTL), a new pin is
  created. Real reports never merge into seed data (`sample: true`).
- **heightBand** always comes from the phone (depth sensor), not from the model's guess.
- **heading** is never a reason to reject a report: it is stored when it is a number in `[0, 360)`, else `null`.
- **New pins are never named inline** (latency): type `obstacle` (a taxonomy id), category `temporary`, severity 2,
  `needsNaming: true`, labels for the phone's band (`obstacle`, `obstacle at head height`, `drop-off`).
- **Renamer.** With a naming provider active (Gemini or Ollama), every 5 s up to 5 `needsNaming` hazards are named, least recently
  attempted first (`renameAttemptAt` ascending, never-attempted first). Each attempt sets `renameAttempts` and
  `renameAttemptAt`; after 3 failures it gives up (`needsNaming: false`). It always refreshes severity. It sets the
  type (and category) only when the stored type is not a real taxonomy type yet (legacy text or `obstacle`) and
  people did not choose the type; fields in `lockedFields` are never touched, and a people-chosen type is sent as a
  hint. Legacy rows with `humanLocked: true` count as fully locked. A hazard without a crop has nothing to look at:
  the flag is cleared without a model call. A person or dog is never pinned: that rename deletes the hazard and its
  votes, except in the drop-off band, where it stays `obstacle` (a person cannot make a drop in the depth data).
- **Spoken labels are never model or user text.** The model only picks `type` from the taxonomy ids (enum in the
  JSON schema and the id list in the prompt, which also says to ignore text or instructions in the image) plus
  category, heightBand and severity. `parseNaming` maps anything outside the list to `obstacle`; an off-enum category
  or heightBand falls back to that entry's defaults; severity is rounded and clamped to 1-3 (2 when missing, below 1
  or not a number); a non-object answer is a naming failure. Label text the model adds anyway is dropped. Labels are
  derived on every read and emit (summary, `/near`, detail, merge and create responses, SSE) from the stored type
  and heightBand, so stored label fields never reach a client; a legacy or unknown type reads as `obstacle`: ground `<en>` / `<es>`, head
  `<en> at head height` / `<es> a la altura de la cabeza`, dropoff `drop-off: <en>` / `desnivel: <es>` for drop types (entries whose default band is dropoff, plus broken-sidewalk) and just `drop-off` / `desnivel` for any other type, so an unrelated object is never named. Every
  template is at most 60 characters (tested for all entries and bands). Ollama's MLX backend does not always honor
  `format` and may wrap the JSON in a code fence, so the text between the first `{` and last `}` is parsed.
- **`GET /tts?text=&lang=en|es`** returns `audio/mpeg` (`Cache-Control: public, max-age=86400`). `text` is NFC
  normalized, control characters removed, whitespace collapsed and trimmed, then must be 1-200 characters; `lang`
  (default `en`) is validated but unused, because `eleven_multilingual_v2` detects the language. Bad input: 400
  `bad_request`. No key: 503 `{error: "tts_unavailable"}`. Upstream error, timeout (15 s), a non-`audio/mpeg` or empty
  response, or one over 1 MB: 502 `{error: "tts_failed"}` and nothing cached. Audio is cached in `server/.cache/tts/`
  (gitignored) as `sha256(text|voice|model).mp3`; a hit needs no network and is always free, and concurrent requests
  for one phrase share one upstream call. Cache misses are budgeted: 20 per minute per client IP,
  `TTS_IP_DAILY_CHAR_BUDGET` characters per client IP per UTC day, and `TTS_DAILY_CHAR_BUDGET` characters per UTC day
  overall (in memory, reset on restart); when any runs out the answer is 429 `{error: "tts_budget"}` and the phone uses
  its built-in voice. The cache is capped at 200 MB / 5000 files,
  evicting least recently used by mtime (hits touch it).
- **Confidence** is recomputed from the `votes` collection on every vote (sum of signed weights; creation stores an
  up vote from the creator as source `walker`). Weight = `1 + ln(1 + max(karma, 0))`; a walker downvote (only ever the phone's passive
  "walked past, saw nothing" vote) weighs a fixed 0.6 instead.
  Re-voting replaces the device's previous vote (unique `(hazardId, deviceId)`). Vote `source` is
  `walker | scout | verifier` (the Spotter role was renamed Scout; `spotter` is rejected).
- **Expiry.** An upvote on an active hazard sets `expiresAt = max(expiresAt, now + lifespan)` (moving 6 h,
  temporary 7 d, permanent 90 d). Below -2, or below 0 once at least 2 different devices sent a
  walker (passive) downvote (a weight-1 pin after two walkers' misses: 1 - 0.6 - 0.6 = -0.2), the hazard becomes `cleared`, `expiresAt = now + 24 h`, and karma
  settles once (down voters +1, everyone else -1, creator included). Votes on a cleared hazard return
  `400 {error: "bad_request", message: "hazard cleared"}`. Karma does not settle on TTL expiry. `/near` also
  filters `expiresAt > now` because Mongo's TTL sweep runs only every ~60 s.
- **Reclassify.** One live proposal per device per hazard (a new one replaces the old). A change applies when 3
  devices proposed the identical `{type, category, heightBand}` (absent fields must also match). `type` must be a
  taxonomy id (`GET /taxonomy`), else 400; an empty proposal is 400. On apply: provided fields are set,
  the proposal's fields are added to `lockedFields` (only what people chose), `needsNaming: true` with
  `renameAttempts: 0` (so the renamer refreshes severity), a category
  change sets `expiresAt = max(lastSeen + new lifespan, now + 1 h)`, and pending proposals are cleared. Votes are
  untouched. The "walker proposal counts as first" rule is not implemented: the request carries no source.
- **Rate limit.** Fixed 60 s window per key. Writes count against two buckets: 30 per body `deviceId` (when it
  matches `^[A-Za-z0-9._:-]{1,128}$`, otherwise a per-IP stand-in) and 120 per client IP, so rotating deviceIds
  does not help. GETs: 300 per client IP (the venue NAT puts many people behind one IP). The IP is
  `cf-connecting-ip` only from a loopback socket (behind `cloudflared` every request arrives from localhost), else the
  socket address. `/health`,
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
  Crops are `null`. Types are taxonomy ids and labels come from `labelsFor(id, band)`, like real reports.

## Known gaps

Transactions (hazard + creator vote are two writes), `$inc`-delta confidence (recompute can race), karma on TTL
expiry, report moderation and the -5 karma penalty, a vote racing the clearing vote, concurrent category-change
expiry races, the global creation mutex (per-cell + neighbour locks if throughput matters), in-memory single-process
rate limits, locks and TTS budgets,
OSM seed, mesh files. Each has a `ponytail:` note in the code where relevant.
