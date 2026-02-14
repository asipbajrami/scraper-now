const DEFAULT_PROFILE = {
  tier: 'http',
  proxyTier: 'datacenter',
  browserFallback: true,
  stealthFallback: true,
};

// Add domain-specific overrides here.
// Key can be an exact host or suffix (e.g. "example.com" covers "www.example.com").
const DOMAIN_PROFILES = {
  // 'example.com': { tier: 'browser', proxyTier: 'datacenter' },
  // 'hard-target.com': { tier: 'stealth', proxyTier: 'residential' },
};

function isSameOrSubdomain(hostname, suffix) {
  return hostname === suffix || hostname.endsWith(`.${suffix}`);
}

export function getDomainProfile(url) {
  const { hostname } = new URL(url);
  const matches = Object.keys(DOMAIN_PROFILES).filter((candidate) =>
    isSameOrSubdomain(hostname, candidate),
  );

  if (matches.length === 0) {
    return { ...DEFAULT_PROFILE };
  }

  // Most specific profile wins.
  matches.sort((a, b) => b.length - a.length);
  return { ...DEFAULT_PROFILE, ...DOMAIN_PROFILES[matches[0]] };
}

export function explainTier(url) {
  const profile = getDomainProfile(url);
  return {
    url,
    tier: profile.tier,
    proxyTier: profile.proxyTier,
  };
}
