import type { Limb } from '../core/schemas';
export interface LimbRender { holdId: number | null; confidence: number; state: string; evidence: string; candidates?: { holdId: number; score: number; distanceCm: number }[]; ambiguous?: boolean }
export interface RenderState { limbs: Partial<Record<Limb, LimbRender>>; skeleton: ({ u: number; v: number; c: number } | null)[] | null }
export interface WallPointer { type: 'down' | 'move' | 'up' | 'dblclick'; u: number; v: number; shift: boolean; ctrl: boolean; button: number; zoom: number }
