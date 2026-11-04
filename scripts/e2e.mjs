// E2E-Test im echten Chromium (Playwright). Nutzt testdata/wall-example.jpg (lokal, nicht im Repo) und erzeugt ein Test-Video per ffmpeg.
// Aufruf: npm run build && npm run e2e   (Internet nur für den einmaligen Modell-Download beim ersten „Starten“)
import { createRequire } from 'node:module';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os'; import { fileURLToPath } from 'node:url';
const { chromium } = createRequire(import.meta.url)('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = process.env.E2E_OUT ?? fs.mkdtempSync(path.join(os.tmpdir(), 'cv-e2e-'));
fs.mkdirSync(out, { recursive: true });
const photo = path.join(root, 'testdata/wall-example.jpg');
const bus = process.env.E2E_PERSON_IMG ?? path.join(root, 'bench/web/fixtures/bus.jpg');
const results = []; const ok = (n, c, d = '') => { results.push({ n, ok: !!c, d }); console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? '  – ' + d : ''}`); };
if (!fs.existsSync(photo)) { console.log('SKIP: testdata/wall-example.jpg fehlt'); process.exit(0); }
const video = path.join(out, 'wall.webm');
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-loop', '1', '-framerate', '15', '-t', '8', '-i', photo, '-loop', '1', '-framerate', '15', '-t', '8', '-i', bus,
  '-filter_complex', "[0:v]scale=720:1280[bg];[1:v]scale=330:-1[fg];[bg][fg]overlay=x='30+t*45':y=760", '-c:v', 'libvpx', '-b:v', '2M', '-pix_fmt', 'yuv420p', video]);

const srv = spawn('npx', ['vite', 'preview', '--port', '4173', '--strictPort'], { cwd: root, stdio: 'ignore', shell: process.platform === 'win32' });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 50; i++) { try { if ((await fetch('http://127.0.0.1:4173/')).ok) break; } catch { /* warten */ } await wait(200); }

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 950 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const errors = [], external = []; let block = false, extAt = 0;
page.on('console', (m) => { if (m.type() === 'error' && !/^INFO:|XNNPACK|favicon/.test(m.text())) errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
await ctx.route('**/*', (r) => { const u = new URL(r.request().url()); if (['127.0.0.1', 'localhost'].includes(u.hostname) || u.protocol === 'blob:' || u.protocol === 'data:') return r.continue(); external.push(u.hostname); return block ? r.abort() : r.continue(); });
await ctx.addInitScript(() => { window.__toasts = []; new MutationObserver(() => { for (const t of document.querySelectorAll('.toast')) if (!window.__toasts.includes(t.textContent)) window.__toasts.push(t.textContent); }).observe(document, { childList: true, subtree: true }); });
const shot = async (n) => page.screenshot({ path: path.join(out, n + '.png') });
const btn = (name, opt = {}) => page.getByRole('button', { name, ...opt }).first();
const cv = (fn, arg) => page.evaluate(fn, arg);

try {
  await page.goto('http://127.0.0.1:4173/?debug'); await page.getByText('Neue Wand einrichten').first().waitFor({ timeout: 15000 });
  ok('App startet ohne Wand direkt im Einrichten-Assistenten', true); await shot('01-setup');
  ok('Seite ist isoliert (COOP/COEP)', await cv(() => self.crossOriginIsolated));

  // ---- Einrichten: Foto → Ecken → Prüfen → Speichern → automatische Griff-Erkennung ----
  await page.locator('.wiz input[type=file]').first().setInputFiles(photo);
  const canvas = page.locator('canvas[aria-label="Bild mit Wandecken"]'); await canvas.waitFor({ timeout: 30000 });
  const box = await canvas.boundingBox(); const iw = 2268, ih = 4032, s = Math.min(box.width / iw, box.height / ih), ox = (box.width - iw * s) / 2, oy = (box.height - ih * s) / 2;
  for (const [fx, fy] of [[28, 262], [1088, 256], [1116, 1546], [12, 1546]]) await page.mouse.click(box.x + ox + (fx / 1125) * iw * s, box.y + oy + (fy / 2000) * ih * s);
  await shot('02-corners'); await btn('Weiter', { exact: true }).click(); await page.locator('canvas[aria-label="Entzerrte Wand"]').waitFor(); await page.waitForTimeout(700); await shot('03-rectified');
  await page.fill('#n', 'Kilter-Testwand'); await btn('Speichern & Griffe erkennen').click();
  await page.getByText(/\d+ Griffe erkannt/).first().waitFor({ timeout: 90000 });
  const n0 = await cv(() => window.__cv.editor.work.length); ok('Nach dem Speichern startet die Griff-Erkennung automatisch (380–560)', n0 > 380 && n0 < 560, `${n0} Griffe`);
  ok('Danach ist der Griffe-Modus aktiv', await cv(() => window.__cv.app.mode) === 'edit'); await page.waitForTimeout(600); await shot('04-edit');
  const susp = await cv(() => window.__cv.editor.suspicious().length); ok('Fragwürdige Griffe werden markiert', susp > 0, `${susp} markiert`);

  // ---- Editor per echter Maus ----
  const mapBox = await page.locator('.stage canvas').first().boundingBox();
  const pickHold = await cv(() => { const e = window.__cv.editor; const h = e.work.find((x) => Math.abs(x.schwerpunkt[0] - 0.5) < 0.06 && Math.abs(x.schwerpunkt[1] - 0.5) < 0.06) ?? e.work[100]; return { id: h.id, u: h.schwerpunkt[0], v: h.schwerpunkt[1] }; });
  const [px, py] = await cv(({ u, v }) => window.__cv.app.stageApi.project(u, v), pickHold);
  await page.mouse.click(mapBox.x + px, mapBox.y + py);
  ok('Klick auf einen Griff wählt ihn aus', await cv(() => [...window.__cv.editor.selected].length) === 1);
  await page.keyboard.press('Delete'); ok('Entf löscht den gewählten Griff', await cv(() => window.__cv.editor.work.length) === n0 - 1);
  await btn('Hinzufügen').click(); await page.mouse.click(mapBox.x + px, mapBox.y + py); await page.waitForTimeout(300);
  ok('Werkzeug „Hinzufügen“: Klick auf die Lücke erzeugt den Griff per Zauberstab neu', await cv(() => window.__cv.editor.work.length) === n0, `${await cv(() => window.__cv.editor.work.length)} Griffe`);
  await btn('Auswählen').click(); await page.mouse.move(mapBox.x + 40, mapBox.y + 40); await page.mouse.down(); await page.mouse.move(mapBox.x + 400, mapBox.y + 300, { steps: 6 }); await page.mouse.up();
  const marq = await cv(() => window.__cv.editor.selected.size); ok('Aufziehen auf leerer Fläche markiert mehrere Griffe (Bereichsauswahl)', marq > 3, `${marq} gewählt`);
  await page.keyboard.press('Control+z'); await page.keyboard.press('Control+z'); await page.keyboard.press('Escape');
  await btn('Prüfen').click(); ok('„Prüfen“ springt zum nächsten fragwürdigen Griff', await cv(() => window.__cv.editor.selected.size) === 1); await page.waitForTimeout(400); await shot('05-edit-check');

  // ---- Live: Videodatei öffnen → automatische Ausrichtung (keine Klicks) ----
  await page.keyboard.press('Escape'); await page.keyboard.press('1');
  ok('Moduswechsel setzt die Ansicht zurück (kein Zoom)', await cv(() => window.__cv.app.stageApi.zoom()) === 1, `Zoom ${await cv(() => window.__cv.app.stageApi.zoom())}, Modus ${await cv(() => window.__cv.app.mode)}`);
  await cv(() => { window.__cv.app.registration = { ampel: 'unbekannt', h: null, quality: null }; });
  await page.locator('aside input[type=file][accept="video/*"]').setInputFiles(video);
  await page.waitForFunction(() => window.__cv.app.registration.ampel !== 'unbekannt', null, { timeout: 60000 });
  const reg = await cv(() => ({ a: window.__cv.app.registration.ampel, q: window.__cv.app.registration.quality, info: window.__cv.live.regInfo }));
  ok('Automatische Ausrichtung ohne Ecken-Klicks (Kamera = Setup-Position)', reg.a === 'gruen', reg.info);
  await page.waitForTimeout(1200); await shot('06-live-preview');
  const px2 = await page.evaluate(() => { const c = document.querySelector('.stage canvas'); const g = c.getContext('2d'); const d = g.getImageData(c.width / 2, c.height / 2, 40, 40).data; let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2]; return s / (d.length / 4) / 3; });
  ok('Live-Bild wird entzerrt in die Wandkarte gerendert (Pixel nicht leer)', px2 > 15, `Mittelwert ${px2.toFixed(0)}`);

  // ---- Start: Modelle werden automatisch geladen ----
  await btn('Starten').click();
  await page.waitForFunction(() => window.__cv.app.live === true, null, { timeout: 180000 });
  ok('„Starten“ lädt fehlende Modelle automatisch und startet die Erkennung', true);
  block = true; extAt = external.length;   // ab hier: kein Zugriff nach außen
  await page.waitForFunction(() => (window.__cv.app.stats?.poseHz ?? 0) > 0, null, { timeout: 90000 });
  await page.waitForTimeout(4500); await shot('07-live');
  const hud = await cv(() => ({ s: window.__cv.app.stats, st: window.__cv.app.output?.status }));
  ok('Pose-Rate > 0 Hz', hud.s.poseHz > 0, `${hud.s.poseHz.toFixed(1)} Hz, ${hud.s.poseMs.toFixed(0)} ms`); ok('Person wird verfolgt', hud.st === 'verfolgt', String(hud.st));
  // Person per Klick auf die Wand sperren
  await page.keyboard.press('l'); const liveBox = await page.locator('.stage canvas').first().boundingBox(); const pb = await cv(() => { const sk = window.__cv.app.output?.skeleton ?? []; const p = [11, 12, 0, 13, 14, 23].map((i) => sk[i]).find((q) => q && q.u > 0.03 && q.u < 0.97 && q.v > 0.03 && q.v < 0.97); return p ? { u: p.u, v: p.v } : null; });
  if (pb) { const [lx, ly] = await cv(({ u, v }) => window.__cv.app.stageApi.project(u, v), pb); const hit = await page.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return e ? `${e.tagName}.${e.className}` : 'null'; }, [liveBox.x + lx, liveBox.y + ly]); void hit;
    await page.mouse.click(liveBox.x + lx, liveBox.y + ly); await page.waitForTimeout(1500); ok('Person sperren per Klick auf die Wand', await cv(() => window.__cv.app.output?.locked) === true, JSON.stringify(await cv(() => ({ arm: window.__cv.live.armLock, st: window.__cv.app.output?.status })))); } else ok('Person sperren per Klick auf die Wand', false, 'kein Skelett');
  await btn('Stoppen').click(); await page.getByText(/Session gespeichert/).waitFor({ timeout: 20000 }); ok('Aufnahme wird beim Stoppen gespeichert', true);

  // ---- Aufnahmen ----
  await page.keyboard.press('3'); await page.locator('aside button', { hasText: 'Kontakte' }).first().click(); await page.waitForTimeout(800); await shot('08-replay');
  ok('Aufnahmen: Replay geladen', await page.locator('input[aria-label="Zeitleiste"]').isEnabled());

  // ---- Datenschutz ----
  const probe = await cv(async () => {
    const code = await (await fetch('/workers/mediapipe.worker.js')).text();
    const w = new Worker(URL.createObjectURL(new Blob([code + ";self.fetch('https://odml.pa.googleapis.com/v1/log',{method:'POST',body:'x'}).catch(()=>self.postMessage({type:'fetch-rejected'}));try{const x=new XMLHttpRequest();x.open('POST','https://odml.pa.googleapis.com/v1/log');}catch(e){self.postMessage({type:'xhr-rejected'});}"])));
    const m = []; w.onmessage = (e) => m.push(e.data.type); await new Promise((r) => setTimeout(r, 1200)); w.terminate(); return m;
  });
  ok('Netzwerkwächter wehrt fetch und XHR ab (Probe)', probe.includes('fetch-rejected') && probe.includes('xhr-rejected'), probe.join(','));
  ok('Keine externen Anfragen während der Erkennung (auch keine Bibliotheks-Telemetrie)', external.length === extAt, `extern: ${[...new Set(external.slice(extAt))].join(', ') || 'keine'}`);
  await shot('09-final');
  const bad = errors.filter((e) => !/favicon/.test(e)); ok('Keine Konsolenfehler', bad.length === 0, bad.slice(0, 3).join(' || ').slice(0, 300));
} catch (e) {
  ok('E2E-Ablauf', false, String(e.message).split('\n')[0]); await shot('99-fehler').catch(() => {});
  console.log('Konsolenfehler:', errors.slice(0, 5).join(' || ')); console.log('Alle Toasts:', JSON.stringify(await page.evaluate(() => window.__toasts).catch(() => [])));
}
finally { await browser.close(); srv.kill(); }
fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(results, null, 1));
console.log(`\nScreenshots: ${out}`); process.exit(results.every((r) => r.ok) ? 0 : 1);
