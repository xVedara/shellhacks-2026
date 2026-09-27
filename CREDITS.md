# Credits

This file credits open-source libraries and pretrained models. ShellHacks requires that credit in the Devpost write-up. Each item's license is named below. iOS model, voice, and export-tool detail is in [ios/CREDITS.md](ios/CREDITS.md). License texts that ship with the app are in [LICENSES/](LICENSES/).

## Runtime services and models

Google Gemini names a hazard crop when `GEMINI_API_KEY` is set. The model id is `gemini-flash-lite-latest`. The server calls it through `@google/genai` (Apache-2.0). Terms: https://ai.google.dev/gemini-api/terms. Those terms do not require a "Powered by Gemini" line. The Gemini key is on the paid tier.

Qwen names a crop when no Gemini key is set and Ollama is running. The tag is `qwen3.8:27b-mlx` (Qwen3.8-27B). The weights are Apache-2.0, Copyright 2026 Alibaba Cloud: https://huggingface.co/Qwen/Qwen3.8-27B. The Ollama tag is https://ollama.com/library/qwen3.8:27b-mlx. The weights are not in git. Ollama is MIT, Copyright (c) Ollama. The binary is not in git: https://github.com/ollama/ollama/blob/main/LICENSE.

ElevenLabs speaks alerts and live hazard names. The model is `eleven_multilingual_v2`. The premade voice is Sarah, id `EXAVITQu4vr4xnSDxMaL`. The phone bundles 86 English and Spanish phrases (`ios/StepSafe/Phrases/phrases.json`, 172 mp3 files). The clips were generated on Ara's ElevenLabs account (Creator plan, redeemed through MLH). Terms: https://elevenlabs.io/terms-of-use.

Ultralytics YOLO11s detects vehicles on the phone. The weights are a WiSE-FT blend of stock YOLO11s and a fine-tune on the CC BY 4.0 WOTR and blind-crossing datasets. The weights are AGPL-3.0-only. The bundled model and the AGPL text in the app are in [ios/CREDITS.md](ios/CREDITS.md). The model list and the data notes are under "YOLO models" and "Training and evaluation data" below.

MongoDB Atlas stores hazards. Atlas use follows the MongoDB Cloud Terms: https://www.mongodb.com/legal/terms-and-conditions/cloud. Those terms have no attribution line. The Node.js driver is a separate Apache-2.0 library, listed below. A local demo can download MongoDB Community Server through `mongodb-memory-server`. That server binary is SSPL-1.0 and is not in git: https://www.mongodb.com/licensing/server-side-public-license.

OpenStreetMap standard raster tiles come from `https://tile.openstreetmap.org`. Tile policy requires a visible "© OpenStreetMap contributors" on the map: https://operations.osmfoundation.org/policies/tiles/. Data under the tiles is ODbL: https://www.openstreetmap.org/copyright.

`web/public/osm-graham.json` is an ODbL extract of crossings, curbs, and tactile paving around FIU Graham Center. The file stays under the ODbL: https://opendatacommons.org/licenses/odbl/1-0/. It is separate from the AGPL code. `web/scripts/fetch-osm.mjs` queried the public Overpass API once to build it. Overpass software is AGPL-3.0 and is not shipped. The response is OpenStreetMap data under the ODbL.

## YOLO models

