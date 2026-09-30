import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { calculateDeclarationPayment, findDeclarationPrice } from '../src/declaration-flow.js';
import { DECLARATION_PRICE_LIST, DECLARATION_PRICE_SOURCE } from '../src/declaration-price-list.js';

test('перечень цен находит точное наименование из загруженного списка', () => {
  const found = findDeclarationPrice('SCANIA P320');
  assert.deepEqual(found.exact, { name: 'SCANIA P320', price: 6762444.98 });
});

test('numeric model suffixes stay in their names and never become part of the price', () => {
  for (const [name, price] of [
    ['LEXUS RX 350', 5905158.97],
    ['LEXUS RX 300', 4637383.38],
    ['ABI TRAILERS KT 38', 16578123.16],
    ['AGRO MASZ PAWEL NOWAK REWO 8200', 2282896.76],
    ['945450 0000010', 4500000],
    ['ИНВОТЭК ЭНЕРДЖИ 63560000010 02', 1926983.85],
    ['СЛОНЕНОК 63560000010 02', 1902059.99]
  ]) {
    assert.deepEqual(findDeclarationPrice(name).exact, { name, price });
  }
  assert.equal(findDeclarationPrice('LEXUS RX').exact, null);
});

test('space variations resolve to the base RAV4 and preserve distinct trims', () => {
  for (const query of ['Toyota RAV4', 'Toyota RAV 4', 'TOYOTA RAV  4']) {
    assert.deepEqual(findDeclarationPrice(query).exact, { name: 'TOYOTA RAV 4', price: 2332583.53 });
  }
  assert.deepEqual(findDeclarationPrice('Toyota RAV4 PLUS').exact, { name: 'TOYOTA RAV4 PLUS', price: 2246561.75 });
  assert.deepEqual(findDeclarationPrice('Toyota RAV 4 Fashion Plus').exact, { name: 'TOYOTA RAV4 FASHION PLUS', price: 2092878 });
  assert.deepEqual(findDeclarationPrice('Lexus RX350').exact, { name: 'LEXUS RX 350', price: 5905158.97 });
});

test('space equivalence works on arbitrary names and ambiguous matches require selection', () => {
  const rows = [{ name: 'ACME AX 12', price: 123456 }, { name: 'ACME AX12 PLUS', price: 234567 }];
  assert.equal(findDeclarationPrice('Acme AX12', rows).exact.name, 'ACME AX 12');
  assert.equal(findDeclarationPrice('Acme AX 12 Plus', rows).exact.name, 'ACME AX12 PLUS');
  const ambiguous = [...rows, { name: 'ACME A X12', price: 345678 }];
  assert.equal(findDeclarationPrice('AcmeAX12', ambiguous).exact, null);
  assert.equal(findDeclarationPrice('AcmeAX12', ambiguous).closest.length, 2);
  assert.equal(findDeclarationPrice('ACME AX12', [{ name: 'ACME AX12+', price: 123 }]).exact, null);
  const duplicates = [{ name: 'ACME AX12', price: 123 }, { name: 'ACME AX12', price: 456 }];
  assert.equal(findDeclarationPrice('ACME AX12', duplicates).exact, null);
  assert.deepEqual(findDeclarationPrice('ACME AX12', duplicates).closest, duplicates);
});

test('text refinement at price-choice stays in the declaration flow and selects the base model', async () => {
  const source = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
  const start = source.indexOf('async function handleDeclarationReply(');
  const end = source.indexOf('async function handleDeclarationCallback(', start);
  assert.ok(start >= 0 && end > start);
  let state = { mode: 'declaration', stage: 'price-choice', vehicle: { category: 'M1' } };
  const sent = [];
  const context = vm.createContext({
    getCustomsState: async () => state,
    setCustomsState: async (_env, _userId, next) => { state = next; },
    findDeclarationPrice,
    telegram: async (_env, method, payload) => { sent.push({ method, payload }); return { message_id: 1 }; },
    trackTemporaryMessage: async () => {},
    escapeHtml: value => value,
    formatMoney: value => String(value),
    declarationCountryKeyboard: () => ({ inline_keyboard: [] })
  });
  vm.runInContext(source.slice(start, end), context);
  const handled = await context.handleDeclarationReply({}, { from: { id: 123 }, chat: { id: 123 }, text: 'Toyota RAV4' });
  assert.equal(handled, true);
  assert.equal(state.stage, 'country');
  assert.equal(state.priceName, 'TOYOTA RAV 4');
  assert.equal(state.priceRub, 2332583.53);
  assert.equal(sent.length, 1);
  assert.match(sent[0].payload.text, /Точное совпадение найдено/);
});

test('the rebuilt FTS list includes every numbered source row with valid prices', () => {
  assert.equal(DECLARATION_PRICE_SOURCE.pages, 158);
  assert.equal(DECLARATION_PRICE_SOURCE.rows, 8334);
  assert.equal(DECLARATION_PRICE_LIST.length, 8334);
  assert.equal(DECLARATION_PRICE_LIST.every(item => item.name && Number.isFinite(item.price) && item.price > 0), true);
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
