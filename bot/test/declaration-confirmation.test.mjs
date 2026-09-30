import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { findDeclarationPrice } from '../src/declaration-flow.js';

const source = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
const vehicle = { brand: 'ACME', model: 'AX12', vin: 'TESTVIN12345678901', year: 2026, category: 'M1', totalKw: 100, maxMass: 2000 };

function harness(rows, initial = { mode: 'declaration', stage: 'fts-name', vehicle }) {
  let state = initial;
  const messages = [];
  const context = vm.createContext({
    getCustomsState: async () => state,
    setCustomsState: async (_env, _userId, next) => { state = next; },
    findDeclarationPrice: name => findDeclarationPrice(name, rows),
    telegram: async (_env, method, payload) => {
      messages.push({ method, ...payload });
      return { message_id: messages.length };
    },
    trackTemporaryMessage: async () => {},
    escapeHtml: value => value,
    formatMoney: value => String(value),
    formatPower: value => `${value} кВт`,
    ageLabel: () => 'до 3 лет'
  });
  vm.runInContext(source.slice(source.indexOf('function declarationKeyboard('), source.indexOf('async function sendCalculationStart(')), context);
  vm.runInContext(source.slice(source.indexOf('async function sendDeclarationVin('), source.indexOf('function peniCases(')), context);
  const confirm = () => context.handleDeclarationCallback({}, {
    data: 'declaration:fts:confirm', from: { id: 123 },
    message: { chat: { id: 123 }, message_id: 1 }
  });
  return { context, messages, confirm, state: () => state };
}

test('manual confirmation reuses lookup and continues with a unique price for any model', async () => {
  const h = harness([{ name: 'ACME AX 12', price: 1234567 }, { name: 'ACME AX12 PLUS', price: 2345678 }]);
  await h.confirm();
  assert.equal(h.state().stage, 'country');
  assert.equal(h.state().priceName, 'ACME AX 12');
  assert.equal(h.state().priceRub, 1234567);
  assert.equal(h.state().ftsNameSource, 'document');
  assert.match(h.messages[0].text, /Выберите страну/);
  await h.confirm();
  assert.equal(h.messages.length, 1, 'a repeated click after advancing must not restart the flow');
});

test('manual confirmation never chooses an ambiguous or merely similar price automatically', async () => {
  for (const rows of [
    [{ name: 'ACME AX12', price: 123 }, { name: 'ACME AX12', price: 456 }],
    [{ name: 'ACME AX12 PLUS', price: 789 }],
    []
  ]) {
    const h = harness(rows);
    await h.confirm();
    assert.equal(h.state().stage, 'price-choice');
    assert.equal(h.state().priceRub, undefined);
    assert.equal(h.state().ftsNameSource, 'document');
    assert.ok(h.messages[0].reply_markup.inline_keyboard.flat().some(button => button.text === '← Назад'));
  }
});

test('document card shows the matched source price and VIN stays last and copyable with navigation', async () => {
  const h = harness([{ name: 'ACME AX 12', price: 1234567 }]);
  await h.context.continueDeclarationAfterDocument({}, 123, 123, {}, vehicle, [{ age: 'new', commercial: 800800 }], null);
  assert.equal(h.messages.length, 2);
  assert.match(h.messages[0].text, /Наименование в перечне/);
  assert.match(h.messages[0].text, /ACME AX 12/);
  assert.match(h.messages[0].text, /1234567/);
  assert.match(h.messages[0].text, /не выполняет автоматическую проверку/);
  assert.match(h.messages[0].text, /Если сведений пока нет/);
  assert.equal(h.messages[1].text, vehicle.vin);
  for (const message of h.messages) {
    const buttons = message.reply_markup.inline_keyboard.flat();
    assert.ok(buttons.some(button => button.callback_data === 'declaration:fts:confirm'));
    assert.ok(buttons.some(button => button.text === '← Назад'));
    assert.ok(buttons.some(button => button.callback_data === 'calc:menu'));
  }
});

test('confirmation is ignored outside the declaration name step', async () => {
  for (const initial of [
    { mode: 'util', stage: 'fts-name', vehicle },
    { mode: 'declaration', stage: 'paid-duty', vehicle },
    { mode: 'declaration', stage: 'fts-name' }
  ]) {
    const h = harness([{ name: 'ACME AX12', price: 123 }], initial);
    await h.confirm();
    assert.equal(h.messages.length, 0);
    assert.equal(h.state(), initial);
  }
});

test('typing an FTS name after confirmation variants restores the typed-name source', async () => {
  const h = harness([{ name: 'ACME AX12 PLUS', price: 789 }]);
  await h.confirm();
  await h.context.handleDeclarationReply({}, { chat: { id: 123 }, from: { id: 123 }, text: 'ACME AX12 PLUS' });
  assert.equal(h.state().stage, 'country');
  assert.equal(h.state().ftsNameSource, 'fts');
  assert.equal(h.state().priceRub, 789);
});
