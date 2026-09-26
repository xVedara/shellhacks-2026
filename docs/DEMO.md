# StepSafe: 3-minute live demo

Source: `PLAN.md` section 14, updated below to what's actually built on `work` as of
this branch's base commit (`bd2f366`).

## Status check (read this first)

What's confirmed working on `work` today:

- **Path guard, on-device, no network:** drop-off, head-height, and ground-obstacle
  alerts with spatial tones, priority ordering, and AirPods mute / what's-ahead
  (`ios/StepSafe/AlertManager.swift`, `Core/PathGuard.swift`, `Core/AlertPolicy.swift`).
- **Server + web, fully working on their own:** hazard reports, merging, naming
  (local Qwen via Ollama or Gemini), ElevenLabs voice, the live map, and the verify
  queue with a type picker (`server/README.md`, `web/README.md`).

**Not yet on `work`, still in separate iOS worktrees (in progress):**

- **Crossing assist.** `ios/` on `work` has no `ClosingDetector` / crossing-assist
  code at all — `AlertPolicy`/`PathGuard` only know `ground`, `head`, and `dropoff`.
  It exists on the `ios-slice2` worktree ("iOS slice 3: crossing assist... priority 1")
  but has not merged.
- **Phone-to-server round trip.** There is no networking code in `ios/StepSafe` yet
  (no `POST /hazards`, no Settings screen for the server URL, no heads-up / Scout
  view). This means demo steps 2-4 below (naming a sign, a second phone getting a
  heads-up, live pins from a real phone) are **not runnable from the iOS app on
  `work` today** — they need the iOS server-integration work to land first.

If that work has landed by demo time, ignore the "not runnable" notes below and run
the script as written. If it hasn't, use the fallback for each step — the server and
web map are real and can be shown live without a phone (see step 4 fallback).

## Pre-demo checklist

- [ ] Both demo phones charged.
- [ ] Phones and laptop on the same Wi-Fi (the venue network, or a hotspot if it's flaky).
- [ ] Start the stack with `HOST=0.0.0.0` so phones on the LAN can reach it:
      `scripts/dev-up.sh` (defaults to `HOST=0.0.0.0` already; don't override to `127.0.0.1`).
- [ ] Note the "Phone Settings server URL" `dev-up.sh` prints and enter it in the iOS
      app's server setting on **both** phones (once that setting exists).
- [ ] `ollama ps` shows `qwen3.8:27b-mlx` loaded (not just pulled) — a cold load adds
      several seconds to the first naming call. If it's not loaded, `dev-up.sh`
      already warms it via the server's startup call; give it a few seconds and
      re-check.
- [ ] `ELEVENLABS_API_KEY` is present in `server/.env` (voice fallback is silent
      otherwise — the app still works, just with the built-in system voice).
- [ ] Demo hazards are seeded (`dev-up.sh` runs `npm run seed:demo` automatically;
      confirm the map isn't empty).
- [ ] iOS app installed on both phones from Xcode (⌘R) — no App Store/TestFlight.
- [ ] AirPods paired to the walker's phone with **default** press controls (a single
      press = what's ahead, double press = mute toggle; rebound controls have not
      been tested against `MPRemoteCommandCenter`).

## The script

**1. Drop-off (path guard, on-device — works today).** Judge wears the head rig,
walks toward a step or stage edge. Expect a sharp drop-off tone plus haptic within
about 2 m, spoken direction if named.
*Fallback:* if the tone doesn't fire, the edge may be outside the 1-3 m detection
range or LiDAR is confused by strong light — back up a step and re-approach; narrate
the geometry rule (ground points 1-3 m ahead, more than 0.1 m below expected floor)
while retrying.

**2. Head-height sign (path guard + naming — naming needs the phone-to-server
integration; path-guard tone works today).** Judge faces a sign or pole at head
height. Expect a distinct tone from the correct side; once the phone reports it, the
server names it (Qwen or Gemini) and speaks the label back.
*Fallback:* if naming isn't wired up on the phone yet, call out the tone-only
behavior as intentional ("path guard never waits on naming — that's the safety
rule") and show naming live on the **web verify queue** instead: open a seeded or
just-created hazard and show its label, type picker, and confidence.

**3. Crossing assist (in progress — not on `work` yet).** Someone pushes a cart
toward the judge at a marked "curb." Intended behavior: a priority-1 crossing alert
fires with side, and it is **not** silenced by mute — "approaching" alerts always
sound.
*Fallback:* narrate this as the hard safety rule that's built into the alert policy
today for drop-offs and will extend to crossing assist (`AlertPolicy` already treats
priority 1 as mute-proof — show the code / a muted drop-off alert firing anyway as
the closest live proof), and show recorded footage or the merge/testing plan if
crossing assist has landed by the actual demo.

**4. Community map lights up (server + web — works today; needs a real phone
report or the seeded data to change).** On the laptop, a new hazard appears live on
the map (`GET /events` SSE); walk through the verify queue's type picker, upvote a
pin, and show the confidence/label update. If a second phone has the app with
server integration, walk it toward a pinned hazard for the heads-up ("Scaffolding,
40 feet, right side").
*Fallback with no phone integration:* trigger a hazard directly against the API to
simulate a phone report and show it land on the map live —
```sh
curl -s -X POST "http://$LAN_IP:$API_PORT/hazards" \
  -H 'content-type: application/json' \
  -d '{"lat":25.7566,"lng":-80.3739,"heightBand":"ground","deviceId":"demo-phone-1"}'
```
— then narrate the heads-up and Scout flows from `PLAN.md`/screenshots since they
need the iOS integration to demo live.

Keep the whole thing indoors or just outside the Graham Center. GPS is poor indoors;
if the map step needs it, use a clearly labeled simulated position rather than
waiting on a real fix.

## General fallback

If the API or Mongo dies mid-demo, do not `pkill`/`killall` and do not touch
anything on the shared ports (3000, 8787, 27018, 11434) unless you started it this
session: run `scripts/dev-up.sh stop` then `scripts/dev-up.sh` again on the same
ports, or bring it up on spare ports (`MONGO_PORT`/`API_PORT`/`WEB_PORT`) and repoint
the phones' server setting.
