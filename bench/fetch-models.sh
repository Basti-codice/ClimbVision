#!/usr/bin/env bash
# Downloads benchmark inputs (public Google MediaPipe model bucket + Ultralytics sample image). Run once, online.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p web/models web/fixtures
B=https://storage.googleapis.com/mediapipe-models
for v in lite full heavy; do
  [ -f web/models/pose_$v.task ] || curl -fsSL -o web/models/pose_$v.task $B/pose_landmarker/pose_landmarker_$v/float16/latest/pose_landmarker_$v.task
done
[ -f web/models/hand.task ] || curl -fsSL -o web/models/hand.task $B/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task
[ -f web/fixtures/zidane.jpg ] || curl -fsSL -o web/fixtures/zidane.jpg https://raw.githubusercontent.com/ultralytics/ultralytics/main/ultralytics/assets/zidane.jpg
[ -f web/fixtures/bus.jpg ] || curl -fsSL -o web/fixtures/bus.jpg https://raw.githubusercontent.com/ultralytics/ultralytics/main/ultralytics/assets/bus.jpg
echo ok
