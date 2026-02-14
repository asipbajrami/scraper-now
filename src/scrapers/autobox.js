import 'dotenv/config';

import fs from 'node:fs/promises';
import path from 'node:path';
import { log } from 'crawlee';
import * as cheerio from 'cheerio';

const BASE_URL = 'https://www.autobox.al';
const MAX_PAGES = Number(process.env.AUTOBOX_MAX_PAGES || 20);
const DELAY_MS = Number(process.env.AUTOBOX_DELAY_MS || 500);
const DETAIL_DELAY_MS = Number(process.env.AUTOBOX_DETAIL_DELAY_MS || 300);
const FETCH_DETAILS = process.env.AUTOBOX_FETCH_DETAILS !== 'false';
const OUTPUT_DIR = process.env.AUTOBOX_OUTPUT_DIR || 'output/autobox';

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'sq,en;q=0.9',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parsePrice(priceStr) {
  if (!priceStr) return { price: null, currency: null };
  const cleaned = priceStr.replace(/[^\d.,€$]/g, '').trim();
  const number = Number(cleaned.replace(/[€$]/g, '').replace(/,/g, ''));
  const currency = priceStr.includes('€') ? 'EUR' : priceStr.includes('$') ? 'USD' : null;
  return { price: isNaN(number) ? null : number, currency };
}

// Extract text from a detail field by its id
function fieldValue($, fieldId) {
  const el = $(`#df_field_${fieldId} .value`);
  if (!el.length) return null;
  const text = el.text().replace(/<!--.*?-->/g, '').trim();
  return text || null;
}

// Extract checkbox list items (comfort, safety, etc.)
function checkboxValues($, fieldId) {
  const items = [];
  $(`#df_field_${fieldId} .value li.active`).each((_, li) => {
    const text = $(li).attr('title');
    if (text) items.push(text);
  });
  return items.length ? items : null;
}

// ---------------------------------------------------------------------------
// Step 1 – Fetch listing pages
// ---------------------------------------------------------------------------

function listPageUrl(page) {
  if (page === 1) return `${BASE_URL}/makina.html`;
  return `${BASE_URL}/makina/index${page}.html`;
}

async function fetchListPage(page) {
  const url = listPageUrl(page);
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

function parseListPage(html) {
  const $ = cheerio.load(html);
  const listings = [];

  $('article.item').each((_, article) => {
    const $article = $(article);
    const compareEl = $article.find('.add_to_compare');

    const id = compareEl.attr('data-listing-id') || null;
    const url = compareEl.attr('data-listing-url') || $article.find('a[href*="/makina/"]').first().attr('href') || null;
    const title = compareEl.attr('data-listing-title') || $article.find('.title a').text().trim() || null;
    const image = compareEl.attr('data-listing-picture') || $article.find('.picture img').attr('src') || null;
    const priceRaw = $article.find('.price-tag span').text().trim() || null;

    // Extract field values from the grid
    const fields = {};
    $article.find('.fields .table-cell').each((_, cell) => {
      const name = $(cell).find('.name').text().trim();
      const value = $(cell).find('.value').text().trim();
      if (name && value) fields[name] = value;
    });

    // Photo count from the span accesskey
    const photoCount = $article.find('.picture span[accesskey]').attr('accesskey') || null;

    listings.push({
      id: id ? Number(id) : null,
      url,
      title,
      image,
      priceRaw,
      photoCount: photoCount ? Number(photoCount) : null,
      fields,
    });
  });

  // Check if there's a next page
  const totalPages = $('input[name="stats"]').val();
  const maxPage = totalPages ? Number(totalPages.split('|')[1]) : null;

  return { listings, maxPage };
}

// ---------------------------------------------------------------------------
// Step 2 – Fetch detail page
// ---------------------------------------------------------------------------

async function fetchDetail(url) {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) return null;
  const html = await res.text();
  return parseDetail(html, url);
}

