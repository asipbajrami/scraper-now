import { chromium } from 'playwright';
import fs from 'fs';

const browser = await chromium.launch({ headless: false });
const page = await browser.newPage();

// Load initial page to pass CF
await page.goto('https://mirlir.com/shpallje/k-vetura/', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(12000);
console.log('Title:', await page.title());

// Now navigate to page 2
await page.goto('https://mirlir.com/shpallje/k-vetura/2/', { waitUntil: 'domcontentloaded', timeout: 15000 });
await page.waitForTimeout(3000);
const html = await page.content();
console.log('Page 2 length:', html.length);
console.log('Title:', await page.title());

const isCf = html.includes('Attention Required') || html.includes('cf_chl');
console.log('Cloudflare:', isCf);

if (!isCf) {
  // Count listings
  const count = await page.evaluate(() => {
    return document.querySelectorAll('.media.listing').length;
  });
  console.log('Listings on page 2:', count);

  // Get a sample listing
  const sample = await page.evaluate(() => {
    const item = document.querySelector('.media.listing');
    if (!item) return null;

    const link = item.querySelector('a.link');
    const img = item.querySelector('img.media-object');
    const title = item.querySelector('.media-heading');
    const price = item.querySelector('.price strong');
    const features = [...item.querySelectorAll('.features li')].map(li => li.textContent.trim());
    const location = item.querySelector('.location');
    const date = item.querySelector('.date');
    const phone = item.querySelector('.fa-phone');
    const adId = item.querySelector('.save-ad');

    return {
      url: link?.href || null,
      image: img?.src || null,
      title: title?.textContent?.trim() || null,
      price: price?.textContent?.trim() || null,
      features,
      location: location?.textContent?.trim() || null,
      date: date?.textContent?.trim() || null,
      phone: phone?.getAttribute('data-original-title') || null,
      adId: adId?.getAttribute('data-adid') || null,
    };
  });
  console.log('Sample:', JSON.stringify(sample, null, 2));

  // Check max page from pagination
  const maxPage = await page.evaluate(() => {
    const links = [...document.querySelectorAll('a')];
    let max = 1;
    for (const a of links) {
      const match = a.href?.match(/k-vetura\/(\d+)\//);
      if (match) {
        const n = parseInt(match[1]);
        if (n > max) max = n;
      }
    }
    return max;
  });
  console.log('Max page found:', maxPage);
}

await browser.close();
