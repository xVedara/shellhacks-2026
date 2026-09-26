# StepSafe

StepSafe is a head-mounted iPhone (LiDAR) plus AirPods that warns blind and low-vision
pedestrians about what's ahead — ground obstacles, head-height hazards, drop-offs, and
fast-closing crossing hazards (cars, bikes, a pushed cart) — and a community map where
every walk makes the next one safer. Sighted Scouts can report and verify hazards from
the same app. It's a hazard layer, not a guide: StepSafe doesn't replace a cane, a guide
dog, or your own judgment, and it never gives walking directions.

Built at ShellHacks 2026 (FIU Graham Center, Miami).

## Architecture

```
 iPhone (head rig)                    API server                  Web map
 ARKit LiDAR + Vision                 Node + TypeScript            Next.js + Leaflet
 ─────────────────────                ───────────────              ────────────────
 PathGuard (ground/head/drop-off) ─┐                            ┌─ live pin updates
 ClosingDetector + YOLO11n         │   POST /hazards            │
   (crossing assist)               ├──────────────────────────► │  (SSE)
 AlertManager (spatial tones,      │   crop, lat/lng, band       │
   AirPods what's-ahead / mute)    │                            │
 Scout tab (tap to report,         │                            │
   taxonomy type picker)           │                            │
                                    ▼                            │
                              MongoDB (geo + TTL + change stream)│
                                    │                            │
                              Qwen (Ollama, local) or Gemini      │
                              names the crop; ElevenLabs speaks   │
                              it back to the phone (GET /tts) ────┘  GET /events (SSE)
                                                                     GET /hazards/near
```

A new hazard, end to end: the phone flags an obstacle on-device (no network needed for
safety), crops it, sends `POST /hazards`. That post is a path-guard or Scout hazard;
`ServerLink.handle` does not pin a closing alert. The server merges it into a nearby
pin or names it (local Qwen via Ollama today, Google Gemini in production), and the
phone speaks the label. The web map picks it up live over Server-Sent Events; other
walkers get it on their next nearby lookup.

## Repo layout

```
ios/            StepSafe iOS app (Swift, SwiftUI, ARKit, Core Haptics)
server/         Node + TypeScript API (Fastify, MongoDB, Gemini/Ollama, ElevenLabs)
web/            Community map (Next.js + TypeScript + Tailwind, Leaflet + OpenStreetMap)
scripts/        dev-up.sh (one-command local bring-up), seed-demo.ts
docs/           DEMO.md — the live demo script
brandguide/     Logos, colors, voice (uncommitted assets; see its own README)
```

- [`server/README.md`](server/README.md) — API, env vars, naming provider, run/test.
- [`web/README.md`](web/README.md) — pages, map encoding, accessibility, run/build.
- [`ios/README.md`](ios/README.md) — app modules, build (Release note), test, Settings URL, credits.

## Quick start (local demo)

Requires Node 20+, and Ollama running locally if you want live naming without a
Gemini key (`ollama pull qwen3.8:27b-mlx`, or set `GEMINI_API_KEY` in `server/.env`).

```sh
cd server && npm install && cd ../web && npm install && cd ..
scripts/dev-up.sh          # starts Mongo, seeds demo hazards, starts the API and web map
# ... use it ...
scripts/dev-up.sh stop     # stops exactly what dev-up.sh started
```

`dev-up.sh` prints the web map URL, the API URL, and the URL to put in the iOS app's
Settings so a phone on the same Wi-Fi can reach the server. See
[`docs/DEMO.md`](docs/DEMO.md) for the full pre-demo checklist and live demo script,
and `server/README.md` for env vars (`MONGODB_URI`, `GEMINI_API_KEY`,
`ELEVENLABS_API_KEY`, ...).

## Credits

- Map data: © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, [ODbL 1.0](https://opendatacommons.org/licenses/odbl/).
- Map rendering: [Leaflet](https://leafletjs.com/) via `react-leaflet`.
- Vision: [ElevenLabs](https://elevenlabs.io/) text-to-speech for alert and hazard-name voice.
- Naming: [Google Gemini](https://ai.google.dev/) in production; a local [Qwen](https://ollama.com/library/qwen) vision model via [Ollama](https://ollama.com/) stands in for Gemini during local development (no key needed, unlimited local use).

## AI tools used

Built with [Claude Code](https://claude.com/claude-code) (Anthropic) and [Cursor](https://cursor.com/) as coding assistants throughout the hackathon, per Devpost's AI-tool disclosure rule.
