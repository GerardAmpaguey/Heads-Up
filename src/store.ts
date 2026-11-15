import type { Alert, NewsItem } from './alerts.ts';
import { EOL_PRODUCTS, FEEDS, normaliseEol, normaliseFeed } from './news.ts';
import { normaliseGdacs, gdacsUrls } from './gdacs.ts';
import { normaliseUsgs, USGS_URL } from './usgs.ts';

export type KV = {
  get(key: string, type: 'json'): Promise<unknown>;
  put(key: string, value: string): Promise<void>;
};

export type StoredItem = Alert | NewsItem;

export type SourceState = { ok: boolean; updatedAt: string; error?: string; alerts: StoredItem[] };
export type Stored = { updatedAt: string; sources: Record<string, SourceState> };

export const KEY = 'alerts:v2';
export const STALE_MS = 45 * 60_000; // the cron runs every 30 minutes; a visit refreshes only if that has been missed
const KEEP_HAZARD_MS = 14 * 86_400_000; // forget hazard alerts older than two weeks
const KEEP_NEWS_MS = 30 * 86_400_000; // and news older than a month
const UA = 'Heads-Up/0.1 (+https://heads-up.ampagueyg.workers.dev)';

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

async function getText(doFetch: Fetch, url: string): Promise<string> {
  const res = await doFetch(url, { headers: { accept: 'application/atom+xml, application/rss+xml, application/xml, text/xml, */*', 'user-agent': UA }, signal: AbortSignal.timeout(12_000) });
  if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}`);
  return res.text();
}

async function getJson(doFetch: Fetch, url: string): Promise<unknown> {
  const res = await doFetch(url, { headers: { accept: 'application/json', 'user-agent': UA }, signal: AbortSignal.timeout(12_000) });
  if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}`);
  const body = await res.text();
  return body.trim() ? JSON.parse(body) : null; // an empty body means no events, not an error
}

/** Fetch every source. One source failing never wipes the other, and keeps its last good data. */
export async function refresh(kv: KV, doFetch: Fetch = fetch, now = new Date()): Promise<Stored> {
  const previous = await load(kv);
  const stamp = now.toISOString();

  const jobs: Record<string, () => Promise<StoredItem[]>> = {
    usgs: async () => normaliseUsgs(await getJson(doFetch, USGS_URL)),
    gdacs: async () => {
      // Three requests (cyclones, and the orange/red others). One failing should not hide the rest.
      const results = await Promise.allSettled(gdacsUrls(now).map(async (u) => normaliseGdacs(await getJson(doFetch, u))));
      const ok = results.filter((r): r is PromiseFulfilledResult<Alert[]> => r.status === 'fulfilled');
      if (ok.length === 0) throw (results[0] as PromiseRejectedResult).reason;
      return [...new Map(ok.flatMap((r) => r.value).map((a) => [a.id, a])).values()];
    },
    eol: async () => {
      const lists = await Promise.all(EOL_PRODUCTS.map(async (p) => normaliseEol(p, await getJson(doFetch, `https://endoflife.date/api/${p.product}.json`), now)));
      return lists.flat();
    },
  };
  for (const def of FEEDS) jobs[def.id] = async () => normaliseFeed(def, await getText(doFetch, def.url), now);

  const sources: Record<string, SourceState> = {};
  await Promise.all(
    Object.entries(jobs).map(async ([name, run]) => {
      try {
        const alerts = (await run()).filter((a) => now.getTime() - Date.parse(a.time) < (a.category === 'hazard' ? KEEP_HAZARD_MS : KEEP_NEWS_MS));
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
export const allItems = (stored: Stored): StoredItem[] => Object.values(stored.sources).flatMap((s) => s.alerts);
