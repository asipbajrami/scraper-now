import 'dotenv/config';

import { log } from 'crawlee';
import { runScraper } from './engine/index.js';
import { sites, siteNames } from './sites/index.js';

const args = process.argv.slice(2);
const requested = args.length > 0 ? args : siteNames;

// Validate site names
for (const name of requested) {
  if (!sites[name]) {
    log.error(`Unknown site: "${name}". Available: ${siteNames.join(', ')}`);
    process.exit(1);
  }
}

log.info(`Running ${requested.length} scraper(s): ${requested.join(', ')}`);

const results = [];

for (const name of requested) {
  try {
    const summary = await runScraper(sites[name]);
    results.push(summary);
  } catch (err) {
    log.error(`Failed ${name}: ${err.message}`);
    results.push({ site: name, error: err.message });
  }
}

log.info(`\nAll done. Results:\n${JSON.stringify(results, null, 2)}`);
