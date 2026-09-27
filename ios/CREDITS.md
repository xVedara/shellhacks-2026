# Credits

iOS detail for the list in the repo root [CREDITS.md](../CREDITS.md).

## YOLO11s (Ultralytics), WiSE-FT blend

Crossing assist recognizes cars, trucks, buses, motorcycles, bicycles, and people beyond LiDAR range with YOLO11s by Ultralytics (https://github.com/ultralytics/ultralytics), pretrained on COCO, lightly adapted to the pedestrian view.

The file is `StepSafe/Models/yolo11s_wise01.mlpackage`. Its weights are a weight-space blend (WiSE-FT), 0.9 x the stock `yolo11s.pt` plus 0.1 x a YOLO11s fine-tuned on the WOTR mirror (https://universe.roboflow.com/cars-8ypcq/ai-powered-assistant-mobility-tool-for-visually-imparied-gvkn7, CC BY 4.0; original WOTR repo MIT) and the blind-crossing set (https://universe.roboflow.com/wdq-ar-beas/blind-nzf0p, CC BY 4.0), plus a COCO train2017 subset. The blend is taken with BatchNorm folded into the convolutions. The export is `yolo export model=yolo11s_wise01.pt format=coreml nms=True imgsz=640` (ultralytics 8.4.163, coremltools 9.0, torch 2.7.0), the same command and versions as the earlier YOLO11n model, so the inputs, outputs, NMS pipeline, and 80 COCO labels are unchanged. The scripts are outside this repo (`analysis/train_yolo/wise.py` in the team workspace).

The license is AGPL-3.0-only (https://ultralytics.com/license and https://www.gnu.org/licenses/agpl-3.0.html). The model metadata names the same license. Ultralytics also offers an Enterprise license for closed-source use. This repo is AGPL-3.0-only. The text is `LICENSE` at the repo root, and the app target copies that file into the bundle (`ios/project.yml`). There is no in-app credits screen.

ShellHacks requires crediting open-source models and libraries in the Devpost write-up.

## COCO

The model metadata says the weights were trained on COCO. COCO image files and annotation files are not in this app.

COCO annotations and the COCO website are CC-BY-4.0 (https://cocodataset.org/dataset/termsofuse.htm and https://creativecommons.org/licenses/by/4.0/). COCO does not own the images. Image use stays under the Flickr Terms of Use. The COCO terms page does not say that a trained model must repeat the annotation credit.

## ElevenLabs

The app bundles 86 phrases in English and Spanish (172 mp3 files) under `StepSafe/Phrases/`. The voice id is `EXAVITQu4vr4xnSDxMaL`. `server/.env.example` names that voice Sarah (Mature, Reassuring, Confident). The model is `eleven_multilingual_v2`. `scripts/gen-phrases.mts` generated the files. The phone plays them on device. Live hazard names go to the team's `GET /tts`, and the server fills that route from ElevenLabs.

The clips were generated on Ara's ElevenLabs account (Creator plan, redeemed through MLH). Terms: https://elevenlabs.io/terms-of-use.

## coremltools and PyTorch

The export note above records coremltools 9.0 and PyTorch 2.7.0. Neither tool is bundled. Nothing in the repo pins those versions.

coremltools is BSD-3-Clause, Copyright 2020-2023 Apple Inc.: https://github.com/apple/coremltools/blob/main/LICENSE.txt

PyTorch is BSD-3-Clause: https://github.com/pytorch/pytorch/blob/main/LICENSE

The BSD notice applies to copies of those tools. The `.mlpackage` is export output, not a copy of either tool.
