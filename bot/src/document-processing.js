import { extractTextItems, getDocumentProxy } from 'unpdf';
import { cargoTypeCandidates, detectCargoType, selectUtilRate } from '../../shared/util-rate-selector.js';
import '../../shared/vehicle-power.js';
import '../../shared/sbkts-power-parser.js';

const { analyzeVehiclePower } = globalThis.GraniVehiclePower;
const { parseSbktsPowerData } = globalThis.GraniSbktsPower;

export class DocumentProcessingError extends Error {
  constructor(code, message, cause = null, details = null) {
    super(message, cause ? { cause } : undefined);
    this.name = 'DocumentProcessingError';
    this.code = code;
    this.details = details;
  }
}

const DAY = 24 * 60 * 60 * 1000;
const RU_MONTHS = {
  январ: 1, феврал: 2, март: 3, апрел: 4, ма: 5, июн: 6,
  июл: 7, август: 8, сентябр: 9, октябр: 10, ноябр: 11, декабр: 12
};

const KEY_RATE_PERIODS = [
  ['2023-01-01', 7.5], ['2023-07-24', 8.5], ['2023-08-15', 12],
  ['2023-09-18', 13], ['2023-10-30', 15], ['2023-12-18', 16],
  ['2024-07-29', 18], ['2024-09-16', 19], ['2024-10-28', 21],
  ['2025-06-09', 20], ['2025-07-28', 18], ['2025-09-15', 17],
  ['2025-10-27', 16.5], ['2025-12-22', 16], ['2026-02-16', 15.5],
  ['2026-03-23', 15], ['2026-04-27', 14.5], ['2026-06-22', 14.25],
  ['2026-07-27', 14]
];

const RU_HOLIDAYS = new Set([
  '2023-01-02','2023-01-03','2023-01-04','2023-01-05','2023-01-06','2023-02-23','2023-02-24','2023-03-08','2023-05-01','2023-05-08','2023-05-09','2023-06-12','2023-11-06',
  '2024-01-01','2024-01-02','2024-01-03','2024-01-04','2024-01-05','2024-01-08','2024-02-23','2024-03-08','2024-04-29','2024-04-30','2024-05-01','2024-05-09','2024-05-10','2024-06-12','2024-11-04','2024-12-30','2024-12-31',
  '2025-01-01','2025-01-02','2025-01-03','2025-01-06','2025-01-07','2025-01-08','2025-05-01','2025-05-02','2025-05-08','2025-05-09','2025-06-12','2025-06-13','2025-11-03','2025-11-04','2025-12-31',
  '2026-01-01','2026-01-02','2026-01-05','2026-01-06','2026-01-07','2026-01-08','2026-01-09','2026-02-23','2026-03-09','2026-05-01','2026-05-11','2026-06-12','2026-11-04','2026-12-31'
]);

