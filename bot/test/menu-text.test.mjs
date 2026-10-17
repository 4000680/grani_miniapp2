import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../src/index.js', import.meta.url), 'utf8');

test('первый запуск показывает полное приветствие, а главное меню — короткое', () => {
  assert.match(source, /const START_MENU_TEXT = \[/);
  assert.match(source, /const MENU_TEXT = \[/);
  assert.match(source, /command === '\/start'\) \{\s*await telegram\(env, 'setMyCommands', \{\s*commands: \[\s*\{ command: 'menu', description: 'Главное меню' \}\s*\]\s*\}\);\s*await telegram\(env, 'setChatMenuButton', \{\s*menu_button: \{ type: 'commands' \}\s*\}\);\s*await sendMenu\(env, update\.message\.chat\.id, START_MENU_TEXT\)/);
  assert.match(source, /if \(command === '\/menu' \|\| command === '\/help'\) \{\s*await sendMenu\(env, update\.message\.chat\.id\)/);
});


test('главное меню разделяет расчёты и отдельно открывает Mini App', () => {
  assert.match(source, /text: '🛞 Рассчитать утильсбор', callback_data: 'menu:util'/);
  assert.match(source, /text: '🧾 Утильсбор по декларации', callback_data: 'menu:declaration'/);
  assert.match(source, /text: '🧰 Документы и услуги', callback_data: 'menu:services'/);
  assert.match(source, /text: '💳 Реквизиты', callback_data: 'info:payment'/);
  assert.match(source, /text: '📄 Получить ЭПТС', callback_data: 'info:epts'/);
  assert.match(source, /text: '🔎 Скрин СБКТС', callback_data: 'info:sbkts'/);
  assert.match(source, /text: '👤 Собственник ЭПТС', callback_data: 'info:owner'/);
  assert.doesNotMatch(source, /text: '🧪 Испытательные лаборатории', callback_data: 'org:home'/);
  assert.match(source, /\[\s*\{ text: '📄 Получить ЭПТС',[\s\S]*?\{ text: '🔎 Скрин СБКТС'/);
  assert.doesNotMatch(source, /text: '📅 Рассчитать пени'/);
  assert.doesNotMatch(source, /text: '📟 Рассчитать по СБКТС или ЭПТС'/);
  assert.match(source, /function menuKeyboard\(env\)[\s\S]*?web_app: \{ url: env\.MINI_APP_URL \}/);
  assert.match(source, /query\.data === 'menu:util'\) await showUtilStart\(env, query\.message\)/);
  assert.match(source, /query\.data === 'menu:declaration'\) await sendDeclarationStart\(env, query\.message\.chat\.id, query\.from\?\.id \|\| query\.message\.chat\.id\)/);
  assert.match(source, /const UTIL_START_TEXT = \[/);
  assert.match(source, /Для расчёта утильсбора отправьте PDF-файл СБКТС или выписку ЭПТС/);
  assert.match(source, /Для поиска по шаблону СЭП напишите марку, модель и год выпуска/);
});

test('services leave the main menu compact and remain reachable with correct back actions', () => {
  function extract(name) {
    const start=source.indexOf('function '+name+'(');
    return source.slice(start,source.indexOf('\n}',start)+2);
  }
  const context=vm.createContext({});
  vm.runInContext(['menuKeyboard','servicesKeyboard','infoKeyboard'].map(extract).join('\n'),context);
  const main=context.menuKeyboard({MINI_APP_URL:'https://example.test'}).inline_keyboard.flat();
  assert.equal(main.length,7);
  assert.ok(main.some(b=>b.callback_data==='menu:services'));
  assert.ok(!main.some(b=>/^info:(payment|epts|sbkts|owner)$/.test(b.callback_data)));
  const services=context.servicesKeyboard().inline_keyboard.flat();
  for(const action of ['payment','epts','sbkts','owner']) {
    assert.ok(services.some(b=>b.callback_data==='info:'+action));
    const back=context.infoKeyboard(action,{}).inline_keyboard.flat();
    assert.ok(back.some(b=>b.callback_data==='menu:services'));
    assert.ok(back.some(b=>b.callback_data==='menu'));
  }
});

test('старт расчёта по декларации просит документ или поиск СЭП без кнопок выбора', () => {
  assert.match(source, /const DECLARATION_START_TEXT = \[/);
  assert.match(source, /Загрузите СБКТС или выписку ЭПТС/);
  assert.match(source, /найду его в шаблоне СЭП\./);
  assert.match(source, /async function sendDeclarationStart/);
});


test('нижняя кнопка Telegram открывает команды, а не Mini App', () => {
  assert.match(source, /'setChatMenuButton', \{\s*menu_button: \{ type: 'commands' \}/);
  assert.match(source, /\{ command: 'menu', description: 'Главное меню' \}/);
  assert.doesNotMatch(source, /setChatMenuButton[\s\S]{0,200}web_app/);
});


test('в штатной кнопке Telegram остаётся только главное меню', () => {
  assert.match(source, /setMyCommands', \{\s*commands: \[\s*\{ command: 'menu', description: 'Главное меню' \}\s*\]\s*\}/);
  assert.doesNotMatch(source, /command: 'start', description: 'Открыть главное меню'/);
  assert.doesNotMatch(source, /command: 'help', description: 'Помощь'/);
});
