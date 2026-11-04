# ClimbVision – Benchmarks & Performance-Einschätzung (M0)

Stand: 2026-11-04 · Autor: Claude (Cloud-Session) · Status: **M0, vorläufig – keine Messung auf der Zielhardware vorhanden**

## 0. Lesehilfe: Herkunft jeder Zahl

Jede Zahl trägt eines dieser Labels. Zahlen ohne Label gibt es in diesem Dokument nicht.

| Label | Bedeutung |
|---|---|
| **[CLOUD]** | In der Cloud-Umgebung dieser Session selbst gemessen (Rohdaten: `bench/results/`). Gilt **nur** für diese VM. |
| **[PUBL]** | Aus einer veröffentlichten Quelle übernommen (Quelle genannt). Hardware/Bedingungen stehen dabei. Nicht von mir nachgemessen. |
| **[SCHÄTZ]** | Technische Schätzung von mir, Herleitung steht dabei. Unsicherheit ist angegeben. |
| **[LAPTOP]** | Muss noch auf deinem Laptop gemessen werden. Bisher **kein einziger** [LAPTOP]-Wert vorhanden. |
| **[SEKUNDÄR]** | Nur aus einer Suchtreffer-Zusammenfassung bekannt, das Original war im Sandbox-Netz nicht lesbar (arxiv.org / thecvf.org gesperrt). Als Hinweis, nicht als Beleg behandeln. |

**Es gibt keine gemessenen Genauigkeitswerte.** Es existiert in dieser Umgebung kein Kletter-Testvideo (`/testdata/` fehlt, siehe 1.3), also konnte ich weder Pose- noch Kontaktgenauigkeit messen. Alle Genauigkeitsangaben unten sind [PUBL] oder [SEKUNDÄR].

---

## 1. Messumgebung

### 1.1 Cloud-VM [CLOUD]

| | |
|---|---|
| OS | Ubuntu 24.04.5, Linux 6.18 (Firecracker-VM) |
| CPU | Intel Xeon @ 2.10 GHz, 4 vCPU, Flags: AVX2, **AVX-512, AVX512-VNNI, AMX** |
| RAM | 15 GiB, kein Swap |
| Browser | Headless Chromium 153.0.8010.12 (Playwright), `crossOriginIsolated = true`, `SharedArrayBuffer` ✓, `OffscreenCanvas` ✓, `navigator.gpu` vorhanden (Software), `navigator.ml` (WebNN) ✗ |
| GPU | **keine** (Software-GL/SwiftShader) |
| Runtimes | `@mediapipe/tasks-vision` 1.2.2, `onnxruntime-web` 1.31.1, Python `mediapipe` 1.2.2 |

### 1.2 Warum die Cloud-Zahlen **nicht** auf deinen Laptop übertragbar sind

1. Geteilte VM, unbekannte Nachbarlast, Turbo-Verhalten unbekannt, 2,1 GHz Basistakt.
2. AVX-512/AMX: hilft nativen Runtimes (XNNPACK), **nicht** WASM – Chromium-WASM nutzt nur 128-bit-SIMD. Das Verhältnis nativ/WASM ist also hier eher *ungünstig* für WASM, falls dein Laptop keine AVX-512 hat (dort wäre nativ ebenfalls langsamer, WASM kaum).
3. Dein Laptop: unbekannte Generation, wahrscheinlich Mobile-CPU mit Leistungs-/Thermik-Limit (Akku vs. Netz: Faktor 2 möglich).
4. Headless, kein echtes Display/Kamera-Pipeline.

→ Verwendbar sind die Zahlen als **Größenordnung** und für **relative Vergleiche** (Lite vs. Full vs. Heavy, WASM vs. nativ, Image- vs. Video-Modus).

### 1.3 Testdaten
- `/testdata/` existiert **nicht**. Es gibt keine Kletter-Videos in der Umgebung. → Keine Genauigkeits-, Fuß-, Heel-Hook-, Überkopf-, Verdeckungs- oder Mehrpersonen-Messung möglich.
- Als Latenz-Fixture diente `bus.jpg` (Ultralytics-Beispielbild, 810×1080; 4 Personen, eine davon ganzkörperig). Ein Standbild ist **kein** repräsentatives Videosignal (siehe 2.3).

