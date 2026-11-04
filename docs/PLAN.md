# ClimbVision – Projektplan (M0)

Stand: 2026-11-04 · Status: **M0 abgeschlossen, wartet auf Freigabe** · Messwerte & Quellen: [`BENCHMARKS.md`](BENCHMARKS.md), [`SOURCES.md`](SOURCES.md)

Dieses Dokument ist so geschrieben, dass M1 ohne neue Grundsatzdiskussion starten kann. Wo ich etwas entschieden habe, steht **Entscheidung** + Begründung. Wo ich dich brauche, steht es in §20 (offene Fragen) – jeweils mit meinem Default.

---

## 0. Umsetzungsstand (nach deiner Freigabe: M1–M6 in einem Durchgang) – Abweichungen vom Plan

Stand 2026-11-04. Alles unten ist in der Cloud-Umgebung gebaut und getestet (130 Unit-/Integrationstests, ein Chromium-E2E-Lauf mit deinem Wandfoto + synthetischem Video). **Nichts davon ist auf echter Hardware, mit echter Kamera oder echten Kletterbewegungen getestet.** M7 (P2) wurde nicht begonnen.

| M | Status | Nicht/anders umgesetzt |
|---|---|---|
| M1 Grundgerüst | fertig | Tokens in CSS + TS, CVD-/Kontrasttests, Quellen (Kamera, Videodatei), HUD, IndexedDB, i18n (DE vollständig, EN Gerüst) |
| M2 Kalibrierung | fertig | **kein opencv.js**: eigene Lucas–Kanade-Registrierung (D5 revidiert); keine ArUco-Marker; Homographie auf *normalisierten* Bildkoordinaten (auflösungsunabhängig) |
| M3 Scan/Editor | fertig | **kein MobileSAM** (Gewichte im Sandbox-Netz nicht erreichbar, auf deinem Foto nicht nötig); stattdessen klassisches Verfahren + **Zauberstab** im Editor. Auf deinem Foto: ≈ 485 Kandidaten, Reflexionsband teilweise falsch |
| M4 Live | fertig | MediaPipe Lite/Full + Hand-ROI; **Pipeline läuft im Main-Thread** (Kontaktlogik < 2 ms/Frame, gemessen), Pose/Hand/Segmentierung/Registrierung in Workern |
| M5 Sessions | fertig | Aufnahme (Binär-Chunks), Replay/Scrubbing/Zeitlupe, Auswertungen (2D-Näherungen), Routen, Versuche, Ghost-Overlay (einfach), Export JSON/CSV/ZIP/PNG/Overlay-Video |
| M6 ESP32 | App fertig, **Firmware ungetestet** | Transporte WS/BLE/Serial (nur mit Fake-/Virtual-Geräten getestet), Mapping-Editor, virtueller ESP32; Firmware nie kompiliert |

Wesentliche Änderungen gegenüber dem Plan (mit Grund):
1. **Telemetrie in MediaPipe entdeckt** (`POST odml.pa.googleapis.com/v1/log`) → Netzwerkwächter im Worker + strikte CSP + E2E-Test (README).
2. **Drift-Anker dürfen auf Griffen liegen**: Auf dichten Wänden (Kilter) gibt es keine freie Wandfläche; Griffe sind statisch und liefern die besten Kanten.
3. **Kontaktlogik:** Geschwindigkeit wird über ein 250-ms-Fenster geschätzt (Rauschen) und blockiert nur den *Start*, nicht das Halten (sonst beendet schnelles Greifen/Zucken Kontakte); `c_min` nicht doppelt gezählt (steckt in `s_pos`). Beide Korrekturen kamen aus fehlgeschlagenen Tests.
4. **Segmentierungs-Polarität:** Streuungsregel statt „Minderheitsklasse“ (versagt bei dichten Wänden, wo Griffe > 50 % der Fläche bedecken).
5. **BLE-Binärpaket ist Pflicht** für Zustände (JSON passt nicht in 20 Byte).
6. **Gefundene und behobene Fehlerklassen:** Svelte-`$state`-Proxys lassen sich weder in IndexedDB noch per `postMessage` klonen → Normalisierung im Speicher-Layer, Schnappschüsse vor Worker-Aufrufen; `$effect`-Endlosschleife im Editor; O(n²)-Ankerwahl (Minuten → 64 ms).

Offene Qualitätsfragen (nur mit deinen echten Daten beantwortbar): Pose-Rate auf dem Laptop, Fuß-/Heel-Hook-Qualität, Kontaktgenauigkeit, Pixel-Webcam-Latenz, Kamera-/Bewegungs-Registrierung in der Halle, ESP32-Hardware.

---

## 1. Kurzfassung

