# Civic reports

Static mockups for the StepSafe community map. They do not change the iOS app, the API, or the web app.

Open `index.html` in a browser. Each screen is one file. Add `?theme=dark` for the dark theme, or use the theme control on the page. The gallery shows light and dark together.

```
mockups/civic-reports/
  index.html          gallery of the live pages and the PNGs
  shots/              18 PNGs: mobile-app, mobile-web, desktop × live-map, verify, hazard × light, dark
  desktop/            sidebar, live map, verify queue, hazard record
  mobile-web/         browser chrome and the two top tabs
  mobile-app/         status bar, large titles, bottom tabs
  assets/             CSS, behavior, Public Sans
```

Filenames look like `shots/mobile-app-live-map-light.png`. Desktop captures are 1440×900 CSS pixels. Phone captures are 390×844. Both are saved at 2×.

## What this direction is

Civic reports treats the product as a public record, not a chat and not a purple SaaS dashboard.

- **Coinbase** for institutional trust: navy, paper surfaces, hairlines, tabular figures, no glow.
- **Wise** for hierarchy: the label sits above the figure, the figure is large, and secondary facts stay quiet.
- **ETA slips** for hazards, Scouts, and other community votes. Each row is a name, a distance, and a confidence (or a vote weight). There is no message bubble.

## What stays the same

The live information architecture is unchanged.

- Destinations are Live map, Verify queue, and Hazard details.
- Desktop uses the left sidebar. Mobile web uses two tabs under the header. The mobile app uses the same two destinations as a bottom tab bar. Hazard details pushes over those tabs.
- The feed sits with the map. The queue is least-confident first. Votes are Still there, Gone, and Skip.
- Category is a color plus a letter (moving M, temporary T, permanent P). Height is a shape (circle, triangle, square). Pin size is confidence. Sample records stay dashed.
- Scout appears in the vote history, as a role on a record. There is no Scout tab in this map.

Copy follows the current web app, including the 3 mile radius around FIU Graham Center.

## Color

| Token | Hex | Use |
| --- | --- | --- |
| Navy | `#081624` | Text, primary buttons, dark surfaces |
| Orange | `#FF7900` | Hazards and warnings only |
| Blue | `#087FF5` | Controls, confidence meters, focus |
| Signal | `#13B9F2` | The live stream dot |

Orange is never small text on white. Links use a darker blue (`#0A66C8` in light, `#8ECBFF` in dark) so they clear WCAG AA. Moving and permanent pins keep the product’s amber and red, with the letter, so category is not color alone.

## Not in these files

The map is a campus drawing so the mockups open without a tile server. The live app still uses Leaflet and © OpenStreetMap contributors. Buttons show the result they would have; they do not call the API.
