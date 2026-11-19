import { calculateUtil, processVehicleDocument, calculatePeniDailySummary, todayUtc, addWorkingDays, toIso } from './document-processing.js';
import { calculateDeclarationPayment, DECLARATION_COUNTRIES, findDeclarationPrice } from './declaration-flow.js';
import { parseCbrCurrencyRate, convertCurrencyToRub } from './customs-calculation.js';
import { UTIL_RATE_DIRECTORY, rateYear, selectUtilRate } from '../../shared/util-rate-selector.js';
import '../../shared/vehicle-power.js';

const origins = new Set(['https://grani-br.ru', 'https://www.grani-br.ru']);
const maxPdf = 5 * 1024 * 1024;
const currentYear = now => new Date(now.getTime() + 3 * 3600000).getUTCFullYear();
let cachedRates;

class CalculatorInputError extends Error {}
function requireInput(condition, message) {
  if (!condition) throw new CalculatorInputError(message);
}

function numeric(value) {
  const text = String(value ?? '').trim().replace(',', '.');
  return /^\d+(?:\.\d+)?$/.test(text) ? Number(text) : NaN;
}

const positive = value => Number.isFinite(value) && value > 0;

export function calculatorOptions(year = rateYear(currentYear(new Date()))) {
  const rows = UTIL_RATE_DIRECTORY.records
    .filter(row => ['M1', 'N1', 'N2'].includes(row.category) && row.coefficients[year])
    .filter(row => row.category === 'M1' || row.vehicleType === 'cargo')
    .filter(row => row.payer === 'commercial')
    .map(row => {
      const { category, powertrain, ccm, power, mass } = row;
      const samplePower = power?.max ?? ((power?.min || 0) + 1);
      const sampleVolume = powertrain === 'electric' ? null : ccm?.max ?? ((ccm?.min || 0) + 1);
      const personal = category === 'M1' && selectUtilRate({
        category, powertrain, payer: 'personal', ccm: sampleVolume, powerKw: samplePower, age: 'new', year,
      });
      return { category, powertrain, ccm, power, mass, reduced: !!personal && personal.coefficient < row.coefficients[year].new };
    });
  return { year, rows };
}

export function calculateManual(input, now = new Date()) {
  const { category, hybridType } = input;
  const year = numeric(input.year);
  const month = input.month ? numeric(input.month) : null;
  const activeYear = currentYear(now);
  requireInput(Number.isInteger(year) && year >= 1900 && year <= activeYear, 'Проверьте год выпуска.');
  requireInput(month === null || Number.isInteger(month) && month >= 1 && month <= 12, 'Проверьте месяц выпуска.');
  requireInput(['M1', 'N1', 'N2'].includes(category), 'Выберите категорию автомобиля.');
  requireInput(['combustion', 'parallel', 'series', 'ev'].includes(hybridType), 'Выберите тип двигателя.');
  requireInput(category === 'M1' || !['series', 'ev'].includes(hybridType), 'Для электромобилей и последовательных гибридов доступна категория M1.');
  const vehicle = { category, year, manufactureMonth: month, hybridType };
  if (category === 'M1') {
    const engineKw = numeric(input.engineKw);
    const electric30MinKw = numeric(input.electricKw);
    const volume = numeric(input.ccm);
    const electric = ['series', 'ev'].includes(hybridType);
    requireInput(electric || positive(volume), 'Укажите объём двигателя или выберите диапазон.');
    requireInput(electric || positive(engineKw), 'Укажите мощность ДВС.');
    requireInput(hybridType !== 'parallel' || Number.isFinite(electric30MinKw), 'Укажите 30-минутную мощность электромоторов. Если она нулевая, введите 0.');
    const power = globalThis.GraniVehiclePower.calculateVehiclePower({
      hybridType, engineKw, electric30MinKw, electric30MinKwSpecified: Number.isFinite(electric30MinKw),
    });
    requireInput(!power.error, power.error);
    Object.assign(vehicle, { ccm: electric ? null : volume, totalKw: power.calculatedKw, engineKw: power.engineKw, electric30MinKw: power.electric30MinKw });
  } else {
    const mass = numeric(input.maxMass);
    requireInput(category === 'N1' ? mass > 0 && mass <= 3500 : mass > 3500 && mass <= 12000,
      'Выберите диапазон полной массы для категории автомобиля.');
    Object.assign(vehicle, { maxMass: mass, cargoType: 'cargo' });
  }
  return serializeUtil(vehicle, now);
}

