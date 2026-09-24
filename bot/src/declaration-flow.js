import { calculateUtil } from './document-processing.js';
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
    .replace(/[^A-ZА-Я0-9]+/g, ' ')
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

export function findDeclarationPrice(name) {
  const query = normalized(name);
  if (!query) return { exact: null, closest: [] };
  const exact = DECLARATION_PRICE_LIST.find(item => normalized(item.name) === query) || null;
  const closest = DECLARATION_PRICE_LIST
    .map(item => ({ ...item, score: score(name, item.name) }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, 5)
    .map(({ score: _score, ...item }) => item);
  return { exact, closest };
}

export function commercialDeclarationUtil(vehicle) {
  return calculateUtil(vehicle).map(item => ({ age: item.age, amount: item.commercial }));
}

export function calculateDeclarationPayment({ priceRub, vehicle, paidDutyRub = 0, paidVatRub = 0 }) {
  const price = Number(priceRub);
  const powerKw = Number(vehicle?.totalKw);
  if (!Number.isFinite(price) || price <= 0) throw new Error('Не указана стоимость автомобиля');
  if (!Number.isFinite(powerKw) || powerKw <= 0) throw new Error('Не указана мощность автомобиля');
  const duty = Math.round(price * 0.15);
  const hp = powerKw / 0.75;
  const excise = Math.round(hp * electricExciseRate(powerKw));
  const vat = Math.round((price + duty + excise) * 0.22);
  const util = commercialDeclarationUtil(vehicle).map(item => ({
    ...item,
    dutyDifference: Math.round(duty - paidDutyRub),
    vatDifference: Math.round(vat - paidVatRub),
    total: Math.round(duty - paidDutyRub + vat - paidVatRub + excise + item.amount)
  }));
  return { price, duty, excise, vat, util };
}
