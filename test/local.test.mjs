import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { localPlaceFrom } from '../src/worker.ts';
import { countryCode, normaliseLocal, placeName, rateLocal, searchUrl } from '../src/local.ts';

const NOW = new Date('2026-11-15T12:00:00Z');
const at = (h) => new Date(NOW.getTime() - h * 3_600_000).toUTCString();
const item = (title, pub, h, id) => `<item><title>${title} - ${pub}</title><link>https://news.google.com/rss/articles/${id}?oc=5</link><pubDate>${at(h)}</pubDate><description>&lt;a href="x"&gt;${title}&lt;/a&gt;</description><source url="https://p.test">${pub}</source></item>`;
const rss = `<?xml version="1.0"?><rss version="2.0"><channel><title>x</title>
${item('Typhoon Kiko to make landfall in northern Luzon', 'Philippine Daily Inquirer', 3, 'a')}
${item('Typhoon Kiko to make landfall in northern Luzon!', 'GMA News', 4, 'b')}
${item('Classes suspended in Baguio due to heavy rains', 'Rappler', 5, 'c')}
${item('Baguio Flower Festival returns', 'SunStar', 6, 'd')}
${item('Old flood story', 'Rappler', 90, 'e')}
</channel></rss>`;

test('place names are validated', () => {
  assert.equal(placeName('  Baguio   City '), 'Baguio City');
  assert.equal(placeName("Cote d'Ivoire"), "Cote d'Ivoire");
  assert.equal(placeName('Bad<script>'), null);
  assert.equal(placeName('x'), null);
  assert.equal(placeName(null), null);
  assert.equal(countryCode('ph'), 'PH');
  assert.equal(countryCode('PHL'), undefined);
});

test('search url asks for the place, hazard topics, three days, and the right edition', () => {
  const u = decodeURIComponent(searchUrl({ name: 'Baguio', cc: 'PH' }));
  assert.match(u, /"Baguio" \(typhoon OR "tropical storm" OR earthquake/);
  assert.match(u, /when:3d/);
  assert.match(u, /gl=PH&ceid=PH:en/);
});

test('ratings: storms and evacuations urgent, floods and outages heads-up, other news fyi, urgent cools after two days', () => {
  assert.equal(rateLocal('Typhoon Kiko to hit Luzon', 3_600_000), 'urgent');
  assert.equal(rateLocal('Typhoon Kiko to hit Luzon', 3 * 86_400_000 - 1), 'heads-up');
  assert.equal(rateLocal('Classes suspended due to floods', 3_600_000), 'heads-up');
  assert.equal(rateLocal('Flower festival returns', 3_600_000), 'fyi');
});

test('normaliseLocal strips the publisher suffix, drops duplicates and anything older than three days', () => {
  const items = normaliseLocal(rss, { name: 'Baguio', cc: 'PH' }, NOW);
  assert.deepEqual(items.map((i) => i.title), [
    'Typhoon Kiko to make landfall in northern Luzon',
    'Classes suspended in Baguio due to heavy rains',
    'Baguio Flower Festival returns',
  ]);
  assert.deepEqual(items.map((i) => i.severity), ['urgent', 'heads-up', 'fyi']);
  assert.equal(items[0].source, 'Philippine Daily Inquirer');
  assert.equal(items[0].category, 'hazard');
  assert.equal(items[0].kind, 'news');
  assert.deepEqual(items[0].tags, ['Local news']);
  assert.match(items[0].summary, /not an official alert/);
});

const withCf = (url, cf) => { const r = new Request(url); Object.defineProperty(r, 'cf', { value: cf }); return r; };

test('local place: the picked city wins and the connection city is ignored; no name means no local news', () => {
  const cf = { city: 'Tokyo', country: 'JP', latitude: '35', longitude: '139' };
  assert.deepEqual(localPlaceFrom(withCf('https://x.test/api/alerts', cf)), { name: 'Tokyo', cc: 'JP' });
  assert.deepEqual(localPlaceFrom(withCf('https://x.test/api/alerts?lat=16.4&lon=120.6&city=Baguio&cc=PH', cf)), { name: 'Baguio', cc: 'PH' });
  assert.equal(localPlaceFrom(withCf('https://x.test/api/alerts?lat=16.4&lon=120.6', cf)), null, 'device location has no name');
  assert.equal(localPlaceFrom(new Request('https://x.test/api/alerts')), null);
});

class FakeKV {
  data = new Map();
  async get(k) { return this.data.has(k) ? JSON.parse(this.data.get(k)) : null; }
  async put(k, v) { this.data.set(k, v); }
}
const ctx = () => { const jobs = []; return { jobs, waitUntil: (p) => jobs.push(p) }; };
const env = () => ({ ALERTS: new FakeKV(), ASSETS: { fetch: async () => new Response('a') } });

test('the API returns local news for the picked place, and survives the news source being down', async () => {
  const real = globalThis.fetch;
  try {
    globalThis.fetch = async (u) => (String(u).includes('news.google.com') ? new Response(rss.replaceAll('Nov 2026', 'Nov 2026')) : new Response('no', { status: 404 }));
    const e = env();
    // use a real "now" for the item dates
    const fresh = rss.replace(/<pubDate>[^<]*<\/pubDate>/g, `<pubDate>${new Date(Date.now() - 3_600_000).toUTCString()}</pubDate>`);
    globalThis.fetch = async (u) => (String(u).includes('news.google.com') ? new Response(fresh) : new Response('no', { status: 404 }));
    const body = await (await worker.fetch(withCf('https://x.test/api/alerts?lat=16.4&lon=120.6&city=Baguio&cc=PH', {}), e, ctx())).json();
    assert.equal(body.local.place, 'Baguio');
    assert.equal(body.local.ok, true);
    assert.ok(body.local.items.length >= 1);
    globalThis.fetch = async () => new Response('down', { status: 503 });
    const down = await (await worker.fetch(withCf('https://x.test/api/alerts?lat=16.4&lon=120.6&city=Baguio&cc=PH', {}), e, ctx())).json();
    assert.deepEqual(down.local, { place: 'Baguio', ok: false, items: [] });
    const none = await (await worker.fetch(new Request('https://x.test/api/alerts'), e, ctx())).json();
    assert.deepEqual(none.local, { place: null, ok: true, items: [] });
  } finally { globalThis.fetch = real; }
});
