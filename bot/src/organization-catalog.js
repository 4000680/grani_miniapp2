export const ORGANIZATION_CATEGORIES = {
  lab: { section: 'epts', title: 'Испытательные лаборатории', flag: 'eptsSbkts' },
  eaeu: { section: 'epts', title: 'Автомобиль из ЕАЭС', flag: 'eptsEaeu' },
  changeExcluded: { section: 'epts', title: 'Изменение ЭПТС после исключения', flag: 'eptsChangeExcluded' },
  changeClosed: { section: 'epts', title: 'Изменение ЭПТС после прекращения', flag: 'eptsChangeClosed' },
  epsmImport: { section: 'epsm', title: 'Ввоз с документом соответствия', flag: 'epsmImportConformity' },
  epsmEaeu: { section: 'epsm', title: 'Самоходная машина из ЕАЭС', flag: 'epsmEaeu' },
  epsmChangeExcluded: { section: 'epsm', title: 'Изменение ЭПСМ после исключения', flag: 'epsmChangeExcluded' },
  epsmChangeClosed: { section: 'epsm', title: 'Изменение ЭПСМ после прекращения', flag: 'epsmChangeClosed' }
};

export function categoryOrganizations(catalog, key) {
  const category = ORGANIZATION_CATEGORIES[key];
  if (!category) return [];
  return catalog.organizations.filter(item => item.authorities?.[category.flag]);
}

export function paginateOrganizations(items, page = 0, pageSize = 10) {
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const currentPage = Math.max(0, Math.min(Number(page) || 0, pageCount - 1));
  return {
    items: items.slice(currentPage * pageSize, (currentPage + 1) * pageSize),
    currentPage,
    pageCount,
    total: items.length
  };
}

function normalize(value) {
  return String(value || '').toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]+/g, '');
}

export function searchOrganizations(items, query) {
  const terms = String(query || '').toLowerCase().replace(/ё/g, 'е')
    .split(/[^a-zа-я0-9]+/)
    .filter(word => word.length >= 3 && !['нахожусь', 'город', 'область', 'район'].includes(word));
  if (!terms.length) return [];
  return items.filter(item => {
    const haystack = normalize([item.name, item.address, item.region, item.city].join(' '));
    return terms.every(term => haystack.includes(normalize(term)));
  });
}

export function organizationCard(item) {
  const escapeHtml = value => String(value || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const lines = [`<b>${escapeHtml(item.name || 'Организация')}</b>`];
  if (item.address) lines.push('', `<b>Адрес:</b> ${escapeHtml(item.address)}`);
  if (item.phoneEmail) lines.push(`<b>Контакты:</b> ${escapeHtml(item.phoneEmail)}`);
  return lines.join('\n');
}
