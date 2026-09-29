import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { trackUpdate, createCampaign, processCampaignBatch, saveAdminSession } from '../src/analytics.js';
import { sendDirectMessage, receiveCrmReply, listCrmMessages, takeAdminSession } from '../src/crm-messaging.js';
import { registerHooks } from 'node:module';

// The webhook test has no Durable Object binding; only the Cloudflare base class needs a stub.
const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === 'cloudflare:workers') return {
    url: 'data:text/javascript,export class DurableObject {}', shortCircuit: true
  };
  return nextResolve(specifier, context);
} });
const { default: worker } = await import('../src/index.js');
hooks.deregister();

function fixture(t) {
  const sqlite = new DatabaseSync(':memory:');
  t.after(() => sqlite.close());
  sqlite.exec(readFileSync(new URL('../../migrations/0001_analytics.sql', import.meta.url), 'utf8'));
  const db = { prepare(sql) {
    const stmt = sqlite.prepare(sql);
    const bind = values => ({
      bind: (...args) => bind(args),
      async first() { return stmt.get(...values) || null; },
      async all() { return { results: stmt.all(...values) }; },
      async run() { const r = stmt.run(...values); return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; }
    });
    return bind([]);
  } };
  const enter = id => trackUpdate(db, { message: { from: { id }, chat: { id, type: 'private' }, text: '/start' } });
  return { db, sqlite, enter };
}

test('direct message, user reply and admin reply share a saved conversation', async t => {
  const { db, enter } = fixture(t);
  await enter(200);
  const sent = [];
  const send = async (id, text, parent) => { sent.push({ id, text, parent }); return { message_id: 500 + sent.length }; };
  const outgoing = await sendDirectMessage(db, 200, 'Здравствуйте!', send);
  const message = { from: { id: 200 }, chat: { id: 200, type: 'private' }, message_id: 600,
    reply_to_message: { message_id: outgoing.telegram_message_id }, text: 'Есть вопрос' };
  const notifications = [];
  const notify = async incoming => { notifications.push(incoming); return { message_id: 700 }; };
  assert.equal(await receiveCrmReply(db, message, notify), true);
  assert.equal(await receiveCrmReply(db, message, notify), true);
  assert.equal(notifications.length, 1);
  const incoming = notifications[0];
  await sendDirectMessage(db, 200, 'Отвечаю', send, incoming.id);
  assert.equal(sent[1].parent, 600);
  const history = await listCrmMessages(db, 200);
  assert.equal(history.results[0].parent_text, 'Есть вопрос');
  assert.equal(history.results[1].parent_text, 'Здравствуйте!');
  assert.equal((await listCrmMessages(db, 999)).results.length, 0);
});

test('ordinary requests, calculator replies and commands stay outside the CRM conversation', async t => {
  const { db, enter } = fixture(t);
  await enter(200);
  await sendDirectMessage(db, 200, 'Hello', async () => ({ message_id: 501 }));
  const base = { from: { id: 200 }, chat: { id: 200, type: 'private' }, message_id: 600, text: 'Audi 2026' };
  const notify = async () => { throw new Error('Must not notify'); };
  assert.equal(await receiveCrmReply(db, base, notify), false);
  assert.equal(await receiveCrmReply(db, { ...base, reply_to_message: { message_id: 999 } }, notify), false);
  assert.equal(await receiveCrmReply(db, { ...base, text: '/menu', reply_to_message: { message_id: 501 } }, notify), false);
  assert.equal(await receiveCrmReply(db, { ...base, from: { id: 300 }, reply_to_message: { message_id: 501 } }, notify), false);
  assert.equal(await receiveCrmReply(db, { ...base, chat: { type: 'group' }, reply_to_message: { message_id: 501 } }, notify), false);
});

