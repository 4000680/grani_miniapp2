import test from 'node:test';
import assert from 'node:assert/strict';
import { cargoTypeCandidates, selectUtilRate } from '../../shared/util-rate-selector.js';

test('uses the JSON directory for N1 rates in 2026 and 2027', () => {
  const base = { category: 'N1', maxMass: 3220, age: 'new' };
  const in2026 = selectUtilRate({ ...base, year: 2026 });
  const in2027 = selectUtilRate({ ...base, year: 2027 });
  assert.deepEqual(
    { coefficient: in2026.coefficient, amount: in2026.amount },
    { coefficient: 6.6, amount: 990000 }
  );
  assert.deepEqual(
    { coefficient: in2027.coefficient, amount: in2027.amount },
    { coefficient: 7.26, amount: 1089000 }
  );
});

test('does not guess the N3 subtype when several cargo rates fit', () => {
  const candidates = cargoTypeCandidates({ category: 'N3', maxMass: 13000, age: 'new', year: 2026 });
  assert.deepEqual(candidates.map(item => item.id), ['cargo', 'tractor', 'tractor-international', 'dump-truck', 'van']);
  const ambiguous = selectUtilRate({ category: 'N3', maxMass: 13000, age: 'new', year: 2026 });
  assert.equal(ambiguous.ambiguous, true);
  const tractor = selectUtilRate({ category: 'N3', vehicleType: 'tractor', maxMass: 13000, age: 'new', year: 2026 });
  assert.deepEqual({ coefficient: tractor.coefficient, amount: tractor.amount }, { coefficient: 19.83, amount: 2974500 });
});

test('selects M1 commercial and personal rows by the requested rate year', () => {
  const base = { category: 'M1', powertrain: 'combustion', ccm: 1987, powerKw: 170, age: 'new' };
  const commercial2026 = selectUtilRate({ ...base, payer: 'commercial', year: 2026 });
  const personal2026 = selectUtilRate({ ...base, payer: 'personal', year: 2026 });
  const commercial2027 = selectUtilRate({ ...base, payer: 'commercial', year: 2027 });
  assert.equal(commercial2026.amount, 1010400);
  assert.equal(personal2026.amount, 1010400);
  assert.ok(commercial2027.amount > commercial2026.amount);
});
