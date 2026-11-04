// ClimbVision ESP32 – WebSocket (WLAN) + BLE (NimBLE, Nordic UART) + WS2812B (FastLED).
// WARNUNG: UNGETESTET. Geschrieben und gegen docs/PROTOCOL.md geprüft, aber nie kompiliert oder auf Hardware ausgeführt.
#include <Arduino.h>
#include <WiFi.h>
#include <WebSocketsServer.h>
#include <ArduinoJson.h>
#include <FastLED.h>
#include <NimBLEDevice.h>
#include "config.h"

CRGB leds[NUM_LEDS];
WebSocketsServer ws(81);
static const char* LIMBS[4] = {"LH", "RH", "LF", "RF"};
CRGB limbColor[4] = {CRGB(0x56, 0xB4, 0xE9), CRGB(0xE6, 0x9F, 0x00), CRGB(0x00, 0x9E, 0x73), CRGB(0xCC, 0x79, 0xA7)};
int16_t ledOf[MAX_HOLD_ID + 1];   // holdId → LED, -1 = nicht gemappt
uint32_t lastRx = 0;
bool haveSignal = false;

// ---------- Anzeige ----------
void showState(const int32_t hold[4]) {
  FastLED.clear();
  for (int l = 0; l < 4; l++) {
    int32_t h = hold[l];
    if (h < 0 || h > MAX_HOLD_ID) continue;
    int16_t i = ledOf[h];
    if (i < 0 || i >= NUM_LEDS) continue;
    leds[i] += limbColor[l];          // additive Mischung (saturiert bei 255)
  }
  FastLED.show();
}

void testPattern() {                  // einfacher Lauflicht-Test
  for (int i = 0; i < NUM_LEDS; i++) { FastLED.clear(); leds[i] = CHSV(i * 3, 255, 255); FastLED.show(); delay(5); }
  FastLED.clear(); FastLED.show();
}

// ---------- Protokoll ----------
void applyConfig(JsonObjectConst o) {
  JsonObjectConst colors = o["colors"];
  if (!colors.isNull()) for (int l = 0; l < 4; l++) {
    const char* hex = colors[LIMBS[l]];
    if (hex && hex[0] == '#') { uint32_t v = strtoul(hex + 1, nullptr, 16); limbColor[l] = CRGB((v >> 16) & 255, (v >> 8) & 255, v & 255); }
  }
  if (!o["brightness"].isNull()) FastLED.setBrightness(constrain((int)o["brightness"], 5, 255));
  JsonArrayConst map = o["map"];
  if (!map.isNull() && map.size() > 0) {
    for (int i = 0; i <= MAX_HOLD_ID; i++) ledOf[i] = -1;
    for (JsonArrayConst p : map) { int h = p[0], led = p[1]; if (h >= 0 && h <= MAX_HOLD_ID) ledOf[h] = led; }
  }
}

// Gibt die Antwort als String zurück ("" = keine Antwort)
String handleJson(const String& text) {
  JsonDocument doc;
  if (deserializeJson(doc, text) || doc["v"] != 1) return "";
  const char* t = doc["t"] | "";
  uint32_t seq = doc["seq"] | 0;
  lastRx = millis(); haveSignal = true;
  if (!strcmp(t, "hello")) { JsonDocument r; r["v"] = 1; r["t"] = "hello"; r["seq"] = seq; r["ts"] = millis(); r["device"] = "esp32"; r["fw"] = FW_VERSION; r["leds"] = NUM_LEDS; JsonArray c = r["caps"].to<JsonArray>(); c.add("json"); c.add("bin"); String s; serializeJson(r, s); return s; }
  if (!strcmp(t, "ping")) { JsonDocument r; r["v"] = 1; r["t"] = "pong"; r["seq"] = seq; r["ts"] = doc["ts"]; String s; serializeJson(r, s); return s; }
  if (!strcmp(t, "cfg"))  { applyConfig(doc.as<JsonObjectConst>()); }
  else if (!strcmp(t, "s")) {
    int32_t hold[4];
    for (int l = 0; l < 4; l++) { JsonVariantConst w = doc["s"][LIMBS[l]]; hold[l] = w.isNull() ? -1 : (int32_t)w["h"]; }
    showState(hold);
  } else return "";
  JsonDocument r; r["v"] = 1; r["t"] = "ack"; r["seq"] = seq; String s; serializeJson(r, s); return s;
}

