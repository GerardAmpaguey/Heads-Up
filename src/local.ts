// Local news: stories about hazards and disruption in the visitor's city or country, from Google News
// search RSS. These are news reports, not official alerts, and are labelled that way.

import type { LocalItem, Severity } from './alerts.ts';
import { parseFeed } from './news.ts';

export type LocalPlace = { name: string; cc?: string };

const TOPICS = [
  'typhoon', 'tropical storm', 'earthquake', 'flood', 'landslide', 'volcano', 'tsunami', 'wildfire',
  'state of calamity', 'evacuation', 'power outage', 'class suspension', 'heatwave', 'drought', 'outbreak',
  'curfew', 'state of emergency', 'airstrike', 'conflict', 'internet outage',
];

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

/** Google News search (last three days). */
export function searchUrl(place: LocalPlace): string {
  const q = `"${place.name}" (${terms()}) when:3d`;
  const edition = place.cc ? `&hl=en-${place.cc}&gl=${place.cc}&ceid=${place.cc}:en` : '&hl=en&gl=US&ceid=US:en';
  return `https://news.google.com/rss/search?q=${encodeURIComponent(q)}${edition}`;
}

/** Bing News search (past week; older stories are dropped when reading). Used alongside Google, since either can be slow or blocked. */
export function bingUrl(place: LocalPlace): string {
  const q = `"${place.name}" (${terms()})`;
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
const HEADS_UP = /\b(flood\w*|landslide|earthquake|quake|tropical storm|storm|warning|advisory|power outage|blackout|class(es)? suspen\w*|suspension of classes|volcan\w*|wildfire|fire|outbreak|heat ?wave|drought|outage|conflict)\b/i;
const URGENT_MS = 2 * 86_400_000;

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
export function normaliseLocal(xmls: string | string[], place: LocalPlace, now = new Date(), limit = 12): LocalItem[] {
  const seen = new Set<string>();
  const items: LocalItem[] = [];
  for (const e of [xmls].flat().flatMap((xml) => parseFeed(xml, { images: false }))) {
    const publisher = e.publisher || 'News';
    // Google adds " - Publisher" to every headline.
    const suffix = ` - ${publisher}`;
    const title = (e.title.endsWith(suffix) ? e.title.slice(0, -suffix.length) : e.title).trim();
    const key = norm(title);
    if (!title || seen.has(key)) continue;
    seen.add(key);
    const age = now.getTime() - Date.parse(e.time);
    if (age > 3 * 86_400_000 || age < -3_600_000) continue;
    items.push({
      id: `local:${realLink(e.link)}`,
      category: 'hazard',
      kind: 'news',
      severity: rateLocal(title, age),
      title,
      summary: snippet(e.text, title) ?? `News report from ${publisher} about ${place.name}. This is not an official alert, so open the story for details.`,
      action: 'Treat this as news coverage, not an official warning. Check your local government and weather or disaster agency for instructions.',
      source: publisher,
      url: realLink(e.link),
      time: e.time,
      tags: ['Local news'],
    });
  }
  return items.sort((a, b) => Date.parse(b.time) - Date.parse(a.time)).slice(0, limit);
}
