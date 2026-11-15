import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { placeFrom } from '../src/worker.ts';
import { actionFor, bump, distanceKm, bearingDeg, personalise } from '../src/alerts.ts';
import { normaliseUsgs, usgsSeverity } from '../src/usgs.ts';
import { normaliseGdacs, gdacsUrls } from '../src/gdacs.ts';
import { refresh, load, isStale, allAlerts, KEY } from '../src/hazards.ts';

const NOW = new Date('2026-11-15T12:00:00Z');
const hoursAgo = (h) => NOW.getTime() - h * 3_600_000;

// ---------- sample payloads shaped like the real feeds ----------

const usgsFeed = {
  type: 'FeatureCollection',
  features: [
    { id: 'us1', properties: { mag: 7.6, place: '40 km SSE of Surigao, Philippines', time: hoursAgo(2), url: 'https://earthquake.usgs.gov/earthquakes/eventpage/us1', alert: 'red', tsunami: 1, sig: 900, type: 'earthquake' }, geometry: { coordinates: [126.1, 9.4, 25] } },
    { id: 'us2', properties: { mag: 6.7, place: 'Tonga region', time: hoursAgo(5), url: 'https://earthquake.usgs.gov/earthquakes/eventpage/us2', alert: 'orange', tsunami: 0, type: 'earthquake' }, geometry: { coordinates: [-174.9, -20.1, 10] } },
    { id: 'us3', properties: { mag: 4.8, place: '10 km W of Baguio, Philippines', time: hoursAgo(1), url: 'https://earthquake.usgs.gov/earthquakes/eventpage/us3', alert: null, tsunami: 0, type: 'earthquake' }, geometry: { coordinates: [120.5, 16.4, 30] } },
    { id: 'junk1', properties: { mag: null, time: hoursAgo(1) }, geometry: null },
    { id: 'blast', properties: { mag: 5.1, place: 'Quarry', time: hoursAgo(1), type: 'quarry blast' }, geometry: { coordinates: [1, 1, 1] } },
    { properties: { mag: 5, time: hoursAgo(1) } },
  ],
};

const gdacsFeed = {
  features: [
    { bbox: [125, 15, 125, 15], geometry: { type: 'Point', coordinates: [125.0, 15.0] }, properties: { eventtype: 'TC', eventid: 1001, episodeid: 5, name: 'Tropical Cyclone KIKO-26', alertlevel: 'Red', datemodified: '2026-11-15T06:00:00', url: { report: 'https://www.gdacs.org/report.aspx?eventid=1001&eventtype=TC' }, severitydata: { severitytext: 'Tropical Storm, maximum wind speed 120 km/h' }, affectedcountries: [{ iso2: 'PH' }] } },
    { geometry: { type: 'Point', coordinates: [125.5, 15.5] }, properties: { eventtype: 'TC', eventid: 1001, episodeid: 4, name: 'Tropical Cyclone KIKO-26', alertlevel: 'Orange', datemodified: '2026-11-15T00:00:00', url: { report: 'https://www.gdacs.org/report.aspx?eventid=1001&eventtype=TC' } } },
    { bbox: [80, 27, 82, 29], geometry: { type: 'Polygon', coordinates: [] }, properties: { eventtype: 'FL', eventid: 2002, name: 'Flood in India', alertlevel: 'Orange', datemodified: '2026-11-14T05:57:02', affectedcountries: [{ iso2: 'IN' }] } },
    { geometry: { type: 'Point', coordinates: [10, 10] }, properties: { eventtype: 'TC', eventid: 3003, name: 'Tropical Cyclone FAR-26', alertlevel: 'Green', datemodified: '2026-11-15T03:00:00' } },
    { geometry: { type: 'Point', coordinates: [10, 10] }, properties: { eventtype: 'DR', eventid: 4004, name: 'Drought', alertlevel: 'Orange', datemodified: '2026-11-15T03:00:00' } },
    { properties: { eventtype: 'FL', alertlevel: 'Red' } },
  ],
};

class FakeKV {
  data = new Map();
  async get(key) { return this.data.has(key) ? JSON.parse(this.data.get(key)) : null; }
  async put(key, value) { this.data.set(key, value); }
}

const fakeFetch = (overrides = {}) => async (url) => {
  const u = String(url);
  const hit = Object.entries(overrides).find(([k]) => u.includes(k));
  if (hit) return hit[1]();
  if (u.includes('usgs.gov')) return Response.json(usgsFeed);
  if (u.includes('gdacs.org')) return Response.json(gdacsFeed);
  return new Response('nope', { status: 404 });
};

