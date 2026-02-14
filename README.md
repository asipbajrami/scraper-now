# scraper-now

Starter scaffold for a cost-efficient scraping stack:

1. `HTTP tier` (`impit` + `cheerio`) for fast/static pages.
2. `Browser tier` (`Crawlee` + `Playwright`) for JS-rendered pages.
3. `Stealth tier` (optional `patchright`) for anti-bot targets.

## Why this shape

- Most pages should stay in HTTP mode for speed and cost.
- Browser rendering is used only when needed.
- Stealth tooling is isolated to hard targets.

## Setup

```bash
npm install
cp .env.example .env
```

Optional stealth dependency:

```bash
npm install patchright
```

If you install Playwright fresh, install browser binaries:

```bash
npx playwright install chromium
```

## Configure targets

- Add URLs to `inputs/urls.txt`.
- Add per-domain policies in `src/config/domainProfiles.js`.

Example domain profile:

```js
const DOMAIN_PROFILES = {
  'example.com': { tier: 'browser', proxyTier: 'datacenter' },
  'hard-target.com': { tier: 'stealth', proxyTier: 'residential' },
};
```

## Configure proxies

In `.env`:

```bash
DATACENTER_PROXY_URLS=http://user:pass@dc-1:8000,http://user:pass@dc-2:8000
RESIDENTIAL_PROXY_URLS=http://user:pass@resi-1:9000
```

## Run

```bash
npm run scrape
```

Or custom paths:

```bash
npm run scrape -- --input inputs/urls.txt --output output/results.ndjson
```

Results are written as NDJSON to `output/results.ndjson`.

## Notes

- `got-scraping` is EOL; this starter uses `impit` for HTTP fingerprinting support.
- If `patchright` is not installed, stealth tier falls back to Playwright and logs a warning.
