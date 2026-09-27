# Field Quiet

Static mockups for the StepSafe verifier. They do not ship to stepsafe.miami and they do not touch `web/`, `ios/`, or `server/`.

Reading this as: a work-tool redesign for sighted verifiers, Field Quiet — Tesla’s radical subtraction and Apple’s quiet product chrome — keeping the live information architecture.

## What stays

Three surfaces, three jobs.

| Surface | Live map | Verify queue | Hazard |
| --- | --- | --- | --- |
| Mobile app (390 screen, phone frame) | `mobile-app-live-map.html` | `mobile-app-verify.html` | `mobile-app-hazard.html` |
| Mobile web (stepsafe.miami at 390) | `mobile-web-live-map.html` | `mobile-web-verify.html` | `mobile-web-hazard.html` |
| Desktop (1440) | `desktop-live-map.html` | `desktop-verify.html` | `desktop-hazard.html` |

- Routes stay Live map, Verify queue, and Hazard details.
- Desktop keeps the left rail (Live map, Verify queue, theme, Neighbor-5ae3), then the title and Verify hazards action, five summaries, then the map beside the active-hazard feed.
- Mobile web keeps the logo row, two tabs, the map above the feed, and a single-column review with Still there / Gone / Skip.
- The phone app uses the same jobs with native chrome: status bar, bottom tabs, and hazard as a pushed screen.
- Map encoding is unchanged. Letter plus color is category (M moving, T temporary, P permanent). Shape is height (circle ground, triangle head, square drop-off). Bigger pin, higher confidence. Sample pins stay dashed and labeled.
- The campus is an original schematic, not a tile pull. Phone maps use a closer crop of that same drawing so street and building names stay readable. Pins sit on open ground, clear of labels.

Open `index.html` and use Light / Dark. Every screen also has the product theme control. `?theme=dark` and `?theme=light` work without the control.

## What changes

The current site is a capable gray tool in Inter. Field Quiet takes the furniture away.

- Type is Geist (self-hosted, SIL Open Font License, `assets/GEIST-LICENSE`), with SF Pro / system UI ahead of it where the OS has it. Inter is not used.
- One icon weight: 1.5px round stroke, one family. Status glyphs in the phone bezel are the exception.
- Light canvas is a cool gray (`#F2F4F7`) with white sheets and hairlines. No tinted icon tiles, no purple, no neon glass.
- Dark canvas is Navy `#081624`. Cards step up one tone. Primary actions stay solid blue in both themes.
- Orange `#FF7900` is the temporary-hazard pin and the Active hazards mark. It is not a button, a link, or a decoration. Moving stays amber and permanent stays red, because that encoding is the product, and color is never the only signal (the letter is on the pin).
- Brand Blue `#087FF5` is the focus ring and the active rule. Primary buttons use `#0872E0`, the same blue held one step darker so white labels clear WCAG AA (white on `#087FF5` is about 3.9:1). Signal Blue `#13B9F2` is the live dot only.
- Glass is used three times: the desktop map legend, the mobile-web vote bar, and the phone tab bar. `prefers-reduced-transparency` falls back to a solid sheet.

## Demo record

The queue is the seeded ramp from the live verify screen: moving, drop-off, confidence 1.0, no photo. Full details are that same hazard. The feed shows the nine most recently seen of 31, in the order on the live map, and says so.

The campus drawing stands in for OSM tiles so the mockups open offline. The Leaflet / OpenStreetMap line is the product’s attribution chrome. It is not a claim that this drawing is OSM data. The OpenStreetMap layer checkbox reveals the reference dots (crossings, curbs, tactile paving).

## Files

`field-quiet.css` and `theme.js` are plain, no build. `generate.mjs` rewrites the HTML if the screens need to stay in lockstep. Screenshots for both themes are in `shots/`.
