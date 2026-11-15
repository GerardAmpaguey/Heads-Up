import { actionFor, type Alert, type Severity } from './alerts.ts';

// USGS Earthquake Hazards Program summary feed (public domain, no key; they ask for credit).
export const USGS_URL = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_month.geojson';

type Feature = {
  id?: string;
  properties?: {
    mag?: number | null;
    place?: string | null;
    time?: number;
    url?: string;
    alert?: string | null;
    tsunami?: number;
    sig?: number;
    type?: string;
    title?: string;
  };
  geometry?: { coordinates?: number[] } | null;
};

export function usgsSeverity(mag: number, alert: string | null | undefined, tsunami: boolean): Severity {
  if (alert === 'red' || mag >= 7.5 || (tsunami && mag >= 7)) return 'urgent';
  if (alert === 'orange' || mag >= 6.5) return 'heads-up';
  return 'fyi';
}

/** Turn a USGS GeoJSON feed into alerts. Skips anything malformed. */
export function normaliseUsgs(json: unknown): Alert[] {
  const features = (json as { features?: Feature[] } | null)?.features;
  if (!Array.isArray(features)) return [];
  const out: Alert[] = [];
  for (const f of features) {
    const p = f.properties;
    const c = f.geometry?.coordinates;
    if (!p || typeof p.mag !== 'number' || typeof p.time !== 'number' || !f.id) continue;
    if (p.type && p.type !== 'earthquake') continue;
    const [lon, lat] = Array.isArray(c) ? c : [];
    const tsunami = p.tsunami === 1;
    const place = (p.place || 'an offshore area').replace(/^\d+\s?km\s\w+\sof\s/i, '');
    const where = p.place || 'an offshore area';
    out.push({
      id: `usgs:${f.id}`,
      category: 'hazard',
      kind: 'earthquake',
      severity: usgsSeverity(p.mag, p.alert, tsunami),
      title: `M${p.mag.toFixed(1)} earthquake near ${place}`,
      summary: `A magnitude ${p.mag.toFixed(1)} earthquake was recorded ${where}.${tsunami ? ' A tsunami message was issued.' : ''}`,
      action: actionFor('earthquake', { tsunami }),
      source: 'USGS',
      url: p.url || 'https://earthquake.usgs.gov/earthquakes/map/',
      time: new Date(p.time).toISOString(),
      lat: typeof lat === 'number' ? lat : null,
      lon: typeof lon === 'number' ? lon : null,
      tsunami,
      magnitude: p.mag,
      tags: [],
    });
  }
  return out;
}
