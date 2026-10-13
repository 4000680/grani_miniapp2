import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { listCatalogModifications, listCatalogSuggestions, parseCatalogQuery, resolveCatalogBrand, selectCatalogBrandQuery } from '../src/catalog-search.js';

const encoded = fs.readFileSync(new URL('../../tabs/utilsbor/spravochnik.json.gz.b64', import.meta.url), 'utf8').trim();
const catalog = JSON.parse(zlib.inflateSync(Buffer.from(encoded, 'base64')).toString('utf8'));

function matches(query) {
  const parsed = parseCatalogQuery(query);
  const exact = listCatalogModifications(catalog, parsed);
  return exact.length ? exact : listCatalogSuggestions(catalog, parsed, 8);
}

test('compound brand conjunctions do not swallow the model number', () => {
  for (const query of ['Lynk & Co 900 2026', 'LYNK AND CO 900 2026', 'Lynk Co 900 2026', 'Lynk-Co 900 2026', 'LynkCo 900 2026', '900 Lynk & Co 2026']) {
    const exact = listCatalogModifications(catalog, parseCatalogQuery(query));
    assert.equal(exact.length, 1, query);
    assert.equal(exact[0].brand, 'LYNK AND CO', query);
    assert.equal(exact[0].model, '900', query);
    assert.equal(exact[0].year, 2026, query);
    assert.ok(exact[0].rowIndexes.length > 0);
  }
});

test('the live SEP template stores the EXEED control vehicle as STERRA ET', () => {
  const rows = matches('EXEED STERRA ET 2026');
  assert.equal(rows[0].brand, 'EXEED');
  assert.equal(rows[0].model, 'STERRA ET');
  assert.equal(rows[0].year, 2026);
});

test('the live template resolves EXLANTIX input through general token ranking', () => {
  for (const query of [
    'EXEED EXLANTIX ET 2026',
    'Exeed explantix et 1.5t ssr 2026',
    'Эксид Экслантикс ET 2026'
  ]) {
    const rows = matches(query);
    assert.equal(rows[0].brand, 'EXEED', query);
    assert.equal(rows[0].model, 'STERRA ET', query);
  }
  assert.ok(matches('Exeed 2026').some(item => item.model === 'STERRA ET'));
});

test('the live template search remains universal across unrelated brands', () => {
  const cases = [
    ['Volvo V90 CROS COUNTRY 2026', 'VOLVO', 'V90 CROSS COUNTRY'],
    ['Toyota LAND CRUSIER 2026', 'TOYOTA', 'LAND CRUISER'],
    ['Lexus LM500 2026 extra', 'LEXUS', 'LM500H'],
    ['AUDI AVANT A5 2026', 'AUDI', 'A5 AVANT'],
    ['HYUNDAI PALISAED 2026', 'HYUNDAI', 'PALISADE'],
    ['Jetta Volkswagen 2022', 'VOLKSWAGEN', 'JETTA']
  ];
  for (const [query, brand, model] of cases) {
    const first = matches(query)[0];
    assert.equal(first.brand.toUpperCase(), brand, query);
    assert.equal(first.model.toUpperCase(), model, query);
  }
});

test('the live template finds GEELY STARSHIP without building the full catalog index', () => {
  const started = performance.now();
  const rows = matches('geely starship 7 2026');
  const elapsed = performance.now() - started;
  assert.equal(rows[0].brand, 'GEELY');
  assert.equal(rows[0].model, 'GALAXY STARSHIP 7 EM-I');
  assert.equal(rows[0].year, 2026);
  assert.ok(elapsed < 500, `cold search took ${elapsed.toFixed(1)} ms`);
});

test('misspelled compound brands retain the model instead of offering MINI', () => {
  for (const query of ['Linc co 900 2026', 'Link co 900 2026', 'Lynk co 900 2026']) {
    const parsed=parseCatalogQuery(query);
    const resolution=resolveCatalogBrand(catalog,parsed);
    assert.ok(resolution.candidates.some(item=>item.brand==='LYNK AND CO'),query);
    assert.ok(!resolution.candidates.some(item=>item.brand==='MINI'),query);
    const selected=resolution.candidates.find(item=>item.brand==='LYNK AND CO');
    const restored=selectCatalogBrandQuery(catalog,{...parsed,customsMode:'under3'},selected.brandIndex);
    assert.equal(restored.year,2026);
    assert.equal(restored.customsMode,'under3');
    assert.deepEqual(listCatalogModifications(catalog,restored).map(item=>item.model),['900']);
  }
  assert.equal(resolveCatalogBrand(catalog,parseCatalogQuery('Linc co 900 2026')).status,'ambiguous');
  assert.equal(selectCatalogBrandQuery(catalog,parseCatalogQuery('Linc co 900 2026'),-1),null);
  assert.equal(matches('Lincoln 900 2026').length,0);
});

test('joined model numbers and exact full modifications outrank generic drive tokens', () => {
  for (const query of ['Mercedes-Benz Gle450 4matic 2026','Mercedes-Benz GLE 450 4MATIC 2026','4matic GLE450 Mercedes-Benz 2026']) {
    const rows=listCatalogModifications(catalog,parseCatalogQuery(query));
    assert.deepEqual(rows.map(item=>item.model),['GLE 450 4MATIC'],query);
  }
  const incomplete=listCatalogModifications(catalog,parseCatalogQuery('Mercedes-Benz GLE450 2026'));
  assert.ok(incomplete.length>1 && incomplete.length<=25);
  assert.ok(incomplete.every(item=>item.brand==='Mercedes-Benz' && /GLE 450/.test(item.model)));
  assert.equal(matches('Mercedes-Benz GLE999 4matic 2026').length,0);
});

test('joined-number normalization is generic across brands', () => {
  for (const [query,brand,model] of [
    ['BMW X5 xDrive30d 2026','BMW','X5 XDRIVE30D'],
    ['Lexus LM500 2026 extra','LEXUS','LM500H'],
    ['AUDI A5 AVANT 2026','AUDI','A5 AVANT'],
    ['Toyota LAND CRUSIER 2026','TOYOTA','LAND CRUISER'],
    ['HYUNDAI PALISAED 2026','HYUNDAI','PALISADE'],
    ['Мерседес GLE450 4matic 2026','MERCEDES-BENZ','GLE 450 4MATIC']
  ]) {
    const first=matches(query)[0];
    assert.equal(first?.brand.toUpperCase(),brand,query);
    assert.equal(first?.model.toUpperCase(),model,query);
  }
});
