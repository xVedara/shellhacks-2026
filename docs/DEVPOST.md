# StepSafe — Devpost submission draft

**Tagline:** Detect. Alert. Move Freely.

*(Draft for the Devpost form fields. TODO(Ara): paste each section into its field, opt into the tracks below, add the demo video link, then submit before Sun Sep 27, 11:00 AM ET.)*

**Live:** https://stepsafe.miami (community map) · https://api.stepsafe.miami (API) · repo: github.com/xVedara/shellhacks-2026

---

## Inspiration

Walking a block without sight means hazards you can't know are coming: a sign at head height, a curb two steps ahead, a car turning into the crosswalk, scaffolding around the corner — and nothing remembers what the last person who walked this block ran into. We wanted a passive, always-on lookout plus a shared memory of a neighborhood's hazards that grows with every walk. This was both our first hackathon, so we picked a problem where the hardware people already carry — a phone's camera and LiDAR, a pair of earbuds — mattered more than anything exotic.

## What it does

StepSafe is a head-mounted iPhone Pro Max (LiDAR) plus AirPods for blind and low-vision walkers, backed by a live community hazard map anyone can contribute to from the same app.

- **Path guard** watches a lane about 0.7 m wide and five meters ahead, calling out ground obstacles, head-height obstacles, and drop-offs with a spatial tone from the right direction — entirely on-device, no network needed.
- **Crossing assist** warns about anything closing in fast at a crossing (car, bike, pushed cart) and is never silenced by mute.
- **Hazard naming**: still obstacles (never moving people or vehicles) are cropped and pinned at once; Gemini names them in the background seconds later, so reporting never waits on a model.
- **Self-cleaning map**: when two different walkers pass a pin and the phone sees nothing there, it is cleared, so stale hazards don't linger.
- **Heads-up**: hazards other people already reported are announced by direction and distance before you reach them.
- **Scout mode**: anyone can tap to report a hazard, or just walk with passive detection running, and can upvote, downvote, or reclassify nearby reports.
- **Community map** (web, live at stepsafe.miami): a Leaflet/OpenStreetMap view that updates in real time, with a verify queue for remote volunteers.

Controls are two fixed AirPods presses — "what's ahead" and mute — nothing conversational. StepSafe is a hazard layer, not a replacement for a guide dog or a person's own judgment, and it never gives walking directions.

## How we built it

**iOS.** `ARWorldTrackingConfiguration` with `sceneDepth`/`smoothedSceneDepth` gives a live LiDAR depth map. Path guard unprojects a central band of depth pixels into world points, buckets them into ground/head/drop-off bands against the detected floor plane, and requires a few consecutive confirming frames before alerting. Crossing assist runs two detectors together: a depth-based `ClosingDetector` that flags anything whose range is shrinking fast (so a pushed cart triggers it, not just a labeled vehicle class), and YOLO11n (Ultralytics, Core ML, pretrained on COCO) for cars, bikes, and people beyond LiDAR's ~5 m range, tracked frame-to-frame by IoU. Alerts play as spatial audio — one `AVAudioEngine` with an `AVAudioEnvironmentNode` (HRTF) positioning each tone at the hazard's real 3D point, listener pose copied from the AR camera every frame since the head mount means phone pose is head pose — plus Core Haptics on the highest-priority alerts.

**Voice.** ~70 fixed phrases per language (English/Spanish) are pre-generated with ElevenLabs (voice "Sarah") and bundled so alerts play instantly offline; live hazard names come from a `/tts` endpoint cached by content hash, falling back to on-device `AVSpeechSynthesizer` if ElevenLabs is unreachable. Safety detection never waits on any of this either way.

**Server.** Node + TypeScript on Fastify with MongoDB Atlas. A new report merges into an existing pin within 10 m (city GPS error) sharing a height band, or becomes a new pin right away; merge and creation are serialized so concurrent reports never fork into duplicates. A walker who passes a pin while the phone sees nothing there casts a fixed -0.6 vote; two such walkers clear a single-reporter pin. It exposes hazard CRUD, voting, reclassification, a taxonomy endpoint, and a Server-Sent Events stream that drives the live map.

**Database.** MongoDB Atlas: a `2dsphere` index for proximity queries, TTL indexes so hazards expire by category (moving 6 h, temporary 7 d, permanent 90 d), and change streams feeding the live map over SSE. Tests run against an in-memory replica set; production is the Atlas cluster.

**Naming.** Naming is retroactive: a background pass every 5 s sends each new pin's crop to Gemini (`gemini-flash-lite-latest`), which returns structured JSON — a taxonomy id, category, height band, and severity — in about 1.3 s in our tests. A pin that turns out to be a person or dog is deleted. Failed calls back off and retry for about 14 minutes. During development we ran a local Qwen vision model through Ollama behind the same interface (warm p50 ~4.7 s); the server picks whichever provider is configured, and falls back to a generic "obstacle" if naming fails, so a slow or down model never blocks a report.

**Web map.** Next.js (App Router) + TypeScript + Tailwind, `react-leaflet` over OpenStreetMap tiles (no API key), plus an OSM reference layer of crossings, curbs, and tactile paving. A verify queue lets remote volunteers page through low-confidence hazards and vote, reclassify, or report them.

**Deployment.** Everything runs on an NVIDIA Jetson under PM2, exposed through a named Cloudflare Tunnel at stepsafe.miami (web) and api.stepsafe.miami (API) — no open ports, TLS at Cloudflare's edge. The phone app talks to the API over HTTPS.

**Hazard taxonomy / safety design.** These labels get spoken to someone who can't see the object, so we never let a model's raw text reach anyone's ears. The server maintains a fixed taxonomy of 67 hazard types; Gemini only picks an id from that list plus category, height band, and severity. Every spoken phrase is generated deterministically from `(taxonomy id, height band)` through our own templates — never from model or user text.

