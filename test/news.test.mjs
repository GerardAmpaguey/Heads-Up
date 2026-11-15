import test from 'node:test';
import assert from 'node:assert/strict';
import { FEEDS, decode, normaliseEol, normaliseFeed, parseFeed, rate, tagsFor } from '../src/news.ts';

const NOW = new Date('2026-11-15T12:00:00Z');
const def = (id) => FEEDS.find((f) => f.id === id);

const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/">
<channel><title>Blog</title><link>https://blog.test/</link>
<item>
  <title><![CDATA[Critical vulnerability in &quot;Fancy Forms&quot; is being exploited]]></title>
  <link>https://blog.test/fancy-forms?utm=1&amp;x=2</link>
  <pubDate>Sat, 14 Nov 2026 10:00:00 GMT</pubDate>
  <description><![CDATA[<p>Attackers are <b>actively exploited</b> this flaw &amp; installing backdoors.</p>]]></description>
  <media:content url="https://cdn.blog.test/fancy.jpg" medium="image" />
</item>
<item>
  <title>No link here</title>
  <pubDate>Sat, 14 Nov 2026 10:00:00 GMT</pubDate>
</item>
<item>
  <title>Weekly roundup</title>
  <link>https://blog.test/roundup</link>
  <dc:date>2026-11-13T08:00:00Z</dc:date>
  <content:encoded><![CDATA[<img src="http://insecure.test/a.png"><img src="https://blog.test/b.png"><p>Plain news.</p>]]></content:encoded>
</item>
<item><title>Bad date</title><link>https://blog.test/bad</link><pubDate>whenever</pubDate></item>
</channel></rss>`;

const atom = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/">
<entry><id>tag:1</id><updated>2026-11-14T09:00:00Z</updated>
 <link rel="alternate" type="text/html" href="https://github.com/withastro/astro/releases/tag/astro%406.2.0"/>
 <title>astro@6.2.0</title>
 <content type="html">&lt;h2&gt;Minor Changes&lt;/h2&gt;&lt;p&gt;Adds a new thing.&lt;/p&gt;</content>
 <media:thumbnail height="30" width="30" url="https://avatars.githubusercontent.com/u/1?s=60&amp;v=4"/></entry>
<entry><id>tag:2</id><updated>2026-11-14T08:00:00Z</updated>
 <link rel="alternate" type="text/html" href="https://github.com/withastro/astro/releases/tag/%40astrojs%2Fsitemap%403.0.0"/>
 <title>@astrojs/sitemap@3.0.0</title><content type="html">x</content></entry>
<entry><id>tag:3</id><updated>2026-11-13T08:00:00Z</updated>
 <link rel="alternate" type="text/html" href="https://github.com/withastro/astro/releases/tag/astro%407.0.0"/>
 <title>astro@7.0.0</title><content type="html">Big release</content></entry>
<entry><id>tag:4</id><updated>2026-11-12T08:00:00Z</updated>
 <link rel="alternate" type="text/html" href="https://github.com/withastro/astro/releases/tag/astro%407.1.0-beta.1"/>
 <title>astro@7.1.0-beta.1</title><content type="html">Beta</content></entry>
</feed>`;

test('decode handles named, numeric and hex entities and leaves unknown ones alone', () => {
  assert.equal(decode('a &amp; b &#39;c&#39; &#x2014; &bogus;'), "a & b 'c' — &bogus;");
});

test('parseFeed reads RSS: CDATA, entities, dates, links, images; skips broken entries', () => {
  const entries = parseFeed(rss);
  assert.equal(entries.length, 2);
  const [a, b] = entries;
  assert.equal(a.title, 'Critical vulnerability in "Fancy Forms" is being exploited');
  assert.equal(a.link, 'https://blog.test/fancy-forms?utm=1&x=2');
  assert.equal(a.time, '2026-11-14T10:00:00.000Z');
  assert.equal(a.text, 'Attackers are actively exploited this flaw & installing backdoors.');
  assert.equal(a.image, 'https://cdn.blog.test/fancy.jpg');
  assert.equal(b.time, '2026-11-13T08:00:00.000Z');
  assert.equal(b.image, 'https://blog.test/b.png', 'http images are never used, the first https one is');
});

test('parseFeed reads Atom and can ignore thumbnails (GitHub avatars)', () => {
  const withImages = parseFeed(atom);
  assert.equal(withImages[0].link, 'https://github.com/withastro/astro/releases/tag/astro%406.2.0');
  assert.equal(withImages[0].image, 'https://avatars.githubusercontent.com/u/1?s=60&v=4');
  assert.equal(parseFeed(atom, { images: false })[0].image, undefined);
});

