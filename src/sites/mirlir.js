import { resolveLauncher } from '../lib/launcher.js';

const BASE_URL = 'https://mirlir.com';
const DEFAULT_PATH = '/shpallje/k-vetura/';

const FUEL_KEYWORDS = ['naftë', 'benzinë', 'dizel', 'diesel', 'petrol', 'gaz', 'lpg', 'elektrike', 'hibrid', 'hybrid'];
const TRANSMISSION_KEYWORDS = ['manual', 'automatik', 'automatic', 'dsg', 'tiptronic'];
const CONDITION_KEYWORDS = ['e padëmtuar', 'e dëmtuar', 'e aksidentuar', 'e ardhur', 'pa dëmtime'];
const PLATE_KEYWORDS = ['targa', 'targa kosovare', 'targa shqiptare', 'targa maqedonase', 'pa targa'];

function parseFeatures(features) {
  const result = {
    brand: null, model: null, power: null, bodyType: null,
    doors: null, fuel: null, year: null, color: null,
    transmission: null, plate: null, condition: null,
  };

  for (const feat of features) {
    const lower = feat.toLowerCase();
    if (/^\d{4}$/.test(feat)) { result.year = Number(feat); continue; }
    if (lower.startsWith('ngjyra:')) { result.color = feat.replace(/^ngjyra:\s*/i, '').trim(); continue; }
    if (lower.startsWith('gjendja:')) { result.condition = feat.replace(/^gjendja:\s*/i, '').trim(); continue; }
    if (/\d+\s*(kf|hp|ps|ks)/i.test(feat)) { result.power = feat.trim(); continue; }
    if (/\d+\/?\d*\s*dyer/i.test(feat)) { result.doors = feat.trim(); continue; }
    if (FUEL_KEYWORDS.some((kw) => lower.includes(kw))) { result.fuel = feat.trim(); continue; }
    if (TRANSMISSION_KEYWORDS.some((kw) => lower.includes(kw))) { result.transmission = feat.trim(); continue; }
    if (PLATE_KEYWORDS.some((kw) => lower.includes(kw))) { result.plate = feat.trim(); continue; }
    if (CONDITION_KEYWORDS.some((kw) => lower.includes(kw))) { result.condition = feat.trim(); continue; }
    if (/veturë|suv|limuzinë|karavan|coupe|kabriolet|minivan|pick.?up|kombi/i.test(lower)) { result.bodyType = feat.trim(); continue; }
    if (!result.brand) { result.brand = feat.trim(); }
    else if (!result.model) { result.model = feat.trim(); }
  }

  return result;
}

function parsePrice(priceStr) {
  if (!priceStr) return { price: null, currency: null };
  const cleaned = priceStr.replace(/[^\d.,€$]/g, '').trim();
  const number = Number(cleaned.replace(/[€$,]/g, '').replace('.', ''));
  const currency = priceStr.includes('€') ? 'EUR' : priceStr.includes('$') ? 'USD' : null;
  return { price: isNaN(number) ? null : number, currency };
}

export default {
  name: 'mirlir',
  displayName: 'MirLir',

  env: {
    prefix: 'MIRLIR',
    defaults: {
      maxPages: 1,
      delayMs: 500,
      fetchDetails: false,
      outputDir: 'output/mirlir',
    },
  },

  pagination: { type: 'custom' },

  async fetchAll(ctx) {
    const urlPath = process.env.MIRLIR_URL || DEFAULT_PATH;
    const cfWaitMs = Number(process.env.MIRLIR_CF_WAIT_MS || 15000);

    ctx.log.info('Note: Site has strict Cloudflare WAF. Only first page (50 listings) per run.');

    const { launcher, mode } = await resolveLauncher(true);
    ctx.log.info(`Using browser: ${mode}`);

    const browser = await launcher.launch({ headless: false });
    const page = await browser.newPage();

    try {
      const fullUrl = `${BASE_URL}${urlPath}`;
      ctx.log.info(`Navigating to ${fullUrl}...`);

      await page.goto(fullUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(cfWaitMs);

      const title = await page.title();
      ctx.log.info(`Page title: ${title}`);

      if (title.includes('Attention Required') || title.includes('Just a moment')) {
        throw new Error('Cloudflare challenge not solved. Try increasing MIRLIR_CF_WAIT_MS.');
      }

      const totalCount = await page.evaluate(() => {
        const el = document.querySelector('.filters-header .count');
        return el ? el.textContent.trim() : null;
      });

      ctx.log.info(`Total available: ${totalCount || 'unknown'}`);

      const rawListings = await page.evaluate(() => {
        return [...document.querySelectorAll('.media.listing')].map((item) => {
          const link = item.querySelector('a.link');
          const img = item.querySelector('img.media-object');
          const titleEl = item.querySelector('.media-heading');
          const price = item.querySelector('.price strong');
          const features = [...item.querySelectorAll('.features li')].map((li) => li.textContent.trim());
          const location = item.querySelector('.location');
          const date = item.querySelector('.date');
          const phone = item.querySelector('.fa-phone');
          const adId = item.querySelector('.save-ad');
          const photoCount = item.querySelector('.photo-count');

          return {
            id: adId?.getAttribute('data-adid') || null,
            url: link?.getAttribute('href') || null,
            image: img?.getAttribute('src') || img?.getAttribute('data-src') || null,
            title: titleEl?.textContent?.trim() || null,
            priceRaw: price?.textContent?.trim() || null,
            features,
            location: location?.textContent?.trim() || null,
            date: date?.textContent?.trim() || null,
            phone: phone?.getAttribute('data-original-title') || null,
            photoCount: photoCount?.textContent?.trim() || null,
          };
        });
      });

      return rawListings;
    } finally {
      await browser.close();
    }
  },

  normalize(raw) {
    const parsed = parseFeatures(raw.features);
    const { price, currency } = parsePrice(raw.priceRaw);

    return {
      id: raw.id ? Number(raw.id) : null,
      title: raw.title,
      brand: parsed.brand,
      model: parsed.model,
      year: parsed.year,
      price,
      currency,
      fuel: parsed.fuel,
      transmission: parsed.transmission,
      power: parsed.power,
      bodyType: parsed.bodyType,
      doors: parsed.doors,
      color: parsed.color,
      condition: parsed.condition,
      plate: parsed.plate,
      location: raw.location,
      phone: raw.phone,
      date: raw.date,
      url: raw.url ? `${BASE_URL}${raw.url}` : null,
      image: raw.image,
      photoCount: raw.photoCount ? parseInt(raw.photoCount) || null : null,
      featuresRaw: raw.features,
      scrapedAt: new Date().toISOString(),
    };
  },
};
