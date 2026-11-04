/** Modell-Download (einmalig, beim Setup) + lokaler Cache in IndexedDB. Danach vollständig offline. Hash-Prüfung (SHA-256). */
import type { Store } from '../storage/db';

export type ModelId = 'pose_lite' | 'pose_full' | 'pose_heavy' | 'hand';
export interface ModelSpec { id: ModelId; name: string; url: string; bytes: number; sha256: string; hinweis: string }
const B = 'https://storage.googleapis.com/mediapipe-models';
/** URLs sind auf Version „1“ gepinnt; Hashes siehe docs/SOURCES.md (Stand 2026-11-04; Lite wurde gegen /1/ verifiziert, die übrigen gegen „latest“). */
export const MODELS: Record<ModelId, ModelSpec> = {
  pose_lite: { id: 'pose_lite', name: 'Pose Lite', url: `${B}/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task`, bytes: 5777746, sha256: '59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a', hinweis: 'Schnellste Variante (Standard).' },
  pose_full: { id: 'pose_full', name: 'Pose Full', url: `${B}/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task`, bytes: 9398198, sha256: '4eaa5eb7a98365221087693fcc286334cf0858e2eb6e15b506aa4a7ecdcec4ad', hinweis: 'Genauer, ca. 1,5× langsamer.' },
  pose_heavy: { id: 'pose_heavy', name: 'Pose Heavy', url: `${B}/pose_landmarker/pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task`, bytes: 30664242, sha256: '64437af838a65d18e5ba7a0d39b465540069bc8aae8308de3e318aad31fcbc7b', hinweis: 'Nur für Replay/Nachanalyse – im Browser nicht echtzeitfähig.' },
  hand: { id: 'hand', name: 'Hand-Landmarker', url: `${B}/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`, bytes: 7819105, sha256: 'fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1', hinweis: 'Fingerspitzen für genauere Handkontakte.' },
};

export const hex = (b: ArrayBuffer): string => Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, '0')).join('');
export async function sha256(data: Uint8Array): Promise<string> { return hex(await crypto.subtle.digest('SHA-256', data as unknown as BufferSource)); }
const key = (id: ModelId): string => `model:${id}`;

export async function isCached(store: Store, id: ModelId): Promise<boolean> { return !!(await store.getBlob(key(id))); }
export async function loadModel(store: Store, id: ModelId): Promise<ArrayBuffer | null> {
  const b = await store.getBlob(key(id));
  return b ? (b.data.buffer.slice(b.data.byteOffset, b.data.byteOffset + b.data.byteLength) as ArrayBuffer) : null;
}

/** Lädt ein Modell mit Fortschritt, prüft SHA-256 und speichert es. `hashAbweichung` = true, wenn der Hash nicht zum dokumentierten passt. */
export async function downloadModel(store: Store, id: ModelId, onProgress?: (fraction: number) => void, fetchImpl: typeof fetch = fetch): Promise<{ hashAbweichung: boolean; sha256: string }> {
  const spec = MODELS[id];
  let res: Response;
  try { res = await fetchImpl(spec.url); } catch { throw new Error('Das Modell konnte nicht heruntergeladen werden. Bitte Internetverbindung prüfen (nur für diesen einmaligen Schritt nötig).'); }
  if (!res.ok || !res.body) throw new Error(`Modell-Download fehlgeschlagen (HTTP ${res.status}).`);
  const total = Number(res.headers.get('content-length')) || spec.bytes;
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let got = 0;
  for (;;) { const { value, done } = await reader.read(); if (done) break; parts.push(value); got += value.length; onProgress?.(Math.min(1, got / total)); }
  const data = new Uint8Array(got);
  let o = 0;
  for (const p of parts) { data.set(p, o); o += p.length; }
  const h = await sha256(data);
  await store.putBlob(key(id), 'application/octet-stream', data, h);
  onProgress?.(1);
  return { hashAbweichung: h !== spec.sha256, sha256: h };
}
