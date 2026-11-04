/** Versionierte Datenmodelle. Zod ist die einzige Quelle für Typen, Validierung und JSON-Schema. */
import { z } from 'zod';

export const SCHEMA_VERSION = 1;

const pt = z.tuple([z.number(), z.number()]);
const mat3 = z.tuple([z.number(), z.number(), z.number(), z.number(), z.number(), z.number(), z.number(), z.number(), z.number()]);
const isoDate = z.string();

export const LimbSchema = z.enum(['LH', 'RH', 'LF', 'RF']);
export type Limb = z.infer<typeof LimbSchema>;
export const LIMBS: readonly Limb[] = ['LH', 'RH', 'LF', 'RF'];

export const HoldSchema = z.object({
  id: z.number().int().nonnegative(),
  polygon: z.array(pt).min(3),
  schwerpunkt: pt,
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  flaeche: z.number().nonnegative(),
  relative_groesse: z.number().nonnegative(),
  groesse_cm: z.number().positive().optional(),
  tiefe_cm: z.number().nonnegative().default(0),
  notiz: z.string().optional(),
  quelle: z.enum(['auto', 'manuell']),
});
export type Hold = z.infer<typeof HoldSchema>;

export const HoldsFileSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  typ: z.literal('Holds'),
  wandId: z.string(),
  erstellt: isoDate,
  griffe: z.array(HoldSchema),
});
export type HoldsFile = z.infer<typeof HoldsFileSchema>;

export const QualitaetSchema = z.object({
  ampel: z.enum(['gruen', 'gelb', 'rot']),
  ncc: z.number(),
  eckverschiebung: z.number(),
  quadrantenOk: z.number().int(),
  griffKontrast: z.number(),
  hinweise: z.array(z.string()),
});
export type RegistrierungsQualitaet = z.infer<typeof QualitaetSchema>;

export const WallProfileSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  typ: z.literal('WallProfile'),
  id: z.string(),
  name: z.string().min(1),
  winkel_grad: z.number().min(-30).max(90),
  breite_cm: z.number().positive().optional(),
  hoehe_cm: z.number().positive().optional(),
  /** Breite/Höhe der Wand (für isotrope Distanzen). */
  aspekt: z.number().positive(),
  ecken_bild: z.tuple([pt, pt, pt, pt]),
  homographie: mat3,
  referenzfoto: z.object({ blobId: z.string(), breite_px: z.number().int(), hoehe_px: z.number().int() }),
  referenz_entzerrt: z.object({ blobId: z.string(), breite_px: z.number().int(), hoehe_px: z.number().int() }),
  aruco_ids: z.array(z.number().int()).default([]),
  registrierung: z.object({
    anker: z.array(z.object({ u: z.number(), v: z.number() })),
    letzte_qualitaet: QualitaetSchema.nullable(),
  }),
  erstellt: isoDate,
  geaendert: isoDate,
});
export type WallProfile = z.infer<typeof WallProfileSchema>;

export const RouteSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  typ: z.literal('Route'),
  id: z.string(),
  wandId: z.string(),
  name: z.string(),
  griffe: z.array(z.object({ holdId: z.number().int(), rolle: z.enum(['start', 'hand', 'fuss', 'top']), reihenfolge: z.number().int().optional() })),
  zugfolge: z.array(z.object({ limb: LimbSchema, holdId: z.number().int() })).default([]),
});
export type Route = z.infer<typeof RouteSchema>;

export const ContactEventSchema = z.object({
  t: z.number(),
  limb: LimbSchema,
  typ: z.enum(['start', 'ende', 'wechsel']),
  holdId: z.number().int().nullable(),
  vonHoldId: z.number().int().nullable().optional(),
  score: z.number(),
  evidenz: z.enum(['gesehen', 'hand-landmarks', 'nur-pose', 'geschaetzt']),
});
export type ContactEventDoc = z.infer<typeof ContactEventSchema>;

export const SessionSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  typ: z.literal('Session'),
  id: z.string(),
  wandId: z.string(),
  wand_snapshot: z.object({ homographie: mat3, aspekt: z.number(), griffe_anzahl: z.number().int(), qualitaet: QualitaetSchema.nullable() }),
  kamera_kalibrierung: z.object({ quelle: z.string(), breite_px: z.number().int(), hoehe_px: z.number().int(), fps: z.number().nullable() }),
  modell: z.object({ pose: z.string(), hand: z.string().nullable() }),
  start: isoDate,
  dauer_ms: z.number(),
  chunkIds: z.array(z.string()),
  events: z.array(ContactEventSchema),
  einstellungen: z.record(z.string(), z.unknown()),
});
export type SessionDoc = z.infer<typeof SessionSchema>;

export const DOC_SCHEMAS = { Holds: HoldsFileSchema, WallProfile: WallProfileSchema, Route: RouteSchema, Session: SessionSchema } as const;
export type DocTyp = keyof typeof DOC_SCHEMAS;

/** Erzeugt die JSON-Schemas (Zod 4 eingebaut). */
export function jsonSchemas(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, s] of Object.entries(DOC_SCHEMAS)) out[k] = z.toJSONSchema(s);
  return out;
}
