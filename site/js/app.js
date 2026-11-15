import { ITEMS, CATEGORIES, SEVERITY, STACK } from './data.js';

const main = document.getElementById('main');
const sheet = document.getElementById('sheet');

/* ---------- small helpers ---------- */

function el(tag, attrs = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v; // only ever fed the static icon strings below
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    node.append(kid.nodeType ? kid : document.createTextNode(kid));
  }
  return node;
}

function ago(minutes) {
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 1440) return `${Math.round(minutes / 60)} h ago`;
  return `${Math.round(minutes / 1440)} d ago`;
}

const ICONS = {
  hazard: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.2 21.6 20H2.4z"/><path d="M12 10v4.5"/><circle cx="12" cy="17.2" r=".6" fill="currentColor"/></svg>',
  webdev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m8 7-5 5 5 5M16 7l5 5-5 5M13.6 4.5l-3.2 15"/></svg>',
  ai: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 3.5 13 9l5.5 2-5.5 2-2 5.5L9 13 3.5 11 9 9z"/><path d="M19 3v4M17 5h4M18.5 16v3.5M16.8 17.8h3.4"/></svg>',
};

/* ---------- state ---------- */

const WATCH_KEY = 'headsup.watchlist';
let memoryWatch = null;

function loadWatch() {
  try {
    const raw = localStorage.getItem(WATCH_KEY);
    if (raw) return new Set(JSON.parse(raw).filter((t) => STACK.includes(t)));
  } catch {}
  return new Set(memoryWatch || []);
}
function saveWatch(set) {
  memoryWatch = [...set];
  try { localStorage.setItem(WATCH_KEY, JSON.stringify(memoryWatch)); } catch {}
}
let watch = loadWatch();

const bySeverityThenNew = (a, b) =>
  SEVERITY[a.severity].rank - SEVERITY[b.severity].rank || a.ago - b.ago;
const sorted = (list) => [...list].sort(bySeverityThenNew);
const watched = () => ITEMS.filter((i) => i.tags.some((t) => watch.has(t)));

/* ---------- pieces ---------- */

function sevPill(item) {
  return el('span', { class: 'sev', 'data-sev': item.severity }, el('span', { class: 'sev__dot', 'aria-hidden': 'true' }), SEVERITY[item.severity].label);
}

function art(item, cls) {
  return el('span', { class: cls, 'data-cat': item.category, html: ICONS[item.category] });
}

function card(item) {
  return el(
    'button',
    { class: 'card', type: 'button', 'data-sev': item.severity, 'data-cat': item.category, onclick: () => openSheet(item) },
    art(item, 'card__art'),
    el('span', { class: 'card__top' }, sevPill(item)),
    el('span', { class: 'card__body' },
      el('span', { class: 'card__title' }, item.title),
      el('span', { class: 'card__meta' }, `${item.source} · ${ago(item.ago)}`),
    ),
  );
}

