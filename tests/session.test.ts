import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { ContactMatcher, type ContactState } from '../src/contact/matcher';
import { LIMBS, type ContactEventDoc, type Limb, type Route, type SessionDoc, type WallProfile } from '../src/core/schemas';
import { N_KP, ReplayEngine, SessionRecorder, buildChunk, decodeChunk, encodeChunk, frameFrom, FRAMES_PER_CHUNK } from '../src/session/recorder';
import { angleDeg, compareToRoute, dynamicShare, holdUsage, leftRight, moveSequence, pathLengthCm, pauses, segmentAttempts, seriesFromReplay, stat, timePerMove } from '../src/session/analysis';
import { eventsCsv, projectZip, readProjectZip, timeseriesCsv } from '../src/export/exporters';
import { Store, openDb } from '../src/storage/db';
import { makeHold } from '../src/holds/editor';
import { makePose } from './helpers';
import { LM } from '../src/pose/landmarks';

const ev = (t: number, limb: Limb, typ: ContactEventDoc['typ'], holdId: number | null, von: number | null = null): ContactEventDoc => ({ t, limb, typ, holdId, vonHoldId: von, score: 0.9, evidenz: 'gesehen' });
const emptyState = (): ContactState => new ContactMatcher([], 1).update(0, []);
const skeleton = (p: ReturnType<typeof makePose>) => p.keypoints.map((k) => ({ u: k.x, v: k.y, c: k.c }));

describe('Recorder / Chunks / Replay', () => {
  it('Chunk-Roundtrip ist bit-genau (Float32/Int16/Uint8), NaN bleibt NaN', () => {
    const cs = emptyState();
    const frames = [0, 33, 66].map((t, i) => frameFrom(t, i === 1 ? null : skeleton(makePose(0.5 + i * 0.01, 0.5)), cs));
    const c = buildChunk(frames);
    const d = decodeChunk(encodeChunk(c));
    expect(d.n).toBe(3);
    expect(Array.from(d.kp.slice(0, N_KP * 3).map((x) => x))).toEqual(Array.from(c.kp.slice(0, N_KP * 3)));
    expect(Number.isNaN(d.kp[N_KP * 3 + 0])).toBe(true); // Frame ohne Skelett
    expect(Array.from(d.t)).toEqual([0, 33, 66]);
    expect(() => decodeChunk(new Uint8Array(32))).toThrow(/Chunk/);
  });
  it('Recorder teilt in Chunks zu FRAMES_PER_CHUNK, Zeiten relativ zum Start, Ereignisse relativ', () => {
    const chunks: number[] = [];
    const rec = new SessionRecorder((c) => chunks.push(c.n));
    const cs = emptyState();
    for (let i = 0; i < FRAMES_PER_CHUNK * 2 + 10; i++) rec.addFrame(5000 + i * 33, null, cs);
    rec.addEvents([{ t: 5100, limb: 'RH', typ: 'start', holdId: 3, vonHoldId: null, score: 1, evidenz: 'gesehen' }]);
    const all = rec.finish();
    expect(chunks).toEqual([FRAMES_PER_CHUNK, FRAMES_PER_CHUNK, 10]); // letzter Teil-Chunk beim Abschluss
    expect(all.length).toBe(3);
    expect(rec.frameCount).toBe(FRAMES_PER_CHUNK * 2 + 10);
    expect(rec.events[0]!.t).toBe(100);
    expect(all[0]!.t0).toBe(0);
  });
  it('Replay: binäre Suche, Scrubbing, Zeitlupe, Einzelbild, Ende stoppt', () => {
    const rec = new SessionRecorder(); const cs = emptyState();
    for (let i = 0; i < 400; i++) rec.addFrame(i * 33, null, cs);
    const rp = new ReplayEngine(rec.finish());
    expect(rp.length).toBe(400);
    expect(rp.indexAt(0)).toBe(0); expect(rp.indexAt(100)).toBe(3); expect(rp.indexAt(1e9)).toBe(399); expect(rp.indexAt(-5)).toBe(0);
    rp.seek(1000); rp.playing = true; rp.speed = 0.25; rp.tick(400);
    expect(rp.position).toBeCloseTo(1100, 5);
    rp.speed = 1; rp.tick(1e9);
    expect(rp.playing).toBe(false); expect(rp.position).toBe(rp.durationMs);
    rp.seek(990); const a = rp.stepFrame(1)!, b = rp.stepFrame(-2)!;
    expect(a.t).toBeGreaterThan(b.t);
    expect(rp.frame(-1)).toBeNull();
  });
  it('Speicherbedarf: 1 h bei 15 Hz < 30 MB (Messung)', () => {
    const f = frameFrom(0, null, emptyState());
    const per = encodeChunk(buildChunk([f])).byteLength - 16;
    expect(per * 15 * 3600).toBeLessThan(30e6);
  });
});

