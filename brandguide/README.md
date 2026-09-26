# StepSafe brand guide

## Logo files

| File | Use |
| --- | --- |
| `logo-blue-1024.png`, `logo-dark-1024.png` | Original artwork (rounded square on white) |
| `appicon-dark-1024.png`, `appicon-blue-1024.png` | Full-bleed square for Xcode app icons (iOS applies its own mask). Navy (`dark`) is the primary icon. Blue gradient is marketing-only / alternate appearance. |
| `logo-{blue,dark}-rounded-{1024,512,180}.png` | Rounded with transparent corners, for the web (favicon, apple-touch-icon, headers) |

Regenerate the derived files with `python3 make_icons.py` (needs Pillow).

## Name and voice

- Name: **StepSafe** (one word, capital S twice). Tagline: **Detect. Alert. Move Freely.**
- Voice: calm, immediate, clear, concise. Alerts read like "Curb ahead. 6 feet.", never "WARNING!".
- Full brand and product handoff lives outside this repo (workspace docs), not in git.

## Colors (official)

| Name | Hex | Use |
| --- | --- | --- |
| Navy | `#081624` | Primary surface; the UI is dark-mode first |
| Orange | `#FF7900` | Hazards and warnings only, never decorative |
| Blue | `#087FF5` | Links, controls, active states |
| Signal Blue | `#13B9F2` | Scanning and sensor visuals |
| White | `#FFFFFF` | Text on dark, eye outline |
| Cloud | `#F5F7FA` | Light surfaces |
| Slate | `#66717E` | Secondary text |
| Blue gradient | `#13B9F2` to `#0868F8` | Blue icon background |

Never signal a hazard with color alone: pair it with an icon, text, sound or haptics.

## Type

SF Pro Display for headlines, SF Pro Text for UI and body. Inter where SF Pro is unavailable (the web).
