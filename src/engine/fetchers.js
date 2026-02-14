import * as cheerio from 'cheerio';

const DEFAULT_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export async function fetchJson(url, headers = {}) {
  const res = await fetch(url, {
    headers: { 'User-Agent': DEFAULT_UA, Accept: 'application/json', ...headers },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

export async function fetchHtml(url, headers = {}) {
  const res = await fetch(url, {
    headers: { 'User-Agent': DEFAULT_UA, Accept: 'text/html', ...headers },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

export async function fetchCheerio(url, headers = {}) {
  const html = await fetchHtml(url, headers);
  return cheerio.load(html);
}

export async function postFetch(url, body, headers = {}) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'User-Agent': DEFAULT_UA, ...headers },
    body,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res;
}
