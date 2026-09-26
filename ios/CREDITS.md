# Credits

iOS detail for the list in the repo root [CREDITS.md](../CREDITS.md).

## YOLO11n (Ultralytics)

Crossing assist recognizes cars, trucks, buses, motorcycles, bicycles, and people beyond LiDAR range with YOLO11n by Ultralytics (https://github.com/ultralytics/ultralytics), pretrained on COCO.

The file is `StepSafe/Models/yolo11n.mlpackage`. It was exported once with `pip install ultralytics` then `yolo export model=yolo11n.pt format=coreml nms=True` (ultralytics 8.4.163, coremltools 9.0, torch 2.7.0).

The license is AGPL-3.0-only (https://ultralytics.com/license and https://www.gnu.org/licenses/agpl-3.0.html). The model metadata names the same license. Ultralytics also offers an Enterprise license for closed-source use. This repo is AGPL-3.0-only. The text is `LICENSE` at the repo root, and the app target copies that file into the bundle (`ios/project.yml`). There is no in-app credits screen.

`docs/PLAN.md` section 7 asks for this credit on the Devpost write-up.

## COCO

The model metadata says the weights were trained on COCO. COCO image files and annotation files are not in this app.

COCO annotations and the COCO website are CC-BY-4.0 (https://cocodataset.org/dataset/termsofuse.htm and https://creativecommons.org/licenses/by/4.0/). COCO does not own the images. Image use stays under the Flickr Terms of Use. The COCO terms page does not say that a trained model must repeat the annotation credit.

## ElevenLabs

The app bundles 71 phrases in English and Spanish (142 mp3 files) under `StepSafe/Phrases/`. The voice id is `EXAVITQu4vr4xnSDxMaL`. `server/.env.example` names that voice Sarah (Mature, Reassuring, Confident). The model is `eleven_multilingual_v2`. `scripts/gen-phrases.mts` generated the files. The phone plays them on device. Live hazard names go to the team's `GET /tts`, and the server fills that route from ElevenLabs.

The clips were generated on the ElevenLabs Creator plan (commercial use is allowed under that plan's terms). Terms: https://elevenlabs.io/terms-of-use.

## coremltools and PyTorch

The export note above records coremltools 9.0 and PyTorch 2.7.0. Neither tool is bundled. Nothing in the repo pins those versions.

coremltools is BSD-3-Clause, Copyright 2020-2023 Apple Inc.: https://github.com/apple/coremltools/blob/main/LICENSE.txt

PyTorch is BSD-3-Clause: https://github.com/pytorch/pytorch/blob/main/LICENSE

The BSD notice applies to copies of those tools. The `.mlpackage` is export output, not a copy of either tool.
