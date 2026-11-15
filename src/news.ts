// Web dev and AI news: a small RSS/Atom reader, the list of feeds, and plain keyword rules that
// decide how urgent an item is. No network code lives here, so it is easy to test.

import type { NewsItem, Severity } from './alerts.ts';

export type Entry = { title: string; link: string; time: string; text: string; image?: string };

export type FeedDef = {
  id: string;
  name: string; // shown as the source
  url: string;
  category: 'webdev' | 'ai';
  kind: 'release' | 'security' | 'news';
  tags: string[]; // watchlist tags this feed always carries
  label?: string; // GitHub releases: product name used to build the headline
  github?: boolean; // GitHub release feed: its thumbnails are avatars, never use them
  only?: RegExp; // keep only titles matching
  skip?: RegExp; // drop titles matching (betas, canaries)
};

const PRERELEASE = /\b(canary|alpha|beta|rc ?\d*|release candidate|nightly|preview)\b/i;

export const FEEDS: FeedDef[] = [
  { id: 'wp-news', name: 'WordPress News', url: 'https://wordpress.org/news/feed/', category: 'webdev', kind: 'release', tags: ['WordPress'], skip: PRERELEASE },
  { id: 'wordfence', name: 'Wordfence', url: 'https://www.wordfence.com/blog/feed/', category: 'webdev', kind: 'security', tags: ['WordPress'] },
  { id: 'sucuri', name: 'Sucuri', url: 'https://blog.sucuri.net/feed', category: 'webdev', kind: 'security', tags: [] },
  { id: 'astro', name: 'Astro releases', url: 'https://github.com/withastro/astro/releases.atom', category: 'webdev', kind: 'release', tags: ['Astro'], label: 'Astro', github: true, only: /^astro@/i, skip: PRERELEASE },
  { id: 'nextjs', name: 'Next.js releases', url: 'https://github.com/vercel/next.js/releases.atom', category: 'webdev', kind: 'release', tags: ['Next.js'], label: 'Next.js', github: true, skip: PRERELEASE },
  { id: 'tailwind', name: 'Tailwind CSS releases', url: 'https://github.com/tailwindlabs/tailwindcss/releases.atom', category: 'webdev', kind: 'release', tags: ['Tailwind'], label: 'Tailwind CSS', github: true, skip: PRERELEASE },
  { id: 'wrangler', name: 'Wrangler releases', url: 'https://github.com/cloudflare/workers-sdk/releases.atom', category: 'webdev', kind: 'release', tags: ['Cloudflare'], label: 'Wrangler', github: true, only: /^wrangler@/i, skip: PRERELEASE },
  { id: 'elementor', name: 'Elementor', url: 'https://elementor.com/blog/feed/', category: 'webdev', kind: 'news', tags: ['Elementor'] },
  { id: 'figma', name: 'Figma', url: 'https://www.figma.com/blog/feed/atom.xml', category: 'webdev', kind: 'news', tags: ['Figma'] },
  { id: 'openai', name: 'OpenAI', url: 'https://openai.com/news/rss.xml', category: 'ai', kind: 'news', tags: [] },
  { id: 'deepmind', name: 'Google DeepMind', url: 'https://deepmind.google/blog/rss.xml', category: 'ai', kind: 'news', tags: [] },
  { id: 'huggingface', name: 'Hugging Face', url: 'https://huggingface.co/blog/feed.xml', category: 'ai', kind: 'news', tags: [] },
];

// ---------- reading RSS and Atom ----------

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };

export function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === '#') {
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : whole;
    }
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}

const unwrap = (s: string) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');

/** Raw inner text of the first <name>…</name> in a block, with CDATA unwrapped (not yet entity-decoded). */
function inner(block: string, name: string): string | null {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i').exec(block);
  return m ? unwrap(m[1]) : null;
}

function attr(tag: string, name: string): string | null {
  const m = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(tag);
  return m ? decode(m[2] ?? m[3] ?? '') : null;
}

