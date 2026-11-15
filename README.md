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
