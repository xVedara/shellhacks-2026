# Credits

Open-source libraries and pretrained models are credited here because ShellHacks requires crediting open-source models and libraries in the Devpost write-up. Each item's own license is named below. iOS model, voice, and export-tool detail is in [ios/CREDITS.md](ios/CREDITS.md). License texts that have to travel with the app are in [LICENSES/](LICENSES/).

## Runtime services and models

Google Gemini names a hazard crop when `GEMINI_API_KEY` is set. The model id is `gemini-flash-lite-latest`. The server calls it through `@google/genai` (Apache-2.0). Gemini API terms are at https://ai.google.dev/gemini-api/terms. Those terms do not ask for a "Powered by Gemini" line. The Gemini key runs on the paid tier.

Qwen names a crop when no Gemini key is set and Ollama is running. The tag is `qwen3.8:27b-mlx` (Qwen3.8-27B). The weights are Apache-2.0, Copyright 2026 Alibaba Cloud: https://huggingface.co/Qwen/Qwen3.8-27B. The Ollama tag is https://ollama.com/library/qwen3.8:27b-mlx. The weights are not in git. Ollama itself is MIT, Copyright (c) Ollama, and the binary is not in git: https://github.com/ollama/ollama/blob/main/LICENSE.

ElevenLabs speaks alerts and live hazard names with model `eleven_multilingual_v2` and the premade voice Sarah, id `EXAVITQu4vr4xnSDxMaL`. The phone bundles 71 phrases in English and Spanish. The clips were generated on the ElevenLabs Creator plan, redeemed through MLH (commercial use is allowed under that plan's terms). Terms: https://elevenlabs.io/terms-of-use.

Ultralytics YOLO11n detects vehicles on the phone. The weights are AGPL-3.0-only. The bundled model and the AGPL text in the app are described in [ios/CREDITS.md](ios/CREDITS.md). The model metadata says it was trained on COCO. COCO annotations are CC-BY-4.0. COCO images stay under Flickr's terms. Neither file is in this repo.

MongoDB Atlas stores hazards. Use of Atlas follows the MongoDB Cloud Terms: https://www.mongodb.com/legal/terms-and-conditions/cloud. Those terms have no attribution line. The Node.js driver is a separate Apache-2.0 library, listed below. A local demo can download MongoDB Community Server through `mongodb-memory-server`. That server binary is SSPL-1.0 and is not in git: https://www.mongodb.com/licensing/server-side-public-license.

OpenStreetMap standard raster tiles are served from `https://tile.openstreetmap.org`. The tile policy requires a visible "© OpenStreetMap contributors" on the map: https://operations.osmfoundation.org/policies/tiles/. The map data under the tiles is ODbL: https://www.openstreetmap.org/copyright.

`web/public/osm-graham.json` is an ODbL extract of crossings, curbs, and tactile paving around FIU Graham Center. It stays under the ODbL: https://opendatacommons.org/licenses/odbl/1-0/. That file is separate from the AGPL code. `web/scripts/fetch-osm.mjs` queried the public Overpass API once to build it. Overpass software is AGPL-3.0 and is not shipped. The returned data is OpenStreetMap data under the ODbL.

## Libraries

### iOS

The iOS app has no Swift packages. It links Apple system frameworks only. The SDK agreement does not ask for a credit line for those frameworks. The YOLO model, the ElevenLabs clips, and the export tools are in [ios/CREDITS.md](ios/CREDITS.md).

### Server

Direct dependencies of `server/`:

- fastify 5.12.5, MIT, Copyright (c) 2016-present The Fastify team.
- @fastify/cors 11.3.0, MIT, Copyright (c) 2018-present The Fastify team.
- ajv 8.20.0, MIT, Copyright (c) 2015-2021 Evgeny Poberezkin.
- mongodb 7.6.0, Apache-2.0. The license file is the Apache-2.0 text. The package author is The MongoDB NodeJS Team.
- @google/genai 2.24.0, Apache-2.0. The license file is the Apache-2.0 text and has no separate copyright line.
- tsx 4.23.15, MIT, Copyright (c) Hiroki Osame. The server is started with tsx.

Other production packages in `server/package-lock.json` are MIT, ISC, BSD-2-Clause, BSD-3-Clause, or Apache-2.0. Dev-only tools include TypeScript (Apache-2.0), vitest (MIT, Copyright (c) 2021-Present VoidZero Inc. and Vitest contributors), and @types/node (MIT, Copyright (c) Microsoft Corporation). `lightningcss` is MPL-2.0 and is not in a production install. Node.js is MIT, Copyright Node.js contributors, and is not copied into the repo.

### Web

Direct dependencies of `web/`:

- leaflet 1.9.4, BSD-2-Clause, Copyright (c) 2010-2023 Volodymyr Agafonkin and Copyright (c) 2010-2011 CloudMade.
- react-leaflet 5.0.0, Hippocratic-2.1, Copyright 2020 Paul Le Cam and contributors.
- @react-leaflet/core 3.0.0, Hippocratic-2.1, Copyright 2020 Paul Le Cam and contributors.
- next 16.3.6, MIT, Copyright 2025 Vercel, Inc.
- react 19.2.8 and react-dom 19.2.8, MIT, Copyright Meta Platforms, Inc. and affiliates.
- tailwindcss 4.3.3, MIT, Copyright Tailwind Labs, Inc. It is a dev dependency. The compiled CSS ships in the app.
- sharp 0.35.4, Apache-2.0, Lovell Fuller. Next.js uses it for `next/image`.
- @img/sharp-libvips, LGPL-3.0-or-later. The shared library ships with sharp when the web server is installed. It is not in git.

`caniuse-lite` is CC-BY-4.0 build data pulled in by Next.js. It is not shown in the UI. Smaller production packages are MIT, ISC, BSD-3-Clause, Apache-2.0, or 0BSD. Their license files stay inside the npm tarballs.

## Fonts

The web UI uses Inter through `next/font`. The license is OFL-1.1, Copyright 2016 The Inter Project Authors (https://github.com/rsms/inter). The text is [LICENSES/inter-OFL-1.1.txt](LICENSES/inter-OFL-1.1.txt). The iOS app uses the system font and ships no font file.

## Build tools

`ios/CREDITS.md` records the YOLO export as coremltools 9.0 and PyTorch 2.7.0. Both are BSD-3-Clause. Neither is bundled, and nothing in the repo pins those versions. coremltools is Copyright 2020-2023 Apple Inc.

`brandguide/make_icons.py` sizes the logos with Pillow, MIT-CMU. Copyright is in [LICENSES/pillow-MIT-CMU.txt](LICENSES/pillow-MIT-CMU.txt). Pillow is not bundled. `brandguide/logo-blue-1024.png` and `brandguide/logo-dark-1024.png` were made with ChatGPT image generation.

## AI tools used to build it

StepSafe was built at ShellHacks 2026 with AI coding tools. Ara Babigian and Dev Goswami can both explain how the code works.

Claude Code (Anthropic) is recorded on 16 commits by Ara Babigian. About 15 other commits by Ara have no Claude-Session trailer, so the tool for those commits is not recorded.

Commit messages name a review gate: Claude Opus (Anthropic) on 12 commits, and a reviewer recorded as sol (OpenAI (Codex CLI)) on 9 commits.

Logos were made with ChatGPT image generation.

Cursor cloud agents authored 17 commits and opened pull requests #1 through #11. A Cursor cloud agent coordinated later review, verification, and design mockups.

The running app also calls Gemini, Qwen through Ollama, ElevenLabs, and on-device YOLO11n, listed above. Those calls did not write the git history.