function serializeUtil(vehicle, now, parsedUtil = null, deadline = null) {
  const year = rateYear(currentYear(now));
  const powertrain = ['series', 'ev'].includes(vehicle.hybridType) ? 'electric' : 'combustion';
  const util = parsedUtil || calculateUtil(vehicle, now, year);
  const results = util.map(item => {
    const commercialRate = item.utilRate || selectUtilRate({
      category: vehicle.category, powertrain, payer: 'commercial', ccm: powertrain === 'electric' ? null : vehicle.ccm,
      powerKw: vehicle.totalKw, age: item.age, year,
    });
    const personalRate = item.personal < item.commercial ? selectUtilRate({
      category: vehicle.category, powertrain, payer: 'personal', ccm: powertrain === 'electric' ? null : vehicle.ccm,
      powerKw: vehicle.totalKw, age: item.age, year,
    }) : null;
    const fees = [{ label: 'Коммерческий утильсбор', amount: item.commercial, coefficient: commercialRate?.coefficient }];
    if (personalRate) fees.unshift({ label: 'Льготный утильсбор для личного пользования', amount: item.personal, coefficient: personalRate.coefficient });
    if (deadline && vehicle.type === 'sbkts') {
      for (const fee of fees) {
        const penalty = calculatePeniDailySummary(fee.amount, deadline, todayUtc(now));
        if (Number.isFinite(penalty.total)) fee.penalty = penalty.total;
        if (Number.isFinite(penalty.daily)) fee.dailyPenalty = penalty.daily;
      }
    }
    return { age: item.age, fees };
  });
  const { brand, model, category, year: manufactureYear, maxMass, cargoType, totalKw, engineKw, electric30MinKw } = vehicle;
  return { year, vehicle: { brand, model, category, manufactureYear, maxMass, cargoType, totalKw, engineKw, electric30MinKw }, results,
    deadline: deadline && vehicle.type === 'sbkts' ? toIso(deadline) : null };
}

