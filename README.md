# Heads Up

What to prepare for, wherever you are. Heads Up puts the things worth knowing about in one place: storms, earthquakes, floods and local news for any city in the world, plus web dev changes (WordPress, Astro, Next.js and more), AI and tech, and environment news. Everything is ranked by how much it matters: urgent, heads up or FYI.

Live at https://heads-up.ampagueyg.workers.dev/

## Layout

A news front page, built for scanning:

- Lead story with a ranked list of the next most important alerts beside it
- "Latest" list with thumbnails, plus a sidebar (urgent now, what we watch)
- A tile section per topic (Around you, Web dev, AI & tech, Planet) with "See all"
- Section tabs under the masthead: Home, Around you, Web dev, AI & tech, Planet, Latest
- Click any story for what to do and a link to the source
- Search across all alerts

## Works anywhere

Nothing is tied to one country. The location button in the masthead sets where "Around you" looks:

- **Without picking anything**, the page uses the city of your connection (from Cloudflare, no permission prompt).
- **Search** finds any city, town, region or neighbourhood in the world (OpenStreetMap Nominatim). Places in your own country are listed first, so a search for "San Fernando" from the Philippines shows the Philippine ones before Spain's.
- **Use my device location** asks the browser for your position and names it.
- **Browse Philippine provinces** is an extra for visitors in the Philippines: province, then city or town, then barangay, from the official PSGC list.

The choice is saved on the device only.

## How it works

Everything on the page comes from `/api/alerts`, served by a Cloudflare Worker (`src/worker.ts`). Nothing is made up.

- **Hazards (Around you):** USGS earthquakes (past month, M4.5+) and GDACS (tropical cyclones, plus orange and red floods, volcanoes and wildfires), worldwide. Alerts are ranked by distance from your location. Events within 500 km are bumped one severity step (earthquakes only from M5). With a location, events within 1,500 km and all urgent ones are shown; without one, only heads-up and urgent.
- **What to do:** fixed, plain-language steps per hazard (never AI-written). They name the official agency to check for about 20 countries (PAGASA and PHIVOLCS, the US National Weather Service, JMA, BMKG, the Bureau of Meteorology, IMD, the Met Office, GeoNet and more, in `AGENCIES` in `src/alerts.ts`). For events near you, that is your own country's agency; anywhere else it says "your official local agency".
- **Local news (Around you):** news about your city from Google News and Bing News search RSS (`src/local.ts`), in your country's English edition where one exists and the international English edition elsewhere. The search words follow the country: typhoons in East and South-East Asia, hurricanes in the Americas, cyclones around Australia and the Indian Ocean, plus local extras such as class suspensions in the Philippines, tornadoes in the US and bushfires in Australia. Hazard stories from the last three days are rated by severity; other stories that name the city from the last week show as FYI. Sports and showbiz are dropped. Cached for 30 minutes per place. These are news reports, not official alerts, and are labelled as such.
- **Local papers:** some papers are read directly, because search engines miss them (`LOCAL_FEEDS` in `src/local.ts`). Today that is the Baguio Herald Express for Baguio and nearby Benguet towns. Add a paper for any city by adding its RSS feed and the place names it covers.
- **Web dev, AI and tech, and Planet:** RSS and Atom feeds listed in `src/news.ts` (WordPress, security blogs, framework and tool releases, design and browser blogs, AI labs, tech and security news, and environment, climate and health sources) plus PHP and Node.js end-of-life dates from endoflife.date. Add or remove a feed by editing the `FEEDS` list.
- **Severity (web dev, AI and tech, Planet):** plain keyword rules in `rate()`. Exploited or critical security problems in web dev are urgent; security fixes, deprecations, end-of-life and new major versions are heads-up; everything else is FYI. AI, tech and Planet news is never urgent; outbreaks, emergencies and similar words make a Planet story heads-up.
- **Storage and refresh:** results are kept in the `ALERTS` KV namespace. A cron runs every 30 minutes. A visit only triggers a refresh on the very first run or if the cron has fallen behind (over 45 minutes). If one source fails, its previous data is kept, and `/api/alerts` lists which sources are healthy.
- **Photos:** each news item uses the picture its publisher attached to the post, hotlinked and credited, never copied. GitHub release feeds have none (their thumbnails are avatars). Cyclone alerts use GDACS's overview map. Other hazards draw a locator graphic from distance and bearing.
- **Credit and licensing:** USGS data is public domain (credit requested). GDACS values are automatic estimates, so each alert credits GDACS and links to its report. Place search uses OpenStreetMap data. News items show a short summary and link to the original.

## Run it

```
npm install
npm run dev
```

Tests: `npm test` (Node 22+, uses fixtures and mocks, no network).

## Deploy

Cloudflare Workers (`wrangler.jsonc` serves `./site` and runs `src/worker.ts` for `/api/*`). The repo is connected under Workers & Pages in the Cloudflare dashboard, so every push to `main` deploys.

## Next

1. Local news in the local language for non-English countries (search in the country's own edition and words)
2. More official warning feeds by country (for example NOAA/NWS alerts in the US, PAGASA bulletins in the Philippines)
3. Optional daily digest email
