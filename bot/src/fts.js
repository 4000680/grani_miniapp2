import { reportBotIncident } from './bot-monitoring.js';
import { canCheckFts } from './fts-access.js';

const DAY = 86400000;
const escape = value => String(value ?? 'не указано').slice(0, 300).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const clean = value => String(value || '').replace(/\s/g, '').toUpperCase();
// Preserve punctuation and every model character; only case/spacing are cosmetic.
const comparisonName = value => String(value || '').trim().replace(/\s+/g, ' ').toUpperCase();

export function ftsNameSimilarity(first, second) {
  const a = Array.from(comparisonName(first)), b = Array.from(comparisonName(second));
  if (!a.length || !b.length) return null;
  let row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 0; i < a.length; i++) {
    const next = [i + 1];
    for (let j = 0; j < b.length; j++) {
      next.push(Math.min(next[j] + 1, row[j + 1] + 1, row[j] + (a[i] === b[j] ? 0 : 1)));
    }
    row = next;
  }
  // Never round a partial match up to 100%.
  return Math.floor(100 * (1 - row[b.length] / Math.max(a.length, b.length)));
}

// Compare token multisets, including every numeric designation. A missing
// token on one side differs from two competing words/codes on opposite sides.
export function ftsNameDifference(documentName, ftsName) {
  const tokens = value => comparisonName(value).match(/\p{L}+|\p{N}+/gu) || [];
  const left = tokens(documentName), right = tokens(ftsName);
  if (!left.length || !right.length) return { kind: 'unavailable', onlyDocument: [], onlyFts: [] };
  const remaining = [...right], onlyDocument = [];
  for (const word of left) {
    const index = remaining.indexOf(word);
    if (index < 0) onlyDocument.push(word);
    else remaining.splice(index, 1);
  }
  const kind = onlyDocument.length && remaining.length ? 'conflicting'
    : onlyDocument.length || remaining.length ? 'missing-words' : 'same';
  return { kind, onlyDocument, onlyFts: remaining };
}

function ftsDate(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})(?:$|T|\s)/);
  return match ? `${match[3]}.${match[2]}.${match[1]}` : 'не указана';
}

export function ftsSearch(vehicle) {
  if (!['sbkts', 'epts'].includes(vehicle?.type)) return null;
  const vin = clean(vehicle.vin);
  if (/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) return { vin };
  for (const field of ['body', 'chassis']) {
    const value = clean(vehicle[field]);
    if (/^[A-Z0-9-]{5,40}$/.test(value)) return { [field]: value };
  }
  return null;
}

export async function offerFtsCheck(env, message, vehicle, send, options = {}) {
  const userId = message.from?.id;
  if (message.chat?.type !== 'private' || String(message.chat.id) !== String(userId) ||
      !env.APPLICATIONS || !await canCheckFts(env, userId)) return;
  if (!env.AVC_TOKEN || !message.message_id) return;
  const search = ftsSearch(vehicle);
  if (!search) return;
  const stub = env.APPLICATIONS.getByName(String(userId));
  const id = await stub.saveFtsContext({ search, document: {
    type: vehicle.type, vin: vehicle.vin || null, body: vehicle.body || null, chassis: vehicle.chassis || null,
    model: [vehicle.brand, vehicle.model].filter(Boolean).join(' ')
  }, createdAt: Date.now() });
  const existing = message.reply_markup?.inline_keyboard || [];
  await send(env, 'editMessageReplyMarkup', { chat_id: userId, message_id: message.message_id,
    reply_markup: { inline_keyboard: [...existing, [{ text: options.declaration ? '🔎 Сверить с ФТС' : '🔎 Проверить ФТС', callback_data: `fts:check:${id}` }]] } });
}

