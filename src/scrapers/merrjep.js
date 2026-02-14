import 'dotenv/config';

import fs from 'node:fs/promises';
import path from 'node:path';
import * as cheerio from 'cheerio';
import { log } from 'crawlee';

const BASE_URL = 'https://www.merrjep.al';
const SEARCH_URL = `${BASE_URL}/Home2/Search`;
const CATEGORY_ID = 3016; // Makina (cars)
const PAGE_SIZE = 50;
const MAX_PAGES = Number(process.env.MERRJEP_MAX_PAGES || 5);
const DELAY_MS = Number(process.env.MERRJEP_DELAY_MS || 800);
const DETAIL_DELAY_MS = Number(process.env.MERRJEP_DETAIL_DELAY_MS || 500);
const OUTPUT_DIR = process.env.MERRJEP_OUTPUT_DIR || 'output/merrjep';
const FETCH_DETAILS = process.env.MERRJEP_FETCH_DETAILS !== 'false';

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'X-Requested-With': 'XMLHttpRequest',
  Referer: `${BASE_URL}/njoftime/makina/`,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Step 1 – Search API: get listing summaries page by page
// ---------------------------------------------------------------------------

async function fetchSearchPage(page) {
  const body = new URLSearchParams({
    CategoryId: String(CATEGORY_ID),
    Page: String(page),
  });

  const res = await fetch(SEARCH_URL, {
    method: 'POST',
    headers: {
      ...HEADERS,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  if (!res.ok) {
    throw new Error(`Search HTTP ${res.status} for page ${page}`);
  }

  const data = await res.json();
  const ads = data.Result?.Ads;

  if (!ads) {
    throw new Error(`No Ads in response for page ${page}`);
  }

  // Parse total from CountTabs: " 1-50 nga 690078"
  let totalAds = 0;
  const allTab = ads.CountTabs?.find((t) => t.Active);
  if (allTab?.After) {
    const match = allTab.After.match(/(\d[\d\s]*)\s*$/);
    if (match) {
      totalAds = Number(match[1].replace(/\s/g, ''));
    }
  }

  return {
    items: ads.Items || [],
    totalAds,
    pageSize: ads.Query?.PageSize || PAGE_SIZE,
  };
}

function normalizeListingItem(item) {
  return {
    id: item.Id,
    title: item.Title,
    url: `${BASE_URL}${item.AdUrl}`,
    brand: item.CarMake?.Name || null,
    model: item.CarModel?.Name || null,
    price: item.ActualPrice || null,
    currency: item.Currency || null,
    location: item.Location?.Name || null,
    isCompany: item.IsCompany || false,
    dateDisplay: item.DateDisplay || null,
    imageUrl: item.PrimaryImage?.Url || null,
    imageCount: item.Images?.length || 0,
    isCargoEnabled: item.IsCargoEnabled || false,
  };
}

// ---------------------------------------------------------------------------
// Step 2 – Detail page: parse car properties from HTML
// ---------------------------------------------------------------------------

async function fetchDetailPage(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': HEADERS['User-Agent'],
      Accept: 'text/html',
    },
    redirect: 'follow',
  });

  if (!res.ok) {
    throw new Error(`Detail HTTP ${res.status} for ${url}`);
  }

  return res.text();
}

