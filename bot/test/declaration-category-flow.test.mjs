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

test('декларация показывает открытый VIN отдельно и ведёт на сайт ФТС', () => {
  assert.match(source, /async function sendDeclarationVin/);
  assert.match(source, /<b>VIN:<\\/b> <code>\\$\\{escapeHtml\\(vehicle\\.vin \\|\\| 'не найден'\\)\\}<\\/code>/);
  const vinFunction = source.slice(source.indexOf('async function sendDeclarationVin'), source.indexOf('\\nfunction peniCases'));
  assert.match(vinFunction, /telegram\\(env, 'sendMessage'/);
  assert.doesNotMatch(vinFunction, /editMessageText/);
  assert.match(source, /async function continueDeclarationAfterDocument\\(env, chatId, userId, state, vehicle, util, deadline, workingMessage = null\\)/);
  assert.match(source, /if \\(workingMessage\\?\\.from\\?\\.is_bot\\) await discardWorkingCard\\(env, workingMessage, userId\\);\\s*await sendDeclarationVin\\(env, chatId, vehicle\\);/);
  assert.match(source, /await promptDeclarationFtsName\\(env, chatId, userId, declaration\\);/);
  assert.match(source, /<b>Технически допустимая максимальная масса:<\\/b> \\$\\{Number\\.isFinite\\(maxMass\\) && maxMass > 0 \\? `\\$\\{maxMass\\.toLocaleString\\('ru-RU'\\)\\} кг` : '—'\\}/);
  assert.match(source, /<a href="https:\\/\\/customs\\.gov\\.ru\\/">ФТС<\\/a>/);
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
