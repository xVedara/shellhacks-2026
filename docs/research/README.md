# Improving StepSafe without fine-tuning (research + experiments, 2026-09-30)

Branch: `exp/improvements` (base `work` e2c9885). Nothing here is merged to `work`. Every change is meant for a real-world field test first.

## Summary

1. **The app talks too much, and that is the biggest fixable problem.** On recorded walks it speaks 11.7 to 17.6 phrases per minute, about 3 per hazard. Research on blind travellers says hearing is their main sense for traffic, and constant speech masks it. Chatty aids get switched off.
2. **One sim-validated fix is on this branch.** Drop-offs and head-height hazards are now spoken once per episode, re-spoken at 2 m and 1 m. On the head-mounted curb walk (12-37-07Z), spoken phrases per minute fall from 17.6 to 8.9, and cut-off phrases from 30 to 11. No tagged hazard is lost on any walk, and no first warning is later by more than one 5 Hz frame (0.2 s). A haptic-only reminder every 5 s keeps the walker informed while a drop-off within 2 m persists.
3. **Six app-experience changes are on this branch**, from the blind/low-vision research: honest mute wording, no accidental mute, a non-visual "StepSafe is not working" signal, map reports spoken as reports with their age, a distinct vibration per hazard kind, VoiceOver Magic Tap and actions, and Siri / Action Button shortcuts.
4. **Two ideas from self-driving research were tested and rejected for now.** Better car tracking and better range estimates both improved their own numbers but lost real alerts in the alert replay. Details and the conditions under which they become worth it are below.
5. **Next big lever: run the car detector at 10 to 15 Hz near curbs.** At 5 Hz, a car crossing in front is confirmed just as it leaves the view. No tracking trick fixes that.

## What is on the branch

| Commit | What | Switch |
|---|---|---|
| 25f95a0 | App experience: mute wording and controls, fault signal, "Reported ... ago" heads-ups, haptic grammar, VoiceOver Magic Tap / actions / Escape, App Shortcuts | always on |
| 2b3aea3 | Alert episodes for drop-off and head-height, 2 m / 1 m re-speak tiers, same-edge hold, 5 s drop-off haptic reminder | `Tuning.alertEpisodes`, `Tuning.dropOffHapticReminder` (both on) |
| 7e7f596 | Review fixes for 25f95a0 (per-hazard haptic limiter, fault cue timing, audio reset, Siri dialog, wording) | always on |
| 3141fca | Review fixes for 2b3aea3 and 7e7f596 (episode-keyed queue and cut-off handling, haptic limiter per hazard, no untracked VoiceOver speech, Siri answers only when live) | |
| 0bd3ac2 | Final review fixes (urgent drop-off buzz never blocked by a routine one, Siri says when audio is stopped, at most one queued drop-off buzz per second) | |

Tests: 188 iOS tests pass on the iPhone 18 Pro simulator (0 failures); the Release device build succeeds. Every commit had adversarial reviews from two different models, and the final state passed both. The most important fix (urgent drop-off vibration while audio is down) was checked by reverting it: exactly its new test failed.

Known gap (ticket): a new drop-off episode within 0.75 m of a point already spoken is still gated by the old world-history rule. This is the same as on `work`, and the replay lost no tags with it, but a hardening is possible after a new sim run.

### Field-test checklist (on a phone)

1. Walk a curb you follow for 30 s or more. Expect far fewer "drop-off" phrases, and a short vibration every 5 s while the edge is within 2 m.
2. Double-press the AirPods: mute. Listen: "Routine alerts off for 5 minutes. Cars and drop-offs stay on." A single press is always "what's ahead", it never mutes.
3. Take the AirPods out and put them back, and cover the camera for 5 s. Expect a long double buzz; "Audio back" when sound returns.
4. Feel the vibrations: a car or closing object gives rising taps, a drop-off gives a strong triplet, head height a double tap, a ground obstacle one soft tap.
5. With VoiceOver on, two-finger double-tap anywhere on the Walker screen: "what's ahead".
6. Say "Start StepSafe" and "What's ahead" to Siri, and try the Action Button.
7. Walk past a community pin: expect "Reported pothole, 40 feet, ahead, 2 days ago".
8. Compare with `exp/pathguard-v2`: it also reduces drop-off repeats, at the PathGuard level. Test one branch at a time.

## How blind people travel (short primer)

