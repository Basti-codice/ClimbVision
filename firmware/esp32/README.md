# ESP32-Beispiel-Firmware

**Status: ungetestet.** Diese Firmware wurde ohne ESP32, LED-Streifen und PlatformIO-Toolchain geschrieben (Cloud-Umgebung). Sie ist gegen `docs/PROTOCOL.md` geprüft, aber **nie kompiliert oder ausgeführt**. Erwarte Kompilierfehler/Tippfehler und teste zuerst mit wenigen LEDs.

Funktionen: WebSocket-Server (Port 81), BLE (NimBLE, Nordic-UART, 16-Byte-Binärzustand), WS2812B über FastLED, Testmuster (Start + Serial-Kommando `t`), Mapping/Farben/Helligkeit per `cfg`, Sicherheitszustand (LEDs aus nach 3 s ohne Daten).

1. `src/config.h`: `NUM_LEDS`, `LED_PIN`, ggf. WLAN-Zugang (leer → Access-Point `ClimbVision-LED`, Adresse `ws://192.168.4.1:81`).
2. `pio run -t upload` (PlatformIO). Verkabelung: WS2812B-Daten über 330-Ω-Widerstand an `LED_PIN`, gemeinsame Masse, separate 5-V-Versorgung dimensioniert für die LEDs (≈ 60 mA pro LED bei Vollweiß).
3. In ClimbVision: Seite **ESP32** → Transport wählen → Verbinden → Testmuster.

Bekannte Lücke: Antworten über BLE (`ack`, `hello`) werden ohne Chunking per Notify gesendet und können bei kleiner MTU abgeschnitten werden; für den Betrieb genügt die einseitige Binärübertragung (App → ESP32).
