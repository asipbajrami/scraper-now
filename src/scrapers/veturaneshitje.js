import 'dotenv/config';

import fs from 'node:fs/promises';
import path from 'node:path';
import { log } from 'crawlee';
import * as cheerio from 'cheerio';

const BASE_URL = 'https://www.veturaneshitje.com';
const MAX_PAGES = Number(process.env.VETURA_MAX_PAGES || 10);
const DELAY_MS = Number(process.env.VETURA_DELAY_MS || 500);
const DETAIL_DELAY_MS = Number(process.env.VETURA_DETAIL_DELAY_MS || 300);
const FETCH_DETAILS = process.env.VETURA_FETCH_DETAILS !== 'false';
const OUTPUT_DIR = process.env.VETURA_OUTPUT_DIR || 'output/veturaneshitje';

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
  if (!priceStr) return { price: null, currency: null, negotiable: false };
  const text = priceStr.trim();
  if (/marr[eë]veshje/i.test(text) || text === '*Çmimi me marrëveshje') {
    return { price: null, currency: null, negotiable: true };
  }
  const number = Number(text.replace(/[^\d]/g, ''));
  const currency = text.includes('EUR') ? 'EUR' : text.includes('$') ? 'USD' : null;
  const negotiable = /negociuesh/i.test(priceStr);
  return { price: isNaN(number) || number === 0 ? null : number, currency, negotiable };
}

