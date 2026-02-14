import { resolveLauncher } from '../lib/launcher.js';

const API_BASE = 'https://instash-api.datafynow.ai/api/v1';
const SITE_URL = 'https://instash.datafynow.ai';

// All API endpoints require Cloudflare Turnstile verification.
// Strategy: use patchright (stealth browser) so Turnstile solves,
// then extract the token and attach it to our API calls.

const PRICE_RANGES = [
  [0, 999],
  [1000, 1499],
  [1500, 1999],
  [2000, 2999],
  [3000, 4999],
  [5000, 6999],
  [7000, 9999],
  [10000, 19999],
  [20000, 49999],
  [50000, 999999999],
];

/**
 * Wait for Turnstile to solve and return the token.
 * Polls window.turnstile.getResponse() until a token appears.
 */
async function waitForTurnstileToken(page, timeoutMs = 30000) {
  const token = await page.evaluate(async (timeout) => {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (typeof window.turnstile !== 'undefined' && window.turnstile.getResponse) {
        const t = window.turnstile.getResponse();
        if (t) return t;
      }
      const input = document.querySelector('[name="cf-turnstile-response"]');
      if (input?.value) return input.value;
      await new Promise((r) => setTimeout(r, 500));
    }
    return null;
  }, timeoutMs);

  return token;
}

/**
 * Reset Turnstile widget and wait for a fresh token.
 */
async function refreshTurnstileToken(page, timeoutMs = 15000) {
  await page.evaluate(() => {
    if (typeof window.turnstile !== 'undefined' && window.turnstile.reset) {
      window.turnstile.reset();
    }
  });
  // Wait a bit for the reset to take effect
  await page.waitForTimeout(1000);
  return waitForTurnstileToken(page, timeoutMs);
}

/**
 * Make an API call from within the browser with the Turnstile token.
 */
async function browserApiFetch(page, url, token) {
  return page.evaluate(async ({ url, token }) => {
    try {
      const headers = { 'Accept': 'application/json' };
      if (token) headers['X-Turnstile-Token'] = token;
      const res = await fetch(url, { headers });
      if (!res.ok) return { error: `HTTP ${res.status}`, data: null };
      const data = await res.json();
      return { error: null, data };
    } catch (e) {
      return { error: e.message, data: null };
    }
  }, { url, token });
}

