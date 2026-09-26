import { readFile, writeFile } from 'node:fs/promises';
import XLSX from 'xlsx';

const [inputPath, outputPath = 'bot/src/organizations-catalog.json'] = process.argv.slice(2);
if (!inputPath) throw new Error('Укажите путь к Excel-файлу каталога организаций.');

const workbook = XLSX.read(await readFile(inputPath));
const sheet = workbook.Sheets['Организации'];
if (!sheet) throw new Error('В Excel не найден лист «Организации».');

const [headers, ...rows] = XLSX.utils.sheet_to_json(sheet, { header: 1, range: 4, defval: '' });
const column = Object.fromEntries(headers.map((value, index) => [String(value).trim(), index]));
const cell = (row, title) => row[column[title]] ?? '';
const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
const yes = value => clean(value).toLowerCase() === 'да';
const containsAll = (text, ...fragments) => fragments.every(fragment => text.includes(fragment));

const authorityColumns = {
  eptsSbkts: 'ЭПТС: СБКТС', eptsOtts: 'ЭПТС: ОТТС', eptsRussia: 'ЭПТС: авто РФ',
  eptsEaeu: 'ЭПТС: авто из ЕАЭС', eptsRussiaMade: 'ЭПТС: производство РФ',
  eptsNoConformity: 'ЭПТС: без документа соответствия', eptsOther: 'ЭПТС: иные случаи',
  eptsChangeExcluded: 'ЭПТС: изменение после исключения', eptsChangeClosed: 'ЭПТС: изменение после прекращения',
  chassisImport: 'Шасси: ввоз', chassisRussiaMade: 'Шасси: производство РФ', chassisChange: 'Шасси: изменение',
  epsmImportConformity: 'ЭПСМ: ввоз с документом соответствия', epsmPersonal: 'ЭПСМ: личный ввоз',
  epsmUsed: 'ЭПСМ: машина с пробегом', epsmEaeu: 'ЭПСМ: машина из ЕАЭС',
  epsmState: 'ЭПСМ: собственность государства', epsmDiplomatic: 'ЭПСМ: диппредставительство',
  epsmReturnRussia: 'ЭПСМ: возврат в РФ', epsmRussiaMade: 'ЭПСМ: производство РФ',
  epsmChangeExcluded: 'ЭПСМ: изменение после исключения', epsmChangeClosed: 'ЭПСМ: изменение после прекращения',
  epsmPaper: 'ЭПСМ: бумажный паспорт'
};

const organizations = rows.filter(row => clean(cell(row, 'ID'))).map(row => {
  const text = clean(cell(row, 'Полный текст полномочий')).toLowerCase().replace(/[–—]/g, '-');
  const eptsChangeClosed = containsAll(text,
    'изменений в электронный паспорт транспортного средства', 'прекратившей');
  const catalogAuthorities = {
    eptsSbkts: containsAll(text, 'свидетельств', 'безопасности конструкции транспортного средства'),
    eptsEaeu: containsAll(text,
      'электронного паспорта транспортного средства', 'ранее зарегистрированное',
      'а также в случаях, не предусмотренных настоящим порядком'),
    eptsChangeExcluded: containsAll(text,
      'изменений в электронный паспорт транспортного средства', 'исключенной') && !eptsChangeClosed,
    eptsChangeClosed,
    epsmImportConformity: containsAll(text,
      'электронного паспорта на машину', 'ввозимую на единую таможенную территорию',
      'документа об оценке соответствия машины требованиям технического регламента'),
    epsmEaeu: containsAll(text, 'паспорта на машину', 'ранее зарегистрированную', 'государства - члена союза'),
    epsmChangeExcluded: containsAll(text, 'изменений в электронный паспорт самоходной машины', 'исключенной'),
    epsmChangeClosed: containsAll(text, 'изменений в электронный паспорт самоходной машины', 'прекратившей')
  };
  return {
    id: clean(cell(row, 'ID')),
    registryNo: Number(cell(row, '№ в реестре')) || null,
    name: clean(cell(row, 'Название организации')),
    address: clean(cell(row, 'Адрес по реестру')),
    region: clean(cell(row, 'Регион')),
    city: clean(cell(row, 'Город / район')),
    phoneEmail: clean(cell(row, 'Телефон / e-mail')),
    sourcePage: clean(cell(row, 'Страница источника')),
    authorities: {
      ...Object.fromEntries(Object.entries(authorityColumns).map(([key, title]) => [key, yes(cell(row, title))])),
      ...catalogAuthorities
    }
  };
});

const expectedCounts = {
  eptsSbkts: 102, eptsEaeu: 75, eptsChangeExcluded: 66, eptsChangeClosed: 1,
  epsmImportConformity: 219, epsmEaeu: 33, epsmChangeExcluded: 1, epsmChangeClosed: 1
};
for (const [authority, expected] of Object.entries(expectedCounts)) {
  const actual = organizations.filter(item => item.authorities[authority]).length;
  if (actual !== expected) throw new Error(`Проверка «${authority}»: ожидалось ${expected}, получено ${actual}.`);
}

await writeFile(outputPath, JSON.stringify({ version: 1, organizations }) + '\n');
console.log(`Готово: ${organizations.length} организаций → ${outputPath}`);
