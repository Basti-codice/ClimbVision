/** Setup-Wizard-Logik: Ecken → Homographie → Entzerrung → WallProfile; Registrierung für spätere Sessions. Rein, ohne DOM. */
import { checkCornerQuad, inv3, mul3, wallHomographyFromCorners, type Mat3, type Vec2 } from '../geometry/homography';
import { warpToWall, type Rgba } from '../image/raster';
import type { WallProfile, RegistrierungsQualitaet } from '../core/schemas';
import { selectAnchors } from '../registration/drift';
import { toGray } from '../image/raster';

export const RECT_LONG_EDGE = 1600;

/** Seitenverhältnis (Breite/Höhe) aus den Eckpunkten – grobe Schätzung (frontal angenommen); kann in der UI korrigiert werden. */
export function estimateAspect(corners: readonly Vec2[]): number {
  const d = (a: Vec2, b: Vec2): number => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const [tl, tr, br, bl] = corners as [Vec2, Vec2, Vec2, Vec2];
  const w = (d(tl, tr) + d(bl, br)) / 2, h = (d(tl, bl) + d(tr, br)) / 2;
  return h > 1e-9 ? w / h : 1;
}
/** Seitenverhältnis aus Maßen (cm) hat Vorrang, sonst manueller Wert, sonst Schätzung. */
export function resolveAspect(opt: { breite_cm?: number | undefined; hoehe_cm?: number | undefined; manuell?: number | undefined; geschaetzt: number }): number {
  if (opt.breite_cm && opt.hoehe_cm) return opt.breite_cm / opt.hoehe_cm;
  return opt.manuell && opt.manuell > 0 ? opt.manuell : opt.geschaetzt;
}
export function rectSize(aspekt: number, longEdge = RECT_LONG_EDGE): { w: number; h: number } {
  return aspekt >= 1 ? { w: longEdge, h: Math.max(8, Math.round(longEdge / aspekt)) } : { w: Math.max(8, Math.round(longEdge * aspekt)), h: longEdge };
}

/** Homographie auf NORMALISIERTEN Bildkoordinaten (0..1) → unabhängig von der Auflösung der Quelle. */
export function normalizedHomography(cornersPx: readonly Vec2[], imgW: number, imgH: number): Mat3 {
  return wallHomographyFromCorners(cornersPx.map((c) => [c[0] / imgW, c[1] / imgH] as Vec2));
}
/** Entzerrt ein Bild mit einer auf normalisierten Koordinaten definierten Homographie. */
export function rectify(img: Rgba, hNorm: Mat3, aspekt: number, longEdge = RECT_LONG_EDGE): Rgba {
  const hPx = mul3(hNorm, [1 / img.width, 0, 0, 0, 1 / img.height, 0, 0, 0, 1]);
  const { w, h } = rectSize(aspekt, longEdge);
  return warpToWall(img, hPx, w, h);
}

export interface NewProfileInput {
  id: string; name: string; winkel_grad: number; breite_cm?: number | undefined; hoehe_cm?: number | undefined; aspekt: number;
  image: Rgba; cornersPx: readonly Vec2[]; fotoBlobId: string; rectBlobId: string; now: string;
}
export function createProfile(i: NewProfileInput): { profile: WallProfile; rect: Rgba } {
  const q = checkCornerQuad(i.cornersPx, i.image.width, i.image.height);
  if (!q.ok) throw new Error(q.grund === 'nicht_konvex' ? 'Die vier Ecken bilden kein gültiges Viereck. Bitte die Reihenfolge (links oben, rechts oben, rechts unten, links unten) prüfen.' : q.grund === 'zu_klein' ? 'Das markierte Viereck ist zu klein. Bitte die Wandecken genauer setzen.' : 'Die Ecken sind in falscher Reihenfolge. Bitte im Uhrzeigersinn beginnen: links oben → rechts oben → rechts unten → links unten.');
  const h = normalizedHomography(i.cornersPx, i.image.width, i.image.height);
  const rect = rectify(i.image, h, i.aspekt);
  const profile: WallProfile = {
    schemaVersion: 1, typ: 'WallProfile', id: i.id, name: i.name, winkel_grad: i.winkel_grad,
    ...(i.breite_cm ? { breite_cm: i.breite_cm } : {}), ...(i.hoehe_cm ? { hoehe_cm: i.hoehe_cm } : {}), aspekt: i.aspekt,
    ecken_bild: i.cornersPx.map((c) => [c[0], c[1]] as Vec2) as [Vec2, Vec2, Vec2, Vec2], homographie: h as unknown as WallProfile['homographie'],
    referenzfoto: { blobId: i.fotoBlobId, breite_px: i.image.width, hoehe_px: i.image.height }, referenz_entzerrt: { blobId: i.rectBlobId, breite_px: rect.width, hoehe_px: rect.height },
    aruco_ids: [], registrierung: { anker: [], letzte_qualitaet: null }, erstellt: i.now, geaendert: i.now,
  };
  return { profile, rect };
}

/** Anker für den Live-Drift-Monitor aus dem Referenzbild (außerhalb von Griffen). */
export function anchorsFor(rect: Rgba): { u: number; v: number }[] {
  return selectAnchors(toGray(rect)).map((a) => ({ u: a.u, v: a.v }));
}

/** Kombiniert die Homographie der neuen Ecken mit der Rest-Verschiebung aus der Registrierung. hRes: Template(ref) → neues entzerrtes Bild. */
export function refinedHomography(h0: Mat3, hRes: Mat3): Mat3 { return mul3(inv3(hRes), h0); }

export interface RegistrationVerdict { freigabe: boolean; warnung: boolean; text: string }
export function verdict(q: RegistrierungsQualitaet): RegistrationVerdict {
  if (q.ampel === 'gruen') return { freigabe: true, warnung: false, text: 'Registrierung in Ordnung. Live-Modus freigegeben.' };
  if (q.ampel === 'gelb') return { freigabe: true, warnung: true, text: 'Registrierung ungenau – Kontakte sind weniger zuverlässig. ' + q.hinweise.join(' ') };
  return { freigabe: false, warnung: true, text: 'Die gespeicherte Wand passt nicht zum aktuellen Bild. Bitte Ecken neu markieren oder die Wand neu scannen. ' + q.hinweise.join(' ') };
}
