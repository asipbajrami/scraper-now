import 'dotenv/config';

import fs from 'node:fs/promises';
import path from 'node:path';
import { log } from 'crawlee';

const BASE_URL = 'https://autoshqip.com';
const LISTING_PAGE = `${BASE_URL}/makina-ne-shitje`;
const DELAY_MS = Number(process.env.AUTOSHQIP_DELAY_MS || 500);
const OUTPUT_DIR = process.env.AUTOSHQIP_OUTPUT_DIR || 'output/autoshqip';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      Accept: 'application/json, text/plain, */*',
      Referer: BASE_URL,
    },
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }

  return res.json();
}

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      Accept: 'text/html',
      Referer: BASE_URL,
    },
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }

  return res.text();
}

// ---------------------------------------------------------------------------
// Step 1 – Get the current buildId + initial listing IDs from the listing page
// ---------------------------------------------------------------------------

async function getBuildIdAndListings() {
  log.info('Fetching listing page to extract buildId...');
  const html = await fetchHtml(LISTING_PAGE);

  const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!match) {
    throw new Error('Could not find __NEXT_DATA__ on the listing page');
  }

  const nextData = JSON.parse(match[1]);
  const buildId = nextData.buildId;
  const { initialCars = [], initialIgCars = [] } = nextData.props?.pageProps || {};

  log.info(
    `buildId: ${buildId} | site listings: ${initialCars.length} | IG listings: ${initialIgCars.length}`,
  );

  return { buildId, initialCars, initialIgCars };
}

// ---------------------------------------------------------------------------
// Step 2 – Fetch full car details via the _next/data API
// ---------------------------------------------------------------------------

async function fetchCarDetails(buildId, carId) {
  const url = `${BASE_URL}/_next/data/${buildId}/car-details/${carId}.json`;
  const data = await fetchJson(url);
  return data.pageProps?.initialCarDetails || null;
}

// ---------------------------------------------------------------------------
// Step 3 – Normalize the raw API response into a clean object
// ---------------------------------------------------------------------------

function normalizeCar(raw) {
  if (!raw) return null;

  return {
    id: raw.id,
    brand: raw.brand,
    model: raw.model,
    generation: raw.generation || null,
    trim: raw.trim || null,
    year: raw.year,
    km: raw.km,
    price: raw.price ? Number(raw.price) : null,
    currency: raw.priceCurrency || '€',
    fuelTypeId: raw.fuelTypeId,
    transmission: raw.transmission,
    engineCc: raw.e ? Number(raw.e) : null,
    engineType: raw.d || null,
    hp: raw.k ? Number(raw.k) : null,
    torqueNm: raw.l ? Number(raw.l) : null,
    zeroToHundred: raw.m ? Number(raw.m) : null,
    fuelConsumptionMixed: raw.a ? Number(raw.a) : null,
    fuelConsumptionHighway: raw.b ? Number(raw.b) : null,
    fuelConsumptionCity: raw.c ? Number(raw.c) : null,
    emissionStandard: raw.j || null,
    color: raw.n || null,
    location: raw.location || raw.o || null,
    importTaxPaid: raw.importTaxPaid ?? raw.p ?? null,
    hasDocumentsPaid: raw.hasDocumentsPaid ?? raw.q ?? null,
    exchangeAllowed: raw.exchangeAllowed ?? raw.r ?? null,
    isSold: raw.isSold || false,
    postedTime: raw.postedTime,
    postShortcode: raw.postShortcode,
    numberOfPictures: raw.numberOfPictures || 0,
    views: raw.s ?? raw.views ?? 0,
    sourceId: raw.sourceId,
    scrapedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Step 4 – Build image URLs
// ---------------------------------------------------------------------------

function getImageUrls(car) {
  if (!car.postShortcode || !car.numberOfPictures) return [];

  const shortcode = car.postShortcode.startsWith('/')
    ? car.postShortcode
    : `/${car.postShortcode}`;

  return Array.from({ length: car.numberOfPictures }, (_, i) =>
    `https://cdn.autoshqip.com/${shortcode}/${i + 1}.jpeg`,
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const { buildId, initialCars, initialIgCars } = await getBuildIdAndListings();

  const allListings = [...initialCars, ...initialIgCars];
  const carIds = allListings.map((c) => c.id);
  const uniqueIds = [...new Set(carIds)];

  log.info(`Fetching details for ${uniqueIds.length} cars...`);

  const results = [];
  const errors = [];

  for (let i = 0; i < uniqueIds.length; i++) {
    const carId = uniqueIds[i];

    try {
      log.info(`[${i + 1}/${uniqueIds.length}] Fetching ${carId}...`);
      const raw = await fetchCarDetails(buildId, carId);
      const normalized = normalizeCar(raw);

      if (normalized) {
        normalized.imageUrls = getImageUrls(normalized);
        results.push(normalized);
      }
    } catch (err) {
      log.warning(`Failed to fetch ${carId}: ${err.message}`);
      errors.push({ id: carId, error: err.message });
    }

    if (i < uniqueIds.length - 1) {
      await sleep(DELAY_MS);
    }
  }

  // Write results
  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  const ndjsonPath = path.join(OUTPUT_DIR, 'cars.ndjson');
  const ndjson = results.map((r) => JSON.stringify(r)).join('\n');
  await fs.writeFile(ndjsonPath, `${ndjson}\n`, 'utf8');

  const jsonPath = path.join(OUTPUT_DIR, 'cars.json');
  await fs.writeFile(jsonPath, JSON.stringify(results, null, 2), 'utf8');

  const summary = {
    total: uniqueIds.length,
    scraped: results.length,
    errors: errors.length,
    outputDir: OUTPUT_DIR,
  };

  log.info(`Done: ${JSON.stringify(summary)}`);

  if (errors.length) {
    log.warning(`Errors: ${JSON.stringify(errors)}`);
  }
}

main().catch((err) => {
  log.error(String(err));
  process.exit(1);
});
