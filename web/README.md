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
The font (Inter, via `next/font/google`) is downloaded during `npm run build`, so the build machine
needs internet; the running app does not.

## Pages

| Route | What it does |
| --- | --- |
| `/` | Full-bleed live map. Phones use one bottom sheet (peek, medium, expanded); from 768px up the same list sits in a side panel. Peek is status plus Open list. Medium is filter chips (Active, Awaiting, Cleared) and the hazard list. The legend stays inside that sheet or panel. There is no metric strip and no turn-by-turn action. Loads `GET /hazards/near` (Graham Center 25.7566,-80.3739, radius 5000 m), then follows `GET /events`. Upserts add/move pins, removes (or `status: "cleared"`) delete them. Every EventSource `open` (first connect and each reconnect) re-fetches `/hazards/near` and replaces the pin set, because events sent while disconnected are lost; events arriving while that request is in flight are buffered and replayed on top of the snapshot, so it cannot undo a newer upsert or remove. If a reconnect starts another fetch before that one finishes, the earlier result is ignored. The status says "Live" only after the snapshot lands; a failed snapshot with the stream up retries with backoff (1 s to 30 s). An open detail on the map or `/verify` re-fetches `GET /hazards/:id` on every upsert for that id and after each resync. `/hazard/[id]` follows `/events` for that one id (it does not download `/hazards/near`) and re-fetches the record when that id changes and on each stream open. Closing the panel returns focus to the list row. Keyboard-accessible hazard list; clicking a pin or list row selects it and opens the detail. `/?selected=` restores that selection on the list. OSM reference layer toggle lives in the legend. |
| `/verify` | Client-side queue built from the same list: lowest confidence first, skipping ids this device already voted on (stored in `localStorage` key `stepsafe.voted`). One hazard at a time: crop, mini map, type/category/height band, measurements. Upvote / Downvote (`POST /hazards/:id/votes`, `source: "verifier"`), Skip, Reclassify (shows `agreeing` of 3), Report (spam/abuse/other). Shortcuts: `U` up, `D` down, `S` skip, only while focus is on the page body or plain content in the hazard card (never on a link, button or field), only once the hazard's details have loaded, and they can be switched off with the "Keyboard shortcuts" checkbox (WCAG 2.1.4). Vote buttons stay disabled until the details load. Reclassify's type field is a native `<select>` grouped by category (moving/temporary/permanent), built from `GET /taxonomy`; choosing a type pre-fills its default category and height band (still editable) and sends the taxonomy id, never free text. If `/taxonomy` fails to load, an error message shows and type reclassify is disabled; category and height band reclassify keep working. On phones the vote bar sticks to the bottom of the screen. |
| `/hazard/[id]` | Instrument card over a live map: type glyph, confidence, last update, distance, and a Verify link (the verify queue). History, photo, and measurements sit in a disclosure. Back returns to the live list with that hazard selected. Follows `/events` for this id and refetches the record when it changes or the stream opens. Does not load the 5 km list. No routing. |

Header shows `displayName` and karma from `GET /users/:deviceId`; retries every 10 s while the
server is unreachable and refreshes after each vote or reclassification.

Identity: a random `<32 hex>-web` device id in `localStorage` (`stepsafe.deviceId`), made with `crypto.getRandomValues` so it also works over plain HTTP on a LAN (`randomUUID` needs a secure context). Ids must match `^[A-Za-z0-9._:-]{1,128}$`; legacy `web-…` ids are replaced because the server names users from the first 4 characters. `app/error.tsx` shows a message instead of a blank page if a page throws. All storage access
is wrapped in try/catch with an in-memory fallback (private windows still work for the session).

## Hazard taxonomy

