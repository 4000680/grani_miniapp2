import test from 'node:test';
import assert from 'node:assert/strict';
import '../../shared/vehicle-power.js';
import { calculateUtil } from '../src/document-processing.js';

const { analyzeVehiclePower, calculateVehiclePower, classifyPowertrain } = globalThis.GraniVehiclePower;

test('applies the locked power matrix for hybrids and EVs', () => {
  assert.equal(calculateVehiclePower({ hybridType:'parallel', engineKw:70, electric30MinKw:70 }).calculatedKw, 140);
  assert.equal(calculateVehiclePower({ hybridType:'parallel-series', engineKw:80, electric30MinKw:90 }).calculatedKw, 170);
  assert.equal(calculateVehiclePower({ hybridType:'series-parallel', engineKw:60, electric30MinKw:100 }).calculatedKw, 160);
  assert.equal(calculateVehiclePower({ hybridType:'series', engineKw:70, electric30MinKw:120 }).calculatedKw, 120);
  assert.equal(calculateVehiclePower({ hybridType:'ev', electric30MinKw:150 }).calculatedKw, 150);
});

test('classifies mixed layouts before the series-only rule', () => {
  assert.equal(classifyPowertrain('гибрид параллельно-последовательного типа').hybridType, 'parallel-series');
  assert.equal(classifyPowertrain('гибрид последовательно-параллельного типа').hybridType, 'series-parallel');
  assert.equal(classifyPowertrain('комбинированная энергоустановка параллельного типа').hybridType, 'parallel');
  assert.equal(classifyPowertrain('гибрид исключительно последовательного типа').hybridType, 'series');
});

test('does not produce NaN or guess when power or layout is missing', () => {
  for (const result of [
    calculateVehiclePower({ hybridType:'parallel', electric30MinKw:70 }),
    calculateVehiclePower({ hybridType:'series', engineKw:70 }),
    calculateVehiclePower({ hybridType:'unknown-hybrid', engineKw:70, electric30MinKw:70 })
  ]) {
    assert.equal(result.calculatedKw, null);
    assert.ok(result.error);
  }
});

test('BYD SEA LION control rule resolves 70 + 70 to 140 without model hardcoding', () => {
  const result = analyzeVehiclePower('комбинированная энергоустановка параллельного типа', { engineKw:70, electric30MinKw:70 });
  assert.equal(result.hybridType, 'parallel');
  assert.equal(result.calculatedKw, 140);
});

test('a series hybrid keeps engine volume out of the electric util-rate lookup', () => {
  const vehicle = {
    category:'M1', year:2026, ccm:1498, engineKw:70, electric30MinKw:70,
    hybridType:'series', totalKw:70, calculatedKw:70
  };
  const result = calculateUtil(vehicle, new Date('2026-09-19T00:00:00Z'));
  assert.equal(result[0].personal, 991200);
});
