import registry from './vehicle-body-registry.json' with { type: 'json' };

const normalize = value => String(value || '').normalize('NFKC').toUpperCase()
  .replace(/Ё/g, 'Е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
const starts = (value, prefix) => value === prefix || value.startsWith(prefix + ' ');

// Reviewed body data is a hint only. It never overrides a document category.
export function pickupBodyHint(vehicle) {
  const brand = normalize(vehicle.brand), model = normalize(vehicle.model);
  return registry.records.find(record => record.brands.map(normalize).includes(brand) &&
    !record.exclude?.some(value => starts(model, normalize(value))) &&
    record.models.some(value => starts(model, normalize(value)))) || null;
}

export function categoryConfirmationReason(vehicle) {
  if (vehicle.category && vehicle.type !== 'catalog') return null;
  if (pickupBodyHint(vehicle)) return 'pickup';
  return Number(vehicle.maxMass) > 5000 ? 'mass' : null;
}

export function cargoCategoryForMass(mass) {
  const value = Number(mass);
  if (!Number.isFinite(value) || value <= 0) return null;
  return value <= 3500 ? 'N1' : value <= 12000 ? 'N2' : 'N3';
}

export function vehicleCategoryOptions(vehicle) {
  const cargo = cargoCategoryForMass(vehicle.maxMass);
  const pickup = Boolean(pickupBodyHint(vehicle));
  return [
    { id: 'M1', label: 'Легковой — M1 / M1G' },
    ...(cargo ? [{ id: cargo, label: `${pickup ? 'Пикап / грузовой' : 'Грузовой'} — ${cargo}` }] : [])
  ];
}

export { registry as VEHICLE_BODY_REGISTRY };
