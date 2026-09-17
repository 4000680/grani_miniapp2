import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workerSource = await readFile(new URL('../src/index.js', import.meta.url), 'utf8');

test('keeps a separate back action on every catalog selection step', () => {
  for (const callback of [
    'catalog:back:search',
    'catalog:back:mods',
    'catalog:back:weight',
    'catalog:back:variants:'
  ]) {
    assert.match(workerSource, new RegExp(callback.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.ok((workerSource.match(/text: '← Назад'/g) || []).length >= 4);
});

test('shows large catalog results as selectable pages without an automatic mass prompt', () => {
  assert.match(workerSource, /catalog:variants:/);
  assert.match(workerSource, /paginateCatalogVariants\(variants, page\)/);
  const modificationFlow = workerSource.slice(
    workerSource.indexOf('async function showCatalogModification'),
    workerSource.indexOf('async function sendCatalogWeightPrompt')
  );
  assert.doesNotMatch(modificationFlow, /sendCatalogWeightPrompt/);
  assert.doesNotMatch(modificationFlow, /variants\.length > 10/);
});

test('shows up to 25 modifications as paginated buttons', () => {
  assert.match(workerSource, /modifications\.length > 25/);
  assert.match(workerSource, /catalog:mods:/);
  assert.doesNotMatch(workerSource, /modifications\.length > 12/);
});

test('uses the approved customs transition label and hides the electric hint for a known ICE volume', () => {
  assert.match(workerSource, /Перейти к расчёту утильсбора/);
  assert.doesNotMatch(workerSource, /Продолжить к утильсбору/);
  assert.match(workerSource, /!\(sourceParsed\?\.customsMode === 'passenger' && sourceParsed\.customsCcm\)/);
});
