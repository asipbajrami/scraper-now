import { chromium } from 'playwright';
import fs from 'fs';

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext();
const page = await context.newPage();

// Pass CF on initial load
await page.goto('https://mirlir.com/shpallje/k-vetura/', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(15000);
console.log('Title:', await page.title());

// Get cookies after CF pass
const cookies = await context.cookies();
const cfCookies = cookies.filter(c => c.name.startsWith('cf_') || c.name.startsWith('__cf'));
console.log('CF cookies:', cfCookies.map(c => `${c.name}=${c.value.slice(0,20)}...`));

// Try using page.request API (carries browser cookies)
try {
  const response = await page.request.get('https://mirlir.com/shpallje/k-vetura/2/');
  console.log('Page 2 status:', response.status());
  if (response.ok()) {
    const html = await response.text();
    console.log('Page 2 HTML length:', html.length);
    const isCf = html.includes('Attention Required');
    console.log('Is CF:', isCf);
    if (!isCf) {
      fs.writeFileSync('/tmp/mirlir_p2.html', html);
      console.log('Saved page 2');
    }
  }
} catch (e) {
  console.log('Error:', e.message);
}

// Alternative: Try XMLHttpRequest from page context
try {
  const apiResult = await page.evaluate(async () => {
    return new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/v1/', true);
      xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
      xhr.onload = () => resolve({ status: xhr.status, text: xhr.responseText.slice(0, 500) });
      xhr.onerror = () => resolve({ error: 'failed' });
      xhr.send('action=searchWithURL&url=shpallje/k-vetura/2/');
    });
  });
  console.log('XHR result:', JSON.stringify(apiResult));
} catch (e) {
  console.log('XHR error:', e.message);
}

await browser.close();