async function getCurrencyRate(code) {
  if (!cachedRates || Date.now() >= cachedRates.expiry) {
    const response = await fetch('https://www.cbr.ru/scripts/XML_daily.asp', { signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error('CBR feed failed');
    cachedRates = { xml: await response.text(), expiry: Date.now() + 6 * 3600000 };
  }
  const rate = parseCbrCurrencyRate(cachedRates.xml, code);
  if (!rate) throw new Error('Currency unavailable');
  return rate;
}

export async function calculateWebsiteDeclaration(vehicle, input, now = new Date(), fetchRate = getCurrencyRate) {
  const country = Object.hasOwn(DECLARATION_COUNTRIES, input.country) && DECLARATION_COUNTRIES[input.country];
  requireInput(country, 'Выберите страну выдачи декларации.');
  const assembly = input.assembly === 'on';
  requireInput(!assembly || ['BY', 'KZ'].includes(input.country), 'Местная сборка доступна для Беларуси и Казахстана.');
  const duty = assembly ? 0 : numeric(input.duty);
  const vat = assembly ? 0 : numeric(input.vat);
  requireInput(Number.isFinite(duty) && duty >= 0 && Number.isFinite(vat) && vat >= 0,
    'Укажите суммы пошлины 2010 и НДС 5010 в валюте декларации. Если платёж отсутствует, введите 0.');

  const documentModel = [vehicle.brand, vehicle.model].filter(Boolean).join(' ');
  const query = String(input.model || documentModel).trim().slice(0, 200);
  const found = findDeclarationPrice(query);
  const choices = found.exact ? [found.exact] : found.closest;
  const picked = Number(input.variant);
  const selected = input.variant !== '' && input.variant != null && Number.isInteger(picked) ? choices[picked] : null;
  if (!selected) return { modelQuery: query, choices };

  const rate = duty || vat ? await fetchRate(country.currency) : null;
  const paidDutyRub = duty ? convertCurrencyToRub(duty, rate) : 0;
  const paidVatRub = vat ? convertCurrencyToRub(vat, rate) : 0;
  const payment = calculateDeclarationPayment({
    vehicle, priceRub: selected.price, paidDutyRub, paidVatRub, calculationYear: rateYear(currentYear(now)),
  });
  return { payment, rate, paidDutyRub, paidVatRub, assembly, selected, documentModel,
    needsClarification: !found.exact || findDeclarationPrice(documentModel).exact?.name !== selected.name };
}

async function limitedBody(request, limit) {
  const reader = request.body?.getReader();
  if (!reader) throw new CalculatorInputError('Форма пуста.');
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) return new Blob(chunks);
      bytes += value.byteLength;
      if (bytes > limit) {
        await reader.cancel();
        throw new CalculatorInputError('PDF должен быть не больше 5 МБ.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
}

export async function handleWebsiteCalculator(request, mode, { readDocument = processVehicleDocument } = {}) {
  const origin = request.headers.get('Origin');
  if (!origins.has(origin)) return new Response(null, { status: 403 });
  const headers = {
    'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type', 'Cache-Control': 'no-store', Vary: 'Origin',
  };
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  const respond = (data, status = 200) => Response.json(data, { status, headers });
  if (mode === 'options' && request.method === 'GET') return respond(calculatorOptions());
  if (request.method !== 'POST' || !['manual', 'document', 'declaration'].includes(mode)) return respond({ error: 'Способ расчёта недоступен.' }, 405);
  try {
    if (mode === 'manual') {
      const input = JSON.parse(await (await limitedBody(request, 4096)).text());
      requireInput(input && typeof input === 'object' && !Array.isArray(input), 'Проверьте параметры расчёта.');
      return respond(calculateManual(input));
    }
    const type = request.headers.get('Content-Type') || '';
    requireInput(type.startsWith('multipart/form-data;'), 'Загрузите PDF СБКТС или выписки ЭПТС.');
    const form = await new Response(await limitedBody(request, maxPdf + 16000), { headers: { 'Content-Type': type } }).formData();
    const file = form.get('file');
    requireInput(file instanceof File && file.size > 0 && file.size <= maxPdf, 'Загрузите PDF размером до 5 МБ.');
    const bytes = await file.arrayBuffer();
    requireInput(new TextDecoder().decode(bytes.slice(0, 5)) === '%PDF-', 'Загрузите PDF СБКТС или выписки ЭПТС.');
    let parsed;
    try {
      parsed = await readDocument(bytes);
    } catch (error) {
      const vehicle = error?.details?.vehicle;
      if (vehicle && error.code === 'ENGINE_VOLUME_NOT_DETECTED') {
        const volume = numeric(form.get('documentVolume'));
        if (!positive(volume)) return respond({ needVolume: true });
        vehicle.ccm = volume;
      } else if (vehicle && error.code === 'CARGO_TYPE_REQUIRED') {
        const choices = error.details.candidates || [];
        const cargoType = form.get('cargoType');
        if (!choices.some(item => item.id === cargoType)) return respond({ cargoChoices: choices });
        vehicle.cargoType = cargoType;
      } else {
        throw error;
      }
      parsed = { vehicle, util: calculateUtil(vehicle), deadline: vehicle.issueDate ? addWorkingDays(vehicle.issueDate, 5) : null };
    }
    if (mode === 'document') return respond(serializeUtil(parsed.vehicle, new Date(), parsed.util, parsed.deadline));
    return respond(await calculateWebsiteDeclaration(parsed.vehicle, Object.fromEntries(form)));
  } catch (error) {
    if (error instanceof CalculatorInputError || error?.name === 'DocumentProcessingError') {
      return respond({ error: error.message }, 422);
    }
    return respond({ error: 'Не удалось выполнить расчёт. Проверьте характеристики или документ и повторите попытку.' }, 422);
  }
}
