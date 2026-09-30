import { calculateUtil } from './document-processing.js';
import { selectUtilRate } from '../../shared/util-rate-selector.js';
import { DECLARATION_PRICE_LIST } from './declaration-price-list.js';
import { electricExciseRate } from './customs-calculation.js';

export const DECLARATION_COUNTRIES = {
  KG: { label: 'Киргизия', currency: 'KGS' },
  AM: { label: 'Армения', currency: 'AMD' },
  BY: { label: 'Беларусь', currency: 'BYN' },
  KZ: { label: 'Казахстан', currency: 'KZT' }
};

function normalized(value) {
  return String(value || '')
    .toUpperCase()
    .replace(/Ё/g, 'Е')
    .replace(/[^A-ZА-Я0-9+]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function score(query, candidate) {
  const queryWords = new Set(normalized(query).split(' ').filter(Boolean));
  const candidateWords = new Set(normalized(candidate).split(' ').filter(Boolean));
  let common = 0;
  for (const word of queryWords) if (candidateWords.has(word)) common++;
  return common * 100 - Math.abs(queryWords.size - candidateWords.size) * 5 - Math.abs(String(query).length - String(candidate).length) / 100;
}

export function findDeclarationPrice(name, priceList = DECLARATION_PRICE_LIST) {
  const query = normalized(name);
  if (!query) return { exact: null, closest: [] };
  // Spaces may vary inside a model (RAV4 / RAV 4), but every other character
  // and all trim words must still match. Never turn a base model into PLUS/HYBRID.
  const compactQuery = query.replace(/ /g, '');
  const literalMatches = priceList.filter(item => normalized(item.name) === query);
  const matches = literalMatches.length ? literalMatches
    : priceList.filter(item => normalized(item.name).replace(/ /g, '') === compactQuery);
  const exact = matches.length === 1 ? matches[0] : null;
  if (matches.length > 1) return { exact: null, closest: matches.slice(0, 5) };
  const closest = priceList
    .map(item => ({ ...item, score: score(name, item.name) }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, 5)
    .map(({ score: _score, ...item }) => item);
  return { exact, closest };
}

export function commercialDeclarationUtil(vehicle, calculationYear = new Date().getUTCFullYear()) {
  const utilVehicle = String(vehicle?.category || '').toUpperCase() === 'M1G'
    ? { ...vehicle, category: 'M1' }
    : vehicle;
  const calculationCcm = ['series', 'ev'].includes(utilVehicle?.hybridType) ? null : utilVehicle?.ccm;
  const powertrain = calculationCcm ? 'combustion' : 'electric';
  return calculateUtil(utilVehicle, new Date(), calculationYear).map(item => {
    const rate = String(utilVehicle?.category || '').toUpperCase() === 'M1'
      ? selectUtilRate({
          category: 'M1', powertrain, payer: 'commercial', ccm: calculationCcm,
          powerKw: utilVehicle?.totalKw, age: item.age, year: calculationYear
        })
      : null;
    return {
      age: item.age,
      amount: item.commercial,
      coefficient: item.utilCoefficient ?? item.utilRate?.coefficient ?? rate?.coefficient ?? null,
      calculationYear: item.utilRate?.calculationYear ?? rate?.calculationYear ?? calculationYear
    };
  });
}

function declarationExciseApplies(category) {
  const normalizedCategory = String(category || '').trim().toUpperCase();
  return normalizedCategory === 'M1' || normalizedCategory === 'M1G';
}

export function calculateDeclarationPayment({ priceRub, vehicle, paidDutyRub = 0, paidVatRub = 0, calculationYear = new Date().getUTCFullYear() }) {
  const price = Number(priceRub);
  const powerKw = Number(vehicle?.totalKw);
  if (!Number.isFinite(price) || price <= 0) throw new Error('Не указана стоимость автомобиля');
  if (!Number.isFinite(powerKw) || powerKw <= 0) throw new Error('Не указана мощность автомобиля');
  const duty = Math.round(price * 0.15);
  const hp = powerKw / 0.75;
  const excise = declarationExciseApplies(vehicle?.category)
    ? Math.round(hp * electricExciseRate(powerKw))
    : 0;
  const vat = Math.round((price + duty + excise) * 0.22);
  // Foreign duty overpayment is not a credit against other payments.
  const dutyDifference = Math.max(0, duty - paidDutyRub);
  const util = commercialDeclarationUtil(vehicle, calculationYear).map(item => ({
    ...item,
    dutyDifference: Math.round(dutyDifference),
    vatDifference: Math.round(vat - paidVatRub),
    total: Math.round(dutyDifference + vat - paidVatRub + excise + item.amount)
  }));
  return { price, duty, excise, vat, util, calculationYear };
}
