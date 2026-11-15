// Shared types and logic for hazard alerts: severity, "what to do" text, distance and
// picking what is relevant to the visitor. No network code lives here, so it is easy to test.

export type Severity = 'urgent' | 'heads-up' | 'fyi';
export type HazardKind = 'earthquake' | 'cyclone' | 'flood' | 'volcano' | 'wildfire';

export type Alert = {
  id: string;
  category: 'hazard';
  kind: HazardKind;
  severity: Severity;
  title: string;
  summary: string;
  action: string;
  source: string;
  url: string;
  time: string; // ISO 8601, UTC
  lat: number | null;
  lon: number | null;
  tsunami?: boolean;
  magnitude?: number;
  image?: string;
  imageCredit?: string;
  tags: string[];
};

/** A web dev or AI news item. Same fields as a hazard alert where they overlap, but no location. */
export type NewsItem = {
  id: string;
  category: 'webdev' | 'ai';
  severity: Severity;
  title: string;
  summary: string;
  action: string;
  source: string;
  url: string;
  time: string; // ISO 8601, UTC
  tags: string[];
  image?: string;
  imageCredit?: string;
};

export type Place = { lat: number; lon: number; country?: string; city?: string; chosen?: boolean };

export type PersonalAlert = Alert & { distanceKm: number | null; bearing: number | null; near: boolean };

const RANK: Record<Severity, number> = { urgent: 0, 'heads-up': 1, fyi: 2 };
const BY_RANK: Severity[] = ['urgent', 'heads-up', 'fyi'];

/** One step more severe, never past urgent. */
export function bump(severity: Severity): Severity {
  return BY_RANK[Math.max(0, RANK[severity] - 1)];
}

/** Compass bearing in whole degrees (0 = north, 90 = east) from the first point to the second. */
export function bearingDeg(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLon = rad(bLon - aLon);
  const y = Math.sin(dLon) * Math.cos(rad(bLat));
  const x = Math.cos(rad(aLat)) * Math.sin(rad(bLat)) - Math.sin(rad(aLat)) * Math.cos(rad(bLat)) * Math.cos(dLon);
  return Math.round(((Math.atan2(y, x) * 180) / Math.PI + 360) % 360);
}

/** Great-circle distance in km. */
export function distanceKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(bLat - aLat);
  const dLon = rad(bLon - aLon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Local agencies we know by name. Everyone else is told to use "your official local agency".
const AGENCIES: Record<string, Partial<Record<HazardKind, string>>> = {
  PH: { cyclone: 'PAGASA', flood: 'PAGASA', earthquake: 'PHIVOLCS', volcano: 'PHIVOLCS' },
};

export function agencyFor(kind: HazardKind, country?: string): string {
  return (country && AGENCIES[country.toUpperCase()]?.[kind]) || 'your official local agency';
}

/** Plain-language steps. Fixed text, not AI-written, so it can never invent advice. */
export function actionFor(kind: HazardKind, opts: { tsunami?: boolean; country?: string } = {}): string {
  const agency = agencyFor(kind, opts.country);
  const check = `Check ${agency} before acting.`;
  switch (kind) {
    case 'earthquake':
      return opts.tsunami
        ? `A tsunami message was issued. If you are near the coast, move to higher ground and follow evacuation instructions. ${check}`
        : `If you feel shaking, drop, cover and hold on. Expect aftershocks, and keep a bag and your phone charger ready. ${check}`;
    case 'cyclone':
      return `Charge phones and power banks, store drinking water and food, secure loose items outside, and back up work files. ${check}`;
    case 'flood':
      return `Keep valuables and devices off the floor, avoid walking or driving through flood water, and keep devices charged. ${check}`;
    case 'volcano':
      return `Stay out of restricted zones, keep masks handy if ash is possible, and be ready to follow evacuation orders. ${check}`;
    case 'wildfire':
      return `Be ready to leave: keep documents, a charged phone and essentials together, and follow evacuation orders. ${check}`;
  }
}

const NEAR_KM = 500;
const WORLD_KM = 1500;

/**
 * Choose what the visitor should see.
 * - With a location: anything within WORLD_KM, plus every urgent alert anywhere.
 *   Events within NEAR_KM are marked near, and an event close by is bumped one step.
 * - Without a location: global heads-up and urgent alerts only.
 */
export function personalise(alerts: Alert[], place: Place | null, limit = 40): PersonalAlert[] {
  const out: PersonalAlert[] = [];
  for (const a of alerts) {
    const km = place && a.lat != null && a.lon != null ? Math.round(distanceKm(place.lat, place.lon, a.lat, a.lon)) : null;
    const bearing = km != null && place && a.lat != null && a.lon != null ? bearingDeg(place.lat, place.lon, a.lat, a.lon) : null;
    const near = km != null && km <= NEAR_KM;
    let severity = a.severity;
    // A quake you may have felt, or a storm on your doorstep, matters more than the same one far away.
    if (near && (a.kind !== 'earthquake' || (a.magnitude ?? 0) >= 5)) severity = bump(severity);
    const keep = place ? severity === 'urgent' || (km != null && km <= WORLD_KM) : severity !== 'fyi';
    if (keep) out.push({ ...a, severity, distanceKm: km, bearing, near });
  }
  out.sort(
    (x, y) =>
      RANK[x.severity] - RANK[y.severity] ||
      (x.distanceKm ?? 1e9) - (y.distanceKm ?? 1e9) ||
      Date.parse(y.time) - Date.parse(x.time),
  );
  return out.slice(0, limit);
}
