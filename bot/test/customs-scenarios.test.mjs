import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateElectricCustoms,
  calculatePassengerOver3,
  calculatePassengerUnder3,
  calculatePickup
} from '../src/customs-calculation.js';
import { calculateUtil } from '../src/document-processing.js';

const EURO = 97.7626;
const NOW = new Date('2026-09-14T00:00:00Z');

function selectedUtil(year, totalKw, ccm) {
  const result = calculateUtil({ category: 'M1', year, totalKw, ccm }, NOW)[0];
  return result.personal !== result.commercial ? result.personal : result.commercial;
}

test('два полных расчёта автомобилей до 3 лет', () => {
  const firstCustoms = calculatePassengerUnder3({ customsValueRub: 2500000, engineCc: 1998, euroRate: EURO }).duty;
  assert.equal(firstCustoms + selectedUtil(2025, 110, 1998), 1203400);

  const secondCustoms = calculatePassengerUnder3({ customsValueRub: 1000000, engineCc: 1500, euroRate: EURO }).duty;
  assert.equal(secondCustoms + selectedUtil(2024, 150, 1500), 1466054);
});

test('два полных расчёта автомобилей старше 3 лет', () => {
  const firstCustoms = calculatePassengerOver3({ ageGroup: '3-5', engineCc: 1500, euroRate: EURO }).duty;
  assert.equal(firstCustoms + selectedUtil(2022, 100, 1500), 254495);

  const secondCustoms = calculatePassengerOver3({ ageGroup: '5+', engineCc: 2998, euroRate: EURO }).duty;
  assert.equal(secondCustoms + selectedUtil(2018, 200, 2998), 5125461);
});

test('два полных расчёта электро и последовательного гибрида', () => {
  const electric = calculateElectricCustoms({ customsValueRub: 3000000, excisePowerKw: 70 });
  assert.equal(electric.customsTotal + selectedUtil(2025, 70, null), 2207487);

  const series = calculateElectricCustoms({ customsValueRub: 4000000, excisePowerKw: 100 + 80 });
  assert.equal(series.customsTotal + selectedUtil(2022, 80, null), 3818771);
});

test('два полных расчёта пикапов', () => {
  assert.equal(calculatePickup({
    customsValueRub: 5000000, fuel: 'petrol', ageGroup: '0-3', engineCc: 3500, maxMassKg: 3000, euroRate: EURO
  }).total, 2852500);

  assert.equal(calculatePickup({
    customsValueRub: 2000000, fuel: 'diesel', ageGroup: '7+', engineCc: 2755, maxMassKg: 2800, euroRate: EURO
  }).total, 2210090);
});
