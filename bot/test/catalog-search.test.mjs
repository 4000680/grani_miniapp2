import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculationPower,
  getCatalogCandidate,
  parseCatalogQuery,
  searchCatalog
} from '../src/catalog-search.js';

const catalog = {
  brands: ['KIA'],
  models: ['NIRO EV', 'NIRO HEV'],
  eco: [],
  rows: [
    [0, 0, 2022, -1, null, 70, 2170, null, null],
    [0, 1, 2022, -1, 77.2, 32, 1940, null, null],
    [0, 0, 2023, -1, null, 72, 2200, null, null]
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
  const found = searchCatalog(catalog, parseCatalogQuery('Kia Niro EV 2022'));
  assert.equal(found.length, 1);
  assert.equal(found[0].model, 'NIRO EV');
  assert.equal(found[0].electricKw, 70);
  assert.equal(getCatalogCandidate(catalog, found[0].rowIndex).mass, 2170);
});

test('uses 30-minute power for electric and the sum for an ICE/parallel hybrid', () => {
  assert.equal(calculationPower(getCatalogCandidate(catalog, 0), true), 70);
  assert.equal(calculationPower(getCatalogCandidate(catalog, 1), false), 109.2);
});
