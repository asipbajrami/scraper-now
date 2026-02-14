import 'dotenv/config';

import fs from 'node:fs/promises';
import path from 'node:path';
import { log } from 'crawlee';

const API_BASE = 'https://img-autoconnect.uk';
const MEDIA_BASE = `${API_BASE}/`;
const PAGE_SIZE = 50;
const MAX_PAGES = Number(process.env.AUTOCONNECT_MAX_PAGES || 10);
const DELAY_MS = Number(process.env.AUTOCONNECT_DELAY_MS || 500);
const DETAIL_DELAY_MS = Number(process.env.AUTOCONNECT_DETAIL_DELAY_MS || 300);
const FETCH_DETAILS = process.env.AUTOCONNECT_FETCH_DETAILS !== 'false';
const OUTPUT_DIR = process.env.AUTOCONNECT_OUTPUT_DIR || 'output/autoconnect';

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  Origin: 'https://www.autoconnect.al',
  Referer: 'https://www.autoconnect.al/',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseImages(sidecarMedias) {
  if (!sidecarMedias) return [];

  try {
    const items = typeof sidecarMedias === 'string' ? JSON.parse(sidecarMedias) : sidecarMedias;
    return items
      .map((img) => {
        const full = img.imageStandardResolutionUrl;
        const thumb = img.imageThumbnailUrl;
        const url = full || thumb;
        if (!url) return null;
        return url.startsWith('http') ? url : `${MEDIA_BASE}${url}`;
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function parseContact(contact) {
  if (!contact) return {};

  try {
    return typeof contact === 'string' ? JSON.parse(contact) : contact;
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Step 1 – Search listings page by page
// ---------------------------------------------------------------------------

async function fetchSearchPage(page) {
  const filter = JSON.stringify({
    type: 'car',
    searchTerms: [],
    sortTerms: [{ key: 'renewedTime', order: 'DESC' }],
    page: String(page),
    maxResults: PAGE_SIZE,
  });

  const formData = new FormData();
  formData.append('filter', filter);

  const res = await fetch(`${API_BASE}/car-details/search`, {
    method: 'POST',
    headers: HEADERS,
    body: formData,
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for search page ${page}`);
  }

  const data = await res.json();
  if (!data.success) {
    throw new Error(data.message || 'Search failed');
  }

  return data.result || [];
}

// ---------------------------------------------------------------------------
// Step 2 – Fetch total count
// ---------------------------------------------------------------------------

async function fetchTotalCount() {
  const filter = JSON.stringify({ type: 'car', searchTerms: [] });

  const formData = new FormData();
  formData.append('filter', filter);

  const res = await fetch(`${API_BASE}/car-details/result-count`, {
    method: 'POST',
    headers: HEADERS,
    body: formData,
  });

  if (!res.ok) return null;

  const data = await res.json();
  return data.success ? data.result : null;
}

// ---------------------------------------------------------------------------
// Step 3 – Fetch detail for a single post
// ---------------------------------------------------------------------------

async function fetchPostDetail(id) {
  const res = await fetch(`${API_BASE}/car-details/post/${id}`, { headers: HEADERS });
  if (!res.ok) return null;

  const data = await res.json();
  if (!data.success || !Array.isArray(data.result) || data.result.length === 0) return null;

  return data.result[0];
}

// ---------------------------------------------------------------------------
// Step 4 – Normalize car data
// ---------------------------------------------------------------------------

function normalizeCar(listing, detail) {
  const src = detail || listing;
  const contact = parseContact(src.contact);
  const images = parseImages(src.sidecarMedias);

  return {
    id: src.id,
    brand: src.make || null,
    model: src.model || null,
    variant: src.variant || null,
    year: src.registration ? Number(src.registration) : null,
    price: src.price ? Number(src.price) : null,
    currency: 'EUR',
    km: src.mileage ? Number(src.mileage) : null,
    fuel: src.fuelType || null,
    transmission: src.transmission || null,
    engineSize: detail?.engineSize ? Number(detail.engineSize) : null,
    drivetrain: detail?.drivetrain || null,
    bodyType: detail?.bodyType || null,
    seats: detail?.seats ? Number(detail.seats) : null,
    doors: detail?.numberOfDoors ? Number(detail.numberOfDoors) : null,
    emissionGroup: detail?.emissionGroup || null,
    customsPaid: src.customsPaid === true || src.customsPaid === 1,
    canExchange: src.canExchange === true || src.canExchange === 1,
    sold: detail?.sold === 1 || false,
    description: detail?.caption?.slice(0, 1000) || null,
    location: contact.address || null,
    phone: contact.phone_number || null,
    promoted: src.promoted || false,
    highlighted: src.highlighted || false,
    url: `https://www.autoconnect.al/sq-al/automjete/makine-ne-shitje/${src.id}`,
    images,
    createdAt: detail?.dateCreated || null,
    updatedAt: detail?.dateUpdated || null,
    scrapedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  log.info('Starting AutoConnect scraper...');

  const totalCount = await fetchTotalCount();
  const totalPages = totalCount ? Math.ceil(totalCount / PAGE_SIZE) : null;
  log.info(`Total listings: ${totalCount || 'unknown'}, estimated pages: ${totalPages || 'unknown'}`);

  const allListings = [];

  for (let page = 0; page < MAX_PAGES; page++) {
    log.info(`Fetching search page ${page + 1}/${MAX_PAGES}...`);

    try {
      const items = await fetchSearchPage(page);
      allListings.push(...items);

      log.info(`  Page ${page + 1}: ${items.length} items (total: ${allListings.length})`);

      if (items.length < PAGE_SIZE) {
        log.info('  Last page reached.');
        break;
      }
    } catch (err) {
      log.warning(`  Failed page ${page + 1}: ${err.message}`);
      break;
    }

    await sleep(DELAY_MS);
  }

  log.info(`Collected ${allListings.length} listings from search.`);

  // Deduplicate by id
  const seen = new Set();
  const unique = allListings.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });

  // Optionally fetch details
  const results = [];

  if (FETCH_DETAILS) {
    log.info(`Fetching details for ${unique.length} listings...`);

    for (let i = 0; i < unique.length; i++) {
      const listing = unique[i];
      const label = `${listing.make || '?'} ${listing.model || '?'}`;

      try {
        log.info(`  [${i + 1}/${unique.length}] ${label}`);
        const detail = await fetchPostDetail(listing.id);
        results.push(normalizeCar(listing, detail));
      } catch (err) {
        log.warning(`  Failed detail ${listing.id}: ${err.message}`);
        results.push(normalizeCar(listing, null));
      }

      if (i < unique.length - 1) {
        await sleep(DETAIL_DELAY_MS);
      }
    }
  } else {
    for (const listing of unique) {
      results.push(normalizeCar(listing, null));
    }
  }

  log.info(`Total normalized: ${results.length}`);

  // Write output
  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  const ndjsonPath = path.join(OUTPUT_DIR, 'cars.ndjson');
  const ndjson = results.map((r) => JSON.stringify(r)).join('\n');
  await fs.writeFile(ndjsonPath, `${ndjson}\n`, 'utf8');

  const jsonPath = path.join(OUTPUT_DIR, 'cars.json');
  await fs.writeFile(jsonPath, JSON.stringify(results, null, 2), 'utf8');

  const summary = {
    totalAvailable: totalCount,
    pagesScraped: Math.min(MAX_PAGES, totalPages || MAX_PAGES),
    collected: allListings.length,
    unique: unique.length,
    withDetails: FETCH_DETAILS ? results.filter((r) => r.description).length : 0,
    outputDir: OUTPUT_DIR,
  };

  log.info(`Done: ${JSON.stringify(summary)}`);
}

main().catch((err) => {
  log.error(String(err));
  process.exit(1);
});
