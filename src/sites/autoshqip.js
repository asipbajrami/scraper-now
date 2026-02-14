const BASE_URL = 'https://autoshqip.com';
const LISTING_PAGE = `${BASE_URL}/makina-ne-shitje`;

function getImageUrls(car) {
  if (!car.postShortcode || !car.numberOfPictures) return [];
  const shortcode = car.postShortcode.startsWith('/') ? car.postShortcode : `/${car.postShortcode}`;
  return Array.from({ length: car.numberOfPictures }, (_, i) =>
    `https://cdn.autoshqip.com/${shortcode}/${i + 1}.jpeg`,
  );
}

export default {
  name: 'autoshqip',
  displayName: 'AutoShqip',

  env: {
    prefix: 'AUTOSHQIP',
    defaults: {
      maxPages: 1,
      delayMs: 500,
      detailDelayMs: 500,
      fetchDetails: true,
      outputDir: 'output/autoshqip',
    },
  },

  headers: {
    Accept: 'application/json, text/plain, */*',
    Referer: BASE_URL,
  },

  pagination: { type: 'custom' },

  async fetchAll(ctx) {
    ctx.log.info('Fetching listing page to extract buildId...');
    const html = await ctx.fetchHtml(LISTING_PAGE, { Accept: 'text/html', Referer: BASE_URL });

    const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (!match) throw new Error('Could not find __NEXT_DATA__ on the listing page');

    const nextData = JSON.parse(match[1]);
    ctx._buildId = nextData.buildId;

    const { initialCars = [], initialIgCars = [] } = nextData.props?.pageProps || {};
    ctx.log.info(`buildId: ${ctx._buildId} | site: ${initialCars.length} | IG: ${initialIgCars.length}`);

    return [...initialCars, ...initialIgCars];
  },

  detail: {
    async fetch(item, ctx) {
      const url = `${BASE_URL}/_next/data/${ctx._buildId}/car-details/${item.id}.json`;
      const data = await ctx.fetchJson(url, {
        Accept: 'application/json, text/plain, */*',
        Referer: BASE_URL,
      });
      return data.pageProps?.initialCarDetails || null;
    },
  },

  normalize(listing, detail) {
    const raw = detail || listing;
    if (!raw) return null;

    const normalized = {
      id: raw.id,
      brand: raw.brand,
      model: raw.model,
      generation: raw.generation || null,
      trim: raw.trim || null,
      year: raw.year,
      km: raw.km,
      price: raw.price ? Number(raw.price) : null,
      currency: raw.priceCurrency || '€',
      fuelTypeId: raw.fuelTypeId,
      transmission: raw.transmission,
      engineCc: raw.e ? Number(raw.e) : null,
      engineType: raw.d || null,
      hp: raw.k ? Number(raw.k) : null,
      torqueNm: raw.l ? Number(raw.l) : null,
      zeroToHundred: raw.m ? Number(raw.m) : null,
      fuelConsumptionMixed: raw.a ? Number(raw.a) : null,
      fuelConsumptionHighway: raw.b ? Number(raw.b) : null,
      fuelConsumptionCity: raw.c ? Number(raw.c) : null,
      emissionStandard: raw.j || null,
      color: raw.n || null,
      location: raw.location || raw.o || null,
      importTaxPaid: raw.importTaxPaid ?? raw.p ?? null,
      hasDocumentsPaid: raw.hasDocumentsPaid ?? raw.q ?? null,
      exchangeAllowed: raw.exchangeAllowed ?? raw.r ?? null,
      isSold: raw.isSold || false,
      postedTime: raw.postedTime,
      postShortcode: raw.postShortcode,
      numberOfPictures: raw.numberOfPictures || 0,
      views: raw.s ?? raw.views ?? 0,
      sourceId: raw.sourceId,
      scrapedAt: new Date().toISOString(),
    };

    normalized.imageUrls = getImageUrls(normalized);
    return normalized;
  },
};
