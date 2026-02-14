import fs from 'node:fs/promises';
import path from 'node:path';

export async function writeOutput(outputDir, results) {
  await fs.mkdir(outputDir, { recursive: true });

  const ndjsonPath = path.join(outputDir, 'cars.ndjson');
  const ndjson = results.map((r) => JSON.stringify(r)).join('\n');
  await fs.writeFile(ndjsonPath, `${ndjson}\n`, 'utf8');

  const jsonPath = path.join(outputDir, 'cars.json');
  await fs.writeFile(jsonPath, JSON.stringify(results, null, 2), 'utf8');
}