export async function handleFtsCallback(env, query, send) {
  if (!query.data?.startsWith('fts:')) return false;
  const message = query.message;
  const userId = query.from?.id;
  if (message?.chat?.type !== 'private' || String(message.chat.id) !== String(userId)) return true;
  if (query.data === 'fts:close') {
    await send(env, 'deleteMessage', { chat_id: userId, message_id: message.message_id });
    return true;
  }
  if (!await canCheckFts(env, userId)) {
    await send(env, 'sendMessage', { chat_id: userId, text: 'Доступ к проверке ФТС не выдан или отозван.' });
    return true;
  }
  const id = query.data.match(/^fts:check:([a-f0-9-]{36})$/)?.[1];
  const context = id && env.APPLICATIONS ? await env.APPLICATIONS.getByName(String(userId)).getFtsContext(id) : null;
  if (!context || !env.AVC_TOKEN) {
    await send(env, 'sendMessage', { chat_id: userId, text: !env.AVC_TOKEN ? 'Проверка ФТС ещё не настроена.' : 'Кнопка устарела. Загрузите документ заново.' });
    return true;
  }
  // One object per identifier serializes paid requests across all users/documents.
  const [field, value] = Object.entries(context.search)[0];
  const job = env.APPLICATIONS.getByName(`fts:${field}:${value}`);
  // Keep the VIN text and all unrelated buttons. Only the FTS action is
  // consumed; a duplicate Telegram callback sees "not modified" and stops.
  const originalMarkup = message.reply_markup || { inline_keyboard: [] };
  const remainingButtons = (originalMarkup.inline_keyboard || [])
    .map(row => row.filter(button => !button.callback_data?.startsWith('fts:check:')))
    .filter(row => row.length);
  try {
    await send(env, 'editMessageReplyMarkup', { chat_id: userId, message_id: message.message_id,
      reply_markup: { inline_keyboard: remainingButtons } });
  } catch (error) {
    if (!/message is not modified/i.test(error.message || '')) {
      await reportBotIncident(env, { section: 'fts', userId, code: 'FTS_BUTTON_FAILED', stage: 'обновление кнопки ФТС' });
      await send(env, 'sendMessage', { chat_id: userId, text: '🔴 Не удалось запустить проверку ФТС: кнопка не обновилась. Попробуйте ещё раз.' });
    }
    return true;
  }
  let waiting;
  try {
    waiting = await send(env, 'sendMessage', { chat_id: userId, text: 'Проверка запущена, ожидаем ответ.' });
    if (!waiting?.message_id) throw new Error('FTS status message was not created');
    await job.subscribeFts({ search: context.search, userId: String(userId), callbackId: query.id,
      document: context.document, statusMessageId: waiting.message_id });
  } catch {
    await reportBotIncident(env, { section: 'fts', userId, code: 'FTS_START_FAILED', stage: 'запуск проверки' });
    await send(env, 'editMessageReplyMarkup', { chat_id: userId, message_id: message.message_id,
      reply_markup: originalMarkup });
    if (waiting?.message_id) await send(env, 'editMessageText', { chat_id: userId, message_id: waiting.message_id,
      text: '🔴 Не удалось запустить проверку ФТС.', reply_markup: { inline_keyboard: [] } });
  }
  return true;
}

