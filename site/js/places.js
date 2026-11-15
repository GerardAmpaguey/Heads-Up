// Place lookup for the location picker. Philippines first.
//   - Search: OpenStreetMap Nominatim, limited to the Philippines, then worldwide if nothing matches.
//   - Browse: PSGC (the government's official list of provinces, cities, towns and barangays).
//   - Coordinates for a browsed place come from Nominatim, once, when the person picks it.
// Both services allow requests from the browser. Nominatim's rules ask for no search-as-you-type, so
// the picker searches when the person presses Enter or Search.

const NOMINATIM = 'https://nominatim.openstreetmap.org';
const PSGC = 'https://psgc.gitlab.io/api';
const NCR = { code: '130000000', name: 'Metro Manila', ncr: true };

const round = (n) => Math.round(Number(n) * 100) / 100;
const plain = (name) => name.replace(/^City of /, '');

async function getJson(url, signal) {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`status ${res.status}`);
  return res.json();
}

/* ---------- search ---------- */

const TOWN = new Set(['city', 'municipality', 'town']);
const PART = new Set(['village', 'suburb', 'quarter', 'neighbourhood', 'hamlet', 'city_district', 'borough', 'isolated_dwelling']);
const KIND_LABEL = { state: 'Province', region: 'Region', city: 'City', municipality: 'Municipality', town: 'Town', village: 'Barangay', suburb: 'Barangay', quarter: 'Barangay', neighbourhood: 'Barangay', hamlet: 'Barangay', city_district: 'District' };

/** One Nominatim result as a place the app can use, or null if it is not a populated or administrative place. */
export function fromNominatim(r) {
  if (!['place', 'boundary'].includes(r.category)) return null;
  const a = r.address || {};
  const kind = r.addresstype;
  const cc = (a.country_code || '').toUpperCase();
  const town = a.city || a.municipality || a.town || null;
  const province = cc === 'PH' ? a.state || a.county : a.state || a.county;
  const name = r.name || a[kind];
  if (!name || !Number.isFinite(Number(r.lat)) || !Number.isFinite(Number(r.lon))) return null;

  let news = name;
  let parents;
  if (kind === 'state' || kind === 'region') parents = [];
  else if (TOWN.has(kind)) parents = [province];
  else if (PART.has(kind)) { parents = [town, province]; news = town || name; }
  else return null;
  const label = [name, ...parents.filter((p) => p && p !== name), a.country].filter(Boolean).join(', ');
  return { label, name: news, cc: cc || undefined, lat: round(r.lat), lon: round(r.lon), kind: KIND_LABEL[kind] || '' };
}

export async function searchPlaces(text, signal) {
  const ask = async (country) => {
    const url = `${NOMINATIM}/search?q=${encodeURIComponent(text)}&format=jsonv2&addressdetails=1&limit=12&accept-language=en${country ? '&countrycodes=ph' : ''}`;
    const seen = new Set();
    const out = [];
    for (const r of await getJson(url, signal)) {
      const p = fromNominatim(r);
      if (!p || seen.has(p.label)) continue;
      seen.add(p.label);
      out.push(p);
    }
    return out;
  };
  const here = await ask(true);
  return here.length ? here : ask(false);
}

/** Find coordinates for a named place in the Philippines. Tries the most specific wording first. */
export async function geocode(attempts, signal) {
  for (const q of attempts) {
    const rows = await getJson(`${NOMINATIM}/search?q=${encodeURIComponent(q)}&format=jsonv2&countrycodes=ph&limit=1`, signal);
    if (rows[0]) return { lat: round(rows[0].lat), lon: round(rows[0].lon) };
  }
  return null;
}

/** Name for a pair of coordinates (device location). */
export async function reverse(lat, lon, signal) {
  const r = await getJson(`${NOMINATIM}/reverse?format=jsonv2&zoom=10&accept-language=en&lat=${lat}&lon=${lon}`, signal);
  const a = r.address || {};
  const name = a.city || a.town || a.municipality || a.village || a.county || a.state_district;
  if (!name) return null;
  const cc = (a.country_code || '').toUpperCase();
  let country = '';
  try { country = new Intl.DisplayNames(['en'], { type: 'region' }).of(cc); } catch {}
  const area = (cc === 'PH' ? a.county || a.state : a.state || a.county)?.replace(/ Province$/, '');
  return { name, cc: cc || undefined, label: [name, area && area !== name ? area : null, country].filter(Boolean).join(', ') };
}

/* ---------- browse ---------- */

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
