# ClimbVision – M0 Benchmark-Harness

Kein Teil der Anwendung. Reine Messwerkzeuge, damit die Zahlen aus `docs/BENCHMARKS.md` auf **deinem** Laptop reproduziert werden können.
Alles läuft lokal; es werden nur öffentliche Modelle/Beispielbilder heruntergeladen.

## Auf dem Laptop (Node ≥ 20, Python ≥ 3.9, Chrome/Chromium via Playwright)

```bash
cd bench && bash fetch-models.sh                    # MediaPipe-Modelle + Testbild (Google/Ultralytics-Assets)
cd web && npm install && npx playwright install chromium   # lokal, falls Playwright nicht global vorhanden
python ../py/fetch_onnx.py                          # RTMPose-t/s/m (Halpe26) – URL-Download ungetestet, s. Skript
node run-headless.mjs --iters 100 --out ../results/laptop-cpu.json            # reine CPU/WASM-Messung
node run-headless.mjs --iters 100 --headed --gpu --out ../results/laptop-gpu.json  # zusätzlich iGPU (WebGL/WebGPU)
```

Zusätzlich vor dem Test notieren: Betriebssystem, genaue CPU (`wmic cpu get name` / `lscpu`), Netzbetrieb vs. Akku, Energiemodus.
**Akku/Stromsparmodus verfälscht die Werte um Faktor 2+** – für den Test am Netz, Energiemodus „Höchstleistung".

## Hinweise
- `results/cloud-*.json` sind die Rohdaten der M0-Cloud-Messung (Intel Xeon @2.1 GHz mit AVX-512/AMX, Headless Chromium 153). **Nicht** auf deinen Laptop übertragbar.
- `latency` zählt nur Frames, in denen tatsächlich eine Person/Hand gefunden wurde (`hitRate`), sonst misst man nur den Detektor-Leerlauf.
- Handlatenz *mit* sichtbarer Hand ist mit den mitgelieferten Bildern **nicht** messbar (kein Bild mit Hand offline verfügbar) – auf dem Laptop mit eigenem Bild/Video ergänzen.
- `py/bench_mediapipe.py`: native Referenz (Python). Braucht `pip install mediapipe opencv-python-headless numpy`; unter Linux ggf. `libegl1`.