test('reply attachment is represented in CRM and passed to admin notification', async t => {
  const { db, enter } = fixture(t);
  await enter(200);
  await sendDirectMessage(db, 200, 'Hello', async () => ({ message_id: 501 }));
  const message = { from: { id: 200 }, chat: { id: 200, type: 'private' }, message_id: 600,
    reply_to_message: { message_id: 501 }, document: { file_name: 'answer.pdf' } };
  let received;
  assert.equal(await receiveCrmReply(db, message, async (incoming, parent, original) => {
    received = { incoming, original }; return { message_id: 700 };
  }), true);
  assert.equal(received.incoming.message_text, '[Документ: answer.pdf]');
  assert.equal(received.original.document.file_name, 'answer.pdf');
});

test('notification failure keeps a saved reply inside CRM and allows a later notification retry', async t => {
  const { db, enter } = fixture(t);
  await enter(200);
  await sendDirectMessage(db, 200, 'Hello', async () => ({ message_id: 501 }));
  t.mock.method(console, 'error', () => {});
  const message = { from: { id: 200 }, chat: { type: 'private' }, message_id: 600,
    text: 'Reply', reply_to_message: { message_id: 501 } };
  assert.equal(await receiveCrmReply(db, message, async () => { throw new Error('Network error'); }), true);
  assert.equal((await listCrmMessages(db, 200)).results[0].message_text, 'Reply');
  let notified = 0;
  assert.equal(await receiveCrmReply(db, message, async () => { notified++; return { message_id: 700 }; }), true);
  assert.equal(notified, 1);
});

test('confirmation nonce is consumed once and cannot confirm a different draft', async t => {
  const { db } = fixture(t);
  await saveAdminSession(db, 100, { step: 'direct_confirm', nonce: 'new', userId: '200', text: 'Message' });
  assert.equal(await takeAdminSession(db, 100, 'direct_confirm', 'old'), null);
  const claims = await Promise.all([takeAdminSession(db, 100, 'direct_confirm', 'new'), takeAdminSession(db, 100, 'direct_confirm', 'new')]);
  assert.equal(claims.filter(Boolean).length, 1);
});

test('immediate batch and cron cannot send the same recipient simultaneously; broadcast replies are saved', async t => {
  const { db, enter } = fixture(t);
  await enter(200);
  const campaign = await createCampaign(db, 100, 'all_users', 'News');
  let resume;
  const gate = new Promise(resolve => { resume = resolve; });
  let started;
  const start = new Promise(resolve => { started = resolve; });
  const sent = [];
  const immediate = processCampaignBatch(db, async id => { sent.push(id); started(); await gate; return { message_id: 501 }; }, console, campaign.id);
  await start;
  assert.equal(await processCampaignBatch(db, async () => { throw new Error('Duplicate delivery'); }), false);
  resume();
  await immediate;
  assert.deepEqual(sent, ['200']);
  const message = { from: { id: 200 }, chat: { type: 'private' }, message_id: 600,
    text: 'Ответ на рассылку', reply_to_message: { message_id: 501 } };
  assert.equal(await receiveCrmReply(db, message, async () => ({ message_id: 700 })), true);
});

test('delivery lock recovers after expiration and release follows an error', async t => {
  const { db, sqlite, enter } = fixture(t);
  await enter(200);
  const campaign = await createCampaign(db, 100, 'all_users', 'News');
  await listCrmMessages(db, 200);
  sqlite.prepare("INSERT INTO analytics_delivery_locks VALUES('campaign','expired',0)").run();
  await processCampaignBatch(db, async () => { throw new Error('Temporary error'); }, { error() {}, warn() {} }, campaign.id);
  assert.equal(sqlite.prepare('SELECT COUNT(*) count FROM analytics_delivery_locks').get().count, 0);
});

