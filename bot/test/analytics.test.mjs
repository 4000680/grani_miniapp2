import test from 'node:test';
import assert from 'node:assert/strict';
import { classify, trackUpdate, recordCompletedCalculation, processCampaignBatch } from '../src/analytics.js';

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
            async run() { calls.push({ sql, values }); return {}; }
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