1. **Machbar, aber nicht so, wie die Spec es suggeriert.** Der Browser-Stack (Vite + TS + Svelte + MediaPipe/ONNX in Web Workern) ist tragfähig. Das schwierige Stück ist nicht Pose, sondern **Griff-Kontakt-Zuordnung bei verdeckten Händen/Füßen** – dafür gibt es keine fertige Lösung, nur Hobby-Repos und eine Handvoll Paper.
2. **20 FPS sind ein bedingtes Ziel.** Gemessen (Cloud, nicht dein Laptop): MediaPipe Pose Lite im Browser ≈ 41 ms/Frame, Full ≈ 62 ms, Heavy ≈ 194 ms. Der **Hand-Landmarker kostet allein ≈ 48 ms** pro Frame. Ich definiere das Ziel um: *Pose ≥ 15 Hz stabil (Ziel 20+), Rendering 60 FPS entkoppelt*. Entscheidung fällt auf dem Laptop (Gate G1, §3.1).
3. **Modellempfehlung:** MediaPipe Pose **Lite** (Start) → **Full** (Qualität) im Worker; **Hand-Landmarker nur auf ROI und mit reduzierter Rate**; **RTMPose-s/m (Halpe26)** als geprüfte Alternative, falls MediaPipe-Füße/Überkopf auf deinen Videos nicht reichen. **YOLO-Pose (AGPL, keine Zehen), RTMO (keine Zehen), Sapiens (CC BY-NC), FastSAM (AGPL), EdgeSAM (nicht-permissiv)** sind ausgeschlossen.
4. **Segmentierung:** Klassische CV als zuverlässiger Basis-Pfad + **MobileSAM (Apache-2.0)** als Verfeinerer/„Klick → Polygon"-Werkzeug. Vollautomatische SAM-Gitter-Segmentierung im Browser ist wahrscheinlich zu langsam (§9) – wird in M3 per Spike entschieden.
5. **Erneute Registrierung:** Deine Prämisse („Homographie allein reicht nicht") ist **teilweise richtig, aber aus anderem Grund als gedacht** (§7). Ich plane Registrierung als *Verfeinerung + Plausibilitätsprüfung* der Vier-Ecken-Homographie, plus Live-Drift-Überwachung.
6. **Netz/Hardware-Realität:** ESP32-Direktverbindung vom `http://localhost`-Seite aus ist erlaubt; Web Serial/Bluetooth nur Chromium. Node-Relay ist **nicht** Teil der Planung, nur Notfall-Option (§13).

---

## 2. Hinterfragte Annahmen & direkte Rückmeldung

| # | Annahme in der Spec | Meine Einschätzung | Konsequenz |
|---|---|---|---|
| A1 | 20 FPS Pose im Browser auf CPU | Nur Pose allein (Lite) plausibel, mit Hand nicht ([CLOUD], BENCHMARKS §2, §6.2) | Ziel umformuliert; Gate G1 auf dem Laptop |
| A2 | „Nur CPU" | i5 vPro hat fast sicher eine iGPU; WebGL/WebGPU-Delegate könnten schneller sein | iGPU im Benchmark mitmessen (BENCHMARKS §6.3) |
| A3 | „Neue Homographie reicht nicht für die alte Griffkarte" | Für eine **ebene** Wand definieren 4 exakte Ecken die Abbildung vollständig. Probleme sind (i) Klickfehler an den Ecken, (ii) Ecken nicht/ungenau sichtbar, (iii) **Tiefe der Griffe → Parallaxe**, (iv) Linsenverzeichnung | Registrierung = Bildbasierte Verfeinerung + Validierung (§7). Die Parallaxe bleibt eine **physikalische Grenze** |
| A4 | Hand-Position „genauer als Handgelenk" über Fingerspitzen | Richtig, aber Hand-Landmarks fehlen oft: Hände sind laut Kletter-Studie in ≈ 50 % der Griffnutzungen verdeckt [SEKUNDÄR] | Kontaktlogik muss **ohne** Fingerdaten funktionieren (Degradation, §8) |
| A5 | Füße: Zehe + Ferse + Knöchel | MediaPipe ✓, RTMPose-Halpe26 ✓, COCO-17-Modelle ✗ | COCO-17-Modelle (YOLO-Pose, RTMO) ausgeschlossen |
| A6 | Vollautomatische Griffsegmentierung (SAM) | Im Browser auf CPU voraussichtlich minutenlang (§9) | Hybrid „klassisch → SAM verfeinern" |
| A7 | MediaPipe läuft „einfach" im Worker | Nur **klassische** Worker; Modul-Worker scheitern ([CLOUD] Spike) | Build-Setup beachtet (§4.3) |
| A8 | Tailwind oder CSS-Tokens | CSS-Custom-Properties reichen und halten Tokens zentral | Kein Tailwind |
| A9 | Pixel-USB-Webcam = normale Webcam | Android-Webcam: 1080p30 MJPEG, YUYV nur 720p; Auflösung/FPS oft nicht wählbar; Bildqualität wird in Tests als schwächer beschrieben [SEKUNDÄR]; Autofokus/-belichtung nicht steuerbar | Risiko R6; Latenz mitmessen; Videodatei-Pfad ist gleichwertig |
| A10 | ws:// zum ESP32 „vielleicht problematisch" | Von `http://localhost` aus **kein** Mixed-Content-Problem; Chromes „Local Network Access" betrifft öffentliche Origins [SEKUNDÄR, Chrome-Doku]. Gefahr nur, wenn die App je per **https** gehostet wird | App bleibt lokal gehostet; Relay nur Notfall |

---

## 3. Modell- und Lizenzentscheidungen

### 3.1 Entscheidung Pose/Hand

| Rolle | Wahl | Fallback | Ausgeschlossen (Grund) |
|---|---|---|---|
| Pose (Standard) | **MediaPipe Pose Landmarker Lite**, Video-Modus, Worker | Full | Heavy nur offline/Replay |
| Pose (Alternative, nur bei Gate-Fail) | **RTMPose-s/m Halpe26 + RTMDet-nano** via ORT-Web | – | – |
| Hand | **MediaPipe Hand Landmarker** auf ROI, ≤ 10 Hz, getrennter Worker | RTMPose-Wholebody-m (Hand+Fuß in einem Netz) | Vollbild-Hand jeden Frame (48 ms Leerlauf) |
| Person-Detektor (nur RTMPose-Pfad) | RTMDet-nano (Apache-2.0) | YOLOX-tiny (Apache-2.0) | YOLO-Ultralytics (AGPL) |
| Ausgeschlossen | YOLO11/26-Pose (AGPL-3.0, COCO-17), RTMO (COCO-17), Sapiens (CC BY-NC 4.0), ViTPose (zu schwer für Echtzeit-CPU) | – | – |

**Hinweis ViTPose:** Apache-2.0 und laut Studie [SEKUNDÄR] die genaueste (86,6 % vs. MediaPipe 83,5 %), aber ≈ 4 FPS auf deren Hardware → möglich als **Offline-Nachanalyse** von aufgezeichnetem Video in einem späteren Meilenstein (nicht in M1–M6 geplant).

**Gate G1 (Entscheidungsregel, Laptop-Benchmark + deine Videos):**
- MediaPipe Lite/Full erreicht Pose-Rate ≥ 15 Hz **und** Fußpunkte (Ferse/Fußspitze) sind in ≥ 80 % der Kletter-Frames mit `visibility > 0.5` auf deinen Videos → **MediaPipe bleibt**.
- Sonst RTMPose-Halpe26 benchmarken; wenn dort Rate ≥ 12 Hz und Fußpunkte besser → Adapter wechseln. Durch das `PoseEstimator`-Interface (§4.4) ist der Wechsel lokal.

### 3.2 Lizenzbewertung (Ziel: spätere kommerzielle Nutzbarkeit)

| Komponente | Code | Gewichte / Daten | Bewertung |
|---|---|---|---|
| MediaPipe Tasks Vision / Pose / Hand | Apache-2.0 (geprüft) | Modell-Card Apache-2.0 (Suchtreffer); Trainingsdaten Google-intern, nicht einsehbar | ✅ unkritisch; Attribution beilegen. *Offen:* Modelle sind via Google-Bucket geladen – Weiterverteilung der `.task`-Dateien im eigenen Produkt vor Veröffentlichung juristisch prüfen |
| ONNX Runtime Web | MIT | – | ✅ |
| RTMPose / RTMDet / mmpose / rtmlib | Apache-2.0 (geprüft) | Gewichte auf Body7/Halpe etc. trainiert; **Datensatzbedingungen** (u. a. AI Challenger, CrowdPose, PoseTrack, MPII teils nicht-kommerziell/Forschung) **nicht geprüft** | ⚠️ Code frei; **Gewichte vor kommerzieller Nutzung rechtlich klären** |
| ViTPose | Apache-2.0 (geprüft) | COCO u. a.; Datensatzbedingungen wie oben | ⚠️ wie RTMPose |
| MobileSAM / SAM 2 / EfficientSAM | Apache-2.0 (geprüft) | SAM-Gewichte trainiert auf SA-1B (Meta-Datenlizenz, Forschungsorientiert) – MobileSAM ist daraus destilliert | ⚠️ Datenlage für kommerziell nicht abschließend geklärt |
| **Ultralytics YOLO (11/26)** | **AGPL-3.0** (geprüft) | alle Ultralytics-Gewichte AGPL (laut Ultralytics-Lizenzseite, Suchtreffer) | 🚫 Für Veröffentlichung/kommerziell nur mit Enterprise-Lizenz. Außerdem Netzwerk-Copyleft-Klausel (AGPL §13). **Nicht verwenden** |
| **FastSAM** | **AGPL-3.0** (geprüft) | – | 🚫 |
| **Sapiens** | **CC BY-NC 4.0** (geprüft) | – | 🚫 nicht kommerziell |
| EdgeSAM | „NTU S-Lab License" (Suchtreffer) | – | 🚫 vorsichtshalber ausgeschlossen |
| OpenCV / opencv.js | Apache-2.0 (ab 4.5, bekannt; Paketangabe bestätigt) | – | ✅ |

**Kommerzielle Alternativen:** MediaPipe (Pose/Hand), RTMPose (Code Apache), ORT. Für **echte** kommerzielle Freigabe: Datensatz-/Gewichtelizenz durch Fachperson prüfen lassen (kein Rechtsrat von mir). Falls erforderlich, späteres Fine-Tuning auf **eigenen** Kletterdaten (Optional, §16).

---

## 4. Tech-Stack & Architektur

### 4.1 Stack (Entscheidung)

| Bereich | Wahl | Begründung |
|---|---|---|
| Build/Dev | **Vite 8** | Standard, schneller Dev-Server mit `server.headers` für COOP/COEP (SharedArrayBuffer für ORT-Threads), Worker-Support |
| Sprache | **TypeScript strict** (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`) | wie gefordert |
| UI | **Svelte 5** | Fein-granulare Reaktivität ohne Virtual DOM: gut für hochfrequente Zustandsupdates (Kontakte/HUD). UI ist größtenteils Canvas + wenige Panels – ein großes Komponenten-Ökosystem ist nicht nötig. React wäre gleichwertig machbar; Svelte spart Laufzeit und Boilerplate |
| Styling | **CSS Custom Properties** (Tokens zentral in `src/design/tokens.css` + TS-Spiegel) | kein Build-Zwang, direkt theme-/kontraststeuerbar |
| Schemas/Typen | **Zod 4** als Single Source of Truth → TS-Typen + generierte JSON-Schemas (`schemas/*.schema.json`) | Eine Definition für Validierung, Typen, Schema, Migration |
| Persistenz | **IndexedDB** via `idb` (ISC) | wie gefordert; Blobs (Referenzfotos, Modelle, Session-Chunks) |
| Tests | **Vitest** (Unit), **Playwright** (E2E, Chromium) | Playwright + Chromium sind in der Cloud-Umgebung vorhanden |
| Lint/Format | ESLint (typescript-eslint, strict), Prettier | |
| CV-Geometrie | **Eigener TS-Code** (Homographie 4-Punkt/DLT, Polygon-Ops, Hysterese, One-Euro) | klein, testbar, keine Abhängigkeit |
| CV-Schwergewicht | **opencv.js** (nur Worker, lazy geladen) für Feature-Matching/RANSAC/Konturen/Watershed | ~Megabytes, daher nur bei Bedarf. Funktionsumfang (ArUco, AKAZE) der konkreten Build vor M2 prüfen; ArUco ggf. nicht in Standardbuild [SEKUNDÄR] |
| Pose/Hand | `@mediapipe/tasks-vision` 1.2.2 (klassische Worker, IIFE-Bundle als statisches Asset) | siehe BENCHMARKS §2.5 |
| ML-Runtime (Segmentierung, ggf. RTMPose) | `onnxruntime-web` 1.31.1 (WASM, optional WebGPU) | |
| ZIP-Export | kleines MIT-Paket (z. B. `fflate`; vor M5 prüfen) | |

**Nicht gewählt:** Tailwind, React, TensorFlow.js (kein Vorteil ggü. MediaPipe/ORT), Redux/Global-State-Libraries (Svelte-Runes genügen), Backend-Framework.

### 4.2 Gesamtbild

```
                        ┌───────────────────────── Main Thread (UI, 60 FPS) ─────────────────────────┐
 CameraSource ─┐        │  Svelte-UI  │  WallMapRenderer (Canvas2D)  │  Overlay/Skeleton  │  HUD      │
 VideoFileSrc ─┴─ Frame │      ▲                ▲                           ▲                         │
 (ImageBitmap,  ts)     │      │ state          │ interpolierte Poses       │                         │
        │               └──────┼────────────────┼───────────────────────────┼─────────────────────────┘
        │ transfer (zero-copy)                    │ postMessage (Poses, Kontakte, Stats)
        ▼                                         │
 ┌────────────────┐   ┌────────────────┐   ┌─────┴──────────────────────────────────────────────┐
 │ Pose-Worker    │   │ Hand-Worker    │   │ Pipeline-Worker (rein TypeScript, leicht)          │
 │ MediaPipe Pose │   │ MediaPipe Hand │   │ OneEuro → Person-Tracking → Wand-Transformation    │
 │ (classic)      │   │ ROI-Crops      │   │ → ContactMatching → Zustand/Events → Recorder      │
 └──────┬─────────┘   └──────┬─────────┘   └────────────────────────┬───────────────────────────┘
        │ Keypoints          │ Hand-Landmarks                        │ Kontakt-Zustand
        └────────────────────┴───────────────► Pipeline-Worker ◄─────┘          ▼
                                                                         ESP32Transport (Main)  ·  SessionRecorder (IndexedDB)
 CV-Worker (opencv.js, on demand): Kalibrierung/Registrierung/Segmentierung-Klassik
 Seg-Worker (ORT-Web, on demand): MobileSAM
```

- **Zwei Takte:** *Inferenztakt* (variabel, 10–25 Hz, Worker) und *Rendertakt* (60 FPS, Main). Der Renderer interpoliert/extrapoliert Keypoints zwischen Inferenzschritten; Kontaktzustand wird nur bei Inferenzschritten aktualisiert.
- **Backpressure statt Warteschlange:** Pro Worker maximal ein Frame „in flight". Neue Frames ersetzen unverarbeitete (drop-oldest). Die Latenz bleibt dadurch begrenzt.
- **Zeitbasis:** Jeder Frame trägt `captureTime` (`requestVideoFrameCallback.mediaTime`/`MediaStreamTrack` Timestamp). Alle zeitabhängigen Algorithmen (One-Euro, Dwell, Hysterese) rechnen mit echter Zeit, nicht mit Frame-Zählern. Dadurch verhalten sich Videodatei (feste Rate) und Kamera (jitternd) gleich und sind testbar.

### 4.3 Worker-/Build-Konsequenzen (aus Spike)
- MediaPipe-Worker: `new Worker(url)` **classic**, `importScripts('/vendor/mediapipe/vision_bundle.js')`, Global `Vision`. Dateien (`vision_bundle.js`, `wasm/*`) werden per Skript aus `node_modules` nach `public/vendor/mediapipe/` kopiert (versionsgepinnt, kein Vite-Bundling).
- Modelle liegen als Blob in IndexedDB; `modelAssetBuffer` statt URL → echter Offline-Betrieb ohne Service Worker.
- Dev-/Preview-Server setzt `Cross-Origin-Opener-Policy: same-origin` und `Cross-Origin-Embedder-Policy: require-corp`.
- `OffscreenCanvas` ist in Chromium vorhanden ([CLOUD] bestätigt im Worker). **Fallback** (Safari/Firefox ohne volle Unterstützung): Rendering und Bild-Vorverarbeitung auf Main-Thread-Canvas. Offiziell unterstützter Browser für ClimbVision: **Chromium-basiert** (Chrome/Edge), da Web Serial/Bluetooth ohnehin nur dort laufen.

### 4.4 Modul → Ordner → Schnittstelle

```
src/
  design/            tokens.css, tokens.ts, Komponenten-Primitive (Button, Panel, Toggle …)
  core/              Typen (aus Zod), Zeit, Event-Bus, Fehlerklassen (deutsche Meldungen, i18n-Schlüssel)
  sources/           FrameSource-Interface, CameraSource, VideoFileSource, SourceManager
  geometry/          homography.ts, polygon.ts, oneEuro.ts, transforms.ts  (rein, 100 % getestet)
  calibration/       WallCalibration (Wizard-Logik), Homography-Orchestrierung, Entzerrung
  registration/      WallRegistration (Refine, Validierung, Drift-Monitor)
  holds/             HoldSegmentation (klassisch + SAM), HoldEditor (Operationen), Nummerierung
  pose/              PoseEstimator-Interface, MediaPipePose-Adapter, (später RTMPose-Adapter)
  hands/             HandTracking (ROI-Planer + Adapter)
  tracking/          PersonTracking (Auswahl, Lock, Re-Acquire)
  contact/           ContactMatching (Score, Hysterese, Zustandsautomat)
  session/           SessionRecorder, ReplayEngine, Auswertungen
  transport/         ESP32Transport-Interface, WebSocket/BLE/Serial, VirtualEsp32, Protokoll
  export/            ExportManager (JSON/CSV/ZIP/PNG/MediaRecorder)
  storage/           IndexedDB-Schicht, Migrationen
  ui/                Seiten: Start, Live, Scan, Sessions, ESP32, Einstellungen
  workers/           pose.worker.ts (classic), hand.worker.ts, pipeline.worker.ts, cv.worker.ts, seg.worker.ts
schemas/             generierte JSON-Schemas
testdata/            lokale Videos (gitignored)
firmware/esp32/      (erst M6)
```

Schlüssel-Interfaces (Skizze, nicht implementiert):
```ts
interface FrameSource { start(): Promise<void>; stop(): void; onFrame(cb: (f: Frame) => void): void; info(): SourceInfo }
interface Frame { bitmap: ImageBitmap; captureTime: number /* ms, monoton */; frameIndex: number; width: number; height: number }
interface PoseEstimator { init(): Promise<void>; estimate(f: Frame): Promise<PoseResult | null>; close(): void }
type PoseResult = { keypoints: Keypoint[] /* normalisiert 0..1 im Bild */; bboxNorm: Rect; score: number; time: number }
interface ContactMatcher { update(input: LimbObservation[], t: number): ContactState } // rein, deterministisch → mit Fixtures testbar
interface Esp32Transport { connect(): Promise<void>; send(msg: StateMsg): void; onStatus(cb: (s: TransportStatus) => void): void; disconnect(): void }
```
Die Kontaktlogik hängt **nur** von `LimbObservation` ab (Wandkoordinaten + Konfidenzen), nicht von MediaPipe. Dadurch testbar mit synthetischen/aufgezeichneten Sequenzen und modellunabhängig.

---

## 5. Kamera- und Quellenverwaltung

- **`CameraSource`:** `navigator.mediaDevices.enumerateDevices()` → Auswahl; Auflösung/FPS als `getUserMedia`-Constraints (`ideal`), tatsächlich erhaltene Werte aus `track.getSettings()` anzeigen (**ehrlich**: oft nicht das Gewünschte). Gerätelabel erscheint erst nach Berechtigung. Fehlermeldungen deutsch (z. B. „Kamera wird bereits von einer anderen Anwendung verwendet").
- **`VideoFileSource`:** `<video>` + `requestVideoFrameCallback` (Echtzeit) oder Seek-Stepping (deterministisch, „so schnell wie die Pipeline"). Gleiche `Frame`-Schnittstelle. Loop, Scrub, Geschwindigkeit.
- **Testbarkeit der Kamera-Route in der Cloud:** Chromium kann mit `--use-fake-device-for-media-stream --use-file-for-fake-video-capture=<datei>` eine Datei als Kamera ausgeben; damit kann auch `CameraSource` automatisiert getestet werden. **Annahme, in M1 per Mini-Test zu verifizieren.** `ffmpeg` ist vorhanden.
- **Pixel 7a USB-Webcam:** Setup-Anleitung im README (Android-Einstellung „USB-Einstellungen → Webcam", Stativ, Kabel; Android 14 QPR1+ nötig [SEKUNDÄR]). Erwartung: 1080p30 (MJPEG). Latenz wird im Setup einmal gemessen (Klatsch-Test, §BENCHMARKS 8.4) und angezeigt.
- **WebRTC/QR-Handykamera:** P2, Interface vorbereitet, nicht gebaut.

---

## 6. Wandkonzept & Kalibrierung

### 6.1 Koordinatensysteme
- **Bildkoordinaten (Kamera):** Pixel (x→rechts, y→unten).
- **Wandkoordinaten (Karte):** normalisiert `[0,1]²` (u→rechts, v→unten), Ursprung oben links. **Alle Polygone, Schwerpunkte, BBoxen werden hier gespeichert** (Spec).
- **Seitenverhältnis:** `WallProfile.aspekt = breite/hoehe`. Aus `breite_cm/hoehe_cm`, sonst vom Nutzer eingegeben (Vorschau mit Quadratraster zur Kontrolle). Für alle **Distanzen** wird in isotropen Einheiten gerechnet: `(u·aspekt, v)` in Wandhöhen-Einheiten, bzw. in cm, wenn Maße bekannt. Das ist wichtig: 0,02 in u ≠ 0,02 in v.
- **Homographie H:** 3×3, Kamera → Wand. 4 Punkte exakt (DLT mit Hartley-Normalisierung, eigener Code). Bei Verfeinerung (≥ 4 Korrespondenzen) Least-Squares + RANSAC (opencv.js).

### 6.2 Setup-Wizard (P0)
1. Quelle wählen → Live-Vorschau.
2. „Leere Wand aufnehmen": Median aus ~10 Frames (reduziert Rauschen, entfernt vorbeilaufende Personen).
3. 4 Ecken per Klick (Lupe, Pfeiltasten-Feinjustage, Reihenfolge TL-TR-BR-BL erzwungen, Konvexitäts-/Selbstüberschneidungs-Check, Mindestfläche).
4. H berechnen → **Entzerrungs-Vorschau groß** + Quadratraster-Overlay + Seitenverhältnis-Regler.
5. Optional: Wandwinkel (Grad), Maße (cm).
6. Speichern: `WallProfile` + Referenzfoto (Kameraansicht) + entzerrtes Referenzbild (JPEG-Blob, ~1600 px lange Kante).

### 6.3 Digitale Wandkarte (zentrales Rendering)
- Hintergrund umschaltbar: entzerrtes Referenzfoto / abgedunkelt / schematisch.
- Schichten (unten→oben): Hintergrund · Griffpolygone (Umriss 1,5 px, dezente Füllung) · Griff-IDs (optional) · Leucht-Ebene · Kontaktmarker · Beschriftungen · Skelett (wenn aktiviert) · Debug.
- **Leuchten ohne Konturverlust:** Pro Griff vorgerenderte Offscreen-Sprites (Füllung 16–22 % Alpha in Gliedmaßenfarbe + Außenglow per Blur **nur außerhalb** der Kontur + unveränderte 2-px-Kontur oben). Blur wird nur bei Zustandswechsel neu berechnet, nicht pro Frame.
- Mehrere Gliedmaßen auf einem Griff: feste **Quadranten-Bögen** (LH oben-links, RH oben-rechts, LF unten-links, RF unten-rechts) um den Schwerpunkt; jede Gliedmaße hat zusätzlich Buchstaben-Label und Formcodierung (Hände Kreis, Füße abgerundetes Quadrat). So bleibt es lesbar, auch bei Farbfehlsichtigkeit.
- Performance: ≤ 400 Griffe, Canvas2D auf dem Main-Thread reicht. Wird in M4 gemessen; Fallback `OffscreenCanvas`-Worker-Renderer nur wenn nötig.

### 6.4 Limb-Farben (Okabe–Ito-basiert, für Farbenblindheit entworfen)
| Limb | Farbe | Hex (Startwert) | Marker |
|---|---|---|---|
| LH | Himmelblau | `#56B4E9` | Kreis, Buchstabe „L" |
| RH | Orange | `#E69F00` | Kreis, „R" |
| LF | Bläulich-Grün | `#009E73` | Quadrat, „L" |
| RF | Rötlich-Violett | `#CC79A7` | Quadrat, „R" |
Pflicht in M1: automatisierter Test, der die Farben unter Deuteranopie/Protanopie/Tritanopie-Simulation auf Mindestabstand (ΔE) prüft und gegen den dunklen Hintergrund Kontrast ≥ 4,5:1 sichert. Werte können sich dadurch ändern.

---

## 7. Erneute Kameraregistrierung (Plan)

### 7.1 Was stimmt an der Spec – und was nicht
- Griffe liegen in **Wandkoordinaten** (entzerrt). Die Aufgabe einer neuen Session ist daher nicht, „Griffe in das neue Bild zu schieben", sondern: *eine neue Abbildung Kamera→Wand zu bestimmen, die so genau ist, dass die gespeicherten Wand-Polygone wieder auf den realen Griffen liegen.* Die 4 Klick-Ecken liefern das nur so genau wie der Klick (typ. 2–5 px Fehler → bei 1080p und 4 m Wand ≈ 1–2 cm, an den Rändern mehr), und nur wenn die Ecken wirklich scharf erkennbar sind.
- Deshalb: **Registrierung = Verfeinerung + Prüfung** (Bildabgleich zwischen neuem entzerrtem Bild und gespeichertem Referenzbild).

### 7.2 Ablauf (Session-Start)
1. Aktuelles leeres-Wand-Bild aufnehmen (Median aus 10 Frames).
2. **Initialvorschlag der Ecken (optional, P1):** Feature-Matching (ORB/AKAZE + RANSAC) zwischen gespeichertem Referenz-Kamerabild und neuem Bild → `H_ref→neu`; gespeicherte Ecken damit abbilden → Vorschlag zum Bestätigen. Baseline bleibt: Nutzer klickt 4 Ecken.
3. `H₀` aus den 4 Ecken. Neues Bild damit entzerren → `I_neu_rect`.
4. **Residual-Ausrichtung:** Features auf `I_neu_rect` und gespeichertem `I_ref_rect`; Matches + RANSAC → `H_res` (Rest-Verschiebung im Wandraum). Ergebnis `H = H_res ∘ H₀`.
5. **Plausibilitätsprüfung (alle müssen passen; Schwellen sind Startwerte, nach echten Daten zu kalibrieren):**
   - Inlier ≥ 40 und Inlier-Anteil ≥ 40 %;
   - mittlerer Reprojektionsfehler ≤ 0,35 % der Wandbreite;
   - Eckverschiebung durch `H_res` ≤ 2 % der Wandmaße (sonst Ecken falsch oder Wand verändert);
   - Inlier verteilt über ≥ 3 von 4 Quadranten (verhindert lokale Fehlanpassung);
   - **Kantenübereinstimmung:** gespeicherte Griffkonturen gegen Kanten (Canny/Gradient) in `I_neu_rect`: Chamfer-Abstand nach Verfeinerung ≤ Wert vor Verfeinerung und unter Schwelle.
6. **Ampel:** GRÜN → Live freigeben. GELB → Live mit Warnbanner („Registrierung ungenau, Kontakte weniger zuverlässig"). ROT → **Live gesperrt**, Anweisung „Neu kalibrieren oder Wand neu scannen" (Spec).
7. Das Session-Protokoll speichert `H`, Qualitätskennzahlen und Ampel.

### 7.3 Überwachung während der Session (Kamera bewegt?)
- ~12–16 **Anker-Patches** (32×32 px im Wandraum, aus dem Referenzbild, an texturreichen Stellen **außerhalb** von Griffen und Personenbereich). Alle 1–2 s: Template-Matching (NCC) in kleiner Suchzone, Median der Verschiebungen.
- Personenbereich (Bounding Box + Rand) maskieren; mindestens 60 % der Anker müssen sichtbar sein.
- Median-Drift > 0,5 % Wandbreite → GELB-Warnung; > 1,5 % oder breiter NCC-Einbruch → **Kontaktzuordnung pausieren**, Banner, Button „Neu registrieren". Bei Wiedererlangen mit Hysterese freigeben.
- Fehlalarm-Gegenmaßnahmen: Belichtungsänderungen (NCC ist helligkeitsrobust), Verdeckung (Maske).

### 7.4 Optionale Marker (P1)
ArUco-Marker an den Wandecken → automatische, robuste Homographie, auch Wiederfinden ohne Klicks. `WallProfile.arucoIds` vorgesehen. Technisch: Standard-opencv.js enthält ArUco wahrscheinlich nicht [SEKUNDÄR] → Eigenbuild oder eigene (kleine) Marker-Erkennung; Entscheidung in M2.

### 7.5 Harte Grenzen (ehrlich)
- **Parallaxe:** Ein Griff mit Tiefe `d` erscheint bei Blickwinkeländerung `θ` um ca. `d·sin θ` verschoben (Beispiel: 15 cm Tiefe, 10° → ≈ 2,6 cm). Das ist mit planarer Homographie **nicht** korrigierbar. Gegenmaßnahmen: `tiefe_cm` je Griff vergrößert Kontakttoleranz; Hinweis in der UI; stative Aufstellung möglichst frontal und mittig. Echte Korrektur (3D) ist P2/außerhalb des Plans.
- **Linsenverzeichnung:** nicht korrigiert (Weitwinkel-Smartphone, moderat). Randbereiche daher ungenauer. Optionale Verzeichnungsschätzung ist P2.
- Wand/Griffe verändert (andere Routen, umgeschraubte Griffe) → Registrierung wird ROT oder liefert falsche Sicherheit; der Kantencheck begrenzt das Risiko, beseitigt es nicht.

---

## 8. Kontakt-Erkennung (Kernalgorithmus)

Ziel: Aus verrauschten, teils fehlenden Keypoints **stabile, ehrliche** Kontakte pro Gliedmaße (LH/RH/LF/RF) mit Konfidenz und Mehrdeutigkeitsanzeige. Rein deterministische Funktion von `LimbObservation[]` + Zeit → vollständig unit-testbar.

### 8.1 Eingabe (pro Inferenzschritt, pro Gliedmaße)
`probes[]` in isotropen Wandkoordinaten, je Probe: `{kind, x, y, c}` mit Konfidenz `c ∈ [0,1]` (aus MediaPipe `visibility`/`presence` bzw. Heatmap-Peak) und einer Herkunftsmarke (pose/hand).
- **Hand:** Handgelenk · Handflächenmitte (Mittel der 4 MCP-Gelenke, falls Hand-Landmarks vorhanden) · Mittelfingerspitze (+ Zeigefingerspitze). **Ohne Hand-Landmarks:** Handgelenk + Pose-Handpunkte (MediaPipe-Pose-Landmarks Pinky/Index/Daumen 17–22) mit größerer Toleranz und **gedeckelter Maximal-Konfidenz (0,7)**.
- **Fuß:** Fußspitze (`foot_index`/große Zehe) · Ferse · Knöchel. Gewichtung abhängig von Kontaktart (Heel Hook: Ferse zählt stärker; Toe Hook/Stand: Zehe). Kontaktart wird nicht geraten, sondern über den **Kandidaten mit bester Gesamtübereinstimmung** gewählt.
- Vorverarbeitung: One-Euro-Filter pro Keypoint (in Wandkoordinaten, echte `dt`), Ausreißer-Check über Gliedlängen (z. B. Handgelenk weiter vom Schulterpunkt entfernt als anatomisch möglich → Probe verworfen, nicht geglättet).

### 8.2 Signed Distance und Positionsscore
- `d_k` = vorzeichenbehafteter Abstand der Probe `k` zum Griffpolygon (negativ innen), in cm bzw. relativen Einheiten.
- Toleranz `τ` (konfigurierbar; Startwerte Hand 4 cm, Fuß 5 cm, Handgelenk-Probe ×2,0) vergrößert um `0,3·tiefe_cm` je Griff (Parallaxe).
- `f(d,τ) = 1` für `d ≤ 0`, sonst `exp(−(d/τ)²)`.
- Positionsscore: `s_pos = max_k ( w_k · c_k · f(d_k, τ_k) )` mit Probengewichten `w_k` (Hand: Handfläche/Fingerspitze 1,0, Handgelenk 0,6; Fuß: Zehe/Ferse 1,0, Knöchel 0,4).

### 8.3 Weitere Faktoren
- **Geschwindigkeit:** `s_speed = 1 − smoothstep(v_lo, v_hi, v)`; `v` = Geschwindigkeit der führenden Probe (cm/s, aus gefiltertem Signal). Startwerte Hand 10/60 cm/s, Fuß 8/50 cm/s. Überstreichen eines Griffs im Schwung ≠ Kontakt.
- **Verweildauer:** `s_dwell = clamp(T_in / T_dwell, 0, 1)`; `T_in` = Zeit, in der `s_pos ≥ 0,5` ununterbrochen am selben Griff; `T_dwell` Hand 150 ms, Fuß 200 ms. Durch den niedrigen Inferenztakt ist Dwell in **Zeit** definiert.
- **Plausibilität `s_plaus ∈ [0.5,1]`:** Gliedmaßen-Reichweite, Körpergeometrie (Fuß nicht über beiden Händen-Höhe widerspricht nicht automatisch dem Klettern → **kein harter Ausschluss**), Sprunggröße zwischen Frames.
- **Gesamtscore:** `S = c_min · s_pos · s_speed · (0,5 + 0,5·s_dwell) · s_plaus`, wobei `c_min` die niedrigste verwendete Probenkonfidenz ist.

### 8.4 Zuordnung zu Griffen & Mehrdeutigkeit
- Kandidaten: Griffe mit `d ≤ 3τ` (Spatial-Index/Grid auf Wandkarte).
- Jede Gliedmaße hat **höchstens einen** aktiven Griff; ein Griff darf von mehreren Gliedmaßen genutzt werden.
- `S₁` bester, `S₂` zweitbester Kandidat. **Mehrdeutig**, wenn `S₂/S₁ > 0,8`: Zustand `AMBIGUOUS` mit Kandidatenliste (UI zeigt beide, ESP32 bekommt den besseren mit niedriger Konfidenz).
- **Klebrigkeit:** Aktueller Griff wird nur gewechselt, wenn Neuer um Marge ≥ 0,15 besser **und** dessen Dwell erfüllt ist.
- Probe in mehreren Polygonen (Überlappung): bevorzugt der Griff mit größerer relativer Eindringtiefe (`|d|/Griffgröße`).

### 8.5 Zustandsautomat je Gliedmaße (mit Hysterese)
```
FREE ──S≥θ_cand(0.45)──► CANDIDATE ──S≥θ_on(0.65) ∧ Dwell──► CONTACT ──(stabil ≥ T_stable)──► HOLDING
  ▲                         │ S<0.35                              │ S<θ_off(0.40)                 │
  │                         ▼                                      ▼                               ▼
  └──────────────────────  FREE  ◄───────────── LEAVING (min. T_off) ◄────────────────────────────┘
 Keypoint fehlt/Konfidenz fällt: CONTACT/HOLDING ──► OCCLUDED_HOLD (letzter Griff gehalten, S_eff = S_letzt·exp(−Δt/τ_decay))
 OCCLUDED_HOLD ──S_eff<θ_off──► LEAVING;  Keypoint kehrt zurück am selben Griff ──► HOLDING
```
- Hysterese: `θ_on = 0,65` > `θ_off = 0,40`. Mindestdauern: ON ≥ 100 ms, OFF-Sperre 100 ms (verhindert Flackern).
- **Konfidenz-Abfall bei Verdeckung:** `τ_decay` Hand 0,8 s, Fuß 1,2 s (Füße sind länger plausibel „unverändert"). Anzeigekonfidenz fällt sichtbar → die UI zeigt „geschätzt" (schraffiert/gestrichelt) statt „gesehen".
- **Letzten gültigen Zustand kurz halten:** `T_hold` Hand 400 ms, Fuß 600 ms, bevor der Zerfall beginnt.
- **Unsicherheit sichtbar:** Jede Ausgabe trägt `confidence`, `evidence` (`seen | hand-landmarks | pose-only | estimated`) und `flags` (`ambiguous`, `occluded`, `registrationWarn`).

### 8.6 Kontaktereignisse
`CONTACT_START`, `CONTACT_END`, `SWITCH` (mit Zeit, Limb, Griff, Score, Evidenz) – Basis für Sessions, Zugfolge und ESP32. Event-Zeit wird auf den Beginn der erfüllten Bedingungen zurückdatiert (Dwell-Latenz kompensiert).

### 8.7 Bekannte Schwachstellen (nicht wegzureden)
- Fingerspitzen/Handfläche oft verdeckt; Handgelenk liegt bei Leisten oder Sloper-Zügen deutlich neben dem Griff.
- Fersen/Fußspitzen bei Heel Hooks: Pose-Modelle schätzen sie schlecht; [kein Benchmark vorhanden].
- Griff mit Tiefe: 2D-Projektion verschiebt Griff gegenüber Körper (Parallaxe).
- Selbe Hand am selben Griff vs. „Hand direkt daneben/davor": 2D unterscheidbar nur über Tiefe → **nicht lösbar**, nur als Mehrdeutigkeit anzeigbar.

### 8.8 Debug-Overlay
Schaltbar: alle Keypoints/Konfidenzen, Griffpolygone, Distanzlinien Probe→nächster Griff, Score-Zerlegung (`s_pos`, `s_speed`, `s_dwell`, `c`), Kandidatenliste, Zustand + letzte Übergänge (Ringpuffer 3 s).

### 8.9 Test-Strategie Kontaktlogik (M4, vor Modellanbindung)
Synthetische Fixtures (TypeScript-Generatoren, deterministisch mit Seed): (1) Hand ruht auf Griff · (2) Hand überstreicht Griff schnell · (3) Rauschen σ = 0,5–2 cm · (4) Verdeckungslücke 300 ms / 1 s / 3 s · (5) zwei Griffe 3 cm Abstand (Mehrdeutigkeit) · (6) Griffwechsel · (7) unregelmäßige `dt` (Frame-Drops) · (8) niedrige Konfidenz · (9) Fuß mit nur Ferse sichtbar. „Golden-Event"-Erwartungen als JSON. Zusätzlich Properties: Kein Zustandsübergang ohne passende Schwelle; kein Flackern > x/s bei stationären Eingaben; Idempotenz bei gleicher Eingabe.

---

## 9. Griff-Scan & Editor (M3)

### 9.1 Pipeline
1. **Vorverarbeitung:** entzerrtes Wandbild (lange Kante 2048–3000 px), optional Beleuchtungsangleichung (CLAHE, Hintergrundschätzung).
2. **Segmentierungsmethode wählbar (Spec P0-B):**
   - **„Klassisch" (Standard, schnell, ohne Modelldownload):** Hintergrund-Schätzung (große Median-/Closing-Kernel) → Farb-/Sättigungs-/Kontrastabstand in Lab → Schwellwert → Morphologie → Distanztransformation + Watershed zum Trennen berührender Griffe → Konturen (`approxPolyDP`, ≤ 24 Eckpunkte). Stärke: farbige Griffe auf einheitlicher Wand. Schwächen: holzfarbene Griffe auf Holzwand, Schatten, Maserung.
   - **„SAM-verfeinert" (empfohlen, wenn Spike besteht):** klassische Kandidaten (Mittelpunkte/Boxen) als Prompts für **MobileSAM** (Encoder: ein Durchlauf pro Kachel; Decoder: wenige Dutzend–hundert Prompts) → saubere Masken. Außerdem **„Klick → Polygon"** im Editor.
   - **„SAM-Gitter" (vollautomatisch):** Gitter-Prompts über die Kachel. Voraussichtlich zu langsam: Ein Fremdbericht nennt ≈ 400–500 ms pro Masken-Decoder-Lauf im Browser [SEKUNDÄR] – bei 576 Gitterpunkten ≈ 4 Minuten pro Kachel. **Nur zulassen, wenn der M3-Spike deutlich besser misst.**
3. **Nachbearbeitung:** Filter (Fläche min/max, Kompaktheit), NMS/Überlappung, Kachelränder zusammenführen, Polygon vereinfachen, ID-Vergabe (Zeile-für-Zeile von oben links, Zeilenhöhe adaptiv), Schwerpunkt/BBox/Fläche/relative Größe (relativ zur medianen Griffgröße) berechnen.
4. **Fortschrittsanzeige** (Kachel x/y, Schritt, abbrechbar), Ergebnis-Overlay auf entzerrtem Foto.

**Benchmarkstatus:** MobileSAM-/SAM-Latenzen im Browser sind **nicht gemessen** (Gewichte im Sandbox-Netz nicht erreichbar). M3 beginnt mit einem 1-Tages-Spike auf deinem Laptop.

### 9.2 Editor (P0-C)
Operationen (alle als reine Funktionen auf `Hold[]` + Undo/Redo-Stack): löschen · teilen (Linie ziehen) · zusammenführen · Polygon zeichnen · Eckpunkte verschieben/hinzufügen/löschen · Polygon verschieben · Auto-Nummerierung · Filter nach Größe · Detailpanel (Notiz, Tiefe, Größe cm, Quelle auto/manuell) · Mehrfachauswahl · Zoom/Pan · Tastenkürzel. Jede Änderung setzt `quelle: "manuell"` (bei Auto-Griffen: „auto → bearbeitet" in Notiz/Flag).

Mögliche Weiterentwicklung (nicht geplant): Aus deinen manuell korrigierten Wänden entstehen Trainingsdaten für ein **eigenes** Griff-Segmentierungsmodell (Apache-2.0-fähige Architektur wie RTMDet-Ins/Mask R-CNN statt Ultralytics) – Optional, §16.

---

## 10. Person-Tracking

- Zielzustand: genau **eine** Person („Kletterer").
- **Auswahl** (ohne Lock): Score je Pose-Kandidat = `w₁·Hüftposition-im-Wandbereich (Gauß um Wandmitte/innerhalb Polygon) + w₂·Posegröße relativ zur Wand + w₃·Posequalität (mittlere Keypoint-Konfidenz) + w₄·zeitliche Kontinuität (Distanz zur Vorhersage)`.
- **„Person sperren":** Klick im Bild/Wandkarte → nächstliegende Pose (Hüfte/BBox enthält Klick) wird fest; Track-Zustand: Hüftposition, Geschwindigkeit (Kalman, konstante Geschwindigkeit), Körpergröße, optional Farbhistogramm Oberkörper (nur lokal, flüchtig).
- **Verdeckung:** Bis ~2 s Position vorhersagen, Zuordnung nur zu Kandidaten in plausibler Entfernung/Größe; danach Zustand `LOST` → UI-Hinweis; Wiederfinden automatisch bei konsistenter Pose.
- **Mehrpersonen-Handling in MediaPipe:** `numPoses` nur erhöhen, wenn nötig (Mehrpersonen-Latenz **nicht gemessen** [LAPTOP]); bei gesperrter Person bevorzugt `numPoses = 1`, da der interne Tracker sonst die Person wechseln kann (Risiko R4, in M4 prüfen). ROI-Cropping des Vollbilds ist wegen MediaPipes internem Tracking nur für den RTMPose-Pfad vorgesehen.

---

## 11. Datenmodelle (Zod → TS → JSON-Schema, versioniert)

Alle Dokumente tragen `schemaVersion: number` und `typ`. Migrationen: `migrate(doc, fromVersion) → neueste Version` als geordnete Kette `v1→v2→…` mit Unit-Tests je Schritt (Fixtures alter Versionen sind Teil des Repos). Unbekannte neuere Versionen werden **abgelehnt**, nicht still gelesen. JSON-Schlüssel behalten die deutschen Namen der Spec.

```jsonc
// WallProfile v1
{ "schemaVersion":1, "typ":"WallProfile", "id":"uuid", "name":"Heimwand", "winkel_grad":15,
  "breite_cm":300, "hoehe_cm":240, "aspekt":1.25,
  "ecken_bild":[[x,y],[x,y],[x,y],[x,y]],            // TL,TR,BR,BL in Referenz-Kamerabild
  "homographie":[9 Zahlen],                           // Kamera → Wand(0..1)
  "referenzfoto":{"blobId":"…","breite_px":1920,"hoehe_px":1080},
  "referenz_entzerrt":{"blobId":"…"},
  "aruco_ids":[], 
  "registrierung":{"anker":[{"u":0.2,"v":0.7,"patchBlobId":"…"}], "merkmale":{"typ":"orb","blobId":"…"}, "letzte_qualitaet":{…}},
  "kamera":{"verzeichnung":null,"geraet":"…"}, "erstellt":"ISO", "geaendert":"ISO" }

// Hold v1  (holds.json = { schemaVersion, wandId, griffe: Hold[] })
{ "id":17, "polygon":[[u,v],…], "schwerpunkt":[u,v], "bbox":[u0,v0,u1,v1], "flaeche":0.0021,
  "relative_groesse":1.3, "groesse_cm":null, "tiefe_cm":0, "notiz":"", "quelle":"auto|manuell" }

// Session v1: Metadaten + Chunk-Verweise (Zeitreihe in IndexedDB-Chunks, siehe unten)
{ "schemaVersion":1, "typ":"Session", "id":"uuid", "wandId":"…", "wand_snapshot":{homographie, registrierung_qualitaet, griffe_hash},
  "kamera_kalibrierung":{…}, "modell":{"pose":"mediapipe-lite@1","hand":"…"}, "start":"ISO", "dauer_ms":…,
  "chunks":[…], "events":[{t,limb,holdId,typ,score,evidenz}], "einstellungen":{…} }

// Route v1
{ "schemaVersion":1, "typ":"Route", "id":"uuid", "wandId":"…", "name":"…",
  "griffe":[{"holdId":17,"rolle":"start|hand|fuss|top","reihenfolge":1}], "zugfolge":[{"limb":"RH","holdId":17}] }
```
- **Zeitreihe:** Spalten-orientierte Float32/Int16-Chunks (z. B. 10 s je Chunk): `t`, 33 Keypoints × (x,y,c) in Wandkoordinaten + Roh-Bildkoordinaten (für Neuberechnung bei verbesserter Kalibrierung). Größenordnung bei 15 Hz: ≈ 10–40 MB/h (Schätzung, ohne Kompression).
- **Export:** JSON, CSV (Events, Zeitreihe), ZIP (Projekt: Profil, Griffe, Routen, Sessions, Referenzbilder), PNG-Screenshot, Overlay-Video via `canvas.captureStream()` + `MediaRecorder`.

---

## 12. Sessions & Auswertung (M5, Überblick)
Datenaufnahme standardmäßig AN, Video AUS (Opt-in; Videoaufnahme nur lokal). Replay mit Scrubbing und Zeitlupe (deterministisch, aus Chunks; nicht aus Video, falls kein Video aufgenommen wurde). Auswertung als reine Funktionen auf Events/Zeitreihen: Zugfolge, Zeit pro Zug, Pausen, Hüft-/Schwerpunktbahn (Näherung aus Hüftpunkten – **kein** echter Körperschwerpunkt), Reichweite/Spannweite, Gelenkwinkel (2D-Projektion! nur Näherung, kein echter Winkel bei Tiefenbewegung), statisch/dynamisch, Links/Rechts-Verteilung, Heatmap. Versuchssegmentierung (Start an Startgriffen, Ende Top/Sturz), Ghost-Overlay. Alle Metriken tragen in der UI den Hinweis auf 2D-Näherung.

---

## 13. ESP32-Ausgabe (M6, Überblick – Details in `docs/PROTOCOL.md` später)

### 13.1 Browser-Schnittstellen – Prüfergebnis
| API | Verfügbarkeit | Bewertung |
|---|---|---|
| `getUserMedia` | Secure Context nötig; `http://localhost` zählt als sicher | ✅ |
| WebSocket `ws://<esp32-ip>` von `http://localhost` | Seite ist nicht https → **kein Mixed-Content-Block**. Chromes Local-Network-Access-Prompt gilt für *öffentliche* Origins; localhost-Origins sind laut Chrome-Doku ausgenommen [SEKUNDÄR] | ✅ Standardtransport. **Auf dem Laptop zu verifizieren.** Falls die App je über https gehostet wird: Blockade → dann lokal hosten oder `wss` |
| Web Serial | nur Chromium (Chrome/Edge/Opera); Secure Context; Nutzergeste + Portauswahl | ✅ für Chromium; Firefox/Safari ✗ |
| Web Bluetooth | nur Chromium; Secure Context; Nutzergeste | ✅ für Chromium, **MTU nicht frei wählbar** |
| mDNS (`esp32.local`) | Browser-abhängig | Standard: **IP-Eingabefeld**, mDNS optional |
**Entscheidung:** Kein Node-Relay in der Planung. Er wird nur gebaut, wenn auf deinem Netzwerk WebSocket-Direktverbindung nachweislich scheitert (dann ~100 Zeilen, `ws` MIT).

### 13.2 Protokoll-Eckpunkte
JSON, UTF-8, `v`, `seq`, `ts`, `state:{LH,RH,LF,RF → {h:holdId|null,c:Konfidenz,a:ambig}}`, zusätzlich `active:[holdIds]`. Senden nur bei Änderung, ≤ 20 Hz, Keepalive 1 Hz; `hello`/`ack`/`config`; Latenz = Round-Trip über `seq`-Echo. **BLE:** Standard-ATT-MTU 23 → 20 Byte Nutzlast; ein typischer JSON-State (≈ 80–120 Byte) muss **gechunkt** werden (Chunk-Header `i/n`). Deshalb ist für BLE die **kompakte Binärvariante** (≈ 16 Byte: Version, seq, 4 × (u16 holdId, u8 conf), Flags) empfohlen und wird in M6 als Pflicht für BLE umgesetzt (in der Spec „optional" – ich halte sie für BLE faktisch für notwendig).
### 13.3 Weitere Bausteine
Mapping-Editor (`holdId → LED-Index`, Farbe je Gliedmaße, CSV Import/Export), **Virtueller ESP32** (zeigt Nachrichten, simuliert ACK/Latenz/Verbindungsabbruch → komplette Pipeline ohne Hardware testbar), Beispiel-Firmware unter `/firmware/esp32/` (PlatformIO, WebSocket-Server, NimBLE, WS2812B, Testmuster). **Alles Hardware-Nahe wird als „nicht auf echter Hardware getestet" gekennzeichnet**, solange ich es nicht war.

---

## 14. UI-Konzept

### 14.1 Layout (Live-Modus)
```
┌ links 280px (einklappbar) ─┬────────────────── Arbeitsbereich ────────────────────┬ rechts 320px (einklappbar) ┐
│ ◉ Navigation               │                                                        │ Kontakte                   │
│   Start · Live · Scan ·    │            ┌───────────────────────────┐               │  LH  Griff 17  ●●●○ 0.91  │
│   Sessions · ESP32 · Einst │            │                           │               │  RH  Griff 22  ●●○○ 0.64 ⚠ │
│ Kamera ▾  Auflösung ▾ FPS ▾│            │    DIGITALE WANDKARTE     │               │  LF  —                     │
│ Wandprofil ▾               │            │    (immer größtmöglich,   │               │  RF  Griff 5  geschätzt    │
│ Modell: Lite ▾             │            │     Seitenverhältnis      │               │ Tracking-Status  ● gesperrt│
│ Tracking-Einstellungen     │            │     der Wand)             │               │ Performance-HUD            │
│ Anzeige: IDs ☐ Skelett ☐   │            │                           │  [Kamera-PiP] │  Pose 17 Hz · Render 60    │
│          Konfidenz ☐ Debug │            └───────────────────────────┘  verschiebbar │  Latenz 180 ms · CPU 62 %  │
│ ⏺ Aufnahme  ⛶ Vollbild     │       Statuszeile: Registrierung GRÜN · Person gesperrt│ Debug-Info (aufklappbar)   │
└────────────────────────────┴────────────────────────────────────────────────────────┴────────────────────────────┘
```
- Seitenleisten einklappbar (Kürzel `[`/`]`), Abschnitte einzeln ein-/ausblendbar; die Wandkarte nimmt den Rest ein (`aspect-ratio` der Wand, `object-fit: contain`).
- Kamerabild: PiP (verschiebbar/skalierbar), „Kamerafokus"-Umschaltung (Kamera groß, Wandkarte klein), Skelett-Overlay optional. Wandkarte und Kamerabild verwenden **dieselbe Zeitmarke** der Inferenz, um Synchronität zu garantieren (Overlay-Pose gehört zum angezeigten Frame, nicht zum jüngsten).
- Vollbild-Wandkarte (`F`), **Content-Modus** (`C`: nur Wand + Limb-Legende, kein UI-Chrom, keine Debugwerte).

### 14.2 Seiten
1. **Start & Setup-Wizard** (Schrittleiste, Leerzustände mit Anleitung). 2. **Live.** 3. **Scan & Griff-Editor** (Werkzeugleiste links, Eigenschaften rechts). 4. **Sessions & Auswertung.** 5. **ESP32** (Verbindung, Mapping, Virtueller ESP32). 6. **Einstellungen** (Toleranzen, Filter, Sprache, Barrierefreiheit).

### 14.3 Gestaltung & Barrierefreiheit
- Dunkles Hochkontrast-Theme (Hintergrund ~`#0B0D10`, Text ≥ 7:1, Fokusring sichtbar), große Klickflächen (≥ 44 px), Systemschrift (keine externen Fonts → keine Netzanfragen), Zahlen in Tabellenziffern.
- Tokens: `--color-*`, `--space-*`, `--radius-*`, `--font-*`, `--elev-*`, Limb-Farben, Zustandsfarben (OK/Warn/Fehler/Unsicher) – zentral in `src/design/tokens.css`, TS-Spiegel für Canvas.
- **Skill:** Falls im Projekt-Kontext ein `frontend-design`-Skill verfügbar ist, wird er in M1 für die Design-System-Arbeit geladen. In dieser Cloud-Session ist **kein** Skill dieses Namens gelistet (nur `artifact-design`, das für Artifacts gilt) – ich nutze daher die oben festgelegten Tokens und Prinzipien.
- **i18n:** Alle Texte über Schlüssel (`t('live.noCamera')`), Dictionary `de` (Standard) und `en` (leer/teilweise); echte Mehrsprachigkeit ist P2.
- **Tastenkürzel (Vorschlag):** `1–6` Seiten, `[` `]` Seitenleisten, `F` Vollbild, `C` Content-Modus, `D` Debug, `I` Griff-IDs, `S` Skelett, `Leertaste` Pause (Videodatei), `Strg+Z/Y` Editor, `L` Person sperren.
- **Deutsche Fehlermeldungen** zentral (Fehlercode → Text → Handlungsvorschlag).

---

## 15. Qualitätssicherung

- **Unit-Tests (Vitest), Pflicht ab dem jeweiligen Meilenstein:** Homographie (Roundtrip, bekannte Matrizen, kollineare/entartete Punkte, Rauschen) · Punkt-in-Polygon (konkav, Löcher ausgeschlossen, Randfälle) · Signed Distance · Polygon-Geometrie (Fläche, Schwerpunkt, BBox, Vereinfachung, Schnitt/Teilung/Vereinigung) · Griffzuordnung (Überlappung, Mehrdeutigkeit) · Kontaktlogik/Hysterese/Konfidenz-Abfall (§8.9) · One-Euro (Step-/Sinus-Antwort, ungleiche `dt`) · Protokoll (Roundtrip, Versionierung) · Paketgrößen/Chunking (BLE-MTU-Grenzen) · Datenmigration (alte Fixtures) · Registrierung (synthetisch: bekannte Verschiebung/Verdrehung/Skalierung → Wiederfindung; Negativfälle: andere Wand, stark verschoben) · Farbtests (CVD-Abstand, Kontrast).
- **Integration/E2E (Playwright, Chromium):** Pipeline mit **VideoFileSource** (Fixture-Videos) und – sobald verifiziert – Fake-Kamera; Offline-Test (Netz blockiert nach Setup); Smoke-Tests der Seiten; Worker-Start; Barrierefreiheit-Grundchecks.
- **Fixtures:** synthetische Keypoint-Sequenzen (deterministisch), synthetische Wandbilder (generierte Polygone auf Textur, per `ffmpeg`/Canvas gerendert), später **deine** echten Clips (gitignored).
- **Performance-Tests:** Mikrobenchmarks der reinen Algorithmen (Kontaktlogik für 300 Griffe < 1 ms/Frame als Ziel), Render-Budget (Wandkarte < 4 ms/Frame bei 300 Griffen als Ziel). Beides Ziele, nicht Messungen.
- **Datenschutz-Test:** E2E prüft, dass nach Setup **keine** Netzwerkanfragen nach außen gehen (Playwright `page.route`/Request-Log).
- Lint/Typecheck/Tests als `npm run check`; CI per GitHub Actions (nur wenn du es willst, §17).

---

## 16. Optionale Pfade (nicht Teil von M1–M6)
- Offline-Nachanalyse mit ViTPose/RTMPose-l/Heavy auf aufgezeichnetem Video.
- Fine-Tuning von Pose (Fuß/Heel-Hook) oder Griffsegmentierung auf eigenen Daten (Apache-2.0-fähige Architekturen; Datenlizenz klären).
- Auto-Eckenerkennung der Wand, ArUco-Marker, Verzeichnungskalibrierung, 3D-Lift/Tiefe.
- Sturzerkennung, Coaching (P2).

---

## 17. Meilensteine

Aufwand grob als Größenklasse (S ≈ 1 Arbeitssitzung, M ≈ 2–3, L ≈ 4–6) – **Schätzung**, abhängig von deinem Feedback und der Hardware-Realität.

| M | Inhalt | Wichtigste Liefergegenstände | Abnahmekriterien (konkret) | Größe |
|---|---|---|---|---|
| **M1** Grundgerüst | Repo-Setup (Vite/TS strict/Svelte/ESLint/Vitest/Playwright), Design-System & Tokens, App-Shell (Seitenleisten, Routing, i18n-Gerüst), `FrameSource` + `CameraSource` + `VideoFileSource`, Performance-HUD (FPS/Frame-Zeiten), IndexedDB-Schicht + Schema-/Migrations-Gerüst, README-Grundstock, `npm run check` | Lauffähige App mit Quellenwahl, Videodatei & Kamera, HUD; Farb-/Kontrasttests; Offline-Smoke | Videodatei wird mit 60 FPS Render abgespielt, HUD zeigt echte Werte; Kamera-Constraint-Anzeige zeigt **tatsächliche** Settings; Tests grün; keine externen Requests | M |
| **M1b** (parallel, durch dich) | Laptop-Benchmark (`bench/`) + Testvideos aufnehmen | `bench/results/laptop-*.json`, `/testdata/*` | → Gate G1 (Modellentscheidung) | S (du) |
| **M2** Kalibrierung | Wizard Schritte 1–8, Homographie (eigener Code), Entzerrung, `WallProfile` speichern/laden/duplizieren, Registrierung (Verfeinerung + Ampel + Drift-Monitor), opencv.js-Worker | Wizard end-to-end mit Videodatei-Standbild; Registrierungstests (synthetisch) | Synthetische Verschiebung bis ±3 % wird auf ≤ 0,3 % korrigiert oder korrekt ROT; Kantencheck erkennt „andere Wand" | L |
| **M3** Griff-Scan & Editor | Klassische Segmentierung, MobileSAM-Spike → Entscheidung, Editor (alle P0-Operationen), `holds.json`, Nummerierung | Scan-Seite, Editor mit Undo/Redo | Auf deinem Wandfoto: ≥ X % der Griffe automatisch korrekt (**X nach Sichtung des echten Fotos festlegen**), Editor kann den Rest vollständig korrigieren; Operationen unit-getestet | L |
| **M4** Live-Pose & Kontakt (**MVP**) | Pose-Worker (MediaPipe classic), One-Euro, Person-Tracking & Lock, Hand-ROI-Worker, Kontaktlogik, Live-Wandkarte, Kontaktpanel, Skelett-Overlay, Debug-Overlay | Live-Seite komplett | Abnahme durch dich an **deinen** Videos nach den in BENCHMARKS §8.4 vorgeschlagenen Metriken; Gate G1 vorher entschieden | L |
| **M5** Sessions | Aufnahme (Chunks), Replay/Scrub/Zeitlupe, Auswertungen, Export (JSON/CSV/ZIP/PNG/MediaRecorder), Routen, Versuchssegmentierung | Sessions-Seite | Replay reproduziert Kontakte bit-genau aus Chunks; Exporte re-importierbar | L |
| **M6** ESP32 | Transport-Interface, WS/BLE/Serial, Protokoll + `PROTOCOL.md`, Mapping-Editor, Virtueller ESP32, Firmware (PlatformIO) | ESP32-Seite, `firmware/esp32/` | Komplette Pipeline gegen Virtuellen ESP32 grün (Latenz, Reconnect, Chunking); Firmware kompiliert (falls Toolchain verfügbar) – **Hardwaretest nur durch dich** | M–L |
| **M7** P2 | Nur auf Anforderung | | | – |

Abhängigkeiten: M2 → M3 → M4; M5 benötigt M4; M6 benötigt nur die Kontaktdaten aus M4 (kann mit synthetischen Daten schon früher beginnen, ich halte die Reihenfolge der Spec ein). M1b ist für G1 nötig, blockiert aber M1–M3 nicht.

---

## 18. Risikoregister

| ID | Risiko | Wahrsch. | Wirkung | Gegenmaßnahme |
|---|---|---|---|---|
| R1 | Pose-Rate auf dem Laptop < 15 Hz | mittel | hoch | Lite, ROI, Frame-Skipping, iGPU-Delegate, Gate G1 → RTMPose-s |
| R2 | MediaPipe-Detektor verliert Kletterer (Überhang, Wandnähe, abgeschnittener Körper – im Spike mit einem Bild bereits ein Totalausfall) | **hoch** | hoch | Test an echten Videos früh; Fallback RTMPose; Wiedereintritt per Wand-ROI; Lock-Logik |
| R3 | Fuß-/Heel-Hook-Qualität unzureichend | **hoch** | hoch | Unsicherheit sichtbar machen; Fußkontakt-Konfidenz deckeln; Gate G1; Fine-Tuning als Option |
| R4 | Personenwechsel bei Mehrpersonen/Verdeckung | mittel | mittel | Lock, Kalman, `numPoses` steuern, UI-Warnung |
| R5 | Hand-Landmarker zu teuer/unzuverlässig | hoch | mittel | ROI + Rate; Kontaktlogik ohne Fingerdaten voll funktionsfähig |
| R6 | Pixel-Webcam: Latenz/Autofokus/Belichtung/Auflösung nicht steuerbar | mittel | mittel | Messen in M1; Videodatei-Pfad gleichwertig; Hinweise im README; ggf. WebRTC-Handykamera (P2) |
| R7 | Segmentierung dichter Wände mangelhaft | hoch | mittel | Hybrid + starker Editor („Klick→Polygon"); Qualität erst am echten Foto beurteilen |
| R8 | SAM im Browser zu langsam | hoch | niedrig-mittel | nur als Verfeinerer; klassisch als Standard |
| R9 | Registrierung liefert falsche Sicherheit | mittel | hoch | Mehrfache Plausibilitätsprüfung, Ampel, Live-Drift-Monitor, RED = Sperre |
| R10 | Parallaxe/Griffe mit Tiefe | sicher | mittel | `tiefe_cm`, Toleranz, ehrliche Doku |
| R11 | Thermisches Throttling / Akkubetrieb | mittel | mittel | HUD zeigt Rate; Hinweis „am Netz"; adaptive Qualität |
| R12 | Lizenz der Gewichte/Trainingsdaten für kommerziell | mittel | hoch (nur bei Kommerz) | Rechtliche Prüfung vor Veröffentlichung; MediaPipe/RTMPose-Pfade austauschbar |
| R13 | `MediaPipe`-API/Bundle-Änderungen | niedrig | mittel | exakte Versionspinnung, Modelle mit SHA-256 |
| R14 | Browser-Sicherheitsregeln ändern sich (LNA, WebSocket) | niedrig | mittel | Lokal gehostet, Relay-Notfall |
| R15 | Cloud-Messwerte werden mit Laptop-Werten verwechselt | mittel | mittel | Label-System in BENCHMARKS.md; HUD im Produkt zeigt immer Echtwerte |

---

## 19. Entscheidungsprotokoll (ADR-Kurzform)

| # | Entscheidung | Alternativen | Grund |
|---|---|---|---|
| D1 | Svelte 5 statt React | React 19 | siehe §4.1 |
| D2 | CSS-Tokens statt Tailwind | Tailwind | zentrale Tokens, weniger Build-Abhängigkeit |
| D3 | Zod als Schema-Quelle | handgeschriebene JSON-Schemas + Typen | eine Quelle, generierte Schemas |
| D4 | Eigene Homographie/Geometrie in TS | opencv.js dafür | klein, 100 % testbar, Start ohne WASM-Last |
| D5 | opencv.js nur lazy im Worker | gar nicht / immer | Registrierung/Segmentierung brauchen Feature-Matching/Watershed |
| D6 | MediaPipe Lite → Full als Standard-Pose | RTMPose | Fertiger Browser-Graph, Tracking-ROI, gemessen; Gate G1 prüft |
| D7 | Klassische Worker für MediaPipe | Modul-Worker | Modul-Worker scheitern (gemessen) |
| D8 | Modelle als Blob in IndexedDB | Service-Worker-Cache | `modelAssetBuffer`, kontrollierbar, versioniert (SHA-256) |
| D9 | Chromium als Zielbrowser | Firefox/Safari-Support | Web Serial/Bluetooth nur Chromium |
| D10 | Kein Node-Relay vorab | Relay von Anfang an | nicht nötig bei lokalem Hosting; Notfallplan |
| D11 | BLE-Binärprotokoll als Pflicht für BLE | nur JSON + Chunking | MTU 20 Byte |
| D12 | Feste Modell-URLs `/float16/1/` + Hash | `latest` | Reproduzierbarkeit |
| D13 | Pose-Rate-Ziel ≥ 15 Hz (Ziel 20+), Render 60 FPS entkoppelt | harte 20 FPS | gemessene Realität |
| D14 | Systemschriftarten, keine externen Ressourcen | Web-Fonts | „Keine externe Datenübertragung" |

---

## 20. Offene Fragen an dich

**Entscheidend für den Start (bitte beantworten):**
1. **Freigabe M1** + Bestätigung der Stack-Entscheidungen (Svelte 5, CSS-Tokens, Zod, Chromium-only).
2. **Benchmark auf dem Laptop:** Kannst du `bench/` ausführen (README) und mir `bench/results/laptop-*.json` + OS/CPU-Angabe schicken? Ohne das bleibt Gate G1 offen (blockiert M4, nicht M1–M3).
3. **Deine Testvideos (§BENCHMARKS 8.3):** Bis wann sind welche verfügbar? Insbesondere Überhang mit Heel Hook – das entscheidet über Risiko R2/R3.
4. **Betriebssystem/Browser** deines Laptops (Windows/macOS/Linux; Chrome oder Edge)? Beeinflusst Webcam- und Bluetooth-Hinweise.
5. **Wandangaben:** Wandgröße (B×H cm), Winkel, ungefähre Griffanzahl, Wandfarbe/Griffmaterial (bunt? Holz?) – steuert die Segmentierungsstrategie. Ein Foto der leeren Wand wäre sehr hilfreich.

**Produktentscheidungen (ich habe Defaults gesetzt, korrigiere bei Bedarf):**
6. Soll Personen-/Skelett-Datenschutzmodus (Video ausblenden, nur Skelett) schon in M4 aufgenommen werden statt P2? *(Default: P2)*
7. Ziel-Toleranzen: Kontaktradius Hand 4 cm / Fuß 5 cm – realistisch für deine Griffgrößen? *(Default wie angegeben, in Einstellungen änderbar)*
8. Soll die Binärvariante des ESP32-Protokolls für BLE Pflicht sein (meine Empfehlung) oder nur JSON mit Chunking? *(Default: Binär für BLE)*
9. Soll die App nur lokal (`npm run dev` / gebauter `dist/` mit kleinem statischen Server) laufen oder auch als **installierbare PWA** (Offline-Start ohne Dev-Server)? Zweiteres ist mehr Aufwand. *(Default: lokaler Server; PWA optional später)*
10. CI (GitHub Actions) für Lint/Test gewünscht? *(Default: ja, klein)*
11. Lizenz des Projekts selbst (MIT/Apache-2.0/proprietär)? Hängt mit der geplanten Veröffentlichung zusammen.
12. Soll ich den **Benchmark-Harness** (`bench/`) im Repo lassen? Er ist reines Messwerkzeug, keine App – falls du M0 strikt ohne Code willst, entferne ich ihn. *(Default: behalten)*
13. Kommerzielle Absicht konkret? Wenn ja, sollten wir die Gewichte-/Datenlizenz (§3.2, R12) **vor** M4 juristisch klären lassen.
14. Mehrsprachigkeit: Soll EN schon in M1 mitgepflegt werden oder erst später? *(Default: nur Schlüssel + DE)*

---

## 21. Was in M0 tatsächlich getan wurde (und was nicht)
- **Getan:** Recherche (Lizenzen aus Originaldateien, READMEs, npm-Versionen), Cloud-Messungen (Browser-WASM + nativ + Worker-Spike), Harness unter `bench/`, `BENCHMARKS.md`, `SOURCES.md`, dieses Dokument.
- **Nicht getan / nicht möglich:** Messung auf deiner Hardware; Genauigkeit; RTMPose-/ViTPose-/SAM-Latenzen; Kameratests; ESP32; Lesen von arXiv/CVF-Originalen (Sandbox-Netz).
- **Keine Anwendung** implementiert; kein App-Code, keine Komponenten, keine Pose-Pipeline, keine Firmware. `bench/` ist Messwerkzeug.