const httpUrl = (u: string | null | undefined): string | null => {
  if (!u) return null;
  try {
    const url = new URL(u.trim());
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
};

const httpsUrl = (u: string | null | undefined): string | null => {
  const url = httpUrl(u);
  return url && url.startsWith('https:') ? url : null;
};

export function plainText(html: string): string {
  return decode(decode(html).replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function shorten(s: string, max = 230): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), max - 40)).replace(/[\s,;:.–—-]+$/, '')}…`;
}

function linkOf(block: string): string | null {
  for (const m of block.matchAll(/<link\b[^>]*>/gi)) {
    const rel = attr(m[0], 'rel');
    const href = attr(m[0], 'href');
    if (href && (!rel || rel === 'alternate')) return httpUrl(href);
  }
  const text = inner(block, 'link');
  return text ? httpUrl(decode(text)) : null;
}

function imageOf(block: string): string | undefined {
  for (const m of block.matchAll(/<media:(?:content|thumbnail)\b[^>]*>/gi)) {
    const type = attr(m[0], 'type');
    const medium = attr(m[0], 'medium');
    if ((type && !type.startsWith('image/')) || (medium && medium !== 'image')) continue;
    const u = httpsUrl(attr(m[0], 'url'));
    if (u) return u;
  }
  for (const m of block.matchAll(/<enclosure\b[^>]*>/gi)) {
    if (attr(m[0], 'type')?.startsWith('image/')) {
      const u = httpsUrl(attr(m[0], 'url'));
      if (u) return u;
    }
  }
  const body = unwrap(inner(block, 'content:encoded') ?? inner(block, 'description') ?? inner(block, 'content') ?? '');
  for (const img of decode(body).matchAll(/<img\b[^>]*>/gi)) {
    const u = httpsUrl(attr(img[0], 'src'));
    if (u) return u;
  }
  return undefined;
}

/** Entries of an RSS or Atom document. Tolerant: entries missing a title, link or date are skipped. */
export function parseFeed(xml: string, { images = true }: { images?: boolean } = {}): Entry[] {
  const out: Entry[] = [];
  for (const m of xml.matchAll(/<(item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi)) {
    const block = m[2];
    const title = plainText(inner(block, 'title') ?? '');
    const link = linkOf(block);
    const when = decode(unwrap(inner(block, 'pubDate') ?? inner(block, 'published') ?? inner(block, 'updated') ?? inner(block, 'dc:date') ?? '')).trim();
    const ms = Date.parse(when);
    if (!title || !link || !Number.isFinite(ms)) continue;
    const text = shorten(plainText(inner(block, 'description') ?? inner(block, 'summary') ?? inner(block, 'content:encoded') ?? inner(block, 'content') ?? ''));
    out.push({ title, link, time: new Date(ms).toISOString(), text, image: images ? imageOf(block) : undefined });
  }
  return out;
}

// ---------- how urgent is it? ----------

const CRITICAL = /\b(zero[- ]?day|0[- ]?day|actively exploited|being (actively )?(exploited|attacked)|under (active )?attack|critical (vulnerabilit\w*|flaw|security|severity)|remote code execution|supply[- ]chain (attack|compromise)|mass(ive)? (compromise|exploitation)|emergency (patch|update|release|fix))\b/i;
const SECURITY = /\b(security (release|update|fix|patch|advisory|issue)|vulnerab\w*|cve-\d{4}-\d+|exploit\w*|malware|backdoor|compromised|breach|xss|sql injection|privilege escalation|hacked)\b/i;
const CHANGE = /\b(breaking change|deprecat\w*|end[- ]of[- ]life|sunset\w*|retir(e|es|ed|ing|ement)|discontinu\w*|shut(ting)? down)\b/i;
const MAJOR = /(?<![\d.])\d+\.0(\.0)?(?![\d.])/;

export function rate(def: Pick<FeedDef, 'category' | 'kind'>, title: string, text: string): { severity: Severity; action: string } {
  const all = `${title} ${text}`;
  const critical = CRITICAL.test(all);
  const security = SECURITY.test(all);
  const change = CHANGE.test(all);

  let severity: Severity = 'fyi';
  if (def.category === 'webdev') {
    if (critical && (def.kind === 'security' || security)) severity = 'urgent';
    else if (security || change) severity = 'heads-up';
    else if (def.kind === 'release' && MAJOR.test(title)) severity = 'heads-up';
  } else if (security || change) {
    severity = 'heads-up';
  }

  let action: string;
  if (severity === 'urgent') action = 'If you run the affected software, update it now, then check your sites for signs of a break-in. Back up first.';
  else if (security) action = 'Check whether you run the affected software and update it soon. Back up before you do.';
  else if (change) action = 'Check whether this affects your projects and plan the change before it is forced on you.';
  else if (def.category === 'ai') action = 'Worth a skim. No action needed unless you use this tool.';
  else if (def.kind === 'release') action = 'Read the release notes, then try the update on a staging copy before it goes live.';
  else action = 'Worth a look if you use it. No action needed.';
  return { severity, action };
}

const TAG_HINTS: [string, RegExp][] = [
  ['WordPress', /\bwordpress\b|\bwoocommerce\b|\bgutenberg\b/i],
  ['Elementor', /\belementor\b/i],
  ['Astro', /\bastro\b/i],
  ['Next.js', /\bnext\.?js\b/i],
  ['Tailwind', /\btailwind\w*\b/i],
  ['Cloudflare', /\bcloudflare\b|\bwrangler\b/i],
  ['PHP', /\bphp\b/i],
  ['Figma', /\bfigma\b/i],
];

export function tagsFor(def: Pick<FeedDef, 'tags'>, title: string, text: string): string[] {
  const found = new Set(def.tags);
  for (const [tag, re] of TAG_HINTS) if (re.test(title) || re.test(text)) found.add(tag);
  return [...found];
}

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

function headline(def: FeedDef, title: string): string {
  if (!def.label) return title;
  const v = /(\d+\.\d+(?:\.\d+)?[\w.-]*)\s*$/.exec(title);
  return v ? `${def.label} ${v[1]} released` : `${def.label}: ${title}`;
}

const PER_FEED = 8;

/** Turn one feed's XML into items, newest first. */
export function normaliseFeed(def: FeedDef, xml: string): NewsItem[] {
  const items: NewsItem[] = [];
  for (const e of parseFeed(xml, { images: !def.github })) {
    if (def.only && !def.only.test(e.title)) continue;
    if (def.skip && def.skip.test(e.title)) continue;
    const { severity, action } = rate(def, e.title, e.text);
    items.push({
      id: `feed:${def.id}:${e.link}`,
      category: def.category,
      severity,
      title: clean(headline(def, e.title)),
      summary: e.text || `New from ${def.name}.`,
      action,
      source: def.name,
      url: e.link,
      time: e.time,
      tags: tagsFor(def, e.title, e.text),
      image: e.image,
      imageCredit: e.image ? def.name : undefined,
    });
  }
  return items.sort((a, b) => Date.parse(b.time) - Date.parse(a.time)).slice(0, PER_FEED);
}

// ---------- end-of-life dates (endoflife.date) ----------

export const EOL_PRODUCTS = [
  { product: 'php', name: 'PHP', tags: ['PHP'] },
  { product: 'nodejs', name: 'Node.js', tags: [] as string[] },
];

const DAY = 86_400_000;
const fmtDate = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/** Versions that stop getting security fixes within the next 120 days, or did in the last 30. */
export function normaliseEol(product: (typeof EOL_PRODUCTS)[number], json: unknown, now = new Date()): NewsItem[] {
  const rows = Array.isArray(json) ? json : ((json as { result?: { releases?: unknown[] } } | null)?.result?.releases ?? []);
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const items: NewsItem[] = [];
  for (const row of rows as Record<string, unknown>[]) {
    const cycle = String(row?.cycle ?? row?.name ?? '').trim();
    const raw = row?.eol ?? row?.eolFrom;
    if (!cycle || typeof raw !== 'string') continue; // false or missing means no end date yet
    const eol = Date.parse(`${raw}T00:00:00Z`);
    if (!Number.isFinite(eol)) continue;
    const days = Math.round((eol - today) / DAY);
    if (days > 120 || days < -30) continue;
    const date = fmtDate(new Date(eol));
    const past = days < 0;
    items.push({
      id: `eol:${product.product}:${cycle}`,
      category: 'webdev',
      severity: past || days <= 60 ? 'heads-up' : 'fyi',
      title: `${product.name} ${cycle} ${past ? 'reached' : 'reaches'} end of life on ${date}`,
      summary: past
        ? `${product.name} ${cycle} no longer gets security fixes. Sites still running it are exposed to new vulnerabilities.`
        : `After ${date}, ${product.name} ${cycle} stops getting security fixes. Sites still running it will be exposed to new vulnerabilities.`,
      action: `Check which of your sites run ${product.name} ${cycle}, ask the host to move them to a supported version, and test first.`,
      source: 'endoflife.date',
      url: `https://endoflife.date/${product.product}`,
      time: new Date(today).toISOString(),
      tags: product.tags,
    });
  }
  return items;
}
