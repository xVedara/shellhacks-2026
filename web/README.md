# StepSafe community map (web)

Live map, verify queue and hazard detail for sighted remote volunteers. Next.js (App Router) +
TypeScript + Tailwind, Leaflet (`react-leaflet`) with OpenStreetMap tiles. The web app is a pure
client of the StepSafe API: there are no Next.js route handlers.

## Run

```bash
cd web
npm install
NEXT_PUBLIC_API_URL=https://api.example.org npm run build   # default http://localhost:8787
npm run start                                               # serves on :3000 (-p to change)
```

`NEXT_PUBLIC_API_URL` is inlined at build time, so rebuild when the API host changes.
Fonts (Poppins for UI, Saira Extra Condensed for headlines and numbers, via `next/font/google`) are downloaded during `npm run build`, so the build machine
needs internet; the running app does not.

## Pages

| Route | What it does |
| --- | --- |
| `/` | Dashboard: metric strip, live map, glass side rail. The strip is computed client-side from data the page already holds (no extra endpoints): active hazards (sample vs real), last hour (`lastSeen` 0 to 60 min ago, so "reported or seen again"; future timestamps are ignored; summaries carry no `createdAt`), awaiting check (not voted from this device, same rule as `/verify`), cleared today (`status: "cleared"` upserts for hazards on the map, seen by this page since local midnight; plain removes are not counted since TTL expiry and re-seeding send them too; a clear that arrives during a resync is checked against the new snapshot; resets on reload), and stream status with time of the last update. Live map + side panel. Loads `GET /hazards/near` (Graham Center 25.7566,-80.3739, radius 5000 m), then follows `GET /events`. Upserts add/move pins, removes (or `status: "cleared"`) delete them. Every EventSource `open` (first connect and each reconnect) re-fetches `/hazards/near` and replaces the pin set, because events sent while disconnected are lost; events arriving while that request is in flight are buffered and replayed on top of the snapshot, so it cannot undo a newer upsert or remove. If a reconnect starts another fetch before that one finishes, the earlier result is ignored. The badge says "Live" only after the snapshot lands; a failed snapshot with the stream up retries with backoff (1 s to 30 s). An open detail (map panel, `/verify`, `/hazard/[id]`) re-fetches `GET /hazards/:id` on every upsert for that id and after each resync. Closing the panel returns focus to the list row. Keyboard-accessible hazard list next to the map; clicking a pin or list row opens the detail panel. OSM reference layer toggle. |
| `/verify` | Client-side queue built from the same list: lowest confidence first, skipping ids this device already voted on (stored in `localStorage` key `stepsafe.voted`). One hazard at a time: crop, mini map, type/category/height band, measurements. Upvote / Downvote (`POST /hazards/:id/votes`, `source: "verifier"`), Skip, Reclassify (shows `agreeing` of 3), Report (spam/abuse/other). Shortcuts: `U` up, `D` down, `S` skip, only while focus is on the page body or plain content in the hazard card (never on a link, button or field), only once the hazard's details have loaded, and they can be switched off with the "Keyboard shortcuts" checkbox (WCAG 2.1.4). Vote buttons stay disabled until the details load. Reclassify lowercases and trims the type; allowed: letters, numbers, spaces, hyphens, max 40. On phones the vote bar sticks to the bottom of the screen. |
| `/hazard/[id]` | Full detail: crop, clearance and remaining width in feet and metres, confidence, severity, last seen, expiry, Spanish label, pending reclassifications, vote history, location map. |

Header shows `displayName` and karma from `GET /users/:deviceId`; retries every 10 s while the
server is unreachable and refreshes after each vote or reclassification.

Identity: a random `<32 hex>-web` device id in `localStorage` (`stepsafe.deviceId`), made with `crypto.getRandomValues` so it also works over plain HTTP on a LAN (`randomUUID` needs a secure context). Ids must match `^[A-Za-z0-9._:-]{1,128}$`; legacy `web-…` ids are replaced because the server names users from the first 4 characters. `app/error.tsx` shows a message instead of a blank page if a page throws. All storage access
is wrapped in try/catch with an in-memory fallback (private windows still work for the session).

## Map encoding

- Color + letter = category: moving (amber, M), temporary (brand orange, T), permanent (red, P).
  The ramp keeps orange for hazards only, and the letter means color is never the only signal.
- Shape = height band: circle ground, triangle head height, square drop-off.
- Size = confidence (22 to 40 px).
- `sample: true` hazards carry a dashed "SAMPLE" tag on the map, in the list, in detail and in the
  verify queue, plus a "Seeded for the demo" notice. Seed data is never shown as a real report.
- The newest live pin gets a ring (pulses unless `prefers-reduced-motion`), and the list marks it "New".

## States

Loading, empty ("No active hazards yet"), API down (overlay with the URL tried, retries every 5 s,
fills in when the server answers), live stream dropped ("Reconnecting…", auto-resync), hazard
removed while open, 404 and 429 (`rate_limited`) messages on actions.

## OSM reference layer

`scripts/fetch-osm.mjs` queries Overpass once for crossings (`highway=crossing`,
`footway=crossing`), curbs (`kerb=*`, `barrier=kerb`) and `tactile_paving=yes` within 800 m of the
Graham Center and writes `public/osm-graham.json` (committed, about 110 KB, 891 features on
2026-09-26), so the demo never depends on Overpass. Rerun with `node scripts/fetch-osm.mjs`.
Data © OpenStreetMap contributors, ODbL 1.0; tiles from tile.openstreetmap.org with attribution.
The OSM dots are distinguished by color only (with tooltips); accepted because it is an optional reference layer for sighted verifiers, and hazards themselves never rely on color alone.

## Look

Dark-glass dashboard: brand-navy 135° gradient page, translucent blurred panels (`.glass`, `.glass-float` over the map, `.well` for recessed tiles in `app/globals.css`), metric strip on top, map with floating legend / OSM toggle / zoom, feed and detail in a right rail (stacked on phones). Pins keep their encoding and gain a soft tint halo of their category color. Orange stays reserved for hazards and warnings.

## Accessibility

Dark navy UI with WCAG AA text contrast (on the glass tone: white 16:1, muted #A9B4C2 7.8:1, signal #13B9F2 7.2:1 for links; primary buttons use navy text on brand blue, 4.7:1; brand blue is never small text on glass). Brand Slate #66717E is only 3.7:1 on navy, so it is
not used for text there. Skip link, visible 3 px focus rings (navy + white halo on map tiles),
keyboard-reachable pins (Enter opens) and a parallel list, labelled controls, `aria-live`
announcements for new hazards and action results, works at 390 px wide.

## Known gaps

- The `/events` stream carries hazards outside the 5 km area and the map adds them (fine for the local demo).
- Profile refreshes (`/users/:deviceId`) can resolve out of order; the header may briefly show an older karma.

## Assumptions about the API

- The API sends CORS headers (`Access-Control-Allow-Origin`, and allows `Content-Type` on POST)
  for the web origin, including on `/events`. The web and API are on different origins.
- `/events` sends `event: hazard` messages exactly as in the frozen contract.
- `/users/:deviceId` for a never-seen device either returns a profile or fails; failure shows
  "Anonymous verifier (profile unavailable)".