// ---------- USGS ----------

test('usgs severity thresholds', () => {
  assert.equal(usgsSeverity(7.6, null, false), 'urgent');
  assert.equal(usgsSeverity(5.0, 'red', false), 'urgent');
  assert.equal(usgsSeverity(7.0, null, true), 'urgent');
  assert.equal(usgsSeverity(6.9, null, true), 'heads-up');
  assert.equal(usgsSeverity(5.0, 'orange', false), 'heads-up');
  assert.equal(usgsSeverity(4.8, null, false), 'fyi');
});

test('usgs normaliser maps fields, reads lon/lat order, and skips junk', () => {
  const alerts = normaliseUsgs(usgsFeed);
  assert.deepEqual(alerts.map((a) => a.id), ['usgs:us1', 'usgs:us2', 'usgs:us3']);
  const a = alerts[0];
  assert.equal(a.severity, 'urgent');
  assert.equal(a.lon, 126.1);
  assert.equal(a.lat, 9.4);
  assert.equal(a.tsunami, true);
  assert.equal(a.time, new Date(hoursAgo(2)).toISOString());
  assert.match(a.title, /^M7\.6 earthquake near Surigao, Philippines$/);
  assert.match(a.action, /tsunami/i);
  assert.equal(a.source, 'USGS');
  assert.deepEqual(normaliseUsgs(null), []);
  assert.deepEqual(normaliseUsgs({ features: 'x' }), []);
});

// ---------- GDACS ----------

test('gdacs urls ask for 7 days, and every cyclone level', () => {
  const [tc, rest] = gdacsUrls(NOW);
  assert.match(tc, /eventlist=TC&fromdate=2026-11-08&todate=2026-11-15&alertlevel=green;orange;red/);
  assert.match(rest, /eventlist=FL;VO;WF/);
  assert.match(rest, /alertlevel=orange;red/);
});

test('gdacs normaliser maps kinds and levels, keeps newest episode, skips unknown types', () => {
  const alerts = normaliseGdacs(gdacsFeed);
  assert.deepEqual(alerts.map((a) => a.id).sort(), ['gdacs:FL:2002', 'gdacs:TC:1001', 'gdacs:TC:3003']);
  const tc = alerts.find((a) => a.id === 'gdacs:TC:1001');
  assert.equal(tc.severity, 'urgent');
  assert.equal(tc.kind, 'cyclone');
  assert.equal(tc.time, '2026-11-15T06:00:00.000Z');
  assert.equal(tc.lat, 15);
  assert.equal(tc.lon, 125);
  assert.match(tc.summary, /120 km\/h/);
  assert.match(tc.action, /PAGASA/);
  assert.equal(alerts.find((a) => a.id === 'gdacs:TC:3003').severity, 'fyi');
  const flood = alerts.find((a) => a.id === 'gdacs:FL:2002');
  assert.equal(flood.severity, 'heads-up');
  assert.equal(flood.lat, 28);
  assert.equal(flood.lon, 81);
  assert.match(flood.action, /your official local agency/);
});

// ---------- shared logic ----------

test('distance, bump and agency text', () => {
  const d = distanceKm(14.6, 121.0, 35.7, 139.7); // Manila to Tokyo
  assert.ok(d > 2900 && d < 3100, String(d));
  assert.equal(distanceKm(1, 1, 1, 1), 0);
  assert.equal(bump('fyi'), 'heads-up');
  assert.equal(bump('urgent'), 'urgent');
  assert.match(actionFor('earthquake', { country: 'PH' }), /PHIVOLCS/);
  assert.match(actionFor('wildfire'), /your official local agency/);
});

test('personalise: urgent anywhere stays, far non-urgent goes, near events sort first', () => {
  const alerts = [...normaliseUsgs(usgsFeed), ...normaliseGdacs(gdacsFeed)];
  const manila = { lat: 14.6, lon: 121.0, country: 'PH' };
  const items = personalise(alerts, manila);
  assert.deepEqual(items.map((i) => i.id), ['gdacs:TC:1001', 'usgs:us1', 'usgs:us3']);
  const tc = items[0];
  assert.equal(tc.near, true);
  assert.ok(tc.distanceKm > 350 && tc.distanceKm < 520, String(tc.distanceKm));
  assert.equal(items[1].near, false);
  assert.equal(items[2].severity, 'fyi'); // M4.8 nearby is not bumped
});