export default {
  name: 'instash',
  displayName: 'Instash',

  env: {
    prefix: 'INSTASH',
    defaults: {
      maxPages: 1,
      delayMs: 500,
      detailDelayMs: 1000,
      fetchDetails: true,
      outputDir: 'output/instash',
    },
  },

  pagination: { type: 'custom' },

  async fetchAll(ctx) {
    const cfWaitMs = Number(process.env.INSTASH_CF_WAIT_MS || 15000);

    ctx.log.info('Launching stealth browser for Turnstile bypass...');
    const { launcher, mode } = await resolveLauncher(true);
    ctx.log.info(`Using browser: ${mode}`);

    if (mode === 'playwright-fallback') {
      ctx.log.warning('patchright not available — Turnstile bypass may fail. Install: npm i patchright');
    }

    const browser = await launcher.launch({ headless: false });
    const page = await browser.newPage();

    try {
      await page.goto(`${SITE_URL}/sq`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      ctx.log.info(`Waiting ${cfWaitMs / 1000}s for page + Turnstile to initialize...`);
      await page.waitForTimeout(cfWaitMs);

      // Simulate user interaction to trigger Turnstile (interaction-only mode)
      await page.mouse.move(300, 400);
      await page.mouse.move(500, 300);
      await page.evaluate(() => window.scrollBy(0, 300));
      await page.waitForTimeout(2000);

      // Try to get the Turnstile token
      ctx.log.info('Waiting for Turnstile token...');
      let token = await waitForTurnstileToken(page, 20000);
      ctx.log.info(`Turnstile token: ${token ? `${token.slice(0, 20)}... (${token.length} chars)` : 'NOT FOUND'}`);

      // If no token from widget API, try intercepting from network requests
      if (!token) {
        ctx.log.info('Token not found via widget API. Trying to intercept from network...');

        // Set up request interception to capture the token from the site's own requests
        const tokenPromise = new Promise((resolve) => {
          const handler = (request) => {
            const headers = request.headers();
            const t = headers['x-turnstile-token'];
            if (t) {
              page.off('request', handler);
              resolve(t);
            }
          };
          page.on('request', handler);
          // Timeout after 15s
          setTimeout(() => resolve(null), 15000);
        });

        // Trigger a navigation/search to make the site send an API request
        await page.evaluate(() => window.scrollBy(0, 500));
        // Click on a category or trigger the site to make an API call
        try {
          await page.click('a[href*="/sq/car"]', { timeout: 5000 });
        } catch {
          // Try alternative navigation triggers
          try {
            await page.click('[data-group="car"]', { timeout: 3000 });
          } catch {
            // Navigate directly to car listing page
            await page.goto(`${SITE_URL}/sq/car`, { waitUntil: 'domcontentloaded', timeout: 15000 });
          }
        }
        await page.waitForTimeout(3000);

        token = await tokenPromise;
        ctx.log.info(`Intercepted token: ${token ? `${token.slice(0, 20)}... (${token.length} chars)` : 'NOT FOUND'}`);
      }

      // If still no token, try to read it from the page's Axios defaults or store
      if (!token) {
        ctx.log.info('Trying to extract token from page JavaScript context...');
        token = await page.evaluate(() => {
          // Check Next.js/React state stores
          const root = document.getElementById('__next');
          if (root?._reactRootContainer) {
            // Can't easily traverse React fiber tree, skip
          }

          // Check if there's a global turnstile token variable
          if (window.__TURNSTILE_TOKEN) return window.__TURNSTILE_TOKEN;
          if (window.__cf_turnstile_token) return window.__cf_turnstile_token;

          // Check Axios defaults
          if (window.axios?.defaults?.headers?.common?.['X-Turnstile-Token']) {
            return window.axios.defaults.headers.common['X-Turnstile-Token'];
          }

          return null;
        });

        if (token) {
          ctx.log.info(`Found token in JS context: ${token.slice(0, 20)}...`);
        }
      }

      // Test the token with a simple API call
      const testUrl = `${API_BASE}/products?group=car&page=1&per_page=2`;
      const testResult = await browserApiFetch(page, testUrl, token);
      ctx.log.info(`API test: ${testResult.error || 'OK'} (token: ${token ? 'yes' : 'no'})`);

      // If test failed even with token, try making the call WITHOUT token
      // (the browser context itself might have the right cookies/session)
      if (testResult.error) {
        const testNoToken = await browserApiFetch(page, testUrl, null);
        ctx.log.info(`API test (no token header): ${testNoToken.error || 'OK'}`);
        if (!testNoToken.error) {
          token = null; // Browser session handles auth, no need for token header
          ctx.log.info('Browser session provides auth — no explicit token needed.');
        }
      }

      if (testResult.error && !testResult.data) {
        // Last resort: scrape from the rendered DOM
        ctx.log.warning('API calls failing. Will attempt DOM scraping as fallback.');
        const domItems = await scrapeFromDOM(page, ctx);
        if (domItems.length > 0) {
          ctx._browserPage = page;
          return domItems;
        }
        throw new Error('All approaches failed — could not fetch product data.');
      }

      // Fetch all car listings using API with token
      const allItems = [];

      for (const [min, max] of PRICE_RANGES) {
        const label = `€${min}-${max}`;
        ctx.log.info(`Fetching ${label}...`);

        const url = `${API_BASE}/products?group=car&page=1&per_page=100&sort=newest&price_min=${min}&price_max=${max}`;
        const result = await browserApiFetch(page, url, token);

        if (result.error) {
          ctx.log.warning(`  Failed ${label}: ${result.error}`);

          // Token might have expired — try refreshing it
          if (result.error.includes('403')) {
            ctx.log.info('  Token may have expired, attempting refresh...');
            const newToken = await refreshTurnstileToken(page, 15000);
            if (newToken) {
              token = newToken;
              ctx.log.info(`  New token obtained: ${token.slice(0, 20)}...`);
              // Retry this price range
              const retry = await browserApiFetch(page, url, token);
              if (!retry.error && retry.data?.success) {
                const items = retry.data.data?.items || [];
                allItems.push(...items);
                ctx.log.info(`  Retry ${label}: ${items.length} items`);
              }
            }
          }
        } else if (result.data?.success) {
          const items = result.data.data?.items || [];
          const total = result.data.data?.pagination?.total || 0;
          allItems.push(...items);
          ctx.log.info(`  ${label}: ${items.length} items (available: ${total}, collected: ${allItems.length})`);

          if (total > 100) {
            ctx.log.warning(`  Bucket ${label} has ${total} items but max 100 returned`);
          }
        }

        await page.waitForTimeout(ctx.env.delayMs);
      }

      // Fetch items without price
      ctx.log.info('Fetching items without price...');
      const noPriceUrl = `${API_BASE}/products?group=car&page=1&per_page=100&sort=newest&without_price=1`;
      const noPriceResult = await browserApiFetch(page, noPriceUrl, token);

      if (noPriceResult.error) {
        ctx.log.warning(`  Failed no-price: ${noPriceResult.error}`);
      } else if (noPriceResult.data?.success) {
        const items = noPriceResult.data.data?.items || [];
        allItems.push(...items);
        ctx.log.info(`  No-price: ${items.length} items (collected: ${allItems.length})`);
      }

      // Keep browser open for detail fetching
      if (ctx.env.fetchDetails) {
        ctx._browserPage = page;
        ctx._turnstileToken = token;
      }

      return allItems;
    } catch (err) {
      await browser.close();
      throw err;
    }
  },

  detail: {
    async fetch(item, ctx) {
      if (!ctx._browserPage) return null;

      const url = `${API_BASE}/products/${item.id}`;
      const result = await browserApiFetch(ctx._browserPage, url, ctx._turnstileToken);

      if (result.error) {
        // Try token refresh on 403
        if (result.error.includes('403')) {
          const newToken = await refreshTurnstileToken(ctx._browserPage, 15000);
          if (newToken) {
            ctx._turnstileToken = newToken;
            const retry = await browserApiFetch(ctx._browserPage, url, newToken);
            if (!retry.error && retry.data?.success) return retry.data.data;
          }
        }
        return null;
      }

      if (!result.data?.success || !result.data?.data) return null;
      return result.data.data;
    },
  },

  async cleanup(ctx) {
    if (ctx._browserPage) {
      try {
        const browser = ctx._browserPage.context().browser();
        await browser.close();
      } catch { /* already closed */ }
      ctx._browserPage = null;
    }
  },

  normalize(listing, detail) {
    const src = detail || listing;

    const attrs = {};
    if (detail?.attributes) {
      for (const attr of detail.attributes) {
        attrs[attr.slug] = attr.value;
      }
    }

    const categories = (detail?.categories || []).map((c) => c.name);

    const images = (detail?.images || []).map((img) => img.url);
    if (!images.length && src.thumbnail_url) {
      images.push(src.thumbnail_url);
    }

    const kmRaw = attrs.mileage || null;
    const km = kmRaw ? Number(kmRaw.replace(/[^\d]/g, '')) || null : null;

    return {
      id: src.id,
      name: src.name,
      type: src.type,
      brand: attrs.brand || null,
      model: attrs.model || null,
      year: attrs.year ? Number(attrs.year) : null,
      price: src.price ? Number(src.price) : null,
      discountPrice: src.discount_price && Number(src.discount_price) > 0 ? Number(src.discount_price) : null,
      currency: src.currency || null,
      km,
      mileageRaw: kmRaw,
      fuel: attrs.fuel_type || null,
      transmission: attrs.transmission || null,
      engine: attrs.engine || null,
      bodyType: attrs.body_type || null,
      color: attrs.color || null,
      interiorColor: attrs.interior_color || null,
      condition: attrs.condition || null,
      description: detail?.description || null,
      categories,
      sellerUsername: src.seller_username || null,
      instagramLink: detail?.instagram_link || null,
      thumbnail: src.thumbnail_url || null,
      images,
      publishedAt: src.published_at || null,
      isSponsored: src.is_sponsored || false,
      url: src.slug ? `https://instash.datafynow.ai/sq/product/${src.slug}` : null,
      location: null,
      scrapedAt: new Date().toISOString(),
    };
  },
};

/**
 * Fallback: scrape product data from the rendered DOM.
 */
async function scrapeFromDOM(page, ctx) {
  ctx.log.info('Attempting DOM scraping fallback...');

  await page.goto(`${SITE_URL}/sq/car`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(5000);

  const items = await page.evaluate(() => {
    const cards = document.querySelectorAll('[class*="product"], [class*="card"], [class*="listing"]');
    return [...cards].map((card) => {
      const link = card.querySelector('a[href]');
      const img = card.querySelector('img');
      const nameEl = card.querySelector('h2, h3, [class*="title"], [class*="name"]');
      const priceEl = card.querySelector('[class*="price"]');

      return {
        url: link?.getAttribute('href') || null,
        thumbnail_url: img?.getAttribute('src') || null,
        name: nameEl?.textContent?.trim() || null,
        priceText: priceEl?.textContent?.trim() || null,
      };
    });
  });

  ctx.log.info(`DOM scrape found ${items.length} items`);
  return items;
}
