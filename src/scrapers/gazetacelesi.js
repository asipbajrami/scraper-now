import 'dotenv/config';

import fs from 'node:fs/promises';
import path from 'node:path';
import { log } from 'crawlee';

const API_BASE = 'https://api.celesi.com/gazeta';
const CATEGORY = 'makina';
const PAGE_SIZE = 50;
const MAX_PAGES = Number(process.env.GAZETA_MAX_PAGES || 10);
const DELAY_MS = Number(process.env.GAZETA_DELAY_MS || 500);
const OUTPUT_DIR = process.env.GAZETA_OUTPUT_DIR || 'output/gazetacelesi';

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  Accept: 'application/json',
  Origin: 'https://www.gazetacelesi.al',
  Referer: 'https://www.gazetacelesi.al/',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Step 1 – Fetch listings from the API (premium + regular)
// ---------------------------------------------------------------------------

async function fetchListings(endpoint, page) {
  const url = `${API_BASE}/ads/list/${endpoint}/${CATEGORY}?page=${page}&pageSize=${PAGE_SIZE}`;
  const res = await fetch(url, { headers: HEADERS });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }

  return res.json();
}

// ---------------------------------------------------------------------------
// Step 2 – Normalize a raw API item into a clean object
// ---------------------------------------------------------------------------

function extractProperty(properties, label) {
  const prop = properties.find((p) => p.label === label);
  if (!prop) return null;

  // Some properties have the value in details[].value, some have it as user input
  const details = prop.details || [];
  const selected = details.find((d) => d.value);
  return selected?.value || null;
}

function extractPropertyOptions(properties, label) {
  const prop = properties.find((p) => p.label === label);
  if (!prop) return null;

  const details = prop.details || [];
  const selected = details.filter((d) => d.value);
  return selected.length > 0 ? selected.map((d) => d.value) : null;
}

function normalizeCar(raw) {
  const props = raw.properties || [];

  return {
    id: raw.id,
    title: raw.title,
    description: (raw.description || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').trim().slice(0, 500),
    price: raw.price ? Number(raw.price) : null,
    currency: raw.currency || null,
    action: raw.action || null,
    location: raw.location?.name || null,
    state: raw.location?.state || null,
    brand: extractProperty(props, 'Marka'),
    model: extractProperty(props, 'Modeli'),
    carType: extractProperty(props, 'Tipologjia'),
    condition: extractProperty(props, 'Gjendja e automjetit'),
    year: extractProperty(props, 'Viti i prodhimit'),
    km: extractProperty(props, 'Kilometrazhi'),
    fuel: extractProperty(props, 'Karburanti'),
    transmission: extractProperty(props, 'Kambio'),
    enginePower: extractProperty(props, 'Fuqia motorrike'),
    seats: extractProperty(props, 'Nr. vendeve'),
    doors: extractProperty(props, 'Nr. Dyerve'),
    color: extractProperty(props, 'Ngjyra'),
    interiorColor: extractProperty(props, 'Ngjyra e brendshme'),
    interiorMaterial: extractProperty(props, 'Dizenjo e brendshme'),
    features: extractPropertyOptions(props, 'Paisjet '),
    publishedAt: raw.publishedAt || null,
    expiresAt: raw.expiresAt || null,
    userType: raw.userType || null,
    url: `https://www.gazetacelesi.al/makina/njoftime/${raw.slugUrl}.html`,
    images: (raw.images || []).map((img) => img.url),
    thumbnails: (raw.images || []).map((img) => img.thumbnailUrl),
    scrapedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  log.info(`Starting Gazeta Celesi scraper (max ${MAX_PAGES} pages)...`);

  const allCars = [];

  // Fetch premium listings first
  for (const endpoint of ['premium', '']) {
    const label = endpoint || 'regular';
    let page = 1;
    let totalPages = 1;

    while (page <= Math.min(MAX_PAGES, totalPages)) {
      const apiEndpoint = endpoint ? `list/${endpoint}` : 'list';
      const url = `${API_BASE}/ads/${apiEndpoint}/${CATEGORY}?page=${page}&pageSize=${PAGE_SIZE}`;

      log.info(`Fetching ${label} page ${page}...`);

      try {
        const res = await fetch(url, { headers: HEADERS });

        if (!res.ok) {
          log.warning(`  HTTP ${res.status} for ${label} page ${page}`);
          break;
        }

        const data = await res.json();
        const items = data.data || [];
        const meta = data.meta || {};

        if (page === 1) {
          totalPages = meta.totalPages || 1;
          log.info(`  ${label}: ${meta.totalItems || items.length} total listings, ${totalPages} pages`);
        }

        const normalized = items.map(normalizeCar);
        allCars.push(...normalized);

        log.info(`  Page ${page}: ${items.length} items (total collected: ${allCars.length})`);

        if (items.length < PAGE_SIZE) break;
      } catch (err) {
        log.warning(`  Failed ${label} page ${page}: ${err.message}`);
        break;
      }

      page++;
      await sleep(DELAY_MS);
    }
  }

  // Deduplicate by id
  const seen = new Set();
  const unique = allCars.filter((car) => {
    if (seen.has(car.id)) return false;
    seen.add(car.id);
    return true;
  });

  log.info(`Total collected: ${allCars.length}, unique: ${unique.length}`);

  // Write output
  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  const ndjsonPath = path.join(OUTPUT_DIR, 'cars.ndjson');
  const ndjson = unique.map((r) => JSON.stringify(r)).join('\n');
  await fs.writeFile(ndjsonPath, `${ndjson}\n`, 'utf8');

  const jsonPath = path.join(OUTPUT_DIR, 'cars.json');
  await fs.writeFile(jsonPath, JSON.stringify(unique, null, 2), 'utf8');

  const summary = {
    total: allCars.length,
    unique: unique.length,
    outputDir: OUTPUT_DIR,
  };

  log.info(`Done: ${JSON.stringify(summary)}`);
}

main().catch((err) => {
  log.error(String(err));
  process.exit(1);
});
