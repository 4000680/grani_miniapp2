import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { canCheckFts, setFtsAccess } from '../src/fts-access.js';
import { ftsSearch, offerFtsCheck, handleFtsCallback, ftsResultMessages, requestFts, subscribeFts, runFtsAlarm } from '../src/fts.js';

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
  const message = { from: { id: 200 }, chat: { id: 200, type: 'private' } };
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
  assert.equal(requests, 1); assert.equal(sent.length, 4);
  assert.match(sent[0].text, /совпадает с документом/);
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
  assert.equal(requests, 1); assert.equal(sent.length, 4);
});

test('click loads the original document context rather than the latest calculation', async t => {
  const env = fixture(t), queued = [];
  await setFtsAccess(env, 100, 200, true);
  env.APPLICATIONS = { getByName(key) {
    if (key === '200') return { getFtsContext: async id => ({ search: { vin }, document: { vin, model: 'Original Document' } }) };
    assert.equal(key, `fts:vin:${vin}`);
    return { subscribeFts: async input => queued.push(input) };
  } };
  await handleFtsCallback(env, { id: 'callback', from: { id: 200 }, message: { chat: { id: 200, type: 'private' } }, data: 'fts:check:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }, async () => {});
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
  assert.equal(requests, 2); assert.match(sent[0].text, /не подтверждает отсутствие/);
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

test('all records and fee rows are shown, false and null are distinct, mismatch warns and HTML is escaped', () => {
  const result = { ...found, records: [...found.records, { vin: 'OTHER', model: '<bad>', recyclingFee: [{ personalUse: null }, { personalUse: true }] }] };
  const messages = ftsResultMessages(result, document);
  assert.equal(messages.length, 5);
  assert.match(messages[1], /пользования: нет/); assert.match(messages[3], /пользования: не указано/); assert.match(messages[4], /пользования: да/);
  assert.match(messages[2], /Идентификатор отличается/); assert.match(messages[2], /&lt;bad&gt;/);
  assert.match(ftsResultMessages({ code: 'SOURCE_ERROR' }, document)[0], /оплачена/);
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