test('personalise: a felt-size quake nearby is bumped one step', () => {
  const quake = { ...normaliseUsgs(usgsFeed)[2], magnitude: 5.4, severity: 'fyi' };
  const [item] = personalise([quake], { lat: 14.6, lon: 121.0 });
  assert.equal(item.severity, 'heads-up');
});

test('personalise without a location hides fyi and keeps global heads-up and urgent', () => {
  const alerts = [...normaliseUsgs(usgsFeed), ...normaliseGdacs(gdacsFeed)];
  const items = personalise(alerts, null);
  assert.deepEqual(items.map((i) => i.id).sort(), ['gdacs:FL:2002', 'gdacs:TC:1001', 'usgs:us1', 'usgs:us2']);
  assert.ok(items.every((i) => i.distanceKm === null && i.near === false));
  assert.equal(personalise(alerts, null, 2).length, 2);
});

// ---------- refresh and storage ----------

test('refresh stores both sources and drops alerts older than a week', async () => {
  const kv = new FakeKV();
  const old = structuredClone(usgsFeed);
  old.features.push({ id: 'old', properties: { mag: 6, place: 'Old', time: hoursAgo(24 * 9), type: 'earthquake' }, geometry: { coordinates: [0, 0, 0] } });
  const stored = await refresh(kv, fakeFetch({ 'usgs.gov': () => Response.json(old) }), NOW);
  assert.equal(stored.sources.usgs.ok, true);
  assert.equal(stored.sources.gdacs.ok, true);
  assert.ok(!allAlerts(stored).some((a) => a.id === 'usgs:old'));
  assert.equal(allAlerts(stored).length, 6);
  assert.deepEqual(await load(kv), JSON.parse(kv.data.get(KEY)));
});

test('one failing source keeps its last good data and does not hurt the other', async () => {
  const kv = new FakeKV();
  await refresh(kv, fakeFetch(), NOW);
  const later = new Date(NOW.getTime() + 30 * 60_000);
  const stored = await refresh(kv, fakeFetch({ 'usgs.gov': () => new Response('down', { status: 503 }) }), later);
  assert.equal(stored.sources.usgs.ok, false);
  assert.match(stored.sources.usgs.error, /503/);
  assert.equal(stored.sources.usgs.alerts.length, 3); // kept
  assert.equal(stored.sources.usgs.updatedAt, NOW.toISOString()); // still the old time
  assert.equal(stored.sources.gdacs.ok, true);
  assert.equal(stored.sources.gdacs.updatedAt, later.toISOString());
});

test('a network error is caught the same way', async () => {
  const kv = new FakeKV();
  const stored = await refresh(kv, fakeFetch({ 'gdacs.org': () => { throw new Error('boom'); } }), NOW);
  assert.equal(stored.sources.gdacs.ok, false);
  assert.equal(stored.sources.gdacs.error, 'boom');
  assert.equal(stored.sources.usgs.ok, true);
});

test('stale check uses 20 minutes', () => {
  const stored = { updatedAt: NOW.toISOString(), sources: {} };
  assert.equal(isStale(stored, new Date(NOW.getTime() + 19 * 60_000)), false);
  assert.equal(isStale(stored, new Date(NOW.getTime() + 21 * 60_000)), true);
});

// ---------- the Worker ----------

function makeEnv() {
  return { ALERTS: new FakeKV(), ASSETS: { fetch: async () => new Response('asset') } };
}
const ctx = () => { const jobs = []; return { jobs, waitUntil: (p) => jobs.push(p) }; };
const withCf = (url, cf) => { const r = new Request(url); Object.defineProperty(r, 'cf', { value: cf }); return r; };

test('placeFrom reads Cloudflare location, lets ?lat&lon override, and rejects nonsense', () => {
  const cf = { latitude: '14.6', longitude: '121.0', country: 'PH', city: 'Manila' };
  assert.deepEqual(placeFrom(withCf('https://x.test/api/alerts', cf)), { lat: 14.6, lon: 121, country: 'PH', city: 'Manila' });
  assert.equal(placeFrom(withCf('https://x.test/api/alerts?lat=35&lon=139', cf)).lat, 35);
  assert.equal(placeFrom(new Request('https://x.test/api/alerts')), null);
  assert.equal(placeFrom(new Request('https://x.test/api/alerts?lat=999&lon=1')), null);
  assert.equal(placeFrom(new Request('https://x.test/api/alerts?lat=abc&lon=1')), null);
});

