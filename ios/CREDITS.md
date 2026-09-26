# Credits

## YOLO11n (Ultralytics)

Crossing assist recognizes cars, trucks, buses, motorcycles, bicycles and people beyond LiDAR range with
**YOLO11n** by Ultralytics (https://github.com/ultralytics/ultralytics), pretrained on COCO.

- File: `StepSafe/Models/yolo11n.mlpackage` (5.2 MB), exported once with
  `pip install ultralytics` then `yolo export model=yolo11n.pt format=coreml nms=True`
  (ultralytics 8.4.163, coremltools 9.0, torch 2.7.0; torch 2.14 fails in coremltools 9.0).
- License: **AGPL-3.0** (https://www.gnu.org/licenses/agpl-3.0.html) (Ultralytics offers an Enterprise license for closed-source use). Shipping the app
  with this model means the app's source must be available under AGPL-3.0-compatible terms, or an
  Ultralytics Enterprise license is needed. The repo is licensed AGPL-3.0 (see `LICENSE`), so this is covered.
- Credit on Devpost as required by PLAN.md section 7.
