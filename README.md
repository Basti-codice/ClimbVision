# ClimbVision

Lokale Echtzeit-Analyse von Kletterbewegungen: Kamera → Pose → Zuordnung von Händen/Füßen zu Griffen → **digitale Wandkarte**, Aufzeichnung/Auswertung und Ansteuerung einer LED-Wand per ESP32.
Alles läuft **lokal im Browser** (Chrome/Edge). Keine Cloud, keine Konten, keine Telemetrie.

> **Status:** M1–M6 sind implementiert. **Nicht** auf echter Hardware getestet: Pixel-7a-Webcam, echte Kletterbewegungen, ESP32/LEDs (Firmware ist ungetestet), Leistung auf dem Ziel-Laptop. Details siehe „Bekannte Einschränkungen“ und `docs/`.

## Start in 4 Schritten (Windows 11 + Chrome)
1. [Node.js 22 LTS](https://nodejs.org) installieren.
2. Im Projektordner (PowerShell): `npm install`
3. `npm start` (baut die App und startet den lokalen Server auf `http://127.0.0.1:4173`) – **Chrome oder Edge** öffnen.
4. Die App führt dich: **Wand einrichten** (Foto → 4 Ecken → speichern) → die **Griffe werden automatisch erkannt** → im Griffe-Modus korrigieren → **Live**: Kamera öffnen → **Starten**. Die Modelle werden beim ersten Start automatisch (einmalig) geladen.

Der Server liefert die nötigen Header (`COOP/COEP`, CSP). Die App muss über `http://localhost`/`127.0.0.1` geöffnet werden (sicherer Kontext für Kamera, Web Serial, Web Bluetooth) – **nicht** per `file://`.

## Bedienkonzept
Es gibt **einen** Arbeitsbereich: die digitale Wand immer groß in der Mitte, links Quelle/Ansicht/Erkennung/Ausgabe, rechts Kontakte bzw. Details, unten die Aktionen des aktuellen Modus. Oben wählst du den Modus: **Live · Griffe · Aufnahmen**; Einstellungen liegen in einer Seitenschublade (⚙).
- **Kamera fest = alles automatisch:** Die Kamera steht an derselben Stelle wie beim Setup-Foto. Beim Öffnen richtet die Software das Live-Bild per Bildabgleich selbst auf die Wand aus (keine Ecken-Klicks). Das **Live-Bild liegt entzerrt direkt auf der Wand** (Deckkraft einstellbar, Wandfoto/Dunkel wählbar). Erst wenn die Kamera bewegt wurde, bittest dich die App, die Ecken kurz neu zu setzen.
- **Person sperren:** Knopf drücken, dann den Kletterer **auf der Wand** anklicken.
- **Griffe bearbeiten:** Griff anklicken = auswählen (verschieben, Entf, Teilen, Form über die schwebende Leiste); auf leere Fläche ziehen = Bereich markieren; **Hinzufügen** + Klick = Griff per Zauberstab; **Prüfen ▶** springt durch fragwürdige Griffe. Alles wird automatisch gespeichert, Strg+Z/Y funktioniert.
- **ESP32:** nur eine Schnittstelle (Karte „Ausgabe“ links): WLAN/Bluetooth/USB wählen, verbinden – die Software sendet dann die aktuellen Griffe je Hand/Fuß (`docs/PROTOCOL.md`). Der ESP32 selbst ist nicht Teil der Software.

## Pixel 7a als USB-Webcam
Android 14 (QPR1 oder neuer): Handy per USB-Kabel anschließen → Benachrichtigung „USB“ antippen / *Einstellungen → Verbundene Geräte → USB* → **Webcam**. In ClimbVision erscheint die Kamera in der Geräteliste. Stativ frontal zur Wand, Handy quer oder hochkant, Display aus/Sperre ok.
Erwartung (Quellen, nicht selbst getestet): 1080p30 (MJPEG); Auflösung/Bildrate meist nicht wählbar; Autofokus/-belichtung nicht steuerbar; die App zeigt beim Öffnen die **tatsächlich gelieferten** Werte. Latenz der Webcam-Kette ist unbekannt – bitte messen.

## Videodateien als Quelle
Live → **Videodatei öffnen** (WebM, MP4/H.264 in Chrome). Die gesamte Pipeline (Registrierung, Pose, Kontakte, Aufzeichnung) läuft identisch; die Videozeit dient als Zeitbasis. Damit sind Tests ohne Kamera möglich.

## Offline-Betrieb und Datenschutz
- Nach dem einmaligen Modell-Download (SHA-256-geprüft, in IndexedDB) arbeitet die App ohne Internet. Alle Daten bleiben im Browserspeicher (Einstellungen → Daten löschen).
- **Gefunden und blockiert:** `@mediapipe/tasks-vision` versucht im Betrieb, Nutzungs-Logs per `POST https://odml.pa.googleapis.com/v1/log` zu senden. ClimbVision wehrt das mehrfach ab: (1) **Netzwerkwächter** im MediaPipe-Worker (lehnt jede Nicht-Same-Origin-Anfrage ab, zählt sie – sichtbar unter Debug/Status), (2) strikte **CSP** (`connect-src 'self'` für Worker-Skripte), (3) CSP der Seite erlaubt nur `storage.googleapis.com` (Modell-Download), `ws:`/`wss:` (ESP32). Ein E2E-Test prüft, dass nach dem Download keine externe Anfrage das Netz erreicht.
- Videobilder verlassen den Rechner nie.

## Bedienung (Kurzfassung)
Modi `1` `2` `3`, Seitenleisten `[` `]`, Vollbild `F`, Content-Modus `C` (nur die Wand, für Aufnahmen), Debug `D`, Nummern `I`, Skelett `S`, Person sperren `L`. Editor: `V` Auswählen, `A` Hinzufügen, `P` Zeichnen, `T` Teilen, `E` Form, `M` verbinden, `Entf` löschen, `Strg+Z/Y`.
Farben (farbenblindheitstauglich, zusätzlich Form + Buchstabe): **LH** blau · **RH** orange · **LF** grün · **RF** rosa. Gestrichelte Umrisse = Position geschätzt (Gliedmaße verdeckt), „?“ = mehrdeutig.

## Bekannte Einschränkungen (ehrlich)
- **2D-Parallaxe:** Griffe mit Tiefe erscheinen bei anderem Blickwinkel verschoben; Tiefe pro Griff (`tiefe_cm`) vergrößert nur die Toleranz. Keine 3D-Korrektur.
- **Füße/Heel Hooks/Überkopf:** Das Pose-Modell (MediaPipe) kann Personen mit abgeschnittenem oder verdecktem Körper verlieren (im Cloud-Test an einem Bild beobachtet). Fersen-/Fußspitzenpunkte sind bei Verdeckung unzuverlässig; die App zeigt Unsicherheit statt falscher Sicherheit. **Nicht an echten Kletterbewegungen validiert.**
- **Links/Rechts von hinten:** Das Modell kann Seiten verwechseln → Einstellung „Links/Rechts tauschen“.
- **Segmentierung:** Klassisches Verfahren; auf deinem Kilter-Foto ≈ 485 Kandidaten, aber Griffe im Reflexionsband und an Rändern müssen im Editor korrigiert werden. Kein ML-Segmentierer (SAM) enthalten.
- **Dichtes Raster:** Registrierung per Bildabgleich kann bei großen Fehlern (> ½ Rasterabstand) auf ein Nachbarmuster einrasten; die Ampel prüft Plausibilität, ersetzt aber nicht sorgfältiges Setzen der Ecken.
- **Leistung:** Auf CPU-Browser realistisch ≈ 15–25 Hz Pose (Lite) – auf dem Ziel-Laptop **nicht gemessen** (`bench/`). Hand-Tracking nur auf Ausschnitt/reduzierter Rate.
- **Kamera bewegt:** Drift-Monitor pausiert die Zuordnung; danach neu registrieren.
- Nur Chromium-Browser (Web Serial/Bluetooth). Keine Mehrsprachigkeit über DE hinaus (Architektur vorbereitet).
- ESP32-Firmware: ungetestet (siehe `firmware/esp32/README.md`).

## Entwicklung
```bash
npm run dev        # Dev-Server (127.0.0.1:5173, gleiche Header)
npm run check      # tsc + svelte-check + ESLint + Vitest-Tests
npm run e2e        # Chromium-Durchlauf (benötigt testdata/wall-example.jpg, ffmpeg, Internet für den Modell-Download)
```
Struktur: `src/ui` (Stage, Panels, Wizard), `src/app` (Controller: live, editor, replay), `src/geometry` (Homographie, Polygone, One-Euro), `src/registration`, `src/holds`, `src/contact` (Kontaktlogik), `src/pipeline`, `src/engine`, `src/session`, `src/transport`, `src/storage`, `src/ui`, `public/workers/mediapipe.worker.js` (klassischer Worker, bewusst nicht gebündelt), `bench/` (Messwerkzeuge für den Laptop), `docs/` (PLAN, BENCHMARKS, PROTOCOL, SOURCES), `firmware/esp32/`.
Tests laufen ohne Kamera/Modelle (synthetische Fixtures); `testdata/` (nicht im Repo) enthält deine Fotos/Videos.
