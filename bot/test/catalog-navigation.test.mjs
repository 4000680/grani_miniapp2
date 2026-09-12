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