test('parseFeed is safe on junk', () => {
  assert.deepEqual(parseFeed(''), []);
  assert.deepEqual(parseFeed('<html>not a feed</html>'), []);
  assert.deepEqual(parseFeed('<item><title>x</title><link>javascript:alert(1)</link><pubDate>2026-11-14</pubDate></item>'), []);
});

test('github release feeds: filter by package, drop betas, build a readable headline, never use avatars', () => {
  const items = normaliseFeed(def('astro'), atom, NOW);
  assert.equal(items.length, 2);
  assert.equal(items[0].title, 'Astro 6.2.0 released');
  assert.equal(items[0].image, undefined);
  assert.equal(items[0].severity, 'fyi');
  assert.equal(items[1].severity, 'heads-up', 'a new major version is worth a look');
  assert.deepEqual(items[0].tags, ['Astro']);
  assert.match(items[0].action, /staging/);
});

test('rating: exploited critical flaws are urgent, security fixes are heads-up, plain news is fyi', () => {
  const sec = def('wordfence');
  assert.equal(rate(sec, 'Critical vulnerability in Fancy Forms', 'being actively exploited').severity, 'urgent');
  assert.equal(rate(sec, 'Vulnerability in Plugin X', 'allows XSS').severity, 'heads-up');
  assert.equal(rate(sec, 'How we think about hosting', 'A friendly post.').severity, 'fyi');
  assert.equal(rate(def('wp-news'), 'WordPress 6.9.1 Security Release', 'fixes a security issue').severity, 'heads-up');
  assert.equal(rate(def('figma'), 'Figma deprecates the old API', 'It will be retired.').severity, 'heads-up');
  assert.equal(rate(def('openai'), 'A new model', 'Faster and cheaper.').severity, 'fyi');
  assert.equal(rate(def('openai'), 'Critical vulnerability found', 'zero-day').severity, 'heads-up', 'AI news is never urgent');
});

test('rss security feed end to end', () => {
  const [a, b] = normaliseFeed(def('wordfence'), rss, NOW);
  assert.equal(a.severity, 'urgent');
  assert.equal(a.category, 'webdev');
  assert.equal(a.source, 'Wordfence');
  assert.equal(a.imageCredit, 'Wordfence');
  assert.match(a.action, /update it now/i);
  assert.equal(b.severity, 'fyi');
  assert.deepEqual(a.tags, ['WordPress']);
});

test('tags: feed tags plus mentions in the text', () => {
  assert.deepEqual(tagsFor({ tags: [] }, 'Hacked WordPress sites run old PHP', 'on Cloudflare'), ['WordPress', 'Cloudflare', 'PHP']);
  assert.deepEqual(tagsFor({ tags: ['Astro'] }, 'Astro 6', ''), ['Astro']);
});

test('end of life: only versions ending within 120 days (or just ended) are shown', () => {
  const now = new Date('2026-11-15T12:00:00Z');
  const php = { product: 'php', name: 'PHP', tags: ['PHP'] };
  const items = normaliseEol(php, [
    { cycle: '8.1', eol: '2026-10-25' }, // ended 21 days ago
    { cycle: '8.0', eol: '2026-01-01' }, // long ago
    { cycle: '8.2', eol: '2026-12-31' }, // 46 days
    { cycle: '8.3', eol: '2027-03-01' }, // 106 days
    { cycle: '8.4', eol: '2028-12-31' }, // far
    { cycle: '8.5', eol: false },
  ], now);
  assert.deepEqual(items.map((i) => [i.id, i.severity]), [['eol:php:8.1', 'heads-up'], ['eol:php:8.2', 'heads-up'], ['eol:php:8.3', 'fyi']]);
  assert.equal(items[0].title, 'PHP 8.1 reached end of life on 25 Oct 2026');
  assert.equal(items[1].title, 'PHP 8.2 reaches end of life on 31 Dec 2026');
  assert.deepEqual(items[1].tags, ['PHP']);
  // the newer endoflife.date API shape works too
  const v1 = normaliseEol(php, { result: { releases: [{ name: '8.2', eolFrom: '2026-12-31' }] } }, now);
  assert.equal(v1.length, 1);
  assert.deepEqual(normaliseEol(php, null, now), []);
});

test('every feed id is unique and every url is https', () => {
  assert.equal(new Set(FEEDS.map((f) => f.id)).size, FEEDS.length);
  assert.ok(FEEDS.every((f) => f.url.startsWith('https://')));
});

test('urgent news cools to heads-up after four days', () => {
  const later = new Date('2026-11-20T12:00:00Z'); // the exploited-flaw post is 6 days old
  const [a] = normaliseFeed(def('wordfence'), rss, later);
  assert.equal(a.severity, 'heads-up');
  assert.doesNotMatch(a.action, /update it now/i);
  assert.equal(normaliseFeed(def('wordfence'), rss, NOW)[0].severity, 'urgent');
});
