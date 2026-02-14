export async function resolveLauncher(stealthMode) {
  if (!stealthMode) {
    const { chromium } = await import('playwright');
    return { launcher: chromium, mode: 'playwright' };
  }

  try {
    const patchright = await import('patchright');
    const chromium = patchright.chromium ?? patchright.default?.chromium;
    if (chromium) {
      return { launcher: chromium, mode: 'patchright' };
    }
  } catch {
    // Fall through to Playwright if Patchright is not installed.
  }

  const { chromium } = await import('playwright');
  return { launcher: chromium, mode: 'playwright-fallback' };
}
