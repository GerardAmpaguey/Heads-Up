import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { localPlaceFrom, pickNews } from '../src/worker.ts';
import { localFeedsFor, bingUrl, countryCode, normaliseLocal, placeName, rateLocal, realLink, searchUrl, wpPhotos } from '../src/local.ts';

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

test('normaliseLocal strips the publisher suffix and keeps recent, non-duplicate stories about the place, rating hazards higher', () => {
  const items = normaliseLocal(rss, { name: 'Baguio', cc: 'PH' }, NOW);
  assert.deepEqual(items.map((i) => i.title), [
    'Typhoon Kiko to make landfall in northern Luzon',
    'Classes suspended in Baguio due to heavy rains',
    'Baguio Flower Festival returns',
  ]);
  // the typhoon story does not name Baguio, so it counts one step lower. Ordinary news that names the city is kept as FYI.
  assert.deepEqual(items.map((i) => i.severity), ['heads-up', 'heads-up', 'fyi']);
  assert.equal(items[2].action, 'Local news for your area. No action needed.');
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
    assert.deepEqual(down.local, { place: 'Baguio', ok: false, items: [], error: Array(4).fill('news answered 503').join('; ') });
    const none = await (await worker.fetch(new Request('https://x.test/api/alerts'), e, ctx())).json();
    assert.deepEqual(none.local, { place: null, ok: true, items: [] });
  } finally { globalThis.fetch = real; }
});

const bing = `<?xml version="1.0"?><rss version="2.0" xmlns:News="https://www.bing.com/news/search?q=x&amp;format=rss"><channel>
<item><title>Flood waters rise in Baguio after overnight rains</title><link>http://www.bing.com/news/apiclick.aspx?ref=FexRss&amp;aid=&amp;tid=1&amp;url=https%3a%2f%2fwww.example.ph%2fnews%2fflood&amp;c=1</link><description>Several barangays in Baguio City were flooded early Sunday after heavy overnight rains, officials said.</description><pubDate>${new Date(NOW.getTime() - 2 * 3_600_000).toUTCString()}</pubDate><News:Source>Example PH</News:Source></item>
<item><title>Typhoon Kiko to make landfall in northern Luzon</title><link>http://www.bing.com/news/apiclick.aspx?url=javascript%3aalert(1)</link><pubDate>${new Date(NOW.getTime() - 2 * 3_600_000).toUTCString()}</pubDate><News:Source>Dup</News:Source></item>
</channel></rss>`;

test('bing: real link is read from the redirect, snippet used, publisher read, duplicates across sources dropped', () => {
  assert.equal(realLink('http://www.bing.com/news/apiclick.aspx?ref=x&url=https%3a%2f%2fwww.example.ph%2fa'), 'https://www.example.ph/a');
  assert.equal(realLink('https://news.google.com/rss/articles/abc'), 'https://news.google.com/rss/articles/abc');
  assert.equal(realLink('http://www.bing.com/news/apiclick.aspx?url=javascript%3aalert(1)'), 'http://www.bing.com/news/apiclick.aspx?url=javascript%3aalert(1)'.replace('http:', 'http:'));
  const items = normaliseLocal([rss, bing], { name: 'Baguio', cc: 'PH' }, NOW);
  const flood = items.find((i) => i.source === 'Example PH');
  assert.equal(flood.url, 'https://www.example.ph/news/flood');
  assert.match(flood.summary, /Several barangays/);
  assert.equal(flood.severity, 'heads-up');
  assert.equal(items.filter((i) => /Typhoon Kiko/.test(i.title)).length, 1, 'same headline from both sources appears once');
});