function normalize(value) {
  return String(value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function groupLines(items) {
  const lines = [];
  for (const item of items.filter(item => normalize(item.str))) {
    let line = lines.find(candidate => Math.abs(candidate.y - item.y) <= 2);
    if (!line) {
      line = { y: item.y, items: [] };
      lines.push(line);
    }
    line.items.push({ x: item.x, str: normalize(item.str) });
  }
  return lines
    .sort((a, b) => b.y - a.y)
    .map(line => ({
      ...line,
      items: line.items.sort((a, b) => a.x - b.x),
      text: normalize(line.items.sort((a, b) => a.x - b.x).map(item => item.str).join(' '))
    }));
}

export async function readPdf(bytes) {
  const data = bytes?.constructor === Uint8Array ? bytes : new Uint8Array(bytes);
  const pdf = await getDocumentProxy(data);
  const { items } = await extractTextItems(pdf);
  const pages = items.map(groupLines);
  return { pages, text: pages.flat().map(line => line.text).join('\n') };
}

function pageValue(lines, label, minX) {
  const line = lines.find(candidate => label.test(candidate.text));
  if (!line) return null;
  const values = line.items.filter(item => item.x >= minX && !label.test(item.str)).map(item => item.str);
  return normalize(values.join(' ')) || null;
}

function numberValue(lines, label, minX) {
  const value = pageValue(lines, label, minX);
  const match = value?.match(/\d+(?:[.,]\d+)?/);
  return match ? Number(match[0].replace(',', '.')) : null;
}

function pageValueFromDocument(pages, label, minX) {
  for (const lines of pages) {
    const value = pageValue(lines, label, minX);
    if (value) return value;
  }
  return null;
}

function numberValueFromDocument(pages, label, minX) {
  for (const lines of pages) {
    const value = numberValue(lines, label, minX);
    if (value !== null) return value;
  }
  return null;
}

function eptsThirtyMinutePowers(pages) {
  const label = /30-минутная.*мощность|максимальная 30-минутная/i;
  const values = [];
  for (const lines of pages) {
    for (let index = 0; index < lines.length; index++) {
      if (!label.test(lines[index].text)) continue;
      const inline = numberValue([lines[index]], label, 350);
      if (inline !== null) {
        values.push(inline);
        continue;
      }
      for (let offset = 1; offset <= 2 && index + offset < lines.length; offset++) {
        const next = lines[index + offset];
        const value = next.items.find(item => item.x >= 350 && /^\d+(?:[.,]\d+)?$/.test(item.str));
        if (value) {
          values.push(Number(value.str.replace(',', '.')));
          break;
        }
      }
    }
  }
  return values;
}

function vehicleCategory(value) {
  return normalize(value)?.match(/N1G|[A-ZА-Я]\d/i)?.[0]?.toUpperCase() || null;
}

function isCargoCategory(category) {
  return ['N1', 'N1G', 'N2', 'N3'].includes(category);
}

function parseRussianDateFromText(text) {
  let match = normalize(text).match(/Дата\s+оформления[^\d]{0,40}(\d{1,2})[\s"'«»]*([а-яё]+)\s+(\d{4})/i);
  if (!match) return null;
  const month = monthNumber(match[2]);
  return month ? validDate(Number(match[3]), month, Number(match[1])) : null;
}

function monthNumber(word) {
  const value = String(word).toLowerCase();
  for (const [prefix, month] of Object.entries(RU_MONTHS)) if (value.startsWith(prefix)) return month;
  return null;
}

function parseSbkts(document) {
  const first = document.pages[0] || [];
  const second = document.pages[1] || [];
  const brand = pageValue(first, /^МАРКА(?:\s|$)/i, 180);
  const model = pageValue(first, /^КОММЕРЧЕСКОЕ(?:\s|$)/i, 180);
  const vin = pageValue(first, /^ИДЕНТИФИКАЦИОННЫЙ(?:\s|$)/i, 180);
  const applicant = pageValue(first, /^ЗАЯВИТЕЛЬ И ЕГО АДРЕС(?:\s|$)/i, 180);
  const year = numberValue(first, /^ГОД ВЫПУСКА(?:\s|$)/i, 180);
  const category = vehicleCategory(pageValue(first, /^КАТЕГОРИЯ(?:\s|$)/i, 180));
  const ccm = numberValue(second, /рабочий объем цилиндров/i, 180);
  const maxMass = numberValue(second, /Технически допустимая/i, 180);
  const parsedPower = parseSbktsPowerData(document.text);
  const combustionKw = parsedPower.engineMaxKw;
  const electricKw = parsedPower.electric30MinKw;
  const electric30MinKw = parsedPower.electric30MinKwTotal;
  const power = analyzeVehiclePower(document.text, {
    engineKw: combustionKw,
    electric30MinKw,
    electric30MinKwSpecified: electricKw.length > 0
  });
  const powerErrorCode = parsedPower.ambiguousFields.length
    ? 'POWER_DATA_AMBIGUOUS'
    : power.errorCode;
  const powerError = parsedPower.ambiguousFields.length
    ? 'В документе найдено несколько разных значений мощности ДВС — требуется проверка'
    : power.error;
  console.info('sbkts_power_parse', JSON.stringify({
    documentType: 'sbkts',
    hybridTypeSource: power.hybridTypeSource,
    hybridType: power.hybridType,
    engineMaxKw: combustionKw,
    electricMaxKw: parsedPower.electricMaxKw,
    electric30MinKw: electricKw,
    electric30MinKwTotal: electric30MinKw,
    calculatedKw: power.calculatedKw,
    errorCode: powerErrorCode || null
  }));
  return {
    type: 'sbkts', brand, model, vin, surname: applicant?.split(/\s+/)[0] || null,
    year, category, ccm, combustionKw, engineKw: combustionKw,
    engineMaxKw: combustionKw, electricMaxKw: parsedPower.electricMaxKw,
    electricKw, electric30MinKwList: electricKw, electric30MinKw,
    calculatedKw: power.calculatedKw, totalKw: power.calculatedKw,
    maxMass, cargoType: detectCargoType(document.text), issueDate: parseRussianDateFromText(document.text),
    hybridType: power.hybridType, hybridTypeSource: power.hybridTypeSource,
    powerError, powerErrorCode
  };
}

function parseEpts(document) {
  const first = document.pages[0] || [];
  const brand = pageValue(first, /^Марка(?:\s|$)/i, 350);
  const model = pageValue(first, /^Коммерческое наименование(?:\s|$)/i, 350);
  const vin = pageValue(first, /^Идентификационный номер(?:\s|$)/i, 350);
  const yearText = pageValue(first, /^Месяц и год изготовления(?:\s|$)/i, 350);
  const year = Number(yearText?.match(/\b(19|20)\d{2}\b/)?.[0]) || null;
  const category = vehicleCategory(pageValue(first, /^Категория в соответствии с ТР ТС/i, 350));
  const ccm = numberValueFromDocument(document.pages, /рабочий объем цилиндров/i, 350);
  const combustionKw = numberValueFromDocument(document.pages, /максимальная мощность \(кВт\)/i, 350);
  const maxMass = numberValueFromDocument(document.pages, /Технически допустимая максимальная масса/i, 350);
  let owner = null;
  for (const lines of document.pages) {
    owner ||= pageValue(lines, /^Собственник(?:\s|$)/i, 350);
  }
  const electricKw = eptsThirtyMinutePowers(document.pages);
  const electric30MinKw = electricKw.length ? round2(electricKw.reduce((sum, value) => sum + value, 0)) : null;
  const power = analyzeVehiclePower(document.text, {
    engineKw: combustionKw,
    electric30MinKw,
    electric30MinKwSpecified: electricKw.length > 0
  });
  return {
    type: 'epts', brand, model, vin, surname: owner?.split(/\s+/)[0] || null, year, yearText, category, ccm, combustionKw,
    engineKw: combustionKw, electricKw, electric30MinKwList: electricKw, electric30MinKw,
    totalKw: power.calculatedKw,
    maxMass, cargoType: detectCargoType(document.text), issueDate: null,
    hybridType: power.hybridType, powerError: power.error, powerErrorCode: power.errorCode
  };
}

export function parseVehicleDocument(document) {
  const compact = normalize(document.text);
  if (/СВИДЕТЕЛЬСТВО О БЕЗОПАСНОСТИ КОНСТРУКЦИИ/i.test(compact)) return parseSbkts(document);
  if (/Выписка\s+из электронного паспорта транспортного средства/i.test(compact)) return parseEpts(document);
  throw new DocumentProcessingError('DOCUMENT_TYPE_NOT_DETECTED', 'Документ не похож на СБКТС или выписку ЭПТС');
}

function round2(value) { return Math.round(value * 100) / 100; }

function ageStatus(year, now = new Date()) {
  const difference = now.getUTCFullYear() - year;
  return difference > 3 ? ['old'] : difference < 3 ? ['new'] : ['new', 'old'];
}

export function calculateUtil(vehicle, now = new Date(), calculationYear = now.getUTCFullYear()) {
  if (isCargoCategory(vehicle.category)) {
    if (!vehicle.year || !vehicle.maxMass) throw new Error('Не удалось определить год выпуска или технически допустимую максимальную массу');
    return ageStatus(vehicle.year, now).map(age => {
      const rate = selectUtilRate({
        category: vehicle.category, vehicleType: vehicle.cargoType,
        maxMass: vehicle.maxMass, age, year: calculationYear
      });
      if (rate?.ambiguous) {
        throw new DocumentProcessingError(
          'CARGO_TYPE_REQUIRED',
          'Нужно уточнить тип грузового автомобиля',
          null,
          { vehicle, candidates: rate.candidates || cargoTypeCandidates({ category: vehicle.category, maxMass: vehicle.maxMass, age, year: calculationYear }) }
        );
      }
      if (!rate) throw new Error('Для этой категории и технически допустимой максимальной массы не найдена ставка');
      return {
        age, commercial: rate.amount, personal: rate.amount, cargo: true,
        utilCoefficient: rate.coefficient, utilRate: rate
      };
    });
  }
  if (vehicle.category !== 'M1') throw new Error(`Категория ${vehicle.category || 'не определена'} пока не поддерживается`);
  if (vehicle.powerError) throw new DocumentProcessingError(vehicle.powerErrorCode || 'CALCULATION_ERROR', vehicle.powerError);
  if (!vehicle.year || !vehicle.totalKw) throw new Error('Не удалось определить год или расчётную мощность');
  const calculationCcm = ['series', 'ev'].includes(vehicle.hybridType) ? null : vehicle.ccm;
  const powertrain = calculationCcm ? 'combustion' : 'electric';
  const commercial = selectUtilRate({ category: 'M1', powertrain, payer: 'commercial', ccm: calculationCcm, powerKw: vehicle.totalKw, age: 'new', year: calculationYear });
  const personal = selectUtilRate({ category: 'M1', powertrain, payer: 'personal', ccm: calculationCcm, powerKw: vehicle.totalKw, age: 'new', year: calculationYear });
  if (!commercial || !personal) throw new Error('Для этих характеристик не найдена ставка');
  return ageStatus(vehicle.year, now).map(age => ({
    age,
    commercial: selectUtilRate({ category: 'M1', powertrain, payer: 'commercial', ccm: calculationCcm, powerKw: vehicle.totalKw, age, year: calculationYear }).amount,
    personal: selectUtilRate({ category: 'M1', powertrain, payer: 'personal', ccm: calculationCcm, powerKw: vehicle.totalKw, age, year: calculationYear }).amount
  }));
}

export async function processVehicleDocument(bytes, now = new Date()) {
  const document = await readPdf(bytes);
  if (document.text.replace(/\s/g, '').length < 40) {
    throw new DocumentProcessingError('PDF_NO_TEXT', 'В PDF нет текстового слоя');
  }
  const vehicle = parseVehicleDocument(document);
  const util = calculateUtil(vehicle, now);
  const deadline = vehicle.issueDate ? addWorkingDays(vehicle.issueDate, 5) : null;
  return { document, vehicle, util, deadline };
}

export function parseFlexibleDate(input) {
  const value = normalize(normalize(input).toLowerCase().replace(/,/g, ' '));
  let match = value.match(/\b(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})\b/);
  if (match) {
    const year = Number(match[3]) < 100 ? 2000 + Number(match[3]) : Number(match[3]);
    return validDate(year, Number(match[2]), Number(match[1]));
  }
  match = value.match(/\b(\d{4})[./-](\d{1,2})[./-](\d{1,2})\b/);
  if (match) return validDate(Number(match[1]), Number(match[2]), Number(match[3]));
  match = value.match(/\b(\d{1,2})\s+([а-яё]+)\s+(\d{4})\b/);
  if (match) return validDate(Number(match[3]), monthNumber(match[2]), Number(match[1]));
  match = value.match(/(?:^|\s)([а-яё]+)\s+(\d{1,2})\s+(\d{4})(?:$|\s)/);
  if (match) return validDate(Number(match[3]), monthNumber(match[1]), Number(match[2]));
  return null;
}

function validDate(year, month, day) {
  if (!month) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date : null;
}

export function addWorkingDays(date, count) {
  let result = new Date(date);
  let added = 0;
  while (added < count) {
    result = new Date(result.getTime() + DAY);
    const weekday = result.getUTCDay();
    if (weekday !== 0 && weekday !== 6 && !RU_HOLIDAYS.has(toIso(result))) added++;
  }
  return result;
}

function keyRateFor(date) {
  const iso = toIso(date);
  let result = null;
  for (const [from, rate] of KEY_RATE_PERIODS) {
    if (from > iso) break;
    result = rate;
  }
  return result;
}

export function calculatePeni(sum, deadline, target) {
  const periods = [];
  let total = 0;
  for (let day = new Date(deadline.getTime() + DAY); day <= target; day = new Date(day.getTime() + DAY)) {
    const rate = keyRateFor(day);
    if (rate === null) throw new Error('Нет истории ключевой ставки для выбранной даты');
    const amount = sum * rate / 100 / 300;
    total += amount;
    const last = periods.at(-1);
    if (last?.rate === rate) {
      last.to = new Date(day); last.days++; last.amount += amount;
    } else periods.push({ from: new Date(day), to: new Date(day), days: 1, rate, amount });
  }
  return { days: Math.max(0, Math.round((target - deadline) / DAY)), total, periods };
}

export function toIso(date) { return date.toISOString().slice(0, 10); }
export function todayUtc(now = new Date()) { return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())); }
