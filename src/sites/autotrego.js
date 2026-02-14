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

    return {
      id: raw.id,
      brand: mod.brand || null,
      model: mod.model || raw.makeTypeId || null,
      generation: raw.generation || mod.generation || null,
      engine: raw.engine || mod.engine || null,
      description: raw.description || null,
      price: raw.price || null,
      location: raw.location || null,
      year: raw.year || null,
      km: raw.mileage || null,
      fuel: mod.fuel || raw.engineType || null,
      transmission: raw.transmission || null,
      bodyType: raw.bodyType || mod.coupe || null,
      color: raw.color || null,
      isSold: raw.isSold || false,
      type: raw.type || null,
      powertrain: mod.powertrain || null,
      doors: mod.doors ? Number(mod.doors) : null,
      seats: mod.places ? Number(mod.places) : null,
      engineCc: mod.engineDisplacement ? Number(mod.engineDisplacement) : null,
      torqueNm: mod.torqueNm ? Number(mod.torqueNm) : null,
      cylinders: mod.cilinders ? Number(mod.cilinders) : null,
      driveType: mod.drive || null,
      emissionStandard: mod.emissionStandard || null,
      fuelConsumptionCombined: mod.fuelConsumptionCombined ? Number(mod.fuelConsumptionCombined) : null,
      fuelConsumptionUrban: mod.fuelConsumptionUrban ? Number(mod.fuelConsumptionUrban) : null,
      fuelConsumptionExtraurban: mod.fuelConsumptionExtraurban ? Number(mod.fuelConsumptionExtraurban) : null,
      curbWeight: mod.curbWeight ? Number(mod.curbWeight) : null,
      lengthMm: mod.length ? Number(mod.length) : null,
      widthMm: mod.width ? Number(mod.width) : null,
      heightMm: mod.height ? Number(mod.height) : null,
      views: raw.views || 0,
      slug: raw.slug || null,
      url: raw.slug ? `https://autotrego.com/auto/${raw.slug}` : null,
      images: raw.images || [],
      createdAt: raw.createdAt || null,
      validUntil: raw.validUntil || null,
      scrapedAt: new Date().toISOString(),
    };
  },
};
