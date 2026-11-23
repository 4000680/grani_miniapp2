import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { encode, decode } from 'fast-png';
import { canUseBlueInk, setBlueInkAccess } from '../src/blue-ink-access.js';
import { handleBlueInkCallback, handleBlueInkUpload, readApprovedWord, whiteAndBluePng } from '../src/blue-ink.js';

function fixture(t) {
  const sqlite = new DatabaseSync(':memory:');
  t.after(() => sqlite.close());
  return {
    ADMIN_ID: '100', BOT_TOKEN: 'test-token', GEMINI_API_KEY: 'test-key',
    ANALYTICS_DB: {
      prepare(sql) {
        const statement = sqlite.prepare(sql);
        const bind = args => ({
          bind: (...values) => bind(values),
          async run() { statement.run(...args); },
          async first() { return statement.get(...args); }
        });
        return bind([]);
      }
    }
  };
}

const sample = encode({
  width: 3, height: 1, channels: 3,
  data: Uint8Array.of(248, 248, 243, 32, 74, 178, 126, 138, 193)
});

test('PNG turns neutral background pure white and retains different blue stroke strengths', () => {
  const { data, channels } = decode(whiteAndBluePng(sample));
  assert.equal(channels, 3);
  assert.deepEqual([...data.slice(0, 3)], [255, 255, 255]);
  assert.ok(data[5] > data[4] && data[4] > data[3]);
  assert.ok(data[6] > data[3] && data[6] < 255);
});

test('classification must approve a single plain word', () => {
  const read = (approved, word) => readApprovedWord([{ text: JSON.stringify({ approved, word }) }]);
  assert.equal(read(true, 'Весна'), 'Весна');
  assert.equal(read(false, 'Весна'), null);
  assert.equal(read(true, 'И.И.'), null);
  assert.equal(read(true, 'Два слова'), null);
});

test('access is closed by default and a grant can be revoked only by the admin', async t => {
  const env = fixture(t);
  assert.equal(await canUseBlueInk(env, 100), false);
  await assert.rejects(setBlueInkAccess(env, 200, 200, true), /Нет доступа/);
  await setBlueInkAccess(env, 100, 200, true);
  assert.equal(await canUseBlueInk(env, 200), true);
  assert.equal(await canUseBlueInk(env, 201), false);
  await setBlueInkAccess(env, 100, 200, false);
  assert.equal(await canUseBlueInk(env, 200), false);
});

test('a photo becomes a downloadable PNG once and its result can be deleted', async t => {
  const env = fixture(t);
  await setBlueInkAccess(env, 100, 200, true);
  const calls = [];
  const requests = [];
  const store = {
    claimed: false,
    async claimBlueInkUpload() {
      if (this.claimed) return 'duplicate';
      this.claimed = true;
      return { promptId: 10 };
    }
  };
  const telegram = async (_env, method, args) => {
    calls.push([method, args]);
    if (method === 'getFile') return { file_path: 'photo.jpg' };
  };
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (url.startsWith('https://api.telegram.org/')) return new Response(sample);
    const payload = JSON.parse(options.body);
    requests.push(payload);
    const part = requests.length === 1 ? { text: '{"approved":true,"word":"Весна"}' }
      : { inlineData: { mimeType: 'image/png', data: Buffer.from(sample).toString('base64') } };
    return Response.json({ candidates: [{ content: { parts: [part] } }] });
  });
  const chat = { type: 'private', id: 200 };
  const from = { id: 200 };
  const message = { chat, from, message_id: 11, photo: [{ file_id: 'input' }] };
  assert.equal(await handleBlueInkUpload(env, message, store, telegram), true);
  assert.equal(await handleBlueInkUpload(env, message, store, telegram), true);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].contents[0].parts[1].inlineData.mimeType, 'image/png');
  assert.equal(requests[1].contents[0].parts.length, 1);
  assert.match(requests[1].contents[0].parts[0].text, /Весна/);
  const output = calls.find(([method]) => method === 'sendDocument')[1].get('document');
  assert.equal(output.name, 'blue-ink.png');
  assert.equal(output.type, 'image/png');
  assert.deepEqual([...decode(new Uint8Array(await output.arrayBuffer())).data.slice(0, 3)], [255, 255, 255]);
  await setBlueInkAccess(env, 100, 200, false);
  await handleBlueInkCallback(env, {
    data: 'blueink:delete', from,
    message: { chat, message_id: 12, from: { is_bot: true }, document: { file_name: output.name } }
  }, store, telegram, async () => {});
  assert.deepEqual(calls.at(-1), ['deleteMessage', { chat_id: 200, message_id: 12 }]);
});
