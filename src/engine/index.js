import 'dotenv/config';

import { log } from 'crawlee';
import { fetchJson, fetchHtml, fetchCheerio, postFetch } from './fetchers.js';
import { writeOutput } from './output.js';
import { sleep, dedup, resolveEnv } from './utils.js';

export async function runScraper(config) {
  const env = resolveEnv(config.env);
  const ctx = { config, env, fetchJson, fetchHtml, fetchCheerio, postFetch, sleep, log };

  log.info(`Starting ${config.displayName} scraper...`);

  // Phase 1: Fetch listings
  let rawItems;

  if (config.pagination.type === 'page') {
    rawItems = await fetchPages(config, ctx);
  } else {
    rawItems = await config.fetchAll(ctx);
  }

  log.info(`Collected ${rawItems.length} raw listings.`);

  // Phase 2: Deduplicate
  const getId = config.getId || ((item) => item.id);
  const unique = dedup(rawItems, getId);

  if (unique.length !== rawItems.length) {
    log.info(`Unique after dedup: ${unique.length}`);
  }

  // Phase 3: Fetch details + normalize
  const results = [];

  if (env.fetchDetails && config.detail) {
    log.info(`Fetching details for ${unique.length} listings...`);

    for (let i = 0; i < unique.length; i++) {
      const item = unique[i];
      let detailData = null;

      try {
        log.info(`  [${i + 1}/${unique.length}] ${getId(item)}`);
        detailData = await config.detail.fetch(item, ctx);
      } catch (err) {
        log.warning(`  Failed detail ${getId(item)}: ${err.message}`);
      }

      results.push(config.normalize(item, detailData));

      if (i < unique.length - 1) {
        await sleep(env.detailDelayMs);
      }
    }
  } else {
    for (const item of unique) {
      results.push(config.normalize(item, null));
    }
  }

  // Phase 4: Cleanup (browser, connections, etc.)
  if (typeof config.cleanup === 'function') {
    try {
      await config.cleanup(ctx);
    } catch (err) {
      log.warning(`Cleanup failed: ${err.message}`);
    }
  }

  // Phase 5: Write output
  await writeOutput(env.outputDir, results);

  const summary = {
    site: config.name,
    collected: rawItems.length,
    unique: unique.length,
    scraped: results.length,
    outputDir: env.outputDir,
  };

  log.info(`Done: ${JSON.stringify(summary)}`);
  return summary;
}

async function fetchPages(config, ctx) {
  const { env } = ctx;
  const allItems = [];
  let totalPages = null;

  for (let page = 1; page <= env.maxPages; page++) {
    log.info(`Fetching page ${page}/${totalPages || env.maxPages}...`);

    try {
      const { items, totalPages: tp } = await config.fetchPage(page, ctx);

      if (page === 1 && tp != null) {
        totalPages = tp;
        log.info(`  Total pages available: ${totalPages}`);
      }

      allItems.push(...items);
      log.info(`  Page ${page}: ${items.length} items (total: ${allItems.length})`);

      if (items.length === 0) {
        log.info('  Last page reached.');
        break;
      }

      if (totalPages && page >= totalPages) {
        log.info('  Last page reached.');
        break;
      }
    } catch (err) {
      log.warning(`  Failed page ${page}: ${err.message}`);
      break;
    }

    await sleep(env.delayMs);
  }

  return allItems;
}
