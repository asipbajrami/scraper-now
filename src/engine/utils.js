export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function dedup(items, getId = (item) => item.id) {
  const seen = new Set();
  return items.filter((item) => {
    const id = getId(item);
    if (id == null || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

export function resolveEnv(envConfig) {
  const { prefix, defaults } = envConfig;
  const envVal = process.env[`${prefix}_FETCH_DETAILS`];

  return {
    maxPages: Number(process.env[`${prefix}_MAX_PAGES`] || defaults.maxPages),
    delayMs: Number(process.env[`${prefix}_DELAY_MS`] || defaults.delayMs),
    detailDelayMs: Number(process.env[`${prefix}_DETAIL_DELAY_MS`] || defaults.detailDelayMs || defaults.delayMs),
    fetchDetails: envVal !== undefined ? envVal !== 'false' : defaults.fetchDetails !== false,
    outputDir: process.env[`${prefix}_OUTPUT_DIR`] || defaults.outputDir,
  };
}
