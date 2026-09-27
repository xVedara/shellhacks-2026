# Instrument board

Static mockups only. These files do not change the StepSafe web app, API, or iOS client.

The live information architecture stays: **Live map** (`/`), **Verify queue** (`/verify`), **Hazard details**. Desktop keeps the left sidebar. Phones keep the two top tabs. The map stays beside the feed. Verify still asks Still there / Gone / Skip.

What changes is the board. The campus map is the ground, not a card. Hazards, source (Sample, Scout, Walker), and confidence are one tape of status rows: hairline panels, measured Inter tracking, status pills. Density follows a dark fintech board (Revolut). Type and chrome follow Linear, with the purple accent dropped. Color is StepSafe only: Navy `#081624`, Blue `#087FF5`, Signal Blue `#13B9F2`. Orange `#FF7900` is hazards and warnings only.

## Open

Open `index.html` in a browser. Each screen is a standalone file and renders with the shared script. No build, no server.

| Surface | Screens | Themes |
| --- | --- | --- |
| `desktop/` | `live-map`, `verify`, `hazard` | `light`, `dark` |
| `mobile-web/` | same | same |
| `mobile-app/` | same, with status bar and home indicator | same |

Eighteen pages: `{surface}/{screen}-{theme}.html`.

`mobile-web` is the responsive site at phone width. `mobile-app` is the same board in an iPhone shell. The theme control links to the paired file.

## Demo snapshot

Figures match a Graham Center pass: 31 active hazards, 18 sample and 13 real, within 5 km. The verify card is the least-confident row, the sample drop-off (type “ramp”), with no photo. Hazard details open on that record, or on any row (clearance and a pending reclassification show on “pole at head height”).

The map image is a static OpenStreetMap render of FIU Graham Center, not a live tile client. The OpenStreetMap layer checkbox draws the repo’s crossing, curb, and tactile points on top. Attribution stays on the map: © OpenStreetMap contributors, [ODbL](https://opendatacommons.org/licenses/odbl/1-0/).

Votes, reclassify, and report stay in the page. They confirm the control, they do not call the API.

`shots/` is one PNG for every page, named `{surface}-{screen}-{theme}.png` (18 files). Surfaces are `desktop`, `mobile-web`, and `mobile-app`. Screens are `live-map`, `verify`, and `hazard`. Themes are `light` and `dark`.
