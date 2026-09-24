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
  assert.match(source, /<b>VIN:<\/b> <code>\$\{escapeHtml\(vehicle\.vin \|\| 'не найден'\)\}<\/code>/);
  assert.match(source, /async function continueDeclarationAfterDocument\(env, chatId, userId, state, vehicle, util, deadline, workingMessage = null\)/);
  assert.match(source, /await sendDeclarationVin\(env, chatId, vehicle, workingMessage\);/);
  assert.match(source, /await promptDeclarationFtsName\(env, chatId, userId, declaration\);/);
  assert.match(source, /<a href="https:\/\/customs\.gov\.ru\/">ФТС<\/a>/);
  assert.match(source, /Для таможенного органа наименование должно совпадать один в один/);
});

test('документ N3 после уточнения продолжается в расчёте по декларации, а не в обычном расчёте утильсбора', () => {
  assert.match(source, /const mode = declarationState\?\.mode === 'declaration' \? 'declaration' : 'util';/);
  assert.match(source, /continueDeclarationAfterDocument\(env, message\.chat\.id, userId, state, vehicle, util, deadline, message\)/);
  assert.match(source, /const ageChoice = query\.data\.match\(\/\^calc:age:\(new\|old\)\$\//);
  assert.match(source, /if \(state\.mode === 'declaration'\) \{[\s\S]*?continueDeclarationAfterDocument\(env, message\.chat\.id, userId, state, vehicle, util, deadline, message\)/);
  assert.match(source, /<b>Коммерческий утилизационный сбор \(\$\{ageLabel\(item\.age\)\}\):<\/b>/);
  assert.match(source, /const debts = payment\.util\.map\(item => \(\{ label: ageLabel\(item\.age\), sum: item\.total \}\)\)/);
});

test('возрастной выбор и уточнение типа грузового авто имеют кнопки назад и главное меню', () => {
  assert.match(source, /function documentAgeKeyboard\(mode\)/);
  assert.match(source, /callback_data: back/);
  assert.match(source, /callback_data: menu/);
  assert.match(source, /mode === 'declaration' \? 'declaration:back:start' : 'calc:back:document'/);
});

test('декларация использует утверждённые формулировки старта и платежей', () => {
  assert.match(source, /Загрузите СБКТС или выписку ЭПТС\./);
  assert.match(source, /Либо напишите марку, модель и год выпуска автомобиля — я найду его в шаблоне СЭП\./);
  assert.match(source, /Укажите уплаченную таможенную пошлину по коду <b>20-10<\/b> как указано в декларации\./);
  assert.match(source, /Теперь укажите уплаченный НДС по коду <b>50-10<\/b> как указано в декларации\./);
});