describe('Auswertung', () => {
  const events: ContactEventDoc[] = [
    ev(0, 'LH', 'start', 1), ev(0, 'RH', 'start', 2), ev(500, 'LF', 'start', 10), ev(600, 'RF', 'start', 11),
    ev(3000, 'RH', 'wechsel', 3, 2), ev(3500, 'LH', 'ende', null), ev(4000, 'LH', 'start', 4), ev(9000, 'RF', 'ende', null),
  ];
  it('Zugfolge, Zeit pro Zug, Pausen', () => {
    const m = moveSequence(events);
    expect(m.map((x) => `${x.limb}${x.holdId}`)).toEqual(['LH1', 'RH2', 'LF10', 'RF11', 'RH3', 'LH4']);
    expect(timePerMove(m)).toEqual([0, 500, 100, 2400, 1000]);
    expect(pauses(m, 2000)).toEqual([{ von: 600, bis: 3000, dauerMs: 2400 }]);
  });
  it('Griff-Nutzung inkl. offener Kontakte, Links/Rechts', () => {
    const u = holdUsage(events, 10000);
    expect(u.find((x) => x.holdId === 11)!.ms).toBe(8400);
    expect(u.find((x) => x.holdId === 2)!.limbs.RH).toBe(3000);
    expect(u.find((x) => x.holdId === 3)!.ms).toBe(7000);
    const lr = leftRight(u);
    expect(lr.links + lr.rechts).toBeGreaterThan(0);
    expect(lr.anteilLinks).toBeGreaterThan(0); expect(lr.anteilLinks).toBeLessThan(1);
    expect(leftRight([]).anteilLinks).toBe(0.5);
  });
  it('Winkel (rechter, gestreckt, spitz) und Statistik', () => {
    expect(angleDeg({ u: 0, v: 0 }, { u: 1, v: 0 }, { u: 2, v: 0 })).toBeCloseTo(180, 6);
    expect(angleDeg({ u: 1, v: 1 }, { u: 0, v: 0 }, { u: 1, v: 0 })).toBeCloseTo(45, 6);
    expect(angleDeg({ u: 0, v: 0 }, { u: 0, v: 0 }, { u: 1, v: 0 })).toBeNaN();
    expect(stat([1, NaN, 3]).mean).toBe(2);
    expect(stat([]).n).toBe(0);
  });
  it('Zeitreihen aus Replay: Hüftbahn, Spannweite, dynamisch/statisch', () => {
    const rec = new SessionRecorder(); const cs = emptyState();
    for (let i = 0; i < 90; i++) {
      const hy = 0.5 - (i < 45 ? 0 : (i - 45) * 0.004); // erst Stillstand, dann Aufstieg
      rec.addFrame(i * 33, skeleton(makePose(0.5, hy, 0.2)), cs);
    }
    const rp = new ReplayEngine(rec.finish());
    const s = seriesFromReplay(rp, 1.25, 240);
    expect(s.hip.length).toBe(90);
    expect(pathLengthCm(s.hip, 240)).toBeCloseTo(44 * 0.004 * 240, 0);
    expect(stat(s.span).mean).toBeCloseTo(0.8 * 0.2 * 1.25 * 240, 0);
    expect(stat(s.elbowL).n).toBe(90);
    const d = dynamicShare(s, 240, 25);
    expect(d.dynamisch).toBeGreaterThan(0.3); expect(d.dynamisch).toBeLessThan(0.7);
    expect(d.dynamisch + d.statisch).toBeCloseTo(1, 9);
  });
  const route: Route = { schemaVersion: 1, typ: 'Route', id: 'r', wandId: 'w', name: 'Test', griffe: [{ holdId: 1, rolle: 'start' }, { holdId: 2, rolle: 'start' }, { holdId: 3, rolle: 'hand', reihenfolge: 1 }, { holdId: 20, rolle: 'top' }, { holdId: 21, rolle: 'top' }], zugfolge: [] };
  it('Versuche: Start an Startgriffen, Ende am Top; Sturz nach Freizeit; Abbruch', () => {
    const ok = [ev(0, 'LH', 'start', 1), ev(100, 'RH', 'start', 2), ev(2000, 'RH', 'wechsel', 3, 2), ev(4000, 'LH', 'wechsel', 20, 1), ev(5000, 'RH', 'wechsel', 21, 3)];
    const a = segmentAttempts(ok, route, 6000);
    expect(a).toEqual([{ startMs: 100, endMs: 5000, ende: 'top', zuege: 3 }]);
    const fall = [ev(0, 'LH', 'start', 1), ev(100, 'RH', 'start', 2), ev(2000, 'RH', 'wechsel', 3, 2), ev(3000, 'RH', 'ende', null), ev(3050, 'LH', 'ende', null)];
    const b = segmentAttempts(fall, route, 8000);
    expect(b[0]!.ende).toBe('sturz');
    const c = segmentAttempts(ok.slice(0, 3), route, 2500);
    expect(c[0]!.ende).toBe('abbruch');
    const two = [...ok, ev(6000, 'LH', 'ende', null), ev(6000, 'RH', 'ende', null), ev(9000, 'LH', 'start', 1), ev(9100, 'RH', 'start', 2)];
    expect(segmentAttempts(two, route, 10000).length).toBe(2);
    expect(segmentAttempts([], route, 1000)).toEqual([]);
  });
  it('Soll-/Ist-Abgleich', () => {
    const r2: Route = { ...route, zugfolge: [{ limb: 'LH', holdId: 1 }, { limb: 'RH', holdId: 2 }, { limb: 'RH', holdId: 3 }, { limb: 'LH', holdId: 20 }] };
    const moves = moveSequence([ev(0, 'LH', 'start', 1), ev(100, 'RH', 'start', 2), ev(200, 'LF', 'start', 99), ev(2000, 'RH', 'wechsel', 3, 2)]);
    const r = compareToRoute(moves, r2);
    expect(r.getroffen).toBe(3); expect(r.soll).toBe(4);
    expect(r.fehlend).toEqual([{ limb: 'LH', holdId: 20 }]);
    expect(r.zusaetzlich).toEqual([99]);
    expect(r.anteil).toBe(0.75);
  });
});

