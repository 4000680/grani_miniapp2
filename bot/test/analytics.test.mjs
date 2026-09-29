import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { classify, trackUpdate, recordCompletedCalculation, processCampaignBatch, createCampaign, miniAppProfile } from '../src/analytics.js';

function fakeDb(existingUser = null) {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      const statement = {
        async first() {
          calls.push({ sql, values: [] });
          if (sql.includes('SELECT id,message_text,audience')) return { id: 5, message_text: 'Test', audience: 'all_consented' };
          return null;
        },
        bind(...values) {
          return {
            async first() { calls.push({ sql, values }); return existingUser; },
            async run() { calls.push({ sql, values }); return {}; }
          };
        }
      };
      return statement;
    }
  };
}

test('analytics event mapping never includes entered message text', () => {
  assert.deepEqual(classify({ message: { text: 'Tesla Model 3 2022 1234567', from: { id: 1 }, chat: { type: 'private' } } }), ['message', 'bot', 'text']);
  assert.deepEqual(classify({ message: { document: { mime_type: 'application/pdf' }, from: { id: 1 }, chat: { type: 'private' } } }), ['document', 'documents', 'pdf_upload']);
  assert.deepEqual(classify({ callback_query: { data: 'info:epts' } }), ['service_request', 'epts', 'open']);
});

test('trackUpdate stores a first-start event and does not store user message contents', async () => {
  const db = fakeDb(null);
  await trackUpdate(db, { message: { text: '/start', from: { id: 42, first_name: 'Иван', username: 'ivan' }, chat: { id: 42, type: 'private' } } });
  assert.equal(db.calls.length, 3);
  assert.match(db.calls[0].sql, /SELECT user_id FROM analytics_users/);
  assert.match(db.calls[1].sql, /INSERT INTO analytics_users/);
  assert.match(db.calls[2].sql, /INSERT OR IGNORE INTO analytics_events/);
  assert.equal(db.calls[2].values[5], 'first_start');
  assert.equal(db.calls.some(call => call.values.includes('/start')), false);
});

test('trackUpdate ignores group users', async () => {
  const db = fakeDb();
  await trackUpdate(db, { message: { text: '/start', from: { id: 42 }, chat: { id: -42, type: 'group' } } });
  assert.equal(db.calls.length, 0);
});

test('completed customs calculations are counted without vehicle identifiers', async () => {
  const db = fakeDb();
  await recordCompletedCalculation(db, 42, { source: 'Таможенный расчёт', category: 'M1', vin: 'SECRET' });
  const event = db.calls[0];
  assert.match(event.sql, /INSERT INTO analytics_events/);
  assert.equal(event.values[2], 'customs');
  assert.match(event.sql, /'complete'/);
  assert.equal(JSON.stringify(event.values).includes('SECRET'), false);
});

function campaignDb(recipientIds = ['100', '200']) {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      return {
        async run() { calls.push({ sql, values: [] }); return { meta: { changes: 1 } }; },
        async first() {
          calls.push({ sql, values: [] });
          if (sql.includes('SELECT id,message_text,audience')) return { id: 5, message_text: 'Test', audience: 'all_consented' };
          return null;
        },
        bind(...values) {
          return {
            async first() {
              calls.push({ sql, values });
              if (sql.includes('SELECT id,message_text,audience')) return { id: 5, message_text: 'Test', audience: 'all_consented' };
              if (sql.includes('SELECT COUNT(*) count FROM analytics_campaign_recipients')) return { count: 1 };
              return null;
            },
            async all() { calls.push({ sql, values }); return { results: recipientIds.map(user_id => ({ user_id })) }; },
            async run() { calls.push({ sql, values }); return { meta: { changes: 1 } }; }
          };
        }
      };
    }
  };
}

test('403 delivery failure marks a blocked chat unavailable', async () => {
  const db = campaignDb(['100']);
  await processCampaignBatch(db, async () => { const error = new Error('Forbidden'); error.telegramCode = 403; throw error; }, { error() {}, warn() {} });
  assert.ok(db.calls.some(call => call.sql.includes('UPDATE analytics_users SET chat_available=0') && call.values[0] === '100'));
  assert.ok(db.calls.some(call => call.sql.includes("status='error'")));
});

test('429 rate limit leaves current recipient queued for a later batch', async () => {
  const db = campaignDb(['100']);
  await processCampaignBatch(db, async () => { const error = new Error('Too Many Requests'); error.telegramCode = 429; throw error; }, { error() {}, warn() {} });
  assert.ok(db.calls.some(call => call.sql.includes("status='queued'")));
  assert.equal(db.calls.some(call => call.sql.includes('error_count=error_count+1')), false);
});

