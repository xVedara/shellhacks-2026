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
Fonts (Inter via `next/font/google`) are downloaded during `npm run build`, so the build machine
needs internet; the running app does not.

## Pages

| Route | What it does |
| --- | --- |
| `/` | Live map + side panel. Loads `GET /hazards/near` (Graham Center 25.7566,-80.3739, radius 5000 m), then follows `GET /events`. Upserts add/move pins, removes (or `status: "cleared"`) delete them. Every EventSource `open` (first connect and each reconnect) re-fetches `/hazards/near` and replaces the pin set, because events sent while disconnected are lost. Keyboard-accessible hazard list next to the map; clicking a pin or list row opens the detail panel. OSM reference layer toggle. |
| `/verify` | Client-side queue built from the same list: lowest confidence first, skipping ids this device already voted on (stored in `localStorage` key `stepsafe.voted`). One hazard at a time: crop, mini map, type/category/height band, measurements. Upvote / Downvote (`POST /hazards/:id/votes`, `source: "verifier"`), Skip, Reclassify (shows `agreeing` of 3), Report (spam/abuse/other). Shortcuts: `U` up, `D` down, `S` skip. On phones the vote bar sticks to the bottom of the screen. |
| `/hazard/[id]` | Full detail: crop, clearance and remaining width in feet and metres, confidence, severity, last seen, expiry, Spanish label, pending reclassifications, vote history, location map. |

Header shows `displayName` and karma from `GET /users/:deviceId`; retries every 10 s while the
server is unreachable and refreshes after each vote or reclassification.

Identity: a random `web-<uuid>` device id in `localStorage` (`stepsafe.deviceId`). All storage access
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

## Accessibility

Dark navy UI with WCAG AA text contrast (white 18:1, muted #A9B4C2 8.7:1, brand blue #087FF5 4.7:1 on
navy; primary buttons use navy text on blue). Brand Slate #66717E is only 3.7:1 on navy, so it is
not used for text there. Skip link, visible 3 px focus rings (navy + white halo on map tiles),
keyboard-reachable pins (Enter opens) and a parallel list, labelled controls, `aria-live`
announcements for new hazards and action results, works at 390 px wide.

## Assumptions about the API

- The API sends CORS headers (`Access-Control-Allow-Origin`, and allows `Content-Type` on POST)
  for the web origin, including on `/events`. The web and API are on different origins.
- `/events` sends `event: hazard` messages exactly as in the frozen contract.
- `/users/:deviceId` for a never-seen device either returns a profile or fails; failure shows
  "Anonymous verifier (profile unavailable)".
