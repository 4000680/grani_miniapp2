import directory from './util-rates.json' with { type: 'json' };

function normalCategory(category) {
  const value = String(category || '').toUpperCase();
  return value === 'N1G' ? 'N1' : value;
}

function inRange(value, range) {
  if (!range) return true;
  if (value === null || value === undefined) return range.min === null && range.max === null;
  if (range.min !== null && range.min !== undefined) {
    if (range.minExclusive ? value <= range.min : value < range.min) return false;
  }
  return range.max === null || range.max === undefined || value <= range.max;
}

export function rateYear(requestedYear = new Date().getUTCFullYear()) {
  const year = Number(requestedYear);
  if (!Number.isFinite(year)) return 2026;
  return Math.max(2025, Math.min(2030, Math.trunc(year)));
}

export function cargoTypeCandidates({ category, maxMass, year, age }) {
  const normalizedCategory = normalCategory(category);
  const matches = directory.records.filter(record =>
    record.category === normalizedCategory && record.powertrain === 'any' &&
    record.coefficients?.[rateYear(year)]?.[age] != null && inRange(maxMass, record.mass)
  );
  return [...new Map(matches.map(record => [record.vehicleType, {
    id: record.vehicleType,
    label: record.vehicleTypeLabel
  }])).values()];
}

export function detectCargoType(text = '') {
  const value = String(text).toLowerCase();
  if (/международ|евро[- ]?[56]/i.test(value) && /тягач/i.test(value)) return 'tractor-international';
  if (/седельн|тягач/i.test(value)) return 'tractor';
  if (/самосвал/i.test(value)) return 'dump-truck';
  if (/фургон|рефриж/i.test(value)) return 'van';
  return null;
}

export function selectUtilRate({ category, vehicleType = null, maxMass = null, powertrain = 'combustion', payer = 'commercial', ccm = null, powerKw = null, age, year }) {
  const normalizedCategory = normalCategory(category);
  const selectedYear = rateYear(year);
  const matches = directory.records.filter(record => {
    if (record.category !== normalizedCategory || record.coefficients?.[selectedYear]?.[age] == null) return false;
    if (normalizedCategory === 'M1') {
      return record.powertrain === powertrain && record.payer === payer &&
        inRange(ccm, record.ccm) && inRange(powerKw, record.power);
    }
    return record.powertrain === 'any' && inRange(maxMass, record.mass) &&
      (!vehicleType || record.vehicleType === vehicleType);
  });
  if (!matches.length) return null;
  if (normalizedCategory !== 'M1' && !vehicleType) {
    const types = [...new Set(matches.map(record => record.vehicleType))];
    if (types.length > 1) return { ambiguous: true, candidates: cargoTypeCandidates({ category, maxMass, year: selectedYear, age }) };
  }
  const record = matches[0];
  const coefficient = record.coefficients[selectedYear][age];
  return {
    ...record,
    coefficient,
    amount: Math.round(record.baseRate * coefficient),
    calculationYear: selectedYear
  };
}

export { directory as UTIL_RATE_DIRECTORY };
