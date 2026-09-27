# Named pin density

Static mockups for the StepSafe community map. They do not change the Next.js app, the API, or the iOS app.

Open `index.html` in a browser (or serve this folder) and use the gallery. Each frame links to the full page.

## What changed on the map

The pages keep the live information architecture:

- Live map, verify queue, hazard details
- Desktop sidebar (Live map, Verify queue, theme, profile)
- Phones: two destinations (mobile web uses the top tabs; the mobile app uses a bottom tab bar)
- Active hazards feed with category, height band, and confidence

The map drawing is the exploration. At campus zoom, nearby hazards of one kind collapse to a short name and a count (`curb  7`). A single hazard keeps its name on a small square mark. A dashed label is sample data. The open hazard inverts to navy (light theme) or near-white (dark theme). The second line on a close zoom is the precise place (`ramp · SW 14th`, `Graham · covered walk`). Confidence stays in the list, not in the size of the mark.

Orange `#FF7900` is only the hazard bar on a name, plus the active-hazards metric icon. It is not a button color and not a map fill. Blue `#087FF5` is the control and focus color; signal blue `#13B9F2` marks the live stream. Link text uses a darker blue on light surfaces so it stays readable. Navy `#081624` is the heading and primary button.

There is no purple, no glass, and no glowing pin.

## Screens

| | Live map | Verify | Hazard |
| --- | --- | --- | --- |
| Desktop | `desktop/live-map-light.html` | `desktop/verify-light.html` | `desktop/hazard-light.html` |
| | `desktop/live-map-dark.html` | `desktop/verify-dark.html` | `desktop/hazard-dark.html` |
| Mobile web | `mobile-web/live-map-light.html` | `mobile-web/verify-light.html` | `mobile-web/hazard-light.html` |
| | `mobile-web/live-map-dark.html` | `mobile-web/verify-dark.html` | `mobile-web/hazard-dark.html` |
| Mobile app | `mobile-app/live-map-light.html` | `mobile-app/verify-light.html` | `mobile-app/hazard-light.html` |
| | `mobile-app/live-map-dark.html` | `mobile-app/verify-dark.html` | `mobile-app/hazard-dark.html` |

Theme controls link to the other file. Live map, Verify, and the pole row link across the three screens.

The verify card is the least-confident sample (`drop-off`, type ramp, no photo). Hazard details is a different record, the measured `pole at head height`, opened from the feed. Both are representative, not a shared database.

The basemap is a schematic of FIU Graham Center for these mockups. It is not an OpenStreetMap tile. The layer checkbox is the same control as the product, drawn in the off position.

## Rebuild

```sh
node mockups/named-pin-density/build.mjs
```

`build.mjs` rewrites the HTML and the map drawings. `assets/mock.css` is edited by hand.
