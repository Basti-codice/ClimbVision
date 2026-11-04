# ClimbVision – Recherchequellen & Versionsstände (M0)

Abruf: 2026-11-04. „geprüft" = Primärquelle in dieser Session selbst gelesen/abgerufen. „Suchtreffer" = nur über Websuche-Zusammenfassung bekannt, **nicht** im Original verifiziert. Das Sandbox-Netz sperrte arxiv.org, openaccess.thecvf.com, huggingface.co, download.openmmlab.com, dl.fbaipublicfiles.com, download.pytorch.org sowie die GitHub-REST-API für fremde Repos.

## 1. Pakete (npm-Registry, `npm view`, geprüft)
| Paket | Version | Lizenz |
|---|---|---|
| `@mediapipe/tasks-vision` | 1.2.2 | Apache-2.0 |
| `onnxruntime-web` | 1.31.1 | MIT |
| `@tensorflow/tfjs` | 4.22.0 | Apache-2.0 |
| `@techstark/opencv-js` | 5.0.0-release.1 | Apache-2.0 (Paketangabe; OpenCV-Version/Funktionsumfang vor M2 prüfen) |
| `vite` | 8.3.5 | MIT |
| `svelte` | 5.57.3 | MIT |
| `react` | 19.3.1 | MIT (nicht gewählt) |
| `zod` | 4.6.7 | MIT |
| `idb` | 8.0.4 | ISC |
| Python `mediapipe` | 1.2.2 | (Benchmark-Referenz, nicht Teil der App) |
Versionen sind Tagesstände; M1 pinnt exakt (`package-lock.json`).

