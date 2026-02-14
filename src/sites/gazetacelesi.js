const API_BASE = 'https://api.celesi.com/gazeta';
const CATEGORY = 'makina';
const PAGE_SIZE = 50;

function extractProperty(properties, label) {
  const prop = properties.find((p) => p.label === label);
  if (!prop) return null;
  const details = prop.details || [];
  const selected = details.find((d) => d.value);
  return selected?.value || null;
}

function extractPropertyOptions(properties, label) {
  const prop = properties.find((p) => p.label === label);
  if (!prop) return null;
  const details = prop.details || [];
  const selected = details.filter((d) => d.value);
  return selected.length > 0 ? selected.map((d) => d.value) : null;
}

export default {
  name: 'gazetacelesi',
  displayName: 'Gazeta Celesi',

  env: {
    prefix: 'GAZETA',
    defaults: {
      maxPages: 10,
      delayMs: 500,
      fetchDetails: false,
      outputDir: 'output/gazetacelesi',
    },
  },

  headers: {
    Accept: 'application/json',
    Origin: 'https://www.gazetacelesi.al',
    Referer: 'https://www.gazetacelesi.al/',
  },

  pagination: { type: 'custom' },

  async fetchAll(ctx) {
    const allCars = [];

    for (const endpoint of ['premium', '']) {
      const label = endpoint || 'regular';
      let page = 1;
      let totalPages = 1;

      while (page <= Math.min(ctx.env.maxPages, totalPages)) {
        const apiEndpoint = endpoint ? `list/${endpoint}` : 'list';
        const url = `${API_BASE}/ads/${apiEndpoint}/${CATEGORY}?page=${page}&pageSize=${PAGE_SIZE}`;

        ctx.log.info(`Fetching ${label} page ${page}...`);

        const data = await ctx.fetchJson(url, this.headers);
        const items = data.data || [];
        const meta = data.meta || {};

        if (page === 1) {
          totalPages = meta.totalPages || 1;
          ctx.log.info(`  ${label}: ${meta.totalItems || items.length} total listings, ${totalPages} pages`);
        }

        allCars.push(...items);
        ctx.log.info(`  Page ${page}: ${items.length} items (total: ${allCars.length})`);

        if (items.length < PAGE_SIZE) break;
        page++;
        await ctx.sleep(ctx.env.delayMs);
      }
    }

    return allCars;
  },

  normalize(raw) {
    const props = raw.properties || [];
    const images = (raw.images || []).map((img) => img.url);
    const kmRaw = extractProperty(props, 'Kilometrazhi');
    const yearStr = extractProperty(props, 'Viti i prodhimit');

    return {
      id: raw.id,
      name: raw.title || null,
      type: extractProperty(props, 'Tipologjia') || 'car',
      brand: extractProperty(props, 'Marka'),
      model: extractProperty(props, 'Modeli'),
      year: yearStr ? Number(yearStr) || null : null,
      price: raw.price ? Number(raw.price) : null,
      discountPrice: null,
      currency: raw.currency || null,
      km: kmRaw ? Number(kmRaw.replace(/[^\d]/g, '')) || null : null,
      mileageRaw: kmRaw,
      fuel: extractProperty(props, 'Karburanti'),
      transmission: extractProperty(props, 'Kambio'),
      engine: extractProperty(props, 'Fuqia motorrike'),
      bodyType: extractProperty(props, 'Tipologjia'),
      color: extractProperty(props, 'Ngjyra'),
      interiorColor: extractProperty(props, 'Ngjyra e brendshme'),
      condition: extractProperty(props, 'Gjendja e automjetit'),
      description: (raw.description || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').trim().slice(0, 500) || null,
      categories: [],
      sellerUsername: null,
      instagramLink: null,
      thumbnail: (raw.images || [])[0]?.thumbnailUrl || null,
      images,
      publishedAt: raw.publishedAt || null,
      isSponsored: false,
      url: `https://www.gazetacelesi.al/makina/njoftime/${raw.slugUrl}.html`,
      location: raw.location?.name || null,
      scrapedAt: new Date().toISOString(),
    };
  },
};
