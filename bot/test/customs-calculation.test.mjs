import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateElectricCustoms,
  calculatePassengerOver3,
  calculatePassengerUnder3,
  calculatePickup,
  parseCbrEuroRate,
  parsePositiveNumber
} from '../src/customs-calculation.js';

const EURO = 97.7626;

test('автомобиль до 3 лет: выбирается минимальная ставка за см³', () => {
  const result = calculatePassengerUnder3({ customsValueRub: 120000, engineCc: 1500, euroRate: EURO });
  assert.equal(result.percent, 54);
  assert.equal(result.percentageAmount, 64800);
  assert.equal(result.minimumAmount, 366610);
  assert.equal(result.duty, 366610);
  assert.equal(result.selectedBy, 'minimum');
});

test('автомобиль до 3 лет: выбирается процент от стоимости', () => {
  const result = calculatePassengerUnder3({ customsValueRub: 2500000, engineCc: 1998, euroRate: EURO });
  assert.equal(result.percent, 48);
  assert.equal(result.percentageAmount, 1200000);
  assert.equal(result.minimumAmount, 1074313);
  assert.equal(result.duty, 1200000);
  assert.equal(result.selectedBy, 'percent');
});

test('автомобили 3–5 и старше 5 лет используют разные ставки', () => {
  assert.equal(calculatePassengerOver3({ ageGroup: '3-5', engineCc: 1500, euroRate: EURO }).duty, 249295);
  assert.equal(calculatePassengerOver3({ ageGroup: '5+', engineCc: 1998, euroRate: EURO }).duty, 937582);
});

test('электромобиль: пошлина, акциз и НДС складываются правильно', () => {
  const first = calculateElectricCustoms({ customsValueRub: 3000000, excisePowerKw: 100 });
  assert.deepEqual(
    { duty: first.duty, excise: first.excise, vat: first.vat, total: first.customsTotal },
    { duty: 450000, excise: 8533, vat: 760877, total: 1219411 }
  );
  const second = calculateElectricCustoms({ customsValueRub: 5000000, excisePowerKw: 160 });
  assert.deepEqual(
    { duty: second.duty, excise: second.excise, vat: second.vat, total: second.customsTotal },
    { duty: 750000, excise: 214187, vat: 1312121, total: 2276308 }
  );
});

test('последовательный гибрид: акциз использует сумму ДВС и электромотора', () => {
  const result = calculateElectricCustoms({ customsValueRub: 4000000, excisePowerKw: 170 + 80 });
  assert.equal(result.excisePowerKw, 250);
  assert.equal(result.excisePerHp, 1711);
  assert.equal(result.excise, 570333);
});

test('пикап: бензин до 3 лет и дизель старше 7 лет', () => {
  const petrol = calculatePickup({
    customsValueRub: 5000000,
    fuel: 'petrol',
    ageGroup: '0-3',
    engineCc: 3500,
    maxMassKg: 3000,
    euroRate: EURO
  });
  assert.deepEqual(
    { duty: petrol.duty, vat: petrol.vat, util: petrol.util, total: petrol.total },
    { duty: 625000, vat: 1237500, util: 990000, total: 2852500 }
  );

  const diesel = calculatePickup({
    customsValueRub: 2000000,
    fuel: 'diesel',
    ageGroup: '7+',
    engineCc: 2755,
    maxMassKg: 2800,
    euroRate: EURO
  });
  assert.deepEqual(
    { duty: diesel.duty, vat: diesel.vat, util: diesel.util, total: diesel.total },
    { duty: 269336, vat: 499254, util: 1441500, total: 2210090 }
  );
});

test('денежные суммы принимаются с пробелами и запятой', () => {
  assert.equal(parsePositiveNumber('2 500 000'), 2500000);
  assert.equal(parsePositiveNumber('97,7626'), 97.7626);
  assert.equal(parsePositiveNumber('ошибка'), null);
});

test('курс евро читается из официального XML ЦБ', () => {
  const xml = '<ValCurs><Valute ID="R01239"><CharCode>EUR</CharCode><Nominal>1</Nominal><Value>97,7626</Value></Valute></ValCurs>';
  assert.equal(parseCbrEuroRate(xml), 97.7626);
});
