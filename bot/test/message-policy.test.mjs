import test from 'node:test';
import assert from 'node:assert/strict';
import { isPermanentResultText } from '../src/message-policy.js';
import { readFile } from 'node:fs/promises';

const workerSource = await readFile(new URL('../src/index.js', import.meta.url), 'utf8');

test('recognizes every completed calculation as a permanent result', () => {
  for (const text of [
    '✅ Расчёт утильсбора\nBMW 318 2022',
    '✅ СБКТС распознан',
    '✅ Выписка ЭПТС распознана',
    '✅ Предварительный таможенный расчёт',
    '✅ Полный расчёт автомобиля до 3 лет',
    'Крайний срок уплаты: 22.09.2026'
  ]) assert.equal(isPermanentResultText(text), true, text);

  assert.equal(isPermanentResultText('🔎 Ищу автомобиль в справочнике…'), false);
  assert.equal(isPermanentResultText('✅ Таможенный платёж рассчитан'), false);
});

test('result buttons create a new message and never reuse the completed result', () => {
  assert.match(workerSource, /callback_data: 'calc:result:new'/);
  assert.match(workerSource, /callback_data: 'calc:result:menu'/);
  assert.match(workerSource, /query\.data === 'calc:result:menu'/);
  assert.match(workerSource, /query\.data === 'calc:result:new'/);

  const callbackFlow = workerSource.slice(
    workerSource.indexOf('async function handleCalculationCallback'),
    workerSource.indexOf('async function handleUpdate')
  );
  const permanentMenuBranch = callbackFlow.slice(
    callbackFlow.indexOf("query.data === 'calc:result:menu'"),
    callbackFlow.indexOf("query.data === 'calc:result:new'")
  );
  assert.doesNotMatch(permanentMenuBranch, /deleteMessage|editMessageText/);
});

test('user messages are not registered for automatic cleanup', () => {
  const customsReplyFlow = workerSource.slice(
    workerSource.indexOf('async function handleCustomsReply'),
    workerSource.indexOf('const CATALOG_CCM_BUCKETS')
  );
  const initialTracking = customsReplyFlow.slice(0, customsReplyFlow.indexOf("if (stage === 'catalog-input'"));
  assert.doesNotMatch(initialTracking, /message\.message_id/);
  assert.match(initialTracking, /message\.reply_to_message\?\.message_id/);
});

test('chain navigation clears only bot working cards and keeps final results', () => {
  const temporaryCleanup = workerSource.slice(
    workerSource.indexOf('async function cleanupTemporaryMessages'),
    workerSource.indexOf('function mergeCustomsMessageIds')
  );
  const customsCleanup = workerSource.slice(
    workerSource.indexOf('async function cleanupCustomsMessages'),
    workerSource.indexOf('async function saveApplication')
  );
  const discardFlow = workerSource.slice(
    workerSource.indexOf('async function discardWorkingCard'),
    workerSource.indexOf('async function cleanupTemporaryMessages')
  );
  const catalogBackFlow = workerSource.slice(
    workerSource.indexOf("if (query.data === 'catalog:back:search')"),
    workerSource.indexOf('const variantsBack')
  );

  assert.doesNotMatch(temporaryCleanup, /deleteBotMessage|deleteMessage/);
  assert.match(customsCleanup, /deleteBotMessage/);
  assert.match(discardFlow, /deleteBotMessage/);
  assert.match(catalogBackFlow, /discardWorkingCard/);
  assert.match(workerSource, /else if \(query\.data === 'menu' \|\| query\.data === 'menu:util'\) await sendMenu\(env, query\.message\.chat\.id\)/);
});

test('controlled document errors keep retry, back and main-menu navigation', () => {
  assert.match(workerSource, /📎 Загрузить документ заново/);
  assert.match(workerSource, /callback_data: 'calc:retry:document'/);
  assert.match(workerSource, /callback_data: 'calc:back:document'/);
  assert.match(workerSource, /Отправьте СБКТС или выписку ЭПТС в формате PDF\./);
  assert.match(workerSource, /showInfo\(env, message, 'pdf'\)/);
  assert.doesNotMatch(workerSource, /Убедитесь, что это СБКТС или выписка ЭПТС с текстовым слоем/);
});
