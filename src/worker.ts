import { personalise, type Alert, type NewsItem, type Place } from './alerts.ts';
import { allItems, isStale, load, refresh, type KV } from './store.ts';

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

/** Rough location from Cloudflare (city level, no permission prompt), or ?lat=&lon= for testing. */
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
    country: !chosen && typeof cf.country === 'string' ? cf.country : undefined,
    city: !chosen && typeof cf.city === 'string' ? cf.city : undefined,
    chosen,
  };
}

const NEWS_LIMIT = 80;

async function alertsResponse(request: Request, env: Env, ctx: Ctx): Promise<Response> {
  const stored = await load(env.ALERTS);
  // Fetching a dozen feeds is too much work for one visitor's request. The cron keeps the store fresh;
  // a visit only steps in on the very first run, or when the cron has fallen behind.
  if (!stored || isStale(stored)) ctx.waitUntil(refresh(env.ALERTS).then(() => undefined, () => undefined));

  const everything = stored ? allItems(stored) : [];
  const place = placeFrom(request);
  const items = personalise(everything.filter((i): i is Alert => i.category === 'hazard'), place);
  const news = everything
    .filter((i): i is NewsItem => i.category !== 'hazard')
    .sort((a, b) => Date.parse(b.time) - Date.parse(a.time))
    .slice(0, NEWS_LIMIT);
  const sources = Object.fromEntries(Object.entries(stored?.sources ?? {}).map(([k, v]) => [k, { ok: v.ok, updatedAt: v.updatedAt, ...(v.ok ? {} : { error: v.error }) }]));
  return json(
    {
      updatedAt: stored?.updatedAt ?? null,
      warming: !stored,
      location: place ? { country: place.country ?? null, city: place.city ?? null, approximate: !place.chosen } : null,
      sources,
      items,
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
