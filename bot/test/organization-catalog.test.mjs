import assert from 'node:assert/strict';
import test from 'node:test';
import catalog from '../src/organizations-catalog.json' with { type: 'json' };
import {
  ORGANIZATION_CATEGORIES,
  categoryOrganizations,
  organizationCard,
  paginateOrganizations,
  searchOrganizations
} from '../src/organization-catalog.js';

test('каталог содержит согласованные списки организаций', () => {
  const expected = {
    lab: 102, eaeu: 75, changeExcluded: 66, changeClosed: 1,
    epsmImport: 219, epsmEaeu: 33, epsmChangeExcluded: 1, epsmChangeClosed: 1
  };
  assert.equal(catalog.organizations.length, 410);
  for (const [key, count] of Object.entries(expected)) {
    assert.ok(ORGANIZATION_CATEGORIES[key]);
    assert.equal(categoryOrganizations(catalog, key).length, count, key);
  }
});

test('каталог выводится страницами по десять организаций', () => {
  const page = paginateOrganizations(categoryOrganizations(catalog, 'lab'), 10);
  assert.equal(page.pageCount, 11);
  assert.equal(page.currentPage, 10);
  assert.equal(page.items.length, 2);
});

test('поиск сопоставляет город, регион и адрес без учёта регистра', () => {
  const items = [
    { name: 'ООО Тест', address: 'г. Самара, ул. Полевая', region: 'Самарская область', city: 'Самара' },
    { name: 'ООО Север', address: 'г. Москва', region: 'Москва', city: 'Москва' }
  ];
  assert.deepEqual(searchOrganizations(items, 'самарская область'), [items[0]]);
  assert.deepEqual(searchOrganizations(items, 'полевая'), [items[0]]);
});

test('карточка организации экранирует данные для Telegram HTML', () => {
  const text = organizationCard({ name: 'ООО <Тест>', address: 'ул. & 1', phoneEmail: '<+7>' });
  assert.match(text, /ООО &lt;Тест&gt;/);
  assert.match(text, /ул\. &amp; 1/);
});
