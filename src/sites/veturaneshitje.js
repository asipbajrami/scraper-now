const BASE_URL = 'https://www.veturaneshitje.com';

function parsePrice(priceStr) {
  if (!priceStr) return { price: null, currency: null, negotiable: false };
  const text = priceStr.trim();
  if (/marr[eë]veshje/i.test(text) || text === '*Çmimi me marrëveshje') {
    return { price: null, currency: null, negotiable: true };
  }
  const number = Number(text.replace(/[^\d]/g, ''));
  const currency = text.includes('EUR') ? 'EUR' : text.includes('$') ? 'USD' : null;
  const negotiable = /negociuesh/i.test(priceStr);
  return { price: isNaN(number) || number === 0 ? null : number, currency, negotiable };
}

function extractId(href) {
  const match = href?.match(/\/vetura\/(\d+)\//);
  return match ? Number(match[1]) : null;
}

export default {
  name: 'veturaneshitje',
  displayName: 'VeturaNëShitje',

  env: {
    prefix: 'VETURA',
    defaults: {
      maxPages: 10,
      delayMs: 500,
      detailDelayMs: 300,
      fetchDetails: true,
      outputDir: 'output/veturaneshitje',
    },
  },

  headers: {
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'sq,en;q=0.9',
  },

  pagination: { type: 'page' },

  async fetchPage(page, ctx) {
    const url = page === 1 ? `${BASE_URL}/vetura` : `${BASE_URL}/vetura?page=${page}`;
    const $ = await ctx.fetchCheerio(url, this.headers);
    const listings = [];
    const seen = new Set();

    $('ul.car-list > li.row').each((_, li) => {
      const $li = $(li);
      const linkEl = $li.find('a[href*="/vetura/"]').first();
      const href = linkEl.attr('href');
      if (!href || !href.match(/\/vetura\/\d+\//)) return;

      const id = extractId(href);
      if (!id || seen.has(id)) return;
      seen.add(id);

      const img = $li.find('img.img-responsive').first().attr('src') || null;
      const heading = $li.find('h2.lead');
      const brand = heading.find('strong').text().trim() || null;
      const headingText = heading.text().replace('Vetura në shitje', '').trim();
      const model = brand ? headingText.replace(brand, '').trim() || null : null;

      const priceEl = $li.find('.text-orange.price');
      const priceClone = priceEl.clone();
      priceClone.find('span[style*="line-through"]').remove();
      const priceText = priceClone.find('strong').text().trim() || priceClone.text().trim();
      const { price, currency, negotiable } = parsePrice(priceText);

      const oldPriceEl = priceEl.find('span[style*="line-through"]');
      const oldPrice = oldPriceEl.length ? oldPriceEl.text().trim() : null;

      const techDetails = [];
      $li.find('.car-tech-detail').each((_, td) => {
        techDetails.push($(td).text().trim());
      });

      listings.push({
        id,
        url: `${BASE_URL}${href}`,
        image: img ? (img.startsWith('http') ? img : `${BASE_URL}${img}`) : null,
        brand,
        model,
        price,
        currency,
        negotiable,
        oldPrice: oldPrice ? parsePrice(oldPrice).price : null,
        fuel: techDetails[0] || null,
        transmission: techDetails[1] || null,
        year: techDetails[2] ? Number(techDetails[2]) || null : null,
        engineCc: techDetails[3] ? Number(techDetails[3].replace(/[^\d]/g, '')) || null : null,
        customs: techDetails[4] || null,
        registration: techDetails[5] || null,
        location: $li.find('.glyphicon-map-marker').parent().text().trim() || null,
        date: $li.find('.glyphicon-time').parent().text().trim() || null,
        isSponsored: $li.hasClass('bg-warning'),
        isRecommended: $li.hasClass('recommended'),
      });
    });

    const lastPageLink = $('li.PagedList-skipToLast a').attr('href');
    const totalPages = lastPageLink ? Number(lastPageLink.match(/page=(\d+)/)?.[1]) : null;

    return { items: listings, totalPages };
  },

  detail: {
    async fetch(item, ctx) {
      const $ = await ctx.fetchCheerio(item.url, {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'sq,en;q=0.9',
      });

      const specs = {};
      const specLabels = [];
      $('table.table-car-specifications tr').each((_, tr) => {
        const tds = $(tr).find('td');
        if (tds.length === 0) return;
        const hasLabels = tds.first().find('span').length > 0 || tds.first().find('i.glyphicon').length > 0;
        const hasValues = tds.first().hasClass('strong');

        if (hasLabels) {
          tds.each((_, td) => {
            specLabels.push($(td).find('span').text().trim() || $(td).text().trim());
          });
        } else if (hasValues) {
          tds.each((i, td) => {
            const label = specLabels[specLabels.length - tds.length + i] || `field_${i}`;
            const value = $(td).text().trim();
            const key = label.toLowerCase();
            if (key.includes('dogana')) specs.customs = value;
            else if (key.includes('regjistrim')) specs.registration = value;
            else if (key.includes('lloji') || key.includes('kategori')) specs.bodyType = value;
            else if (key.includes('viti')) specs.year = value;
            else if (key.includes('karburant')) specs.fuel = value;
            else if (key.includes('marsh')) specs.transmission = value;
            else if (key.includes('ngjyr')) specs.color = value;
            else if (key.includes('ulese') || key.includes('seat')) specs.seats = value;
            else if (key.includes('kubikaz') || key.includes('motor')) specs.engineCc = value;
            else if (key.includes('kilometraz') || key.includes('mileage')) specs.mileage = value;
          });
        }
      });

      const priceEl = $('h3.text-orange.price');
      const priceClone = priceEl.clone();
      priceClone.find('small').remove();
      const priceText = priceClone.find('strong').text().trim() || priceClone.text().trim();
      const detailPrice = parsePrice(priceText);

      const description = $('p.description').text().trim() || null;
      const title = $('h2.no-margin').first().text().trim() || null;

      const images = [];
      $('img.main-photo').each((_, img) => {
        const src = $(img).attr('src');
        if (src) images.push(src.startsWith('http') ? src : `${BASE_URL}${src}`);
      });

      const phone = $('a[href^="tel:"]').first().text().trim() || null;
      const sellerName = $('.seller-card h4 strong').text().trim() || null;
      const sellerType = $('.seller-card .glyphicon-tags').parent().text().trim() || null;

      const features = [];
      $('div.br-2x ul.list-unstyled.row li p').each((_, p) => {
        const text = $(p).text().trim();
        if (text && text.length < 50) features.push(text);
      });

      return {
        title,
        price: detailPrice.price,
        currency: detailPrice.currency,
        negotiable: detailPrice.negotiable,
        description: description?.slice(0, 2000) || null,
        images,
        phone,
        sellerName,
        sellerType,
        features: features.length ? features : null,
        ...specs,
      };
    },
  },

  normalize(listing, detail) {
    const km = detail?.mileage ? Number(detail.mileage.replace(/[^\d]/g, '')) || null : null;
    const price = listing.price ?? detail?.price ?? null;
    const currency = listing.currency ?? detail?.currency ?? null;
    const images = detail?.images?.length ? detail.images : (listing.image ? [listing.image] : []);

    return {
      id: listing.id,
      name: detail?.title || `${listing.brand || ''} ${listing.model || ''}`.trim() || null,
      type: 'car',
      brand: listing.brand,
      model: listing.model,
      year: listing.year || (detail?.year ? Number(detail.year) : null),
      price,
      discountPrice: listing.oldPrice || null,
      currency,
      km,
      mileageRaw: detail?.mileage || null,
      fuel: detail?.fuel || listing.fuel,
      transmission: detail?.transmission || listing.transmission,
      engine: listing.engineCc ? `${listing.engineCc}cc` : null,
      bodyType: detail?.bodyType || null,
      color: detail?.color || null,
      interiorColor: null,
      condition: null,
      description: detail?.description || null,
      categories: [],
      sellerUsername: detail?.sellerName || null,
      instagramLink: null,
      thumbnail: listing.image || null,
      images,
      publishedAt: listing.date || null,
      isSponsored: listing.isSponsored || false,
      url: listing.url,
      location: listing.location,
      scrapedAt: new Date().toISOString(),
    };
  },
};
