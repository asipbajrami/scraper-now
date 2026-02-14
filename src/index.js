import 'dotenv/config';

import fs from 'node:fs/promises';
import path from 'node:path';

import { BasicCrawler, PlaywrightCrawler, log } from 'crawlee';
import { Impit } from 'impit';

import { getDomainProfile } from './config/domainProfiles.js';
import {
  chooseHttpProxyUrl,
  getProxyConfiguration,
} from './config/proxies.js';
import { extractFromHtml, likelyNeedsBrowser } from './lib/extract.js';
import { resolveLauncher } from './lib/launcher.js';
import { loadUrls } from './lib/urls.js';

const HTTP_CONCURRENCY = Number(process.env.HTTP_CONCURRENCY || 30);
const BROWSER_CONCURRENCY = Number(process.env.BROWSER_CONCURRENCY || 5);
const STEALTH_CONCURRENCY = Number(process.env.STEALTH_CONCURRENCY || 2);
const HTTP_TIMEOUT_MS = Number(process.env.HTTP_TIMEOUT_MS || 30_000);

function getArg(flag, fallbackValue) {
  const idx = process.argv.indexOf(flag);
  if (idx === -1 || idx + 1 >= process.argv.length) return fallbackValue;
  return process.argv[idx + 1];
}

function isValidUrl(value) {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function partitionByTier(urls) {
  const buckets = {
    http: new Set(),
    browser: new Set(),
    stealth: new Set(),
  };

  for (const url of urls) {
    const profile = getDomainProfile(url);
    const tier = profile.tier === 'stealth' ? 'stealth' : profile.tier === 'browser' ? 'browser' : 'http';
    buckets[tier].add(url);
  }

  return buckets;
}

function groupByProxyTier(urls, defaultTier = 'datacenter') {
  const groups = {
    datacenter: [],
    residential: [],
  };

  for (const url of urls) {
    const profile = getDomainProfile(url);
    const proxyTier = profile.proxyTier || defaultTier;
    if (proxyTier === 'residential') {
      groups.residential.push(url);
    } else {
      groups.datacenter.push(url);
    }
  }

  return groups;
}

function upsertResult(results, next) {
  results.set(next.url, {
    extractedAt: new Date().toISOString(),
    ...next,
  });
}

async function runHttpTier(httpUrls, browserQueue, results) {
  if (!httpUrls.length) return;

  const proxyCursor = {
    datacenterIndex: 0,
    residentialIndex: 0,
  };
  const impitClients = new Map();

  function getImpitClient(proxyUrl) {
    const key = proxyUrl || '__none__';
    if (!impitClients.has(key)) {
      impitClients.set(
        key,
        new Impit({
          browser: 'chrome',
          ignoreTlsErrors: false,
          ...(proxyUrl ? { proxyUrl } : {}),
        }),
      );
    }
    return impitClients.get(key);
  }

  const crawler = new BasicCrawler({
    maxConcurrency: HTTP_CONCURRENCY,
    maxRequestRetries: 1,
    requestHandlerTimeoutSecs: Math.ceil(HTTP_TIMEOUT_MS / 1000),
    async requestHandler({ request }) {
      const profile = getDomainProfile(request.url);
      const proxyUrl = chooseHttpProxyUrl(profile.proxyTier, proxyCursor);
      const client = getImpitClient(proxyUrl);

      const response = await client.fetch(request.url, {
        redirect: 'follow',
      });

      const html = await response.text();
      const status = response.status;

      if (status === 403 || status === 429 || status >= 500) {
        throw new Error(`HTTP status ${status}`);
      }

      const extracted = extractFromHtml(request.url, html);
      if (likelyNeedsBrowser(html, extracted) && profile.browserFallback) {
        browserQueue.add(request.url);
        return;
      }

      upsertResult(results, {
        url: request.url,
        tier: 'http',
        proxyTier: profile.proxyTier,
        status,
        ...extracted,
      });
    },
    async failedRequestHandler({ request, error }) {
      const profile = getDomainProfile(request.url);
      if (profile.browserFallback) {
        browserQueue.add(request.url);
        return;
      }

      upsertResult(results, {
        url: request.url,
        tier: 'http',
        proxyTier: profile.proxyTier,
        error: String(error),
      });
    },
  });

  await crawler.run(httpUrls.map((url) => ({ url })));
}

async function runBrowserTier({
  urls,
  stealthMode,
  results,
  stealthQueue,
  forceResidential = false,
}) {
  if (!urls.length) return;

  const { launcher, mode } = await resolveLauncher(stealthMode);
  const groups = forceResidential
    ? { datacenter: [], residential: urls }
    : groupByProxyTier(urls);

  if (stealthMode && mode === 'playwright-fallback') {
    log.warning('Patchright is not installed; stealth tier is using vanilla Playwright fallback.');
  }

  for (const [proxyTier, batch] of Object.entries(groups)) {
    if (!batch.length) continue;

    const crawler = new PlaywrightCrawler({
      launchContext: {
        launcher,
        launchOptions: {
          headless: true,
        },
      },
      proxyConfiguration: getProxyConfiguration(proxyTier),
      maxConcurrency: stealthMode ? STEALTH_CONCURRENCY : BROWSER_CONCURRENCY,
      maxRequestRetries: stealthMode ? 1 : 1,
      async requestHandler({ request, page }) {
        const html = await page.content();
        const extracted = extractFromHtml(request.url, html);

        upsertResult(results, {
          url: request.url,
          tier: stealthMode ? 'stealth' : 'browser',
          proxyTier,
          status: 200,
          ...extracted,
        });
      },
      async failedRequestHandler({ request, error }) {
        const profile = getDomainProfile(request.url);
        if (!stealthMode && profile.stealthFallback) {
          stealthQueue.add(request.url);
          return;
        }

        upsertResult(results, {
          url: request.url,
          tier: stealthMode ? 'stealth' : 'browser',
          proxyTier,
          error: String(error),
        });
      },
    });

    await crawler.run(batch.map((url) => ({ url })));
  }
}

async function writeResults(outputPath, results) {
  const rows = [...results.values()];
  rows.sort((a, b) => a.url.localeCompare(b.url));

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const ndjson = rows.map((row) => JSON.stringify(row)).join('\n');
  await fs.writeFile(outputPath, `${ndjson}${rows.length ? '\n' : ''}`, 'utf8');
}

async function main() {
  const inputPath = getArg('--input', process.env.SEED_URL_FILE || 'inputs/urls.txt');
  const outputPath = getArg('--output', process.env.OUTPUT_FILE || 'output/results.ndjson');

  const rawUrls = await loadUrls(inputPath);
  const urls = rawUrls.filter(isValidUrl);

  if (!urls.length) {
    throw new Error(`No valid URLs found in ${inputPath}`);
  }

  const initial = partitionByTier(urls);
  const browserQueue = new Set(initial.browser);
  const stealthQueue = new Set(initial.stealth);
  const results = new Map();

  log.info(`Loaded ${urls.length} URL(s): HTTP=${initial.http.size}, BROWSER=${initial.browser.size}, STEALTH=${initial.stealth.size}`);

  await runHttpTier([...initial.http], browserQueue, results);
  await runBrowserTier({
    urls: [...browserQueue],
    stealthMode: false,
    results,
    stealthQueue,
  });
  await runBrowserTier({
    urls: [...stealthQueue],
    stealthMode: true,
    results,
    stealthQueue: new Set(),
    forceResidential: true,
  });

  await writeResults(outputPath, results);

  const summary = {
    total: urls.length,
    completed: results.size,
    missing: urls.length - results.size,
    outputPath,
  };

  log.info(`Done: ${JSON.stringify(summary)}`);
}

main().catch((error) => {
  log.error(String(error));
  process.exit(1);
});
