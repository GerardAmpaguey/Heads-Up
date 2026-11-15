import { CATEGORIES, SEVERITY, STACK } from './data.js';

// Everything on the page comes from /api/alerts. Nothing is made up.
const ITEMS = [];
const feed = { status: 'loading', data: null, retries: 0 };

/* ---------- chosen location ---------- */

const PLACE_KEY = 'headsup.place';
let memoryPlace;

// null means "use the location of my connection". Saved on this device only, never sent anywhere except
// as coordinates to our own /api/alerts.
function loadPlace() {
  try {
    const p = JSON.parse(localStorage.getItem(PLACE_KEY) || 'null');
    if (p && Number.isFinite(p.lat) && Number.isFinite(p.lon) && typeof p.label === 'string') return { lat: p.lat, lon: p.lon, label: p.label, name: typeof p.name === 'string' ? p.name : undefined, cc: typeof p.cc === 'string' ? p.cc : undefined };
  } catch {}
  return memoryPlace ?? null;
}
function savePlace(p) {
  memoryPlace = p;
  try { p ? localStorage.setItem(PLACE_KEY, JSON.stringify(p)) : localStorage.removeItem(PLACE_KEY); } catch {}
}
let place = loadPlace();

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

function metaLine(item) {
  return [item.local ? `${item.source} (local news)` : item.source, item.km != null ? `${item.km.toLocaleString('en')} km away` : null, ago(item.ago)].filter(Boolean).join(' · ');
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

const bySeverityThenNew = (a, b) => SEVERITY[a.severity].rank - SEVERITY[b.severity].rank || a.ago - b.ago;
const byNew = (a, b) => a.ago - b.ago;
const sorted = (list) => [...list].sort(bySeverityThenNew);
const watched = () => ITEMS.filter((i) => i.tags.some((t) => watch.has(t)));
const catRoute = (id) => (id === 'hazard' ? '#/around' : `#/${id}`);


/* ---------- live data ---------- */

function applyFeed(data) {
  const now = Date.now();
  const minutes = (t) => Math.max(0, Math.round((now - Date.parse(t)) / 60000));
  const common = (a) => ({
    id: a.id, category: a.category || 'hazard', severity: a.severity, title: a.title, summary: a.summary,
    action: a.action, source: a.source, url: a.url, tags: a.tags || [], ago: minutes(a.time),
    image: a.image, imageCredit: a.imageCredit,
  });
  const hazards = (data.items || []).map((a) => ({
    ...common(a), category: 'hazard',
    km: a.distanceKm == null ? null : Math.round(a.distanceKm), bearing: a.bearing ?? null,
  }));
  const local = (data.local?.items || []).map((a) => ({ ...common(a), category: 'hazard', km: null, bearing: null, local: true }));
  const news = (data.news || []).map((a) => ({ ...common(a), km: null, bearing: null }));
  ITEMS.length = 0;
  ITEMS.push(...hazards, ...local, ...news);
}

async function loadFeed() {
  try {
    let query = '';
    if (place) {
      query = `?lat=${place.lat}&lon=${place.lon}`;
      if (place.name) query += `&city=${encodeURIComponent(place.name)}`;
      if (place.cc) query += `&cc=${encodeURIComponent(place.cc)}`;
    }
    const res = await fetch(`/api/alerts${query}`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const data = await res.json();
    applyFeed(data);
    feed.data = data;
    feed.status = 'ready';
    showLocation(data.location);
    showStatus(data);
  } catch {
    if (!feed.data) feed.status = 'error';
  }
}

async function start() {
  await loadFeed();
  route();
  // The very first visit after a deploy can arrive before the first fetch has finished. Ask again shortly.
  if (feed.data?.warming && feed.retries < 6) {
    feed.retries += 1;
    setTimeout(start, 8000);
  }
}

function showLocation(loc) {
  const label = document.getElementById('where-label');
  const button = document.getElementById('where');
  let name = '';
  if (place) name = place.label;
  else if (loc) {
    name = loc.city || '';
    if (loc.country) {
      try { name = [loc.city, new Intl.DisplayNames(['en'], { type: 'region' }).of(loc.country)].filter(Boolean).join(', '); } catch {}
    }
  }
  label.textContent = name || 'Set location';
  button.title = place ? 'Change location' : name ? 'Approximate, from your connection. Click to change.' : 'Choose where you are';
}

/* ---------- location picker ---------- */

const picker = document.getElementById('picker');

async function searchPlaces(text, signal) {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(text)}&count=8&language=en&format=json`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`status ${res.status}`);
  const data = await res.json();
  const seen = new Set();
  const out = [];
  for (const r of data.results || []) {
    if (!Number.isFinite(r.latitude) || !Number.isFinite(r.longitude)) continue;
    const label = [r.name, r.admin1, r.country].filter(Boolean).join(', ');
    if (seen.has(label)) continue;
    seen.add(label);
    out.push({ label, name: r.name, cc: r.country_code, lat: Math.round(r.latitude * 100) / 100, lon: Math.round(r.longitude * 100) / 100 });
  }
  return out;
}

async function chooseLocation(next) {
  place = next;
  savePlace(next);
  picker.close();
  feed.status = ITEMS.length ? 'ready' : 'loading';
  showLocation(feed.data?.location);
  await loadFeed();
  route();
}

function openPicker() {
  const input = el('input', { class: 'picker__input', id: 'picker-input', type: 'search', placeholder: 'City or town, like Baguio', autocomplete: 'off', 'aria-label': 'Search for a city or town' });
  const status = el('p', { class: 'picker__status', role: 'status' });
  const list = el('ul', { class: 'picker__list' });
  let timer;
  let ctl;

  const show = (places) => {
    list.replaceChildren(...places.map((p) => el('li', {}, el('button', { class: 'picker__opt', type: 'button', onclick: () => chooseLocation(p) }, p.label))));
  };
  input.addEventListener('input', () => {
    clearTimeout(timer);
    ctl?.abort();
    const text = input.value.trim();
    if (text.length < 2) { list.replaceChildren(); status.textContent = ''; return; }
    timer = setTimeout(async () => {
      ctl = new AbortController();
      status.textContent = 'Searching…';
      try {
        const places = await searchPlaces(text, ctl.signal);
        show(places);
        status.textContent = places.length ? '' : 'No places match that name.';
      } catch (err) {
        if (err.name !== 'AbortError') { list.replaceChildren(); status.textContent = 'Place search is not available right now. Try again in a moment.'; }
      }
    }, 300);
  });

  const useDevice = el('button', { class: 'btn btn--ghost', type: 'button', onclick: () => {
    if (!navigator.geolocation) { status.textContent = 'This browser cannot share your location.'; return; }
    status.textContent = 'Waiting for your browser to share your location…';
    navigator.geolocation.getCurrentPosition(
      (pos) => chooseLocation({ label: 'My device location', lat: Math.round(pos.coords.latitude * 100) / 100, lon: Math.round(pos.coords.longitude * 100) / 100 }),
      () => { status.textContent = 'Your browser did not share the location. Search for your town instead.'; },
      { timeout: 10000, maximumAge: 600000 },
    );
  } }, 'Use my device location');
  const useAuto = el('button', { class: 'btn btn--ghost', type: 'button', onclick: () => chooseLocation(null) }, 'Use my connection’s location');

  picker.replaceChildren(
    el('button', { class: 'sheet__close', type: 'button', 'aria-label': 'Close', onclick: () => picker.close() }, '×'),
    el('div', { class: 'picker__body' },
      el('h2', { class: 'picker__title', id: 'picker-title' }, 'Where are you?'),
      el('p', { class: 'picker__hint' }, place ? `Showing hazards near ${place.label}.` : 'Hazards are ranked by distance from this place. It is saved only on this device.'),
      input, status, list,
      el('div', { class: 'picker__actions' }, useDevice, place && useAuto),
      el('p', { class: 'picker__credit' }, 'Place search by ', el('a', { href: 'https://open-meteo.com/', target: '_blank', rel: 'noopener noreferrer' }, 'Open-Meteo'), ' (data from GeoNames).'),
    ),
  );
  picker.showModal();
  input.focus();
}

document.getElementById('where').addEventListener('click', openPicker);

function showStatus(data) {
  const node = document.getElementById('status');
  if (!node || !data.updatedAt) return;
  const sources = Object.values(data.sources || {});
  const down = sources.filter((s) => !s.ok).length;
  const mins = Math.max(0, Math.round((Date.now() - Date.parse(data.updatedAt)) / 60000));
  node.textContent = `Updated ${ago(mins)}. ${down === 0 ? `All ${sources.length} sources reachable.` : `${down} of ${sources.length} sources are unavailable right now.`}`;
}

/* ---------- pieces ---------- */

function sevPill(item) {
  return el('span', { class: 'sev', 'data-sev': item.severity }, SEVERITY[item.severity].label);
}

/* Locator: you at the centre, rings at 500 km and 1,500 km, a dot where the event is. Drawn from the
   distance and compass bearing the API gives us, so it needs no map data and works for every hazard. */
const NS = 'http://www.w3.org/2000/svg';
const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
const radiusFor = (km) => 10 + 34 * Math.sqrt(Math.min(km, 3000) / 3000);

function locator(item) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('aria-hidden', 'true');
  const add = (tag, attrs) => {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    svg.append(n);
    return n;
  };
  for (const km of [500, 1500]) add('circle', { cx: 50, cy: 50, r: radiusFor(km).toFixed(1), fill: 'none', stroke: 'currentColor', 'stroke-width': 0.9, 'stroke-dasharray': '2 2.5', opacity: 0.55 });
  add('path', { d: 'M50 3.5 47.6 9h4.8z', fill: 'currentColor', opacity: 0.8 });
  const rad = (item.bearing * Math.PI) / 180;
  const r = radiusFor(item.km);
  const x = 50 + r * Math.sin(rad);
  const y = 50 - r * Math.cos(rad);
  add('line', { x1: 50, y1: 50, x2: x.toFixed(1), y2: y.toFixed(1), stroke: 'currentColor', 'stroke-width': 1.2, opacity: 0.7 });
  add('circle', { cx: 50, cy: 50, r: 2.6, fill: 'currentColor' });
  add('circle', { cx: x.toFixed(1), cy: y.toFixed(1), r: 7.5, fill: 'currentColor', opacity: 0.28 });
  add('circle', { cx: x.toFixed(1), cy: y.toFixed(1), r: 4, fill: 'currentColor' });
  return svg;
}

function art(item, cls) {
  const hasLocator = item.category === 'hazard' && item.km != null && item.bearing != null;
  const node = el('span', { class: cls, 'data-cat': item.category, html: hasLocator ? null : ICONS[item.category] });
  if (hasLocator) {
    const dir = COMPASS[Math.round(item.bearing / 45) % 8];
    node.classList.add(`${cls}--locator`);
    node.setAttribute('role', 'img');
    node.setAttribute('aria-label', `${item.km} km ${dir} of you`);
    node.append(locator(item));
  }
  return node;
}

/* Optional photo. The picture is hotlinked from the source (we never copy it). If it is missing or
   fails to load, the coloured icon art underneath stays visible. */
function withPhoto(container, item, { eager = false, credit = true } = {}) {
  if (!item.image) return container;
  const img = el('img', {
    class: 'photo', src: item.image, alt: '', loading: eager ? 'eager' : 'lazy', decoding: 'async',
    referrerpolicy: 'no-referrer',
  });
  img.addEventListener('load', () => container.classList.add('has-photo'));
  img.addEventListener('error', () => img.remove());
  container.prepend(img);
  if (credit) container.append(el('span', { class: 'credit' }, `Image: ${item.imageCredit || item.source}`));
  return container;
}

/* Large lead story at the top of the front page. */
function lead(item) {
  return withPhoto(el('button', { class: 'lead', type: 'button', 'data-cat': item.category, onclick: () => openSheet(item) },
    art(item, 'lead__art'),
    el('span', { class: 'lead__text' },
      el('span', { class: 'lead__kicker' }, sevPill(item), el('span', {}, `${CATEGORIES[item.category].label} · ${ago(item.ago)}`)),
      el('span', { class: 'lead__title' }, item.title),
      el('span', { class: 'lead__summary' }, item.summary),
    ),
  ), item, { eager: true });
}

/* Row with a small thumbnail, used in the side list and the Latest list. */
function story(item, withSummary) {
  return el('button', { class: 'story', type: 'button', 'data-sev': item.severity, onclick: () => openSheet(item) },
    withPhoto(art(item, 'story__thumb'), item, { credit: false }),
    el('span', { class: 'story__body' },
      el('span', { class: 'story__label' }, sevPill(item), el('span', {}, CATEGORIES[item.category].label)),
      el('span', { class: 'story__title' }, item.title),
      withSummary && el('span', { class: 'story__summary' }, item.summary),
      el('span', { class: 'story__meta' }, metaLine(item)),
    ),
  );
}

/* Image tile, used in section grids. */
function tile(item) {
  return el('button', { class: 'tile', type: 'button', 'data-sev': item.severity, onclick: () => openSheet(item) },
    withPhoto(el('span', { class: 'tile__img', 'data-cat': item.category },
      art(item, 'tile__art'),
      el('span', { class: 'tile__tag' }, sevPill(item)),
    ), item),
    el('span', { class: 'tile__title' }, item.title),
    el('span', { class: 'tile__meta' }, metaLine(item)),
  );
}

function sectionHead(title, href, linkText = 'View more +') {
  return el('header', { class: 'sec-head' },
    el('h2', { class: 'sec-title' }, title),
    href && el('a', { class: 'sec-more', href }, linkText),
  );
}

function tileGrid(items, empty) {
  if (!items.length) return el('p', { class: 'empty' }, empty);
  return el('ul', { class: 'tiles' }, items.map((i) => el('li', {}, tile(i))));
}

/* A long list shown a page at a time, with a Load more button. */
function paged(items, empty, build, listClass, pageSize) {
  if (!items.length) return el('p', { class: 'empty' }, empty);
  const list = el('ul', { class: listClass });
  const button = el('button', { class: 'btn btn--ghost more', type: 'button' });
  let shown = 0;
  const showMore = () => {
    const next = items.slice(shown, shown + pageSize);
    list.append(...next.map((i) => el('li', {}, build(i))));
    shown += next.length;
    button.hidden = shown >= items.length;
    button.textContent = `Load more (${items.length - shown} left)`;
  };
  button.addEventListener('click', () => {
    const first = list.children.length;
    showMore();
    list.children[first]?.querySelector('button')?.focus({ preventScroll: true });
  });
  showMore();
  return el('div', { class: 'paged' }, list, el('div', { class: 'more-wrap' }, button));
}

const pagedTiles = (items, empty) => paged(items, empty, tile, 'tiles', 12);

function panel(title, ...kids) {
  return el('section', { class: 'panel' }, el('h2', { class: 'panel__title' }, title), ...kids);
}

/* ---------- detail sheet ---------- */

function openSheet(item) {
  sheet.replaceChildren(
    withPhoto(el('div', { class: 'sheet__banner', 'data-cat': item.category },
      art(item, 'sheet__art'),
      el('button', { class: 'sheet__close', type: 'button', 'aria-label': 'Close', onclick: () => sheet.close() }, '×'),
    ), item),
    el('div', { class: 'sheet__body' },
      el('p', { class: 'sheet__kicker' }, sevPill(item), el('span', {}, `${CATEGORIES[item.category].label} · ${metaLine(item)}`)),
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
      el('p', { class: 'sheet__note' }, item.category === 'hazard' ? 'Automated data from the source above. It may be delayed or revised, so check your official local agency before you act.' : 'Summary of the source above. Read the original before you act on it.'),
    ),
  );
  sheet.showModal();
}

sheet.addEventListener('click', (e) => { if (e.target === sheet) sheet.close(); });

/* ---------- navigation ---------- */

const TABS = [
  { id: 'home', label: 'Home', href: '#/' },
  { id: 'hazard', label: 'Around you', href: '#/around' },
  { id: 'webdev', label: 'Web dev', href: '#/webdev' },
  { id: 'ai', label: 'AI', href: '#/ai' },
  { id: 'latest', label: 'Latest', href: '#/latest' },
  { id: 'watchlist', label: 'Watchlist', href: '#/watchlist' },
];

function renderNav(active) {
  const count = watched().length;
  document.getElementById('tabs').replaceChildren(...TABS.map((t) =>
    el('a', { class: 'tab', href: t.href, 'aria-current': t.id === active ? 'page' : false },
      t.label,
      t.id === 'watchlist' && count > 0 && el('span', { class: 'badge', 'aria-label': `${count} items` }, String(count)),
    )));
}

/* ---------- views ---------- */

function watchPanel() {
  const mine = sorted(watched());
  if (!mine.length) {
    return panel('Your watchlist',
      el('p', { class: 'panel__text' }, 'Pick the tools you use, like WordPress or Astro, and their news shows up here.'),
      el('a', { class: 'panel__link', href: '#/watchlist' }, 'Choose tools'),
    );
  }
  return panel('Your watchlist',
    el('ul', { class: 'panel__list' }, mine.slice(0, 4).map((i) => el('li', {}, story(i)))),
    el('a', { class: 'panel__link', href: '#/watchlist' }, 'Edit watchlist'),
  );
}

function stateBlock() {
  if (feed.status === 'loading') return [el('p', { class: 'empty empty--state', role: 'status' }, 'Loading the latest alerts…')];
  if (feed.status === 'error') {
    return [el('div', { class: 'empty empty--state' },
      el('p', {}, 'We could not load alerts just now. Check your connection and try again.'),
      el('button', { class: 'btn btn--solid', type: 'button', onclick: () => { feed.status = 'loading'; route(); start(); } }, 'Try again'),
    )];
  }
  if (feed.data?.warming) return [el('p', { class: 'empty empty--state', role: 'status' }, 'Gathering the first alerts. This takes about a minute on the first visit.')];
  return null;
}

const LATEST_COUNT = 5;
// Small quakes and similar FYI hazards would crowd out everything else in a newest-first list.
// They stay on the Around you page.
const forLatest = () => ITEMS.filter((i) => !(i.category === 'hazard' && i.severity === 'fyi'));
let latestFilter = 'all';

/* Latest on the front page: five items, with a severity tab to narrow them. */
function latestBlock() {
  const list = el('ul', { class: 'list' });
  const more = el('a', { class: 'sec-more', href: '#/latest' }, 'View more +');
  const tabs = el('div', { class: 'chips chips--tabs', role: 'group', 'aria-label': 'Show latest by severity' });
  const options = [['all', 'All'], ...Object.entries(SEVERITY).map(([k, v]) => [k, v.label])];
  const fill = () => {
    const rows = forLatest().filter((i) => latestFilter === 'all' || i.severity === latestFilter).sort(byNew).slice(0, LATEST_COUNT);
    list.replaceChildren(...(rows.length ? rows.map((i) => el('li', {}, story(i, true))) : [el('li', { class: 'empty' }, 'Nothing in this group right now.')]));
    more.setAttribute('href', latestFilter === 'all' ? '#/latest' : `#/latest?s=${latestFilter}`);
    for (const b of tabs.children) b.setAttribute('aria-pressed', b.dataset.k === latestFilter ? 'true' : 'false');
  };
  for (const [k, label] of options) {
    const pool = forLatest();
    const n = k === 'all' ? pool.length : pool.filter((i) => i.severity === k).length;
    tabs.append(el('button', { class: 'chip chip--tab', type: 'button', 'data-k': k, onclick: () => { latestFilter = k; fill(); } }, `${label} `, el('span', { class: 'chip__n' }, String(n))));
  }
  fill();
  return el('section', { class: 'cols__main', 'aria-labelledby': 'latest-title' },
    el('header', { class: 'sec-head' }, el('h2', { class: 'sec-title', id: 'latest-title' }, 'Latest'), more),
    tabs,
    list,
  );
}

