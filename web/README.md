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
| `/` | Dashboard: page bar, metric tiles, map panel, feed/detail panel. The strip is computed client-side from data the page already holds (no extra endpoints): active hazards (sample vs real), last hour (`lastSeen` 0 to 60 min ago, so "reported or seen again"; future timestamps are ignored; summaries carry no `createdAt`), awaiting check (not voted from this device, same rule as `/verify`), cleared today (`status: "cleared"` upserts for hazards on the map, seen by this page since local midnight; plain removes are not counted since TTL expiry and re-seeding send them too; a clear that arrives during a resync is checked against the new snapshot; resets on reload), and stream status with time of the last update. Live map + side panel. Loads `GET /hazards/near` (Graham Center 25.7566,-80.3739, radius 5000 m), then follows `GET /events`. Upserts add/move pins, removes (or `status: "cleared"`) delete them. Every EventSource `open` (first connect and each reconnect) re-fetches `/hazards/near` and replaces the pin set, because events sent while disconnected are lost; events arriving while that request is in flight are buffered and replayed on top of the snapshot, so it cannot undo a newer upsert or remove. If a reconnect starts another fetch before that one finishes, the earlier result is ignored. The badge says "Live" only after the snapshot lands; a failed snapshot with the stream up retries with backoff (1 s to 30 s). An open detail (map panel, `/verify`, `/hazard/[id]`) re-fetches `GET /hazards/:id` on every upsert for that id and after each resync. Closing the panel returns focus to the list row. Keyboard-accessible hazard list next to the map; clicking a pin or list row opens the detail panel. OSM reference layer toggle. |
| `/verify` | Client-side queue built from the same list: lowest confidence first, skipping ids this device already voted on (stored in `localStorage` key `stepsafe.voted`). One hazard at a time: crop, mini map, type/category/height band, measurements. Upvote / Downvote (`POST /hazards/:id/votes`, `source: "verifier"`), Skip, Reclassify (shows `agreeing` of 3), Report (spam/abuse/other). Shortcuts: `U` up, `D` down, `S` skip, only while focus is on the page body or plain content in the hazard card (never on a link, button or field), only once the hazard's details have loaded, and they can be switched off with the "Keyboard shortcuts" checkbox (WCAG 2.1.4). Vote buttons stay disabled until the details load. Reclassify's type field is a native `<select>` grouped by category (moving/temporary/permanent), built from `GET /taxonomy`; choosing a type pre-fills its default category and height band (still editable) and sends the taxonomy id, never free text. If `/taxonomy` fails to load, an error message shows and type reclassify is disabled; category and height band reclassify keep working. On phones the vote bar sticks to the bottom of the screen. |
| `/hazard/[id]` | Full detail: crop, clearance and remaining width in feet and metres, confidence, severity, last seen, expiry, Spanish label, pending reclassifications, vote history, location map. |

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

A quiet work-tool layout: grey sidebar on the left (logo, the two pages, theme switch, your
profile), folding into a top bar with tabs on phones. Each page starts with a strip carrying its
title and one or two actions. Everything else lives in plain white cards outlined by a thin grey
line; the only drop shadows belong to controls floating on the map (legend, zoom). Inter throughout, 12/13/14/15/20 px scale, semibold
titles in sentence case, tabular numbers. Colors are semantic roles in `app/globals.css`
(`--page`, `--card`, `--sunken`, `--line`, `--ink*`, `--accent`, `--primary`, ...) defined once
for light and once for dark; components never use raw hex except the hazard category colors.

**Theme.** Light is the default. The toggle (sidebar, or the sun/moon button on phones) switches
to dark and stores the choice in `localStorage` key `stepsafe.theme` (wrapped in try/catch; a
blocked store just lasts for the page). With nothing stored, the page follows
`prefers-color-scheme`, including live OS changes. An inline script in `app/layout.tsx` sets
`<html data-theme>` before first paint, so there is no flash. In dark, OSM tiles are dimmed a
little with a CSS filter; pins and the "Sample" tags keep their light-map styling.

**Deviation from the brand guide.** `brandguide/README.md` says the UI is dark-mode first. The web
dashboard now defaults to light with an optional dark theme, to match the product style the team
chose for the demo. Navy `#081624` is kept as the heading and primary-button color, StepSafe blue
(darkened to `#0A66C8` for text contrast) is the accent, and orange `#FF7900` still appears only
for hazards and warnings. The brand guide itself is unchanged.

## Accessibility

WCAG AA text contrast in both themes. Light: body `#1B2330`, meta `#5E6875` (5.7:1 on white,
5.1:1 on the sidebar grey), links/active nav `#0A66C8` (5.6:1; 4.9:1 on its tint), primary button
white on navy (16:1), warning text `#8A4200` on its tint (6.8:1). Dark: meta `#969FAB` (6.7:1 on
`#15181D`), links `#5EA8FF` (7.2:1), primary button navy on `#E7EDF5` (15.5:1), warning text
`#FFB473`. Form control edges are 3:1 or more against their surface (WCAG 1.4.11). Orange is never
text on white (2.6:1); warnings carry a text title and an icon. Inline links are underlined.
Skip link, visible 2 px focus rings (navy + white halo on map tiles), keyboard-reachable pins
(Enter opens) and a parallel list, labelled controls, `aria-live` announcements for new hazards
and action results, metric tiles as `<dl>`, the theme toggle is a button with `aria-pressed`,
works at 390 px wide.

## Known gaps

- The `/events` stream carries hazards outside the 5 km area and the map adds them (fine for the local demo).
- Profile refreshes (`/users/:deviceId`) can resolve out of order; the header may briefly show an older karma.

## Assumptions about the API

- The API sends CORS headers (`Access-Control-Allow-Origin`, and allows `Content-Type` on POST)
  for the web origin, including on `/events`. The web and API are on different origins.
- `/events` sends `event: hazard` messages exactly as in the frozen contract.
- `/users/:deviceId` for a never-seen device either returns a profile or fails; failure shows
  "Anonymous verifier (profile unavailable)".
