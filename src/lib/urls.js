import fs from 'node:fs/promises';

export async function loadUrls(inputPath) {
  const raw = await fs.readFile(inputPath, 'utf8');
  const urls = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));

  const unique = [...new Set(urls)];
  return unique;
}
