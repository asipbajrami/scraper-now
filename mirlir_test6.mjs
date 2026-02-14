import { chromium } from 'playwright';
import fs from 'fs';

const browser = await chromium.launch({ headless: false });
const page = await browser.newPage();

// Load page and bypass CF
await page.goto('https://mirlir.com/shpallje/k-vetura/', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(15000);
console.log('Page 1:', await page.title());

// Extract page 1 listings
let allListings = await extractListings(page);
console.log(`Page 1: ${allListings.length} listings`);

// Try clicking a filter link to simulate real navigation (stays on same page via AJAX)
// Look for a pagination link or try clicking a filter
const hasNextPage = await page.evaluate(() => {
  // Check for pagination links
  const paginationLinks = [...document.querySelectorAll('a')].filter(a =>
    a.href && a.href.match(/k-vetura\/\d+\//) && !a.href.includes('?')
  );
  console.log('Pagination links found:', paginationLinks.length);
  return paginationLinks.map(a => a.href);
});
console.log('Pagination links:', hasNextPage.slice(0, 5));

// Try clicking the sort dropdown and re-searching to test AJAX
const sortExists = await page.evaluate(() => !!document.querySelector('#sort-dropdown'));
console.log('Sort dropdown exists:', sortExists);

if (sortExists) {
  // Change sort to trigger AJAX search - this uses the site's own jQuery AJAX
  await page.selectOption('#sort-dropdown', 'price_asc');
  await page.waitForTimeout(5000);

  const newCount = await page.evaluate(() => document.querySelectorAll('.media.listing').length);
  console.log('After sort change:', newCount, 'listings');

  if (newCount > 0) {
    const newListings = await extractListings(page);
    console.log('After sort: first listing price:', newListings[0]?.price);
  }
}

// Check all data from page 1
console.log('\nSample listing:');
console.log(JSON.stringify(allListings[0], null, 2));

fs.writeFileSync('/tmp/mirlir_listings.json', JSON.stringify(allListings, null, 2));

await browser.close();

async function extractListings(page) {
  return page.evaluate(() => {
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
      const photoCount = item.querySelector('.photo-count');
      const category = item.querySelector('.category');

      return {
        id: adId?.getAttribute('data-adid') || null,
        url: link?.getAttribute('href') || null,
        image: img?.getAttribute('src') || img?.getAttribute('data-src') || null,
        title: title?.textContent?.trim() || null,
        price: price?.textContent?.trim() || null,
        category: category?.textContent?.trim() || null,
        features,
        location: location?.textContent?.trim() || null,
        date: date?.textContent?.trim() || null,
        phone: phone?.getAttribute('data-original-title') || null,
        photoCount: photoCount?.textContent?.trim() || null,
      };
    });
  });
}
