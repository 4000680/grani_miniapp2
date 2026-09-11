const DEFAULT_CATALOG_URL = 'https://4000680.github.io/grani_miniapp2/tabs/utilsbor/spravochnik.json.gz.b64';

const BRAND_ALIASES = {
  'КИА': 'KIA', 'БМВ': 'BMW', 'МЕРСЕДЕС': 'MERCEDES-BENZ', 'АУДИ': 'AUDI',
  'ТОЙОТА': 'TOYOTA', 'ХОНДА': 'HONDA', 'НИССАН': 'NISSAN', 'МАЗДА': 'MAZDA',
  'ХЕНДАЙ': 'HYUNDAI', 'ХЮНДАЙ': 'HYUNDAI', 'ФОЛЬКСВАГЕН': 'VOLKSWAGEN',
  'ШКОДА': 'SKODA', 'РЕНО': 'RENAULT', 'ФОРД': 'FORD', 'ЛЕКСУС': 'LEXUS',
  'ВОЛЬВО': 'VOLVO', 'ПОРШЕ': 'PORSCHE', 'ДЖИЛИ': 'GEELY', 'ЧЕРИ': 'CHERY',
  'ХАВАЛ': 'HAVAL', 'ХАВЕЙЛ': 'HAVAL', 'БАЙДИ': 'BYD', 'ЗИКР': 'ZEEKR'
};

let catalogPromise = null;
let catalogLoadedAt = 0;

export function normalizeCatalogText(value) {
  return String(value || '')
    .toUpperCase()
    .replace(/Ё/g, 'Е')
    .replace(/[^A-ZА-Я0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseCatalogQuery(text) {
  const source = String(text || '').trim();
  const years = [...source.matchAll(/\b((?:19|20)\d{2})\b/g)];
  if (years.length !== 1) return null;
  const year = Number(years[0][1]);
  const vehicleText = normalizeCatalogText(source.replace(years[0][0], ''));
  if (!vehicleText) return null;
  const words = vehicleText.split(' ').filter(word => !['ГОД', 'ГОДА', 'Г', 'YEAR'].includes(word));
  if (words.length < 2) return null;
  if (BRAND_ALIASES[words[0]]) words[0] = BRAND_ALIASES[words[0]];
  return { year, vehicleText: words.join(' '), tokens: words };
}

function base64Bytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function inflateJson(base64) {
  const stream = new Blob([base64Bytes(base64.trim())]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Response(stream).json();
}

export async function loadCatalog(url = DEFAULT_CATALOG_URL) {
  const fresh = catalogPromise && Date.now() - catalogLoadedAt < 60 * 60 * 1000;
  if (fresh) return catalogPromise;
  catalogLoadedAt = Date.now();
  catalogPromise = fetch(url, {
    headers: { accept: 'text/plain' },
    cf: { cacheTtl: 3600, cacheEverything: true }
  }).then(async response => {
    if (!response.ok) throw new Error(`справочник недоступен (HTTP ${response.status})`);
    const parsed = await inflateJson(await response.text());
    if (!Array.isArray(parsed?.brands) || !Array.isArray(parsed?.models) || !Array.isArray(parsed?.rows)) {
      throw new Error('неверный формат справочника');
    }
    return parsed;
  }).catch(error => {
    catalogPromise = null;
    catalogLoadedAt = 0;
    throw error;
  });
  return catalogPromise;
}

function candidateFromRow(catalog, row, rowIndex) {
  return {
    rowIndex,
    brand: catalog.brands[row[0]] || '',
    model: catalog.models[row[1]] || '',
    year: Number(row[2]),
    eco: row[3] >= 0 ? catalog.eco?.[row[3]] || '' : '',
    combustionKw: Number(row[4]) || 0,
    electricKw: Number(row[5]) || 0,
    mass: Number(row[6]) || null,
    massFrom: Number(row[7]) || null,
    massTo: Number(row[8]) || null
  };
}

export function getCatalogCandidate(catalog, rowIndex) {
  const row = catalog.rows[Number(rowIndex)];
  if (!row) return null;
  return candidateFromRow(catalog, row, Number(rowIndex));
}

export function searchCatalog(catalog, parsedQuery, weight = null, limit = 8) {
  if (!parsedQuery) return [];
  const query = normalizeCatalogText(parsedQuery.vehicleText);
  const tokens = query.split(' ').filter(Boolean);
  const namedRows = [];

  for (let rowIndex = 0; rowIndex < catalog.rows.length; rowIndex++) {
    const row = catalog.rows[rowIndex];
    if (Number(row[2]) !== parsedQuery.year) continue;
    const brand = normalizeCatalogText(catalog.brands[row[0]]);
    const model = normalizeCatalogText(catalog.models[row[1]]);
    const combined = `${brand} ${model}`.trim();
    const combinedTokens = new Set(combined.split(' ').filter(Boolean));
    if (!tokens.every(token => combinedTokens.has(token))) continue;
    namedRows.push({ row, rowIndex, brand, model, combined });
  }

  let selectedRows = namedRows;
  if (weight !== null && weight !== undefined) {
    const value = Number(weight);
    const exact = namedRows.filter(item => Number(item.row[6]) && Math.abs(Number(item.row[6]) - value) < 1);
    const inRange = namedRows.filter(item => {
      const from = Number(item.row[7]);
      const to = Number(item.row[8]);
      return from && to && value >= from && value <= to;
    });
    selectedRows = exact.length ? exact : inRange;
  }

  const matches = [];
  const seen = new Set();
  for (const item of selectedRows) {
    const { row, rowIndex, brand, combined } = item;
    const key = [row[0], row[1], row[2], Number(row[4]) || 0, Number(row[5]) || 0].join(':');
    if (seen.has(key)) continue;
    seen.add(key);

    let score = 0;
    if (combined === query) score += 1000;
    if (combined.startsWith(query)) score += 500;
    if (brand === tokens[0]) score += 200;
    score -= Math.abs(combined.length - query.length);
    matches.push({ ...candidateFromRow(catalog, row, rowIndex), score });
  }

  return matches
    .sort((left, right) => right.score - left.score || left.model.localeCompare(right.model, 'ru'))
    .slice(0, limit);
}

export function parseCatalogWeight(value) {
  const normalized = String(value || '').replace(/\s+/g, '');
  const match = normalized.match(/\d{3,5}/);
  if (!match) return null;
  const weight = Number(match[0]);
  return weight >= 500 && weight <= 10000 ? weight : null;
}

export function calculationPower(candidate, electric) {
  if (electric) {
    if (!candidate.electricKw) throw new Error('В справочнике не указана 30-минутная мощность для электрорасчёта');
    return Math.round(candidate.electricKw * 100) / 100;
  }
  const total = candidate.combustionKw + candidate.electricKw;
  if (!total) throw new Error('В справочнике не указана мощность автомобиля');
  return Math.round(total * 100) / 100;
}
