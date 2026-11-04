// E2E-Test im echten Chromium (Playwright). Nutzt testdata/wall-example.jpg (lokal, nicht im Repo) und erzeugt ein Test-Video per ffmpeg.
// Aufruf: npm run build && npm run e2e   (benötigt Netz NUR für den einmaligen Modell-Download)
import { createRequire } from 'node:module';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
const { chromium } = createRequire(import.meta.url)('playwright');
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const out = process.env.E2E_OUT ?? fs.mkdtempSync(path.join(os.tmpdir(), 'cv-e2e-'));
fs.mkdirSync(out, { recursive: true });
const photo = path.join(root, 'testdata/wall-example.jpg');
const bus = process.env.E2E_PERSON_IMG ?? path.join(root, 'bench/web/fixtures/bus.jpg');
const results = []; const ok = (n, c, d = '') => { results.push({ n, ok: !!c, d }); console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? '  – ' + d : ''}`); };
if (!fs.existsSync(photo)) { console.log('SKIP: testdata/wall-example.jpg fehlt'); process.exit(0); }

// Test-Video: Wandfoto (Hochformat) + bewegte Personen-Fotomontage → Pose-Pipeline hat etwas zu finden
const video = path.join(out, 'wall.webm');
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-loop', '1', '-framerate', '15', '-t', '6', '-i', photo, '-loop', '1', '-framerate', '15', '-t', '6', '-i', bus,
  '-filter_complex', "[0:v]scale=720:1280[bg];[1:v]scale=330:-1[fg];[bg][fg]overlay=x='30+t*45':y=760", '-c:v', 'libvpx', '-b:v', '2M', '-pix_fmt', 'yuv420p', video]);

const srv = spawn('npx', ['vite', 'preview', '--port', '4173', '--strictPort'], { cwd: root, stdio: 'ignore' });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 50; i++) { try { if ((await fetch('http://127.0.0.1:4173/')).ok) break; } catch { /* warten */ } await wait(200); }

const browser = await chromium.launch({ args: ['--enable-features=SharedArrayBuffer'] });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 950 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const errors = [], external = [];
let block = false;
page.on('console', (m) => { if (m.type() === 'error' && !/^INFO:|XNNPACK|favicon/.test(m.text())) errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
await ctx.route('**/*', (r) => { const u = new URL(r.request().url()); if (['127.0.0.1', 'localhost'].includes(u.hostname) || u.protocol === 'blob:' || u.protocol === 'data:') return r.continue(); external.push(u.hostname + (block ? ' [GEBLOCKT]' : '')); if (block) console.log('  EXTERN:', r.request().method(), r.request().url().slice(0, 160), r.request().resourceType(), 'frame=' + (r.request().frame()?.url() ?? '?').slice(0, 60), 'body=' + (r.request().postData()?.length ?? 0) + ' B'); return block ? r.abort() : r.continue(); });
const shot = async (n) => page.screenshot({ path: path.join(out, n + '.png') });
const click = (name) => page.getByRole('button', { name }).first().click();

try {
  await page.goto('http://127.0.0.1:4173/?debug'); await page.getByText('Start & Setup').first().waitFor({ timeout: 15000 });
  ok('App startet, isoliert (COOP/COEP)', await page.evaluate(() => self.crossOriginIsolated)); await shot('01-start');

  // ---- Wizard mit deinem Foto ----
  await click('Neue Wand einrichten');
  await page.locator('input[type=file]').first().setInputFiles(photo);
  const canvas = page.locator('canvas[aria-label="Bild mit Wandecken"]'); await canvas.waitFor({ timeout: 30000 });
  const box = await canvas.boundingBox(); const iw = 2268, ih = 4032, s = Math.min(box.width / iw, box.height / ih), ox = (box.width - iw * s) / 2, oy = (box.height - ih * s) / 2;
  for (const [fx, fy] of [[28, 262], [1088, 256], [1116, 1546], [12, 1546]]) await page.mouse.click(box.x + ox + (fx / 1125) * iw * s, box.y + oy + (fy / 2000) * ih * s);
  await shot('02-corners');
  await click('Weiter: Entzerren'); await page.locator('canvas.rect').waitFor(); await page.waitForTimeout(700); await shot('03-rectified');
  const aspekt = await page.locator('#a').inputValue(); ok('Entzerrung: Seitenverhältnis geschätzt', Number(aspekt) > 0.7 && Number(aspekt) < 1.0, 'B/H = ' + aspekt);
  await page.fill('#n', 'Kilter-Testwand'); await click('Weiter'); await click('Wandprofil speichern');
  await page.getByText('Griffe automatisch erkennen').waitFor({ timeout: 20000 });

  // ---- Scan ----
  const t0 = Date.now(); await click('Griffe automatisch erkennen');
  await page.getByText(/Griffe in .* s erkannt/).first().waitFor({ timeout: 90000 });
  const info = await page.getByText(/Griffe in .* s erkannt/).first().innerText(); const n = Number(info.match(/(\d+) Griffe/)[1]);
  ok('Scan im Worker: 380–560 Griffe', n > 380 && n < 560, `${n} Griffe, ${((Date.now() - t0) / 1000).toFixed(1)} s inkl. UI`);
  await page.waitForTimeout(800); await shot('04-scan');

  // ---- Editor: Griff löschen + Rückgängig ----
  const before = await page.getByText(/^\d+ Griffe · Median/).innerText();
  const mb = await page.locator('canvas[aria-label="Griff-Editor"]').boundingBox();
  await page.mouse.click(mb.x + mb.width / 2, mb.y + mb.height / 2); await page.keyboard.press('Delete');
  const after = await page.getByText(/^\d+ Griffe · Median/).innerText();
  ok('Editor: Auswahl + Entf löscht einen Griff', Number(before.match(/^(\d+)/)[1]) - Number(after.match(/^(\d+)/)[1]) === 1, `${before.split(' ·')[0]} → ${after.split(' ·')[0]}`);
  await page.keyboard.press('Control+z'); const undone = await page.getByText(/^\d+ Griffe · Median/).innerText();
  ok('Editor: Strg+Z stellt wieder her', undone.split(' ·')[0] === before.split(' ·')[0]);

  // ---- Modelle laden (einmaliger Download) ----
  await page.keyboard.press('1'); await page.getByText('Modelle (einmaliger Download)').waitFor();
  const row = (name) => page.locator('section', { hasText: 'Modelle (einmaliger Download)' }).locator('.row', { hasText: name });
  await row('Pose Lite').getByRole('button', { name: 'Herunterladen' }).click(); await row('Pose Lite').getByText('gespeichert').waitFor({ timeout: 120000 });
  await row('Hand-Landmarker').getByRole('button', { name: 'Herunterladen' }).click(); await row('Hand-Landmarker').getByText('gespeichert').waitFor({ timeout: 120000 });
  ok('Modelle geladen, SHA-256 stimmt (keine Warnung)', !(await page.getByText('Prüfsumme weicht').count()));
  await shot('05-models');

  // ---- Ab hier: Netz nach außen gesperrt (Offline-Betrieb) ----
  block = true; const extBefore = external.length;

  // ---- Live: Video öffnen, registrieren, starten ----
  await page.keyboard.press('2'); await page.locator('input[type=file][accept="video/*"]').setInputFiles(video);
  await page.getByText(/Quelle aktiv/).waitFor({ timeout: 20000 });
  // Nach dem Setup gilt die Aufstellung als registriert – für den Test bewusst zurücksetzen, damit wirklich der Bildabgleich geprüft wird
  await page.evaluate(() => { window.__cv.app.registration = { ampel: 'unbekannt', h: null, quality: null }; });
  ok('Vor der Registrierung: Start gesperrt', await page.getByText(/noch nicht registriert/).count() > 0);
  await click('Wand registrieren'); await page.getByRole('dialog', { name: 'Wand registrieren' }).waitFor({ timeout: 20000 }); await page.waitForTimeout(600); await shot('06-register-dialog');
  await page.getByRole('dialog').getByRole('button', { name: 'Registrieren' }).click();
  await page.waitForFunction(() => window.__cv.live.regPhase === 'aus' && window.__cv.app.registration.ampel !== 'unbekannt', null, { timeout: 60000 });
  const reg = await page.evaluate(() => ({ a: window.__cv.app.registration.ampel, q: window.__cv.app.registration.quality, info: window.__cv.live.regInfo }));
  ok('Registrierung (Bildabgleich) auf identischer Aufstellung: grün', reg.a === 'gruen', reg.info);
  await click('Starten');
  await page.getByText(/^Pose$/).waitFor(); await page.waitForFunction(() => { const el = [...document.querySelectorAll('.kv span')].find((s) => s.textContent === 'Pose'); const v = el?.nextElementSibling?.textContent ?? ''; return /^[1-9]\d*(\.\d+)? Hz/.test(v.trim()); }, null, { timeout: 90000 });
  const hud = await page.locator('.kv.mono').innerText(); ok('Live-Engine läuft: Pose-Rate > 0 Hz', true, hud.replace(/\n+/g, ' | ').slice(0, 160));
  await page.waitForTimeout(3500); await shot('07-live');
  const track = await page.locator('section', { hasText: 'Tracking-Status' }).innerText(); ok('Person-Tracking meldet Status', /Person/.test(track), track.replace(/\n+/g, ' | ').slice(0, 120));
  await click('Stoppen'); await page.getByText(/Session gespeichert/).waitFor({ timeout: 20000 }); ok('Session gespeichert', true);

  // ---- Sessions ----
  await page.keyboard.press('4'); await page.locator('.item .open').first().click(); await page.waitForTimeout(800); await shot('08-sessions');
  ok('Sessions: Replay geladen', await page.locator('input[aria-label="Zeitleiste"]').count() === 1);

  // ---- ESP32 (virtuell) ----
  await page.keyboard.press('5'); await click('Verbinden'); await page.getByText('Virtueller ESP32', { exact: true }).waitFor({ timeout: 8000 });
  await click('Automatisch (Serpentine)'); await page.waitForTimeout(500); await click('Testmuster starten'); await page.waitForTimeout(1500); await shot('09-esp32');
  const logTxt = await page.locator('.logbox').innerText(); ok('Virtueller ESP32 empfängt Nachrichten (hello/cfg/state)', /"t":"hello"/.test(logTxt) && /"t":"s"/.test(logTxt) || /"t":"cfg"/.test(logTxt), logTxt.slice(0, 120).replace(/\n/g, ' '));
  await page.keyboard.press('6'); await page.waitForTimeout(300); await shot('10-settings');

  // Wächter-Probe: dieselbe Worker-Datei mit einem absichtlichen Telemetrie-Versuch (fetch + XHR) → muss abgewehrt werden und darf das Netz nie erreichen
  const probe = await page.evaluate(async () => {
    const code = await (await fetch('/workers/mediapipe.worker.js')).text();
    const w = new Worker(URL.createObjectURL(new Blob([code + ";self.fetch('https://odml.pa.googleapis.com/v1/log',{method:'POST',body:'x'}).catch(()=>self.postMessage({type:'fetch-rejected'}));try{const x=new XMLHttpRequest();x.open('POST','https://odml.pa.googleapis.com/v1/log');}catch(e){self.postMessage({type:'xhr-rejected'});}"])));
    const m = []; w.onmessage = (e) => m.push(e.data.type); await new Promise((r) => setTimeout(r, 1200)); w.terminate(); return m;
  });
  ok('Netzwerkwächter im Worker wehrt fetch und XHR ab (Probe)', probe.includes('fetch-rejected') && probe.includes('xhr-rejected') && probe.filter((x) => x === 'blocked').length >= 2, probe.join(','));
  const blocked = await page.evaluate(() => window.__cv.app.blockedExternal);
  ok('Keine externen Anfragen nach dem Modell-Download (auch keine Bibliotheks-Telemetrie)', external.length === extBefore, `extern: ${[...new Set(external.slice(extBefore))].join(', ') || 'keine'}; vom Netzwerkwächter abgewehrt: ${blocked.count}${blocked.last ? ' (' + blocked.last + ')' : ''}`);
  const bad = errors.filter((e) => !/favicon/.test(e)); ok('Keine Konsolenfehler', bad.length === 0, bad.slice(0, 3).join(' || ').slice(0, 300));
} catch (e) { ok('E2E-Ablauf', false, String(e.message).split('\n')[0]); await shot('99-fehler').catch(() => {}); console.log('Konsolenfehler:', errors.slice(0, 5).join(' || ')); console.log('Toasts:', JSON.stringify(await page.locator('.toast').allInnerTexts().catch(() => []))); console.log('Zustand:', JSON.stringify(await page.evaluate(() => ({ phase: window.__cv?.live.regPhase, ampel: window.__cv?.app.registration.ampel, busy: window.__cv?.live.busy })).catch(() => null))); }
finally { await browser.close(); srv.kill(); }
fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(results, null, 1));
console.log(`\nScreenshots: ${out}`); process.exit(results.every((r) => r.ok) ? 0 : 1);