test('bing url asks for the place and topics in the right market', () => {
  const u = decodeURIComponent(bingUrl({ name: 'Baguio', cc: 'PH' }));
  assert.match(u, /format=rss/);
  assert.match(u, /"Baguio" \(typhoon OR/);
  assert.match(u, /setmkt=en-PH/);
});

test('sports headlines that borrow weather words are dropped', () => {
  const xml = `<rss><channel>${item('Storm of goals as Baguio FC beat rivals in league opener', 'Sun', 2, 'z')}${item('NBA: Fire up the playoffs in Miami', 'ESPN', 2, 'y')}${item('Fire hits Baguio market', 'Rappler', 2, 'x')}</channel></rss>`;
  const items = normaliseLocal(xml, { name: 'Baguio' }, NOW);
  assert.deepEqual(items.map((i) => i.title), ['Fire hits Baguio market']);
});

test('pickNews keeps each quiet source\'s latest items even when busy feeds fill the limit', () => {
  const mk = (source, i, hoursAgo) => ({ id: `${source}${i}`, source, time: new Date(NOW.getTime() - hoursAgo * 3_600_000).toISOString() });
  const busy = Array.from({ length: 20 }, (_, i) => mk('Busy', i, i + 1));
  const quiet = [mk('Quiet', 0, 500), mk('Quiet', 1, 600), mk('Quiet', 2, 700), mk('Quiet', 3, 800)];
  const out = pickNews([...busy, ...quiet], 10);
  assert.equal(out.length, 10);
  assert.equal(out.filter((n) => n.source === 'Quiet').length, 3);
  assert.ok(out.every((n, i, a) => i === 0 || Date.parse(a[i - 1].time) >= Date.parse(n.time)));
});

test('general mode asks for any news about the place; showbiz and unrelated stories are dropped', () => {
  assert.doesNotMatch(decodeURIComponent(searchUrl({ name: 'Baguio', cc: 'PH' }, 'general')), /typhoon/);
  assert.match(decodeURIComponent(searchUrl({ name: 'Baguio', cc: 'PH' }, 'general')), /"Baguio" when:7d/);
  assert.doesNotMatch(decodeURIComponent(bingUrl({ name: 'Baguio', cc: 'PH' }, 'general')), /typhoon/);
  const xml = `<rss><channel>${item('City council approves Baguio water rehabilitation plan', 'Sun', 20, 'p')}${item('Actress spotted in Baguio for movie shoot', 'Push', 20, 'q')}${item('Mindoro unveils lake makeover', 'ABS', 20, 'r')}</channel></rss>`;
  const items = normaliseLocal(xml, { name: 'Baguio' }, NOW);
  assert.deepEqual(items.map((i) => [i.title, i.severity]), [['City council approves Baguio water rehabilitation plan', 'fyi']]);
});

test('a local paper\'s own feed is read, and its stories count as about the area', () => {
  const pub = new Date(NOW.getTime() - 40 * 3_600_000).toUTCString();
  const wp = `<rss><channel><item><title>BWD warns of long-term groundwater supply risks</title><link>https://baguioheraldexpressonline.com/bwd-warns-of-long-term-groundwater-supply-risks/</link><pubDate>${pub}</pubDate><description>Groundwater is finite and under growing pressure as hotels and tourism expand, the water district says.</description></item><item><title>Concert tickets on sale this weekend</title><link>https://baguioheraldexpressonline.com/concert/</link><pubDate>${pub}</pubDate><description>x</description></item></channel></rss>`;
  const items = normaliseLocal([], { name: 'Baguio' }, NOW, 30, [{ publisher: 'Baguio Herald Express', xml: wp }]);
  assert.deepEqual(items.map((i) => [i.title, i.severity, i.source]), [['BWD warns of long-term groundwater supply risks', 'heads-up', 'Baguio Herald Express']]);
  assert.equal(localFeedsFor({ name: 'Baguio City' }).length, 1);
  assert.equal(localFeedsFor({ name: 'Manila' }).length, 0);
});

test('local stories keep a photo from the paper feed or from Bing\'s News:Image', () => {
  const pub = new Date(NOW.getTime() - 5 * 3_600_000).toUTCString();
  const wp = `<rss><channel><item><title>Water district warns of shortage</title><link>https://p.test/a/</link><pubDate>${pub}</pubDate><description>Short.</description><content:encoded><![CDATA[<p><img src="https://p.test/wp-content/a.jpg" /></p>]]></content:encoded></item></channel></rss>`;
  const bing = `<rss><channel><item><title>Baguio flood warning raised</title><link>https://www.bing.com/news/apiclick.aspx?url=https%3A%2F%2Fq.test%2Fb</link><pubDate>${pub}</pubDate><description>A flood warning is up for Baguio and nearby towns today.</description><News:Source>Q</News:Source><News:Image>https://www.bing.com/th?id=ONE.b.jpg&amp;pid=News</News:Image></item></channel></rss>`;
  const items = normaliseLocal([bing], { name: 'Baguio' }, NOW, 30, [{ publisher: 'Herald', xml: wp }]);
  const by = Object.fromEntries(items.map((i) => [i.title, i]));
  assert.equal(by['Water district warns of shortage'].image, 'https://p.test/wp-content/a.jpg');
  assert.equal(by['Water district warns of shortage'].imageCredit, 'Herald');
  assert.match(by['Baguio flood warning raised'].image, /^https:\/\/www\.bing\.com\/th\?id=ONE\.b\.jpg&pid=News$/);
});

test('a WordPress response gives featured images by story link, with a clean credit', () => {
  const photos = wpPhotos([
    { link: 'https://p.test/a/', _embedded: { 'wp:featuredmedia': [{ source_url: 'https://p.test/a-scaled.jpg', media_details: { sizes: { large: { source_url: 'https://p.test/a-large.jpg' } } }, caption: { rendered: '<p>📸Fuji Sakai</p>\n' } }] } },
    { link: 'https://p.test/b/', _embedded: { 'wp:featuredmedia': [{ source_url: 'http://p.test/insecure.jpg' }] } },
    { link: 'https://p.test/c/' },
  ]);
  assert.deepEqual(photos, { 'https://p.test/a': { image: 'https://p.test/a-large.jpg', credit: 'Fuji Sakai' } });
  const pub = new Date(NOW.getTime() - 5 * 3_600_000).toUTCString();
  const wp = `<rss><channel><item><title>Water district warns of shortage</title><link>https://p.test/a/</link><pubDate>${pub}</pubDate><description>Short.</description></item></channel></rss>`;
  const [item] = normaliseLocal([], { name: 'Baguio' }, NOW, 30, [{ publisher: 'Herald', xml: wp }], photos);
  assert.equal(item.image, 'https://p.test/a-large.jpg');
  assert.equal(item.imageCredit, 'Fuji Sakai');
});
