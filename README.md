# Heads Up

The important things to prepare for, in one place: hazards near you, web dev changes (WordPress, Astro, Next.js and more) and AI news.

## Status

Front end only, filled with **demo data** (`site/js/data.js`). Nothing on the page is real news yet.

## Layout

A news front page, built for scanning:

- Lead story with a stacked list of the next most important alerts beside it
- "Latest" list with thumbnails, plus a sidebar (urgent now, your watchlist, what we watch)
- A tile section per topic (Around you, Web dev, AI) with "View more +"
- Section tabs under the masthead: Home, Around you, Web dev, AI, Latest, Watchlist
- Click any story for what to do and a link to the source
- Watchlist: pick the tools you use, saved in the browser
- Search across all alerts

## Photos

Each alert can carry an optional `image` (the source's own picture, hotlinked and never copied) and `imageCredit`. The card shows it with an "Image: Source" label. With no image, or if it fails to load, the card falls back to its coloured icon art. The live-feed Worker will fill `image` from the feed's media tag or the article's `og:image`. Official maps (USGS, NOAA, NASA, GDACS) are the safest source for hazard imagery. Check each source's terms.

## Run it

```
npm install
npm run dev
```

## Deploy

Static site on Cloudflare Workers (`wrangler.jsonc` serves `./site`). Connect this repo under Workers & Pages in the Cloudflare dashboard, and every push to `main` deploys.

## Next

1. A scheduled Worker that pulls official feeds (USGS, GDACS, NOAA, GitHub releases, WordPress and vulnerability feeds, endoflife.date)
2. Severity scoring and a one-line "what to do" per alert
3. Location from the request, so "Around you" is real
4. Optional daily digest email

## How it works

Everything on the page comes from `/api/alerts`, served by a Cloudflare Worker (`src/worker.ts`). Nothing is made up.

- **Hazards (Around you):** USGS earthquakes (past month, M4.5+) and GDACS (tropical cyclones, plus orange and red floods, volcanoes and wildfires). Alerts are ranked by distance from the visitor's approximate location (Cloudflare's request location, or `?lat=&lon=` to override). Events within 500 km are bumped one severity step (earthquakes only from M5). With a location, events within 1,500 km and all urgent ones are shown; without one, only heads-up and urgent.
- **Local news (Around you):** news stories about the chosen city, from Google News search RSS (`src/local.ts`): storms, quakes, floods, outages, evacuations and similar, from the last three days. Cached for 30 minutes per place. These are news reports, not official alerts, and are labelled as such. Needs a place name, so a place picked by search works and a raw device location does not.
- **Web dev and AI:** RSS and Atom feeds listed in `src/news.ts` (WordPress, security blogs, framework and tool releases, design and browser blogs, AI labs and news sites) plus PHP and Node.js end-of-life dates from endoflife.date. Add or remove a feed by editing the `FEEDS` list.
- **Severity (web dev and AI):** plain keyword rules in `rate()`. Exploited or critical security problems in web dev are urgent; security fixes, deprecations, end-of-life and new major versions are heads-up; everything else is FYI. AI news is never urgent.
- **Storage and refresh:** results are kept in the `ALERTS` KV namespace. A cron runs every 30 minutes. A visit only triggers a refresh on the very first run or if the cron has fallen behind (over 45 minutes). If one source fails, its previous data is kept, and `/api/alerts` lists which sources are healthy.
- **Photos:** each news item uses the picture its publisher attached to the post, hotlinked and credited, never copied. GitHub release feeds have none (their thumbnails are avatars). Cyclone alerts use GDACS's overview map. Other hazards draw a locator graphic from distance and bearing.
- **Credit and licensing:** USGS data is public domain (credit requested). GDACS values are automatic estimates, so each alert credits GDACS and links to its report. News items show a short summary and link to the original.
- **Tests:** `npm test` (Node 22+, uses fixtures and mocks, no network).
