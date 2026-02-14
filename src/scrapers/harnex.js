import 'dotenv/config';

import fs from 'node:fs/promises';
import path from 'node:path';
import { log } from 'crawlee';

const API_BASE = 'https://api.harnex.io/api';
const IMAGE_BASE = 'https://harnex.s3.eu-central-1.amazonaws.com/vehicles/';
const DETAIL_DELAY_MS = Number(process.env.HARNEX_DETAIL_DELAY_MS || 400);
const FETCH_DETAILS = process.env.HARNEX_FETCH_DETAILS !== 'false';
const OUTPUT_DIR = process.env.HARNEX_OUTPUT_DIR || 'output/harnex';

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  Accept: 'application/json',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const ENGINE_TYPES = {
  1: 'Diesel',
  2: 'Petrol',
  3: 'Benzine+Gas',
  4: 'Hybrid Diesel',
  5: 'Electric',
  6: 'LPG',
};

const TRANSMISSION_TYPES = {
  1: 'Manual',
  2: 'Automatic',
  3: 'Semi-Automatic',
};

// ---------------------------------------------------------------------------
// Step 1 – Fetch all vehicles from the listing API
// ---------------------------------------------------------------------------

async function fetchAllVehicles() {
  const url = `${API_BASE}/unauth/vehicles`;
  const res = await fetch(url, { headers: HEADERS });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }

  const data = await res.json();
  if (!data.success || !Array.isArray(data.vehicles)) {
    throw new Error('Unexpected response format');
  }

  return data.vehicles;
}

// ---------------------------------------------------------------------------
// Step 2 – Fetch vehicle detail for extra fields
// ---------------------------------------------------------------------------

async function fetchVehicleDetail(id) {
  const url = `${API_BASE}/unauth/vehicles/${id}`;
  const res = await fetch(url, { headers: HEADERS });

  if (!res.ok) return null;

  const data = await res.json();
  if (!data.success || !data.vehicle) return null;

  return data.vehicle;
}

// ---------------------------------------------------------------------------
// Step 3 – Normalize vehicle data
// ---------------------------------------------------------------------------

function normalizeCar(raw, detail) {
  const v = detail || raw;

  return {
    id: v.id,
    brand: v.Vehicle_Manufacturer?.name || null,
    model: v.Vehicle_Model?.name || null,
    year: v.year || null,
    price: v.Vehicle_Price?.[0]?.total ? Number(v.Vehicle_Price[0].total) : null,
    currency: 'EUR',
    km: v.current_km || null,
    fuel: ENGINE_TYPES[v.engine_type] || null,
    transmission: TRANSMISSION_TYPES[v.transmission_type] || null,
    horsepower: v.horsepower || null,
    kw: v.kw || null,
    cubicCapacity: v.cubic_capacity || null,
    doors: v.doors || null,
    seats: v.seats || null,
    color: v.Vehicle_Color?.name || null,
    interiorColor: v.interiorColor?.name || null,
    shape: v.Vehicle_Shape?.name || null,
    condition: v.Vehicle_Condition?.name || null,
    country: v.Vehicle_Location?.name || null,
    city: v.City?.name || null,
    emissionClass: v.emission_class || null,
    weight: v.weight || null,
    nrOfGears: v.nr_of_gears || null,
    nrOfCylinders: v.nr_of_cylinders || null,
    urbanConsumption: v.urban_consumption || null,
    interurbanConsumption: v.interurban_consumption || null,
    swapPossible: v.swap_possible ?? null,
    isAvailable: v.is_available ?? null,
    options: v.Vehicle_Options?.length ? v.Vehicle_Options.map((o) => o.name || o) : null,
    manufactureCountry: v.Vehicle_Manufacture_Country?.name || null,
    company: v.Company?.name || null,
    url: `https://www.harnex.io/vehicles/${v.id}`,
    images: (v.Vehicle_Images || []).map((img) => `${IMAGE_BASE}${img.image}`),
    createdAt: v.createdAt || null,
    scrapedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  log.info('Starting Harnex scraper...');

  // Step 1: Fetch all vehicles (single request, no pagination)
  const vehicles = await fetchAllVehicles();
  log.info(`Fetched ${vehicles.length} vehicles from listing API.`);

  // Step 2: Optionally fetch details for extra fields
  const results = [];

  if (FETCH_DETAILS) {
    log.info(`Fetching details for ${vehicles.length} vehicles...`);

    for (let i = 0; i < vehicles.length; i++) {
      const v = vehicles[i];
      const label = `${v.Vehicle_Manufacturer?.name || '?'} ${v.Vehicle_Model?.name || '?'}`;

      try {
        log.info(`  [${i + 1}/${vehicles.length}] ${label}`);
        const detail = await fetchVehicleDetail(v.id);
        results.push(normalizeCar(v, detail));
      } catch (err) {
        log.warning(`  Failed detail ${v.id}: ${err.message}`);
        results.push(normalizeCar(v, null));
      }

      if (i < vehicles.length - 1) {
        await sleep(DETAIL_DELAY_MS);
      }
    }
  } else {
    for (const v of vehicles) {
      results.push(normalizeCar(v, null));
    }
  }

  log.info(`Total normalized: ${results.length}`);

  // Write output
  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  const ndjsonPath = path.join(OUTPUT_DIR, 'cars.ndjson');
  const ndjson = results.map((r) => JSON.stringify(r)).join('\n');
  await fs.writeFile(ndjsonPath, `${ndjson}\n`, 'utf8');

  const jsonPath = path.join(OUTPUT_DIR, 'cars.json');
  await fs.writeFile(jsonPath, JSON.stringify(results, null, 2), 'utf8');

  const summary = {
    total: results.length,
    outputDir: OUTPUT_DIR,
  };

  log.info(`Done: ${JSON.stringify(summary)}`);
}

main().catch((err) => {
  log.error(String(err));
  process.exit(1);
});
