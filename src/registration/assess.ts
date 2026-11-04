/** Bewertung einer Registrierung → Ampel (Startschwellen; nach echten Aufnahmen zu kalibrieren). */
import type { RegistrierungsQualitaet } from '../core/schemas';

export interface AssessInput {
  ncc: number;
  nccVorher: number;
  eckverschiebung: number;
  quadrantNcc: readonly number[];
  griffKontrastNeu: number;
  griffKontrastRef: number;
  konvergiert: boolean;
}

export const THRESH = { gruen: { ncc: 0.6, ecke: 0.02, quad: 3, quadNcc: 0.45, kontrast: 0.6 }, gelb: { ncc: 0.4, ecke: 0.04, quad: 2, quadNcc: 0.3, kontrast: 0.4 } };

export function assessRegistration(i: AssessInput): RegistrierungsQualitaet {
  const hinweise: string[] = [];
  const quadG = i.quadrantNcc.filter((q) => q >= THRESH.gruen.quadNcc).length;
  const quadY = i.quadrantNcc.filter((q) => q >= THRESH.gelb.quadNcc).length;
  const kontrast = i.griffKontrastRef > 1e-6 ? i.griffKontrastNeu / i.griffKontrastRef : 0;
  const grun = i.konvergiert && i.ncc >= THRESH.gruen.ncc && i.eckverschiebung <= THRESH.gruen.ecke && quadG >= THRESH.gruen.quad && kontrast >= THRESH.gruen.kontrast;
  const gelb = i.ncc >= THRESH.gelb.ncc && i.eckverschiebung <= THRESH.gelb.ecke && quadY >= THRESH.gelb.quad && kontrast >= THRESH.gelb.kontrast;
  if (!i.konvergiert) hinweise.push('Ausrichtung konvergierte nicht.');
  if (i.ncc < THRESH.gelb.ncc) hinweise.push('Neues Bild stimmt kaum mit dem Referenzbild überein (Wand verändert oder falsche Ecken?).');
  if (i.eckverschiebung > THRESH.gelb.ecke) hinweise.push('Nachjustierung ist ungewöhnlich groß – Wandecken prüfen.');
  if (quadY < THRESH.gelb.quad) hinweise.push('Übereinstimmung nur in einem Teil der Wand – verdeckt oder verändert?');
  if (kontrast < THRESH.gelb.kontrast) hinweise.push('Griffkonturen liegen nicht auf Bildkanten.');
  if (!grun && gelb) hinweise.push('Registrierung ungenau – Kontakte weniger zuverlässig.');
  const ampel = grun ? 'gruen' : gelb ? 'gelb' : 'rot';
  return { ampel, ncc: i.ncc, eckverschiebung: i.eckverschiebung, quadrantenOk: quadG, griffKontrast: kontrast, hinweise };
}
