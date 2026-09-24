import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/index.js', import.meta.url), 'utf8');

test('первый запуск показывает полное приветствие, а главное меню — короткое', () => {
  assert.match(source, /const START_MENU_TEXT = \[/);
  assert.match(source, /const MENU_TEXT = \[/);
  assert.match(source, /command === '\/start'\) \{\s*await sendMenu\(env, update\.message\.chat\.id, START_MENU_TEXT\)/);
  assert.match(source, /if \(command === '\/menu' \|\| command === '\/help'\) \{\s*await sendMenu\(env, update\.message\.chat\.id\)/);
});


test('главное меню не выводит пени и отдельную кнопку расчёта по документу', () => {
  assert.match(source, /text: '🛞 Рассчитать утильсбор', callback_data: 'menu:util'/);
  assert.match(source, /text: '🧪 Список лабораторий', callback_data: 'info:laboratories'/);
  assert.doesNotMatch(source, /text: '📅 Рассчитать пени'/);
  assert.doesNotMatch(source, /text: '📟 Рассчитать по СБКТС или ЭПТС'/);
  assert.doesNotMatch(source, /web_app:\s*\{/);
  assert.match(source, /query\.data === 'menu' \|\| query\.data === 'menu:util'/);
});
