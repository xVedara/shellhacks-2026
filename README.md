# StepSafe

Travel safe. Together.

StepSafe warns blind and low-vision pedestrians about hazards ahead. A head-mounted iPhone uses LiDAR to detect ground obstacles, head-height hazards, and drop-offs. ClosingDetector warns about anything closing fast, including a pushed cart. YOLO11s warns about cars and bikes beyond LiDAR range. Sighted people report and verify hazards in the Scout tab. The Community tab and the web map show those reports on a clustered map. Moving people and vehicles are never pinned.

StepSafe does not replace a guide dog or your own judgment. It does not give walking directions.

Built at ShellHacks 2026 at FIU Graham Center in Miami.

Live map: https://stepsafe.miami. API: https://api.stepsafe.miami (the app calls only this address).

## Architecture

```
 ┌──────────────── iPhone Pro (head mount) ──────────────────┐
 │  ARKit LiDAR depth ──► PathGuard                          │
 │                        (ground / head / drop-off lane)    │
 │  Camera ──► YOLO11s ──► BoxTracker ─┐                     │
 │  LiDAR ───► ClosingDetector ────────┴─► crossing assist   │
 │                         │   (+ standing fast-car path)  │
 │                         ▼                                 │
 │               AlertPolicy ──► AlertManager                │
 │               (priority, mute) (spatial tone, haptics,    │      AirPods
 │                                 voice) ───────────────────┼────► what's ahead / mute
 │                                                           │
 │  HazardNamer (still objects only; moving people and       │
 │  vehicles are never pinned) + MapSync walk-past misses    │
 │  Scout tab + Community tab (clustered map, stacked-       │
 │  hazard chooser, one shared vote store)                   │
 └─────────┬────────────────────────────────▲────────────────┘
           │ POST /hazards                  │ GET /hazards/near
           │ (crop, lat/lng, band)          │ GET /events (SSE)
           │ POST /hazards/:id/votes        │ GET /tts (spoken name)
           ▼                                │
 ┌───────────────── API server (Fastify) ───┴────────────────┐
 │  merge within 10 m ─or─ new pin (needsNaming)             │
 │  renamer every 5 s ──► one of 67 taxonomy labels          │
 │               Gemini (or Qwen via Ollama)                 │
 │  votes: walk-past miss = 0.6; 2 walkers' misses clear     │
 │  ElevenLabs ──► /tts cache                                │
 └─────────┬──────────────────────▲──────────────────┬───────┘
           │ reads / writes       │ change stream    │ GET /events (SSE)
           ▼                      │                  │ GET /hazards, votes
 ┌──────── MongoDB Atlas ─────────┴───────┐          │
 │  hazards (2dsphere, TTL by category),  │          │
 │  votes, users                          │          │
 └────────────────────────────────────────┘          ▼
 ┌──────────── Web map (Next.js + Leaflet / OSM) ────────────┐
 │  live pins (clustered), hazard details, verify queue      │
 │  (vote/retype), per-route titles, 404 page                │
 └───────────────────────────────────────────────────────────┘
```

The phone detects an obstacle on the device. On-device alerts do not need a network.

The phone crops the obstacle and sends `POST /hazards` with the crop, latitude, longitude, height band, and `deviceId`. That post is a PathGuard hazard or a Scout report. `ServerLink.handle` does not pin a closing alert.

The server merges the report into a nearby pin, or stores a new pin as type `obstacle` with `needsNaming` and answers at once. It never names a crop inline. A renamer names new pins every 5 seconds: a `GEMINI_API_KEY` selects Google Gemini; with no key, Ollama names the crop when `qwen3.8:27b-mlx` is available. The pin is live before it has a name. A failed name is retried with backoff, up to 8 attempts.

A walker who passes a pin and sees nothing sends one walker down-vote of weight 0.6. One device counts once per pin. A pin clears once its confidence drops below 0 after 2 different walkers passed it, or below -2 from explicit votes.

The phone requests a spoken hazard name from `GET /tts`. With no `ELEVENLABS_API_KEY`, that route returns 503 and the phone uses on-device speech.

The web map receives the pin on `GET /events` using Server-Sent Events. Other walkers receive it on the next `GET /hazards/near`.

## Repo layout

```
ios/         StepSafe iOS app. Swift, SwiftUI, ARKit, and Core Haptics.
server/      Node and TypeScript API. Fastify, MongoDB, Gemini or Ollama, and ElevenLabs.
web/         Community map. Next.js, TypeScript, Tailwind, Leaflet, and OpenStreetMap.
scripts/     dev-up.sh starts the local stack. seed-demo.ts loads demo hazards.
docs/        DEMO.md is the live demo script.
brandguide/  Logos, colors, and voice. See brandguide/README.md.
```

- [`server/README.md`](server/README.md) covers the API, env vars, the naming provider, and how to run and test.
- [`web/README.md`](web/README.md) covers pages, map encoding, accessibility, and how to run and build.
- [`ios/README.md`](ios/README.md) covers app modules, the Release build note, tests, the fixed API address, and credits.

## Quick start

Use Node 20.19 or newer. The `mongodb` package requires it.

For naming without a Gemini key, run Ollama and pull the model named in `server/.env.example`.

```sh
ollama pull qwen3.8:27b-mlx
```

To use Gemini instead, set `GEMINI_API_KEY` in `server/.env`.

```sh
cd server && npm install && cd ../web && npm install && cd ..
scripts/dev-up.sh
scripts/dev-up.sh stop
```

`scripts/dev-up.sh` starts MongoDB, seeds demo hazards, and starts the API and the web map. `scripts/dev-up.sh stop` stops the processes that script started.

The phone talks only to `https://api.stepsafe.miami` (`APIClient.baseURL`). That address is not a setting. The Walker debug panel prints it as text. To test against a local `dev-up.sh` stack, change that constant in a dev build. [`docs/DEMO.md`](docs/DEMO.md) has the pre-demo checklist and the live demo script. [`server/README.md`](server/README.md) lists `MONGODB_URI`, `GEMINI_API_KEY`, and `ELEVENLABS_API_KEY`.

## License

StepSafe is licensed under the [GNU AGPL-3.0](LICENSE). The iOS app bundles the Ultralytics YOLO11s model, which is also AGPL-3.0, so the repo uses that license.

## Credits

- Models, services, libraries, the Inter font, and build tools are listed in [CREDITS.md](CREDITS.md). iOS detail is in [ios/CREDITS.md](ios/CREDITS.md). Texts that have to ship with the app are in [LICENSES/](LICENSES/).
- Map data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, [ODbL 1.0](https://opendatacommons.org/licenses/odbl/). `web/public/osm-graham.json` stays under the ODbL. That file is separate from the AGPL code.

## AI tools used

Dev Goswami used Cursor (IDE and cloud agents) and Grok (including Grok Bot). Ara Babigian used Claude Code (Anthropic). Models used: Grok 4.7, Claude Code, Claude Opus, Codex, GPT Image 2.5 (the logos). The short account is in [CREDITS.md](CREDITS.md).