// Binärpaket (BLE): 0xC1, seq, 4×(u16 LE, u8), flags, xor
bool handleBinary(const uint8_t* b, size_t n) {
  if (n != 16 || b[0] != 0xC1) return false;
  uint8_t x = 0; for (int i = 0; i < 15; i++) x ^= b[i];
  if (x != b[15]) return false;
  int32_t hold[4];
  for (int l = 0; l < 4; l++) { uint16_t id = b[2 + l * 3] | (b[3 + l * 3] << 8); hold[l] = id == 0xFFFF ? -1 : id; }
  lastRx = millis(); haveSignal = true; showState(hold);
  return true;
}

// ---------- WebSocket ----------
void onWs(uint8_t num, WStype_t type, uint8_t* payload, size_t len) {
  if (type != WStype_TEXT) return;
  String reply = handleJson(String((char*)payload).substring(0, len));
  if (reply.length()) ws.sendTXT(num, reply);
}

// ---------- BLE (NUS) ----------
NimBLECharacteristic* txChar = nullptr;
std::string chunkBuf; int chunkTotal = 0, chunkNext = 0;
class RxCb : public NimBLECharacteristicCallbacks {
  void onWrite(NimBLECharacteristic* c) override {
    std::string v = c->getValue();
    if (handleBinary((const uint8_t*)v.data(), v.size())) return;
    if (v.size() < 3) return;
    uint8_t idx = v[0], total = v[1];                     // JSON-Chunking: [index,total] + Daten
    if (idx == 0) { chunkBuf.clear(); chunkTotal = total; chunkNext = 0; }
    if (idx != chunkNext || total != chunkTotal) { chunkBuf.clear(); chunkTotal = 0; return; }
    chunkBuf.append(v.substr(2)); chunkNext++;
    if (chunkNext < chunkTotal) return;
    String reply = handleJson(String(chunkBuf.c_str())); chunkBuf.clear(); chunkTotal = 0;
    if (reply.length() && txChar) { txChar->setValue(reply.c_str()); txChar->notify(); }   // ungechunkt – siehe README (bekannte Lücke)
  }
};
void startBle() {
  NimBLEDevice::init("ClimbVision-LED");
  NimBLEServer* srv = NimBLEDevice::createServer();
  NimBLEService* svc = srv->createService("6e400001-b5a3-f393-e0a9-e50e24dcca9e");
  NimBLECharacteristic* rx = svc->createCharacteristic("6e400002-b5a3-f393-e0a9-e50e24dcca9e", NIMBLE_PROPERTY::WRITE | NIMBLE_PROPERTY::WRITE_NR);
  rx->setCallbacks(new RxCb());
  txChar = svc->createCharacteristic("6e400003-b5a3-f393-e0a9-e50e24dcca9e", NIMBLE_PROPERTY::NOTIFY);
  svc->start();
  NimBLEAdvertising* adv = NimBLEDevice::getAdvertising();
  adv->addServiceUUID("6e400001-b5a3-f393-e0a9-e50e24dcca9e"); adv->start();
}

void setup() {
  Serial.begin(115200);
  for (int i = 0; i <= MAX_HOLD_ID; i++) ledOf[i] = i < NUM_LEDS ? i : -1;   // Standard: Griff-ID = LED-Index
  FastLED.addLeds<WS2812B, LED_PIN, GRB>(leds, NUM_LEDS);
  FastLED.setBrightness(DEFAULT_BRIGHTNESS);
  testPattern();
  bool sta = false;
  if (strlen(WIFI_SSID)) { WiFi.mode(WIFI_STA); WiFi.begin(WIFI_SSID, WIFI_PASS); for (int i = 0; i < 30 && WiFi.status() != WL_CONNECTED; i++) delay(500); sta = WiFi.status() == WL_CONNECTED; }
  if (!sta) { WiFi.mode(WIFI_AP); WiFi.softAP(AP_SSID, AP_PASS); }
  Serial.printf("IP: %s\n", (sta ? WiFi.localIP() : WiFi.softAPIP()).toString().c_str());
  ws.begin(); ws.onEvent(onWs);
  startBle();
}

void loop() {
  ws.loop();
  while (Serial.available()) {                      // USB (Web Serial): zeilenweise JSON; 't' = Testmuster
    String line = Serial.readStringUntil('\n'); line.trim();
    if (line == "t") testPattern();
    else if (line.startsWith("{")) { String r = handleJson(line); if (r.length()) Serial.println(r); }
  }
  if (haveSignal && millis() - lastRx > SIGNAL_TIMEOUT_MS) { FastLED.clear(); FastLED.show(); haveSignal = false; }   // Sicherheitszustand
}
