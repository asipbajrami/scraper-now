import { chromium } from 'playwright';
import fs from 'fs';

const browser = await chromium.launch({ headless: false });
const page = await browser.newPage();

// Load initial page to establish CF session
await page.goto('https://mirlir.com/shpallje/k-vetura/', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(15000);
console.log('Page 1 title:', await page.title());

// Try navigating to page 2 with longer wait for CF
await page.goto('https://mirlir.com/shpallje/k-vetura/2/', { waitUntil: 'domcontentloaded', timeout: 30000 });

// Wait for CF challenge to resolve
for (let i = 0; i < 6; i++) {
  await page.waitForTimeout(5000);
  const title = await page.title();
  console.log(`Wait ${(i+1)*5}s - Title: ${title}`);
  if (!title.includes('Attention') && !title.includes('moment')) {
    console.log('CF passed!');
    break;
  }
}

const html = await page.content();
const isCf = html.includes('Attention Required') || html.includes('cf_chl');
console.log('Final CF check:', isCf);
console.log('HTML length:', html.length);

if (!isCf) {
  const count = await page.evaluate(() => document.querySelectorAll('.media.listing').length);
  console.log('Listings:', count);
}

await browser.close();
