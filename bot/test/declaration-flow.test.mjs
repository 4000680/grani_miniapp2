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

test('акциз по декларации начисляется для категорий M1 и M1G', () => {
  const input = { priceRub: 1_000_000, paidDutyRub: 0, paidVatRub: 0 };
  const m1 = calculateDeclarationPayment({
    ...input,
    vehicle: { category: 'M1', year: 2025, totalKw: 100, ccm: 2000, hybridType: 'combustion' }
  });
  const m1g = calculateDeclarationPayment({
    ...input,
    vehicle: { category: 'm1g', year: 2025, totalKw: 100, ccm: 2000, hybridType: 'combustion' }
  });
  assert.equal(m1.excise, 8_533);
  assert.equal(m1g.excise, m1.excise);
  assert.equal(m1.vat, 254_877);
});

test('акциз по декларации не начисляется для категорий N1, N1G и N2', () => {
  for (const [category, maxMass] of [['N1', 3000], ['N1G', 3000], ['N2', 6000]]) {
    const result = calculateDeclarationPayment({
      priceRub: 1_000_000,
      vehicle: { category, year: 2025, totalKw: 100, ccm: 2000, maxMass, hybridType: 'combustion' }
    });
    assert.equal(result.excise, 0, category);
    assert.equal(result.vat, 253_000, category);
  }
});

test('N3 declaration calculates one selected commercial rate and builds penalty base from final formula total', () => {
  const result = calculateDeclarationPayment({
    priceRub: 10_000_000,
    vehicle: {
      category: 'N3', year: 2023, ageGroup: 'old', totalKw: 338,
      maxMass: 19500, cargoType: 'cargo'
    },
    paidDutyRub: 0,
    paidVatRub: 0
  });
  assert.deepEqual(result.util.map(({ age, amount, dutyDifference, vatDifference, total }) => ({
    age, amount, dutyDifference, vatDifference, total
  })), [{
    age: 'old', amount: 6069000, dutyDifference: 1500000,
    vatDifference: 2530000, total: 10099000
  }]);
});

test('declaration can recalculate commercial util at 2027 coefficients', () => {
  const vehicle = {
    category: 'N3', year: 2023, ageGroup: 'old', totalKw: 338,
    maxMass: 19500, cargoType: 'cargo'
  };
  const current = calculateDeclarationPayment({ priceRub: 10_000_000, vehicle, calculationYear: 2026 });
  const nextYear = calculateDeclarationPayment({ priceRub: 10_000_000, vehicle, calculationYear: 2027 });
  assert.equal(current.util[0].coefficient, 40.46);
  assert.equal(current.util[0].amount, 6_069_000);
  assert.equal(nextYear.util[0].coefficient, 44.51);
  assert.equal(nextYear.util[0].amount, 6_676_500);
  assert.equal(nextYear.calculationYear, 2027);
});
