// Local news: stories about hazards and disruption in the visitor's city, anywhere in the world, from
// Google News and Bing News search RSS (plus a few local papers read directly). These are news reports,
// not official alerts, and are labelled that way.

import type { LocalItem, Severity } from './alerts.ts';
import { parseFeed } from './news.ts';

export type LocalPlace = { name: string; cc?: string };

// What to search for. Every place gets the common hazards. A country also gets the storm words its press
// uses (typhoon, hurricane or cyclone) and its own extras. With no country, all three storm words are used.
// "storm" already finds tropical storms. Lists stay short because each word makes the search query longer.
const COMMON = [
  'earthquake', 'flood', 'landslide', 'volcano', 'tsunami', 'wildfire', 'storm', 'evacuation', 'drought',
  'heatwave', 'outbreak', 'power outage', 'internet outage', 'water supply', 'water shortage',
  'state of emergency', 'curfew', 'airstrike', 'road closure',
];

const set = (codes: string) => new Set(codes.split(' '));
// Where tropical storms go by which name in the local press.
const TYPHOON = set('PH JP TW CN HK MO VN KR KP GU MP PW FM MH');
const HURRICANE = set('US MX CU DO HT JM PR BS BZ HN NI GT SV CR PA BB TT AG KY TC VG VI LC VC GD DM KN BM');
const CYCLONE = set('AU NZ IN BD MM LK PK OM YE MZ MG MU RE KM FJ VU NC SB TO WS');

const EXTRA: Record<string, string[]> = {
  PH: ['state of calamity', 'class suspension', 'water interruption', 'groundwater', 'heat index', 'dengue'],
  US: ['tornado', 'blizzard', 'winter storm', 'boil water'],
  CA: ['blizzard', 'winter storm', 'boil water'],
  AU: ['bushfire'],
  NZ: ['state of local emergency'],
  IN: ['monsoon', 'heat stroke', 'dengue'],
  BD: ['monsoon', 'dengue'],
  PK: ['monsoon', 'heat stroke'],
  ID: ['eruption', 'dengue'],
  JP: ['heavy rain', 'heatstroke'],
  GB: ['flood warning', 'weather warning'],
  IE: ['weather warning'],
};

/** Search words for a country, the most telling first. */
export function topicsFor(cc?: string): string[] {
  const storms = !cc
    ? ['typhoon', 'hurricane', 'cyclone']
    : [...(TYPHOON.has(cc) ? ['typhoon'] : []), ...(HURRICANE.has(cc) ? ['hurricane'] : []), ...(CYCLONE.has(cc) ? ['cyclone'] : [])];
  return [...new Set([...storms, ...COMMON, ...(cc ? EXTRA[cc] ?? [] : [])])];
}

// Google News and Bing News run English editions for these countries. Anywhere else, the international
// English edition is used: it still finds English coverage of the place.
const GOOGLE_EN = set('AU BW CA ET GH IE IL IN ID KE LV MY NA NG NZ PH PK SG TZ UG GB US ZA ZW');
const BING_EN = set('AU CA GB ID IN MY NZ PH US ZA');

/** Local newspapers read directly, because search engines often miss them or bury them. A paper's feed is
 *  used for the places it covers, and everything in it counts as being about that area. */
export type LocalFeed = { publisher: string; urls: string[]; places: string[]; wp?: string };
export const LOCAL_FEEDS: LocalFeed[] = [
  {
    publisher: 'Baguio Herald Express',
    // The main feed holds only the latest ten stories, so the City section and a second page are read too.
    urls: ['https://baguioheraldexpressonline.com/feed/', 'https://baguioheraldexpressonline.com/feed/?paged=2', 'https://baguioheraldexpressonline.com/category/city/feed/'],
    // This paper's feed carries no pictures, but its WordPress API gives each story's featured image.
    wp: 'https://baguioheraldexpressonline.com/wp-json/wp/v2/posts?per_page=40&_embed=wp:featuredmedia&_fields=link,_links,_embedded',
    places: ['baguio', 'benguet', 'la trinidad', 'itogon', 'tuba', 'sablan', 'tublay'],
  },
];

