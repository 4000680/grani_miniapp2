import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateCustomsProcessingFee,
  calculateElectricCustoms,
  calculatePassengerOver3,
  calculatePassengerUnder3,
  calculatePickup,
  calculatePickupUtil,
  convertCurrencyToRub,
  parseCbrCurrencyRate,
  parseCbrEuroRate,
  parseCurrencyAmount,
  parsePositiveNumber
} from '../src/customs-calculation.js';

const EURO = 97.7626;

test('таможенный сбор за операции использует шкалу 2026 года', () => {
  assert.equal(calculateCustomsProcessingFee(1200000), 4924);
  assert.equal(calculateCustomsProcessingFee(1200000.01), 13541);
  assert.equal(calculateCustomsProcessingFee(5500000), 21344);
  assert.equal(calculateCustomsProcessingFee(5500000.01), 49240);
  assert.equal(calculateCustomsProcessingFee(10000000.01), 73860);
});

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

test('пикапы N2 используют ставки утильсбора для диапазонов 5–8 и 8–12 тонн', () => {
  const fiveToEight = calculatePickup({
    customsValueRub: 3000000,
    fuel: 'petrol',
    ageGroup: '0-3',
    engineCc: 3000,
    maxMassKg: 6000,
    euroRate: EURO
  });
  assert.deepEqual(
    { category: fiveToEight.category, utilCoefficient: fiveToEight.utilCoefficient, util: fiveToEight.util },
    { category: 'N2', utilCoefficient: 7.20, util: 1080000 }
  );

  const eightToTwelve = calculatePickup({
    customsValueRub: 3000000,
    fuel: 'diesel',
    ageGroup: '7+',
    engineCc: 3000,
    maxMassKg: 9000,
    euroRate: EURO
  });
  assert.deepEqual(
    { category: eightToTwelve.category, utilCoefficient: eightToTwelve.utilCoefficient, util: eightToTwelve.util },
    { category: 'N2', utilCoefficient: 27.81, util: 4171500 }
  );
  assert.throws(
    () => calculatePickup({
      customsValueRub: 3000000, fuel: 'petrol', ageGroup: '0-3', engineCc: 3000, maxMassKg: 12001, euroRate: EURO
    }),
    /до 12 тонн/
  );
});

test('утильсбор пикапа можно рассчитать по документу без таможенной стоимости', () => {
  assert.deepEqual(calculatePickupUtil({ maxMassKg: 3220, age: 'new' }), {
    maxMassKg: 3220, age: 'new', utilCoefficient: 6.6, util: 990000
  });
});

test('денежные суммы принимаются с пробелами, запятой и сокращениями', () => {
  assert.equal(parsePositiveNumber('2 500 000'), 2500000);
  assert.equal(parsePositiveNumber('97,7626'), 97.7626);
  assert.equal(parsePositiveNumber('30 000 USD'), 30000);
  assert.equal(parsePositiveNumber('50 000 000 ₩'), 50000000);
  assert.equal(parsePositiveNumber('ошибка'), null);
  assert.equal(parseCurrencyAmount('8 млн'), 8000000);
  assert.equal(parseCurrencyAmount('8m'), 8000000);
  assert.equal(parseCurrencyAmount('500 тыс.'), 500000);
  assert.equal(parseCurrencyAmount('800 000'), 800000);
  assert.equal(parseCurrencyAmount('8 mln RUB'), 8000000);
  assert.equal(parseCurrencyAmount('ошибка'), null);
});

test('курс евро читается из официального XML ЦБ', () => {
  const xml = '<ValCurs><Valute ID="R01239"><CharCode>EUR</CharCode><Nominal>1</Nominal><Value>97,7626</Value></Valute></ValCurs>';
  assert.equal(parseCbrEuroRate(xml), 97.7626);
});

test('курсы ЦБ учитывают номинал валюты, включая 1000 корейских вон', () => {
  const xml = [
    '<ValCurs Date="17.09.2026">',
    '<Valute><CharCode>USD</CharCode><Nominal>1</Nominal><Value>84,1732</Value></Valute>',
    '<Valute><CharCode>KRW</CharCode><Nominal>1000</Nominal><Value>62,1985</Value></Valute>',
    '</ValCurs>'
  ].join('');
  assert.deepEqual(parseCbrCurrencyRate(xml, 'KRW'), {
    code: 'KRW', nominal: 1000, value: 62.1985, unitRate: 0.0621985, date: '17.09.2026'
  });
  assert.equal(convertCurrencyToRub(30000, parseCbrCurrencyRate(xml, 'USD')), 2525196);
  assert.equal(convertCurrencyToRub(50000000, parseCbrCurrencyRate(xml, 'KRW')), 3109925);
});
