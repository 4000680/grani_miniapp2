const PASSENGER_UNDER_3 = [
  { maxEuro: 8500, percent: 54, minEuroPerCc: 2.5 },
  { maxEuro: 16700, percent: 48, minEuroPerCc: 3.5 },
  { maxEuro: 42300, percent: 48, minEuroPerCc: 5.5 },
  { maxEuro: 84500, percent: 48, minEuroPerCc: 7.5 },
  { maxEuro: 169000, percent: 48, minEuroPerCc: 15 },
  { maxEuro: Infinity, percent: 48, minEuroPerCc: 20 }
];

const PASSENGER_OVER_3 = {
  '3-5': [
    { maxCc: 1000, euroPerCc: 1.5 },
    { maxCc: 1500, euroPerCc: 1.7 },
    { maxCc: 1800, euroPerCc: 2.5 },
    { maxCc: 2300, euroPerCc: 2.7 },
    { maxCc: 3000, euroPerCc: 3 },
    { maxCc: Infinity, euroPerCc: 3.6 }
  ],
  '5+': [
    { maxCc: 1000, euroPerCc: 3 },
    { maxCc: 1500, euroPerCc: 3.2 },
    { maxCc: 1800, euroPerCc: 3.5 },
    { maxCc: 2300, euroPerCc: 4.8 },
    { maxCc: 3000, euroPerCc: 5 },
    { maxCc: Infinity, euroPerCc: 5.7 }
  ]
};

const PICKUP_UTIL = [
  { maxKg: 2500, newCoefficient: 6.13, oldCoefficient: 8.91 },
  { maxKg: 3500, newCoefficient: 6.60, oldCoefficient: 9.61 },
  { maxKg: 5000, newCoefficient: 6.91, oldCoefficient: 10.29 },
  { maxKg: 8000, newCoefficient: 7.20, oldCoefficient: 16.46 },
  { maxKg: 12000, newCoefficient: 10.20, oldCoefficient: 27.81 }
];

const PICKUP_UTIL_BASE = 150000;
const VAT_RATE = 0.22;
const ELECTRIC_DUTY_RATE = 0.15;
// Article 193 of the Russian Tax Code expresses excise as rubles per 0.75 kW (1 hp).
const KW_PER_EXCISE_UNIT = 0.75;

const CUSTOMS_PROCESSING_FEES_2026 = [
  { maxRub: 200000, fee: 1231 },
  { maxRub: 450000, fee: 2462 },
  { maxRub: 1200000, fee: 4924 },
  { maxRub: 2700000, fee: 13541 },
  { maxRub: 4200000, fee: 18465 },
  { maxRub: 5500000, fee: 21344 },
  { maxRub: 10000000, fee: 49240 },
  { maxRub: Infinity, fee: 73860 }
];

function positiveNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`${label} должно быть больше нуля`);
  return number;
}

function roundRubles(value) {
  return Math.round(value);
}

export function calculateCustomsProcessingFee(customsValueRub) {
  const value = positiveNumber(customsValueRub, 'Таможенная стоимость');
  return CUSTOMS_PROCESSING_FEES_2026.find(item => value <= item.maxRub).fee;
}

export function calculatePassengerUnder3({ customsValueRub, engineCc, euroRate }) {
  const value = positiveNumber(customsValueRub, 'Таможенная стоимость');
  const ccm = positiveNumber(engineCc, 'Объём двигателя');
  const euro = positiveNumber(euroRate, 'Курс евро');
  const valueEuro = value / euro;
  const bracket = PASSENGER_UNDER_3.find(item => valueEuro <= item.maxEuro);
  const percentageAmount = value * bracket.percent / 100;
  const minimumAmount = ccm * bracket.minEuroPerCc * euro;
  const duty = Math.max(percentageAmount, minimumAmount);
  return {
    customsValueRub: roundRubles(value),
    customsValueEuro: valueEuro,
    percent: bracket.percent,
    minEuroPerCc: bracket.minEuroPerCc,
    percentageAmount: roundRubles(percentageAmount),
    minimumAmount: roundRubles(minimumAmount),
    duty: roundRubles(duty),
    selectedBy: percentageAmount >= minimumAmount ? 'percent' : 'minimum'
  };
}

export function calculatePassengerOver3({ ageGroup, engineCc, euroRate }) {
  const rates = PASSENGER_OVER_3[ageGroup];
  if (!rates) throw new Error('Неизвестная возрастная группа');
  const ccm = positiveNumber(engineCc, 'Объём двигателя');
  const euro = positiveNumber(euroRate, 'Курс евро');
  const bracket = rates.find(item => ccm <= item.maxCc);
  return {
    ageGroup,
    engineCc: ccm,
    euroPerCc: bracket.euroPerCc,
    duty: roundRubles(ccm * bracket.euroPerCc * euro)
  };
}

export function electricExciseRate(powerKw) {
  const power = positiveNumber(powerKw, '30-минутная мощность');
  if (power <= 67.5) return 0;
  if (power <= 112.5) return 64;
  if (power <= 150) return 613;
  if (power <= 225) return 1004;
  if (power <= 300) return 1711;
  if (power <= 375) return 1771;
  return 1829;
}

