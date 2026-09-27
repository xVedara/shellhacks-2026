# StepSafe: 3-minute live demo

Source: `PLAN.md` section 14. Crossing assist, the server link (hazard reports,
heads-up, `/tts`), and the Scout tab are in `ios/`. On 2026-09-26 Ara ran StepSafe
on a physical iPhone and it passed: walker warnings, AirPods "what's ahead" and
mute presses, a closing object still sounding while muted, reports named, spoken,
and shown on the web map, heads-up heard, and Scout with the taxonomy picker.
Later device checks also covered feet units, the head-on fix, and the Community
tab installed on both phones. Run the phone-test checklist below again before
the live demo.

## What's built

- **Path guard, on-device, no network:** drop-off, head-height, and ground-obstacle
  alerts with spatial tones, priority ordering, and AirPods mute / what's-ahead
  (`ios/StepSafe/AlertManager.swift`, `Core/PathGuard.swift`, `Core/AlertPolicy.swift`).
- **Crossing assist:** `ClosingDetector` (depth) alerts on anything closing fast,
  including a pushed cart; `VehicleDetector` (YOLO11s Core ML) alerts on cars and
  bikes beyond LiDAR range (`BoxTracker` only emits `group == "vehicle"`; a cart is
  not a YOLO class, and YOLO-only pedestrians are not alerted). Both are priority 1.
  The hard rule in `AlertPolicy`'s header: closing objects are never muted, and their
  haptic + spatial tone fire immediately even while another clip plays. Moving
  objects are not map pins (`ServerLink.handle` drops `.closing`).
- **Server link:** `APIClient`/`ServerLink` post hazard reports, `MapSync` gives a
  heads-up for pins ahead within 12 m (39 ft) (once per 5 min), `TTSPlayer` calls `/tts` with
  a speech fallback. The only server is `https://api.stepsafe.miami`
  (`APIClient.baseURL`). It is not configurable. `ServerStatusView` in
  `ServerLink.swift` prints that URL as text. Launch deletes any old `serverURL`
  UserDefaults value. `Info.plist` sets no App Transport Security exception.
- **Scout tab:** tap to report, nearby list, votes, a taxonomy type picker
  (`GET /taxonomy`).
- **Server + web, working on their own:** hazard reports, merging, naming (local
  Qwen via Ollama or Gemini), ElevenLabs voice, the live map, and the verify queue
  with a type picker (`server/README.md`, `web/README.md`).
- **Bundled voice:** 86 phrases x EN/ES in the ElevenLabs voice "Sarah", played
  on-device with no network for every fixed alert (`Phrases/phrases.json`).

## Phone-test checklist (before the demo)

- [ ] Build in **Release**, not Debug: Xcode -> Product > Scheme > Edit Scheme >
      Run > Build Configuration > **Release** (Debug's on-device analysis is roughly
      30x slower and will miss detections).
- [ ] Install on the iPhone from Xcode (select the device, ⌘R) — no App Store or
      TestFlight.
- [ ] The shipping app calls only `https://api.stepsafe.miami`. There is no Server
      URL field. A local `dev-up.sh` stack is reachable from the phone only after
      `APIClient.baseURL` is changed in a dev build. `scripts/dev-up.sh` binds
      `HOST` to `0.0.0.0` unless you set `HOST`.
- [ ] On first launch, allow **Camera**, **Location** (When In Use), and **Motion**
      when iOS prompts. Those are the usage strings in `Info.plist`. There is no
      local-network usage string.
- [ ] AirPods paired with **default** press controls: one press = "What's ahead",
      a second press within 2 s = mute toggle (arrives as `MPRemoteCommandCenter`
      play/pause, or next-track on some AirPods).
- [ ] `ollama ps` shows `qwen3.8:27b-mlx` **loaded** (not just pulled) — a cold load
      adds several seconds to the first naming call; `dev-up.sh` warms it on
      startup.
- [ ] `ELEVENLABS_API_KEY` is set in `server/.env` (without it, `/tts` answers 503
      and the phone falls back to its built-in system voice — the app still works).

## First-time device test (10 steps)

Run this once on the actual iPhone before trusting the demo script below.

1. **Drop-off.** Walk the head rig toward a step or ledge.
   *Expect:* a sharp drop-off tone plus haptic within about 2 m, spoken direction
   if named.
2. **Head-height object.** Face a sign or pole at head height.
   *Expect:* a distinct tone from the correct side (left/right/ahead).
3. **"What's ahead."** Press the on-screen button, or a single AirPods press.
   *Expect:* the nearest hazard is spoken back immediately.
4. **Mute.** Press "Mute 5 minutes" (or a double AirPods press).
   *Expect:* "Muted for 5 minutes". Ground and head-height alerts go quiet.
   A drop-off within 2 m is priority 1 (`Tuning.dropUrgentDistance`) and still sounds.