### 1.4 Nicht verfügbar / blockiert (nicht gemessen)
| Was | Grund |
|---|---|
| RTMPose / RTMO / ViTPose / Sapiens-Latenz | `download.openmmlab.com`, `huggingface.co`, `dl.fbaipublicfiles.com` sind im Sandbox-Netz gesperrt → keine Gewichte |
| YOLO-Pose-Latenz | Gewichte ladbar (`yolo11n-pose.pt`, `yolo26n-pose.pt`), aber PyTorch-CPU-Index (`download.pytorch.org`) gesperrt → kein ONNX-Export. Außerdem AGPL (siehe Lizenzteil in PLAN.md) – kein Kandidat |
| SAM 2 / MobileSAM / EfficientSAM-Latenz | Gewichte nicht erreichbar (fbaipublicfiles gesperrt; MobileSAM-Repo außerhalb der Session-Repo-Freigabe) |
| MediaPipe GPU-Delegate / WebGPU / WebNN auf echter iGPU | Keine GPU in der VM |
| Kamera-Latenz, Pixel-Webcam-Verhalten, Handlatenz *mit* sichtbarer Hand | Keine Kamera; kein Offline-Bild mit Hand verfügbar |
| Genauigkeit jeder Art | Keine Testvideos / Ground Truth |

---

## 2. Gemessene Ergebnisse [CLOUD]

Rohdaten: `bench/results/cloud-xeon-chromium153-mediapipe-wasm.json`, `bench/results/cloud-xeon-mediapipe-python-native.json`.
Methode: 15 Warm-up-Aufrufe, dann 100 (Browser) bzw. 60 (nativ) Messaufrufe, `performance.now()` um den **synchronen** Detect-Aufruf. Verwertet werden nur Frames mit gefundener Person (`hitRate = 1.0` in allen unten gelisteten Zeilen). Median in ms, in Klammern p95. Delegate = CPU (XNNPACK/WASM-SIMD).

### 2.1 MediaPipe Pose Landmarker im Browser (WASM, CPU), Input 1280×720 letterboxed

| Modell | Datei-Größe¹ | `detect()` (Image-Modus: Detektor + Landmarker je Frame) | `detectForVideo()` (Tracking-Modus) | Video-Modus entspricht |
|---|---|---|---|---|
| Lite | 5,8 MB | 60,8 ms (p95 81,8) | **41,0 ms** (54,3) | ≈ 24 FPS |
| Full | 9,4 MB | 81,9 ms (110,5) | **61,8 ms** (83,3) | ≈ 16 FPS |
| Heavy | 30,7 MB | 216,2 ms (282,6) | **194,3 ms** (269,2) | ≈ 5 FPS |

¹ Dateigröße der `.task`-Bündel (Detektor + Landmarker), per `Content-Length` gemessen.
Zweite Messreihe mit 810×1080-Eingang: Lite 66,2/42,6 · Full 77,3/56,4 · Heavy 223,6/202,9 ms (Image/Video) – gleiche Größenordnung. Zwei Läufe (60 und 100 Iterationen) lagen innerhalb ±10 %.

### 2.2 Nativ (Python, XNNPACK, CPU, gleiche Maschine) – Referenz für WASM-Overhead

| Modell | Image | Video | WASM/nativ (Video) |
|---|---|---|---|
| Lite | 32,3 ms | 18,2 ms | **2,3×** |
| Full | 41,9 ms | 22,9 ms | **2,5×** |
| Heavy | 91,5 ms | 72,8 ms | **2,7×** |

**Befund:** Der Browser kostet gegenüber nativ etwa Faktor 2,3–2,7 (auf dieser AVX-512-Maschine). Das ist der Preis der Web-Architektur.

### 2.3 Wichtige Messfallen, die ich selbst getroffen habe (und was daraus folgt)

1. **Leerlauf-Falle:** Mein erster Lauf mit `zidane.jpg` (Oberkörper zweier Personen) lieferte für *alle* Modelle ≈ 28 ms und `0 detections`. Der Pose-Detektor fand niemanden, es lief also nie der Landmarker. Diese Zahlen habe ich **verworfen** (nicht in den Tabellen). Das Harness zählt seitdem Treffer und wertet Latenz nur über Treffer-Frames aus.
2. **Echter Befund daraus:** MediaPipe Pose benötigt ausreichend sichtbaren Körper (dort: abgeschnittene Beine → keine Pose). Im Klettern ist der Körper oft teilverdeckt/anliegend an der Wand – die **Detektor-Robustheit ist ein Kernrisiko** (siehe PLAN.md, Risiko R2). Dies ist aus *einem* Bild abgeleitet und kein statistischer Beleg.
3. **Standbild ≠ Video:** Im Video-Modus ist die Latenz niedriger, weil der Detektor übersprungen wird und nur der Landmarker auf dem ROI des Vorframes läuft (hier −33 %). Bei schnellen Bewegungen oder Verlust fällt MediaPipe auf den Detektor zurück → Latenzspitzen bis ≈ Image-Modus-Niveau. Reale Videos können davon abweichen.

### 2.4 MediaPipe Hand Landmarker im Browser [CLOUD] – **nur Leerlauf-Pfad**