function parseDetail(html, url) {
  const $ = cheerio.load(html);

  // Try JSON-LD first for structured data
  let jsonLd = null;
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const data = JSON.parse($(el).html());
      const product = Array.isArray(data) ? data.find((d) => d['@type'] === 'Product') : data['@type'] === 'Product' ? data : null;
      if (product) jsonLd = product;
    } catch { /* ignore */ }
  });

  // Parse detail fields from HTML
  const condition = fieldValue($, 'condition');
  const bodyType = fieldValue($, 'body_style');
  const year = fieldValue($, 'built');
  const customs = fieldValue($, 'customs');
  const transmission = fieldValue($, 'transmission');
  const engineCc = fieldValue($, 'engine_cm3');
  const mileage = fieldValue($, 'mileage');
  const drivetrain = fieldValue($, 'drive_train');
  const exteriorColor = fieldValue($, 'exterior_color');
  const interiorColor = fieldValue($, 'interior_color');
  const fuel = fieldValue($, 'fuel');
  const emissionClass = fieldValue($, 'emission_classs');
  const description = fieldValue($, 'description_add');

  // Location fields
  const country = fieldValue($, 'b_country');
  const city = fieldValue($, 'b_country_level2');
  const address = fieldValue($, 'b_address');

  // Seller info
  const sellerName = $('ul.seller-info .name a').first().text().trim() || null;
  const phone = $('a[href^="tel:"]').first().text().trim() || null;

  // Images from JSON-LD or gallery
  let images = [];
  if (jsonLd?.image) {
    images = Array.isArray(jsonLd.image) ? jsonLd.image : [jsonLd.image];
  } else {
    $('#imgSource a[href]').each((_, a) => {
      const href = $(a).attr('href');
      if (href) images.push(href);
    });
  }

  // Features (comfort, safety, etc.)
  const comfort = checkboxValues($, 'comfort');
  const safety = checkboxValues($, 'safety');

  // Price from JSON-LD
  const priceLd = jsonLd?.offers?.price ? Number(jsonLd.offers.price) : null;
  const currencyLd = jsonLd?.offers?.priceCurrency || null;

  return {
    condition,
    bodyType,
    year: year ? Number(year) : null,
    customs,
    transmission,
    engineCc,
    mileage,
    drivetrain,
    exteriorColor,
    interiorColor,
    fuel,
    emissionClass,
    description: description?.slice(0, 2000) || null,
    country,
    city,
    address,
    sellerName,
    phone,
    images,
    comfort,
    safety,
    priceLd,
    currencyLd,
  };
}

// ---------------------------------------------------------------------------
// Step 3 – Normalize
// ---------------------------------------------------------------------------

function normalizeCar(listing, detail) {
  const titleParts = listing.title ? listing.title.split(',').map((s) => s.trim()) : [];
  const brand = titleParts[0] || null;
  const model = titleParts[1] || null;

  const { price, currency } = detail
    ? { price: detail.priceLd, currency: detail.currencyLd }
    : parsePrice(listing.priceRaw);

  const km = detail?.mileage ? Number(detail.mileage.replace(/[^\d]/g, '')) || null : null;
  const engineCc = detail?.engineCc ? Number(detail.engineCc.replace(/[^\d]/g, '')) || null : null;

  return {
    id: listing.id,
    title: listing.title,
    brand,
    model,
    year: detail?.year || null,
    price,
    currency,
    fuel: detail?.fuel || listing.fields?.Karburanti || null,
    transmission: detail?.transmission || null,
    engineCc,
    km,
    drivetrain: detail?.drivetrain || null,
    bodyType: detail?.bodyType || null,
    condition: detail?.condition || null,
    customs: detail?.customs || null,
    exteriorColor: detail?.exteriorColor || null,
    interiorColor: detail?.interiorColor || null,
    emissionClass: detail?.emissionClass || null,
    description: detail?.description || null,
    location: detail?.city || listing.fields?.Qyteti || null,
    country: detail?.country || null,
    address: detail?.address || null,
    sellerName: detail?.sellerName || null,
    phone: detail?.phone || null,
    url: listing.url,
    images: detail?.images || (listing.image ? [listing.image] : []),
    photoCount: listing.photoCount,
    comfort: detail?.comfort || null,
    safety: detail?.safety || null,
    scrapedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  log.info('Starting AutoBox scraper...');

  // Step 1: Fetch listing pages
  const allListings = [];
  let maxPage = null;

  for (let page = 1; page <= MAX_PAGES; page++) {
    log.info(`Fetching listing page ${page}...`);

    try {
      const html = await fetchListPage(page);
      const { listings, maxPage: mp } = parseListPage(html);

      if (page === 1 && mp) {
        maxPage = mp;
        log.info(`Total pages: ${maxPage}`);
      }

      allListings.push(...listings);
      log.info(`  Page ${page}: ${listings.length} items (total: ${allListings.length})`);

      if (listings.length === 0 || (maxPage && page >= maxPage)) {
        log.info('  Last page reached.');
        break;
      }
    } catch (err) {
      log.warning(`  Failed page ${page}: ${err.message}`);
      break;
    }

    await sleep(DELAY_MS);
  }

  log.info(`Collected ${allListings.length} listings from pages.`);

  // Deduplicate
  const seen = new Set();
  const unique = allListings.filter((item) => {
    if (!item.id || seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });

  // Step 2: Fetch details
  const results = [];

  if (FETCH_DETAILS) {
    log.info(`Fetching details for ${unique.length} listings...`);

    for (let i = 0; i < unique.length; i++) {
      const listing = unique[i];

      try {
        log.info(`  [${i + 1}/${unique.length}] ${listing.title}`);
        const detail = listing.url ? await fetchDetail(listing.url) : null;
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
    totalPages: maxPage,
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
