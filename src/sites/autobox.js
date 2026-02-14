const BASE_URL = 'https://www.autobox.al';

function parsePrice(priceStr) {
  if (!priceStr) return { price: null, currency: null };
  const cleaned = priceStr.replace(/[^\d.,€$]/g, '').trim();
  const number = Number(cleaned.replace(/[€$]/g, '').replace(/,/g, ''));
  const currency = priceStr.includes('€') ? 'EUR' : priceStr.includes('$') ? 'USD' : null;
  return { price: isNaN(number) ? null : number, currency };
}

function fieldValue($, fieldId) {
  const el = $(`#df_field_${fieldId} .value`);
  if (!el.length) return null;
  const text = el.text().replace(/<!--.*?-->/g, '').trim();
  return text || null;
}

function checkboxValues($, fieldId) {
  const items = [];
  $(`#df_field_${fieldId} .value li.active`).each((_, li) => {
    const text = $(li).attr('title');
    if (text) items.push(text);
  });
  return items.length ? items : null;
}

export default {
  name: 'autobox',
  displayName: 'AutoBox',

  env: {
    prefix: 'AUTOBOX',
    defaults: {
      maxPages: 20,
      delayMs: 500,
      detailDelayMs: 300,
      fetchDetails: true,
      outputDir: 'output/autobox',
    },
  },

  headers: {
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'sq,en;q=0.9',
  },

  pagination: { type: 'page' },

  async fetchPage(page, ctx) {
    const url = page === 1 ? `${BASE_URL}/makina.html` : `${BASE_URL}/makina/index${page}.html`;
    const $ = await ctx.fetchCheerio(url, this.headers);
    const listings = [];

    $('article.item').each((_, article) => {
      const $article = $(article);
      const compareEl = $article.find('.add_to_compare');

      const id = compareEl.attr('data-listing-id') || null;
      const listingUrl = compareEl.attr('data-listing-url') || $article.find('a[href*="/makina/"]').first().attr('href') || null;
      const title = compareEl.attr('data-listing-title') || $article.find('.title a').text().trim() || null;
      const image = compareEl.attr('data-listing-picture') || $article.find('.picture img').attr('src') || null;
      const priceRaw = $article.find('.price-tag span').text().trim() || null;

      const fields = {};
      $article.find('.fields .table-cell').each((_, cell) => {
        const name = $(cell).find('.name').text().trim();
        const value = $(cell).find('.value').text().trim();
        if (name && value) fields[name] = value;
      });

      const photoCount = $article.find('.picture span[accesskey]').attr('accesskey') || null;

      listings.push({
        id: id ? Number(id) : null,
        url: listingUrl,
        title,
        image,
        priceRaw,
        photoCount: photoCount ? Number(photoCount) : null,
        fields,
      });
    });

    const totalPages = $('input[name="stats"]').val();
    const maxPage = totalPages ? Number(totalPages.split('|')[1]) : null;

    return { items: listings, totalPages: maxPage };
  },

  detail: {
    async fetch(item, ctx) {
      if (!item.url) return null;
      const $ = await ctx.fetchCheerio(item.url, {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'sq,en;q=0.9',
      });

      // JSON-LD
      let jsonLd = null;
      $('script[type="application/ld+json"]').each((_, el) => {
        try {
          const data = JSON.parse($(el).html());
          const product = Array.isArray(data) ? data.find((d) => d['@type'] === 'Product') : data['@type'] === 'Product' ? data : null;
          if (product) jsonLd = product;
        } catch { /* ignore */ }
      });

      const condition = fieldValue($, 'condition');
      const bodyType = fieldValue($, 'body_style');
      const year = fieldValue($, 'built');
      const customs = fieldValue($, 'customs');
      const transmission = fieldValue($, 'transmission');
      const engineCc = fieldValue($, 'engine_cm3');
      const mileage = fieldValue($, 'mileage');
      const drivetrain = fieldValue($, 'drive_train');
      const exteriorColor = fieldValue($, 'exterior_color');
      const interiorColor = fieldValue($, 'interior_color');
      const fuel = fieldValue($, 'fuel');
      const emissionClass = fieldValue($, 'emission_classs');
      const description = fieldValue($, 'description_add');
      const country = fieldValue($, 'b_country');
      const city = fieldValue($, 'b_country_level2');
      const address = fieldValue($, 'b_address');

      const sellerName = $('ul.seller-info .name a').first().text().trim() || null;
      const phone = $('a[href^="tel:"]').first().text().trim() || null;

      let images = [];
      if (jsonLd?.image) {
        images = Array.isArray(jsonLd.image) ? jsonLd.image : [jsonLd.image];
      } else {
        $('#imgSource a[href]').each((_, a) => {
          const href = $(a).attr('href');
          if (href) images.push(href);
        });
      }

      const comfort = checkboxValues($, 'comfort');
      const safety = checkboxValues($, 'safety');
      const priceLd = jsonLd?.offers?.price ? Number(jsonLd.offers.price) : null;
      const currencyLd = jsonLd?.offers?.priceCurrency || null;

      return {
        condition, bodyType, year: year ? Number(year) : null, customs, transmission,
        engineCc, mileage, drivetrain, exteriorColor, interiorColor, fuel, emissionClass,
        description: description?.slice(0, 2000) || null,
        country, city, address, sellerName, phone, images, comfort, safety, priceLd, currencyLd,
      };
    },
  },

  normalize(listing, detail) {
    const titleParts = listing.title ? listing.title.split(',').map((s) => s.trim()) : [];
    const brand = titleParts[0] || null;
    const model = titleParts[1] || null;

    const { price, currency } = detail
      ? { price: detail.priceLd, currency: detail.currencyLd }
      : parsePrice(listing.priceRaw);

    const km = detail?.mileage ? Number(detail.mileage.replace(/[^\d]/g, '')) || null : null;
    const engineCc = detail?.engineCc ? Number(detail.engineCc.replace(/[^\d]/g, '')) || null : null;
    const images = detail?.images || (listing.image ? [listing.image] : []);

    return {
      id: listing.id,
      name: listing.title || null,
      type: 'car',
      brand,
      model,
      year: detail?.year || null,
      price,
      discountPrice: null,
      currency,
      km,
      mileageRaw: detail?.mileage || null,
      fuel: detail?.fuel || listing.fields?.Karburanti || null,
      transmission: detail?.transmission || null,
      engine: engineCc ? `${engineCc}cc` : null,
      bodyType: detail?.bodyType || null,
      color: detail?.exteriorColor || null,
      interiorColor: detail?.interiorColor || null,
      condition: detail?.condition || null,
      description: detail?.description || null,
      categories: [],
      sellerUsername: detail?.sellerName || null,
      instagramLink: null,
      thumbnail: listing.image || null,
      images,
      publishedAt: null,
      isSponsored: false,
      url: listing.url,
      location: detail?.city || listing.fields?.Qyteti || null,
      scrapedAt: new Date().toISOString(),
    };
  },
};
