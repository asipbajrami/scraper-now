import { ProxyConfiguration } from 'crawlee';

function parseCsv(input) {
  if (!input) return [];
  return input
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

const DATACENTER_PROXY_URLS = parseCsv(process.env.DATACENTER_PROXY_URLS);
const RESIDENTIAL_PROXY_URLS = parseCsv(process.env.RESIDENTIAL_PROXY_URLS);

export function getProxyUrls(proxyTier) {
  if (proxyTier === 'residential') {
    return RESIDENTIAL_PROXY_URLS;
  }
  return DATACENTER_PROXY_URLS;
}

export function getProxyConfiguration(proxyTier) {
  const urls = getProxyUrls(proxyTier);
  if (!urls.length) return undefined;
  return new ProxyConfiguration({ proxyUrls: urls });
}

export function chooseHttpProxyUrl(proxyTier, cursorState) {
  const urls = getProxyUrls(proxyTier);
  if (!urls.length) return undefined;

  const key = proxyTier === 'residential' ? 'residentialIndex' : 'datacenterIndex';
  const index = cursorState[key] % urls.length;
  cursorState[key] += 1;
  return urls[index];
}
