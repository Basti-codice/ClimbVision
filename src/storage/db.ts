/** IndexedDB-Schicht (idb). Alles lokal: Profile, Griffe, Routen, Sessions, Blobs (Fotos/Modelle), Session-Chunks, Einstellungen. */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { migrate } from '../core/migrate';
import type { HoldsFile, Route, SessionDoc, WallProfile } from '../core/schemas';

interface CvDB extends DBSchema {
  profiles: { key: string; value: WallProfile };
  holds: { key: string; value: HoldsFile };
  routes: { key: string; value: Route; indexes: { byWand: string } };
  sessions: { key: string; value: SessionDoc; indexes: { byWand: string } };
  blobs: { key: string; value: { id: string; mime: string; data: ArrayBuffer; sha256?: string } };
  chunks: { key: string; value: ArrayBuffer };
  settings: { key: string; value: unknown };
}
export const DB_NAME = 'climbvision', DB_VERSION = 1;
export type Db = IDBPDatabase<CvDB>;

export function openDb(name = DB_NAME): Promise<Db> {
  return openDB<CvDB>(name, DB_VERSION, {
    upgrade(db) {
      db.createObjectStore('profiles', { keyPath: 'id' });
      db.createObjectStore('holds', { keyPath: 'wandId' });
      db.createObjectStore('routes', { keyPath: 'id' }).createIndex('byWand', 'wandId');
      db.createObjectStore('sessions', { keyPath: 'id' }).createIndex('byWand', 'wandId');
      db.createObjectStore('blobs', { keyPath: 'id' });
      db.createObjectStore('chunks');
      db.createObjectStore('settings');
    },
  });
}

export class Store {
  constructor(private readonly db: Db) {}
  /** Liest ein Dokument, migriert ggf. ältere Versionen und validiert. */
  private async load<T>(store: 'profiles' | 'holds' | 'routes' | 'sessions', key: string): Promise<T | undefined> {
    const raw = await this.db.get(store, key);
    return raw === undefined ? undefined : (migrate(raw).doc as T);
  }
  putProfile(p: WallProfile): Promise<string> { return this.db.put('profiles', p); }
  getProfile(id: string): Promise<WallProfile | undefined> { return this.load('profiles', id); }
  async listProfiles(): Promise<WallProfile[]> { return (await this.db.getAll('profiles')).map((r) => migrate(r).doc as WallProfile).sort((a, b) => b.geaendert.localeCompare(a.geaendert)); }
  async deleteProfile(id: string): Promise<void> {
    await this.db.delete('profiles', id); await this.db.delete('holds', id);
    for (const r of await this.db.getAllFromIndex('routes', 'byWand', id)) await this.db.delete('routes', r.id);
    for (const s of await this.db.getAllFromIndex('sessions', 'byWand', id)) await this.deleteSession(s.id);
  }
  /** Profil duplizieren (inkl. Griffe); Blobs werden mitkopiert. */
  async duplicateProfile(id: string, newId: string, newName: string): Promise<WallProfile> {
    const p = await this.getProfile(id); if (!p) throw new Error('Wandprofil nicht gefunden');
    const copyBlob = async (bid: string): Promise<string> => { const b = await this.db.get('blobs', bid); const nid = `${newId}:${bid.split(':').pop()}`; if (b) await this.db.put('blobs', { ...b, id: nid }); return nid; };
    const np: WallProfile = { ...p, id: newId, name: newName, referenzfoto: { ...p.referenzfoto, blobId: await copyBlob(p.referenzfoto.blobId) }, referenz_entzerrt: { ...p.referenz_entzerrt, blobId: await copyBlob(p.referenz_entzerrt.blobId) }, erstellt: new Date().toISOString(), geaendert: new Date().toISOString() };
    await this.putProfile(np);
    const h = await this.getHolds(id); if (h) await this.putHolds({ ...h, wandId: newId });
    return np;
  }
  putHolds(h: HoldsFile): Promise<string> { return this.db.put('holds', h); }
  getHolds(wandId: string): Promise<HoldsFile | undefined> { return this.load('holds', wandId); }
  putRoute(r: Route): Promise<string> { return this.db.put('routes', r); }
  async listRoutes(wandId: string): Promise<Route[]> { return (await this.db.getAllFromIndex('routes', 'byWand', wandId)).map((r) => migrate(r).doc as Route); }
  deleteRoute(id: string): Promise<void> { return this.db.delete('routes', id); }
  putSession(s: SessionDoc): Promise<string> { return this.db.put('sessions', s); }
  getSession(id: string): Promise<SessionDoc | undefined> { return this.load('sessions', id); }
  async listSessions(wandId?: string): Promise<SessionDoc[]> {
    const all = wandId ? await this.db.getAllFromIndex('sessions', 'byWand', wandId) : await this.db.getAll('sessions');
    return all.map((r) => migrate(r).doc as SessionDoc).sort((a, b) => b.start.localeCompare(a.start));
  }
  async deleteSession(id: string): Promise<void> { const s = await this.db.get('sessions', id); if (s) for (const c of s.chunkIds) await this.db.delete('chunks', c); await this.db.delete('sessions', id); }
  putChunk(id: string, data: Uint8Array): Promise<string> { return this.db.put('chunks', data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer, id); }
  async getChunk(id: string): Promise<Uint8Array | undefined> { const b = await this.db.get('chunks', id); return b ? new Uint8Array(b) : undefined; }
  putBlob(id: string, mime: string, data: Uint8Array, sha256?: string): Promise<string> { return this.db.put('blobs', { id, mime, data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer, ...(sha256 ? { sha256 } : {}) }); }
  async getBlob(id: string): Promise<{ mime: string; data: Uint8Array; sha256?: string } | undefined> { const b = await this.db.get('blobs', id); return b ? { mime: b.mime, data: new Uint8Array(b.data), ...(b.sha256 ? { sha256: b.sha256 } : {}) } : undefined; }
  setSetting(key: string, v: unknown): Promise<string> { return this.db.put('settings', v, key); }
  getSetting<T>(key: string, fallback: T): Promise<T> { return this.db.get('settings', key).then((v) => (v === undefined ? fallback : (v as T))); }
  async estimateBytes(): Promise<number> { let n = 0; for (const b of await this.db.getAll('blobs')) n += b.data.byteLength; for (const k of await this.db.getAllKeys('chunks')) n += (await this.db.get('chunks', k))?.byteLength ?? 0; return n; }
}
