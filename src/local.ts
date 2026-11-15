// Local news: stories about hazards and disruption in the visitor's city or country, from Google News
// search RSS. These are news reports, not official alerts, and are labelled that way.

import type { LocalItem, Severity } from './alerts.ts';
import { parseFeed } from './news.ts';

export type LocalPlace = { name: string; cc?: string };

const TOPICS = [
  'typhoon', 'tropical storm', 'earthquake', 'flood', 'landslide', 'volcano', 'tsunami', 'wildfire',
  'state of calamity', 'evacuation', 'power outage', 'class suspension', 'drought', 'outbreak',
  'curfew', 'state of emergency', 'airstrike', 'internet outage',
  'water supply', 'water shortage', 'water interruption', 'groundwater', 'heat index', 'dengue', 'road closure',
];

/** Local newspapers read directly, because search engines often miss them or bury them. A paper's feed is
 *  used for the places it covers, and everything in it counts as being about that area. */
export type LocalFeed = { publisher: string; urls: string[]; places: string[] };
export const LOCAL_FEEDS: LocalFeed[] = [
  {
    publisher: 'Baguio Herald Express',
    // The main feed holds only the latest ten stories, so the City section and a second page are read too.
    urls: ['https://baguioheraldexpressonline.com/feed/', 'https://baguioheraldexpressonline.com/feed/?paged=2', 'https://baguioheraldexpressonline.com/category/city/feed/'],
    places: ['baguio', 'benguet', 'la trinidad', 'itogon', 'tuba', 'sablan', 'tublay', 'bauang', 'la union', 'san fernando', 'cordillera'],
  },
];

export function localFeedsFor(place: LocalPlace): LocalFeed[] {
  const n = place.name.toLowerCase();
  return LOCAL_FEEDS.filter((f) => f.places.some((p) => n.includes(p)));
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

const terms = () => TOPICS.map((t) => (t.includes(' ') ? `"${t}"` : t)).join(' OR ');

/** What to ask for: hazard stories, or any news about the place. */
export type Mode = 'hazard' | 'general';

/** Google News search. */
export function searchUrl(place: LocalPlace, mode: Mode = 'hazard'): string {
  const q = mode === 'hazard' ? `"${place.name}" (${terms()}) when:3d` : `"${place.name}" when:7d`;
  const edition = place.cc ? `&hl=en-${place.cc}&gl=${place.cc}&ceid=${place.cc}:en` : '&hl=en&gl=US&ceid=US:en';
  return `https://news.google.com/rss/search?q=${encodeURIComponent(q)}${edition}`;
}

/** Bing News search (past week; older stories are dropped when reading). Used alongside Google, since either can be slow or blocked. */
export function bingUrl(place: LocalPlace, mode: Mode = 'hazard'): string {
  const q = mode === 'hazard' ? `"${place.name}" (${terms()})` : `"${place.name}"`;
  const market = place.cc ? `&setmkt=en-${place.cc}` : '';
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

const URGENT = /\b(super typhoon|typhoon|signal no\.? ?[345]|tsunami|landfall|evacuat\w*|state of calamity|state of emergency|eruption|erupt\w*|magnitude [6-9](\.\d)?|airstrike|curfew|death toll)\b/i;
const HEADS_UP = /\b(flood\w*|landslide|earthquake|quake|tropical storm|storm|warning|advisory|power outage|blackout|class(es)? suspen\w*|suspension of classes|volcan\w*|wildfire|fire|outbreak|drought|outage|groundwater|water (supply|shortage|crisis|interruption)|supply risks?|shortage|heat index|dengue|rabies|road closure|rockslide|sinkhole|el ni[ñn]o|la ni[ñn]a|supply measures)\b/i;
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

/** Turn a Google News search feed into local items, newest first. Duplicate headlines are dropped. */
export function normaliseLocal(xmls: string | string[], place: LocalPlace, now = new Date(), limit = 30, papers: { publisher: string; xml: string }[] = []): LocalItem[] {
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
    const mentions = paper || `${title} ${e.text}`.toLowerCase().includes(place.name.toLowerCase());
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
      ...(e.image ? { image: e.image, imageCredit: publisher } : {}),
      tags: ['Local news'],
    });
  }
  return items.sort((a, b) => Date.parse(b.time) - Date.parse(a.time)).slice(0, limit);
}
