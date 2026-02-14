import * as cheerio from 'cheerio';

const BASE_URL = 'https://www.merrjep.al';
const SEARCH_URL = `${BASE_URL}/Home2/Search`;
const CATEGORY_ID = 3016;
const PAGE_SIZE = 50;

export default {
  name: 'merrjep',
  displayName: 'MerrJep',

  env: {
    prefix: 'MERRJEP',
    defaults: {
      maxPages: 5,
      delayMs: 800,
      detailDelayMs: 500,
      fetchDetails: true,
      outputDir: 'output/merrjep',
    },
  },

  headers: {
    'X-Requested-With': 'XMLHttpRequest',
    Referer: `${BASE_URL}/njoftime/makina/`,
  },

  pagination: { type: 'page' },

  async fetchPage(page, ctx) {
    const body = new URLSearchParams({
      CategoryId: String(CATEGORY_ID),
      Page: String(page),
    });

    const res = await ctx.postFetch(SEARCH_URL, body.toString(), {
      ...this.headers,
      'Content-Type': 'application/x-www-form-urlencoded',
    });

    const data = await res.json();
    const ads = data.Result?.Ads;
    if (!ads) throw new Error(`No Ads in response for page ${page}`);

    const items = (ads.Items || []).map((item) => ({
      id: item.Id,
      title: item.Title,
      url: `${BASE_URL}${item.AdUrl}`,
      brand: item.CarMake?.Name || null,
      model: item.CarModel?.Name || null,
      price: item.ActualPrice || null,
      currency: item.Currency || null,
      location: item.Location?.Name || null,
      isCompany: item.IsCompany || false,
      dateDisplay: item.DateDisplay || null,
      imageUrl: item.PrimaryImage?.Url || null,
      imageCount: item.Images?.length || 0,
      isCargoEnabled: item.IsCargoEnabled || false,
    }));

    // Extract total from CountTabs
    let totalAds = 0;
    const allTab = ads.CountTabs?.find((t) => t.Active);
    if (allTab?.After) {
      const match = allTab.After.match(/(\d[\d\s]*)\s*$/);
      if (match) totalAds = Number(match[1].replace(/\s/g, ''));
    }

    const totalPages = totalAds ? Math.ceil(totalAds / (ads.Query?.PageSize || PAGE_SIZE)) : null;
    return { items, totalPages };
  },

  detail: {
    async fetch(item, ctx) {
      const html = await ctx.fetchHtml(item.url, { Accept: 'text/html' });
      const $ = cheerio.load(html);

      const details = {};
      $('a.tag-item').each((_, el) => {
        const label = $(el).find('span').first().text().replace(':', '').trim();
        const value = $(el).find('bdi').first().text().trim();
        if (label && value) details[label] = value;
      });

      $('span').each((_, el) => {
        const text = $(el).text().trim();
        if (text.endsWith(':')) {
          const label = text.replace(':', '').trim();
          const bdi = $(el).next('bdi').text().trim();
          if (label && bdi && !details[label]) details[label] = bdi;
        }
      });

      const descEl = $('.description-area span, .ad-description span').first();
      const description = descEl.length ? descEl.text().trim() : '';

      const images = [];
      $('img[data-src*="media.merrjep.al"], [data-src*="media.merrjep.al"]').each((_, el) => {
        const src = $(el).attr('data-src') || $(el).attr('src');
        if (src && !images.includes(src)) images.push(src);
      });

      return {
        year: details['Viti'] ? Number(details['Viti']) : null,
        fuel: details['Karburanti'] || null,
        transmission: details['Kambio'] || null,
        km: details['Kilometrazhi'] ? Number(details['Kilometrazhi'].replace(/\D/g, '')) : null,
        color: details['Ngjyra'] || null,
        engineSize: details['Kubikazhi'] || null,
        bodyType: details['Tipi'] || null,
        manufacturer: details['Prodhuesi'] || null,
        modelDetail: details['Modeli'] || null,
        condition: details['Kushti'] || null,
        description: description.slice(0, 500) || null,
        detailImages: images,
        rawProps: details,
      };
    },
  },

  normalize(listing, detail) {
    const images = detail?.detailImages?.length ? detail.detailImages : (listing.imageUrl ? [listing.imageUrl] : []);

    return {
      id: listing.id,
      name: listing.title || null,
      type: 'car',
      brand: listing.brand,
      model: listing.model,
      year: detail?.year || null,
      price: listing.price,
      discountPrice: null,
      currency: listing.currency,
      km: detail?.km || null,
      mileageRaw: null,
      fuel: detail?.fuel || null,
      transmission: detail?.transmission || null,
      engine: detail?.engineSize || null,
      bodyType: detail?.bodyType || null,
      color: detail?.color || null,
      interiorColor: null,
      condition: detail?.condition || null,
      description: detail?.description || null,
      categories: [],
      sellerUsername: null,
      instagramLink: null,
      thumbnail: listing.imageUrl || null,
      images,
      publishedAt: listing.dateDisplay || null,
      isSponsored: false,
      url: listing.url,
      location: listing.location,
      scrapedAt: new Date().toISOString(),
    };
  },
};
