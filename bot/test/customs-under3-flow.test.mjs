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
  assert.match(source, /const KW_TO_HP = 1\.35962/);
  assert.match(source, /function formatPower\(kw\)/);
  assert.match(source, /\$\{Math\.round\(kilowatts \* KW_TO_HP\)\} л\. с\./);
  assert.match(source, /function combustionPowerLines/);
  assert.match(source, /function formatKw\(kw\)/);
  assert.match(source, /Мощность ДВС:<\/b> \$\{formatKw\(combustionKw\)\}/);
  assert.match(source, /Расчётная мощность:<\/b> \$\{combustionKw\} \+ \$\{electricKw\}/);
  assert.match(source, /function under3CustomsResultKeyboard/);
  assert.match(source, /customs:under3:edit:/);
  assert.match(source, /Исправьте предполагаемую таможенную стоимость автомобиля/);
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

test('пикап выбирается по шаблону СЭП, а не по ручному вводу массы', () => {
  assert.match(source, /Выбрать пикап/);
  assert.doesNotMatch(source, /Выберите возраст автомобиля:/);
  assert.match(source, /Введите марку, полную модель и год выпуска пикапа, чтобы я смог подобрать его в шаблоне СЭП/);
  assert.match(source, /source\?\.customsMode === 'pickup'/);
  assert.match(source, /Полную массу возьмём из выбранного варианта/);
  assert.match(source, /customs:pickup:vehicle:/);
  assert.match(source, /pickupMass: mass/);
  assert.match(source, /pickupAgeGroup = state\.ageGroup/);
  assert.match(source, /fuel: state\.fuel/);
  assert.doesNotMatch(source, /Укажите полную технически допустимую массу по шильдику/);
});

test('возраст пикапа уточняется только для пограничных годов', () => {
  assert.match(source, /async function sendPickupAgePrompt/);
  assert.match(source, /function pickupAgeResolution/);
  assert.match(source, /if \(ageInYears < 3\) return \{ ageGroup: '0-3' \}/);
  assert.match(source, /if \(ageInYears === 3\) return \{ choices: \[\['0-3'/);
  assert.match(source, /if \(ageInYears === 5\) return \{ choices: \[\['3-5'/);
  assert.match(source, /if \(ageInYears === 7\) return \{ choices: \[\['5-7'/);
  assert.match(source, /Укажите, сколько полных лет автомобилю по дате выпуска на дату таможенного оформления/);
  assert.match(source, /stage: 'pickup-age'/);
  assert.match(source, /stage: 'pickup-fuel'/);
});

test('пикап объясняет запрос объёма и показывает ставку таможенной пошлины', () => {
  assert.match(source, /В шаблоне СЭП объём двигателя не указан/);
  assert.match(source, /function pickupVolumeExplanation/);
  assert.match(source, /function pickupDutyLabel/);
  assert.match(source, /Таможенная пошлина \(ставка/);
  assert.match(source, /Объём двигателя:<\/b> \$\{ccm\} см³/);
  assert.doesNotMatch(source, /Ввозная пошлина: \$\{formatMoney\(result\.duty\)\}/);
});

test('результат пикапа позволяет исправить стоимость и принимает сокращённый ввод', () => {
  assert.match(source, /function pickupCustomsResultKeyboard/);
  assert.match(source, /customs:pickup:edit:/);
  assert.match(source, /Исправьте предполагаемую таможенную стоимость пикапа/);
  assert.match(source, /Можно написать: 8 млн, 8m, 500 тыс\. или 800 000/);
  assert.match(source, /parseCurrencyAmount\(message\.text\)/);
});

test('лошадиные силы выводятся и в итогах документов, и в электрорасчёте', () => {
  assert.match(source, /Мощность ДВС:<\/b> \$\{formatKw/);
  assert.match(source, /30-минутная мощность электромотора:<\/b> \$\{electricDetails\} кВт/);
  assert.match(source, /Суммарная мощность для акциза:<\/b> \$\{exciseFormula\}\$\{formatPower/);
  assert.match(source, /Мощность для утильсбора:<\/b> \$\{formatPower/);
});

test('ошибки и ручные вводы сохраняют навигацию', () => {
  assert.match(source, /async function sendCustomsNotice/);
  assert.match(source, /reply_markup: customsKeyboard\(\[\], state\?\.backCallback \|\| 'customs:start'\)/);
  assert.match(source, /function calculationNavigationKeyboard/);
  assert.match(source, /reply_markup: calculationNavigationKeyboard\(\)/);
  assert.match(source, /catalogWeightQuery: parsed/);
});