## Challenges we ran into

The hardest bug wasn't sensing, it was the user's own head motion: early crossing-assist builds read "car approaching" from ordinary head turns, because YOLO box growth from a turning camera looks like a real closing object. Several tuning rounds (roll-proofing, jitter-proofing, re-matching boxes across turns) led to a "look and hold" design — growth-only alerts fire only while the head is holding roughly still — which cut false alarms without meaningfully delaying real approaching vehicles.

The second was a design call, not a bug: we considered speaking whatever text a vision model returned for a hazard. For a sighted person, "bin" instead of "trash can" is a shrug; for someone trusting the voice completely, a hallucinated or manipulated label is dangerous. That's what pushed us to a fixed taxonomy — the model only classifies into a closed set we control, and every word a walker hears comes from our own template, never the model's.

Device testing surfaced issues simulation missed: the "what's ahead" press was also replaying a queued head-height alert, and a hazard next to a drop-off was announced as "drop-off: person". Both were fixed the same day from on-phone feedback — "what's ahead" now clears the queue and says only what's ahead.

We also lost time to a subagent whose cleanup command matched too broadly and killed our local Mongo, API, and other running processes mid-build (data reseeded, no lasting damage) — after that, a hard rule: never `pkill`/`killall`, only stop what you personally started.

## Accomplishments that we're proud of

A full sense-decide-speak pipeline — LiDAR geometry, on-device vision, spatial audio, and a live community backend — built and deployed in one hacking window by two first-time hackers. It works on a physical iPhone: walker warnings, AirPods "what's ahead" and mute, a closing object still sounding while muted, reports named by Gemini, spoken back, and appearing on the live web map, and heads-up for hazards others reported. Real test coverage backs it (128 iOS tests including a crossing scenario and Monte Carlo suite, 79 server tests, 36 web tests), with an adversarial review pass on every multi-file slice before merging. "Closing objects are never muted" is enforced in one place in the code, with a dedicated test, not hoped-for behavior scattered across callers.

## What we learned

Boring geometry — floor-plane detection, depth-confidence filtering, lane math — does more for trust in a safety tool than any single AI call. "Advisory only" isn't just a Devpost rule; it shapes real decisions, like never implying the ground ahead is safe. And for something spoken into a blind user's ear, a fixed vocabulary beats flexible model output every time.

## What's next

Tune path-guard and crossing thresholds on real outdoor walks instead of simulated and indoor ones. Explore text-prompted detection (YOLO-World/YOLOE) for on-device naming of cones and scaffolding. Add report moderation and karma settlement on natural expiry.

---

## Built with

Swift, SwiftUI, ARKit, Core ML, Vision, AVAudioEngine, Core Haptics, CoreLocation, Node.js, TypeScript, Fastify, MongoDB Atlas, Google Gemini API, ElevenLabs, Next.js, React, Tailwind CSS, Leaflet, OpenStreetMap, YOLO11n (Ultralytics), Ollama, Qwen, Cloudflare Tunnel, NVIDIA Jetson, PM2, Claude Code, Cursor, Codex, GPT Image 2.

## Sponsor tracks

**Best Overall.** Auto-entered.

**Waymo.** Pedestrian mobility safety on public data — OpenStreetMap crossings, curbs, and tactile paving, layered with community hazard reports on an OSM-tiled map. We don't route or give directions, so this is a safer-walking fit, not navigation.

**Best First-Time Hacker.** Ara Babigian and Dev Goswami are both first-time hackers; both opt in.

**Microsoft.** No chat interface anywhere, by design — voice control is two fixed AirPods commands, not a conversation. AI runs inside perception (naming, path/crossing detection), never as a dialogue layer.

**Gemini API (MLH).** Live: every new hazard pin is named in the background by `gemini-flash-lite-latest` with a structured JSON response constrained to our 67-type taxonomy (about 1.3 s per call in our tests), so walkers never wait on the model.

**ElevenLabs (MLH).** Live: ~70 bundled fixed phrases per language generated with ElevenLabs, plus a live `/tts` endpoint for server-generated names, cached by content hash, with on-device speech as fallback.

**MongoDB Atlas (MLH).** Live: the deployed API stores hazards and votes in Atlas, with a `2dsphere` index for proximity queries, TTL expiry by category, and change streams driving the real-time map.

**GoDaddy Registry (MLH).** stepsafe.miami, registered with the MLH GoDaddy Registry code, is live — the community map at stepsafe.miami and the API at api.stepsafe.miami, served from our Jetson through a Cloudflare Tunnel.

## Credits and licenses

- Map data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, [ODbL 1.0](https://opendatacommons.org/licenses/odbl/).
- Map rendering by [Leaflet](https://leafletjs.com/) via `react-leaflet`.
- Vehicle/person detection: **YOLO11n** by [Ultralytics](https://github.com/ultralytics/ultralytics), pretrained on COCO, exported to Core ML. Licensed **AGPL-3.0**, so the StepSafe repo is AGPL-3.0 too.
- Hazard naming: [Google Gemini API](https://ai.google.dev/).
- Text-to-speech: [ElevenLabs](https://elevenlabs.io/) (Creator plan via MLH).
- Development naming stand-in: a [Qwen](https://ollama.com/library/qwen) vision model via [Ollama](https://ollama.com/).

## AI tools used

Built with [Claude Code](https://claude.com/claude-code) (Anthropic) and [Cursor](https://cursor.com/) as coding assistants throughout the hackathon, with [Codex](https://openai.com/codex/) (OpenAI) as a second code reviewer. The StepSafe logo was made with GPT Image 2 (OpenAI).

## Team

- **Ara Babigian** — first-time hacker
- **Dev Goswami** — first-time hacker
