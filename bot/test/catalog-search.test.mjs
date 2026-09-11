import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculationPower,
  getCatalogCandidate,
  parseCatalogQuery,
  parseCatalogWeight,
  searchCatalog
} from '../src/catalog-search.js';

const catalog = {
  brands: ['KIA'],
  models: ['NIRO EV', 'NIRO HEV'],
  eco: [],
  rows: [
    [0, 0, 2022, -1, null, 70, 2170, null, null],
    [0, 1, 2022, -1, 77.2, 32, 1940, null, null],
    [0, 0, 2023, -1, null, 72, 2200, null, null],
    [0, 0, 2022, -1, null, 71, null, 2100, 2250]
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

test('uses 30-minute power for electric and the sum for an ICE/parallel hybrid', () => {
  assert.equal(calculationPower(getCatalogCandidate(catalog, 0), true), 70);
  assert.equal(calculationPower(getCatalogCandidate(catalog, 1), false), 109.2);
});
