import * as cheerio from 'cheerio';

export function extractFromHtml(url, html) {
  const $ = cheerio.load(html);
  const title = ($('title').first().text() || '').trim();
  const description =
    ($('meta[name="description"]').attr('content') || '').trim();
  const h1 = ($('h1').first().text() || '').trim();

  return {
    url,
    title,
    description,
    h1,
  };
}

export function likelyNeedsBrowser(html, extracted) {
  if (!extracted.title && !extracted.h1) return true;

  // Heuristic: common SPA/root markers with thin visible content.
  const hasSpaRoot =
    html.includes('id="__next"') ||
    html.includes('id="root"') ||
    html.includes('data-reactroot');
  const textLength = (extracted.title + extracted.h1 + extracted.description).length;

  return hasSpaRoot && textLength < 15;
}