All YOLO models are by Ultralytics (https://github.com/ultralytics/ultralytics) and are AGPL-3.0-only (https://ultralytics.com/license). Ultralytics pretrained the stock checkpoints on COCO.

- YOLO11s (`yolo11s.pt`). Shipped weights `ios/StepSafe/Models/yolo11s_wise01.mlpackage` are 0.9 x stock YOLO11s plus 0.1 x our YOLO11s fine-tune (WiSE-FT weight blend).
- YOLO11n (`yolo11n.pt`). This was the vehicle model before the YOLO11s swap (commit `86b99e5`). It was also fine-tuned and blended as a comparison. It no longer ships.
- YOLO11x (`yolo11x.pt`). Offline use only: pseudo-labels for person, bicycle, and motorcycle boxes (confidence 0.5 or higher) on the blind-crossing images, which label only bus and car. It does not ship.

Training, blending, and export used the `ultralytics` Python package (AGPL-3.0; Core ML export on 8.4.163), PyTorch (BSD-3-Clause), coremltools (BSD-3-Clause), NumPy (BSD-3-Clause), Pillow (MIT-CMU), and requests (Apache-2.0). The scripts sit outside this repo, in the team workspace (`analysis/train_yolo/`: `build_ds2.py`, `pod_train_ft2.py`, `wise.py`).

## Training and evaluation data

The YOLO11s fine-tune was trained on the data below. Changes made: classes were remapped to COCO ids (person, bicycle, car, motorcycle, bus, truck), polygons were turned into boxes, duplicate images were dropped, and the blind-crossing images got YOLO11x pseudo-labels for the classes that set does not label.

- "AI powered assistant mobility tool for visually imparied" (the WOTR mirror), version 3, Roboflow Universe user `cars-8ypcq`: https://universe.roboflow.com/cars-8ypcq/ai-powered-assistant-mobility-tool-for-visually-imparied-gvkn7. License CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). This mirrors WOTR, the walking-on-road dataset for visually impaired people by Xia et al. (Displays, 2023), https://github.com/kxzr/WOTR, MIT license.
- "blind", version 2, Roboflow Universe user `wdq-ar-beas`: https://universe.roboflow.com/wdq-ar-beas/blind-nzf0p. License CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/).
- A subset of COCO train2017 (about 30% of the training images). Labels come from the Ultralytics COCO label pack. COCO annotations are CC BY 4.0 (https://cocodataset.org/dataset/termsofuse.htm). COCO images stay under the Flickr Terms of Use.
- Our own frames from StepSafe test walks, pseudo-labeled, at most 10% of the training set.

These sets were used for evaluation only and were never trained on:

- uB-VisioGeoloc, scene 8 (a helmet-camera street crossing in France), Harvard Dataverse: https://doi.org/10.7910/DVN/UYFPKM. The Dataverse record says CC0 1.0. The paper (Data in Brief, 2024) says CC BY, so the credit covers either license.
- COCO val2017, same terms as COCO above.

None of these images or labels are in this repo.

## Libraries

### iOS

The iOS app has no Swift packages. It links Apple system frameworks only. The SDK agreement does not require a credit line for those frameworks. The YOLO model, the ElevenLabs clips, and the export tools are in [ios/CREDITS.md](ios/CREDITS.md).

### Server

Direct dependencies of `server/`:

- fastify 5.12.5, MIT, Copyright (c) 2016-present The Fastify team.
- @fastify/cors 11.3.0, MIT, Copyright (c) 2018-present The Fastify team.
- ajv 8.20.0, MIT, Copyright (c) 2015-2021 Evgeny Poberezkin.
- mongodb 7.6.0, Apache-2.0. The license file is the Apache-2.0 text. The package author is The MongoDB NodeJS Team.
- @google/genai 2.24.0, Apache-2.0. The license file is the Apache-2.0 text and has no separate copyright line.
- tsx 4.23.15, MIT, Copyright (c) Hiroki Osame. The server is started with tsx.

Other production packages in `server/package-lock.json` are MIT, ISC, BSD-2-Clause, BSD-3-Clause, or Apache-2.0. Dev-only tools are TypeScript (Apache-2.0), vitest (MIT, Copyright (c) 2021-Present VoidZero Inc. and Vitest contributors), and @types/node (MIT, Copyright (c) Microsoft Corporation). `lightningcss` is MPL-2.0 and is not in a production install. Node.js is MIT, Copyright Node.js contributors, and is not copied into the repo.

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

The web UI loads Inter through `next/font`. License: OFL-1.1, Copyright 2016 The Inter Project Authors (https://github.com/rsms/inter). The text is [LICENSES/inter-OFL-1.1.txt](LICENSES/inter-OFL-1.1.txt). The iOS app uses the system font and ships no font file.

## Build tools

`ios/CREDITS.md` records the YOLO export as coremltools 9.0 and PyTorch 2.7.0. Both are BSD-3-Clause. Neither is bundled. Nothing in the repo pins those versions. coremltools is Copyright 2020-2023 Apple Inc.

`brandguide/make_icons.py` sizes the logos with Pillow (MIT-CMU). The copyright text is [LICENSES/pillow-MIT-CMU.txt](LICENSES/pillow-MIT-CMU.txt). Pillow is not bundled. `brandguide/logo-blue-1024.png` and `brandguide/logo-dark-1024.png` were made with GPT Image 2.5 (OpenAI).

## AI tools used to build it

StepSafe was built at ShellHacks 2026 with AI coding tools.

Dev Goswami used Cursor (IDE and cloud agents) and Grok (including Grok Bot).

Ara Babigian used Claude Code (Anthropic).

Models used: Grok 4.7, Claude Code, Claude Opus, Codex, GPT Image 2.5.

The running app also calls Gemini, Qwen through Ollama, ElevenLabs, and on-device YOLO11s (listed above). Those runtime calls did not write the git history.