describe('Export', () => {
  it('Ereignis-CSV: Kopf, Zeilen, Quoting', () => {
    const csv = eventsCsv([ev(12.4, 'LH', 'start', 7)]);
    expect(csv.split('\n')[0]).toBe('t_ms,gliedmasse,typ,griff,von_griff,score,evidenz');
    expect(csv.split('\n')[1]).toBe('12,LH,start,7,,0.900,gesehen');
  });
  it('Zeitreihen-CSV hat 1 + N Zeilen und 1 + 99 + 8 Spalten', () => {
    const rec = new SessionRecorder(); const cs = emptyState();
    for (let i = 0; i < 5; i++) rec.addFrame(i * 33, skeleton(makePose(0.5, 0.5)), cs);
    const csv = timeseriesCsv(new ReplayEngine(rec.finish()));
    const lines = csv.trim().split('\n');
    expect(lines.length).toBe(6);
    expect(lines[0]!.split(',').length).toBe(1 + N_KP * 3 + 8);
    expect(lines[1]!.split(',').length).toBe(1 + N_KP * 3 + 8);
  });
  it('Projekt-ZIP: Roundtrip aller Teile', () => {
    const profile = { schemaVersion: 1, typ: 'WallProfile', id: 'w1', name: 'Wand' } as unknown as WallProfile;
    const holds = { schemaVersion: 1, typ: 'Holds', wandId: 'w1', erstellt: 'x', griffe: [makeHold(1, [[0, 0], [1, 0], [1, 1]], 'auto', 1)] } as const;
    const session = { schemaVersion: 1, typ: 'Session', id: 's1' } as unknown as SessionDoc;
    const zip = projectZip({ profile, holds: holds as never, routes: [], sessions: [session], blobs: { 'w1:ref': new Uint8Array([1, 2, 3]) }, chunks: { 's1-0': new Uint8Array([9, 9]) } });
    const r = readProjectZip(zip);
    expect((r.json('wallprofile.json') as { id: string }).id).toBe('w1');
    expect((r.json('holds.json') as { griffe: unknown[] }).griffe.length).toBe(1);
    expect(Array.from(r.files['blobs/w1:ref']!)).toEqual([1, 2, 3]);
    expect(r.files['chunks/s1-0.bin']).toBeDefined();
    expect(() => r.json('fehlt.json')).toThrow(/fehlt/);
  });
});

