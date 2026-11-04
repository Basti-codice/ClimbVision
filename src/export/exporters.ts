/** Exporte: JSON, CSV, ZIP (fflate). Screenshot/Overlay-Video laufen in der UI (Canvas). */
import { zipSync, strToU8, unzipSync, strFromU8 } from 'fflate';
import { LIMBS, type ContactEventDoc, type HoldsFile, type Route, type SessionDoc, type WallProfile } from '../core/schemas';
import type { ReplayEngine } from '../session/recorder';
import { N_KP } from '../session/recorder';

const q = (v: unknown): string => { const s = String(v ?? ''); return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const row = (cells: unknown[]): string => cells.map(q).join(',');

export function eventsCsv(events: readonly ContactEventDoc[]): string {
  return [row(['t_ms', 'gliedmasse', 'typ', 'griff', 'von_griff', 'score', 'evidenz']), ...events.map((e) => row([Math.round(e.t), e.limb, e.typ, e.holdId ?? '', e.vonHoldId ?? '', e.score.toFixed(3), e.evidenz]))].join('\n') + '\n';
}

export function timeseriesCsv(rp: ReplayEngine): string {
  const head = ['t_ms']; for (let i = 0; i < N_KP; i++) head.push(`kp${i}_u`, `kp${i}_v`, `kp${i}_c`);
  for (const l of LIMBS) head.push(`${l}_griff`, `${l}_konf`);
  const lines = [row(head)];
  for (let i = 0; i < rp.length; i++) {
    const f = rp.frame(i); if (!f) continue;
    const c: unknown[] = [Math.round(f.t)];
    for (let k = 0; k < N_KP * 3; k++) { const v = f.kp[k] as number; c.push(Number.isFinite(v) ? v.toFixed(4) : ''); }
    for (let l = 0; l < 4; l++) c.push((f.hold[l] as number) < 0 ? '' : f.hold[l], (f.hold[l] as number) < 0 ? '' : f.conf[l]);
    lines.push(row(c));
  }
  return lines.join('\n') + '\n';
}

export interface ProjectBundle { profile: WallProfile; holds: HoldsFile; routes: Route[]; sessions: SessionDoc[]; blobs: Record<string, Uint8Array>; chunks?: Record<string, Uint8Array> }

/** Projekt-ZIP: Profil, Griffe, Routen, Sessions (JSON), Referenzbilder und Session-Chunks (binär). */
export function projectZip(b: ProjectBundle): Uint8Array {
  const files: Record<string, Uint8Array> = {
    'wallprofile.json': strToU8(JSON.stringify(b.profile, null, 1)),
    'holds.json': strToU8(JSON.stringify(b.holds)),
    'manifest.json': strToU8(JSON.stringify({ app: 'ClimbVision', schemaVersion: 1, erstellt: new Date().toISOString(), routen: b.routes.length, sessions: b.sessions.length })),
  };
  b.routes.forEach((r) => { files[`routes/${r.id}.json`] = strToU8(JSON.stringify(r)); });
  b.sessions.forEach((s) => { files[`sessions/${s.id}.json`] = strToU8(JSON.stringify(s)); });
  for (const [id, data] of Object.entries(b.blobs)) files[`blobs/${id}`] = data;
  for (const [id, data] of Object.entries(b.chunks ?? {})) files[`chunks/${id}.bin`] = data;
  return zipSync(files, { level: 6 });
}
export function readProjectZip(zip: Uint8Array): { files: Record<string, Uint8Array>; json: (name: string) => unknown } {
  const files = unzipSync(zip);
  return { files, json: (name) => { const f = files[name]; if (!f) throw new Error(`Datei fehlt im Projekt: ${name}`); return JSON.parse(strFromU8(f)); } };
}