export type Photos = Record<string, { image: string; credit?: string }>;
const linkKey = (u: string) => u.replace(/[?#].*$/, '').replace(/\/+$/, '').toLowerCase();

/** Featured images from a WordPress posts response, keyed by story link. Only https pictures are kept. */
export function wpPhotos(json: unknown): Photos {
  const out: Photos = {};
  if (!Array.isArray(json)) return out;
  for (const p of json as Record<string, any>[]) {
    const media = p?._embedded?.['wp:featuredmedia']?.[0];
    const src = media?.media_details?.sizes?.large?.source_url ?? media?.source_url;
    if (typeof p?.link !== 'string' || typeof src !== 'string' || !src.startsWith('https://')) continue;
    const caption = typeof media?.caption?.rendered === 'string' ? media.caption.rendered.replace(/<[^>]*>/g, '').replace(/[^\p{L}\p{N} .,'’&()-]/gu, '').replace(/^(photo|photos|image|credit|courtesy)\s*(by|:)?\s*/i, '').trim() : '';
    out[linkKey(p.link)] = { image: src, ...(caption.length > 1 && caption.length <= 60 ? { credit: caption } : {}) };
  }
  return out;
}

export function localFeedsFor(place: LocalPlace): LocalFeed[] {
  // Whole names only: "Tuba" must not match "Tubao", and "Baguio City" counts as Baguio.
  const n = place.name.toLowerCase().replace(/^city of /, '').replace(/ city$/, '').trim();
  return LOCAL_FEEDS.filter((f) => f.places.includes(n));
}

const NAME_OK = /^[\p{L}\p{N} .'’()-]{2,60}$/u;
const CC_OK = /^[A-Za-z]{2}$/;

/** Clean a place name from the query string or Cloudflare. Returns null if it looks wrong. */
export function placeName(raw: string | null | undefined): string | null {
  const s = (raw ?? '').trim().replace(/\s+/g, ' ');
  return NAME_OK.test(s) ? s : null;
}

export function countryCode(raw: string | null | undefined): string | undefined {
  return raw && CC_OK.test(raw) ? raw.toUpperCase() : undefined;
}

const terms = (cc?: string) => topicsFor(cc).map((t) => (t.includes(' ') ? `"${t}"` : t)).join(' OR ');

/** What to ask for: hazard stories, or any news about the place. */
export type Mode = 'hazard' | 'general';

/** Google News search, in the country's English edition when there is one. */
export function searchUrl(place: LocalPlace, mode: Mode = 'hazard'): string {
  const q = mode === 'hazard' ? `"${place.name}" (${terms(place.cc)}) when:3d` : `"${place.name}" when:7d`;
  const cc = place.cc && GOOGLE_EN.has(place.cc) ? place.cc : 'US';
  return `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-${cc}&gl=${cc}&ceid=${cc}:en`;
}

/** Bing News search (past week; older stories are dropped when reading). Used alongside Google, since either can be slow or blocked. */
export function bingUrl(place: LocalPlace, mode: Mode = 'hazard'): string {
  const q = mode === 'hazard' ? `"${place.name}" (${terms(place.cc)})` : `"${place.name}"`;
  const market = place.cc && BING_EN.has(place.cc) ? `&setmkt=en-${place.cc}` : '';
  return `https://www.bing.com/news/search?q=${encodeURIComponent(q)}&format=rss&qft=${encodeURIComponent('interval="8"')}${market}`;
}

/** Bing wraps each story link in a tracking redirect that carries the real address. */
export function realLink(link: string): string {
  try {
    const u = new URL(link);
    if (/(^|\.)bing\.com$/i.test(u.hostname)) {
      const target = u.searchParams.get('url');
      const t = target ? new URL(target) : null;
      if (t && (t.protocol === 'https:' || t.protocol === 'http:')) return t.href;
    }
  } catch {}
  return link;
}

export const cacheKey = (place: LocalPlace) => `https://local-news.cache/${place.cc ?? 'xx'}/${encodeURIComponent(place.name.toLowerCase())}`;

// Words from storm and disaster coverage around the world: typhoons in Asia, hurricanes in the Americas,
// cyclones around the Indian Ocean and the South Pacific, plus the warnings each country issues.
const URGENT = /\b(super typhoon|typhoon|hurricane|(tropical )?cyclone|signal no\.? ?[345]|category [345]|tsunami|landfall|evacuat\w*|state of (calamity|emergency|disaster|local emergency)|eruption|erupt\w*|magnitude [6-9](\.\d)?|airstrike|missile (alert|warning|strike|attack)|curfew|death toll|tornado (warning|emergency)|red (warning|alert)|emergency warning|bushfire emergency)\b/i;
const HEADS_UP = /\b(flood\w*|landslide|mudslide|earthquake|quake|tropical storm|storm|warning|advisory|power outage|power cuts?|blackout|load[- ]?shedding|class(es)? suspen\w*|suspension of classes|school closures?|volcan\w*|wildfire|bushfire|fire|outbreak|drought|outage|groundwater|water (supply|shortage|crisis|interruption|restrictions?)|boil[- ]water|supply risks?|shortage|heat ?wave|heat index|heatstroke|heat stroke|extreme heat|tornado|blizzard|snowstorm|ice storm|avalanche|hailstorm|monsoon|smog|haze|air quality|dengue|cholera|measles|rabies|road closure|rockslide|sinkhole|el ni[ñn]o|la ni[ñn]a|supply measures)\b/i;
const URGENT_MS = 2 * 86_400_000;
const HAZARD_MS = 3 * 86_400_000; // older hazard stories are no longer "heads up"
// Sports pages love words like "storm", "fire" and "flood".
const SPORTS = /\b(nba|nfl|nhl|mlb|ncaa|playoffs?|championship|quarterback|touchdown|coach|tournament|goal|league|fixture|basketball|volleyball|boxing|esports)\b/i;
// Showbiz, shopping and puff pieces are not what someone reads local news to find.
const SOFT = /\b(showbiz|celebrity|celebrities|concert|album|movie|film review|horoscope|lotto|lottery results?|pageant|sale|promo|discount|giveaway|recipe|fashion|k-?pop|teleserye|actress|actor)\b/i;

export function rateLocal(title: string, ageMs: number): Severity {
  if (URGENT.test(title)) return ageMs > URGENT_MS ? 'heads-up' : 'urgent';
  if (HEADS_UP.test(title)) return 'heads-up';
  return 'fyi';
}

/** Bing gives a real snippet. Google's description just repeats the headline, so that is ignored. */
const snippet = (text: string, title: string): string | null =>
  text && text.length > 40 && !text.toLowerCase().startsWith(title.toLowerCase().slice(0, 30)) ? text : null;

const norm = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
/** Lower case without accents, so "Zurich" in a headline still counts as being about Zürich. */
const fold = (t: string) => t.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase();

/** Turn Google and Bing News search feeds (and any local papers) into local items, newest first. Duplicate headlines are dropped. */
export function normaliseLocal(xmls: string | string[], place: LocalPlace, now = new Date(), limit = 30, papers: { publisher: string; xml: string }[] = [], photos: Photos = {}): LocalItem[] {
  const seen = new Set<string>();
  const items: LocalItem[] = [];
  const found = [
    ...[xmls].flat().flatMap((xml) => parseFeed(xml).map((e) => ({ e, paper: false }))),
    ...papers.flatMap((p) => parseFeed(p.xml).map((e) => ({ e: { ...e, publisher: e.publisher || p.publisher }, paper: true }))),
  ];
  for (const { e, paper } of found) {
    const publisher = e.publisher || 'News';
    // Google adds " - Publisher" to every headline.
    const suffix = ` - ${publisher}`;
    const title = (e.title.endsWith(suffix) ? e.title.slice(0, -suffix.length) : e.title).trim();
    const key = norm(title);
    if (!title || seen.has(key) || SPORTS.test(title) || SOFT.test(title)) continue;
    seen.add(key);
    const age = now.getTime() - Date.parse(e.time);
    if (age > 7 * 86_400_000 || age < -3_600_000) continue;
    // Search results are loose. A story must be about the place (or, for hazards, about somewhere close by).
    // Hazard stories keep their rating; other stories that name the place are kept as FYI. A hazard story
    // that does not name the place counts one step lower, and is dropped if that leaves nothing.
    const mentions = paper || fold(`${title} ${e.text}`).includes(fold(place.name));
    let severity = rateLocal(title, age);
    if (severity !== 'fyi' && age > HAZARD_MS) severity = 'fyi';
    if (!mentions) severity = severity === 'urgent' ? 'heads-up' : 'fyi';
    if (severity === 'fyi' && !mentions) continue;
    items.push({
      id: `local:${realLink(e.link)}`,
      category: 'hazard',
      kind: 'news',
      severity,
      title,
      summary: snippet(e.text, title) ?? `News report from ${publisher} about ${place.name}. This is not an official alert, so open the story for details.`,
      action: severity === 'fyi' ? 'Local news for your area. No action needed.' : 'Treat this as news coverage, not an official warning. Check your local government and weather or disaster agency for instructions.',
      source: publisher,
      url: realLink(e.link),
      time: e.time,
      ...(photos[linkKey(e.link)] ? { image: photos[linkKey(e.link)]!.image, imageCredit: photos[linkKey(e.link)]!.credit ?? publisher } : e.image ? { image: e.image, imageCredit: publisher } : {}),
      tags: ['Local news'],
    });
  }
  return items.sort((a, b) => Date.parse(b.time) - Date.parse(a.time)).slice(0, limit);
}
