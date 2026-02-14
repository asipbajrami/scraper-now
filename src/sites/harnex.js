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

    return {
      id: v.id,
      brand: v.Vehicle_Manufacturer?.name || null,
      model: v.Vehicle_Model?.name || null,
      year: v.year || null,
      price: v.Vehicle_Price?.[0]?.total ? Number(v.Vehicle_Price[0].total) : null,
      currency: 'EUR',
      km: v.current_km || null,
      fuel: ENGINE_TYPES[v.engine_type] || null,
      transmission: TRANSMISSION_TYPES[v.transmission_type] || null,
      horsepower: v.horsepower || null,
      kw: v.kw || null,
      cubicCapacity: v.cubic_capacity || null,
      doors: v.doors || null,
      seats: v.seats || null,
      color: v.Vehicle_Color?.name || null,
      interiorColor: v.interiorColor?.name || null,
      shape: v.Vehicle_Shape?.name || null,
      condition: v.Vehicle_Condition?.name || null,
      country: v.Vehicle_Location?.name || null,
      city: v.City?.name || null,
      emissionClass: v.emission_class || null,
      weight: v.weight || null,
      nrOfGears: v.nr_of_gears || null,
      nrOfCylinders: v.nr_of_cylinders || null,
      urbanConsumption: v.urban_consumption || null,
      interurbanConsumption: v.interurban_consumption || null,
      swapPossible: v.swap_possible ?? null,
      isAvailable: v.is_available ?? null,
      options: v.Vehicle_Options?.length ? v.Vehicle_Options.map((o) => o.name || o) : null,
      manufactureCountry: v.Vehicle_Manufacture_Country?.name || null,
      company: v.Company?.name || null,
      url: `https://www.harnex.io/vehicles/${v.id}`,
      images: (v.Vehicle_Images || []).map((img) => `${IMAGE_BASE}${img.image}`),
      createdAt: v.createdAt || null,
      scrapedAt: new Date().toISOString(),
    };
  },
};
