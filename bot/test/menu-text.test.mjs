import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/index.js', import.meta.url), 'utf8');

test('первый запуск показывает полное приветствие, а главное меню — короткое', () => {
  assert.match(source, /const START_MENU_TEXT = \[/);
  assert.match(source, /const MENU_TEXT = \[/);
  assert.match(source, /command === '\/start'\) \{\s*await telegram\(env, 'setChatMenuButton', \{\s*menu_button: \{ type: 'commands' \}\s*\}\);\s*await sendMenu\(env, update\.message\.chat\.id, START_MENU_TEXT\)/);
  assert.match(source, /if \(command === '\/menu' \|\| command === '\/help'\) \{\s*await sendMenu\(env, update\.message\.chat\.id\)/);
});


test('главное меню разделяет обычный расчёт утильсбора и расчёт по декларации', () => {
  assert.match(source, /text: '🛞 Рассчитать утильсбор', callback_data: 'menu:util'/);
  assert.match(source, /text: '🧾 Рассчитать утильсбор по декларации', callback_data: 'menu:declaration'/);
  assert.match(source, /text: '🧪 Список лабораторий', callback_data: 'info:laboratories'/);
  assert.doesNotMatch(source, /text: '📅 Рассчитать пени'/);
  assert.doesNotMatch(source, /text: '📟 Рассчитать по СБКТС или ЭПТС'/);
  assert.doesNotMatch(source, /web_app:\s*\{/);
  assert.match(source, /query\.data === 'menu:util'\) await showUtilStart\(env, query\.message\)/);
  assert.match(source, /query\.data === 'menu:declaration'\) await sendDeclarationStart\(env, query\.message\.chat\.id, query\.from\?\.id \|\| query\.message\.chat\.id\)/);
  assert.match(source, /const UTIL_START_TEXT = \[/);
  assert.match(source, /Для расчёта утильсбора отправьте PDF-файл СБКТС или выписку ЭПТС/);
  assert.match(source, /Для поиска по шаблону СЭП напишите марку, модель и год выпуска/);
});

test('старт расчёта по декларации просит документ или поиск СЭП без кнопок выбора', () => {
  assert.match(source, /const DECLARATION_START_TEXT = \[/);
  assert.match(source, /Загрузите PDF СБКТС или выписку ЭПТС/);
  assert.match(source, /найду его в шаблоне СЭП для дальнейшего расчёта по декларации/);
  assert.match(source, /async function sendDeclarationStart/);
});


test('нижняя кнопка Telegram открывает команды, а не Mini App', () => {
  assert.match(source, /'setChatMenuButton', \{\s*menu_button: \{ type: 'commands' \}/);
  assert.match(source, /\{ command: 'menu', description: 'Главное меню' \}/);
  assert.doesNotMatch(source, /setChatMenuButton[\s\S]{0,200}web_app/);
});
