// 設定頁按「更新」／「從檔案載入」失敗時那一句（app.js updateFromUrl、importFile；11-17）：
// 連不上（fetch 自己丟錯：桌機沒開、不在同一個網路、這台裝置沒有網路；或回應傳到一半斷線、讀本文時丟錯）用白話講，不帶瀏覽器的英文（之前是「更新失敗：Failed to fetch。…」）；
// 回來的不是 JSON（網址打成網頁）也用白話講「不是打包檔，檢查網址」，不帶解析錯誤的英文；
// 其他的錯照舊帶原文（HTTP 狀態碼、這不是 Trip Pilot 的打包檔、打包檔比 App 新…），句尾只講「原本的旅程還在」——之前一律接「沒網路的話，…」，版本不合時讀起來不通。
// 打包檔比 App 新（data/pack.js PACK_VERSION 11-17 升到 2）：不收、原本的旅程與本機改動都還在。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom.js';
import { loadWorld, makeTrip, idsOf, THU, ORDER1, B, WORLD, JP, kb } from './_world.js';
import { TEXT } from '../../src/ui/text.js';
import { PACK_FORMAT, PACK_VERSION } from '../../src/data/pack.js';

const dom = installDom();   // 要在 app.js 載入之前：它一載入就讀 localStorage
const app = await import('../../src/ui/app.js');
const { state } = app;
const realFetch = globalThis.fetch;
const URL_ = 'http://127.0.0.1:1/pack.json';
const OFFLINE = '更新失敗：連不上桌機，或這台裝置沒有網路。這台裝置裡原本的旅程還在。';

function load() {
  dom.storage.clear();
  loadWorld(state, makeTrip());
  state.device = { packUrl: URL_ };
  state.packStatus = '';
  state.route = '#/settings';
  app.replanAll();
}
/** 換掉 fetch 跑一次「更新」；回狀態句。 */
async function update(fakeFetch) {
  const calls = [];
  globalThis.fetch = async (url, init) => { calls.push([String(url), init?.cache]); return fakeFetch(url, init); };
  try { await app.updateFromUrl(); } finally { globalThis.fetch = realFetch; }
  assert.deepEqual(calls, [[URL_, 'no-store']], '打的是設定頁填的那個網址、不吃快取');
  return state.packStatus;
}
const packOf = (version) => ({ meta: { format: PACK_FORMAT, version, generatedAt: '2026-11-17T00:00:00.000Z', cityId: 'c', tripId: 'ui-world' }, city: { id: 'c' }, country: JP, zones: { zones: kb.zones, links: {} }, pois: WORLD, walk: { pairs: {} }, trip: makeTrip(), rules: null });
/**
 * 假的回應，跟瀏覽器的 Response 一樣有 text() 與 json()（json＝讀完本文再解析）。body：字串就是本文、物件先轉成 JSON、函式＝讀本文時叫它（丟錯就是傳到一半斷線）。
 */
const respond = (body, status = 200) => {
  const text = async () => (typeof body === 'function' ? body() : typeof body === 'string' ? body : JSON.stringify(body));
  return { ok: status >= 200 && status < 300, status, text, json: async () => JSON.parse(await text()) };
};
const NOT_PACK = '更新失敗：這個網址回來的不是打包檔，檢查網址有沒有打錯。這台裝置裡原本的旅程還在。';

test('連不上（fetch 自己丟錯）：一句白話，不帶瀏覽器的英文——Chrome 的 Failed to fetch、Safari 的 Load failed、Firefox 的 NetworkError 都一樣；原本的旅程還在、畫在設定頁上', async () => {
  load();
  const before = idsOf(state.plans[THU].plan);
  for (const msg of ['Failed to fetch', 'Load failed', 'NetworkError when attempting to fetch resource.']) {
    state.packStatus = '';
    const status = await update(async () => { throw new TypeError(msg); });
    assert.equal(status, OFFLINE, msg);
    assert.doesNotMatch(status, /[A-Za-z]/, '整句沒有英文字');
  }
  assert.equal(state.trip.id, 'ui-world');
  assert.deepEqual(idsOf(state.plans[THU].plan), before, '旅程沒動');
  assert.deepEqual(dom.lines('status'), [OFFLINE], '設定頁上就是這一句');
  assert.ok(!dom.text().includes('Failed to fetch'));
});

test('還沒有旅程時連不上：不寫「原本的旅程還在」（沒有東西可以還在）', async () => {
  load();
  state.trip = null; state.plans = {};
  assert.equal(await update(async () => { throw new TypeError('Failed to fetch'); }), '更新失敗：連不上桌機，或這台裝置沒有網路。');
  assert.equal(await update(async () => ({ ok: false, status: 404 })), '更新失敗：HTTP 404。');
});