| Fall | Median | p95 |
|---|---|---|
| **Keine Hand im Bild** (`hitRate = 0`: Palm-Detektor läuft jeden Frame, Landmarker nicht), Video-Modus, 1280×720 | **48,4 ms** | 65,4 ms |

Latenz **mit** sichtbarer Hand ist **nicht gemessen** → [LAPTOP]. Konsequenz: Der Hand-Detektor allein kostet im Browser ≈ so viel wie die komplette Pose-Inferenz. Hand-Tracking **jeden Frame auf dem Vollbild ist nicht tragbar**; es muss auf kleinen ROI-Ausschnitten um das Handgelenk und mit reduzierter Rate laufen (PLAN.md §8).

### 2.5 Worker-Spike [CLOUD] – gilt für die Architektur

Rohdaten: `bench/results/cloud-worker-spike.json`. Frage: Läuft MediaPipe in Web Workern, und skalieren mehrere Instanzen auf mehrere Kerne?

| Test | Ergebnis |
|---|---|
| **Modul-Worker** (`type: 'module'`, `import` des `.mjs`-Bundles) | ❌ Fehler `ModuleFactory not set.` – der WASM-Loader nutzt `importScripts`, das in Modul-Workern fehlt |
| **Klassischer Worker** (`importScripts('vision_bundle.js')`, Global `Vision`) | ✅ läuft; `OffscreenCanvas` im Worker vorhanden; `crossOriginIsolated = true`; Eingabe als `ImageBitmap` (transferiert) |
| Pose Lite im Worker allein, Video-Modus | Median 53,1 ms (p95 62,0) – leicht über dem Main-Thread-Wert 41 ms; Streuung der VM nicht ausgeschlossen |
| 2 × Pose Lite in 2 Workern gleichzeitig | 52,3 / 54,1 ms → **keine Verlangsamung**: Instanzen laufen auf getrennten Kernen (WASM single-threaded pro Instanz bestätigt) |
| Pose Lite + Hand (Leerlauf-Pfad) gleichzeitig | 40,7 / 52,7 ms |
| 2 × Pose + Hand gleichzeitig (3 Instanzen auf 4 vCPU) | 51,4 / 38,3 / 67,1 ms → erste Sättigung sichtbar |

**Konsequenzen:** (a) MediaPipe-Worker müssen *classic* sein und das IIFE-Bundle als statisches Asset laden (nicht über Vites Modul-Bundling). (b) Pose und Hand können parallel auf je einem Kern laufen. (c) Auf dem Laptop mit weniger Kernen/Hyperthreads kann die Skalierung schlechter sein → [LAPTOP]. (d) Timestamps müssen pro Landmarker-Instanz streng monoton steigen (sonst `Packet timestamp mismatch` – dabei selbst hineingefallen).

### 2.6 GPU-Delegate [CLOUD] – **ungültig als Performance-Aussage**
`delegate: 'GPU'` lief in der VM auf einem Software-Rasterizer (Lite/Video 233 ms, Full 393 ms). Das beweist nur, dass der Code-Pfad funktioniert. **Keine Aussage über echte iGPU-Leistung.**

---

## 3. Veröffentlichte Werte [PUBL] / [SEKUNDÄR]

### 3.1 RTMPose / RTMO (MMPose-README, abgerufen 2026-11-04 aus `open-mmlab/mmpose` `main`)
Hardware der Autoren: **Intel i7-11700** (8 Kerne, bis 4,9 GHz Turbo, AVX-512) für CPU-Werte, GTX 1660 Ti, Snapdragon 865. ONNX-Runtime nativ (nicht WASM).

