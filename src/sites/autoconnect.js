const API_BASE = 'https://img-autoconnect.uk';
const MEDIA_BASE = `${API_BASE}/`;
const PAGE_SIZE = 50;

function parseImages(sidecarMedias) {
  if (!sidecarMedias) return [];
  try {
    const items = typeof sidecarMedias === 'string' ? JSON.parse(sidecarMedias) : sidecarMedias;
    return items
      .map((img) => {
        const url = img.imageStandardResolutionUrl || img.imageThumbnailUrl;
        if (!url) return null;
        return url.startsWith('http') ? url : `${MEDIA_BASE}${url}`;
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function parseContact(contact) {
  if (!contact) return {};
  try {
    return typeof contact === 'string' ? JSON.parse(contact) : contact;
  } catch {
    return {};
  }
}

export default {
  name: 'autoconnect',
  displayName: 'AutoConnect',

  env: {
    prefix: 'AUTOCONNECT',
    defaults: {
      maxPages: 10,
      delayMs: 500,
      detailDelayMs: 300,
      fetchDetails: true,
      outputDir: 'output/autoconnect',
    },
  },

  headers: {
    Origin: 'https://www.autoconnect.al',
    Referer: 'https://www.autoconnect.al/',
  },

  pagination: { type: 'page' },

  async fetchPage(page, ctx) {
    // API uses 0-based pages
    const apiPage = page - 1;
    const filter = JSON.stringify({
      type: 'car',
      searchTerms: [],
      sortTerms: [{ key: 'renewedTime', order: 'DESC' }],
      page: String(apiPage),
      maxResults: PAGE_SIZE,
    });

    const formData = new FormData();
    formData.append('filter', filter);

    const res = await ctx.postFetch(`${API_BASE}/car-details/search`, formData, this.headers);
    const data = await res.json();
    if (!data.success) throw new Error(data.message || 'Search failed');

    return { items: data.result || [], totalPages: null };
  },

  detail: {
    async fetch(item, ctx) {
      const data = await ctx.fetchJson(`${API_BASE}/car-details/post/${item.id}`, {
        Origin: 'https://www.autoconnect.al',
        Referer: 'https://www.autoconnect.al/',
      });
      if (!data.success || !Array.isArray(data.result) || data.result.length === 0) return null;
      return data.result[0];
    },
  },

  normalize(listing, detail) {
    const src = detail || listing;
    const contact = parseContact(src.contact);
    const images = parseImages(src.sidecarMedias);

    return {
      id: src.id,
      brand: src.make || null,
      model: src.model || null,
      variant: src.variant || null,
      year: src.registration ? Number(src.registration) : null,
      price: src.price ? Number(src.price) : null,
      currency: 'EUR',
      km: src.mileage ? Number(src.mileage) : null,
      fuel: src.fuelType || null,
      transmission: src.transmission || null,
      engineSize: detail?.engineSize ? Number(detail.engineSize) : null,
      drivetrain: detail?.drivetrain || null,
      bodyType: detail?.bodyType || null,
      seats: detail?.seats ? Number(detail.seats) : null,
      doors: detail?.numberOfDoors ? Number(detail.numberOfDoors) : null,
      emissionGroup: detail?.emissionGroup || null,
      customsPaid: src.customsPaid === true || src.customsPaid === 1,
      canExchange: src.canExchange === true || src.canExchange === 1,
      sold: detail?.sold === 1 || false,
      description: detail?.caption?.slice(0, 1000) || null,
      location: contact.address || null,
      phone: contact.phone_number || null,
      promoted: src.promoted || false,
      highlighted: src.highlighted || false,
      url: `https://www.autoconnect.al/sq-al/automjete/makine-ne-shitje/${src.id}`,
      images,
      createdAt: detail?.dateCreated || null,
      updatedAt: detail?.dateUpdated || null,
      scrapedAt: new Date().toISOString(),
    };
  },
};