test('傳到一半斷線（回應的標頭到了、讀本文時丟錯）：跟完全連不上同一句白話，不帶瀏覽器的英文（之前只修到 fetch 自己丟錯那一種）；旅程沒動', async () => {
  load();
  const before = idsOf(state.plans[THU].plan);
  for (const msg of ['Failed to fetch', 'Load failed', 'network error', 'The operation was aborted.']) {
    state.packStatus = '';
    const status = await update(async () => respond(() => { throw new TypeError(msg); }));
    assert.equal(status, OFFLINE, msg);
  }
  assert.deepEqual(idsOf(state.plans[THU].plan), before, '旅程沒動');
  assert.deepEqual(dom.lines('status'), [OFFLINE]);
});

test('回來的不是 JSON（網址打成網頁、打成 App 自己的 /app/）：白話講「不是打包檔，檢查網址」，不帶解析錯誤的英文；從檔案載入同理', async () => {
  load();
  for (const body of ['<!doctype html><html><body>Trip Pilot</body></html>', '', 'not json at all', '{"meta":']) {
    const status = await update(async () => respond(body));
    assert.equal(status, NOT_PACK, JSON.stringify(body));
    assert.doesNotMatch(status, /[A-Za-z]/, '整句沒有英文字');
  }
  await app.importFile({ text: async () => '<!doctype html>' });
  assert.equal(state.packStatus, '更新失敗：這個檔案不是打包檔。這台裝置裡原本的旅程還在。');
  assert.equal(state.trip.id, 'ui-world', '旅程還在');
});

test('其他的錯照舊帶原文：HTTP 狀態碼、不是打包檔；句尾不再寫「沒網路的話」', async () => {
  load();
  assert.equal(await update(async () => ({ ok: false, status: 404 })), '更新失敗：HTTP 404。這台裝置裡原本的旅程還在。');
  assert.equal(await update(async () => respond({ hello: 1 })), '更新失敗：這不是 Trip Pilot 的打包檔。這台裝置裡原本的旅程還在。');
  const bad = await update(async () => respond('<html>'));
  assert.equal(bad, NOT_PACK, '回來的不是 JSON：11-17 起不帶解析錯誤的原文（「Unexpected token …」他看不懂）');
  for (const s of [OFFLINE, bad, TEXT.updateFailed('HTTP 500', true), TEXT.updateFailed('HTTP 500', false), TEXT.updateOffline(false)]) assert.doesNotMatch(s, /沒網路的話|undefined|\[object/, s);
  assert.equal(TEXT.updateFailed('HTTP 500'), '更新失敗：HTTP 500。', '沒說有沒有旅程：不多那半句');
  // 連不上之後網址填錯也分得出來：先看有沒有網址
  state.device = {};
  await app.updateFromUrl();
  assert.equal(state.packStatus, '先填桌機的打包檔網址');
});

test(`打包檔比 App 新（版本 ${PACK_VERSION + 1}；App 認到 ${PACK_VERSION}）：不收，那一句讀得通；原本的旅程、規劃頁的改動（localStorage）都還在；一樣新或比較舊的照收到讀檔那一步`, async () => {
  load();
  app.removeStop(THU, B.id);   // 先留一筆本機改動
  const edits = dom.storage.get('trip-pilot:trip-edits');
  assert.ok(edits, '有本機改動');
  const seq = idsOf(state.plans[THU].plan);
  assert.deepEqual(seq, ORDER1.filter((id) => id !== B.id));
  const status = await update(async () => respond(packOf(PACK_VERSION + 1)));
  assert.equal(status, `更新失敗：打包檔版本 ${PACK_VERSION + 1} 比 App 新，先更新 App。這台裝置裡原本的旅程還在。`);
  assert.equal(state.trip.id, 'ui-world');
  assert.deepEqual(idsOf(state.plans[THU].plan), seq, '排出來的行程沒變');
  assert.equal(dom.storage.get('trip-pilot:trip-edits'), edits, '本機改動的鍵沒被動到');
  assert.deepEqual(dom.lines('status'), [status]);
  // 從檔案載入同一份：一樣不收、一樣那一句
  await app.importFile({ text: async () => JSON.stringify(packOf(PACK_VERSION + 1)) });
  assert.equal(state.packStatus, status);
  assert.deepEqual(idsOf(state.plans[THU].plan), seq);
  // 版本一樣（或更舊、沒寫版本）的包過得了版本那道門：不管後面存不存得進去（測試環境沒有 IndexedDB，會停在存檔那一步），那一句都不是在講版本
  for (const v of [PACK_VERSION, 1, undefined]) {
    const s = await update(async () => respond(packOf(v)));
    assert.ok(s && !s.includes('比 App 新') && !s.includes('更新中'), `版本 ${v}：${s}`);
  }
});
