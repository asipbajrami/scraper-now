const API_URL = 'https://autotrego.com/api/cars';
const PAGE_SIZE = 50;

export default {
  name: 'autotrego',
  displayName: 'AutoTrego',

  env: {
    prefix: 'AUTOTREGO',
    defaults: {
      maxPages: 5,
      delayMs: 400,
      fetchDetails: false,
      outputDir: 'output/autotrego',
    },
  },

  headers: {
    Accept: 'application/json',
    'X-Application-Id': 'WEB',
  },

  pagination: { type: 'page' },

  async fetchPage(page, ctx) {
    const url = `${API_URL}?page=${page}&limit=${PAGE_SIZE}`;
    const data = await ctx.fetchJson(url, this.headers);
    return { items: data.items || [], totalPages: data.totalPages || null };
  },

  normalize(raw) {
    const mod = raw.modification || {};
    const brand = mod.brand || null;
    const model = mod.model || raw.makeTypeId || null;
    const images = raw.images || [];

    return {
      id: raw.id,
      name: [brand, model, raw.generation].filter(Boolean).join(' ') || null,
      type: raw.type || null,
      brand,
      model,
      year: raw.year || null,
      price: raw.price || null,
      discountPrice: null,
      currency: 'EUR',
      km: raw.mileage || null,
      mileageRaw: null,
      fuel: mod.fuel || raw.engineType || null,
      transmission: raw.transmission || null,
      engine: raw.engine || mod.engine || null,
      bodyType: raw.bodyType || mod.coupe || null,
      color: raw.color || null,
      interiorColor: null,
      condition: raw.isSold ? 'Sold' : null,
      description: raw.description || null,
      categories: [],
      sellerUsername: null,
      instagramLink: null,
      thumbnail: images[0] || null,
      images,
      publishedAt: raw.createdAt || null,
      isSponsored: false,
      url: raw.slug ? `https://autotrego.com/auto/${raw.slug}` : null,
      location: raw.location || null,
      scrapedAt: new Date().toISOString(),
    };
  },
};