describe('Speicher (IndexedDB)', () => {
  const profile = (id: string): WallProfile => ({
    schemaVersion: 1, typ: 'WallProfile', id, name: 'Wand ' + id, winkel_grad: 20, aspekt: 1.25,
    ecken_bild: [[0, 0], [1, 0], [1, 1], [0, 1]], homographie: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    referenzfoto: { blobId: `${id}:foto`, breite_px: 10, hoehe_px: 10 }, referenz_entzerrt: { blobId: `${id}:rect`, breite_px: 10, hoehe_px: 10 },
    aruco_ids: [], registrierung: { anker: [], letzte_qualitaet: null }, erstellt: '2026-01-01T00:00:00Z', geaendert: '2026-01-02T00:00:00Z',
  });
  it('Profil/Griffe/Routen/Sessions/Chunks/Blobs: speichern, laden, listen, duplizieren, löschen', async () => {
    const db = await openDb('test-' + Math.random()); const st = new Store(db);
    await st.putProfile(profile('a')); await st.putBlob('a:foto', 'image/jpeg', new Uint8Array([1, 2])); await st.putBlob('a:rect', 'image/jpeg', new Uint8Array([3]));
    await st.putHolds({ schemaVersion: 1, typ: 'Holds', wandId: 'a', erstellt: 'x', griffe: [makeHold(1, [[0, 0], [1, 0], [1, 1]], 'auto', 1)] });
    await st.putRoute({ schemaVersion: 1, typ: 'Route', id: 'r1', wandId: 'a', name: 'R', griffe: [], zugfolge: [] });
    await st.putChunk('s1-0', new Uint8Array([7, 7, 7]));
    await st.putSession({ schemaVersion: 1, typ: 'Session', id: 's1', wandId: 'a', wand_snapshot: { homographie: [1, 0, 0, 0, 1, 0, 0, 0, 1], aspekt: 1.25, griffe_anzahl: 1, qualitaet: null }, kamera_kalibrierung: { quelle: 'x', breite_px: 1, hoehe_px: 1, fps: null }, modell: { pose: 'lite', hand: null }, start: '2026-02-01T00:00:00Z', dauer_ms: 1, chunkIds: ['s1-0'], events: [], einstellungen: {} });
    expect((await st.getProfile('a'))!.name).toBe('Wand a');
    expect((await st.getHolds('a'))!.griffe.length).toBe(1);
    expect((await st.listRoutes('a')).length).toBe(1);
    expect(Array.from((await st.getChunk('s1-0'))!)).toEqual([7, 7, 7]);
    const dup = await st.duplicateProfile('a', 'b', 'Kopie');
    expect(dup.name).toBe('Kopie');
    expect((await st.getHolds('b'))!.wandId).toBe('b');
    expect(Array.from((await st.getBlob(dup.referenzfoto.blobId))!.data)).toEqual([1, 2]);
    expect((await st.listProfiles()).length).toBe(2);
    expect(await st.estimateBytes()).toBeGreaterThan(0);
    await st.setSetting('x', { a: 1 }); expect(await st.getSetting('x', null)).toEqual({ a: 1 }); expect(await st.getSetting('y', 5)).toBe(5);
    await st.deleteProfile('a');
    expect(await st.getProfile('a')).toBeUndefined();
    expect(await st.getSession('s1')).toBeUndefined();
    expect(await st.getChunk('s1-0')).toBeUndefined();
    expect((await st.listProfiles()).map((p) => p.id)).toEqual(['b']);
  });
  it('lehnt Dokumente aus neuerer Version ab (nicht still lesen)', async () => {
    const db = await openDb('test-' + Math.random()); const st = new Store(db);
    await db.put('profiles', { ...profile('z'), schemaVersion: 99 } as never);
    await expect(st.getProfile('z')).rejects.toThrow(/neueren Version/);
  });
});

void LIMBS; void LM;
