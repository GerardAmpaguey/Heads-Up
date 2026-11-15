import { personalise, type Place } from './alerts.ts';
import { allAlerts, isStale, load, refresh, type KV, type Stored } from './hazards.ts';

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
  const lat = num(url.searchParams.get('lat')) ?? num(cf.latitude);
  const lon = num(url.searchParams.get('lon')) ?? num(cf.longitude);
  if (lat == null || lon == null || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return {
    lat,
    lon,
    country: typeof cf.country === 'string' ? cf.country : undefined,
    city: typeof cf.city === 'string' ? cf.city : undefined,
  };
}

async function alertsResponse(request: Request, env: Env, ctx: Ctx): Promise<Response> {
  let stored: Stored | null = await load(env.ALERTS);
  if (!stored) stored = await refresh(env.ALERTS); // very first visit: wait for the first fetch
  else if (isStale(stored)) ctx.waitUntil(refresh(env.ALERTS));

  const place = placeFrom(request);
  const items = personalise(allAlerts(stored), place);
  const sources = Object.fromEntries(Object.entries(stored.sources).map(([k, v]) => [k, { ok: v.ok, updatedAt: v.updatedAt }]));
  return json(
    {
      updatedAt: stored.updatedAt,
      location: place ? { country: place.country ?? null, city: place.city ?? null, approximate: true } : null,
      sources,
      items,
    },
    200,
    { 'cache-control': 'private, max-age=60' },
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
