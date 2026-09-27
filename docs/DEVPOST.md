# StepSafe

**Tagline:** Travel safe. Together.

Live map: https://stepsafe.miami

Code: https://github.com/xVedara/shellhacks-2026

## Inspiration

A block walked without sight can hide a sign at head height, a curb two steps ahead, or a car in the crosswalk, and nothing remembers what the last walker already met. We built a lookout on a phone people already carry, plus a shared map of neighborhood hazards. This is our first hackathon.

## What it does

StepSafe is a head-mounted iPhone with LiDAR and AirPods for blind and low-vision walkers, and a community map at https://stepsafe.miami. The phone calls only https://api.stepsafe.miami. That address is fixed in the app.

Path guard speaks ground, head-height, and drop-off hazards on the phone, with a spatial tone from the hazard's direction. Crossing assist warns when a car, bike, or pushed cart is closing in. Those alerts stay audible while other speech is muted. Two AirPods presses cover "what's ahead" and mute. There is no turn-by-turn route.

Still obstacles are cropped and pinned at once. Moving people and vehicles stay off the map. Every 5 seconds Gemini (`gemini-flash-lite-latest`) picks one id from a taxonomy of 67 hazards. A walker who passes a pin and sees nothing casts one downvote of weight 0.6 and cannot stack a second miss. Heads-up speaks other reports by direction and distance.

## How we built it

ARKit scene depth feeds path guard. Crossing assist pairs a depth closing detector with YOLO11s in Core ML. Alerts are spatial audio plus Core Haptics. English and Spanish phrases are pre-generated with ElevenLabs and play offline. The API is Node and TypeScript on Fastify with MongoDB Atlas. A report merges into an active pin within 10 meters on the same height band, or becomes a new pin at once.

## Challenges

A head turn used to look like an approaching car, because a YOLO box grows when the camera turns. Growth-only alerts now wait until the head is holding still. Gemini classifies into the closed taxonomy, and the spoken phrase comes from our template.

## Accomplishments

Dev (xVedara) and Ara (iceclatterWT), both first-time hackers, shipped on-device sensing, retroactive Gemini naming, and walk-past clearing. Tests on this branch: 140 iOS, 79 server, and 37 web.

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
