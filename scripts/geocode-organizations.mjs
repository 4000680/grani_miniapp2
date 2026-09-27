import { readFile, writeFile } from 'node:fs/promises';

const catalogPath = new URL('../bot/src/organizations-catalog.json', import.meta.url);
const outputPath = new URL('../bot/src/organizations-geo.json', import.meta.url);
const endpoint = process.env.GEOCODER_URL || 'https://nominatim.openstreetmap.org/search';
const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
let saved = { version: 5, source: 'OpenStreetMap Nominatim', organizations: [] };
try { saved = JSON.parse(await readFile(outputPath, 'utf8')); } catch {}
const forceRefresh = process.argv.includes('--refresh');
const byId = new Map((saved.organizations || []).map(item => [item.id, item]));
const responseCache = new Map();
let lastRequestAt = 0;

function normalizeBrokenWords(value) {
  return String(value || '')
    .replace(/([\p{L}]{5,})\s+(кий|ский|ской|ская|ское|вский|вская|вское|дский|еновский|кого|авта|ика|ва|нбург|бург|град|ирск|инск|сток|абад|льск|ний|ния|ный|ная|ное|ного|ского|льный|льная|льное|ье|ые|ая|ый|кая|ина|кое|го|ев|орная|ьтный|вски|ой|ортщиков)(?=[\s,.-]|$)/giu, '$1$2')
    .replace(/([\p{L}]{3,})-\s+([\p{L}]{2,})/gu, '$1-$2')
    .replace(/([\p{L}]{3,})\s+и\s+(?=(?:микрорайон|мкр\.?|ул\.?|улица|район)(?![\p{L}\p{N}]))/giu, '$1и ')
    .replace(/([\p{L}]{5,})\s+([а-яё])(?=\s+(?:ул\.?|улица|проезд|пр-д|пер\.?|переулок|ш\.?|шоссе|наб\.?|набережная|мкр\.?|микрорайон|район|р-н))/giu, '$1$2')
    .replace(/([\p{L}]{4,})\s+([\p{L}]{1,3})(?=\s+(?:область|край|республика|район|ул\.?|улица|проспект|проезд|р-н)|[,;])/giu, '$1$2')
    .replace(/([\p{L}]{5,})\s+([а-яё])(?=\s+(?:область|край|республика|город|г\.|ул\.?|улица|проспект|пр-кт|проезд|район|р-н)|[,;])/giu, '$1$2');
}

function extractCity(address) {
  const match = normalizeBrokenWords(address).match(/(?:^|[,;]\s*)(?:г\.о\.\s*(?:город\s*)?|город\s*|г\.?\s*|поселок\s*|посёлок\s*|пгт\.?\s*|село\s*|с\.\s*|хутор\s*|х\.\s*)([^,;]+)/iu);
  return match?.[1]?.replace(/^город\s+/iu, '').split(/\s+(?=(?:мкр\.?|микрорайон|р-н|район|ул\.?|улица|проезд|пр-д|пер\.?|переулок|ш\.?|шоссе|наб\.?|набережная|кв-л|тер(?![\p{L}\p{N}])))/iu)[0].replace(/\s+/g, ' ').trim() || '';
}

function makeQueries(address) {
  const clean = normalizeBrokenWords(address).replace(/\s+/g, ' ').trim();
  const city = extractCity(clean);
  const queries = [];
  const postcode = clean.match(/(?<!\d)(\d{6})(?!\d)/)?.[1];
  const streetSegments = clean.split(',').map(segment => segment.trim());
  const streetIndex = streetSegments.findIndex(segment => /(?<![\p{L}\p{N}])(?:ул(?:ица)?\.?|проспект|пр-кт|проезд|пр-д|пер(?:еулок)?\.?|ш(?:оссе)?\.?|набережная|наб\.?|бульвар|б-р|площадь|пл\.?)(?![\p{L}\p{N}])/iu.test(segment));
  if (streetIndex >= 0 && city) {
    const tail = streetSegments.slice(streetIndex).join(', ');
    const house = tail.match(/(?<![\p{L}\p{N}])(?:д\.?\s*|дом\s*)(\d+[а-яё]?(?:\/\d+[а-яё]?)?(?:\s*[кс]\.?\s*\d+[а-яё]?)?)/iu)?.[1];
    if (house) {
      const rawStreet = streetSegments[streetIndex];
      const type = rawStreet.match(/(?<![\p{L}\p{N}])(?:улица|ул\.?|проспект|пр-кт|проезд|пр-д|переулок|пер\.?|шоссе|ш\.?|набережная|наб\.?|бульвар|б-р|площадь|пл\.?)(?![\p{L}\p{N}])/iu)?.[0] || '';
      const streetName = rawStreet.replace(/(?<![\p{L}\p{N}])(?:улица|ул\.?|проспект|пр-кт|проезд|пр-д|переулок|пер\.?|шоссе|ш\.?|набережная|наб\.?|бульвар|б-р|площадь|пл\.?)(?![\p{L}\p{N}])/giu, '').replace(/\s+/g, ' ').trim();
      const typeName = /^(?:ул|улица)$/iu.test(type) ? 'улица' : /^(?:пр-кт|проспект)$/iu.test(type) ? 'проспект' : /^(?:пр-д|проезд)$/iu.test(type) ? 'проезд' : /^(?:пер|переулок)$/iu.test(type) ? 'переулок' : /^(?:ш|шоссе)$/iu.test(type) ? 'шоссе' : /^(?:наб|набережная)$/iu.test(type) ? 'набережная' : /^(?:б-р|бульвар)$/iu.test(type) ? 'бульвар' : /^(?:пл|площадь)$/iu.test(type) ? 'площадь' : '';
      const street = [streetName, typeName].filter(Boolean).join(' ');
      queries.push({ query: `${street}, ${house}, ${city}, Россия`, level: 'street' });
    }
  }
  queries.push({ query: `${clean}, Россия`, level: 'full' });
  if (city) queries.push({ query: `${city}, Россия`, level: 'city' });
  if (postcode) queries.push({ query: `${postcode}, Россия`, level: 'postcode' });
  return queries.filter((entry, index) => entry.query.length > 4 && queries.findIndex(candidate => candidate.query === entry.query) === index);
}

