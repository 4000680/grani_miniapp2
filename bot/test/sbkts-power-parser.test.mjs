import test from 'node:test';
import assert from 'node:assert/strict';
import '../../shared/sbkts-power-parser.js';
import '../../shared/vehicle-power.js';

const { parseSbktsPowerData } = globalThis.GraniSbktsPower;
const { analyzeVehiclePower, calculateVehiclePower } = globalThis.GraniVehiclePower;

function calculate(text) {
  const parsed = parseSbktsPowerData(text);
  const calculated = analyzeVehiclePower(text, {
    engineKw: parsed.engineMaxKw,
    electric30MinKw: parsed.electric30MinKwTotal
  });
  return {
    ...calculated,
    ...parsed
  };
}

test('A: BYD parallel layout resolves 70 + 70 to 140', () => {
  const result = calculate([
    'Описание гибридного транспортного средства комбинированная энергоустановка параллельного типа.',
    'Двигатель внутреннего сгорания (марка, тип) TEST',
    '- максимальная мощность, кВт 70 (6000)',
    '(мин-1)',
    'Электромашина (марка, тип) TEST',
    'Максимальная 30-минутная 70',
    'мощность, кВт'
  ].join('\n'));
  assert.equal(result.engineMaxKw, 70);
  assert.deepEqual(result.electric30MinKw, [70]);
  assert.equal(result.electric30MinKwTotal, 70);
  assert.equal(result.hybridType, 'parallel');
  assert.equal(result.calculatedKw, 140);
});

test('B: ZEEKR page-boundary layout keeps all three electric motors', () => {
  const result = calculate([
    'Описание гибридного транспортного средства комбинированная энергоустановка параллельного типа.',
    'Параллельно-последовательный привод.',
    'Двигатель внутреннего сгорания (марка, тип) TEST',
    '- максимальная мощность, кВт 202 (5500)',
    'Электромашина (марка, тип) MOTOR 1',
    'MOTOR 2',
    'MOTOR 3',
    '\fСтр. 3',
    'Максимальная 30-минутная 130.5',
    'мощность, кВт',
    '166.5',
    '166.5'
  ].join('\n'));
  assert.equal(result.engineMaxKw, 202);
  assert.deepEqual(result.electric30MinKw, [130.5, 166.5, 166.5]);
  assert.equal(result.electric30MinKwTotal, 463.5);
  assert.equal(result.hybridType, 'parallel-series');
  assert.equal(result.calculatedKw, 665.5);
});

test('C-D: one and multiple 30-minute values are valid', () => {
  assert.deepEqual(parseSbktsPowerData('Максимальная 30-минутная\nмощность, кВт\n70').electric30MinKw, [70]);
  const multiple = parseSbktsPowerData('Максимальная 30-минутная мощность, кВт 50\n40');
  assert.deepEqual(multiple.electric30MinKw, [50, 40]);
  assert.equal(multiple.electric30MinKwTotal, 90);
});

test('E: equal powers of different motors are not deduplicated', () => {
  const result = parseSbktsPowerData('Максимальная 30-минутная 130.5\nмощность, кВт\n166.5\n166.5');
  assert.deepEqual(result.electric30MinKw, [130.5, 166.5, 166.5]);
  assert.equal(result.electric30MinKwTotal, 463.5);
});

test('F-H: integer, decimal point and decimal comma are normalized', () => {
  assert.deepEqual(parseSbktsPowerData('Максимальная 30-минутная мощность, кВт 70').electric30MinKw, [70]);
  assert.deepEqual(parseSbktsPowerData('Максимальная 30-минутная мощность, кВт 130.5').electric30MinKw, [130.5]);
  assert.deepEqual(parseSbktsPowerData('Максимальная 30-минутная мощность, кВт 130,5').electric30MinKw, [130.5]);
});

test('I: RPM is never used as engine power', () => {
  const result = parseSbktsPowerData([
    'Двигатель внутреннего сгорания (марка, тип) TEST',
    '- максимальная мощность, кВт',
    '(мин-1)',
    '70 (6000)',
    'Электромашина (марка, тип) TEST'
  ].join('\n'));
  assert.equal(result.engineMaxKw, 70);
  assert.notEqual(result.engineMaxKw, 6000);
});

test('J: electric maximum and 30-minute power remain separate', () => {
  const result = parseSbktsPowerData([
    'Электромашина (марка, тип) TEST',
    'Максимальная мощность, кВт 150',
    'Максимальная 30-минутная мощность, кВт 65',
    'Подвеска (тип)'
  ].join('\n'));
  assert.deepEqual(result.electricMaxKw, [150]);
  assert.deepEqual(result.electric30MinKw, [65]);
  assert.equal(result.electric30MinKwTotal, 65);
});

test('K: series-only hybrid ignores engine power with two motors', () => {
  const result = calculateVehiclePower({ engineKw: 75, electric30MinKw: 90, hybridType: 'series' });
  assert.equal(result.calculatedKw, 90);
});

test('L: EV calculation uses only total 30-minute power', () => {
  const parsed = parseSbktsPowerData([
    'Электромашина (марка, тип) TEST 1, TEST 2',
    'Максимальная мощность, кВт 200',
    '180',
    'Максимальная 30-минутная мощность, кВт 70',
    '60'
  ].join('\n'));
  assert.deepEqual(parsed.electricMaxKw, [200, 180]);
  assert.deepEqual(parsed.electric30MinKw, [70, 60]);
  assert.equal(calculateVehiclePower({ electric30MinKw: parsed.electric30MinKwTotal, hybridType: 'ev' }).calculatedKw, 130);
});

test('M-N: page boundaries and line-broken labels do not stop extraction', () => {
  const result = parseSbktsPowerData([
    'Электромашина (марка, тип) TEST',
    '\fСвидетельство о безопасности Стр. 3',
    'Максимальная 30-минутная',
    'мощность, кВт',
    '70'
  ].join('\n'));
  assert.deepEqual(result.electric30MinKw, [70]);
  assert.equal(result.electric30MinKwTotal, 70);
});

test('missing power values never produce NaN or an invented formula', () => {
  const parsed = parseSbktsPowerData('комбинированная энергоустановка параллельного типа');
  const result = analyzeVehiclePower('комбинированная энергоустановка параллельного типа', {
    engineKw: parsed.engineMaxKw,
    electric30MinKw: parsed.electric30MinKwTotal
  });
  assert.equal(result.calculatedKw, null);
  assert.equal(Number.isNaN(result.calculatedKw), false);
  assert.equal(result.errorCode, 'ENGINE_POWER_NOT_DETECTED');
});
