import { personalise, type Alert, type LocalItem, type NewsItem, type Place } from './alerts.ts';
import { allItems, isStale, load, refresh, type KV } from './store.ts';
import { bingUrl, cacheKey, countryCode, localFeedsFor, normaliseLocal, wpPhotos, placeName, searchUrl, type LocalPlace } from './local.ts';

type Env = {
  ALERTS: KV;
  ASSETS: { fetch(request: Request): Promise<Response> };
};

type Ctx = { waitUntil(promise: Promise<unknown>): void };

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });

const num = (v: unknown) => (typeof v === 'string' || typeof v === 'number') && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null;

/** Rough location from Cloudflare (city level, no permission prompt), or the place the visitor picked
 *  (?lat=&lon=, with ?cc= for its country). */
export function placeFrom(request: Request): Place | null {
  const url = new URL(request.url);
  const cf = (request as unknown as { cf?: Record<string, unknown> }).cf ?? {};
  const qLat = num(url.searchParams.get('lat'));
  const qLon = num(url.searchParams.get('lon'));
  const chosen = qLat != null && qLon != null; // the visitor picked a place, so the connection's city no longer applies
  const lat = chosen ? qLat : num(cf.latitude);
  const lon = chosen ? qLon : num(cf.longitude);
  if (lat == null || lon == null || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return {
    lat,
    lon,
    country: chosen ? countryCode(url.searchParams.get('cc')) : countryCode(typeof cf.country === 'string' ? cf.country : null),
    city: !chosen && typeof cf.city === 'string' ? cf.city : undefined,
    chosen,
  };
}

const NEWS_LIMIT = 300;
const PER_SOURCE_MIN = 3;

/** Newest first, but every source keeps its latest few so a busy feed cannot push a quiet one (say, Astro) off the page. */
export function pickNews(all: NewsItem[], limit = NEWS_LIMIT): NewsItem[] {
  const newest = [...all].sort((a, b) => Date.parse(b.time) - Date.parse(a.time));
  const taken = new Map<string, number>();
  const guaranteed = new Set<NewsItem>();
  for (const n of newest) {
    const c = taken.get(n.source) ?? 0;
    if (c < PER_SOURCE_MIN) { guaranteed.add(n); taken.set(n.source, c + 1); }
  }
  const out = [...guaranteed];
  for (const n of newest) if (out.length < limit && !guaranteed.has(n)) out.push(n);
  return out.sort((a, b) => Date.parse(b.time) - Date.parse(a.time));
}

/** The city and country to look up local news for: the one the visitor picked, else their connection's. */
export function localPlaceFrom(request: Request): LocalPlace | null {
  const url = new URL(request.url);
  const cf = (request as unknown as { cf?: Record<string, unknown> }).cf ?? {};
  const picked = num(url.searchParams.get('lat')) != null && num(url.searchParams.get('lon')) != null;
  const name = placeName(picked ? url.searchParams.get('city') : (cf.city as string | undefined));
  if (!name) return null;
  return { name, cc: countryCode(picked ? url.searchParams.get('cc') : (cf.country as string | undefined)) };
}

type EdgeCache = { match(req: Request): Promise<Response | undefined>; put(req: Request, res: Response): Promise<void> };

/** Local news, cached for 30 minutes per place so visitors never wait on, or hammer, the news source. */
async function localNews(request: Request, ctx: Ctx): Promise<{ place: string | null; ok: boolean; items: LocalItem[]; error?: string; photos?: string }> {
  const place = localPlaceFrom(request);
  if (!place) return { place: null, ok: true, items: [] };
  const cache = (globalThis as unknown as { caches?: { default?: EdgeCache } }).caches?.default;
  const key = new Request(cacheKey(place));
  try {
    let hit = await cache?.match(key);
    if (!hit) {
      // Ask Google News and Bing News together and merge what comes back. Either can be slow or refuse us.
      const ask = async (url: string, accept = 'application/rss+xml, application/xml, text/xml') => {
        const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; Heads-Up/0.1; +https://heads-up.ampagueyg.workers.dev)', accept }, signal: AbortSignal.timeout(6000) });
        if (!res.ok) throw new Error(`news answered ${res.status}`);
        return res.text();
      };
      const results = await Promise.allSettled([ask(searchUrl(place)), ask(bingUrl(place)), ask(searchUrl(place, 'general')), ask(bingUrl(place, 'general'))]);
      const feeds = localFeedsFor(place);
      const asks = feeds.flatMap((f) => f.urls.map((u) => ask(u).then((xml) => ({ publisher: f.publisher, xml }))));
      const papers = (await Promise.allSettled(asks)).flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
      const photoJobs = await Promise.allSettled(feeds.filter((f) => f.wp).map((f) => ask(f.wp!, 'application/json').then((t) => wpPhotos(JSON.parse(t)))));
      const photos = Object.assign({}, ...photoJobs.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : [])));
      const photoNote = photoJobs.map((r) => (r.status === 'fulfilled' ? `ok ${Object.keys(r.value).length}` : String((r.reason as Error)?.message ?? r.reason).slice(0, 60))).join('; ');
      const xmls = results.filter((r): r is PromiseFulfilledResult<string> => r.status === 'fulfilled').map((r) => r.value);
      if (xmls.length === 0 && papers.length === 0) throw new Error(results.map((r) => (r as PromiseRejectedResult).reason?.message ?? 'failed').join('; '));
      const items = normaliseLocal(xmls, place, new Date(), 30, papers, photos);
      hit = new Response(JSON.stringify(items), { headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=1800', 'x-photos': photoNote } });
      if (cache) ctx.waitUntil(cache.put(key, hit.clone()).catch(() => undefined));
    }
    return { place: place.name, ok: true, items: (await hit.json()) as LocalItem[], photos: hit.headers.get('x-photos') || undefined };
  } catch (err) {
    return { place: place.name, ok: false, items: [], error: String(err instanceof Error ? err.message : err).slice(0, 120) };
  }
}

async function alertsResponse(request: Request, env: Env, ctx: Ctx): Promise<Response> {
  const stored = await load(env.ALERTS);
  // Fetching a dozen feeds is too much work for one visitor's request. The cron keeps the store fresh;
  // a visit only steps in on the very first run, or when the cron has fallen behind.
  if (!stored || isStale(stored)) ctx.waitUntil(refresh(env.ALERTS).then(() => undefined, () => undefined));

  const everything = stored ? allItems(stored) : [];
  const place = placeFrom(request);
  const items = personalise(everything.filter((i): i is Alert => i.category === 'hazard'), place);
  const news = pickNews(everything.filter((i): i is NewsItem => i.category !== 'hazard'));
  const local = await localNews(request, ctx);
  const sources = Object.fromEntries(Object.entries(stored?.sources ?? {}).map(([k, v]) => [k, { ok: v.ok, updatedAt: v.updatedAt, ...(v.ok ? {} : { error: v.error }) }]));
  return json(
    {
      updatedAt: stored?.updatedAt ?? null,
      warming: !stored,
      location: place ? { country: place.country ?? null, city: place.city ?? null, approximate: !place.chosen } : null,
      sources,
      items,
      local,
      news,
    },
    200,
    { 'cache-control': stored ? 'private, max-age=60' : 'no-store' },
  );
}

export default {
  async fetch(request: Request, env: Env, ctx: Ctx): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === '/api/alerts') {
      if (request.method !== 'GET' && request.method !== 'HEAD') return json({ error: 'Method not allowed' }, 405, { allow: 'GET, HEAD' });
      try {
        return await alertsResponse(request, env, ctx);
      } catch {
        return json({ error: 'Alerts are unavailable right now.' }, 503);
      }
    }
    if (pathname.startsWith('/api/')) return json({ error: 'Not found' }, 404);
    return env.ASSETS.fetch(request);
  },

  // Cron trigger: keep the stored alerts fresh even when nobody is visiting.
  async scheduled(_event: unknown, env: Env, ctx: Ctx): Promise<void> {
    ctx.waitUntil(refresh(env.ALERTS).then(() => undefined));
  },
};