test('direct messages cannot target an unknown user or reply to another user message', async t => {
  const { db, enter } = fixture(t);
  await enter(200);
  await enter(300);
  const outgoing = await sendDirectMessage(db, 200, 'Hello', async () => ({ message_id: 501 }));
  const send = async () => { throw new Error('Must not send'); };
  await assert.rejects(sendDirectMessage(db, 999, 'Hello', send), /CRM_USER_NOT_FOUND/);
  await assert.rejects(sendDirectMessage(db, 300, 'Hello', send, outgoing.id), /CRM_REPLY_NOT_FOUND/);
});

test('webhook enforces admin access, starts delivery on confirmation and routes replies to admin', async t => {
  const { db, enter } = fixture(t);
  await enter(200);
  const calls = [];
  const previousFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = previousFetch; });
  let messageId = 1000;
  globalThis.fetch = async (url, options) => {
    assert.match(String(url), /^https:\/\/api.telegram.org\/botfake-test-token\//);
    const data = JSON.parse(options.body);
    const result = { message_id: ++messageId };
    calls.push({ method: String(url).split('/').at(-1), data, result });
    return Response.json({ ok: true, result });
  };
  const env = { ANALYTICS_DB: db, ADMIN_ID: '100', BOT_TOKEN: 'fake-test-token', WEBHOOK_SECRET: 'test-secret' };
  async function webhook(update) {
    const tasks = [];
    const response = await worker.fetch(new Request('https://test/webhook', {
      method: 'POST', headers: { 'x-telegram-bot-api-secret-token': 'test-secret', 'content-type': 'application/json' },
      body: JSON.stringify(update)
    }), env, { waitUntil(promise) { tasks.push(promise); } });
    assert.equal(response.status, 200);
    await Promise.all(tasks);
  }
  const callback = (id, data) => ({ callback_query: { id: 'query', from: { id }, data,
    message: { message_id: 10, chat: { id, type: 'private' } } } });
  const input = (id, text, extra = {}) => ({ message: { message_id: ++messageId,
    from: { id }, chat: { id, type: 'private' }, text, ...extra } });
  await webhook(callback(200, 'analytics:write:200'));
  assert.equal(calls.filter(c => c.method === 'sendMessage').length, 0);
  const groupCallback = callback(100, 'analytics:write:200');
  groupCallback.callback_query.message.chat = { id: -100, type: 'group' };
  await webhook(groupCallback);
  assert.equal(calls.filter(c => c.method === 'sendMessage').length, 0);
  await webhook(callback(100, 'analytics:write:200'));
  await webhook(input(100, 'Личное сообщение'));
  const preview = calls.at(-1);
  assert.equal(calls.some(c => c.method === 'sendMessage' && c.data.chat_id === '200'), false);
  const confirmation = preview.data.reply_markup.inline_keyboard[0][0].callback_data;
  await webhook(callback(200, confirmation));
  assert.equal(calls.some(c => c.method === 'sendMessage' && c.data.chat_id === '200'), false);
  await webhook(callback(100, confirmation));
  const delivered = calls.find(c => c.method === 'sendMessage' && c.data.chat_id === '200');
  assert.equal(delivered.data.text, 'Личное сообщение');
  await webhook(callback(100, confirmation));
  assert.equal(calls.filter(c => c.method === 'sendMessage' && c.data.chat_id === '200').length, 1);
  await webhook(input(200, 'Спасибо', { reply_to_message: { message_id: delivered.result.message_id } }));
  const notification = calls.at(-1);
  assert.equal(notification.data.chat_id, '100');
  assert.match(notification.data.text, /Спасибо/);
  assert.match(notification.data.reply_markup.inline_keyboard[0][0].callback_data, /^analytics:reply:200:/);
  await webhook(callback(100, 'analytics:broadcast:all_users'));
  await webhook(input(100, 'Новости'));
  const broadcastConfirm = calls.at(-1).data.reply_markup.inline_keyboard[0][0].callback_data;
  await webhook(callback(100, broadcastConfirm));
  assert.equal(calls.filter(c => c.method === 'sendMessage' && c.data.text === 'Новости').length, 2);
});