function row(title, items, seeAll) {
  const track = el('ul', { class: 'row__track', tabindex: '-1' }, items.map((i) => el('li', {}, card(i))));
  const step = (dir) => () => track.scrollBy({ left: dir * track.clientWidth * 0.85, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  return el('section', { class: 'row' },
    el('header', { class: 'row__head' },
      el('h2', { class: 'row__title' }, title),
      seeAll && el('a', { class: 'row__all', href: seeAll }, 'See all'),
      el('span', { class: 'row__arrows' },
        el('button', { type: 'button', class: 'arrow', 'aria-label': `Scroll ${title} back`, onclick: step(-1) }, '‹'),
        el('button', { type: 'button', class: 'arrow', 'aria-label': `Scroll ${title} forward`, onclick: step(1) }, '›'),
      ),
    ),
    track,
  );
}

function grid(items, empty) {
  if (!items.length) return el('p', { class: 'empty' }, empty);
  return el('ul', { class: 'grid' }, items.map((i) => el('li', {}, card(i))));
}

function hero(items) {
  const top = items[0];
  const also = items.slice(1, 4);
  return el('section', { class: 'hero', 'data-cat': top.category, 'aria-labelledby': 'hero-title' },
    art(top, 'hero__art'),
    el('div', { class: 'hero__main' },
      el('p', { class: 'hero__kicker' }, sevPill(top), el('span', {}, `${CATEGORIES[top.category].label} · ${ago(top.ago)}`)),
      el('h1', { class: 'hero__title', id: 'hero-title' }, top.title),
      el('p', { class: 'hero__summary' }, top.summary),
      el('div', { class: 'hero__actions' },
        el('button', { class: 'btn btn--solid', type: 'button', onclick: () => openSheet(top) }, 'What to do'),
        el('a', { class: 'btn btn--ghost', href: top.url, target: '_blank', rel: 'noopener noreferrer' }, 'Open source ↗'),
      ),
    ),
    also.length > 0 && el('aside', { class: 'hero__side', 'aria-label': 'Also needs attention' },
      el('h2', { class: 'hero__side-title' }, 'Also needs attention'),
      el('ol', { class: 'hero__list' }, also.map((i) =>
        el('li', {}, el('button', { type: 'button', class: 'mini', 'data-sev': i.severity, onclick: () => openSheet(i) },
          el('span', { class: 'mini__bar', 'aria-hidden': 'true' }),
          el('span', { class: 'mini__text' },
            el('span', { class: 'mini__title' }, i.title),
            el('span', { class: 'mini__meta' }, `${SEVERITY[i.severity].label} · ${CATEGORIES[i.category].label}`),
          ),
        )),
      )),
    ),
  );
}

/* ---------- detail sheet ---------- */

function openSheet(item) {
  sheet.replaceChildren(
    el('div', { class: 'sheet__banner', 'data-cat': item.category },
      art(item, 'sheet__art'),
      el('button', { class: 'sheet__close', type: 'button', 'aria-label': 'Close', onclick: () => sheet.close() }, '×'),
    ),
    el('div', { class: 'sheet__body' },
      el('p', { class: 'sheet__kicker' }, sevPill(item), el('span', {}, `${CATEGORIES[item.category].label} · ${item.source} · ${ago(item.ago)}`)),
      el('h2', { class: 'sheet__title', id: 'sheet-title' }, item.title),
      el('p', { class: 'sheet__summary' }, item.summary),
      el('div', { class: 'sheet__todo' },
        el('h3', {}, 'What to do'),
        el('p', {}, item.action),
      ),
      item.tags.length > 0 && el('p', { class: 'sheet__tags' }, item.tags.map((t) => el('span', { class: 'tag' }, t))),
      el('div', { class: 'sheet__actions' },
        el('a', { class: 'btn btn--solid', href: item.url, target: '_blank', rel: 'noopener noreferrer' }, 'Open source ↗'),
        el('button', { class: 'btn btn--ghost', type: 'button', onclick: () => sheet.close() }, 'Close'),
      ),
      el('p', { class: 'sheet__note' }, 'Demo item written to show the layout. It is not real news.'),
    ),
  );
  sheet.showModal();
}

sheet.addEventListener('click', (e) => { if (e.target === sheet) sheet.close(); });

/* ---------- views ---------- */

const TABS = [
  { id: 'home', label: 'Home', href: '#/', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3.5 11 8.5-7 8.5 7M6 9.5V20h12V9.5"/></svg>' },
  { id: 'hazard', label: 'Around you', href: '#/around', icon: ICONS.hazard },
  { id: 'webdev', label: 'Web dev', href: '#/webdev', icon: ICONS.webdev },
  { id: 'ai', label: 'AI', href: '#/ai', icon: ICONS.ai },
  { id: 'watchlist', label: 'Watchlist', href: '#/watchlist', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3.5h12v17l-6-4.2-6 4.2z"/></svg>' },
];

function renderNav(active) {
  const tabs = document.getElementById('tabs');
  const dock = document.getElementById('dock');
  const count = watched().length;
  const make = (t, withIcon) => el('a', { class: withIcon ? 'dock__link' : 'tab', href: t.href, 'aria-current': t.id === active ? 'page' : false },
    withIcon && el('span', { class: 'dock__icon', html: t.icon }),
    el('span', {}, t.label),
    t.id === 'watchlist' && count > 0 && el('span', { class: 'badge', 'aria-label': `${count} items` }, String(count)),
  );
  tabs.replaceChildren(...TABS.map((t) => make(t, false)));
  dock.replaceChildren(...TABS.map((t) => make(t, true)));
}

function homeView() {
  const urgent = sorted(ITEMS.filter((i) => i.severity === 'urgent'));
  const rest = sorted(ITEMS.filter((i) => i.severity === 'heads-up'));
  const heroItems = [...urgent, ...rest];
  const attention = heroItems.slice(1);
  const out = [hero(heroItems), row('Needs attention', attention)];
  const mine = sorted(watched());
  if (mine.length) out.push(row('From your watchlist', mine, '#/watchlist'));
  for (const [id, meta] of Object.entries(CATEGORIES)) {
    const route = id === 'hazard' ? '#/around' : `#/${id}`;
    out.push(row(meta.label, sorted(ITEMS.filter((i) => i.category === id)), route));
  }
  return out;
}

function categoryView(id, filter) {
  const meta = CATEGORIES[id];
  const all = sorted(ITEMS.filter((i) => i.category === id));
  const shown = filter === 'all' ? all : all.filter((i) => i.severity === filter);
  const base = id === 'hazard' ? '#/around' : `#/${id}`;
  const chips = [['all', 'All', all.length], ...Object.entries(SEVERITY).map(([k, v]) => [k, v.label, all.filter((i) => i.severity === k).length])];
  return [
    el('header', { class: 'page-head' },
      el('h1', { class: 'page-title' }, meta.label),
      el('p', { class: 'page-blurb' }, meta.blurb),
      el('div', { class: 'chips', role: 'group', 'aria-label': 'Filter by severity' },
        chips.map(([k, label, n]) => el('a', { class: 'chip', 'data-sev': k, href: k === 'all' ? base : `${base}?s=${k}`, 'aria-current': k === filter ? 'true' : false }, `${label} `, el('span', { class: 'chip__n' }, String(n)))),
      ),
    ),
    grid(shown, 'Nothing here right now.'),
  ];
}

function watchlistView() {
  const mine = sorted(watched());
  return [
    el('header', { class: 'page-head' },
      el('h1', { class: 'page-title' }, 'Watchlist'),
      el('p', { class: 'page-blurb' }, 'Pick the tools you use. News about them shows up here.'),
      el('div', { class: 'chips', role: 'group', 'aria-label': 'Tools to watch' },
        STACK.map((t) => el('button', {
          class: 'chip chip--toggle', type: 'button', 'aria-pressed': watch.has(t) ? 'true' : 'false',
          onclick: () => {
            watch.has(t) ? watch.delete(t) : watch.add(t);
            saveWatch(watch);
            route();
            [...main.querySelectorAll('.chip--toggle')].find((b) => b.textContent === t)?.focus({ preventScroll: true });
          },
        }, t)),
      ),
    ),
    grid(mine, watch.size ? 'Nothing new for these tools right now.' : 'No tools picked yet. Choose some above.'),
  ];
}

function searchView(q) {
  const needle = q.trim().toLowerCase();
  const hits = sorted(ITEMS.filter((i) => [i.title, i.summary, i.source, ...i.tags, CATEGORIES[i.category].label].join(' ').toLowerCase().includes(needle)));
  return [
    el('header', { class: 'page-head' },
      el('h1', { class: 'page-title' }, 'Search'),
      el('p', { class: 'page-blurb' }, needle ? `${hits.length} result${hits.length === 1 ? '' : 's'} for “${q.trim()}”` : 'Type something to search.'),
    ),
    needle ? grid(hits, 'No alerts match that search.') : null,
  ];
}

/* ---------- router ---------- */

function route() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, query = ''] = raw.split('?');
  const params = new URLSearchParams(query);
  let active = 'home';
  let view;
  if (path === 'around') { active = 'hazard'; view = categoryView('hazard', params.get('s') || 'all'); }
  else if (path === 'webdev') { active = 'webdev'; view = categoryView('webdev', params.get('s') || 'all'); }
  else if (path === 'ai') { active = 'ai'; view = categoryView('ai', params.get('s') || 'all'); }
  else if (path === 'watchlist') { active = 'watchlist'; view = watchlistView(); }
  else if (path === 'search') { active = ''; view = searchView(params.get('q') || ''); }
  else view = homeView();

  const input = document.getElementById('q');
  if (path !== 'search') input.value = '';
  renderNav(active);
  main.replaceChildren(...view.filter(Boolean));
  document.title = active && active !== 'home' ? `${TABS.find((t) => t.id === active).label} · Heads Up` : 'Heads Up';
}

let lastPath = null;
window.addEventListener('hashchange', () => {
  const path = location.hash.split('?')[0];
  route();
  if (path !== lastPath) { window.scrollTo(0, 0); main.focus({ preventScroll: true }); }
  lastPath = path;
});

document.getElementById('search').addEventListener('submit', (e) => {
  e.preventDefault();
  location.hash = `#/search?q=${encodeURIComponent(document.getElementById('q').value)}`;
});

lastPath = location.hash.split('?')[0];
route();
