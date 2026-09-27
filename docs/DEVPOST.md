# StepSafe

**Tagline:** Travel safe. Together.

Live map: https://stepsafe.miami

Code: https://github.com/xVedara/shellhacks-2026

## Inspiration

A block walked without sight hides a sign at head height, a curb two steps ahead, or a car turning through the crosswalk, and nothing remembers what the last walker already met. We built a passive lookout on a phone people already carry, plus a shared memory of neighborhood hazards. This is our first hackathon.

## What it does

StepSafe is a head-mounted iPhone with LiDAR and AirPods for blind and low-vision walkers, and a community map at https://stepsafe.miami. The phone calls https://api.stepsafe.miami.

Path guard speaks ground obstacles, head-height obstacles, and drop-offs in a narrow lane, on the phone, with a spatial tone from the hazard's direction. Crossing assist warns when a car, bike, or pushed cart is closing in. Those alerts stay audible while other speech is muted.

Still obstacles are cropped and pinned at once. Moving people and vehicles stay off the map: the stillness gate re-anchors when a point moves, so a passer-by is never posted. Every 5 seconds a background pass sends each new pin's crop to Gemini (`gemini-flash-lite-latest`), which picks one id from a taxonomy of 67 hazards. `POST /hazards` stores the pin and returns before that call. A pin read as a person or a dog is deleted. A drop-off stays a generic obstacle.

Walk-past clearing: a walker who passes a pin and whose phone sees nothing there casts one downvote of weight 0.6. The same device cannot stack a second miss. A weight-1 pin clears after two different walkers miss it, once confidence is below 0.

Heads-up speaks hazards others already reported, by direction and distance. Anyone can tap to report, or vote and reclassify. Voice control is two AirPods presses, "what's ahead" and mute. StepSafe announces hazards and gives no turn-by-turn route.

## How we built it

ARKit scene depth feeds path guard. Crossing assist pairs a depth closing detector with YOLO11s in Core ML. Alerts are spatial audio plus Core Haptics. English and Spanish phrases are pre-generated with ElevenLabs and bundled offline. Each spoken phrase is a template for a taxonomy id and a height band.

The API is Node and TypeScript on Fastify with MongoDB Atlas. A report merges into an active pin within 10 meters on the same height band, or becomes a new pin at once. Atlas holds a 2dsphere index, TTL expiry by category, and change streams. The site is Next.js and Leaflet on OpenStreetMap.

## Challenges

A head turn used to look like an approaching car, because a YOLO box grows when the camera turns. Growth-only alerts now wait until the head is holding still. Gemini classifies into the closed taxonomy, and the spoken phrase comes from our template.

## Accomplishments

Dev (xVedara) and Ara (iceclatterWT), both first-time hackers, shipped on-device sensing, retroactive Gemini naming, walk-past clearing, and a live map. This branch has 130 iOS tests, 79 server tests, and 36 web tests.

## What's next

Tune path-guard and crossing thresholds on outdoor walks.

## Built with

Swift, SwiftUI, ARKit, Core ML, YOLO11s, Node.js, TypeScript, Fastify, MongoDB Atlas, Google Gemini API, ElevenLabs, Next.js, Leaflet, OpenStreetMap.

## Sponsor tracks

**Best Overall.** On-device sensing, spoken alerts, and a shared map.

**Best First-Time Hacker.** Dev and Ara are both first-time hackers.

**Waymo.** OpenStreetMap crossings, curbs, and tactile paving, plus community hazard reports, with no turn-by-turn route.

**ElevenLabs.** English and Spanish alert phrases are pre-generated with ElevenLabs and play offline.

**MLH Gemini API.** `gemini-flash-lite-latest` names each new pin in the background. The JSON answer is limited to the 67-type taxonomy, and the report is stored first.

**MLH MongoDB Atlas.** Hazards and votes live in Atlas, with a 2dsphere index, TTL expiry by category, and change streams for the live map.

**MLH GoDaddy Registry.** The community map is live at https://stepsafe.miami.

## Team

- Dev (xVedara), first-time hacker
- Ara (iceclatterWT), first-time hacker
