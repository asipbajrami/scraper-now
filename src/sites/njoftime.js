const BASE_URL = 'https://www.njoftime.com';
const FORUM_PATH = '/forums/makina-autovetura.28/';

export default {
  name: 'njoftime',
  displayName: 'Njoftime',

  env: {
    prefix: 'NJOFTIME',
    defaults: {
      maxPages: 3,
      delayMs: 800,
      detailDelayMs: 500,
      fetchDetails: true,
      outputDir: 'output/njoftime',
    },
  },

  headers: {
    Accept: 'text/html',
  },

  pagination: { type: 'page' },

  async fetchPage(page, ctx) {
    const url = page === 1
      ? `${BASE_URL}${FORUM_PATH}`
      : `${BASE_URL}${FORUM_PATH}page-${page}`;

    const $ = await ctx.fetchCheerio(url, this.headers);
    const threads = [];

    $('[class*="js-threadListItem"]').each((_, el) => {
      const $item = $(el);
      const threadId = ($item.attr('class') || '').match(/js-threadListItem-(\d+)/)?.[1];
      if (!threadId) return;

      const author = $item.attr('data-author') || null;
      const $titleLink = $item.find('.structItem-title a').last();
      const title = $titleLink.text().trim();
      const threadUrl = $titleLink.attr('href') || '';

      const cleanField = (sel) => ($item.find(sel).text() || '').replace(/\s+/g, ' ').trim() || null;
      const location = cleanField('[data-field="field-location"] dd');
      const zona = cleanField('[data-field="field_9_zona"] dd');
      const carType = cleanField('[data-field="field_1_makina"] dd');
      const brand = cleanField('[data-field="field_9_markatcar"] dd');
      const year = cleanField('[data-field="field_5_viti"] dd');
      const priceStr = ($item.find('[data-field="field_4_cmimi"] dd').text() || '').replace(/\s+/g, ' ').trim() || null;

      const images = [];
      $item.find('.swiper-slide img').each((_, img) => {
        const src = $(img).attr('src');
        if (src && !images.includes(src)) {
          images.push(src.startsWith('http') ? src : `${BASE_URL}${src}`);
        }
      });

      const dateText = $item.find('.structItem-cell--latest time').attr('datetime') ||
                       $item.find('.structItem-cell--latest time').text().trim() || null;

      threads.push({
        id: Number(threadId),
        title,
        url: threadUrl.startsWith('http') ? threadUrl : `${BASE_URL}${threadUrl}`,
        author,
        location,
        zona,
        carType,
        brand,
        year: year ? Number(year) : null,
        price: priceStr ? Number(priceStr.replace(/[^\d.]/g, '')) || null : null,
        priceRaw: priceStr,
        date: dateText,
        thumbnailImages: images,
      });
    });

    // Total pages
    let totalPages = null;
    $('a[href*="page-"]').each((_, el) => {
      const match = ($(el).attr('href') || '').match(/page-(\d+)/);
      if (match) {
        const num = Number(match[1]);
        if (!totalPages || num > totalPages) totalPages = num;
      }
    });

    return { items: threads, totalPages };
  },

  detail: {
    async fetch(item, ctx) {
      const $ = await ctx.fetchCheerio(item.url, { Accept: 'text/html' });

      const fields = {};
      $('[data-field]').each((_, el) => {
        const fieldName = $(el).attr('data-field');
        const label = $(el).find('dt').text().trim();
        const value = $(el).find('dd').text().trim();
        if (fieldName && value) {
          fields[fieldName] = { label, value };
        }
      });

      const description = $('.message-body .bbWrapper').first().text().trim().slice(0, 1000) || null;

      const images = [];
      $('.message-body img[src*="attachments"]').each((_, img) => {
        const src = $(img).attr('src');
        if (src && !images.includes(src)) {
          images.push(src.startsWith('http') ? src : `${BASE_URL}${src}`);
        }
      });

      return { description, fullImages: images, detailFields: fields };
    },
  },

  normalize(listing, detail) {
    return {
      id: listing.id,
      title: listing.title,
      url: listing.url,
      author: listing.author,
      location: listing.location,
      zona: listing.zona,
      carType: listing.carType,
      brand: listing.brand,
      year: listing.year,
      price: listing.price,
      priceRaw: listing.priceRaw,
      date: listing.date,
      thumbnailImages: listing.thumbnailImages,
      description: detail?.description || null,
      fullImages: detail?.fullImages || null,
      detailFields: detail?.detailFields || null,
      scrapedAt: new Date().toISOString(),
    };
  },
};
