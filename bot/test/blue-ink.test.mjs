import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { encode, decode } from 'fast-png';
import { canUseBlueInk, setBlueInkAccess } from '../src/blue-ink-access.js';
import { handleBlueInkCallback, handleBlueInkUpload, whiteAndBluePng } from '../src/blue-ink.js';

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

test('a document becomes a downloadable PNG once and its result can be deleted', async t => {
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
    if (url.includes('gemini-3.1-flash-lite:')) {
      return Response.json({ candidates: [{ content: { parts: [{ text: 'OTHER' }] } }] });
    }
    const part = { inlineData: { mimeType: 'image/png', data: Buffer.from(sample).toString('base64') } };
    return Response.json({ candidates: [{ content: { parts: [part] } }] });
  });
  const chat = { type: 'private', id: 200 };
  const from = { id: 200 };
  const message = { chat, from, message_id: 11, photo: [{ file_id: 'input' }] };
  assert.equal(await handleBlueInkUpload(env, message, store, telegram), true);
  assert.equal(await handleBlueInkUpload(env, message, store, telegram), true);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].contents[0].parts[1].inlineData.mimeType, 'image/png');
  assert.match(requests[1].contents[0].parts[0].text, /visual reference/);
  const result = calls.find(([method]) => method === 'sendDocument')[1];
  assert.match(result.get('reply_markup'), /blueink:retry/);
  assert.deepEqual(calls.at(-1), ['deleteMessage', { chat_id: 200, message_id: 11 }]);
  const output = result.get('document');
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

test('retry deletes the previous PNG before opening a new upload', async t => {
  const env = fixture(t);
  await setBlueInkAccess(env, 100, 200, true);
  const calls = [];
  const store = { async openBlueInkUpload(id) { calls.push(['open', id]); } };
  const telegram = async (_env, method, args) => {
    calls.push([method, args]);
    return { message_id: 13 };
  };
  await handleBlueInkCallback(env, {
    data: 'blueink:retry', from: { id: 200 },
    message: { chat: { type: 'private', id: 200 }, message_id: 12, from: { is_bot: true }, document: { file_name: 'blue-ink.png' } }
  }, store, telegram, async () => assert.fail('retry should open a new upload'));
  assert.deepEqual(calls[0], ['deleteMessage', { chat_id: 200, message_id: 12 }]);
  assert.match(calls[1][1].text, /Пришлите фото/);
  assert.deepEqual(calls[2], ['open', 13]);
});

test('standalone sketch is recolored at the same pixel positions without image generation', async t => {
  const env = fixture(t);
  await setBlueInkAccess(env, 100, 200, true);
  const input = encode({ width: 3, height: 1, channels: 1,
    data: Uint8Array.of(250, 18, 251) });
  const requested = [];
  t.mock.method(globalThis, 'fetch', async url => {
    if (url.startsWith('https://api.telegram.org/')) return new Response(input);
    requested.push(url);
    return Response.json({ candidates: [{ content: { parts: [{ text: 'DRAWING' }] } }] });
  });
  let result;
  const telegram = async (_env, name, data) => {
    if (name === 'getFile') return { file_path: 'sketch.png' };
    if (name === 'sendDocument') result = data.get('document');
  };
  await handleBlueInkUpload(env, {
    chat: { type: 'private', id: 200 }, from: { id: 200 }, message_id: 11, photo: [{ file_id: 'sketch' }]
  }, { async claimBlueInkUpload() { return { promptId: 10 }; } }, telegram);
  assert.equal(requested.length, 1);
  assert.match(requested[0], /flash-lite:generateContent/);
  const { width, height, data } = decode(new Uint8Array(await result.arrayBuffer()));
  assert.deepEqual([width, height], [3, 1]);
  assert.deepEqual([...data.slice(0, 3), ...data.slice(6)], Array(6).fill(255));
  assert.ok(data[3] < data[4] && data[4] < data[5] && data[5] < 255);
});

test('white margins are cropped without scaling or distorting the strokes', () => {
  const width = 100;
  const height = 80;
  const data = new Uint8Array(width * height * 3).fill(255);
  for (const x of [35, 50]) data.set([20, 50, 155], (40 * width + x) * 3);
  const result = decode(whiteAndBluePng(encode({ width, height, channels: 3, data })));
  assert.deepEqual([result.width, result.height], [32, 17]);
  const bluePixels = [];
  for (let pixel = 0; pixel < result.data.length; pixel += 3) {
    if (result.data[pixel] < 255) bluePixels.push(pixel / 3);
  }
  assert.deepEqual(bluePixels, [8 * result.width + 8, 8 * result.width + 23]);
});
