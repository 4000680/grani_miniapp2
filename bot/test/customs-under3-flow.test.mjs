import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/index.js', import.meta.url), 'utf8');

test('автомобиль до 3 лет сначала выбирается по шаблону, затем вводятся объём, валюта и стоимость', () => {
  assert.match(source, /Сначала найдём автомобиль в шаблоне СЭП/);
  assert.match(source, /Введите марку, модель и год выпуска автомобиля/);
  assert.doesNotMatch(source, /Найти автомобиль/);
  assert.match(source, /🔄 Начать сначала/);
  assert.match(source, /customsKeyboard\(\[/);
  assert.match(source, /\], 'customs:start'\)/);
  assert.match(source, /stage: 'under3-selected-volume'/);
  assert.match(source, /sendCustomsCurrencyPrompt\(env, message\.chat\.id, userId, 'under3'/);
  assert.match(source, /under3: 'under3-selected-value'/);
  assert.doesNotMatch(source, /Предварительный расчёт по стоимости/);
});

test('итог до 3 лет содержит объяснение ставки, оба утильсбора и дополнительные расходы', () => {
  assert.match(source, /Таможенный платёж по единой ставке/);
  assert.match(source, /Применён минимальный платёж за объём двигателя/);
  assert.match(source, /<b>Льготный утильсбор:/);
  assert.match(source, /<b>Итого с льготным утильсбором:/);
  assert.match(source, /<i>Коммерческий утильсбор:/);
  assert.match(source, /<i>Итого с коммерческим утильсбором:/);
  assert.match(source, /<b>Коммерческий утильсбор:/);
  assert.doesNotMatch(source, /Льготный для личного пользования: <b>не применяется<\/b>/);
  assert.match(source, /услуги таможенного представителя/);
  assert.match(source, /доставка, СВХ, оформление СБКТС и ЭПТС/);
  assert.doesNotMatch(source, /• лаборатория;/);
  assert.match(source, /customs\.selectedBy === 'minimum'/);
});

test('чистый электромобиль сразу переводится в электрорасчёт без запроса объёма', () => {
  const candidateFlow = source.slice(
    source.indexOf('async function showCatalogCandidate'),
    source.indexOf('async function showCatalogModification')
  );
  assert.match(candidateFlow, /source\?\.customsMode === 'under3'/);
  assert.match(candidateFlow, /!candidate\.combustionKw && candidate\.electricKw/);
  assert.match(source, /Неправильно выбран раздел для расчёта/);
  assert.match(source, /🪫 Перейти в «Электро\/гибриды»/);
  assert.match(source, /customs:electric:route:/);
  assert.match(source, /showElectricCustomsCurrencyPrompt/);
});

test('для автомобилей старше 3 лет таможенный сбор выбирается по шести диапазонам', () => {
  assert.match(source, /const OVER3_CUSTOMS_FEE_BRACKETS = \[/);
  assert.match(source, /450 тыс\. – 1,2 млн ₽/);
  assert.match(source, /1,2 – 2,7 млн ₽/);
  assert.match(source, /2,7 – 4,2 млн ₽/);
  assert.match(source, /4,2 – 5,5 млн ₽/);
  assert.match(source, /5,5 – 10 млн ₽/);
  assert.match(source, /Свыше 10 млн ₽/);
  assert.match(source, /stage: 'over3-fee'/);
  assert.match(source, /Стоимость на пошлину не влияет/);
  assert.doesNotMatch(source, /sendCustomsCurrencyPrompt\(env, message\.chat\.id, userId, 'over3'/);
});

test('переход к расчёту утильсбора из таможенного расчёта имеет кнопку назад', () => {
  const catalogPrompt = source.slice(
    source.indexOf('async function sendCustomsCatalogPrompt'),
    source.indexOf('async function sendUnder3CatalogPrompt')
  );
  assert.match(catalogPrompt, /reply_markup: customsKeyboard\(\[], back\)/);
  assert.match(catalogPrompt, /: 'customs:over3'/);
  assert.match(catalogPrompt, /Введите марку, полную модель и год выпуска автомобиля/);
});