## 2. Lizenzen der Code-Repos (Originaldatei `LICENSE` von raw.githubusercontent.com gelesen, geprüft)
| Repo | Lizenz laut `LICENSE` |
|---|---|
| open-mmlab/mmpose (RTMPose, RTMO) | Apache-2.0 |
| open-mmlab/mmdetection (RTMDet) | Apache-2.0 |
| Tau-J/rtmlib | Apache-2.0 |
| IDEA-Research/DWPose (Branch `onnx`) | Apache-2.0 |
| ViTAE-Transformer/ViTPose | Apache-2.0 |
| google-ai-edge/mediapipe | Apache-2.0 |
| facebookresearch/sam2 | Apache-2.0 (Code; Gewichts-Lizenz vor Nutzung prüfen) |
| ChaoningZhang/MobileSAM | Apache-2.0 |
| yformer/EfficientSAM | Apache-2.0 |
| Megvii-BaseDetection/YOLOX | Apache-2.0 |
| **ultralytics/ultralytics** | **AGPL-3.0** (README: Zweitlizenz „Enterprise" für kommerzielle Nutzung) |
| **CASIA-IVA-Lab/FastSAM** | **AGPL-3.0** |
| **facebookresearch/sapiens** | **CC BY-NC 4.0** |
| chongzhou96/EdgeSAM | „NTU S-Lab License 1.0" (Suchtreffer; nicht-permissiv, nicht selbst gelesen) |
| SAM 3 | „SAM License" (Suchtreffer; nicht selbst gelesen) |
Gewichte-Lizenzen und Trainingsdaten-Lizenzen (COCO CC-BY-4.0 für Annotationen, Halpe/AIC/CrowdPose etc. teils mit eigenen Bedingungen) sind **nicht** abschließend geprüft – siehe PLAN.md §3.2.

## 3. Technische Primärquellen (geprüft)
- MMPose RTMPose-README: `https://raw.githubusercontent.com/open-mmlab/mmpose/main/projects/rtmpose/README.md` (Latenz-/AP-Tabellen, Halpe26-ONNX-Links).
- MMPose RTMO-README: `…/projects/rtmo/README.md`.
- Ultralytics-README (Lizenzabschnitt): `https://raw.githubusercontent.com/ultralytics/ultralytics/main/README.md`; Gewichte `yolo11n-pose.pt` (6 255 593 B), `yolo26n-pose.pt` (7 878 574 B) per HTTP-Header, nicht geladen.
- MediaPipe-Modelle (Google-Bucket, selbst geladen, SHA-256 berechnet). **Feste Version pinnbar** über `/float16/1/…` (HTTP 200, Bytes identisch mit `latest` am Abrufdatum für Lite verifiziert):

| Datei | Bytes | SHA-256 |
|---|---|---|
| `pose_landmarker_lite.task` | 5 777 746 | `59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a` |
| `pose_landmarker_full.task` | 9 398 198 | `4eaa5eb7a98365221087693fcc286334cf0858e2eb6e15b506aa4a7ecdcec4ad` |
| `pose_landmarker_heavy.task` | 30 664 242 | `64437af838a65d18e5ba7a0d39b465540069bc8aae8308de3e318aad31fcbc7b` |
| `hand_landmarker.task` | 7 819 105 | `fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1` |
URL-Schema: `https://storage.googleapis.com/mediapipe-models/<task>/<name>/float16/1/<name>.task`
- Testbild: `ultralytics/assets` `bus.jpg`, `zidane.jpg` (nur Benchmark-Fixture, nicht ins Repo committet).

## 4. Suchtreffer (nicht im Original geprüft – bei Verwendung kennzeichnen)
- MediaPipe Pose Model Card / Doku (Pixel-3-FPS, GPU-Latenz): `developers.google.com/mediapipe/solutions/vision/pose_landmarker`, `ai.google.dev/edge/mediapipe/…`, Model-Card-PDF `developers.google.cn/static/ml-kit/images/vision/pose-detection/pose_model_card.pdf`.
- Ultralytics-Lizenzseite: `https://www.ultralytics.com/license`, `docs.ultralytics.com`.
- The Way Up (CVPRW 2025): `openaccess.thecvf.com/content/CVPR2025W/CVSPORTS/papers/Maschek_The_Way_Up_A_Dataset_for_Hold_Usage_Detection_in_CVPRW_2025_paper.pdf`; Review-Zusammenfassung `themoonlight.io/review/the-way-up-a-dataset-for-hold-usage-detection-in-sport-climbing`.
- Training-Free Hold-Usage Detection (Preprint): `arxiv.org/abs/2609.30026`.
- MediaPipe-basierte Kletteranalyse: `arxiv.org/abs/2503.00458`.
- CIMI4D (3D-Klettern, CVPR 2023): `arxiv.org/abs/2303.17948`.
- Chrome Local Network Access: `developer.chrome.com/docs/modern-web-guidance/guides/security/local-network-access`; Blink-dev „Intent to Ship: Local network access restrictions for WebSockets".
- Web Serial / Web Bluetooth: MDN `developer.mozilla.org/en-US/docs/Web/API/Web_Serial_API` (Secure Context bestätigt per Suche).
- Android-Webcam-Funktion: `source.android.com/docs/core/camera/webcam` (Android 14 QPR1+; 1080p30 MJPEG, YUYV nur 720p30).
- ONNX Runtime Web Doku: `onnxruntime.ai/docs/tutorials/web/…`.
- MobileSAM / SAM-in-Browser: `github.com/ChaoningZhang/MobileSAM`, `github.com/sunu/SAM-in-Browser`, `github.com/akbartus/MobileSAM-in-the-Browser/issues/3`.
- SAM-Familie: `docs.ultralytics.com/models/mobile-sam`, `arxiv.org/html/2410.04960v1` (Survey).
- GitHub-Repo-Suche (Kletter-Projekte; Metadaten per `gh api search/repositories`, geprüft): ClimbingMuse (Apache-2.0), Archjbald/climber (MIT), ahward21/ClimbingCoM (MIT), AEYohn/crux-models (MIT), zekesarosi/phnet (MIT), azorions/bouldering-analysis, 3ab3abb/RoidBeta, LREGS/led_climbing_board (MIT), GordonLesti/owoody (MIT). Inhalte/Qualität dieser Repos **nicht** geprüft; keines ist ein erkennbares fertiges Produkt für Echtzeit-Griffzuordnung.
