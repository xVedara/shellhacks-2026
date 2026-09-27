# StepSafe

**Tagline:** Travel safe. Together.

Live map: https://stepsafe.miami

API: https://api.stepsafe.miami

Code: https://github.com/xVedara/shellhacks-2026

## Inspiration

A block walked without sight can hide a sign at head height, a curb two steps ahead, or a car in the crosswalk. We built a lookout on a phone people already carry, plus a shared map of neighborhood hazards. This is our first hackathon.

## What it does

StepSafe is a head-mounted iPhone with LiDAR and AirPods for blind and low-vision walkers. The community map is https://stepsafe.miami. The phone calls only https://api.stepsafe.miami. That address is fixed in the app.

Path guard speaks ground, head-height, and drop-off hazards. Crossing assist warns when a car, bike, or pushed cart is closing in. Two AirPods presses cover "what's ahead" and mute. There is no chatbot, no chat window, and no turn-by-turn route.

Still obstacles are cropped and pinned at once. Moving people and vehicles are never pinned. Every 5 seconds Gemini (`gemini-flash-lite-latest`) names already-pinned hazards with one of 67 types. A walker who passes a pin and sees nothing downvotes it once (weight 0.6). Two such walkers clear it. Heads-up speaks other reports by direction and distance.

The Community tab on the phone and the web map cluster nearby pins. On the phone, tapping stacked pins opens a chooser, and the Community and Scout tabs share one vote per hazard. The web map has a title per page, a 404 page, a WCAG 2.2 AA pass, and a layout that holds at 200% zoom.

## How we built it

ARKit scene depth feeds path guard. Crossing assist pairs a depth closing detector with YOLO11s in Core ML. A close car crossing in front of a walker who is standing still can alert after 0.4 seconds. Alerts use spatial audio and Core Haptics. English and Spanish ElevenLabs phrases play offline. The API is Node and TypeScript on Fastify with MongoDB Atlas. A report within 10 meters on the same height band merges into one pin.

## Challenges

A head turn used to look like an approaching car. A YOLO box grows when the camera turns. Growth-only alerts now wait until the head is holding still. Gemini stays inside a closed taxonomy. The spoken phrase comes from our template.

## Accomplishments

Dev (xVedara) and Ara (iceclatterWT) shipped on-device sensing, spoken alerts, retroactive Gemini naming, and walk-past clearing. Tests on this branch: 146 iOS, 79 server, and 51 web, all passing.

## What's next

Tune path-guard and crossing thresholds on outdoor walks.

## Built with

Swift, SwiftUI, ARKit, Core ML, YOLO11s, Node.js, TypeScript, Fastify, MongoDB Atlas, Google Gemini API, ElevenLabs, Next.js, Leaflet, OpenStreetMap.

## Sponsor tracks

<!-- Opt-ins: Microsoft What's Missing? ON. MLH / GoDaddy Registry Best Domain Name ON. Do not enter: Assurant, Blackstone, Sperry, State Farm, INIT, Solana, Tiger Data, DigitalOcean, Snowflake. -->

**Best Overall (auto).** On-device sensing, spoken alerts, and a shared map.

**Best First-Time Hacker.** Dev and Ara are both first-time hackers.

**Microsoft — What’s Missing?** No chatbot and no chat window. Two fixed AirPods commands, not a conversation. AI runs inside perception.

**Waymo Mobility Challenge.** OpenStreetMap crossings, curbs, and tactile paving, plus community hazard reports. No turn-by-turn route.

**MLH / ElevenLabs Best Use of ElevenLabs.** English and Spanish alert phrases play offline.

**MLH / Google Cloud Best Use of Gemini API.** `gemini-flash-lite-latest` names each new pin in the background, inside a 67-type taxonomy. The report is stored first.

**MLH / MongoDB Best Use of MongoDB Atlas.** Hazards and votes live in Atlas with a 2dsphere index, TTL by category, and change streams.

**MLH / GoDaddy Registry Best Domain Name.** https://stepsafe.miami is live.

## Rules

StepSafe was not submitted to any other hackathon. No work was done outside the official ShellHacks hacking period. Libraries, frameworks, and open source are allowed. External code is documented in this write-up and must be mentioned in judging. This team has one project. We created it at the event. We follow the MLH Code of Conduct.

## Credits and licenses

OpenStreetMap tiles and the Graham Center extract are ODbL, © OpenStreetMap contributors. Leaflet draws the map. YOLO11s by Ultralytics is AGPL-3.0-only, and this repo is AGPL-3.0-only. The phone weights blend stock YOLO11s with a fine-tune on the WOTR and blind-crossing datasets (CC BY 4.0). Google Gemini names a hazard crop. With no Gemini key, Qwen (`qwen3.8:27b-mlx`, Apache-2.0) runs through Ollama (MIT). ElevenLabs speaks alerts on Ara's MLH Creator plan. MongoDB Atlas stores hazards and votes. Full list: CREDITS.md in the repo.

## AI tools used

Dev Goswami used Cursor (IDE and cloud agents) and Grok (including Grok Bot). Ara Babigian used Claude Code (Anthropic). Models used: Grok 4.7, Claude Code, Claude Opus, Codex, GPT Image 2.5 (the logos).

## Team

- Dev Goswami (xVedara), first-time hacker
- Ara Babigian (iceclatterWT), first-time hacker