export function calculateElectricCustoms({ customsValueRub, excisePowerKw, powerKw }) {
  const value = positiveNumber(customsValueRub, 'Таможенная стоимость');
  const power = positiveNumber(excisePowerKw ?? powerKw, 'Мощность для акциза');
  const horsepower = power / KW_PER_EXCISE_UNIT;
  const excisePerHp = electricExciseRate(power);
  const duty = value * ELECTRIC_DUTY_RATE;
  const excise = horsepower * excisePerHp;
  const vatBase = value + duty + excise;
  const vat = vatBase * VAT_RATE;
  return {
    customsValueRub: roundRubles(value),
    excisePowerKw: power,
    horsepower,
    duty: roundRubles(duty),
    excisePerHp,
    excise: roundRubles(excise),
    vatBase: roundRubles(vatBase),
    vat: roundRubles(vat),
    customsTotal: roundRubles(duty + excise + vat)
  };
}

export function calculatePickup({ customsValueRub, fuel, ageGroup, engineCc, maxMassKg, euroRate }) {
  const value = positiveNumber(customsValueRub, 'Таможенная стоимость');
  const ccm = positiveNumber(engineCc, 'Объём двигателя');
  const mass = positiveNumber(maxMassKg, 'Полная масса');
  const euro = positiveNumber(euroRate, 'Курс евро');
  if (!['petrol', 'diesel'].includes(fuel)) throw new Error('Неизвестный тип топлива');
  if (!['0-3', '3-5', '5-7', '7+'].includes(ageGroup)) throw new Error('Неизвестная возрастная группа');
  if (mass > 12000) throw new Error('Расчёт поддерживает пикапы полной массой до 12 тонн');

  let percent = null;
  let euroPerCc = null;
  let percentageAmount = null;
  let minimumAmount = null;
  let duty;

  if (ageGroup === '7+') {
    euroPerCc = 1;
    duty = ccm * euro * euroPerCc;
  } else if (fuel === 'diesel') {
    percent = 10;
    percentageAmount = value * percent / 100;
    if (ageGroup === '5-7' && ccm <= 2500) {
      euroPerCc = 0.13;
      minimumAmount = ccm * euro * euroPerCc;
      duty = Math.max(percentageAmount, minimumAmount);
    } else {
      duty = percentageAmount;
    }
  } else {
    percent = ageGroup === '0-3' && ccm > 2800 ? 12.5 : 15;
    percentageAmount = value * percent / 100;
    duty = percentageAmount;
  }

  const vatBase = value + duty;
  const vat = vatBase * VAT_RATE;
  const utilBracket = PICKUP_UTIL.find(item => mass <= item.maxKg);
  const utilCoefficient = ageGroup === '0-3' ? utilBracket.newCoefficient : utilBracket.oldCoefficient;
  const util = PICKUP_UTIL_BASE * utilCoefficient;
  const category = mass <= 3500 ? 'N1/N1G' : 'N2';

  return {
    customsValueRub: roundRubles(value),
    fuel,
    ageGroup,
    engineCc: ccm,
    maxMassKg: mass,
    category,
    percent,
    euroPerCc,
    percentageAmount: percentageAmount == null ? null : roundRubles(percentageAmount),
    minimumAmount: minimumAmount == null ? null : roundRubles(minimumAmount),
    duty: roundRubles(duty),
    vatBase: roundRubles(vatBase),
    vat: roundRubles(vat),
    customsTotal: roundRubles(duty + vat),
    utilCoefficient,
    util: roundRubles(util),
    total: roundRubles(duty + vat + util)
  };
}

export function parsePositiveNumber(value) {
  const normalized = String(value || '')
    .replace(/\b(?:RUB|USD|EUR|CNY|KRW)\b/gi, '')
    .replace(/[₽€$¥₩]/g, '')
    .replace(/[\s\u00a0]/g, '')
    .replace(',', '.');
  const number = Number(normalized);
  return Number.isFinite(number) && number > 0 ? number : null;
}

export function parseCbrCurrencyRate(xml, currencyCode) {
  const code = String(currencyCode || '').trim().toUpperCase();
  if (code === 'RUB') {
    return { code, nominal: 1, value: 1, unitRate: 1, date: null };
  }
  if (!/^[A-Z]{3}$/.test(code)) return null;
  const source = String(xml || '');
  const blocks = source.match(/<Valute[^>]*>[\s\S]*?<\/Valute>/gi) || [];
  const block = blocks.find(item => new RegExp(`<CharCode>${code}<\\/CharCode>`, 'i').test(item));
  if (!block) return null;
  const nominal = parsePositiveNumber(block.match(/<Nominal>([^<]+)<\/Nominal>/i)?.[1]);
  const value = parsePositiveNumber(block.match(/<Value>([^<]+)<\/Value>/i)?.[1]);
  if (!nominal || !value) return null;
  return {
    code,
    nominal,
    value,
    unitRate: Number((value / nominal).toFixed(10)),
    date: source.match(/<ValCurs[^>]*\bDate="([^"]+)"/i)?.[1] || null
  };
}

export function convertCurrencyToRub(amount, rate) {
  const sourceAmount = positiveNumber(amount, 'Стоимость');
  const unitRate = positiveNumber(rate?.unitRate ?? rate, 'Курс валюты');
  return roundRubles(sourceAmount * unitRate);
}

export function parseCbrEuroRate(xml) {
  return parseCbrCurrencyRate(xml, 'EUR')?.unitRate || null;
}
