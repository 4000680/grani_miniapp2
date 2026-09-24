import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/index.js', import.meta.url), 'utf8');

test('документ передаёт распознанную категорию в расчёт по декларации', () => {
  assert.match(source, /promptDeclarationFtsName\(env, message\.chat\.id, userId, \{ \.\.\.declarationState, vehicle, util, deadline:/);
  assert.match(source, /<b>Категория:<\/b> \$\{escapeHtml\(vehicle\.categoryLabel \|\| vehicle\.category \|\| '—'\)\}/);
});

test('поиск по шаблону СЭП запрашивает группу категории до расчёта декларации', () => {
  const declarationCatalogPart = source.slice(source.indexOf("const calculation = query.data.match"), source.indexOf("if (sourceParsed?.customsMode === 'electric')"));
  assert.match(declarationCatalogPart, /category: null/);
  assert.match(declarationCatalogPart, /promptDeclarationCategory\(env, message\.chat\.id, query\.from\?\.id \|\| message\.chat\.id, \{ \.\.\.state, vehicle, categoryBack: backCallback \}, message\)/);
  assert.doesNotMatch(declarationCatalogPart, /const util = calculateUtil\(vehicle\);[\s\S]*?promptDeclarationCategory/);
  assert.match(source, /text: 'M1 \/ M1G', callback_data: 'declaration:category:passenger'/);
  assert.match(source, /text: 'N1 \/ N2', callback_data: 'declaration:category:cargo'/);
  assert.match(source, /category: 'M1', categoryLabel: 'M1 \/ M1G'/);
  assert.match(source, /category: 'N1', categoryLabel: 'N1 \/ N2'/);
});