function parseCarDetails(html) {
  const $ = cheerio.load(html);
  const details = {};

  // Parse tag-items: <a class="tag-item"><span>Label:</span><bdi>Value</bdi></a>
  $('a.tag-item').each((_, el) => {
    const label = $(el).find('span').first().text().replace(':', '').trim();
    const value = $(el).find('bdi').first().text().trim();
    if (label && value) {
      details[label] = value;
    }
  });

  // Parse inline properties: <span>Viti:</span><bdi>2007</bdi>
  $('span').each((_, el) => {
    const text = $(el).text().trim();
    if (text.endsWith(':')) {
      const label = text.replace(':', '').trim();
      const bdi = $(el).next('bdi').text().trim();
      if (label && bdi && !details[label]) {
        details[label] = bdi;
      }
    }
  });

  // Parse description
  const descEl = $('.description-area span, .ad-description span').first();
  const description = descEl.length ? descEl.text().trim() : '';

  // Parse all images
  const images = [];
  $('img[data-src*="media.merrjep.al"], [data-src*="media.merrjep.al"]').each((_, el) => {
    const src = $(el).attr('data-src') || $(el).attr('src');
    if (src && !images.includes(src)) {
      images.push(src);
    }
  });

  return {
    year: details['Viti'] ? Number(details['Viti']) : null,
    fuel: details['Karburanti'] || null,
    transmission: details['Kambio'] || null,
    km: details['Kilometrazhi'] ? Number(details['Kilometrazhi'].replace(/\D/g, '')) : null,
    color: details['Ngjyra'] || null,
    engineSize: details['Kubikazhi'] || null,
    bodyType: details['Tipi'] || null,
    manufacturer: details['Prodhuesi'] || null,
    modelDetail: details['Modeli'] || null,
    condition: details['Kushti'] || null,
    description: description.slice(0, 500) || null,
    detailImages: images,
    rawProps: details,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  log.info(`Starting MerrJep scraper (max ${MAX_PAGES} pages, details=${FETCH_DETAILS})...`);

  // Step 1: Fetch search pages
  const allListings = [];
  let totalAds = 0;

  for (let page = 1; page <= MAX_PAGES; page++) {
    log.info(`Fetching search page ${page}/${MAX_PAGES}...`);

    try {
      const result = await fetchSearchPage(page);
      totalAds = result.totalAds;

      const normalized = result.items.map(normalizeListingItem);
      allListings.push(...normalized);

      log.info(`  Page ${page}: ${result.items.length} listings (total available: ${totalAds})`);

      if (result.items.length < result.pageSize) {
        log.info('  Last page reached.');
        break;
      }
    } catch (err) {
      log.warning(`  Failed page ${page}: ${err.message}`);
      break;
    }

    if (page < MAX_PAGES) {
      await sleep(DELAY_MS);
    }
  }

  log.info(`Collected ${allListings.length} listings from search.`);

  // Step 2: Fetch detail pages (optional)
  if (FETCH_DETAILS && allListings.length > 0) {
    log.info(`Fetching details for ${allListings.length} listings...`);

    for (let i = 0; i < allListings.length; i++) {
      const listing = allListings[i];

      try {
        log.info(`  [${i + 1}/${allListings.length}] ${listing.brand} ${listing.model} (${listing.id})...`);
        const html = await fetchDetailPage(listing.url);
        const details = parseCarDetails(html);

        Object.assign(listing, details);
      } catch (err) {
        log.warning(`  Failed detail ${listing.id}: ${err.message}`);
      }

      if (i < allListings.length - 1) {
        await sleep(DETAIL_DELAY_MS);
      }
    }
  }

  // Add scraped timestamp
  for (const listing of allListings) {
    listing.scrapedAt = new Date().toISOString();
  }

  // Write output
  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  const ndjsonPath = path.join(OUTPUT_DIR, 'cars.ndjson');
  const ndjson = allListings.map((r) => JSON.stringify(r)).join('\n');
  await fs.writeFile(ndjsonPath, `${ndjson}\n`, 'utf8');

  const jsonPath = path.join(OUTPUT_DIR, 'cars.json');
  await fs.writeFile(jsonPath, JSON.stringify(allListings, null, 2), 'utf8');

  const summary = {
    totalAvailable: totalAds,
    pagesScraped: Math.min(MAX_PAGES, Math.ceil(allListings.length / PAGE_SIZE)),
    listings: allListings.length,
    withDetails: FETCH_DETAILS ? allListings.filter((l) => l.year || l.fuel).length : 0,
    outputDir: OUTPUT_DIR,
  };

  log.info(`Done: ${JSON.stringify(summary)}`);
}

main().catch((err) => {
  log.error(String(err));
  process.exit(1);
});