export function ftsResultMessages(result, document) {
  const header = ['🔎 <b>Проверка ФТС</b>'];
  if (document.vin) header.push(`VIN: ${escape(document.vin)}`);
  else if (document.body) header.push(`Кузов: ${escape(document.body)}`);
  else if (document.chassis) header.push(`Шасси: ${escape(document.chassis)}`);
  if (result.code) {
    const errors = {
      INSUFFICIENT_BALANCE: 'Проверка недоступна. Обратитесь к администратору.',
      PROCESSING: 'Ответ ФТС пока не получен.',
      UNCERTAIN: 'Ответ ФТС не получен. Обратитесь к администратору.',
      SOURCE_ERROR: 'ФТС не удалось выполнить проверку.',
      ACCESS_REVOKED: 'Доступ к проверке ФТС отозван.'
    };
    return [[...header, '', `🔴 ${errors[result.code] || 'Проверка ФТС временно недоступна.'}`].join('\n')];
  }
  if (!result.found || !result.records?.length) return [[...header, '', '🔴 Сведения отсутствуют.'].join('\n')];
  return result.records.map(record => {
    const fields = ['vin', 'body', 'chassis'].filter(field => document[field] && record[field]);
    const mismatch = fields.some(field => clean(document[field]) !== clean(record[field]));
    const percentage = ftsNameSimilarity(document.model, record.model);
    const difference = ftsNameDifference(document.model, record.model);
    let status;
    if (mismatch) status = '🔴 Идентификатор не совпадает.';
    else if (percentage === null) status = '🔴 Недостаточно данных для сверки наименования.';
    else if (difference.kind === 'conflicting') status = `🔴 Разные слова или обозначения — ${percentage}%.`;
    else if (!fields.length) status = `🟡 Наименование: ${percentage}%. Идентификатор ФТС не указан.`;
    else if (percentage === 100) status = '✅ Данные совпадают — 100%.';
    else status = `🟡 Совпадение наименования: ${percentage}%.`;
    const label = document.type === 'sbkts' ? 'СБКТС' : document.type === 'epts' ? 'ЭПТС' : 'Документ';
    const lines = [
      ...header, '',
      `${label}: ${escape(document.model)}`,
      `ФТС: ${escape(record.model)}`,
      `Дата выпуска: ${ftsDate(record.releaseDate)}`
    ];
    for (const field of fields) {
      if (clean(document[field]) !== clean(record[field])) {
        lines.push(`${field === 'vin' ? 'VIN' : field === 'body' ? 'Кузов' : 'Шасси'} ФТС: ${escape(record[field])}`);
      }
    }
    lines.push('', status);
    if (mismatch && percentage !== null) lines.push(`Совпадение наименования: ${percentage}%.`);
    return lines.join('\n');
  });
}

export async function requestFts(env, search, fetcher = fetch) {
  try {
    const response = await fetcher(`https://api.avtovincod.ru/customs-fts?${new URLSearchParams(search)}`, {
      headers: { Authorization: `Bearer ${env.AVC_TOKEN}` }, signal: AbortSignal.timeout(90000)
    });
    const data = await response.json();
    if (data.success === 0 && typeof data.code === 'string') return { code: data.code, retryAfterSec: data.retryAfterSec };
    if (!response.ok || data.success !== 1 || typeof data.found !== 'boolean' || !Array.isArray(data.records) ||
        (data.found && !data.records.length) || data.records.some(record => !record || typeof record !== 'object')) return { code: 'UNCERTAIN' };
    return { found: data.found, records: data.records, checkedAt: data.checkedAt || null, testMode: data.testMode === true };
  } catch { return { code: 'UNCERTAIN' }; }
}

// Durable alarms outlive the webhook's background time limit. Persist the claim
// before the HTTP call; a crash never silently issues a second paid request.
export async function subscribeFts(storage, env, input) {
  if (!await canCheckFts(env, input.userId)) return;
  await storage.transaction(async tx => {
    let job = await tx.get('fts-job');
    const now = Date.now();
    if (!job || (job.expiresAt && job.expiresAt < now)) job = { search: input.search, state: 'queued', subscribers: {}, createdAt: now };
    const key = `${input.userId}:${input.statusMessageId || input.callbackId}`;
    if (Object.keys(job.subscribers).length >= 1000) throw new Error('FTS subscriber limit');
    if (!job.subscribers[key]) job.subscribers[key] = { userId: input.userId, document: input.document, statusMessageId: input.statusMessageId || null, delivered: false };
    await tx.put('fts-job', job);
    if (job.state !== 'running') await tx.setAlarm(job.nextAt || now + 1);
  });
}

