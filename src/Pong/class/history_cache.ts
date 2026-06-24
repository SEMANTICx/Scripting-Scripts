// ============================================================================
// Short-lived in-memory history cache. Detail charts often request the same
// node/range while navigating; a small TTL avoids repeated backend calls.
// ============================================================================
import type { Instance, LoadRecord, LoadType, PingData } from "./types";
import { backendFor } from "./server";

const DEFAULT_TTL_MS = 60 * 1000;

type CacheEntry<T> = {
  fetchedAt: number;
  expiresAt: number;
  promise: Promise<T>;
};

const loadCache = new Map<string, CacheEntry<LoadRecord[]>>();
const pingCache = new Map<string, CacheEntry<PingData>>();

export type CachedResult<T> = {
  data: T;
  cached: boolean;
  ageMs: number;
};

function authSig(inst: Instance): string {
  const auth = inst.auth;
  if (!auth || auth.mode === "none") return "none";
  if (auth.mode === "token") return `token:${auth.apiKey ? "set" : "empty"}`;
  return `password:${auth.username || ""}:${auth.sessionToken ? "session" : "nosession"}`;
}

function instanceSig(inst: Instance): string {
  return `${inst.id}:${inst.kind}:${inst.baseUrl}:${authSig(inst)}`;
}

function getCachedMeta<T>(map: Map<string, CacheEntry<T>>, key: string, ttlMs: number, fetcher: () => Promise<T>): Promise<CachedResult<T>> {
  const now = Date.now();
  const hit = map.get(key);
  if (hit && hit.expiresAt > now) {
    return hit.promise.then((data) => ({ data, cached: true, ageMs: Math.max(0, Date.now() - hit.fetchedAt) }));
  }
  const promise = fetcher().catch((e) => {
    map.delete(key);
    throw e;
  });
  map.set(key, { fetchedAt: now, expiresAt: now + ttlMs, promise });
  return promise.then((data) => ({ data, cached: false, ageMs: 0 }));
}

function getCached<T>(map: Map<string, CacheEntry<T>>, key: string, ttlMs: number, fetcher: () => Promise<T>): Promise<T> {
  return getCachedMeta(map, key, ttlMs, fetcher).then((r) => r.data);
}

export function fetchPingRecordsCached(
  inst: Instance,
  uuid: string,
  hours: number,
  ttlMs = DEFAULT_TTL_MS,
): Promise<PingData> {
  const key = `ping:${instanceSig(inst)}:${uuid}:${hours}`;
  return getCached(pingCache, key, ttlMs, () =>
    backendFor(inst).fetchPingRecords(inst.baseUrl, uuid, hours, inst.auth),
  );
}

export function fetchPingRecordsCachedMeta(
  inst: Instance,
  uuid: string,
  hours: number,
  ttlMs = DEFAULT_TTL_MS,
): Promise<CachedResult<PingData>> {
  const key = `ping:${instanceSig(inst)}:${uuid}:${hours}`;
  return getCachedMeta(pingCache, key, ttlMs, () =>
    backendFor(inst).fetchPingRecords(inst.baseUrl, uuid, hours, inst.auth),
  );
}

export function fetchLoadRecordsCached(
  inst: Instance,
  uuid: string,
  loadType: LoadType,
  hours: number,
  totals?: { mem?: number; disk?: number },
  ttlMs = DEFAULT_TTL_MS,
): Promise<LoadRecord[]> {
  const totalSig = `${totals?.mem || 0}:${totals?.disk || 0}`;
  const key = `load:${instanceSig(inst)}:${uuid}:${loadType}:${hours}:${totalSig}`;
  return getCached(loadCache, key, ttlMs, () =>
    backendFor(inst).fetchLoadRecords(inst.baseUrl, uuid, loadType, hours, inst.auth, totals),
  );
}

export function fetchLoadRecordsCachedMeta(
  inst: Instance,
  uuid: string,
  loadType: LoadType,
  hours: number,
  totals?: { mem?: number; disk?: number },
  ttlMs = DEFAULT_TTL_MS,
): Promise<CachedResult<LoadRecord[]>> {
  const totalSig = `${totals?.mem || 0}:${totals?.disk || 0}`;
  const key = `load:${instanceSig(inst)}:${uuid}:${loadType}:${hours}:${totalSig}`;
  return getCachedMeta(loadCache, key, ttlMs, () =>
    backendFor(inst).fetchLoadRecords(inst.baseUrl, uuid, loadType, hours, inst.auth, totals),
  );
}

export function clearHistoryCache(): void {
  loadCache.clear();
  pingCache.clear();
}
