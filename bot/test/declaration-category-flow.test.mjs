import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../src/index.js', import.meta.url), 'utf8');

test('документ передаёт распознанную категорию в расчёт по декларации', () => {
  assert.match(source, /continueDeclarationAfterDocument\(env, message\.chat\.id, userId, declarationState, vehicle, util, deadline, status\)/);
  assert.match(source, /<b>Категория:<\/b> \$\{escapeHtml\(vehicle\.categoryLabel \|\| vehicle\.category \|\| '—'\)\}/);
});

test('поиск по шаблону СЭП запрашивает группу категории до расчёта декларации', () => {
  const declarationCatalogPart = source.slice(source.indexOf("const categoryChoice = query.data.match"), source.indexOf("if (sourceParsed?.customsMode === 'electric')"));
  assert.match(declarationCatalogPart, /category: declarationFlow \? null : 'M1'/);
  assert.match(declarationCatalogPart, /categoryBack: `catalog:back:variants:\$\{candidate\.rowIndex\}`/);
  assert.doesNotMatch(declarationCatalogPart, /const util = calculateUtil\(vehicle\);[\s\S]*?promptDeclarationCategory/);
  assert.match(source, /text: 'M1 \/ M1G', callback_data: 'declaration:category:passenger'/);
  assert.match(source, /callback_data: `declaration:category:\$\{cargo\}`/);
  assert.match(source, /category: 'M1', categoryLabel: 'M1 \/ M1G'/);
  assert.match(source, /category: cargo, categoryLabel: cargo/);
});

test('декларация показывает открытый VIN отдельно после карточки и без подписи', async () => {
  assert.match(source, /async function sendDeclarationVin/);
  const vinStart = source.indexOf('async function sendDeclarationVin');
  const vinEnd = source.indexOf('function peniCases', vinStart);
  const vinFunction = source.slice(vinStart, vinEnd);
  assert.ok(vinFunction.includes('const text = vehicle.vin ||'));
  // Verify the observable VIN message rather than its previous return syntax.
  const calls = [], sent = { message_id: 51 };
  const context = vm.createContext({ telegram: async (_env, method, data) => { calls.push({ method, data }); return sent; } });
  vm.runInContext(vinFunction, context);
  const keyboard = { inline_keyboard: [[{ text: 'Confirm', callback_data: 'declaration:fts:confirm' }]] };
  const result = await context.sendDeclarationVin({}, 200, { vin: 'X7TEST00000000001', surname: 'Synthetic' }, keyboard);
  assert.equal(result, sent);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'sendMessage');
  assert.equal(calls[0].data.text, 'X7TEST00000000001');
  assert.equal(calls[0].data.reply_markup, keyboard);
  assert.equal(calls[0].data.parse_mode, undefined);
  assert.equal(vinFunction.includes('editMessageText'), false);
  const continueStart = source.indexOf('async function continueDeclarationAfterDocument');
  const continueEnd = source.indexOf('async function handleDeclarationReply', continueStart);
  const continueFunction = source.slice(continueStart, continueEnd);
  assert.ok(continueFunction.includes('await promptDeclarationFtsName'));
  const promptStart = source.indexOf('async function promptDeclarationFtsName');
  const promptFunction = source.slice(promptStart, continueStart);
  assert.ok(promptFunction.indexOf("await telegram(env, 'sendMessage'") < promptFunction.indexOf('await sendDeclarationVin'));
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

test('в финале расчёта по декларации можно пересчитать утиль по ставкам 2027 года', () => {
  assert.match(source, /callback_data: 'declaration:result:year:2027'/);
  assert.match(source, /if \(query\.data === 'declaration:result:year:2027' && state\?\.mode === 'declaration' && state\.stage === 'result'\)/);
  assert.match(source, /formatUtilYearReference\(payment\.util, 2027, true\)/);
  assert.match(source, /declarationYearReferenceKeyboard\(\)/);
  assert.match(source, /callback_data: 'declaration:result:year:back'/);
  assert.match(source, /if \(query\.data === 'declaration:result:year:back' && state\?\.mode === 'declaration' && state\.stage === 'result'\)/);
});

test('перерасчёт утиля из результата СБКТС берёт данные из постоянного контекста', () => {
  assert.match(source, /await saveUtilYearContext\(env, userId, vehicle, deadline\);/);
  assert.match(source, /const yearContext = customsState\?\.utilYearContext \|\| flow\?\.utilYearContext/);
  assert.match(source, /const util = calculateUtil\(vehicle, todayUtc\(\), 2027\)/);
  assert.match(source, /formatUtilYearReference\(util, 2027\)/);
  assert.match(source, /if \(state\?\.utilYearContext\)[\s\S]*?mode: 'util', stage: 'result', utilYearContext: state\.utilYearContext/);
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
