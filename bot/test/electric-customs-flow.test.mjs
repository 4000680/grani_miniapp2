import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { electricCustomsPowerDetails } from '../src/electric-customs-flow.js';

const workerSource = await readFile(new URL('../src/index.js', import.meta.url), 'utf8');

test('recognizes a pure electric vehicle and keeps the two calculation powers explicit', () => {
  assert.deepEqual(
    electricCustomsPowerDetails({ combustionKw: 0, electricKw: 70 }),
    {
      vehicleType: 'электромобиль',
      combustionKw: 0,
      electricKw: 70,
      excisePowerKw: 70,
      utilPowerKw: 70
    }
  );
});

test('recognizes a sequential hybrid and separates combustion and 30-minute power', () => {
  assert.deepEqual(
    electricCustomsPowerDetails({ combustionKw: 112, electricKw: 116 }),
    {
      vehicleType: 'последовательный гибрид',
      combustionKw: 112,
      electricKw: 116,
      excisePowerKw: 228,
      utilPowerKw: 116
    }
  );
});

test('electric customs flow skips the repeated type confirmation and can correct the value', () => {
  assert.doesNotMatch(workerSource, /Это электро\/последовательный гибрид/);
  assert.doesNotMatch(workerSource, /Подтвердите, что это электромобиль или последовательный гибрид/);
  assert.match(workerSource, /Указанная стоимость/);
  assert.match(workerSource, /Исправить стоимость/);
  assert.match(workerSource, /customs:electric:edit:/);
});

test('electric customs flow asks for currency before the amount', () => {
  for (const code of ['RUB', 'USD', 'EUR', 'CNY', 'KRW']) {
    assert.match(workerSource, new RegExp(`callback\\('${code}'\\)`));
  }
  assert.match(workerSource, /customs:electric:currency:/);
  assert.match(workerSource, /Бот автоматически пересчитает сумму в рубли по курсу ЦБ РФ/);
  assert.match(workerSource, /Таможенная стоимость в рублях/);
  assert.match(workerSource, /formatCbrRate\(currencyRate\)/);
  assert.match(workerSource, /catalogNavigationLine\(sourceParsed\)/);
  assert.match(workerSource, /stage: 'catalog-input', mode: 'electric'/);
});