5. **Closing object while muted.** Have someone walk or push something toward the
   phone fast.
   *Expect:* the haptic and spatial tone fire immediately anyway — closing objects
   are never muted (`AlertPolicy`'s hard rule).
6. **Pushed cart.** Push a cart toward the phone so its range shrinks (head-on,
   not sideways — depth misses a sideways crosser).
   *Expect:* a priority-1 crossing alert with side, from `ClosingDetector` (depth).
   `VehicleDetector` does not classify a cart.
7. **Hazard report -> web map.** Let a hazard get reported (path guard or Scout),
   then open the web map.
   *Expect:* a new pin appears live (`GET /events` SSE) with a name generated by
   Qwen (or Gemini).
8. **Heads-up on a second phone.** Walk a second phone toward the pinned hazard.
   *Expect:* a spoken heads-up ("<name>, <N> feet, <side>") once, within 12 m (39 ft).
9. **Scout tap + type picker.** On the Scout tab, tap to report a hazard, then open
   the type picker.
   *Expect:* the report appears in the nearby list; the picker lists taxonomy types
   from `GET /taxonomy` and can set/correct the type.
10. **Spanish device language.** Set the phone's Language & Region to Español,
    relaunch the app.
    *Expect:* fixed alerts and notices play the bundled Spanish (`.es.mp3`) clips
    instead of English.

## The 3-minute script

**1. Drop-off (path guard, on-device).** Judge wears the head rig, walks toward a
step or stage edge. Expect a sharp drop-off tone plus haptic within about 2 m,
spoken direction if named.
*Fallback:* if the tone doesn't fire, the edge may be outside the 1-3 m detection
range or LiDAR is confused by strong light — back up a step and re-approach.

**2. Head-height sign (path guard + naming).** Judge faces a sign or pole at head
height. Expect a distinct tone from the correct side; once the phone reports it,
the server names it (Qwen or Gemini) and speaks the label back.
*Fallback:* if naming is slow, call out that path guard never waits on naming
("that's the safety rule") and show the label land on the **web verify queue**
a moment later.

**3. Crossing assist.** Someone pushes a cart toward the judge at a marked "curb."
Expect a priority-1 crossing alert with side, and it is **not** silenced by mute —
approaching alerts always sound.
*Fallback:* if the cart isn't picked up cleanly, mute the app and show a drop-off
within about 2 m still firing (priority 1). Head-height stays quiet. The same
priority-1 rule covers crossing assist.

**4. Community map lights up.** On the laptop, the head-height hazard from step 2
appears live on the map (`GET /events` SSE). A closing alert from step 3 is not
pinned. Walk through the verify queue's type picker, upvote a pin, and show the
confidence/label update. With a second phone running the app, walk it toward a
pinned hazard for the heads-up ("<name>, 40 feet, right" — `Spoken.headsUp` says
"left", "right", or "ahead", not "right side").
*Fallback with no second phone:* trigger a hazard directly against the API to
simulate a report and show it land on the map live:
```sh
curl -s -X POST "http://$LAN_IP:$API_PORT/hazards" \
  -H 'content-type: application/json' \
  -d '{"lat":25.7566,"lng":-80.3739,"heightBand":"ground","deviceId":"demo-phone-1"}'
```

Keep the whole thing indoors or just outside the Graham Center. GPS is poor indoors;
if the map step needs it, use a clearly labeled simulated position rather than
waiting on a real fix.

## Known limits

- Depth does not see sideways crossers; YOLO-only pedestrians are not alerted;
  walking head-on alerts come late (TTC 0.68-1.3 s, limited by LiDAR range and
  field of view).
- Combined drop-off + closing phrases are marked done at start, not on completion.
- Spanish phrase wording wants a native speaker's pass.
- The repo license is AGPL-3.0-only (`LICENSE`). YOLO11s is AGPL-3.0-only
  (`ios/CREDITS.md`).
- On 2026-09-26 Ara ran StepSafe on a physical iPhone and it passed: walker
  warnings, AirPods "what's ahead" and mute presses, a closing object still
  sounding while muted, reports named, spoken, and shown on the web map,
  heads-up heard, and Scout with the taxonomy picker. Later device checks also
  covered feet units, the head-on fix, and the Community tab installed on both
  phones. Re-run the phone-test checklist above before the live demo.

## General fallback

If the API or Mongo dies mid-demo, do not `pkill`/`killall` and do not touch
anything on the shared ports (3000, 8787, 27018, 11434) unless you started it this
session: run `scripts/dev-up.sh stop` then `scripts/dev-up.sh` again on the same
ports, or bring it up on spare ports (`MONGO_PORT`/`API_PORT`/`WEB_PORT`). The
phone still calls `https://api.stepsafe.miami` until `APIClient.baseURL` is
changed in a dev build.
