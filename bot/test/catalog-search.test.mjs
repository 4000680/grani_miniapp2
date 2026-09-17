import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculationPower,
  getCatalogCandidate,
  getCatalogVariants,
  listCatalogModifications,
  paginateCatalogModifications,
  paginateCatalogVariants,
  parseCatalogQuery,
  parseCatalogWeight,
  searchCatalog
} from '../src/catalog-search.js';

const catalog = {
  brands: ['KIA', 'BMW'],
  models: ['NIRO EV', 'NIRO HEV', 'X5 XDRIVE30D', 'X5 XDRIVE40D'],
  eco: [],
  rows: [
    [0, 0, 2022, -1, null, 70, 2170, null, null],
    [0, 1, 2022, -1, 77.2, 32, 1940, null, null],
    [0, 0, 2023, -1, null, 72, 2200, null, null],
    [0, 0, 2022, -1, null, 71, null, 2100, 2250],
    [1, 2, 2026, -1, 210, 9, 2950, 2891, 3009],
    [1, 2, 2026, -1, 210, 2.2, 2755, 2699.9, 2810.1],
    [1, 3, 2026, -1, 250, 9, 2985, 2925.3, 3044.7]
  ]
};

test('parses a brand, model and one year from free text', () => {
  assert.deepEqual(parseCatalogQuery('Kia Niro EV, 2022 год'), {
    year: 2022,
    vehicleText: 'KIA NIRO EV',
    tokens: ['KIA', 'NIRO', 'EV']
  });
  assert.equal(parseCatalogQuery('Kia 2022'), null);
});

test('finds the exact vehicle and year in the compact catalog', () => {
  const found = searchCatalog(catalog, parseCatalogQuery('Kia Niro EV 2022'), 2170);
  assert.equal(found.length, 1);
  assert.equal(found[0].model, 'NIRO EV');
  assert.equal(found[0].electricKw, 70);
  assert.equal(getCatalogCandidate(catalog, found[0].rowIndex).mass, 2170);
});

test('uses an exact mass before a matching mass range', () => {
  const query = parseCatalogQuery('Kia Niro EV 2022');
  const exact = searchCatalog(catalog, query, 2170);
  assert.equal(exact.length, 1);
  assert.equal(exact[0].electricKw, 70);

  const ranged = searchCatalog(catalog, query, 2200);
  assert.equal(ranged.length, 1);
  assert.equal(ranged[0].electricKw, 71);
  assert.equal(ranged[0].massFrom, 2100);
  assert.equal(ranged[0].massTo, 2250);
});

test('recognizes mass written with or without spaces', () => {
  assert.equal(parseCatalogWeight('2170 кг'), 2170);
  assert.equal(parseCatalogWeight('2 170'), 2170);
  assert.equal(parseCatalogWeight('масса неизвестна'), null);
});

test('groups a broad model query into modifications', () => {
  const modifications = listCatalogModifications(catalog, parseCatalogQuery('BMW X5 2026'));
  assert.deepEqual(modifications.map(item => item.model), ['X5 XDRIVE30D', 'X5 XDRIVE40D']);
});

test('matches a modification written with spaces when the catalog stores it together', () => {
  const modifications = listCatalogModifications(catalog, parseCatalogQuery('BMW X5 xDrive 30d 2026'));
  assert.equal(modifications.length, 1);
  assert.equal(modifications[0].model, 'X5 XDRIVE30D');
  const variants = getCatalogVariants(catalog, modifications[0].brandIndex, modifications[0].modelIndex, 2026);
  assert.equal(variants.length, 2);
  assert.deepEqual(variants.map(item => item.mass), [2755, 2950]);
});

test('uses 30-minute power for electric and the sum for an ICE/parallel hybrid', () => {
  assert.equal(calculationPower(getCatalogCandidate(catalog, 0), true), 70);
  assert.equal(calculationPower(getCatalogCandidate(catalog, 1), false), 109.2);
});

test('paginates ready power and mass variants instead of requesting mass manually', () => {
  const variants = Array.from({ length: 19 }, (_, index) => ({ rowIndex: index, mass: 1500 + index }));
  variants.push({ rowIndex: 99, mass: null });

  const first = paginateCatalogVariants(variants, 0);
  const last = paginateCatalogVariants(variants, 99);

  assert.equal(first.items.length, 8);
  assert.equal(first.total, 19);
  assert.equal(first.pageCount, 3);
  assert.equal(last.currentPage, 2);
  assert.deepEqual(last.items.map(item => item.rowIndex), [16, 17, 18]);
});

test('paginates up to 25 catalog modifications for button selection', () => {
  const modifications = Array.from({ length: 21 }, (_, index) => ({ model: `COOPER ${index + 1}` }));
  const first = paginateCatalogModifications(modifications, 0);
  const last = paginateCatalogModifications(modifications, 99);

  assert.equal(first.items.length, 8);
  assert.equal(first.pageCount, 3);
  assert.equal(last.currentPage, 2);
  assert.deepEqual(last.items.map(item => item.model), ['COOPER 17', 'COOPER 18', 'COOPER 19', 'COOPER 20', 'COOPER 21']);
});
