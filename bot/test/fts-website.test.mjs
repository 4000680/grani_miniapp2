import test from 'node:test';
import assert from 'node:assert/strict';
import { checkWebsiteFts, handleWebsiteFts } from '../src/fts-website.js';

function memoryStorage() {
  let state;
  let queue = Promise.resolve();
  return {
    transaction(operation) {
      const next = queue.then(() => operation({
        get: () => structuredClone(state),
        put: (_, value) => { state = structuredClone(value); },
      }));
      queue = next.catch(() => {});
      return next;
    },
  };
}
const vin = digit => 'WVWZZZ1KZ6W00000' + digit;
const browser = '1'.repeat(32);
const ipKey = 'network-one';

test('website FTS deduplicates concurrent lookups and enforces browser limit before spending', async () => {
  const storage = memoryStorage();
  let calls = 0;
  let finish;
  let allowStart;
  const started = new Promise(resolve => { allowStart = resolve; });
  const options = { lookup: async (_, { vin: requested }) => {
    calls += 1;
    if (calls === 1) {
      await new Promise(resolve => { finish = resolve; allowStart(); });
    }
    return { found: true, records: [{ vin: requested, model: 'Vehicle', private: 'ignored' }] };
  } };
  const search = digit => checkWebsiteFts(storage, {}, vin(digit), browser, ipKey, options);
  const first = search(1);
  await started;
  assert.equal((await search(1)).pending, true);
  finish();
  assert.deepEqual(await first, { found: true, records: [{ vin: vin(1), model: 'Vehicle' }] });
  await search(1);
  await search(2);
  await search(3);
  assert.deepEqual(await search(4), { code: 'DEVICE_LIMIT' });
  assert.equal(calls, 3);
});

test('website FTS polls only processing responses and does not retry uncertain requests', async () => {
  const storage = memoryStorage();
  let time = Date.parse('2026-11-19T12:00:00Z');
  let calls = 0;
  const options = { now: () => time, lookup: async () => ++calls === 1
    ? { code: 'PROCESSING', retryAfterSec: 60 }
    : { code: 'UNCERTAIN' } };
  const search = () => checkWebsiteFts(storage, {}, vin(1), browser, ipKey, options);
  assert.deepEqual(await search(), { pending: true, retryAfterSec: 60 });
  assert.equal((await search()).pending, true);
  assert.equal(calls, 1);
  time += 60_000;
  assert.equal((await search()).code, 'UNAVAILABLE');
  time += 60_000;
  assert.equal((await search()).code, 'UNAVAILABLE');
  assert.equal(calls, 2);
});

test('website API validates requests before touching a paid lookup', async () => {
  const url = 'https://worker.example/api/website/fts';
  const origin = 'https://grani-br.ru';
  const invalid = await handleWebsiteFts(new Request(url, {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{"vin":"invalid"}',
  }), {});
  assert.equal(invalid.status, 400);
  assert.equal(invalid.headers.get('Access-Control-Allow-Origin'), origin);
  assert.equal((await handleWebsiteFts(new Request(url), {})).status, 403);
  assert.equal((await handleWebsiteFts(new Request(url, { method: 'OPTIONS', headers: { Origin: origin } }), {})).status, 204);
});

test('website quota resets at midnight Moscow time and has a network ceiling', async () => {
  const storage = memoryStorage();
  let time = Date.parse('2026-11-19T20:59:00Z');
  let calls = 0;
  const options = { now: () => time, lookup: async () => {
    calls++;
    return { found: false, records: [] };
  } };
  const search = i => checkWebsiteFts(storage, {}, vin(1), i.toString(16).padStart(32, '0'), ipKey, options);
  for (let i = 0; i < 12; i++) assert.equal((await search(i)).found, false);
  assert.equal((await search(12)).code, 'NETWORK_LIMIT');
  assert.equal(calls, 1);
  time += 60_000;
  assert.equal((await search(12)).found, false);
  assert.equal(calls, 2);
});
