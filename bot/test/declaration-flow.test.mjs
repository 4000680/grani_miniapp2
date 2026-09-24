import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateDeclarationPayment, findDeclarationPrice } from '../src/declaration-flow.js';

test('перечень цен находит точное наименование из загруженного списка', () => {
  const found = findDeclarationPrice('SCANIA P320');
  assert.deepEqual(found.exact, { name: 'SCANIA P320', price: 6762444.98 });
});

test('расчёт по декларации использует только коммерческий утильсбор', () => {
  const result = calculateDeclarationPayment({
    priceRub: 1_000_000,
    vehicle: { category: 'M1', year: 2025, totalKw: 100, ccm: 2000, hybridType: 'combustion' },
    paidDutyRub: 1_000,
    paidVatRub: 2_000
  });
  assert.equal(result.duty, 150_000);
  assert.equal(result.vat, 254_877);
  assert.equal(result.util[0].amount, 800_800);
  assert.equal(result.util[0].total, 1_211_210);
});