test('first visit waits for the first fetch and returns personalised alerts', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = fakeFetch();
  try {
    const env = makeEnv();
    const res = await worker.fetch(withCf('https://x.test/api/alerts', { latitude: '14.6', longitude: '121', country: 'PH', city: 'Manila' }), env, ctx());
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'private, max-age=60');
    const body = await res.json();
    assert.equal(body.location.city, 'Manila');
    assert.equal(body.location.approximate, true);
    assert.equal(body.items[0].id.startsWith('gdacs:TC:1001'), true);
    assert.equal(body.sources.usgs.ok, true);
    assert.ok(!('alerts' in body.sources.usgs), 'raw alerts must not leak into the response');
    assert.ok(env.ALERTS.data.has(KEY));
  } finally { globalThis.fetch = realFetch; }
});

test('a fresh store is served without fetching; a stale one refreshes in the background', async () => {
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (...a) => { calls++; return fakeFetch()(...a); };
  try {
    const env = makeEnv();
    await worker.fetch(new Request('https://x.test/api/alerts'), env, ctx());
    const first = calls;
    assert.ok(first >= 3);
    await worker.fetch(new Request('https://x.test/api/alerts'), env, ctx());
    assert.equal(calls, first, 'fresh data should not trigger another fetch');
    const stale = JSON.parse(env.ALERTS.data.get(KEY));
    stale.updatedAt = new Date(Date.now() - 25 * 60_000).toISOString();
    env.ALERTS.data.set(KEY, JSON.stringify(stale));
    const c = ctx();
    const res = await worker.fetch(new Request('https://x.test/api/alerts'), env, c);
    assert.equal(res.status, 200);
    assert.equal(c.jobs.length, 1, 'stale data schedules a background refresh');
    await Promise.all(c.jobs);
    assert.ok(calls > first);
  } finally { globalThis.fetch = realFetch; }
});

test('cron handler refreshes the store', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = fakeFetch();
  try {
    const env = makeEnv();
    const c = ctx();
    await worker.scheduled({}, env, c);
    await Promise.all(c.jobs);
    assert.ok(env.ALERTS.data.has(KEY));
  } finally { globalThis.fetch = realFetch; }
});

test('both sources down on a cold start still answers with an empty list, not a crash', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('down', { status: 500 });
  try {
    const res = await worker.fetch(new Request('https://x.test/api/alerts'), makeEnv(), ctx());
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body.items, []);
    assert.equal(body.sources.usgs.ok, false);
  } finally { globalThis.fetch = realFetch; }
});

test('routing: wrong method 405, unknown api 404, everything else goes to the assets', async () => {
  const env = makeEnv();
  assert.equal((await worker.fetch(new Request('https://x.test/api/alerts', { method: 'POST' }), env, ctx())).status, 405);
  assert.equal((await worker.fetch(new Request('https://x.test/api/nope'), env, ctx())).status, 404);
  const asset = await worker.fetch(new Request('https://x.test/'), env, ctx());
  assert.equal(await asset.text(), 'asset');
});

test('a storage failure becomes a clean 503', async () => {
  const env = { ALERTS: { get: async () => { throw new Error('kv down'); }, put: async () => {} }, ASSETS: { fetch: async () => new Response('a') } };
  const res = await worker.fetch(new Request('https://x.test/api/alerts'), env, ctx());
  assert.equal(res.status, 503);
});

test('gdacs cyclones carry the overview map of their newest episode, other hazards do not', () => {
  const [tc, fl] = [normaliseGdacs(gdacsFeed).find((a) => a.id === 'gdacs:TC:1001'), normaliseGdacs(gdacsFeed).find((a) => a.kind === 'flood')];
  assert.equal(tc.image, 'https://www.gdacs.org/contentdata/resources/imgtemp/gdacs/tc/1001/1001_5_tn.png');
  assert.equal(tc.imageCredit, 'GDACS / EC-JRC');
  assert.equal(fl.image, undefined);
});

test('bearing points the right way and personalise includes it', () => {
  assert.equal(bearingDeg(14, 121, 16, 121), 0);
  assert.equal(bearingDeg(14, 121, 12, 121), 180);
  assert.ok(Math.abs(bearingDeg(0, 100, 0, 110) - 90) <= 1);
  const [a] = personalise(normaliseUsgs(usgsFeed), { lat: 14.6, lon: 121 });
  assert.equal(typeof a.bearing, 'number');
  assert.equal(personalise(normaliseUsgs(usgsFeed), null, 5).every((x) => x.bearing === null), true);
});
