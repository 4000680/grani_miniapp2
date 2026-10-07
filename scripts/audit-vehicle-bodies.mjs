// Read-only audit of every distinct template brand/model; never assigns categories.
import fs from 'node:fs';
import zlib from 'node:zlib';
import { pickupBodyHint } from '../shared/vehicle-category.js';

const input = process.argv[2] || 'tabs/utilsbor/spravochnik.json.gz.b64';
const catalog = JSON.parse(zlib.inflateSync(Buffer.from(fs.readFileSync(input, 'utf8').trim(), 'base64')));
const models = new Map();
for (const row of catalog.rows) {
  const brand = catalog.brands[row[0]], model = catalog.models[row[1]], key = JSON.stringify([brand, model]);
  if (!models.has(key)) models.set(key, { brand, model, rows: 0, massMin: null, massMax: null });
  const item = models.get(key);
  item.rows++;
  if (Number(row[6]) > 0) {
    item.massMin = item.massMin == null ? Number(row[6]) : Math.min(item.massMin, Number(row[6]));
    item.massMax = item.massMax == null ? Number(row[6]) : Math.max(item.massMax, Number(row[6]));
  }
}
const pickups = [], review = [];
for (const item of models.values()) {
  const hint = pickupBodyHint(item);
  if (hint) pickups.push({ ...item, source: hint.source });
  else if (/\bPICK\s*UP\b|ПИКАП/i.test(item.model)) review.push(item);
}
console.log(JSON.stringify({
  rows: catalog.rows.length, distinctBrandModels: models.size,
  reviewedPickupModels: pickups.length, pickups,
  explicitlyNamedPickupModelsRequiringReview: review,
  note: 'Unmatched models are unclassified, not confirmed passenger cars. Body hints never assign legal categories.'
}, null, 2));