function sqliteDb(t) {
  const sqlite = new DatabaseSync(':memory:');
  t.after(() => sqlite.close());
  sqlite.exec(readFileSync(new URL('../../migrations/0001_analytics.sql', import.meta.url), 'utf8'));
  const db = {
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      const bound = values => ({
        async first() { return statement.get(...values) || null; },
        async all() { return { results: statement.all(...values) }; },
        async run() {
          const result = statement.run(...values);
          return { meta: { last_row_id: Number(result.lastInsertRowid), changes: Number(result.changes) } };
        },
        bind(...next) { return bound(next); }
      });
      return bound([]);
    }
  };
  return { db, sqlite };
}

async function enterBot(db, id, text = '/start') {
  await trackUpdate(db, { message: { text, from: { id, first_name: 'User' }, chat: { id, type: 'private' } } });
}

test('all users enter a new broadcast without consent or subscription, with a fixed recipient snapshot', async t => {
  const { db, sqlite } = sqliteDb(t);
  await enterBot(db, 100);
  await enterBot(db, 200, 'Audi A3 2026');
  await enterBot(db, 300);
  sqlite.exec("UPDATE analytics_users SET chat_available=0 WHERE user_id='300'");
  const campaign = await createCampaign(db, 100, 'all_users', 'News');
  assert.equal(campaign.count, 2);
  assert.equal(sqlite.prepare('SELECT SUM(marketing_consent) consent FROM analytics_users').get().consent, 0);
  await enterBot(db, 400);
  const sent = [];
  await processCampaignBatch(db, async (id, text) => sent.push([id, text]));
  assert.deepEqual(sent.sort(), [['100', 'News'], ['200', 'News']]);
  const row = sqlite.prepare('SELECT * FROM analytics_campaigns WHERE id=?').get(campaign.id);
  assert.equal(row.status, 'finished');
  assert.equal(row.sent_count, 2);
});

test('legacy queues do not expand to all users', async t => {
  const { db, sqlite } = sqliteDb(t);
  await enterBot(db, 100);
  await enterBot(db, 200);
  sqlite.exec("UPDATE analytics_users SET marketing_consent=1 WHERE user_id='100'");
  const campaign = await createCampaign(db, 100, 'all_consented', 'Legacy');
  assert.equal(campaign.count, 1);
  const sent = [];
  await processCampaignBatch(db, async id => sent.push(id));
  assert.deepEqual(sent, ['100']);
});

test('test audience sends only to admin and rejects unknown audience', async t => {
  const { db } = sqliteDb(t);
  await enterBot(db, 100);
  await enterBot(db, 200);
  const campaign = await createCampaign(db, 100, 'admin_test', 'Test');
  assert.equal(campaign.count, 1);
  const sent = [];
  await processCampaignBatch(db, async id => sent.push(id));
  assert.deepEqual(sent, ['100']);
  await assert.rejects(createCampaign(db, 100, 'invalid', 'Test'), /Unknown campaign audience/);
});

test('unavailable chat is skipped after queue creation, and a 403 excludes future delivery', async t => {
  const { db, sqlite } = sqliteDb(t);
  await enterBot(db, 100);
  await enterBot(db, 200);
  const campaign = await createCampaign(db, 100, 'all_users', 'Test');
  sqlite.exec("UPDATE analytics_users SET chat_available=0 WHERE user_id='200'");
  const sent = [];
  await processCampaignBatch(db, async id => {
    sent.push(id);
    const error = new Error('Forbidden');
    error.telegramCode = 403;
    throw error;
  }, { error() {}, warn() {} });
  assert.deepEqual(sent, ['100']);
  assert.equal(sqlite.prepare('SELECT chat_available FROM analytics_users WHERE user_id=?').get('100').chat_available, 0);
  assert.equal(sqlite.prepare('SELECT status FROM analytics_campaigns WHERE id=?').get(campaign.id).status, 'finished');
  assert.equal((await createCampaign(db, 100, 'all_users', 'Next')).count, 0);
  await miniAppProfile(db, { id: 100 });
  assert.equal(sqlite.prepare('SELECT chat_available FROM analytics_users WHERE user_id=?').get('100').chat_available, 0);
  await enterBot(db, 100);
  assert.equal(sqlite.prepare('SELECT chat_available FROM analytics_users WHERE user_id=?').get('100').chat_available, 1);
});

test('rate-limited real queue remains ready for retry', async t => {
  const { db, sqlite } = sqliteDb(t);
  await enterBot(db, 100);
  const campaign = await createCampaign(db, 100, 'all_users', 'News');
  await processCampaignBatch(db, async () => {
    const error = new Error('Rate limited');
    error.telegramCode = 429;
    throw error;
  }, { error() {}, warn() {} });
  assert.equal(sqlite.prepare('SELECT status FROM analytics_campaign_recipients WHERE campaign_id=?').get(campaign.id).status, 'queued');
  const sent = [];
  await processCampaignBatch(db, async id => sent.push(id));
  assert.deepEqual(sent, ['100']);
});
