import type { Alert } from './alerts.ts';
import { normaliseGdacs, gdacsUrls } from './gdacs.ts';
import { normaliseUsgs, USGS_URL } from './usgs.ts';

export type KV = {
  get(key: string, type: 'json'): Promise<unknown>;
  put(key: string, value: string): Promise<void>;
};

export type SourceState = { ok: boolean; updatedAt: string; error?: string; alerts: Alert[] };
export type Stored = { updatedAt: string; sources: Record<string, SourceState> };

export const KEY = 'hazards:v1';
export const STALE_MS = 20 * 60_000; // refresh when older than this
const KEEP_MS = 7 * 86_400_000; // forget alerts older than a week
const UA = 'Heads-Up/0.1 (+https://heads-up.ampagueyg.workers.dev)';

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

async function getJson(doFetch: Fetch, url: string): Promise<unknown> {
  const res = await doFetch(url, { headers: { accept: 'application/json', 'user-agent': UA }, signal: AbortSignal.timeout(12_000) });
  if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}`);
  return res.json();
}

/** Fetch every source. One source failing never wipes the other, and keeps its last good data. */
export async function refresh(kv: KV, doFetch: Fetch = fetch, now = new Date()): Promise<Stored> {
  const previous = await load(kv);
  const stamp = now.toISOString();

  const jobs: Record<string, () => Promise<Alert[]>> = {
    usgs: async () => normaliseUsgs(await getJson(doFetch, USGS_URL)),
    gdacs: async () => {
    const lists = await Promise.all(gdacsUrls(now).map(async (u) => normaliseGdacs(await getJson(doFetch, u))));
    const byId = new Map(lists.flat().map((a) => [a.id, a]));
    return [...byId.values()];
  },
  };

  const sources: Record<string, SourceState> = {};
  await Promise.all(
    Object.entries(jobs).map(async ([name, run]) => {
      try {
        const alerts = (await run()).filter((a) => now.getTime() - Date.parse(a.time) < KEEP_MS);
        sources[name] = { ok: true, updatedAt: stamp, alerts };
      } catch (err) {
        const old = previous?.sources[name];
        sources[name] = { ok: false, updatedAt: old?.updatedAt ?? stamp, error: String(err instanceof Error ? err.message : err), alerts: old?.alerts ?? [] };
      }
    }),
  );

  const stored: Stored = { updatedAt: stamp, sources };
  await kv.put(KEY, JSON.stringify(stored));
  return stored;
}

export async function load(kv: KV): Promise<Stored | null> {
  const value = (await kv.get(KEY, 'json')) as Stored | null;
  return value && typeof value === 'object' && value.sources ? value : null;
}

export const isStale = (stored: Stored, now = new Date()) => now.getTime() - Date.parse(stored.updatedAt) > STALE_MS;
export const allAlerts = (stored: Stored): Alert[] => Object.values(stored.sources).flatMap((s) => s.alerts);