function extractId(href) {
  const match = href?.match(/\/vetura\/(\d+)\//);
  return match ? Number(match[1]) : null;
}

// ---------------------------------------------------------------------------
// Step 1 – Fetch listing pages
// ---------------------------------------------------------------------------

async function fetchListPage(page) {
  const url = page === 1 ? `${BASE_URL}/vetura` : `${BASE_URL}/vetura?page=${page}`;
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

function parseListPage(html) {
  const $ = cheerio.load(html);
  const listings = [];
  const seen = new Set();

  // All listing items are li.row inside ul.car-list
  $('ul.car-list > li.row').each((_, li) => {
    const $li = $(li);

    // Find the listing link (contains /vetura/{id}/)
    const linkEl = $li.find('a[href*="/vetura/"]').first();
    const href = linkEl.attr('href');
    if (!href || !href.match(/\/vetura\/\d+\//)) return;

    const id = extractId(href);
    if (!id || seen.has(id)) return;
    seen.add(id);

    // Image
    const img = $li.find('img.img-responsive').first().attr('src') || null;

    // Brand and model from heading
    const heading = $li.find('h2.lead');
    const brand = heading.find('strong').text().trim() || null;
    // Model is the text node after <strong> in the h2
    const headingText = heading.text().replace('Vetura në shitje', '').trim();
    const model = brand ? headingText.replace(brand, '').trim() || null : null;

    // Price
    const priceEl = $li.find('.text-orange.price');
    const oldPriceEl = priceEl.find('span[style*="line-through"]');
    const oldPrice = oldPriceEl.length ? oldPriceEl.text().trim() : null;
    // Remove old price text to get current price
    const priceClone = priceEl.clone();
    priceClone.find('span[style*="line-through"]').remove();
    const priceText = priceClone.find('strong').text().trim() || priceClone.text().trim();
    const { price, currency, negotiable } = parsePrice(priceText);

    // Tech details (fuel, transmission, year, engine)
    const techDetails = [];
    $li.find('.car-tech-detail').each((_, td) => {
      techDetails.push($(td).text().trim());
    });

    const fuel = techDetails[0] || null;
    const transmission = techDetails[1] || null;
    const year = techDetails[2] ? Number(techDetails[2]) || null : null;
    const engineCcRaw = techDetails[3] || null;
    const engineCc = engineCcRaw ? Number(engineCcRaw.replace(/[^\d]/g, '')) || null : null;

    // Customs and registration (from glyphicon items)
    const customs = techDetails[4] || null;
    const registration = techDetails[5] || null;

    // Location and date
    const location = $li.find('.glyphicon-map-marker').parent().text().trim() || null;
    const date = $li.find('.glyphicon-time').parent().text().trim() || null;

    // Promoted/recommended flags
    const isSponsored = $li.hasClass('bg-warning');
    const isRecommended = $li.hasClass('recommended');

    listings.push({
      id,
      url: `${BASE_URL}${href}`,
      image: img ? (img.startsWith('http') ? img : `${BASE_URL}${img}`) : null,
      brand,
      model,
      price,
      currency,
      negotiable,
      oldPrice: oldPrice ? parsePrice(oldPrice).price : null,
      fuel,
      transmission,
      year,
      engineCc,
      customs,
      registration,
      location,
      date,
      isSponsored,
      isRecommended,
    });
  });

  // Total pages
  const lastPageLink = $('li.PagedList-skipToLast a').attr('href');
  const totalPages = lastPageLink ? Number(lastPageLink.match(/page=(\d+)/)?.[1]) : null;

  return { listings, totalPages };
}

// ---------------------------------------------------------------------------
// Step 2 – Fetch detail page
// ---------------------------------------------------------------------------

async function fetchDetail(url) {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) return null;
  const html = await res.text();
  return parseDetail(html);
}

function parseDetail(html) {
  const $ = cheerio.load(html);

  // Specs table
  const specs = {};
  const specLabels = [];
  const specValues = [];
  $('table.table-car-specifications tr').each((_, tr) => {
    const tds = $(tr).find('td');
    if (tds.length === 0) return;
    // Rows alternate between label rows (with <span>) and value rows (with .strong)
    const hasLabels = tds.first().find('span').length > 0 || tds.first().find('i.glyphicon').length > 0;
    const hasValues = tds.first().hasClass('strong');

    if (hasLabels) {
      tds.each((_, td) => {
        specLabels.push($(td).find('span').text().trim() || $(td).text().trim());
      });
    } else if (hasValues) {
      tds.each((i, td) => {
        const label = specLabels[specLabels.length - tds.length + i] || `field_${i}`;
        specValues.push({ label, value: $(td).text().trim() });
      });
    }
  });

  for (const { label, value } of specValues) {
    const key = label.toLowerCase();
    if (key.includes('dogana')) specs.customs = value;
    else if (key.includes('regjistrim')) specs.registration = value;
    else if (key.includes('lloji') || key.includes('kategori')) specs.bodyType = value;
    else if (key.includes('viti')) specs.year = value;
    else if (key.includes('karburant')) specs.fuel = value;
    else if (key.includes('marsh')) specs.transmission = value;
    else if (key.includes('ngjyr')) specs.color = value;
    else if (key.includes('ulese') || key.includes('seat')) specs.seats = value;
    else if (key.includes('kubikaz') || key.includes('motor')) specs.engineCc = value;
    else if (key.includes('kilometraz') || key.includes('mileage')) specs.mileage = value;
  }

  // Price from detail page
  const priceEl = $('h3.text-orange.price');
  const priceClone = priceEl.clone();
  priceClone.find('small').remove();
  const priceText = priceClone.find('strong').text().trim() || priceClone.text().trim();
  const detailPrice = parsePrice(priceText);

  // Description
  const description = $('p.description').text().trim() || null;

  // Title
  const title = $('h2.no-margin').first().text().trim() || null;

  // Images
  const images = [];
  $('img.main-photo').each((_, img) => {
    const src = $(img).attr('src');
    if (src) images.push(src.startsWith('http') ? src : `${BASE_URL}${src}`);
  });

  // Phone
  const phone = $('a[href^="tel:"]').first().text().trim() || null;

  // Seller
  const sellerName = $('.seller-card h4 strong').text().trim() || null;
  const sellerType = $('.seller-card .glyphicon-tags').parent().text().trim() || null;

  // Safety/comfort features — section after description
  const features = [];
  $('div.br-2x ul.list-unstyled.row li p').each((_, p) => {
    const text = $(p).text().trim();
    if (text && text.length < 50) features.push(text);
  });

  return {
    title,
    price: detailPrice.price,
    currency: detailPrice.currency,
    negotiable: detailPrice.negotiable,
    description: description?.slice(0, 2000) || null,
    images,
    phone,
    sellerName,
    sellerType,
    features: features.length ? features : null,
    ...specs,
  };
}

// ---------------------------------------------------------------------------
// Step 3 – Normalize
// ---------------------------------------------------------------------------

function normalizeCar(listing, detail) {
  const km = detail?.mileage ? Number(detail.mileage.replace(/[^\d]/g, '')) || null : null;
  const seats = detail?.seats ? Number(detail.seats) || null : null;
  const price = listing.price ?? detail?.price ?? null;
  const currency = listing.currency ?? detail?.currency ?? null;
  const negotiable = listing.negotiable || detail?.negotiable || false;

  return {
    id: listing.id,
    title: detail?.title || `${listing.brand || ''} ${listing.model || ''}`.trim() || null,
    brand: listing.brand,
    model: listing.model,
    year: listing.year || (detail?.year ? Number(detail.year) : null),
    price,
    currency,
    negotiable,
    oldPrice: listing.oldPrice,
    fuel: detail?.fuel || listing.fuel,
    transmission: detail?.transmission || listing.transmission,
    engineCc: listing.engineCc,
    km,
    bodyType: detail?.bodyType || null,
    color: detail?.color || null,
    seats,
    customs: detail?.customs || listing.customs,
    registration: detail?.registration || listing.registration,
    description: detail?.description || null,
    location: listing.location,
    sellerName: detail?.sellerName || null,
    sellerType: detail?.sellerType || null,
    phone: detail?.phone || null,
    url: listing.url,
    images: detail?.images?.length ? detail.images : (listing.image ? [listing.image] : []),
    features: detail?.features || null,
    isSponsored: listing.isSponsored,
    isRecommended: listing.isRecommended,
    date: listing.date,
    scrapedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  log.info('Starting VeturaNëShitje scraper...');

  // Step 1: Fetch listing pages
  const allListings = [];
  let totalPages = null;

  for (let page = 1; page <= MAX_PAGES; page++) {
    log.info(`Fetching listing page ${page}...`);

    try {
      const html = await fetchListPage(page);
      const { listings, totalPages: tp } = parseListPage(html);

      if (page === 1 && tp) {
        totalPages = tp;
        log.info(`Total pages available: ${totalPages}`);
      }

      allListings.push(...listings);
      log.info(`  Page ${page}: ${listings.length} items (total: ${allListings.length})`);

      if (listings.length === 0 || (totalPages && page >= totalPages)) {
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
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });

  log.info(`Unique: ${unique.length}`);

  // Step 2: Fetch details
  const results = [];

  if (FETCH_DETAILS) {
    log.info(`Fetching details for ${unique.length} listings...`);

    for (let i = 0; i < unique.length; i++) {
      const listing = unique[i];
      const label = `${listing.brand || '?'} ${listing.model || '?'}`;

      try {
        log.info(`  [${i + 1}/${unique.length}] ${label}`);
        const detail = await fetchDetail(listing.url);
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
    totalPagesAvailable: totalPages,
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