`GET /taxonomy` (`[{id, en, es, category, defaultHeightBand}]`, public and cacheable) is the fixed
list of hazard types the server accepts; `lib/api.ts`'s `getTaxonomy()` fetches it once and caches
the result in memory for the session (a failed fetch clears the cache so the next call retries).
`useTaxonomy()` (`lib/hooks.ts`) is the React hook wrapper. Anywhere a hazard's type is shown as a
bare id (e.g. `trash-bin`), `typeDisplayName(id, taxonomy)` renders the taxonomy's English name
instead, falling back to the raw id when it's unknown or the taxonomy hasn't loaded yet (covers
legacy free-text types from before this list existed). `POST /hazards/:id/reclassify` only accepts
a taxonomy id for `type` (400 otherwise), so the reclassify picker's value is always an id, never
free text.

## Map encoding

- The glyph is the hazard type: a 1:1 crop from the locked sheet in `public/hazard-icons/<id>.png`
  (plus `height-ground`, `height-head`, `height-dropoff` for the legend). Regenerate with
  `npm run slice-icons -- path/to/sheet.png` only from that sheet; do not redraw the glyphs.
- Category is a colored edge and a small M / T / P mark: moving `#FFC23D`, temporary `#FF7900`,
  permanent `#D93A1E`. The letter is the category mark, not the pin's label.
- Height uses those three height tiles in the legend, and the height name in the row text.
- Size = confidence (22 to 40 px). The selected pin scales up and wears a signal-blue ring (`--signal`: `#13B9F2` on the dark theme, `#087FF5` on the light theme).
- Overlapping pins collapse into a count cluster; choosing it zooms in.
- `sample: true` hazards carry a dashed "SAMPLE" tag on the map, in the list, in detail and in the
  verify queue, plus a "Seeded for the demo" notice. Seed data is never shown as a real report.
- The newest live pin gets a signal-blue ring (pulses unless `prefers-reduced-motion`), and the list marks it "New".

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

Design: navy canvas, hairline surfaces, pill buttons at least 44px tall. Sidebar on the left
from 768px (logo, Live map, Verify, theme, profile); a top bar with those two tabs on phones.
The live map is full bleed. Inter throughout, sentence case, tabular numbers. Colors are semantic
roles in `app/globals.css`. Orange `#FF7900` is warning chrome. The selected ring is signal blue
(`--signal`). Category colors are separate from that ring.

**Theme.** Dark is the default (`#081624` canvas). The sidebar toggle switches to the light theme
and stores the choice in `localStorage` key `stepsafe.theme` (wrapped in try/catch; a blocked store
just lasts for the page). On phones the same toggle sits inside the legend, not in the top bar.
An inline script in `app/layout.tsx` sets `<html data-theme>` before first paint. In dark, OSM
tiles are dimmed a little; the icon crops keep their own pixels.

## Accessibility

WCAG AA text in both themes. Dark body `#F5F5F5` and meta `#A1A5AB` on the navy surfaces, links `#13B9F2`.
Light body `#0A0A0A` and meta `#3E4651` on white, links `#0757B0` so small text clears AA (`#087FF5` stays on chrome).
Primary buttons are near-white on navy, or navy on near-white. Orange is not used as text on white;
warnings carry a text title and an icon. Inline links are underlined. Skip link, blue focus glow,
keyboard-reachable pins (Enter opens) and a parallel list, labelled controls, `aria-live` announcements
for new hazards and action results, instrument facts as `<dl>`, the theme toggle is a button with
`aria-pressed`. Action targets are at least 44px. `prefers-reduced-motion` drops the new-pin pulse, the
sheet resize, list and filter motion, and the selected-pin scale. Works at 390px wide.
The audit target is WCAG 2.2 AA. Each route has its own title ("Verify queue | StepSafe"),
`app/not-found.tsx` is the 404 page, and the layout stays usable at 200% zoom, including landscape phones.

## Known gaps

- The `/events` stream carries hazards outside the 5 km area and the map adds them (fine for the local demo).

## Assumptions about the API

- The API sends CORS headers (`Access-Control-Allow-Origin`, and allows `Content-Type` on POST)
  for the web origin, including on `/events`. The web and API are on different origins.
- `/events` sends `event: hazard` messages exactly as in the frozen contract.
- `/users/:deviceId` for a never-seen device either returns a profile or fails; failure shows
  "Anonymous verifier (profile unavailable)".
