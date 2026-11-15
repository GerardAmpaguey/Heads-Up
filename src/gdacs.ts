import { actionFor, type Alert, type HazardKind, type Severity } from './alerts.ts';

// GDACS (UN / European Commission). Public API, no key. Alerts are model output that
// humans may not have reviewed, so we label them as such and always link to the report.
const BASE = 'https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH';

const ymd = (d: Date) => d.toISOString().slice(0, 10);

/** Cyclones at every level (so a green one near you still shows); everything else orange and red. */
export function gdacsUrls(now: Date, days = 7): string[] {
  const from = ymd(new Date(now.getTime() - days * 86_400_000));
  const to = ymd(now);
  return [
    `${BASE}?eventlist=TC&fromdate=${from}&todate=${to}&alertlevel=green;orange;red`,
    `${BASE}?eventlist=FL;VO;WF&fromdate=${from}&todate=${to}&alertlevel=orange;red`,
  ];
}

const KINDS: Record<string, HazardKind> = { TC: 'cyclone', FL: 'flood', VO: 'volcano', WF: 'wildfire' };
const LEVELS: Record<string, Severity> = { red: 'urgent', orange: 'heads-up', green: 'fyi' };

type Feature = {
  bbox?: number[];
  geometry?: { type?: string; coordinates?: unknown } | null;
  properties?: {
    eventtype?: string;
    eventid?: number;
    episodeid?: number;
    name?: string;
    description?: string;
    alertlevel?: string;
    country?: string;
    iso3?: string;
    datemodified?: string;
    fromdate?: string;
    url?: { report?: string };
    severitydata?: { severitytext?: string };
    affectedcountries?: { iso2?: string }[];
  };
};

function centre(f: Feature): [number | null, number | null] {
  const g = f.geometry;
  if (g?.type === 'Point' && Array.isArray(g.coordinates)) {
    const [lon, lat] = g.coordinates as number[];
    if (typeof lat === 'number' && typeof lon === 'number') return [lat, lon];
  }
  const b = f.bbox;
  if (Array.isArray(b) && b.length >= 4 && b.every((n) => typeof n === 'number')) return [(b[1] + b[3]) / 2, (b[0] + b[2]) / 2];
  return [null, null];
}

// GDACS times have no zone and are UTC.
function toIso(value?: string): string | null {
  if (!value) return null;
  const t = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(value) ? value : `${value}Z`);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/** Turn one or more GDACS GeoJSON responses into alerts, newest version of each event only. */
export function normaliseGdacs(json: unknown): Alert[] {
  const features = (json as { features?: Feature[] } | null)?.features;
  if (!Array.isArray(features)) return [];
  const byEvent = new Map<string, Alert>();
  for (const f of features) {
    const p = f.properties;
    const kind = p?.eventtype ? KINDS[p.eventtype] : undefined;
    const severity = p?.alertlevel ? LEVELS[p.alertlevel.toLowerCase()] : undefined;
    const time = toIso(p?.datemodified) || toIso(p?.fromdate);
    if (!p || !kind || !severity || !time || p.eventid == null) continue;
    const [lat, lon] = centre(f);
    const name = (p.name || p.description || `${kind} alert`).trim();
    const detail = p.severitydata?.severitytext?.trim();
    const country = p.affectedcountries?.[0]?.iso2 || undefined;
    const alert: Alert = {
      id: `gdacs:${p.eventtype}:${p.eventid}`,
      category: 'hazard',
      kind,
      severity,
      title: name.replace(/[\s,]+$/, ''),
      summary: `${detail ? `${detail}. ` : ''}GDACS alert level: ${p.alertlevel}. This is an automatic estimate, so check the official agency too.`,
      action: actionFor(kind, { country }),
      source: 'GDACS',
      url: p.url?.report || 'https://www.gdacs.org',
      time,
      lat,
      lon,
      tags: [],
    };
    const seen = byEvent.get(alert.id);
    if (!seen || Date.parse(alert.time) > Date.parse(seen.time)) byEvent.set(alert.id, alert);
  }
  return [...byEvent.values()];
}