const EMPTY = {
  hazard: 'No active hazards near you right now. We check every 30 minutes.',
  webdev: 'No web dev news in the last month.',
  ai: 'No AI news in the last month.',
};

function homeView() {
  const ranked = sorted(ITEMS);
  const top = ranked[0];
  if (!top) return [el('p', { class: 'empty empty--state' }, 'No alerts right now. We check again every 30 minutes.')];
  const side = ranked.slice(1, 5);
  const urgent = ranked.filter((i) => i.severity === 'urgent');

  const out = [
    el('section', { class: 'front', 'aria-label': 'Top alerts' },
      lead(top),
      el('ul', { class: 'front__side' }, side.map((i) => el('li', {}, story(i)))),
    ),

    el('div', { class: 'cols' },
      latestBlock(),
      el('aside', { class: 'cols__side', 'aria-label': 'Sidebar' },
        panel(`Urgent now (${urgent.length})`,
          urgent.length
            ? el('ul', { class: 'panel__list' }, urgent.map((i) => el('li', {}, story(i))))
            : el('p', { class: 'panel__text' }, 'Nothing urgent right now.'),
        ),
        watchPanel(),
        panel('What we watch',
          el('ul', { class: 'watching' }, Object.entries(CATEGORIES).map(([id, m]) =>
            el('li', {}, el('a', { href: catRoute(id) }, el('strong', {}, m.label), el('span', {}, m.blurb))))),
        ),
      ),
    ),
  ];

  for (const [id, meta] of Object.entries(CATEGORIES)) {
    out.push(el('section', { class: 'block', 'aria-label': meta.label },
      sectionHead(meta.label, catRoute(id)),
      tileGrid(sorted(ITEMS.filter((i) => i.category === id)).slice(0, 4), EMPTY[id]),
    ));
  }
  return out;
}

