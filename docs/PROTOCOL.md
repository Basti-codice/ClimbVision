# ClimbVision ↔ ESP32 – Protokoll v1

Implementierung: `src/transport/protocol.ts` (getestet, `tests/transport.test.ts`). Firmware: `firmware/esp32/` (**nicht auf echter Hardware getestet**).

## Transporte
| Transport | Format | Hinweise |
|---|---|---|
| WebSocket (Standard) | JSON-Text, 1 Nachricht pro Frame | `ws://<IP>:81`. App läuft auf `http://localhost` → kein Mixed-Content-Problem. Bei Hosting über https blockiert der Browser `ws://`. |
| Web Serial (USB) | JSON, Zeilen mit `\n` | 115200 Baud. Debug-Ausgaben der Firmware (Zeilen ohne `{`) werden ignoriert. Nur Chrome/Edge. |
| Web Bluetooth (BLE) | Zustand: **16-Byte-Binärpaket**; sonstige Nachrichten: JSON, gechunkt | Nordic-UART-Service `6e400001-b5a3-f393-e0a9-e50e24dcca9e`; RX (App→ESP) `…0002…`, TX (ESP→App, Notify) `…0003…`. Nur Chrome/Edge. |

## JSON-Nachrichten (alle: `v`=1, `t`=Typ, `seq`=Zähler)
```jsonc
{"v":1,"t":"hello","seq":1,"ts":1234,"client":"climbvision","caps":["json"]}      // App → Gerät
{"v":1,"t":"hello","seq":1,"ts":1234,"device":"esp32","fw":"0.1.0","leds":300,"caps":["json","bin"]} // Gerät → App
{"v":1,"t":"s","seq":42,"ts":98765,"s":{"LH":{"h":12,"c":91},"RH":{"h":22,"c":64,"a":1},"LF":null,"RF":{"h":5,"c":40}},"act":[5,12,22]}
{"v":1,"t":"ack","seq":42}
{"v":1,"t":"cfg","seq":1000,"colors":{"LH":"#56B4E9","RH":"#E69F00","LF":"#009E73","RF":"#CC79A7"},"brightness":128,"map":[[12,0],[22,1]]}
{"v":1,"t":"ping","seq":7,"ts":123}   /   {"v":1,"t":"pong","seq":7,"ts":123}
```
- `s` = Zustand: je Gliedmaße `null` (frei) oder `{h: holdId, c: Konfidenz 0–100, a?: 1 = mehrdeutig}`; `act` = alle aktiven Griffe.
- Typische Größe des Zustands: ≈ 135 Byte (3 aktive Gliedmaßen).
- **Latenz** = Round-Trip `ping`→`pong` (App misst mit `performance.now()`); **Verlust** erkennt das Gerät/der virtuelle ESP32 an Lücken in `seq`.
- `cfg`-Nachrichten mit Mapping: 400 Griffe ≈ 3,7 kB. Über BLE bei 20-Byte-MTU ≈ 205 Chunks – die App sendet über BLE deshalb nur Farben/Helligkeit; das Mapping wird per WLAN/USB übertragen oder in der Firmware (`config.h`) hinterlegt.

## Senderegeln
Nur bei Änderung des (auf 5 %-Stufen quantisierten) Zustands · höchstens **20 Hz** (50 ms Mindestabstand) · **Keepalive 1 Hz** · Verbindungsabbruch → Auto-Reconnect mit Backoff 0,5 → 8 s · Heartbeat 1 Hz, Timeout 3,5 s. Gerät: ≥ 3 s ohne Nachricht → LEDs aus (Sicherheitszustand).

## Binärvariante (BLE, 16 Byte)
| Byte | Inhalt |
|---|---|
| 0 | `0xC1` (Typ „Zustand“, Version 1) |
| 1 | `seq & 0xFF` |
| 2–13 | 4 × (u16 LE `holdId`, `0xFFFF` = keiner; u8 Konfidenz 0–100) in der Reihenfolge LH, RH, LF, RF |
| 14 | Flags: Bit i = Gliedmaße i mehrdeutig |
| 15 | XOR aller Bytes 0–14 |

Passt in ein Standard-BLE-Paket (ATT-MTU 23 → 20 Byte Nutzlast). JSON (≈ 135 Byte) würde ≥ 8 Chunks brauchen.

## Chunking (JSON über BLE)
Jedes Paket: `[index, total]` + Nutzdaten (`payload − 2` Byte). Empfänger verwirft den Puffer bei Lücke und beginnt bei `index == 0` neu. Max. 255 Chunks.

## Mapping & Farben
`holdId → LED-Index` (CSV `holdId,led`, Import/Export in der App), Farbe je Gliedmaße (Standard Okabe–Ito), Helligkeit 5–255. Mehrere Gliedmaßen am selben Griff mischen additiv (gedeckelt bei 255).

## Versionierung
`v` wird strikt geprüft; unbekannte Version → Nachricht wird abgelehnt (App: Meldung „Nicht unterstützte Protokollversion“).
