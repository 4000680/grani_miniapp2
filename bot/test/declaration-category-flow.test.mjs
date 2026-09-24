import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/index.js', import.meta.url), 'utf8');

test('документ передаёт распознанную категорию в расчёт по декларации', () => {
  assert.match(source, /continueDeclarationAfterDocument\(env, message\.chat\.id, userId, declarationState, vehicle, util, deadline, status\)/);
  assert.match(source, /<b>Категория:<\/b> \$\{escapeHtml\(vehicle\.categoryLabel \|\| vehicle\.category \|\| '—'\)\}/);
});

test('поиск по шаблону СЭП запрашивает группу категории до расчёта декларации', () => {
  const declarationCatalogPart = source.slice(source.indexOf("const calculation = query.data.match"), source.indexOf("if (sourceParsed?.customsMode === 'electric')"));
  assert.match(declarationCatalogPart, /category: null/);
  assert.match(declarationCatalogPart, /promptDeclarationCategory\(env, message\.chat\.id, query\.from\?\.id \|\| message\.chat\.id, \{ \.\.\.state, vehicle, categoryBack: backCallback \}, message\)/);
  assert.doesNotMatch(declarationCatalogPart, /const util = calculateUtil\(vehicle\);[\s\S]*?promptDeclarationCategory/);
  assert.match(source, /text: 'M1 \/ M1G', callback_data: 'declaration:category:passenger'/);
  assert.match(source, /text: 'N1 \/ N2', callback_data: 'declaration:category:cargo'/);
  assert.match(source, /category: 'M1', categoryLabel: 'M1 \/ M1G'/);
  assert.match(source, /category: 'N1', categoryLabel: 'N1 \/ N2'/);
});

test('декларация показывает открытый VIN отдельно после карточки и без подписи', () => {
  assert.match(source, /async function sendDeclarationVin/);
  const vinStart = source.indexOf('async function sendDeclarationVin');
  const vinEnd = source.indexOf('function peniCases', vinStart);
  const vinFunction = source.slice(vinStart, vinEnd);
  assert.ok(vinFunction.includes('const text = vehicle.vin ||'));
  assert.ok(vinFunction.includes("return telegram(env, 'sendMessage', { chat_id: chatId, text })"));
  assert.equal(vinFunction.includes('editMessageText'), false);
  const continueStart = source.indexOf('async function continueDeclarationAfterDocument');
  const continueEnd = source.indexOf('async function handleDeclarationReply', continueStart);
  const continueFunction = source.slice(continueStart, continueEnd);
  assert.ok(continueFunction.indexOf('await promptDeclarationFtsName') < continueFunction.indexOf('await sendDeclarationVin'));
  assert.ok(source.includes('<b>Технически допустимая максимальная масса:</b>'));
  assert.match(source, /<a href="https:\/\/customs\.gov\.ru\/">ФТС<\/a>/);
  assert.match(source, /Для таможенного органа наименование должно совпадать один в один/);
});

test('документ N3 после уточнения продолжается в расчёте по декларации, а не в обычном расчёте утильсбора', () => {
  assert.match(source, /const mode = declarationState\?\.mode === 'declaration' \? 'declaration' : 'util';/);
  assert.match(source, /continueDeclarationAfterDocument\(env, message\.chat\.id, userId, state, vehicle, util, deadline, message\)/);
  assert.match(source, /if \(util\.length > 1\) \{[\s\S]*?stage: 'document-age'[\s\S]*?documentAgePrompt\(vehicle\)/);
  assert.match(source, /Возраст автомобиля для расчёта определяется по месяцу выпуска\. В документе месяц не указан/);
  assert.match(source, /text: 'До 3 лет', callback_data: 'calc:age:new'/);
  assert.match(source, /text: 'Старше 3 лет', callback_data: 'calc:age:old'/);
  assert.match(source, /callback_data: backCallback/);
  assert.match(source, /callback_data: 'declaration:result:menu'/);
  assert.match(source, /if \(declarationState\?\.mode === 'declaration'\) \{[\s\S]*?continueDeclarationAfterDocument\(env, message\.chat\.id, userId, declarationState, vehicle, util, deadline, status\)/);
  assert.match(source, /if \(state\.mode === 'declaration'\) \{[\s\S]*?continueDeclarationAfterDocument\(env, message\.chat\.id, userId, state, vehicle, util, deadline, message\)/);
  assert.match(source, /<b>Коммерческий утилизационный сбор \(\$\{ageLabel\(item\.age\)\}\):<\/b>/);
  assert.match(source, /const debts = payment\.util\.map\(item => \(\{ label: ageLabel\(item\.age\), sum: item\.total \}\)\)/);
});

test('в декларационном потоке после документа нет кнопки пересчёта на 2027 год', () => {
  const start = source.indexOf("if (declarationState?.mode === 'declaration')");
  const branch = source.slice(start, source.indexOf('const cases = peniCases(util);', start));
  assert.doesNotMatch(branch, /2027|calc:year/);
});

test('возврат с уточнения возраста возвращает к предыдущему выбору типа грузовика', () => {
  assert.match(source, /reply_markup: documentAgeKeyboard\('calc:cargo:back'\)/);
  assert.match(source, /if \(query\.data === 'calc:cargo:back'\)/);
  assert.match(source, /cargoTypePrompt\(vehicle, state\.cargoCandidates, true\)/);
});

test('финальная карточка декларационного расчёта содержит кнопку назад к последнему параметру', () => {
  assert.match(source, /callback_data: 'declaration:back:paid-vat'/);
  assert.match(source, /if \(query\.data === 'declaration:back:paid-vat' && state\.stage === 'result'\)/);
  assert.match(source, /stage: 'paid-vat'/);
  assert.match(source, /text: 'Укажите уплаченный НДС по коду <b>50-10<\/b> как указано в декларации\.'/);
});

test('декларация использует утверждённые формулировки старта и платежей', () => {
  assert.match(source, /Загрузите СБКТС или выписку ЭПТС\./);
  assert.match(source, /Либо напишите марку, модель и год выпуска автомобиля — я найду его в шаблоне СЭП\./);
  assert.match(source, /Укажите уплаченную таможенную пошлину по коду <b>20-10<\/b> как указано в декларации\./);
  assert.match(source, /Теперь укажите уплаченный НДС по коду <b>50-10<\/b> как указано в декларации\./);
});