function pageHead(title, blurb, ...extra) {
  return el('header', { class: 'page-head' }, el('h1', { class: 'page-title' }, title), blurb && el('p', { class: 'page-blurb' }, blurb), ...extra);
}

function categoryView(id, filter) {
  const meta = CATEGORIES[id];
  const all = sorted(ITEMS.filter((i) => i.category === id));
  const shown = filter === 'all' ? all : all.filter((i) => i.severity === filter);
  const base = catRoute(id);
  const chips = [['all', 'All', all.length], ...Object.entries(SEVERITY).map(([k, v]) => [k, v.label, all.filter((i) => i.severity === k).length])];
  return [
    pageHead(meta.label, meta.blurb,
      el('div', { class: 'chips', role: 'group', 'aria-label': 'Filter by severity' },
        chips.map(([k, label, n]) => el('a', { class: 'chip', href: k === 'all' ? base : `${base}?s=${k}`, 'aria-current': k === filter ? 'true' : false }, `${label} `, el('span', { class: 'chip__n' }, String(n)))),
      ),
    ),
    pagedTiles(shown, all.length ? 'Nothing in this group right now.' : EMPTY[id]),
  ];
}

function latestView(filter) {
  const all = forLatest().sort(byNew);
  const shown = filter === 'all' ? all : all.filter((i) => i.severity === filter);
  const chips = [['all', 'All', all.length], ...Object.entries(SEVERITY).map(([k, v]) => [k, v.label, all.filter((i) => i.severity === k).length])];
  return [
    pageHead('Latest', 'Everything, newest first.',
      el('div', { class: 'chips', role: 'group', 'aria-label': 'Filter by severity' },
        chips.map(([k, label, n]) => el('a', { class: 'chip', href: k === 'all' ? '#/latest' : `#/latest?s=${k}`, 'aria-current': k === filter ? 'true' : false }, `${label} `, el('span', { class: 'chip__n' }, String(n)))),
      ),
    ),
    paged(shown, 'Nothing in this group right now.', (i) => story(i, true), 'list list--page', 15),
  ];
}

function watchlistView() {
  const mine = sorted(watched());
  return [
    pageHead('Watchlist', 'Pick the tools you use. News about them shows up here.',
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
    pagedTiles(mine, watch.size ? 'Nothing new for these tools right now.' : 'No tools picked yet. Choose some above.'),
  ];
}

function searchView(q) {
  const needle = q.trim().toLowerCase();
  const hits = sorted(ITEMS.filter((i) => [i.title, i.summary, i.source, ...i.tags, CATEGORIES[i.category].label].join(' ').toLowerCase().includes(needle)));
  return [
    pageHead('Search', needle ? `${hits.length} result${hits.length === 1 ? '' : 's'} for “${q.trim()}”` : 'Type something to search.'),
    needle ? pagedTiles(hits, 'No alerts match that search.') : null,
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
  else if (path === 'latest') { active = 'latest'; view = latestView(params.get('s') || 'all'); }
  else if (path === 'watchlist') { active = 'watchlist'; view = watchlistView(); }
  else if (path === 'search') { active = ''; view = searchView(params.get('q') || ''); }
  else view = homeView();
  if (feed.status !== 'ready' || feed.data?.warming) view = stateBlock() || view;

  if (path !== 'search') document.getElementById('q').value = '';
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
start();
