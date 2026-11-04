/** Mehrsprachigkeit (DE Standard, EN vorbereitet). Alle UI-Texte laufen über t('schlüssel'). */
export type Lang = 'de' | 'en';
type Dict = Record<string, string>;

const de: Dict = {
  'app.name': 'ClimbVision', 'nav.start': 'Start & Setup', 'nav.live': 'Live', 'nav.scan': 'Scan & Griffe', 'nav.sessions': 'Sessions', 'nav.esp32': 'ESP32', 'nav.settings': 'Einstellungen',
  'side.collapse': 'Seitenleiste einklappen', 'side.expand': 'Seitenleiste ausklappen',
  'err.noCamera': 'Keine Kamera gefunden. Ist das Handy im USB-Webcam-Modus verbunden?', 'err.generic': 'Es ist ein Fehler aufgetreten.',
  'empty.noProfile': 'Noch keine Wand eingerichtet. Starte den Setup-Assistenten unter „Start & Setup“.', 'empty.noHolds': 'Noch keine Griffe. Öffne „Scan & Griffe“ und starte den Scan.',
  'empty.noSessions': 'Noch keine Sessions aufgezeichnet.', 'empty.noRoutes': 'Noch keine Routen.',
  'limb.LH': 'Linke Hand', 'limb.RH': 'Rechte Hand', 'limb.LF': 'Linker Fuß', 'limb.RF': 'Rechter Fuß',
  'state.FREE': 'frei', 'state.CANDIDATE': 'Kandidat', 'state.CONTACT': 'Kontakt', 'state.HOLDING': 'hält', 'state.OCCLUDED_HOLD': 'verdeckt (geschätzt)', 'state.LEAVING': 'löst',
  'track.suche': 'Suche Person …', 'track.verfolgt': 'Person verfolgt', 'track.verdeckt': 'Person verdeckt', 'track.verloren': 'Person verloren',
  'reg.gruen': 'Registrierung in Ordnung', 'reg.gelb': 'Registrierung ungenau', 'reg.rot': 'Registrierung fehlgeschlagen', 'reg.paused': 'Kamera bewegt – Zuordnung pausiert',
  'btn.lock': 'Person sperren', 'btn.unlock': 'Sperre lösen', 'btn.start': 'Starten', 'btn.stop': 'Stoppen', 'btn.save': 'Speichern', 'btn.cancel': 'Abbrechen', 'btn.delete': 'Löschen',
  'privacy': 'Alle Daten bleiben auf diesem Gerät. Keine Cloud, keine Konten, keine Telemetrie.',
};
const en: Dict = {
  'app.name': 'ClimbVision', 'nav.start': 'Start & setup', 'nav.live': 'Live', 'nav.scan': 'Scan & holds', 'nav.sessions': 'Sessions', 'nav.esp32': 'ESP32', 'nav.settings': 'Settings',
  'btn.lock': 'Lock person', 'btn.unlock': 'Release lock', 'btn.start': 'Start', 'btn.stop': 'Stop', 'btn.save': 'Save', 'btn.cancel': 'Cancel', 'btn.delete': 'Delete',
  'privacy': 'All data stays on this device. No cloud, no accounts, no telemetry.',
};
const dicts: Record<Lang, Dict> = { de, en };
let current: Lang = 'de';
export function setLang(l: Lang): void { current = l; }
export function getLang(): Lang { return current; }
/** Fehlt ein Schlüssel in der gewählten Sprache, fällt t() auf Deutsch zurück; fehlt er überall, wird der Schlüssel selbst angezeigt. */
export function t(key: string, vars?: Record<string, string | number>): string {
  let s = dicts[current][key] ?? de[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
  return s;
}
export const availableKeys = (): string[] => Object.keys(de);
