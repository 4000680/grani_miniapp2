import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const apiSource = await readFile(new URL('../../application-api.js', import.meta.url), 'utf8');
const appSource = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
const workerSource = await readFile(new URL('../src/index.js', import.meta.url), 'utf8');
const storeSource = await readFile(new URL('../src/applications-store.js', import.meta.url), 'utf8');

test('Mini App keeps only the three requested bottom tabs and delegates work to the bot', () => {
  assert.match(appSource, /data-screen="home"[\s\S]*?data-screen="history"[\s\S]*?data-screen="profile"/);
  for (const action of ['util', 'penalties', 'payment', 'epts', 'sbkts', 'owner', 'support', 'donate', 'customs_under3', 'customs_over3', 'customs_electric']) {
    assert.ok(appSource.includes(`data-action="${action}"`), `missing Mini App action ${action}`);
  }
  assert.doesNotMatch(appSource, /tabs\/(utilsbor|customs)\//);
  assert.match(workerSource, /if \(url\.pathname === '\/api\/actions'\) return handleMiniAppAction/);
  assert.match(workerSource, /authenticateMiniApp\(request, env\)[\s\S]*?runMiniAppAction\(env, user, action\)/);
  assert.match(workerSource, /customs_over3[\s\S]*?handleCustomsCallback\(env, query\)/);
  assert.match(workerSource, /function menuKeyboard\(env\)[\s\S]*?web_app: \{ url: env\.MINI_APP_URL \}/);
});

test('Mini App keeps its screen open after a bot action and closes only after an explicit chat handoff', () => {
  assert.match(appSource, /async function doAction\(action,element\)[\s\S]*?launchAction\(action\);showHandoff/);
  assert.doesNotMatch(appSource, /async function doAction\(action,element\)[^\n]*tg\.close\(\)/);
  assert.match(appSource, /\$\('handoffGoChat'\)\.addEventListener\('click',[^\n]*tg\.close\(\)/);
  assert.match(appSource, /id="handoffStay"/);
  assert.match(appSource, /tg\.enableVerticalSwipes\?\.\(\)/);
  assert.doesNotMatch(appSource, /tg\.disableVerticalSwipes\?\.\(\)/);
});

test('home and customs screens use automotive photography instead of a hand-drawn car and emoji-only cards', async () => {
  const photoFiles = ['hero-suv.jpg', 'road-car.jpg', 'electric-car.jpg', 'pickup.jpg'];
  for (const photo of photoFiles) {
    const image = await readFile(new URL(`../../assets/${photo}`, import.meta.url));
    assert.ok(image.byteLength > 10_000, `${photo} is missing or unexpectedly small`);
  }
  assert.match(appSource, /assets\/hero-suv\.jpg/);
  assert.match(appSource, /assets\/road-car\.jpg/);
  assert.match(appSource, /assets\/electric-car\.jpg/);
  assert.match(appSource, /assets\/pickup\.jpg/);
  assert.doesNotMatch(appSource, /<div class="hero-car"[^>]*><svg/);
});

test('Mini App inline JavaScript remains syntactically valid', () => {
  const scripts = [...appSource.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)];
  assert.ok(scripts.length > 0, 'inline Mini App script was not found');
  assert.doesNotThrow(() => new Function(scripts.at(-1)[1]));
});

test('Mini App API carries Telegram initData and uses bot-owned history and action routes', async () => {
  const calls = [];
  const context = {
    window: { Telegram: { WebApp: { initData: 'signed-init-data' } } },
    fetch: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, async json() { return { ok: true, items: [], profile: {} }; } };
    },
    encodeURIComponent,
    Error
  };
  vm.runInNewContext(apiSource, context);
  await context.window.GraniAPI.listCalculations();
  await context.window.GraniAPI.getProfile();
  await context.window.GraniAPI.launchAction('util');
  await context.window.GraniAPI.sendCalculation('calc/1');

  assert.deepEqual(calls.map(call => call.url), [
    'https://grani-miniapp2.4000680.workers.dev/api/applications',
    'https://grani-miniapp2.4000680.workers.dev/api/profile',
    'https://grani-miniapp2.4000680.workers.dev/api/actions',
    'https://grani-miniapp2.4000680.workers.dev/api/calculations/calc%2F1/send'
  ]);
  assert.ok(calls.every(call => call.options.headers['x-telegram-init-data'] === 'signed-init-data'));
  assert.equal(JSON.parse(calls[2].options.body).action, 'util');
});

test('history opens and sends the stored result text instead of recalculating it', () => {
  assert.match(workerSource, /stub\.getCalculation\(calculationId\)/);
  assert.match(workerSource, /text: item\.resultText/);
  assert.match(storeSource, /String\(input\.resultText \|\| ''\)\.slice\(0, 16384\)/);
  assert.match(storeSource, /MAX_APPLICATIONS = 20/);
  assert.match(workerSource, /formatDocumentResult\(vehicle, util, deadline\)[\s\S]{0,500}saveApplication\(env, message\.from\?\.id, applicationFromVehicle\(vehicle, util\), result, 'HTML'\)/);
});
