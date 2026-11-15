# Heads Up

The important things to prepare for, in one place: hazards near you, web dev changes (WordPress, Astro, Next.js and more) and AI news.

## Status

Front end only, filled with **demo data** (`site/js/data.js`). Nothing on the page is real news yet.

## Layout

- Hero for the most urgent alert, with an "Also needs attention" list on wide screens
- Rows of poster cards you can scroll sideways, like a streaming site
- Top tabs on desktop, bottom tab bar on phones: Home, Around you, Web dev, AI, Watchlist
- Tap a card for what to do and a link to the source
- Watchlist: pick the tools you use, saved in the browser
- Search across all alerts

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
