import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { canCheckFts, setFtsAccess } from '../src/fts-access.js';
import { ftsNameDifference, ftsNameSimilarity, ftsSearch, offerFtsCheck, handleFtsCallback, ftsResultMessages, requestFts, subscribeFts, runFtsAlarm } from '../src/fts.js';

const vin = 'X7TEST00000000001';
const vehicle = { type: 'sbkts', vin, brand: 'Example', model: 'Car' };
const document = { vin, model: 'Example Car' };
function fixture(t) {
  const sqlite = new DatabaseSync(':memory:'); t.after(() => sqlite.close());
  const db = { prepare(sql) { const statement = sqlite.prepare(sql); const bound = values => ({ bind: (...values) => bound(values), async first() { return statement.get(...values) || null; }, async run() { return statement.run(...values); } }); return bound([]); } };
  return { ADMIN_ID: '100', ANALYTICS_DB: db, AVC_TOKEN: 'synthetic-test-token' };
}
function storage() {
  const data = new Map();
  const store = { async get(key) { return structuredClone(data.get(key)); }, async put(key, value) { data.set(key, structuredClone(value)); },
    async setAlarm(at) { store.alarm = at; }, async deleteAlarm() { store.alarm = null; },
    async transaction(fn) { return fn(store); } };
  return store;
}
const found = { success: 1, found: true, checkedAt: '2026-11-17T15:00:00+03:00', records: [{ vin, model: 'EXAMPLE CAR', releaseDate: '2026-01-01', recyclingFee: [{ paymentStatus: 'Оплачен', personalUse: false }] }] };
const response = data => ({ ok: true, json: async () => data });
const input = (id = 'first', userId = '200') => ({ search: { vin }, userId, callbackId: id, document });

test('FTS access is separate, defaults closed except administrator, fails closed and revokes', async t => {
  const env = fixture(t);
  assert.equal(await canCheckFts(env, 100), true);
  assert.equal(await canCheckFts(env, 200), false);
  await assert.rejects(setFtsAccess(env, 200, 200, true), /Нет доступа/);
  await setFtsAccess(env, 100, 200, true);
  await setFtsAccess(env, 100, 200, true);
  assert.equal(await canCheckFts(env, 200), true);
  await setFtsAccess(env, 100, 200, false);
  assert.equal(await canCheckFts(env, 200), false);
  assert.equal(await canCheckFts({ ADMIN_ID: '100' }, 100), false);
  assert.equal(await canCheckFts({ ...env, ANALYTICS_DB: { prepare() { throw Error(); } } }, 100), false);
});

test('only explicit document identifiers are used; invalid VIN never becomes an inferred chassis', () => {
  assert.deepEqual(ftsSearch(vehicle), { vin });
  assert.equal(ftsSearch({ ...vehicle, type: 'catalog' }), null);
  assert.equal(ftsSearch({ ...vehicle, vin: 'invalid' }), null);
  assert.deepEqual(ftsSearch({ ...vehicle, vin: '', body: 'NCP51-0123456' }), { body: 'NCP51-0123456' });
});

