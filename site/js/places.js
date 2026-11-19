// Place lookup for the location picker. Works for any country.
//   - Search: OpenStreetMap Nominatim, worldwide. Places in the visitor's own country are listed first.
//   - Reverse: a name for the device's coordinates, anywhere.
//   - Browse (Philippines only, offered to visitors there): PSGC, the government's official list of
//     provinces, cities, towns and barangays. Coordinates for a browsed place come from Nominatim, once,
//     when the person picks it.
// Both services allow requests from the browser. Nominatim's rules ask for no search-as-you-type, so
// the picker searches when the person presses Enter or Search, and asks once per search.

const NOMINATIM = 'https://nominatim.openstreetmap.org';
const PSGC = 'https://psgc.gitlab.io/api';
const NCR = { code: '130000000', name: 'Metro Manila', ncr: true };

const round = (n) => Math.round(Number(n) * 100) / 100;
const plain = (name) => name.replace(/^City of /, '');
const unique = (list) => [...new Set(list.filter(Boolean))];

async function getJson(url, signal) {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`status ${res.status}`);
  return res.json();
}

/* ---------- search ---------- */

// What a person can pick, by Nominatim's address type.
const AREA = new Set(['country', 'state', 'province', 'region']); // top-level areas: no parent but the country
const SUBAREA = new Set(['county', 'state_district', 'district', 'island']); // sit under a state or province
const TOWN = new Set(['city', 'municipality', 'town']);
// Parts of a town, or small settlements. Local news is searched by the town they belong to, when there is one.
const PART = new Set(['village', 'suburb', 'quarter', 'neighbourhood', 'hamlet', 'city_district', 'borough', 'isolated_dwelling']);

const KIND_LABEL = {
  country: 'Country', state: 'State or province', province: 'Province', region: 'Region',
  county: 'County', state_district: 'District', district: 'District', island: 'Island',
  city: 'City', municipality: 'Municipality', town: 'Town',
  village: 'Village', suburb: 'Suburb', quarter: 'Neighbourhood', neighbourhood: 'Neighbourhood', hamlet: 'Hamlet',
  city_district: 'District', borough: 'Borough', isolated_dwelling: 'Hamlet',
};
// Countries that name things their own way. In the Philippines a state is a province and a village is a barangay.
const LOCAL_LABEL = {
  PH: { state: 'Province', village: 'Barangay', suburb: 'Barangay', quarter: 'Barangay', neighbourhood: 'Barangay', hamlet: 'Barangay' },
};

/** One Nominatim result as a place the app can use, or null if it is not a populated or administrative place. */
export function fromNominatim(r) {
  if (!['place', 'boundary'].includes(r.category)) return null;
  const a = r.address || {};
  const kind = r.addresstype;
  const cc = (a.country_code || '').toUpperCase();
  const town = a.city || a.municipality || a.town || null;
  const area = a.state || a.province || a.region || a.county || null;
  const name = r.name || a[kind];
  if (!name || !Number.isFinite(Number(r.lat)) || !Number.isFinite(Number(r.lon))) return null;

  let news = name;
  let parents;
  if (AREA.has(kind)) parents = [];
  else if (SUBAREA.has(kind)) parents = [a.state || a.province || a.region];
  else if (TOWN.has(kind)) parents = [area];
  else if (PART.has(kind)) { parents = [town, area]; news = town || name; }
  else return null;
  const label = unique([name, ...parents, a.country]).join(', ');
  const kindLabel = LOCAL_LABEL[cc]?.[kind] ?? KIND_LABEL[kind] ?? '';
  return { label, name: news, cc: cc || undefined, lat: round(r.lat), lon: round(r.lon), kind: kindLabel };
}

/** Places in the visitor's own country first, otherwise in Nominatim's order. */
export function homeFirst(places, home) {
  if (!home) return places;
  return [...places.filter((p) => p.cc === home), ...places.filter((p) => p.cc !== home)];
}

/** Search the whole world. `home` is the visitor's country code, if known, so their own places come first. */
export async function searchPlaces(text, signal, home) {
  const url = `${NOMINATIM}/search?q=${encodeURIComponent(text)}&format=jsonv2&addressdetails=1&limit=20&accept-language=en`;
  const seen = new Set();
  const out = [];
  for (const r of await getJson(url, signal)) {
    const p = fromNominatim(r);
    if (!p || seen.has(p.label)) continue;
    seen.add(p.label);
    out.push(p);
  }
  return homeFirst(out, home).slice(0, 12);
}

/** Name for a pair of coordinates (device location), anywhere in the world. */
export async function reverse(lat, lon, signal) {
  const r = await getJson(`${NOMINATIM}/reverse?format=jsonv2&zoom=10&accept-language=en&lat=${lat}&lon=${lon}`, signal);
  const a = r.address || {};
  const name = a.city || a.town || a.municipality || a.village || a.county || a.state_district || a.state;
  if (!name) return null;
  const cc = (a.country_code || '').toUpperCase();
  let country = a.country || '';
  try { country = new Intl.DisplayNames(['en'], { type: 'region' }).of(cc) || country; } catch {}
  const area = (cc === 'PH' ? a.county || a.state : a.state || a.county)?.replace(/ Province$/, '');
  return { name, cc: cc || undefined, label: unique([name, area, country]).join(', ') };
}

/* ---------- Philippines: browse by province ---------- */

/** Countries with a browse-by-area list. Only the Philippines for now. */
export const canBrowse = (cc) => cc === 'PH';

/** Find coordinates for a named place in the Philippines. Tries the most specific wording first. */
export async function geocode(attempts, signal) {
  for (const q of attempts) {
    const rows = await getJson(`${NOMINATIM}/search?q=${encodeURIComponent(q)}&format=jsonv2&countrycodes=ph&limit=1`, signal);
    if (rows[0]) return { lat: round(rows[0].lat), lon: round(rows[0].lon) };
  }
  return null;
}

const cache = new Map();
async function listOf(url, signal) {
  if (!cache.has(url)) cache.set(url, getJson(url, signal).then((rows) => rows.map((r) => ({ code: r.code, name: r.name })).sort((a, b) => plain(a.name).localeCompare(plain(b.name)))).catch((e) => { cache.delete(url); throw e; }));
  return cache.get(url);
}

export async function provinces(signal) {
  const rows = await listOf(`${PSGC}/provinces/`, signal);
  return [...rows, NCR].sort((a, b) => a.name.localeCompare(b.name));
}
export const citiesOf = (province, signal) => listOf(province.ncr ? `${PSGC}/regions/${province.code}/cities-municipalities/` : `${PSGC}/provinces/${province.code}/cities-municipalities/`, signal);
export const barangaysOf = (city, signal) => listOf(`${PSGC}/cities-municipalities/${city.code}/barangays/`, signal);

/** What to show for a PSGC city or town: "City of Dagupan" reads better as "Dagupan City". */
export function townLabel(c) {
  return c.name.startsWith('City of ') ? `${plain(c.name)} City` : c.name;
}

/** Build a place from something picked while browsing. `parts` run from the most specific to the province. */
export async function resolve({ title, newsName, parts }, signal) {
  const country = 'Philippines';
  const attempts = [];
  for (let i = 0; i < parts.length; i++) attempts.push([...parts.slice(i), country].join(', '));
  const found = await geocode(attempts, signal);
  if (!found) return null;
  return { label: [title, ...parts.slice(1).filter((p) => p !== title), country].join(', '), name: newsName, cc: 'PH', ...found };
}
