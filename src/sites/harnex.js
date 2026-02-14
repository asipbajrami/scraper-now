const API_BASE = 'https://api.harnex.io/api';
const IMAGE_BASE = 'https://harnex.s3.eu-central-1.amazonaws.com/vehicles/';

const ENGINE_TYPES = {
  1: 'Diesel',
  2: 'Petrol',
  3: 'Benzine+Gas',
  4: 'Hybrid Diesel',
  5: 'Electric',
  6: 'LPG',
};

const TRANSMISSION_TYPES = {
  1: 'Manual',
  2: 'Automatic',
  3: 'Semi-Automatic',
};

export default {
  name: 'harnex',
  displayName: 'Harnex',

  env: {
    prefix: 'HARNEX',
    defaults: {
      maxPages: 1,
      delayMs: 400,
      detailDelayMs: 400,
      fetchDetails: true,
      outputDir: 'output/harnex',
    },
  },

  headers: {
    Accept: 'application/json',
  },

  pagination: { type: 'custom' },

  async fetchAll(ctx) {
    const url = `${API_BASE}/unauth/vehicles`;
    const data = await ctx.fetchJson(url, this.headers);
    if (!data.success || !Array.isArray(data.vehicles)) {
      throw new Error('Unexpected response format');
    }
    return data.vehicles;
  },

  detail: {
    async fetch(item, ctx) {
      const url = `${API_BASE}/unauth/vehicles/${item.id}`;
      const data = await ctx.fetchJson(url);
      if (!data.success || !data.vehicle) return null;
      return data.vehicle;
    },
  },

  normalize(raw, detail) {
    const v = detail || raw;
    const brand = v.Vehicle_Manufacturer?.name || null;
    const model = v.Vehicle_Model?.name || null;
    const images = (v.Vehicle_Images || []).map((img) => `${IMAGE_BASE}${img.image}`);
    const engineParts = [v.cubic_capacity ? `${v.cubic_capacity}cc` : null, v.horsepower ? `${v.horsepower}hp` : null].filter(Boolean);
    const city = v.City?.name || null;
    const country = v.Vehicle_Location?.name || null;

    return {
      id: v.id,
      name: [brand, model].filter(Boolean).join(' ') || null,
      type: 'car',
      brand,
      model,
      year: v.year || null,
      price: v.Vehicle_Price?.[0]?.total ? Number(v.Vehicle_Price[0].total) : null,
      discountPrice: null,
      currency: 'EUR',
      km: v.current_km || null,
      mileageRaw: null,
      fuel: ENGINE_TYPES[v.engine_type] || null,
      transmission: TRANSMISSION_TYPES[v.transmission_type] || null,
      engine: engineParts.length ? engineParts.join(' ') : null,
      bodyType: v.Vehicle_Shape?.name || null,
      color: v.Vehicle_Color?.name || null,
      interiorColor: v.interiorColor?.name || null,
      condition: v.Vehicle_Condition?.name || null,
      description: null,
      categories: [],
      sellerUsername: v.Company?.name || null,
      instagramLink: null,
      thumbnail: images[0] || null,
      images,
      publishedAt: v.createdAt || null,
      isSponsored: false,
      url: `https://www.harnex.io/vehicles/${v.id}`,
      location: [city, country].filter(Boolean).join(', ') || null,
      scrapedAt: new Date().toISOString(),
    };
  },
};
