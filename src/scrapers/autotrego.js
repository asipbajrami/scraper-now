import 'dotenv/config';

import fs from 'node:fs/promises';
import path from 'node:path';
import { log } from 'crawlee';

const API_URL = 'https://autotrego.com/api/cars';
const PAGE_SIZE = 50;
const MAX_PAGES = Number(process.env.AUTOTREGO_MAX_PAGES || 5);
const DELAY_MS = Number(process.env.AUTOTREGO_DELAY_MS || 400);
const OUTPUT_DIR = process.env.AUTOTREGO_OUTPUT_DIR || 'output/autotrego';

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  Accept: 'application/json',
  'X-Application-Id': 'WEB',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Step 1 – Fetch paginated car listings from the API
// ---------------------------------------------------------------------------

async function fetchPage(page) {
  const url = `${API_URL}?page=${page}&limit=${PAGE_SIZE}`;
  const res = await fetch(url, { headers: HEADERS });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for page ${page}`);
  }

  return res.json();
}

// ---------------------------------------------------------------------------
// Step 2 – Normalize a raw API item
// ---------------------------------------------------------------------------

function normalizeCar(raw) {
  const mod = raw.modification || {};

  return {
    id: raw.id,
    brand: mod.brand || null,
    model: mod.model || raw.makeTypeId || null,
    generation: raw.generation || mod.generation || null,
    engine: raw.engine || mod.engine || null,
    description: raw.description || null,
    price: raw.price || null,
    location: raw.location || null,
    year: raw.year || null,
    km: raw.mileage || null,
    fuel: mod.fuel || raw.engineType || null,
    transmission: raw.transmission || null,
    bodyType: raw.bodyType || mod.coupe || null,
    color: raw.color || null,
    isSold: raw.isSold || false,
    type: raw.type || null,
    // Detailed specs from modification
    powertrain: mod.powertrain || null,
    doors: mod.doors ? Number(mod.doors) : null,
    seats: mod.places ? Number(mod.places) : null,
    engineCc: mod.engineDisplacement ? Number(mod.engineDisplacement) : null,
    torqueNm: mod.torqueNm ? Number(mod.torqueNm) : null,
    cylinders: mod.cilinders ? Number(mod.cilinders) : null,
    driveType: mod.drive || null,
    emissionStandard: mod.emissionStandard || null,
    fuelConsumptionCombined: mod.fuelConsumptionCombined ? Number(mod.fuelConsumptionCombined) : null,
    fuelConsumptionUrban: mod.fuelConsumptionUrban ? Number(mod.fuelConsumptionUrban) : null,
    fuelConsumptionExtraurban: mod.fuelConsumptionExtraurban ? Number(mod.fuelConsumptionExtraurban) : null,
    curbWeight: mod.curbWeight ? Number(mod.curbWeight) : null,
    lengthMm: mod.length ? Number(mod.length) : null,
    widthMm: mod.width ? Number(mod.width) : null,
    heightMm: mod.height ? Number(mod.height) : null,
    // Meta
    views: raw.views || 0,
    slug: raw.slug || null,
    url: raw.slug ? `https://autotrego.com/auto/${raw.slug}` : null,
    images: raw.images || [],
    createdAt: raw.createdAt || null,
    validUntil: raw.validUntil || null,
    scrapedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  log.info(`Starting AutoTrego scraper (max ${MAX_PAGES} pages, ${PAGE_SIZE}/page)...`);

  const allCars = [];
  let totalPages = 1;

  for (let page = 1; page <= Math.min(MAX_PAGES, totalPages); page++) {
    log.info(`Fetching page ${page}/${Math.min(MAX_PAGES, totalPages)}...`);

    try {
      const data = await fetchPage(page);

      if (page === 1) {
        totalPages = data.totalPages || 1;
        log.info(`  Total: ~${totalPages * PAGE_SIZE} cars across ${totalPages} pages`);
      }

      const items = data.items || [];
      const normalized = items.map(normalizeCar);
      allCars.push(...normalized);

      log.info(`  Page ${page}: ${items.length} items (total: ${allCars.length})`);

      if (items.length < PAGE_SIZE) break;
    } catch (err) {
      log.warning(`  Failed page ${page}: ${err.message}`);
      break;
    }

    if (page < Math.min(MAX_PAGES, totalPages)) {
      await sleep(DELAY_MS);
    }
  }

  // Write output
  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  const ndjsonPath = path.join(OUTPUT_DIR, 'cars.ndjson');
  const ndjson = allCars.map((r) => JSON.stringify(r)).join('\n');
  await fs.writeFile(ndjsonPath, `${ndjson}\n`, 'utf8');

  const jsonPath = path.join(OUTPUT_DIR, 'cars.json');
  await fs.writeFile(jsonPath, JSON.stringify(allCars, null, 2), 'utf8');

  const summary = {
    totalAvailable: totalPages * PAGE_SIZE,
    pagesScraped: Math.min(MAX_PAGES, totalPages),
    listings: allCars.length,
    outputDir: OUTPUT_DIR,
  };

  log.info(`Done: ${JSON.stringify(summary)}`);
}

main().catch((err) => {
  log.error(String(err));
  process.exit(1);
});
