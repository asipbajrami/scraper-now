import 'dotenv/config';

import fs from 'node:fs/promises';
import path from 'node:path';
import * as cheerio from 'cheerio';
import { log } from 'crawlee';

const BASE_URL = 'https://www.njoftime.com';
const FORUM_PATH = '/forums/makina-autovetura.28/';
const MAX_PAGES = Number(process.env.NJOFTIME_MAX_PAGES || 3);
const DELAY_MS = Number(process.env.NJOFTIME_DELAY_MS || 800);
const DETAIL_DELAY_MS = Number(process.env.NJOFTIME_DETAIL_DELAY_MS || 500);
const OUTPUT_DIR = process.env.NJOFTIME_OUTPUT_DIR || 'output/njoftime';
const FETCH_DETAILS = process.env.NJOFTIME_FETCH_DETAILS !== 'false';

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  Accept: 'text/html',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchHtml(url) {
  const res = await fetch(url, { headers: HEADERS, redirect: 'follow' });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
  return res.text();
}

// ---------------------------------------------------------------------------
// Step 1 – Parse forum listing pages (XenForo structItem threads)
// ---------------------------------------------------------------------------

function parseListingPage(html) {
  const $ = cheerio.load(html);
  const threads = [];

  $('[class*="js-threadListItem"]').each((_, el) => {
    const $item = $(el);
    const threadId = ($item.attr('class') || '').match(/js-threadListItem-(\d+)/)?.[1];
    if (!threadId) return;

    const author = $item.attr('data-author') || null;

    // Title and URL
    const $titleLink = $item.find('.structItem-title a').last();
    const title = $titleLink.text().trim();
    const threadUrl = $titleLink.attr('href') || '';

    // Custom fields
    const cleanField = (sel) => ($item.find(sel).text() || '').replace(/\s+/g, ' ').trim() || null;
    const location = cleanField('[data-field="field-location"] dd');
    const zona = cleanField('[data-field="field_9_zona"] dd');
    const carType = cleanField('[data-field="field_1_makina"] dd');
    const brand = cleanField('[data-field="field_9_markatcar"] dd');
    const year = cleanField('[data-field="field_5_viti"] dd');
    const priceStr = ($item.find('[data-field="field_4_cmimi"] dd').text() || '').replace(/\s+/g, ' ').trim() || null;

    // Thumbnail images
    const images = [];
    $item.find('.swiper-slide img').each((_, img) => {
      const src = $(img).attr('src');
      if (src && !images.includes(src)) {
        images.push(src.startsWith('http') ? src : `${BASE_URL}${src}`);
      }
    });

    // Date
    const dateText = $item.find('.structItem-cell--latest time').attr('datetime') ||
                     $item.find('.structItem-cell--latest time').text().trim() || null;

    threads.push({
      id: Number(threadId),
      title,
      url: threadUrl.startsWith('http') ? threadUrl : `${BASE_URL}${threadUrl}`,
      author,
      location,
      zona,
      carType,
      brand,
      year: year ? Number(year) : null,
      price: priceStr ? Number(priceStr.replace(/[^\d.]/g, '')) || null : null,
      priceRaw: priceStr,
      date: dateText,
      thumbnailImages: images,
    });
  });

  // Get total pages
  let totalPages = 1;
  $('a[href*="page-"]').each((_, el) => {
    const match = ($(el).attr('href') || '').match(/page-(\d+)/);
    if (match) {
      const num = Number(match[1]);
      if (num > totalPages) totalPages = num;
    }
  });

  return { threads, totalPages };
}

// ---------------------------------------------------------------------------
// Step 2 – Parse thread detail page for description and full images
// ---------------------------------------------------------------------------

function parseDetailPage(html) {
  const $ = cheerio.load(html);

  // Custom fields (same as listing but sometimes more complete)
  const fields = {};
  $('[data-field]').each((_, el) => {
    const fieldName = $(el).attr('data-field');
    const label = $(el).find('dt').text().trim();
    const value = $(el).find('dd').text().trim();
    if (fieldName && value) {
      fields[fieldName] = { label, value };
    }
  });

  // Post body (first post)
  const description = $('.message-body .bbWrapper').first().text().trim().slice(0, 1000) || null;

  // Full-size images from the post
  const images = [];
  $('.message-body img[src*="attachments"]').each((_, img) => {
    const src = $(img).attr('src');
    if (src && !images.includes(src)) {
      images.push(src.startsWith('http') ? src : `${BASE_URL}${src}`);
    }
  });

  return {
    description,
    fullImages: images,
    detailFields: fields,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  log.info(`Starting Njoftime scraper (max ${MAX_PAGES} pages, details=${FETCH_DETAILS})...`);

  const allThreads = [];
  let totalPages = 1;

  for (let page = 1; page <= MAX_PAGES; page++) {
    const pageUrl = page === 1
      ? `${BASE_URL}${FORUM_PATH}`
      : `${BASE_URL}${FORUM_PATH}page-${page}`;

    log.info(`Fetching listing page ${page}/${MAX_PAGES}: ${pageUrl}`);

    try {
      const html = await fetchHtml(pageUrl);
      const result = parseListingPage(html);

      if (page === 1) {
        totalPages = result.totalPages;
        log.info(`  Total pages available: ${totalPages}`);
      }

      allThreads.push(...result.threads);
      log.info(`  Found ${result.threads.length} threads (total: ${allThreads.length})`);

      if (result.threads.length === 0) {
        log.info('  No threads found, stopping.');
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

  log.info(`Collected ${allThreads.length} threads from listing pages.`);

  // Step 2: Fetch detail pages
  if (FETCH_DETAILS && allThreads.length > 0) {
    log.info(`Fetching details for ${allThreads.length} threads...`);

    for (let i = 0; i < allThreads.length; i++) {
      const thread = allThreads[i];

      try {
        log.info(`  [${i + 1}/${allThreads.length}] ${thread.title.slice(0, 60)}...`);
        const html = await fetchHtml(thread.url);
        const details = parseDetailPage(html);

        Object.assign(thread, details);
      } catch (err) {
        log.warning(`  Failed detail ${thread.id}: ${err.message}`);
      }

      if (i < allThreads.length - 1) {
        await sleep(DETAIL_DELAY_MS);
      }
    }
  }

  // Add timestamp
  for (const thread of allThreads) {
    thread.scrapedAt = new Date().toISOString();
  }

  // Write output
  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  const ndjsonPath = path.join(OUTPUT_DIR, 'cars.ndjson');
  const ndjson = allThreads.map((r) => JSON.stringify(r)).join('\n');
  await fs.writeFile(ndjsonPath, `${ndjson}\n`, 'utf8');

  const jsonPath = path.join(OUTPUT_DIR, 'cars.json');
  await fs.writeFile(jsonPath, JSON.stringify(allThreads, null, 2), 'utf8');

  const summary = {
    totalPagesAvailable: totalPages,
    pagesScraped: Math.min(MAX_PAGES, totalPages),
    listings: allThreads.length,
    withDetails: FETCH_DETAILS ? allThreads.filter((t) => t.description).length : 0,
    outputDir: OUTPUT_DIR,
  };

  log.info(`Done: ${JSON.stringify(summary)}`);
}

main().catch((err) => {
  log.error(String(err));
  process.exit(1);
});