test('button is hidden without access, in groups and without token; offer creates no API requests', async t => {
  const env = fixture(t), calls = [];
  const send = async (_env, method, data) => calls.push({ method, data });
  env.APPLICATIONS = { getByName: () => ({ saveFtsContext: async value => { assert.deepEqual(value.search, { vin }); return 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'; } }) };
  const message = { from: { id: 200 }, chat: { id: 200, type: 'private' }, message_id: 51 };
  await offerFtsCheck(env, message, vehicle, send);
  assert.equal(calls.length, 0);
  await setFtsAccess(env, 100, 200, true);
  await offerFtsCheck(env, { ...message, chat: { id: -10, type: 'group' } }, vehicle, send);
  await offerFtsCheck({ ...env, AVC_TOKEN: '' }, message, vehicle, send);
  assert.equal(calls.length, 0);
  await offerFtsCheck(env, message, vehicle, send);
  assert.match(calls[0].data.reply_markup.inline_keyboard[0][0].callback_data, /^fts:check:/);
});

test('forged callbacks and revoked access cannot load context or queue paid work', async t => {
  const env = fixture(t), calls = [];
  env.APPLICATIONS = { getByName() { throw Error('must not load'); } };
  const query = { id: 'a', from: { id: 200 }, message: { chat: { id: 200, type: 'private' } }, data: 'fts:check:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' };
  const send = async (_env, method, data) => calls.push(data);
  await handleFtsCallback(env, query, send);
  await setFtsAccess(env, 100, 200, true); await setFtsAccess(env, 100, 200, false);
  await handleFtsCallback(env, query, send);
  assert.equal(calls.length, 2);
  await handleFtsCallback(env, { ...query, from: { id: 201 } }, send);
  await handleFtsCallback(env, { ...query, message: { chat: { id: -1, type: 'group' } } }, send);
  assert.equal(calls.length, 2);
});

test('duplicate callbacks, repeated documents and different allowed users share one paid query', async t => {
  const env = fixture(t), store = storage(), sent = []; let requests = 0;
  await setFtsAccess(env, 100, 200, true); await setFtsAccess(env, 100, 201, true);
  const fetcher = async (url, options) => { requests++; assert.match(url, /\?vin=X7TEST/); assert.equal(options.headers.Authorization, 'Bearer synthetic-test-token'); return response(found); };
  const send = async (_env, method, data) => sent.push(data);
  await subscribeFts(store, env, input()); await subscribeFts(store, env, input());
  await runFtsAlarm(store, env, send, fetcher);
  await subscribeFts(store, env, input('second', '201')); await runFtsAlarm(store, env, send, fetcher);
  await subscribeFts(store, env, input()); await runFtsAlarm(store, env, send, fetcher);
  assert.equal(requests, 1); assert.equal(sent.length, 2);
  assert.match(sent[0].text, /Данные совпадают — 100%/);
});

test('a second click arriving while provider request is in flight joins that same check', async t => {
  const env = fixture(t), store = storage(), sent = []; await setFtsAccess(env, 100, 200, true);
  await subscribeFts(store, env, input());
  let resolveResponse, notifyStarted;
  const started = new Promise(resolve => { notifyStarted = resolve; });
  const pending = new Promise(resolve => { resolveResponse = resolve; });
  let requests = 0;
  const alarm = runFtsAlarm(store, env, async (_env, method, data) => sent.push(data), async () => {
    requests++; notifyStarted(); return pending;
  });
  await started;
  await subscribeFts(store, env, input('while-running'));
  resolveResponse(response(found)); await alarm;
  assert.equal(requests, 1); assert.equal(sent.length, 2);
});

test('click loads the original document context rather than the latest calculation', async t => {
  const env = fixture(t), queued = [];
  await setFtsAccess(env, 100, 200, true);
  env.APPLICATIONS = { getByName(key) {
    if (key === '200') return { getFtsContext: async id => ({ search: { vin }, document: { vin, model: 'Original Document' } }) };
    assert.equal(key, `fts:vin:${vin}`);
    return { subscribeFts: async input => queued.push(input) };
  } };
  await handleFtsCallback(env, { id: 'callback', from: { id: 200 }, message: { chat: { id: 200, type: 'private' } }, data: 'fts:check:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }, async () => ({ message_id: 52 }));
  assert.equal(queued[0].document.model, 'Original Document');
  assert.deepEqual(queued[0].search, { vin });
});

test('PROCESSING polls only within paid window; found false differs from unpaid fee', async t => {
  const env = fixture(t), store = storage(), sent = []; let requests = 0;
  await setFtsAccess(env, 100, 200, true); await subscribeFts(store, env, input());
  const send = async (_env, method, data) => sent.push(data);
  await runFtsAlarm(store, env, send, async () => { requests++; return response({ success: 0, code: 'PROCESSING', retryAfterSec: 60 }); });
  assert.equal(sent.length, 0); assert.equal((await store.get('fts-job')).state, 'queued');
  assert.ok(store.alarm > Date.now());
  await runFtsAlarm(store, env, send, async () => { requests++; return response({ success: 1, found: false, records: [] }); });
  assert.equal(requests, 2); assert.match(sent[0].text, /🔴 Сведения отсутствуют/);
  const long = storage(); await subscribeFts(long, env, input());
  const job = await long.get('fts-job'); job.createdAt = Date.now() - 26 * 60000; await long.put('fts-job', job);
  // An overdue alarm must stop before a request could exceed the provider's 30-minute replay window.
  job.result = { code: 'PROCESSING' }; await long.put('fts-job', job);
  await runFtsAlarm(long, env, send, async () => { throw Error('overdue retry must not run'); });
  assert.equal((await long.get('fts-job')).state, 'done');
});

test('crash recovery and unknown billing never silently repeat an API call', async t => {
  const env = fixture(t), store = storage(); await setFtsAccess(env, 100, 200, true);
  await subscribeFts(store, env, input());
  const job = await store.get('fts-job'); job.state = 'running'; await store.put('fts-job', job);
  let requests = 0;
  await runFtsAlarm(store, env, async () => {}, async () => { requests++; return response(found); });
  assert.equal(requests, 0); assert.equal((await store.get('fts-job')).result.code, 'UNCERTAIN');
  assert.deepEqual(await requestFts(env, { vin }, async () => { throw Error('timeout'); }), { code: 'UNCERTAIN' });
  assert.deepEqual(await requestFts(env, { vin }, async () => response({ success: 1, records: [] })), { code: 'UNCERTAIN' });
});

test('revocation before alarm prevents request; revocation during request hides result', async t => {
  const env = fixture(t), store = storage(); const sent = [];
  await setFtsAccess(env, 100, 200, true); await subscribeFts(store, env, input()); await setFtsAccess(env, 100, 200, false);
  await runFtsAlarm(store, env, async (...args) => sent.push(args), async () => { throw Error('must not request'); });
  assert.equal(sent.length, 0);
  const second = storage(); await setFtsAccess(env, 100, 200, true); await subscribeFts(second, env, input());
  await runFtsAlarm(second, env, async (...args) => sent.push(args), async () => { await setFtsAccess(env, 100, 200, false); return response(found); });
  assert.equal(sent.length, 0);
});

test('compact result keeps VIN, document/FTS names and date; removes technical and fee blocks', () => {
  const result = { ...found, records: [...found.records, { vin: 'OTHER', model: '<bad>', releaseDate: '2025-08-30T03:00:00', recyclingFee: [{ personalUse: null }] }] };
  const messages = ftsResultMessages(result, { ...document, type: 'sbkts' });
  assert.equal(messages.length, 2);
  assert.match(messages[0], /VIN: X7TEST00000000001/);
  assert.match(messages[0], /СБКТС: Example Car/);
  assert.match(messages[0], /ФТС: EXAMPLE CAR/);
  assert.match(messages[0], /Дата выпуска: 01.01.2026/);
  assert.match(messages[0], /✅ Данные совпадают — 100%/);
  assert.match(messages[1], /Дата выпуска: 30.08.2025/);
  assert.match(messages[1], /🔴 Идентификатор не совпадает/);
  assert.match(messages[1], /VIN ФТС: OTHER/);
  assert.match(messages[1], /&lt;bad&gt;/);
  assert.doesNotMatch(messages.join(''), /Проверено:|03:00|15:00|оплачен|оплата|API|requestId|tg-spoiler|Утильсбор/);
  assert.doesNotMatch(ftsResultMessages({ code: 'SOURCE_ERROR' }, document)[0], /оплачена|Код:/);
});

test('name comparison preserves model characters and never rounds a partial match to 100', () => {
  assert.equal(ftsNameSimilarity('EXAMPLE CAR', 'example car'), 100);
  assert.equal(ftsNameSimilarity('CLQ5030XLJ6KM', 'CLQ5030XLJ6KM'), 100);
  assert.equal(ftsNameSimilarity('CHUFEI CLQ5030XLJ6KM', 'CLQ5030XLJ6KM'), 65);
  assert.equal(ftsNameSimilarity('MODEL-X', 'MODEL X'), 85);
  assert.equal(ftsNameSimilarity('A'.repeat(200), 'A'.repeat(199) + 'B'), 99);
  assert.equal(ftsNameSimilarity('', ''), null);
  const partial = ftsResultMessages({ ...found, records: [{ vin, model: 'EXAMPLE CAB' }] }, document)[0];
  assert.match(partial, /🔴 Разные слова или обозначения — 90%/);
  const different = ftsResultMessages({ ...found, records: [{ vin, model: 'ZZZZZZZZZZZ' }] }, document)[0];
  assert.match(different, /🔴 Разные слова или обозначения — 0%/);
  const absent = ftsResultMessages({ found: false, records: [] }, document)[0];
  assert.match(absent, /VIN: X7TEST00000000001/);
  assert.match(absent, /🔴 Сведения отсутствуют/);
});

test('button attaches to existing VIN, preserves declaration actions and creates a separate status before queueing', async t => {
  const env = fixture(t), calls = [], id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  await setFtsAccess(env, 100, 200, true);
  env.APPLICATIONS = { getByName(key) {
    if (key === '200') return { saveFtsContext: async () => id, getFtsContext: async () => ({ search: { vin }, document }) };
    return { subscribeFts: async input => {
      assert.equal(calls.at(-1).method, 'sendMessage'); assert.equal(input.statusMessageId, 52);
    } };
  } };
  const send = async (_env, method, data) => { calls.push({ method, data }); return { message_id: 52 }; };
  const confirmation = { text: 'Confirm', callback_data: 'declaration:fts:confirm' };
  const message = { from: { id: 200 }, chat: { id: 200, type: 'private' }, message_id: 51,
    text: vin, reply_markup: { inline_keyboard: [[confirmation]] } };
  await offerFtsCheck(env, message, vehicle, send);
  assert.equal(calls[0].method, 'editMessageReplyMarkup');
  assert.equal(calls[0].data.message_id, 51);
  assert.equal(calls[0].data.text, undefined);
  assert.deepEqual(calls[0].data.reply_markup.inline_keyboard[0], [confirmation]);
  const withButton = { ...message, reply_markup: calls[0].data.reply_markup };
  await handleFtsCallback(env, { id: 'q', from: { id: 200 }, message: withButton, data: 'fts:check:' + id }, send);
  assert.equal(calls[1].method, 'editMessageReplyMarkup');
  assert.deepEqual(calls[1].data.reply_markup.inline_keyboard, [[confirmation]]);
  assert.equal(calls[2].method, 'sendMessage');
  assert.equal(calls[2].data.text, 'Проверка запущена, ожидаем ответ.');
  assert.equal(calls[2].data.reply_markup, undefined);
  assert.equal(calls.some(call => call.method === 'deleteMessage' || call.method === 'editMessageText'), false);
});

test('replayed click stops at unchanged keyboard without a second waiting message or job', async t => {
  const env = fixture(t), calls = [], id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  await setFtsAccess(env, 100, 200, true);
  env.APPLICATIONS = { getByName(key) {
    if (key === '200') return { getFtsContext: async () => ({ search: { vin }, document }) };
    return { subscribeFts: async () => { throw Error('must not queue'); } };
  } };
  await handleFtsCallback(env, { id: 'duplicate', from: { id: 200 },
    message: { chat: { id: 200, type: 'private' }, message_id: 51,
      reply_markup: { inline_keyboard: [[{ callback_data: 'fts:check:' + id }]] } },
    data: 'fts:check:' + id }, async (_env, method) => {
      calls.push(method); throw Error('message is not modified');
    });
  assert.deepEqual(calls, ['editMessageReplyMarkup']);
});

test('VIN messages in regular and declaration flows get the button without an extra offer message', async t => {
  const env = fixture(t), calls = [];
  await setFtsAccess(env, 100, 200, true);
  env.APPLICATIONS = { getByName: () => ({ saveFtsContext: async () => 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }) };
  const source = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
  const extract = name => { const i = source.indexOf('async function ' + name + '('); return source.slice(i, source.indexOf('\n}', i) + 2); };
  const context = vm.createContext({ offerFtsCheck, console, escapeHtml: String,
    telegram: async (_env, method, data) => { calls.push({ method, data }); return { message_id: 51 }; } });
  vm.runInContext(extract('sendDocumentIdentity') + '\n' + extract('sendDeclarationVin'), context);
  await context.sendDocumentIdentity(env, 200, vehicle);
  assert.deepEqual(calls.map(c => c.method), ['sendMessage', 'editMessageReplyMarkup']);
  assert.match(calls[0].data.text, /X7TEST00000000001/);
  calls.length = 0;
  await context.sendDeclarationVin(env, 200, { ...vehicle, type: 'epts' },
    { inline_keyboard: [[{ text: 'Confirm', callback_data: 'declaration:fts:confirm' }]] });
  assert.deepEqual(calls.map(c => c.method), ['sendMessage', 'editMessageReplyMarkup']);
  assert.equal(calls[0].data.text, vin);
  assert.equal(calls[1].data.reply_markup.inline_keyboard.length, 2);
  calls.length = 0;
  await context.sendDocumentIdentity(env, -200, vehicle);
  assert.deepEqual(calls.map(c => c.method), ['sendMessage']);
});

test('missing words differ from competing tokens or numeric model codes in either direction', () => {
  const report = (a, b) => ftsResultMessages({ found: true, records: [{ vin, model: b }] }, { vin, model: a })[0];
  for (const [a, b] of [
    ['Land Rover Range Rover Velar', 'Land Rover Range Rover R 659'],
    ['Renault Scenic', 'Renault Grand Scenic'],
    ['BMW Model 550', 'BMW Model 551'],
    ['TOYOTA RAV4', 'TOYOTA RAV5']
  ]) {
    const expected = a === 'Renault Scenic' ? 'missing-words' : 'conflicting';
    assert.equal(ftsNameDifference(a, b).kind, expected);
    assert.equal(ftsNameDifference(b, a).kind, expected);
    assert.match(report(a, b), expected === 'conflicting' ? /🔴 Разные слова или обозначения/ : /🟡 Совпадение наименования/);
  }
  assert.deepEqual(ftsNameDifference('Land Rover Range Rover Velar', 'Land Rover Range Rover R 659'),
    { kind: 'conflicting', onlyDocument: ['VELAR'], onlyFts: ['R', '659'] });
  assert.equal(ftsNameDifference('Brand Model R659', 'Brand Model R 659').kind, 'same');
  assert.equal(ftsNameDifference('Model Model', 'Model').kind, 'missing-words');
  assert.equal(ftsNameDifference('', 'Model').kind, 'unavailable');
  assert.match(report('Model-X', 'Model X'), /🟡/);
});

test('result precedes status deletion; duplicate taps and cleanup retries do not query again', async t => {
  const env = fixture(t), store = storage(), calls = []; let requests = 0, failCleanup = true;
  await setFtsAccess(env, 100, 200, true);
  await subscribeFts(store, env, { ...input(), statusMessageId: 51 });
  await subscribeFts(store, env, { ...input('double-tap'), statusMessageId: 51 });
  const fetcher = async () => { requests++; return response(found); };
  const send = async (_env, method, data) => {
    calls.push({ method, data });
    if (method === 'deleteMessage' && failCleanup) throw Error('temporary Telegram failure');
  };
  await assert.rejects(runFtsAlarm(store, env, send, fetcher), /temporary/);
  assert.equal(calls[0].method, 'sendMessage');
  assert.equal(calls[0].data.reply_markup, undefined);
  assert.equal(calls[1].method, 'deleteMessage');
  assert.equal(calls[1].data.message_id, 51);
  failCleanup = false;
  await runFtsAlarm(store, env, send, fetcher);
  assert.equal(requests, 1);
  assert.equal(calls.filter(call => call.method === 'sendMessage').length, 1);
  assert.equal(calls.filter(call => call.method === 'deleteMessage').length, 2);
});

test('failed result delivery leaves waiting message and retries without a new paid request', async t => {
  const env = fixture(t), store = storage(), calls = []; let requests = 0;
  await setFtsAccess(env, 100, 200, true); await subscribeFts(store, env, { ...input(), statusMessageId: 51 });
  const fetcher = async () => { requests++; return response(found); };
  await assert.rejects(runFtsAlarm(store, env, async () => { throw Error('delivery failure'); }, fetcher), /delivery/);
  assert.equal(Object.values((await store.get('fts-job')).subscribers)[0].delivered, false);
  await runFtsAlarm(store, env, async (_env, method) => calls.push(method), fetcher);
  assert.equal(requests, 1); assert.deepEqual(calls, ['sendMessage', 'deleteMessage']);
});

test('administrator card grants and revokes FTS independently; ordinary and group callbacks are ignored', async t => {
  const env = fixture(t), calls = [];
  const source = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
  const extract = name => { const start = source.indexOf(`async function ${name}(`); return source.slice(start, source.indexOf('\n}', start) + 2); };
  const context = vm.createContext({ canCheckSignature: async () => false, canCheckFts, setFtsAccess, escapeHtml: String,
    getAnalyticsUser: async (_db, id) => ({ user_id: id }), clearAdminSession: async () => {},
    telegram: async (_env, method, data) => calls.push(data) });
  vm.runInContext(extract('showAnalyticsUser') + '\n' + extract('handleAnalyticsCallback'), context);
  const query = { from: { id: 100 }, message: { chat: { id: 100, type: 'private' }, message_id: 1 }, data: 'analytics:fts:200:on' };
  await context.handleAnalyticsCallback(env, { ...query, from: { id: 200 } });
  await context.handleAnalyticsCallback(env, { ...query, message: { chat: { id: 100, type: 'group' } } });
  assert.equal(await canCheckFts(env, 200), false);
  await context.handleAnalyticsCallback(env, query); assert.equal(await canCheckFts(env, 200), true);
  assert.equal(calls.at(-1).reply_markup.inline_keyboard.flat().find(b => b.callback_data.startsWith('analytics:fts:')).callback_data, 'analytics:fts:200:off');
  await context.handleAnalyticsCallback(env, { ...query, data: 'analytics:fts:200:off' }); assert.equal(await canCheckFts(env, 200), false);
});
