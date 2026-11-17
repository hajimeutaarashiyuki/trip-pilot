// Service Worker（src/sw.js）只接手自己範圍裡的 App 殼（11-06 第二批；上一批審查的第 4 條）：
// 之前同源的 GET 一律 cache-first、拿到 200 就存，頁面改由桌機伺服器供應之後，同源的打包檔（../pack.json）與需求單端點（../brief）也被攔。
// 做法：在 node:vm 裡跑 sw.js，self／caches／fetch 都是假的——記下哪個請求被 respondWith 接手、哪些網址被 cache.put。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SW = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/sw.js');

/** 在 scope（註冊的範圍）底下裝一個 service worker。putFails：cache.put 一律丟錯（模擬回應帶 Vary: *、配額滿）。 */
async function install(scope, { putFails = false } = {}) {
  const handlers = {};
  const stored = new Map();     // 快取裡有哪些網址
  const fetched = [];           // 走到網路的網址
  const unhandled = [];
  const cache = {
    addAll: async (list) => { for (const u of list) stored.set(new URL(u, scope).href, 'precache'); },
    put: async (req) => { if (putFails) throw new TypeError('Vary header contains *'); stored.set(req.url, 'put'); },
  };
  const context = vm.createContext({
    URL,
    self: { addEventListener: (type, fn) => { handlers[type] = fn; }, registration: { scope }, location: new URL('sw.js', scope), clients: { claim: async () => {} }, skipWaiting: () => {} },
    caches: {
      open: async () => cache,
      keys: async () => [],
      delete: async () => true,
      match: async (req) => (stored.has(req.url.split('?')[0]) ? { cached: req.url } : undefined),
    },
    fetch: async (req) => { fetched.push(req.url); return { ok: true, clone: () => ({}) }; },
    Promise,
  });
  context.self.caches = context.caches;
  vm.runInContext(await readFile(SW, 'utf8'), context, { filename: 'sw.js' });
  const waits = [];
  await handlers.install({ waitUntil: (p) => waits.push(p) });
  await Promise.all(waits);
  const onRejection = (err) => unhandled.push(err);
  process.on('unhandledRejection', onRejection);
  /** 送一個請求給 fetch 事件：回 { handled, response }——handled false＝沒呼叫 respondWith（瀏覽器照平常走網路、不經快取）。 */
  const request = async (url, method = 'GET') => {
    let responded = null;
    handlers.fetch({ request: { url: new URL(url, scope).href, method }, respondWith: (p) => { responded = p; } });
    const response = responded ? await responded : null;
    await new Promise((resolve) => setTimeout(resolve, 5));   // 等背景的 cache.put 跑完
    return { handled: Boolean(responded), response };
  };
  return { request, stored, fetched, unhandled, done: () => process.off('unhandledRejection', onRejection) };
}

test('桌機伺服器供應的頁面（範圍 /app/）：只接手 App 殼（導覽、index.html、manifest、圖示）；同源的打包檔與 /brief 不接手、不進快取', async (t) => {
  const sw = await install('http://127.0.0.1:18810/app/');
  t.after(sw.done);
  assert.deepEqual([...sw.stored.keys()].sort(), ['http://127.0.0.1:18810/app/', 'http://127.0.0.1:18810/app/index.html', 'http://127.0.0.1:18810/app/manifest.webmanifest'], '安裝時預先存的三個網址');
  for (const url of ['./', './index.html', './manifest.webmanifest', './?v=1', './index.html?x=1']) {
    const r = await sw.request(url);
    assert.equal(r.handled, true, url);
    assert.ok(r.response.cached, `${url} 從快取回`);
  }
  assert.deepEqual(sw.fetched, [], '殼都在快取裡，沒走網路');
  // 圖示沒預先存：第一次走網路、存起來，第二次從快取回
  const icon = await sw.request('./icons/icon-192.png');
  assert.equal(icon.handled, true);
  assert.deepEqual(sw.fetched, ['http://127.0.0.1:18810/app/icons/icon-192.png']);
  assert.equal(sw.stored.get('http://127.0.0.1:18810/app/icons/icon-192.png'), 'put');
  assert.ok((await sw.request('./icons/icon-192.png')).response.cached);
  // 殼以外：不接手
  const before = [...sw.stored.keys()];
  for (const url of ['../pack.json', '../', '../2026-08-sendai.json', '../brief', '../brief?name=x', './sw.js', './pack.json', './icons/../../pack.json', './other.js', 'https://example.com/x.png']) {
    assert.equal((await sw.request(url)).handled, false, url);
  }
  assert.equal((await sw.request('./index.html', 'POST')).handled, false, '不是 GET 的不接手');
  assert.equal((await sw.request('../brief', 'HEAD')).handled, false);
  assert.deepEqual([...sw.stored.keys()], before, '快取裡沒有多出打包檔或 /brief');
  assert.deepEqual(sw.unhandled, []);
});

test('別的範圍一樣：GitHub Pages（/trip-pilot/）與經 tailscale 的 /trip-pilot/app/；範圍裡同名的打包檔也不接手', async (t) => {
  const pages = await install('https://example.github.io/trip-pilot/');
  t.after(pages.done);
  assert.equal((await pages.request('./')).handled, true);
  assert.equal((await pages.request('./icons/apple-touch-icon.png')).handled, true);
  assert.equal((await pages.request('./pack.json')).handled, false, '有人把打包檔放在同一層也不存');
  assert.equal((await pages.request('/other-app/index.html')).handled, false, '範圍外的同源頁面不接手');
  const ts = await install('https://desk.example.ts.net/trip-pilot/app/');
  t.after(ts.done);
  assert.equal((await ts.request('./index.html')).handled, true);
  assert.equal((await ts.request('../pack.json')).handled, false);
  assert.equal((await ts.request('../brief')).handled, false);
});

test('存不進快取（回應帶 Vary: *、配額滿）：這次的回應照給，不留一筆沒接住的錯', async (t) => {
  const sw = await install('http://127.0.0.1:18810/app/', { putFails: true });
  t.after(sw.done);
  const r = await sw.request('./icons/icon-512.png');
  assert.equal(r.handled, true);
  assert.equal(r.response.ok, true, '回應還是給了');
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(sw.unhandled, [], 'cache.put 的錯有接住');
  assert.ok(!sw.stored.has('http://127.0.0.1:18810/app/icons/icon-512.png'));
});