export async function runFtsAlarm(storage, env, send, fetcher = fetch) {
  const job = await storage.transaction(async tx => {
    const current = await tx.get('fts-job');
    if (!current) return null;
    if (current.state === 'running') {
      // Recovery after an interrupted attempt: its billing outcome is unknown.
      current.state = 'done'; current.result = { code: 'UNCERTAIN' }; current.expiresAt = Date.now() + DAY;
    }
    if (current.state === 'queued' && current.result?.code === 'PROCESSING' && Date.now() - current.createdAt >= 25 * 60000) {
      current.state = 'done'; current.expiresAt = Date.now() + DAY;
    }
    if (current.state === 'queued') {
      current.state = 'running';
      await tx.setAlarm(Date.now() + 120000);
    }
    await tx.put('fts-job', current);
    return current;
  });
  if (!job) return;
  if (job.state === 'running') {
    const allowed = await Promise.all(Object.values(job.subscribers).map(s => canCheckFts(env, s.userId)));
    const result = allowed.some(Boolean) && env.AVC_TOKEN ? await requestFts(env, job.search, fetcher) : { code: 'ACCESS_REVOKED' };
    await storage.transaction(async tx => {
      const current = await tx.get('fts-job');
      current.result = result;
      if (result.code === 'PROCESSING' && Date.now() - current.createdAt < 23 * 60000) {
        current.state = 'queued';
        current.nextAt = Date.now() + Math.min(120, Math.max(60, Number(result.retryAfterSec) || 60)) * 1000;
        await tx.setAlarm(current.nextAt);
      } else {
        current.state = 'done'; current.nextAt = null;
        const uncertainOrPaid = !result.code || ['UNCERTAIN', 'SOURCE_ERROR', 'PROCESSING'].includes(result.code);
        current.expiresAt = Date.now() + (uncertainOrPaid ? DAY : 60000);
        await tx.deleteAlarm();
      }
      await tx.put('fts-job', current);
    });
  }
  const completed = await storage.get('fts-job');
  if (completed.state !== 'done') return;
  const incidentCodes = { UNCERTAIN:'FTS_UNCERTAIN', SOURCE_ERROR:'FTS_SOURCE_ERROR', INSUFFICIENT_BALANCE:'FTS_BALANCE', PROCESSING:'FTS_PROCESSING' };
  if (incidentCodes[completed.result?.code] && !completed.incidentReported) {
    const recorded = await reportBotIncident(env, { section: 'fts', userId: Object.values(completed.subscribers)[0]?.userId,
      code: incidentCodes[completed.result.code], stage: 'проверка ФТС' });
    if (recorded) await storage.transaction(async tx => { const current = await tx.get('fts-job'); current.incidentReported = true; await tx.put('fts-job', current); });
  }
  for (const [key, subscriber] of Object.entries(completed.subscribers)) {
    if (!subscriber.delivered) {
      if (await canCheckFts(env, subscriber.userId)) {
        for (const text of ftsResultMessages(completed.result, subscriber.document)) {
          await send(env, 'sendMessage', { chat_id: subscriber.userId,
            text: `${completed.result.testMode ? '🧪 Тестовые данные.\n\n' : ''}${text}`, parse_mode: 'HTML' });
        }
      }
      await storage.transaction(async tx => {
        const current = await tx.get('fts-job');
        current.subscribers[key].delivered = true;
        await tx.put('fts-job', current);
      });
    }
    // Delete only the waiting message, after sending every result. Keep the
    // result and original VIN message. Retry cleanup without another API call.
    if (subscriber.statusMessageId && !subscriber.statusDeleted) {
      try {
        await send(env, 'deleteMessage', { chat_id: subscriber.userId, message_id: subscriber.statusMessageId });
      } catch (error) {
        if (!/message to delete not found/i.test(error.message || '')) throw error;
      }
      await storage.transaction(async tx => {
        const current = await tx.get('fts-job');
        current.subscribers[key].statusDeleted = true;
        await tx.put('fts-job', current);
      });
    }
  }
}
