# Path Guard mockups

Static HTML studies for the StepSafe community map. These files do not run in the app, do not call the API, and are not wired into `web/`, `ios/`, or `server/`.

Open `index.html` in a browser. It is a gallery of the same three screens in three frames, light and dark:

| Frame | What it is |
| --- | --- |
| `desktop/` | Left sidebar, map card, docked hazard feed |
| `mobile-web/` | Phone width with a browser bar and underline tabs |
| `mobile-app/` | Phone width with a status bar, segmented tabs, and a home indicator |

Each frame has `live-map.html`, `verify.html`, and `hazard.html`. Add `?theme=light` or `?theme=dark`. The theme control on the page stores the choice for that tab and keeps it on the next link.

## What stayed

The live information architecture is the community map, not a new product:

- Live map, verify queue, hazard details
- Desktop: left sidebar (Live map, Verify queue, theme, Neighbor-5ae3)
- Phone: two tabs at the top
- Map plus the active-hazard feed (most recently seen first; select a row for details)
- Verify actions: Still there, Gone, Skip, plus Reclassify and Report
- Pin encoding: letter and color are the category (M moving, T temporary, P permanent), shape is the height band, size is confidence

Copy follows the current web app: hazards within 3 miles of FIU Graham Center. Orange is used for hazards and warnings only. The map drawing is a schematic of the Graham Center blocks, not an OpenStreetMap tile. The OpenStreetMap layer checkbox reveals stand-in dots and names the real layer.

## Chrome

Path Guard is the quiet chrome around that IA.

- Apple-like product chrome: hairline cards, no tinted metric tiles, no glow
- Uber-like map: the map sits in one card, actions are pills, the palette stays black and white except for hazard pins
- A compact instruction banner on the map. It opens in place to the spoken line and the pin legend
- Map controls are a zoom pair and one layer pill
- The hazard feed is a solid dock on the card (right side on desktop, bottom sheet on a phone), not a stack of glowing cards

Primary pills are navy in light mode and cloud in dark mode. Links and the active tab use blue. The live dot uses signal blue. Small link text on white uses `#0868F8` so it stays readable; the focus ring and tab indicator stay `#087FF5`.

## Try it

On the live map, open the banner, toggle the OpenStreetMap layer, zoom, and select a hazard in the feed or on a pin. Back returns to the list. Open full page goes to that hazard.

On verify, Still there, Gone, and Skip move through the queue. With keyboard shortcuts on, `U`, `D`, and `S` work when focus is not on a button, link, or field. Reclassify and Report open their forms and record a mock result on the card.

The counts (9 active, 6 sample, 3 real) are a fixed slice so the list, the legend, and the queue agree. They are not a live server snapshot.

## Type

Inter (latin, weights 400, 500, 600) is the UI face, under the SIL Open Font License. See `LICENSES/inter-OFL-1.1.txt` at the repo root.
