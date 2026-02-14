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

    const brand = raw.brand || null;
    const model = raw.model || null;
    const engineParts = [raw.e ? `${raw.e}cc` : null, raw.k ? `${raw.k}hp` : null].filter(Boolean);
    const images = getImageUrls(raw);
    const currencyRaw = raw.priceCurrency || '€';

    return {
      id: raw.id,
      name: [brand, model, raw.generation].filter(Boolean).join(' ') || null,
      type: 'car',
      brand,
      model,
      year: raw.year || null,
      price: raw.price ? Number(raw.price) : null,
      discountPrice: null,
      currency: currencyRaw === '€' ? 'EUR' : currencyRaw,
      km: raw.km || null,
      mileageRaw: null,
      fuel: raw.fuelTypeId || null,
      transmission: raw.transmission || null,
      engine: engineParts.length ? engineParts.join(' ') : null,
      bodyType: null,
      color: raw.n || null,
      interiorColor: null,
      condition: raw.isSold ? 'Sold' : null,
      description: null,
      categories: [],
      sellerUsername: null,
      instagramLink: null,
      thumbnail: images[0] || null,
      images,
      publishedAt: raw.postedTime || null,
      isSponsored: false,
      url: `https://autoshqip.com/car-details/${raw.id}`,
      location: raw.location || raw.o || null,
      scrapedAt: new Date().toISOString(),
    };
  },
};