| Modell (COCO-17, 256×192) | AP (COCO) | Params | FLOPs | ORT-Latenz (i7-11700) | Quelle |
|---|---|---|---|---|---|
| RTMPose-t | 68,5¹ | 3,34 M | 0,36 G | 3,20 ms | README Tab. „Body 2D" |
| RTMPose-s | 72,2¹ | 5,47 M | 0,68 G | 4,48 ms | " |
| RTMPose-m | 75,8¹ | 13,59 M | 1,93 G | 11,06 ms (≈ 90 FPS, „CPU-FPS 90+") | " |
| RTMPose-l | 76,5¹ | 27,66 M | 4,16 G | 18,85 ms | " |

¹ Werte aus der „Major Features"-Tabelle (AP-Spalte, abweichend von einzelnen Config-Zeilen: z. B. t 65,9 / m 74,9 in der Detailtabelle – das README ist hier nicht einheitlich; Größenordnung zählt).

**Mit Personendetektor** (RTMDet-nano 320×320, README Pipeline-Tabelle, i7-11700 ORT): t 12,4 · s 16,7 · **m 26,6** · l 36,3 ms (→ 38 FPS für m nativ) [PUBL].

**Body8-Halpe26-Varianten (mit Fuß-Keypoints)** [PUBL]: RTMPose-t 3,51 M Params, PCK@0.1 91,89 · s 5,70 M / 93,01 · **m 13,93 M / 94,75** · l 28,11 M / 95,37 (alle 256×192; Latenz-Spalte im README für Halpe26 **leer**). Die Halpe26-Keypoint-Definition enthält je Fuß große Zehe, kleine Zehe, Ferse (Halpe-Datensatz-Konvention, im README verlinkt).

**RTMO** [PUBL]: One-Stage, Multi-Person. Latenz **nur auf V100-GPU**: s 8,9 · m 12,4 · l 19,1 ms; AP (body7) 0,686 / 0,726 / 0,748. **Keine CPU-Zahl veröffentlicht.** Die dokumentierten Configs sind COCO-17-Keypoints (keine Zehen/Fersen) → für Fußkontakt ungeeignet [aus README-Tabellen abgeleitet, nicht explizit dort ausgesprochen].

### 3.2 MediaPipe BlazePose (Model Card / Doku, via Suche) [PUBL, Geräte alt]
- Pixel 3, XNNPACK-CPU: Lite ≈ 44 FPS, Full ≈ 18 FPS, Heavy ≈ 4 FPS (Model-Card-Angabe, 2021).
- Selbe Quelle: GPU-Latenz Heavy 53 ms (Pixel 3), 38 ms (MacBook Pro 2017).
- Hinweis: Die Suchzusammenfassung nannte HIIT-mAP-Werte (Heavy 68,1 / Full 62,6 / Lite 45,0) ohne klare Metrikzuordnung → **nicht verwendet**, Model-Card-PDF muss im Original geprüft werden.
- 33 Landmarks inkl. Ferse (29/30) und Fußspitze (31/32) pro Seite; Landmarker-Eingang 256×256, Detektor 224×224 [PUBL, Doku].
- Konsistenzcheck mit [CLOUD]: Heavy Video 4–5 FPS stimmt in der Größenordnung mit den 4 FPS (Pixel 3 CPU) überein.

### 3.3 Kletterspezifische Evidenz [SEKUNDÄR] – Originale nicht lesbar
- **„The Way Up: A Dataset for Hold Usage Detection in Sport Climbing"** (Maschek & Schedl, CVPR-Workshop CVSports 2025): 22 annotierte Kletter-Videos mit Griffpositionen, Griff-Nutzungsreihenfolge und -zeiten; laut Zusammenfassung das einzige Dataset, das Gliedmaße↔Griff über Frameintervalle annotiert. Verglichen: MediaPipe (Heavy), ViTPose (L), YOLOv8-pose (X).
  - Genauigkeit laut Review-Zusammenfassung: **ViTPose 86,6 % > MediaPipe 83,5 % > YOLOv8-pose 75,3 %** (Gesamt-„Hold-Usage"-Genauigkeit; die Zahlen wichen zwischen zwei Quellen ab).
  - Geschwindigkeit laut derselben Zusammenfassung: MediaPipe 0,12 s/Frame (8,2 FPS), ViTPose 0,25 s/Frame (4,1 FPS) – Hardware **unbekannt**.
  - Verdeckung: **Hände in ≈ 50 % der Nutzungsinstanzen verdeckt** (meist hinter dem Torso), **Füße nur ≈ 2 %** – das gilt für deren Kameraaufstellung/Wand (Sportklettern), nicht automatisch für Boulder/Überhang.
  - Hauptprobleme laut Zusammenfassung: Selbstverdeckung, Abweichung zwischen Keypoint und tatsächlichem Kontaktpunkt am Griff.
- **„Training-Free Hold-Usage Detection in Sport Climbing with Foundation Pose Models"** (arXiv 2609.30026, Preprint): Sapiens-Fingerspitzen-/Zehen-Keypoints + Nähe-Test pro Frame + gegenseitiger Ausschluss pro Gliedmaße + kurze zeitliche Persistenzregel; laut Zusammenfassung besser als YOLOv8-pose- und ViTPose-Pipelines; „Hände verschwinden in ≈ der Hälfte aller annotierten Frames". **Lizenz-Warnung:** Sapiens steht (laut `facebookresearch/sapiens/LICENSE`, selbst geprüft) unter **CC BY-NC 4.0 – nicht kommerziell** → als Kandidat ausgeschlossen, nur Ideengeber.
- **arXiv 2503.00458:** MediaPipe-Landmarks gegen Griffkoordinaten zur Kontaktbestimmung – nur Titelfragmente gesehen, nichts verwertet.
- Keine Studie zu **Heel Hooks** oder **umgekehrten/überhängenden Posen mit BlazePose** gefunden → diese Risiken sind **unbelegt** und nur auf dem Laptop mit deinen Videos prüfbar.

---

## 4. Kandidatenvergleich (Qualität, Füße, Browser, Größe, Lizenz)

Lizenzspalte: Code-Lizenz **selbst aus dem Original-`LICENSE`-File gelesen** (Stand 2026-11-04), außer wo vermerkt. Gewichte/Trainingsdaten siehe PLAN.md §3.

| Kandidat | Keypoints / Füße | Qualität (Quelle) | Browser-Eignung | Größe | CPU-Latenz | Lizenz Code |
|---|---|---|---|---|---|---|
| **MediaPipe Pose Landmarker** Lite/Full/Heavy | 33; Ferse + Fußspitze ✓ | Kletter-Studie: Heavy 83,5 % [SEKUNDÄR] | ✓✓ offiziell (WASM, WebGL/GPU) | 5,8 / 9,4 / 30,7 MB [CLOUD] | Browser-Video: 41 / 62 / 194 ms [CLOUD, VM] | Apache-2.0 ✓ |
| **RTMPose-s/m (Halpe26)** + RTMDet-nano | 26; große/kleine Zehe + Ferse ✓ | m: PCK@0.1 94,75 (Body8) [PUBL]; kletterspez. unbekannt | ONNX Runtime Web (WASM/WebGPU): machbar, kein Fertigpaket; Zwei-Stufen-Pipeline selbst bauen | s 5,7 M / m 13,9 M Params (≈ 23 / 56 MB FP32, [SCHÄTZ]) | nativ m: 11,1 ms, +Det: 26,6 ms [PUBL i7-11700]; **Browser: ≈ 2,5× → ~28 ms pose-only, ~65 ms mit Det.** [SCHÄTZ] | Apache-2.0 ✓ (mmpose, rtmlib) |
| **RTMO** | COCO-17, **keine Zehen/Ferse** | AP 0,73 (m) [PUBL] | wie RTMPose | s 8,9 M / m 12,4 M Params | CPU nicht publiziert | Apache-2.0 (mmpose) |
| **YOLO11/YOLO26-Pose** (Ultralytics) | COCO-17, **keine Zehen/Ferse** | Kletter-Studie: YOLOv8-pose X 75,3 % [SEKUNDÄR] | ONNX Runtime Web möglich | n: 6,3 MB / 7,9 MB `.pt` [CLOUD, Content-Length] | nicht gemessen | **AGPL-3.0 ⚠** (`ultralytics/LICENSE` = AGPL-3.0; kommerziell nur mit Enterprise-Lizenz laut README) |
| **ViTPose (B/L/H, ++)** | COCO-17 (+ Wholebody-Varianten mit Füßen) | Kletter-Studie: L 86,6 % (beste) [SEKUNDÄR] | schwer (ViT, groß) – für Echtzeit-CPU-Browser ungeeignet | B ≈ 90 M, L ≈ 300 M Params [Wissen, nicht geprüft] | Studie: 4 FPS (HW unbekannt) [SEKUNDÄR] | Apache-2.0 ✓ (`ViTPose/LICENSE`) |
| **Sapiens** (Meta) | 308 Körper-Keypoints inkl. Zehen/Finger [Wissen] | Preprint: beste [SEKUNDÄR] | nein (sehr groß) | groß | – | **CC BY-NC 4.0 ⚠ nicht kommerziell** (selbst geprüft) |
| **DWPose / RTMW** (Wholebody) | 133 inkl. Hand + Fuß | Wholebody-AP ≈ 58–70 (RTMW-m/l) [PUBL] | wie RTMPose, größer | m ≈ 2,2 GFLOPs (RTMPose-m wholebody) | ORT i7-11700: 13,5 ms (RTMPose-m Wholebody 256×192) [PUBL] | Apache-2.0 (DWPose-Repo selbst geprüft) |
| **MediaPipe Hand Landmarker** | 21 pro Hand | – | ✓✓ | 7,8 MB [CLOUD] | Leerlauf (Palm-Det.) 48 ms Browser [CLOUD] | Apache-2.0 |

**Wholebody-Option (RTMPose-m Wholebody, 133 Keypoints):** liefert Hand- *und* Fuß-Keypoints in einem Netz für 13,5 ms nativ [PUBL] und könnte den separaten Hand-Landmarker ersetzen. Qualität an Fingerspitzen in Kletterhaltung (Faust um Griff) ist unbekannt → Teil des Laptop-Benchmarks.

---

## 5. Laufzeit-Vergleich (Browser) – Stand der Erkenntnisse

| Runtime | Version (npm, 2026-11-04) | Lizenz | Eignung für CPU-Betrieb | Evidenz |
|---|---|---|---|---|
| **MediaPipe Tasks Vision** | 1.2.2 | Apache-2.0 | ✓ beste Wahl für BlazePose/Hand: fertiger Graph, Tracking-ROI, WASM-SIMD | [CLOUD] Messungen oben; WASM-Variante **single-threaded pro Instanz** ([CLOUD] Worker-Spike 2.5: zwei Instanzen belegen zwei Kerne ohne Verlangsamung) |
| **ONNX Runtime Web** WASM | 1.31.1 | MIT | ✓ für RTMPose/MobileSAM; Multi-Thread via `SharedArrayBuffer` (benötigt COOP/COEP – lokaler Server kann das setzen, [CLOUD] `crossOriginIsolated = true` ✓) | Doku: WASM ist der Standard-CPU-Provider; Threads/Proxy-Worker einstellbar [PUBL, ONNX-Doku via Suche] |
| ONNX Runtime Web WebGPU | 1.31.1 | MIT | **iGPU möglich!** (siehe 6.3). Nur ein Teil der Operatoren; Doku nennt es experimentell | [LAPTOP] |
| ONNX Runtime Web WebNN | 1.31.1 | MIT | Chromium-only, braucht Flag/Treiber (NPU/GPU), W3C-CR Januar 2026 laut Suche | [CLOUD] `navigator.ml` ✗; [LAPTOP] |
| TensorFlow.js | 4.22.0 | Apache-2.0 | Kein Vorteil ggü. MediaPipe/ORT, WASM-Backend langsamer; **nicht empfohlen** | nicht gemessen, Begründung architektonisch |

---

## 6. Einschätzung für deine Zielhardware (Intel Core i5 vPro, 16 GB, keine dGPU)

### 6.1 Schätzung [SCHÄTZ] – niedrige Konfidenz
Herleitung: Cloud-Werte (2,1 GHz-Xeon, WASM-SIMD128) × Faktor f für den Laptop. Der Mobile-i5 taktet im Turbo höher (4+ GHz), kann aber im 15-W-Betrieb oder auf Akku stark drosseln. Annahme: **f = 0,6 … 1,5** (je kleiner, desto schneller). Generation unbekannt (i5 vPro reicht von 8. bis 13. Gen).

| Konfiguration (Browser, 1 Thread) | Cloud [CLOUD] | Laptop-Spanne [SCHÄTZ] | FPS-Spanne |
|---|---|---|---|
| Pose Lite, Video-Modus | 41 ms | 25 – 62 ms | 16 – 40 |
| Pose Full, Video-Modus | 62 ms | 37 – 93 ms | 11 – 27 |
| Pose Heavy, Video-Modus | 194 ms | 117 – 291 ms | 3,4 – 8,6 |
| Hand-Detektor ohne Hand (Vollbild) | 48 ms | 29 – 73 ms | – |
| RTMPose-m (Halpe26) + RTMDet-nano, ORT-WASM 1 Thread | – | ≈ 40 – 100 ms (nativ 26,6 ms [PUBL] × WASM-Faktor ≈ 2,5 × f) | 10 – 25 |

Das sind **Spannen aus einer Annahme**, keine Prognose. Die einzige belastbare Aussage: Lite/Full liegen in der Größenordnung des 50-ms-Budgets, Heavy liegt weit außerhalb.

### 6.2 Kritische Bewertung des 20-FPS-Ziels
- **Pose allein, Lite, Video-Modus:** 20 FPS sind **plausibel, aber nicht gesichert** (mein Median ist 41 ms ≈ 24 FPS auf einer Maschine, deren Verhältnis zu deinem Laptop unbekannt ist).
- **Pose + Hand + Kontaktlogik + Rendering + Kamera-Dekodierung** auf einem Thread: **nicht erreichbar.** Der Hand-Detektor allein (48 ms Leerlauf) sprengt das Budget.
- **Heavy:** nicht echtzeitfähig im Browser auf CPU (5 FPS).
- **Ehrliche Formulierung des Ziels:** *Pose-Updates mit ≥ 15 Hz stabil, Ziel 20–25 Hz mit Lite/Full in eigenem Worker; UI-Rendering 60 FPS entkoppelt (Interpolation zwischen Pose-Updates)*. Für Kontakterkennung beim Klettern reichen 10–15 Hz meist aus, bei dynamischen Zügen (Dyno) nicht [SCHÄTZ, Erfahrungswert, unbelegt].
- **Ende-zu-Ende-Latenz** (Bewegung → Wandkarte): Kamera/USB-Webcam-Puffer (unbekannt, typ. 100–200 ms bei Android-Webcam [SCHÄTZ]) + Pose + Glättung. Realistisch **150–300 ms**. Für Aufleuchten der LED-Wand ist das ausreichend, für „Spiegel"-Gefühl grenzwertig. Messung nötig (Blitz-/Klatsch-Test, siehe 8.4).

### 6.3 Wichtiger Hinweis: „keine dedizierte GPU" ≠ „keine GPU"
Ein i5 vPro hat fast sicher eine **integrierte Intel-GPU** (UHD/Iris Xe). Chromium unterstützt darauf WebGL und meist WebGPU. MediaPipe `delegate: 'GPU'` und ORT-WebGPU könnten dort schneller sein als WASM-CPU – und die CPU für UI/Logik freihalten. Das ist die **größte unbekannte Stellschraube**. Ich habe das ausdrücklich in das Laptop-Benchmark-Protokoll aufgenommen (`--headed --gpu`). Die Architektur bleibt CPU-first; GPU wird als optionaler Backend-Schalter vorgesehen, falls es sich lohnt.

### 6.4 Optimierungsplan, falls 20 Hz nicht erreicht werden (geordnet nach erwarteter Wirkung/Aufwand)
1. **Pose in eigenem Worker, UI entkoppelt** (Pflicht). Hand in zweitem Worker → nutzt 2 Kerne [Architektur].
2. **Lite statt Full** als Standard; Full/Heavy als „Qualität"-Option für Replay-Nachanalyse (offline, ohne Echtzeitdruck).
3. **Video-/Tracking-Modus** nutzen (gemessen −33 % ggü. Image-Modus [CLOUD]); Detektor nur bei Verlust.
4. **Hand-Tracking nur auf ROI** (Ausschnitt ~192 px um Handgelenk, nur wenn Handgelenk nahe Griff), Rate 5–10 Hz, pro Hand abwechselnd.
5. **Eingangsauflösung reduzieren** (MediaPipe skaliert intern auf 224/256; 640×360 statt 1080p spart Vorverarbeitung/Kopieren).
6. **Frame-Skipping adaptiv** (nur aktuellster Frame wird verarbeitet; nie Warteschlange aufbauen).
7. **Tracking/Extrapolation zwischen Inferenzschritten** (One-Euro + konstante Geschwindigkeit) für 60-FPS-Rendering.
8. **WebGPU/WebGL-Delegate auf iGPU** testen (6.3).
9. **ROI-Crop um den Kletterer** (aus Wandbereich/Vorframe) für die Zwei-Stufen-Pipeline (RTMPose) – spart den Detektor fast komplett.
10. **Auf Pose-Updates mit 15 Hz zurückgehen** (nicht 20) – ist beim Klettern fachlich vertretbar.

---

## 7. Annahmen, die ich kritisch hinterfragt habe
| Annahme aus der Spec | Befund |
|---|---|
| „≥ 20 FPS Pose im Browser auf CPU" | Nur für Lite/Full-Pose allein plausibel; Hand-Tracking sprengt das Budget (2.4). Ziel umformuliert (6.2). |
| „Hand über Handgelenk + Hand-Keypoints + Fingerspitze genauer bestimmen" | Fachlich sinnvoll, aber Hand-Landmarker im Browser ist teuer und die Hand ist laut Studie in ~50 % der Griffnutzungen verdeckt [SEKUNDÄR]. Fingerspitzen-Signal wird oft **fehlen** → Kontaktlogik muss ohne es funktionieren (Fallback auf Handgelenk + Pose-Handpunkte). |
| „Fuß = Zehe + Ferse + Knöchel" | MediaPipe liefert alle drei; RTMPose-Halpe26 ebenfalls; COCO-17-Modelle (YOLO-Pose, RTMO) **nicht** → ausgeschlossen. |
| „CPU only" | iGPU wahrscheinlich nutzbar (6.3) → mitmessen. |

---

## 8. Benchmark-Strategie für den Laptop (nach Freigabe, M1-Vorbereitung)

### 8.1 Harness (liegt bereits im Repo, `bench/`)
`bench/README.md` beschreibt den Ablauf. Kurz:
```bash
cd bench && bash fetch-models.sh
cd web && npm install
python ../py/fetch_onnx.py                              # RTMPose-t/s/m (Download-URL aus README übernommen, bisher ungetestet)
node run-headless.mjs --iters 100 --out ../results/laptop-cpu.json
node run-headless.mjs --iters 100 --headed --gpu --out ../results/laptop-gpu.json
```
Das Harness misst: MediaPipe Pose Lite/Full/Heavy (Image + Video), Hand (nur Leerlauf-Pfad), ORT-Web-WASM mit 1/2/4 Threads für RTMPose, optional WebGL/WebGPU.

### 8.2 Zusätzlich auszufüllen
- OS-Version, exakte CPU (`lscpu` / `wmic cpu get name`), Netz vs. Akku, Energiemodus.
- Browser + Version. Thermik: 3-Minuten-Dauerlauf und Drosselung beobachten (Task-Manager/`powermetrics`/HWInfo).

### 8.3 Testvideos (du, bevor M4 abgenommen wird)
Je 30–60 s, 1080p/30, Pixel 7a per USB-Webcam-Modus **und** (zum Vergleich) native Kamera-App:
1. Leere Wand (für Scan/Kalibrierung), gut beleuchtet.
2. Leichte Platte, frontal, ruhige Bewegung.
3. Überhang mit Heel Hook und Toe Hook.
4. Dynamische Züge (Dyno, schneller Zug).
5. Zwei Personen im Bild (eine klettert, eine steht/geht im Hintergrund).
6. Schlechtes Licht / Gegenlicht.
7. Sturz/Abspringen (für Versuchssegmentierung später).
Dateien nach `/testdata/` (nicht ins Repo committen; `.gitignore` greift für große Medien später).

### 8.4 Messgrößen und Abnahmeschwellen (Vorschlag – bitte bestätigen)
| Metrik | Messung | Schwelle (Vorschlag) |
|---|---|---|
| Pose-Rate | Median/p5 FPS über 60 s | Median ≥ 15 Hz, p5 ≥ 10 Hz |
| Render-FPS | `requestAnimationFrame`-Delta | ≥ 55 FPS, auch während Inferenz |
| Pipeline-Latenz | Klatsch-/Blitz-Test: Bildschirm-Zeitstempel vs. sichtbare Reaktion in Wandkarte, 20 Wiederholungen | Median ≤ 250 ms |
| CPU-Auslastung | Task-Manager, 60 s | < 80 % Gesamt, kein Throttling |
| RAM | `measureUserAgentSpecificMemory()` / Task-Manager | < 1,5 GB |
| Kontakt-Events | Du markierst für 3 Clips die Kontakte händisch (Zeit, Gliedmaße, Griff); Event-Vergleich mit ±250 ms Toleranz | Hand-Event-Recall ≥ 85 %, Precision ≥ 85 %; Fuß ≥ 70 % (Vorschlag, **keine** Messbasis!) |
| Flackern | Kontaktwechsel pro Sekunde in statischen Phasen | < 0,2/s je Gliedmaße |

Die Genauigkeitsschwellen sind **Vorschläge ohne empirische Basis** – wir kalibrieren sie nach den ersten echten Läufen.

---

## 9. Zusammenfassung der Messlage
- **Tatsächlich auf deiner Hardware gemessen:** nichts.
- **In der Cloud gemessen:** MediaPipe-Pose Lite/Full/Heavy im Browser (WASM) + nativ, Hand-Leerlauf, Dateigrößen; plus eine reproduzierbare Messfalle (Detektor-Leerlauf).
- **Veröffentlicht:** RTMPose/RTMO-Latenzen (i7-11700 / V100), MediaPipe-Model-Card-FPS (Pixel 3).
- **Sekundär (Original nicht lesbar):** Kletter-Vergleich MediaPipe/ViTPose/YOLOv8-pose.
- **Geschätzt:** alles auf deinem Laptop.
- **Offen/Blockiert:** RTMPose-Browserlatenz, SAM-Varianten, iGPU, Kamera, Genauigkeit.


---

## 10. Nachtrag: in der fertigen App gemessen [CLOUD] (E2E-Lauf, `scripts/e2e.mjs`)

Gleiche Cloud-VM wie oben (4 vCPU, **Software-Rendering**, headless Chromium, Videodatei 720×1280 @ 15 fps als Quelle). **Nicht auf den Laptop übertragbar**; nur Größenordnungen.

| Messung | Wert | Bemerkung |
|---|---|---|
| Griff-Scan (klassisch), 1200 px Bild, Kilter-Foto | 0,7–1,0 s Segmentierung, 485 Kandidaten | im Worker; Vitest 913 ms auf 1060×1290 |
| Registrierung (Lucas–Kanade, 800 px) | 238–334 ms, NCC 0,87, Eckverschiebung 0,05 % | identische Aufstellung |
| Pose-Inferenz in der App (Lite, Worker) | 48–97 ms pro Frame | Rate 2–8,5 Hz im 2-s-Fenster; Videoquelle 15 fps, Frames werden bei belegtem Worker verworfen |
| Hand-ROI (Worker) | 100–184 ms, 0,5–6 Hz | auf Ausschnitt, Rate begrenzt |
| Render-FPS (Wandkarte, 485 Griffe, PiP) | 38–59 FPS | Software-Canvas, **kein** Hinweis auf echte GPU-Leistung |
| Kontaktlogik | < 2 ms/Frame für 400 Griffe × 4 Gliedmaßen | Unit-Test mit Schwellwert (Ziel, nicht Latenzmessung) |

Außerdem: Aufnahmegröße 1 h bei 15 Hz < 30 MB (Test mit Schwellwert). **Es gibt weiterhin keine Genauigkeitsmessung** (keine Kletter-Videos).
