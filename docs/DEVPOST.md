# StepSafe

**Tagline:** Travel safe. Together.

Live map: https://stepsafe.miami

Code: https://github.com/xVedara/shellhacks-2026

## Inspiration

A block walked without sight hides a sign at head height, a curb two steps ahead, or a car turning through the crosswalk, and nothing remembers what the last walker already met. We built a passive lookout on a phone people already carry, plus a shared memory of neighborhood hazards. This is our first hackathon.

## What it does

StepSafe is a head-mounted iPhone with LiDAR and AirPods for blind and low-vision walkers, and a community map at https://stepsafe.miami. The phone calls https://api.stepsafe.miami.

Path guard speaks ground, head-height, and drop-off hazards in a narrow lane, on the phone, with a spatial tone from the hazard's direction. Crossing assist warns when a car, bike, or pushed cart is closing in. Those alerts stay audible while other speech is muted.

Still obstacles are cropped and pinned at once. The stillness gate re-anchors when a point moves, so moving people and vehicles stay off the map. Every 5 seconds Gemini (`gemini-flash-lite-latest`) picks one id from a taxonomy of 67 hazards for each new pin's crop. `POST /hazards` stores the pin and returns before that call. A person or a dog is deleted. A drop-off stays a generic obstacle.

A walker who passes a pin and sees nothing there casts one downvote of weight 0.6. The same device cannot stack a second miss. A weight-1 pin clears after two different walkers miss it, once confidence is below 0. Heads-up speaks other reports by direction and distance. Anyone can report, vote, or reclassify. Two AirPods presses cover "what's ahead" and mute. StepSafe gives no turn-by-turn route.

## How we built it

ARKit scene depth feeds path guard. Crossing assist pairs a depth closing detector with YOLO11s in Core ML. Alerts are spatial audio plus Core Haptics. English and Spanish phrases are pre-generated with ElevenLabs and bundled offline. Each spoken phrase is a template for a taxonomy id and a height band. The API is Node and TypeScript on Fastify with MongoDB Atlas. A report merges into an active pin within 10 meters on the same height band, or becomes a new pin at once. Atlas holds a 2dsphere index, TTL expiry by category, and change streams. The site is Next.js and Leaflet on OpenStreetMap.

## Challenges

A head turn used to look like an approaching car, because a YOLO box grows when the camera turns. Growth-only alerts now wait until the head is holding still. Gemini classifies into the closed taxonomy, and the spoken phrase comes from our template.

## Accomplishments

Dev (xVedara) and Ara (iceclatterWT), both first-time hackers, shipped on-device sensing, retroactive Gemini naming, walk-past clearing, and a live map. The app has 140 iOS tests, 79 server tests, and 36 web tests.

## What's next

Tune path-guard and crossing thresholds on outdoor walks.

## Built with

Swift, SwiftUI, ARKit, Core ML, YOLO11s, Node.js, TypeScript, Fastify, MongoDB Atlas, Google Gemini API, ElevenLabs, Next.js, Leaflet, OpenStreetMap.

## Sponsor tracks

**Best Overall.** On-device sensing, spoken alerts, and a shared map.

**Best First-Time Hacker.** Dev and Ara are both first-time hackers.

**Microsoft.** No chat interface: two fixed AirPods commands, not a conversation. AI runs inside perception, never as a dialogue layer.

**Waymo.** OpenStreetMap crossings, curbs, and tactile paving, plus community hazard reports, with no turn-by-turn route.

**ElevenLabs.** English and Spanish alert phrases play offline.

**MLH Gemini API.** `gemini-flash-lite-latest` names each new pin in the background, inside the 67-type taxonomy. The report is stored first.

**MLH MongoDB Atlas.** Hazards and votes live in Atlas: a 2dsphere index, TTL expiry by category, and change streams.

**MLH GoDaddy Registry.** The community map is live at https://stepsafe.miami.

## Credits and licenses

OpenStreetMap tiles and the Graham Center extract are ODbL, © OpenStreetMap contributors. Leaflet draws the map. YOLO11s by Ultralytics detects vehicles on the phone. The weights are AGPL-3.0-only, so this repo is AGPL-3.0-only. They are a WiSE-FT blend of stock YOLO11s and a fine-tune on the WOTR and blind-crossing datasets (CC BY 4.0). Google Gemini names a hazard crop. ElevenLabs speaks alerts. The clips were generated on Ara's ElevenLabs account (Creator plan, redeemed through MLH).

## AI tools used

StepSafe was built at ShellHacks 2026 with AI coding tools. Ara Babigian used Claude Code. Cursor cloud agents authored commits and opened pull requests. Commit messages name two review gates: Claude Opus and Codex. Logos were made with GPT Image 2.

## Team

- Dev (xVedara), first-time hacker
- Ara (iceclatterWT), first-time hacker
