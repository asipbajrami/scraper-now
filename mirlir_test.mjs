import { chromium } from 'playwright';
import fs from 'fs';

const browser = await chromium.launch({ headless: false });
const page = await browser.newPage();

// Intercept network requests to find APIs
const apiRequests = [];
page.on('request', req => {
  const url = req.url();
  if (url.includes('api') || url.includes('ajax') || url.includes('json') || url.includes('graphql')) {
    apiRequests.push({ url, method: req.method(), headers: req.headers() });
  }
});

page.on('response', async res => {
  const url = res.url();
  if (url.includes('api') || url.includes('ajax') || url.includes('json') || url.includes('graphql')) {
    try {
      const text = await res.text();
      console.log(`Response ${url}: ${text.slice(0, 200)}`);
    } catch {}
  }
});

await page.goto('https://mirlir.com/shpallje/k-vetura/', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(15000);
const html = await page.content();
console.log('Page length:', html.length);
console.log('Title:', await page.title());

const isCf = html.includes('cf_chl') || html.includes('Just a moment') || html.includes('Attention Required');
console.log('Still Cloudflare:', isCf);

if (isCf) {
  console.log('CF blocked, waiting more...');
  await page.waitForTimeout(10000);
  const html2 = await page.content();
  const isCf2 = html2.includes('cf_chl') || html2.includes('Just a moment') || html2.includes('Attention Required');
  console.log('Still CF after 25s:', isCf2);
  if (isCf2) {
    fs.writeFileSync('/tmp/mirlir_cf.html', html2);
    await browser.close();
    process.exit(0);
  }
}

fs.writeFileSync('/tmp/mirlir_full.html', await page.content());
console.log('Saved HTML');

console.log('API requests intercepted:', apiRequests.length);
for (const req of apiRequests.slice(0, 10)) {
  console.log(`  ${req.method} ${req.url}`);
}

// Check page structure
const data = await page.evaluate(() => {
  const listings = document.querySelectorAll('.classified-list-item, .listing-item, article, [class*="listing"], [class*="ad-item"], [class*="shpallje"]');
  const links = [...document.querySelectorAll('a[href*="/shpallje/"]')].map(a => ({
    href: a.href,
    text: a.textContent.trim().slice(0, 80)
  })).slice(0, 15);
  const scripts = [...document.querySelectorAll('script[src]')].map(s => s.src).filter(s => s.includes('mirlir')).slice(0, 10);
  return { listingCount: listings.length, links, scripts };
});

console.log('Listing elements:', data.listingCount);
console.log('Links:', JSON.stringify(data.links, null, 2));
console.log('Scripts:', data.scripts);

await browser.close();