async function geocode(query) {
  const key = query.toLocaleLowerCase('ru-RU');
  if (responseCache.has(key)) return responseCache.get(key);
  const wait = Math.max(0, 1100 - (Date.now() - lastRequestAt));
  if (wait) await new Promise(resolve => setTimeout(resolve, wait));
  lastRequestAt = Date.now();
  const url = new URL(endpoint);
  url.search = new URLSearchParams({
    q: query,
    format: 'jsonv2',
    limit: '1',
    addressdetails: '1',
    countrycodes: 'ru',
    'accept-language': 'ru'
  });
  const response = await fetch(url, {
    headers: { 'User-Agent': 'BrokerGraniOrganizationCatalog/1.0 (+https://t.me/grani_broker)' }
  });
  if (!response.ok) throw new Error(`Geocoder returned HTTP ${response.status}`);
  const results = await response.json();
  const result = Array.isArray(results) ? results[0] : null;
  responseCache.set(key, result || null);
  return result || null;
}

function normalized(value) {
  return String(value || '').toLocaleLowerCase('ru-RU').replace(/ё/g, 'е').replace(/[^a-zа-я0-9]/g, '');
}

const laboratories = catalog.organizations.filter(item => item.authorities?.eptsSbkts && item.address && item.address !== '-');
for (const [index, item] of laboratories.entries()) {
  const old = byId.get(item.id);
  if (!forceRefresh && old?.address === item.address && Number.isFinite(old.lat) && Number.isFinite(old.lon)) {
    if (old.precision === 'place' && old.geocodedQuery === 'МОСКВА, Россия') byId.delete(item.id);
    else continue;
  }
  let best = null;
  const city = extractCity(item.address);
  const queries = makeQueries(item.address);
  for (const [queryIndex, entry] of queries.entries()) {
    const match = await geocode(entry.query);
    if (!match || !Number.isFinite(Number(match.lat)) || !Number.isFinite(Number(match.lon))) continue;
    if (entry.level === 'postcode' && match.address?.postcode !== entry.query.split(',')[0]) continue;
    if (city && entry.level !== 'postcode' && !normalized(match.display_name).includes(normalized(city))) continue;
    const hasHouse = Boolean(match.address?.house_number);
    const hasStreet = Boolean(match.address?.road);
    if (entry.level === 'city' && !['city', 'town', 'village', 'municipality', 'suburb', 'hamlet'].includes(match.addresstype)) continue;
    if (entry.level === 'full' && !hasStreet) continue;
    if (entry.level === 'postcode' && !match.address?.postcode) continue;
    if (entry.level === 'street') {
      const expectedStreet = normalized(entry.query.split(',')[0]);
      if (expectedStreet && !normalized(match.address.road).includes(expectedStreet.replace(/(ул|улица|проспект|проезд|пер|шоссе|наб|бульвар|площадь)$/u, ''))) continue;
    }
    best = {
      id: item.id,
      address: item.address,
      lat: Number(match.lat),
      lon: Number(match.lon),
      precision: entry.level === 'city' ? 'place' : entry.level === 'postcode' ? 'postcode' : hasHouse ? 'address' : 'street',
      displayName: match.display_name || '',
      geocodedQuery: entry.query,
      queryIndex
    };
    if (entry.level === 'street' && (hasHouse || hasStreet)) break;
    if (entry.level === 'full' && hasHouse) break;
    if (entry.level === 'city' && !hasStreet) break;
  }
  if (!best) console.log(`Не найдены координаты ${item.id}; город=${city || '—'}; запросы=${queries.map(entry => `${entry.level}:${entry.query}`).join(' | ')}`);
  if (best) byId.set(item.id, best);
  else byId.delete(item.id);
  if ((index + 1) % 5 === 0 || index === laboratories.length - 1) {
    saved = {
      version: 5,
      source: 'OpenStreetMap Nominatim',
      attribution: '© OpenStreetMap contributors',
      organizations: [...byId.values()].sort((a, b) => a.id.localeCompare(b.id))
    };
    await writeFile(outputPath, JSON.stringify(saved) + '\n');
    console.log(`${index + 1}/${laboratories.length}: координаты ${byId.size}`);
  }
}
