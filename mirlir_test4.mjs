import { chromium } from 'playwright';
import fs from 'fs';

const browser = await chromium.launch({ headless: false });
const page = await browser.newPage();

// Load page and wait for CF
await page.goto('https://mirlir.com/shpallje/k-vetura/', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(12000);
console.log('Title:', await page.title());

// Count initial listings
let count = await page.evaluate(() => document.querySelectorAll('.media.listing').length);
console.log('Initial listings:', count);

// Scroll to bottom to trigger infinite loading
for (let i = 0; i < 5; i++) {
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(3000);

  const newCount = await page.evaluate(() => document.querySelectorAll('.media.listing').length);
  console.log(`After scroll ${i + 1}: ${newCount} listings`);

  if (newCount === count) {
    console.log('No new listings loaded, stopping');
    break;
  }
  count = newCount;
}

// Now navigate to page 2 using the search form submission (internal navigation)
// This uses the site's own AJAX mechanism which should work with CF cookies
try {
  const result = await page.evaluate(async () => {
    return new Promise((resolve, reject) => {
      $.ajax({
        url: '/api/v1/',
        type: 'POST',
        contentType: 'application/x-www-form-urlencoded; charset=UTF-8',
        data: { action: 'searchWithURL', url: 'shpallje/k-vetura/2/' },
        success: (e) => {
          const data = typeof e === 'string' ? JSON.parse(e) : e;
          resolve({ keys: Object.keys(data), count: data.count, resultLen: data.result?.length });
        },
        error: (e) => resolve({ error: e.status, text: e.responseText?.slice(0, 200) })
      });
    });
  });
  console.log('jQuery AJAX result:', JSON.stringify(result));
} catch (e) {
  console.log('jQuery AJAX error:', e.message);
}

// Extract all listings from current page
const listings = await page.evaluate(() => {
  return [...document.querySelectorAll('.media.listing')].map(item => {
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
      id: adId?.getAttribute('data-adid') || null,
      url: link?.getAttribute('href') || null,
      image: img?.getAttribute('src') || img?.getAttribute('data-src') || null,
      title: title?.textContent?.trim() || null,
      price: price?.textContent?.trim() || null,
      features,
      location: location?.textContent?.trim() || null,
      date: date?.textContent?.trim() || null,
      phone: phone?.getAttribute('data-original-title') || null,
    };
  });
});

console.log(`\nExtracted ${listings.length} listings`);
console.log('Sample:', JSON.stringify(listings[0], null, 2));

// Save
fs.writeFileSync('/tmp/mirlir_listings.json', JSON.stringify(listings, null, 2));
console.log('Saved to /tmp/mirlir_listings.json');

await browser.close();