- Most blind people have some sight. Almost everyone relies on hearing first.
- The white cane finds things at ground level about one stride ahead, and follows edges ("shorelining"). Its blind spot is anything above the waist: branches, signs, truck mirrors. Most blind people have hit their head outdoors. This is StepSafe's clearest value.
- A guide dog walks around obstacles. The handler still decides where to go and when to cross.
- At crossings, blind travellers listen for the surge of parallel traffic. Anything that blocks the ears, including an app that keeps talking, is dangerous. Many wear one earbud or use transparency mode.
- People drift sideways without cues, so "left" and "right" change quickly.
- The phone is used one-handed, often in a pocket with the screen off, with VoiceOver. Earbud buttons, Magic Tap, Siri and the Action Button matter more than on-screen buttons.
- Trust cuts both ways: a wrong or chatty app gets turned off, and users often cannot tell when an AI is wrong. So StepSafe must never sound more certain than it is.

## Experiments

All offline, on the recorded walks, using the replay harness in the workspace `analysis/` folder (not in git). Hard safety gate for every variant: zero tagged hazards lost, first warning no later than +0.2 s, drop-offs within 2 m still cue at once.

### Alert episodes (shipped behind a switch)

A Python port of `AlertPolicy` (16 parity tests against the Swift test cases) measured the baseline. The winner applies episodes only to drop-offs and head-height hazards.

| Walk | Mount | Spoken/min before | After | Cut-off phrases |
|---|---|---|---|---|
| 12-37-07Z | head | 17.59 | 8.92 | 30 to 11 |
| 23-23-46Z | head | 11.68 | 11.68 | 1 to 1 |
| 02-56-06Z | mixed | 16.41 | 16.41 | 6 to 5 |
| 18-16-49Z | chest | 16.2 | 16.2 | 5 to 5 |
| 18-19-51Z | chest | 13.71 | 13.31 | 4 to 4 |

Not fixed: repeated ground-obstacle phrases ("Obstacle, 3 feet, right" x10 in 20 s on 18-16-49Z). The recordings keep only the nearest point per kind, with no object identity, and every attempt to gate ground obstacles lost a real step-up tag.

### Car tracking (rejected for now)

Predict-then-associate tracking with head-rotation correction, as used across self-driving tracking work, caught 10 of 12 near-lane cars at the roadside wait instead of 5, with no ID switches. But it lost two close-car alerts (an SUV at about 2 m and a minivan at about 1.5 m) that today's tracker catches only because it merges two cars into one track. Using low-confidence boxes to extend tracks added nothing. At 5 Hz, a crossing car is confirmed on its third frame, as it leaves the view.

### Range from box-bottom ground contact (rejected for now)

Truck range error fell from 2.35 m to 0.30 m, and parked-car position jitter from 2.07 m to 1.36 m. But feeding the new positions into the tracker's speed and miss-distance checks lost 2 car alerts on one chest walk. The app never speaks a car's distance, so a display-only version has nothing to improve today.

## Backlog, ranked (none of it needs training)

1. Car detector at 10 to 15 Hz near curbs or while a car track is unconfirmed; then re-test the new tracker. Needs a few 15 Hz curb recordings. Open question: should cars passing 2 to 6 m in front alert a walker who is standing still?
2. Verbosity levels (full / quiet / urgent-only) with a one-step "quieter" control.
3. Spoken first-run: what StepSafe detects, AirPods press practice, what mute does, head or chest mount.
4. Record object identity (or several points per kind) in the recorder, so ground-obstacle repeats can be fixed safely.
5. Speed-scaled alert distance (stopping-distance formula from the self-driving safety literature).
6. Passive "still there" votes when the sensor confirms a mapped hazard, and freshness on the web map.
7. A world-frame occupancy grid built across frames, to cut clear-path false alarms.
8. Audio mixing with other navigation apps: StepSafe's audio session currently stops them. Needs an on-device A/B test.

## Decisions for Ara

1. Keep the 5 s drop-off vibration reminder? Without it, the longest silence beside a curb within 2 m rose to about 50 s (90th percentile).
2. Head-height and ground obstacles now vibrate too (before, only priority 1). Keep?
3. Standing-walker alerts for cars passing 2 to 6 m in front: yes or no? This decides whether the 10 to 15 Hz work is worth it.
4. Field-test `exp/improvements` and `exp/pathguard-v2` one at a time; merge either to `work` only after your test.

## Sources

The full research notes, with every citation and whether it was fetched, stay in the workspace: `research/av-techniques.md` (28 techniques, 36 fetched sources) and `research/blv-ux.md` (33 findings, 31 fetched sources). Experiment details: `analysis/alert_sim/VARIANTS.md`, `analysis/tracking_exp/README.md`, `analysis/range_exp/README.md`.
