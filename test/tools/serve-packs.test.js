// 桌機伺服器（tools/serve-packs.mjs）：打包檔照舊、/app/ 供應 dist、需求單 GET／POST /brief（原話 #188：提交寫成 trips/<名字>.brief.md，同名舊檔先搬歷史、內容相同不動）。
// 每個測試在暫存資料夾起一個 server（埠 0＝系統挑），packs／dist／trips 都是假的；不碰專案真的 trips/，也不碰正在跑的 18810。
// 請求用 node:http 直接送（raw）：fetch 會先把 .. 與 % 整理過，路徑穿越的寫法要原封送到伺服器才算測到。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPackServer, sanitizeBriefName, historyStamp, parseArgs } from '../../tools/serve-packs.mjs';
import { briefMdName } from '../../src/data/brief.js';

const TOOLS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../tools');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 1, 2, 3, 0xff]);
const MD = { 'Content-Type': 'text/markdown; charset=utf-8' };
const BRIEF_V1 = '# 行前需求單（Trip Brief）\n\n| 欄位 | 填 |\n|---|---|\n| 城市（主據點第一個） | 仙台 |\n\n- 要去的：\n  - 作並溫泉\n';
const NAME = '2026-08-仙台';
const q = (name) => `/brief?name=${encodeURIComponent(name)}`;

/** 假的專案資料夾：packs/pack.json、dist/（index.html、sw.js、manifest、icons）、trips/（空），外面放一個怎麼繞都不該拿得到的 secret.txt。 */
async function makeRoot() {
  const root = await mkdtemp(path.join(tmpdir(), 'trip-pilot-serve-'));
  const dirs = { packs: path.join(root, 'packs'), dist: path.join(root, 'dist'), trips: path.join(root, 'trips') };
  await mkdir(dirs.packs);
  await mkdir(path.join(dirs.dist, 'icons'), { recursive: true });
  await mkdir(dirs.trips);
  await writeFile(path.join(dirs.packs, 'pack.json'), '{"meta":{"format":"trip-pilot-pack"}}');
  await writeFile(path.join(dirs.dist, 'index.html'), '<!doctype html><title>Trip Pilot</title><div id="app"></div>');
  await writeFile(path.join(dirs.dist, 'sw.js'), 'self.addEventListener("fetch", () => {});');
  await writeFile(path.join(dirs.dist, 'manifest.webmanifest'), '{"name":"Trip Pilot","start_url":"./","scope":"./"}');
  await writeFile(path.join(dirs.dist, 'icons', 'icon-192.png'), PNG);
  await writeFile(path.join(root, 'secret.txt'), 'SECRET');
  return { root, dirs };
}

async function start(t, { acceptBriefs = true, briefDir, appDir, ...rest } = {}) {
  const { root, dirs } = await makeRoot();
  assert.ok(dirs.trips.startsWith(tmpdir()), '測試的需求單資料夾一定在暫存區，不是專案的 trips/');
  const logs = [];
  const server = createPackServer({ dir: dirs.packs, appDir: appDir === undefined ? dirs.dist : appDir, briefDir: briefDir === undefined ? dirs.trips : briefDir, acceptBriefs, log: (line) => logs.push(line), ...rest });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  });
  return { root, dirs, logs, port: server.address().port };
}

/** 原封送一個請求（路徑不整理）。body 給 Buffer 或字串；回 { status, headers, body, text, json() }。 */
function raw(port, method, target, { headers = {}, body = null } = {}) {
  const payload = body == null ? null : Buffer.from(body);
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: target, agent: false, headers: { ...(payload ? { 'Content-Length': payload.length } : {}), ...headers } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        resolve({ status: res.statusCode, headers: res.headers, body: buf, text: buf.toString('utf8'), json: () => JSON.parse(buf.toString('utf8')) });
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end(payload ?? undefined);
  });
}
const post = (port, name, body, headers = MD) => raw(port, 'POST', q(name), { headers, body });
/** 資料夾底下所有檔（相對路徑、正斜線、排序）。 */
async function tree(dir, prefix = '') {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.isDirectory()) out.push(...await tree(path.join(dir, e.name), `${prefix}${e.name}/`));
    else out.push(`${prefix}${e.name}`);
  }
  return out.sort();
}

test('打包檔照舊：/、/pack.json、帶不帶 /trip-pilot 前綴都拿得到，CORS * 與 no-store；HEAD 沒本文；缺檔 404、跳出 packs/ 的 403、POST 405、OPTIONS 204', async (t) => {
  const { port, logs } = await start(t);
  for (const target of ['/pack.json', '/', '/trip-pilot/pack.json', '/trip-pilot/', '/trip-pilot', '/pack.json?t=1']) {
    const r = await raw(port, 'GET', target);
    assert.equal(r.status, 200, target);
    assert.deepEqual(r.json(), { meta: { format: 'trip-pilot-pack' } }, target);
    assert.equal(r.headers['content-type'], 'application/json; charset=utf-8');
    assert.equal(r.headers['access-control-allow-origin'], '*');
    assert.equal(r.headers['cache-control'], 'no-store');
    assert.equal(r.headers.vary, '*', '打包檔不准進 service worker 的快取：頁面跟它同源時「更新」才不會拿到存住的舊包');
  }
  const head = await raw(port, 'HEAD', '/pack.json');
  assert.equal(head.status, 200);
  assert.equal(head.body.length, 0);
  assert.equal(head.headers['content-length'], '37');
  assert.equal((await raw(port, 'GET', '/nope.json')).status, 404);
  for (const target of ['/..%2Fsecret.txt', '/..%5Csecret.txt', '/%2e%2e%2fsecret.txt', '/..%2Ftrips%2Fx.brief.md']) {
    const r = await raw(port, 'GET', target);
    assert.equal(r.status, 403, target);
    assert.ok(!r.text.includes('SECRET'));
  }
  assert.equal((await raw(port, 'POST', '/pack.json', { headers: MD, body: 'x' })).status, 405);
  const opt = await raw(port, 'OPTIONS', '/pack.json');
  assert.equal(opt.status, 204);
  assert.equal(opt.headers['access-control-allow-origin'], '*');
  assert.ok(logs.some((l) => /^\d{4}-\d\d-\d\dT[\d:.]+Z GET \/pack\.json 200 37$/.test(l)), '每個請求一行 log，格式跟以前一樣');
});

test('壞掉的 % 編碼回 400、伺服器還活著（11-06 之前 async handler 沒接 URIError，一個 GET /% 整支當掉）；路徑裡的 NUL 也是 400', async (t) => {
  const { port } = await start(t);
  for (const target of ['/%', '/app/%E0%A4%A', '/brief%ZZ', '/app/%00', '/%00.json']) assert.equal((await raw(port, 'GET', target)).status, 400, target);
  assert.equal((await raw(port, 'GET', '/pack.json')).status, 200);
});

test('頁面 /app/：index.html、sw.js、manifest、圖示的 Content-Type 都對、no-store；HEAD 沒本文；/app 轉到 app/（相對轉址，帶前綴也對）；service worker 預先快取的三個網址都 200', async (t) => {
  const { port } = await start(t);
  const expected = {
    '/app/': 'text/html; charset=utf-8',
    '/app/index.html': 'text/html; charset=utf-8',
    '/app/sw.js': 'text/javascript; charset=utf-8',
    '/app/manifest.webmanifest': 'application/manifest+json; charset=utf-8',
    '/app/icons/icon-192.png': 'image/png',
  };
  for (const prefix of ['', '/trip-pilot']) {
    for (const [target, type] of Object.entries(expected)) {
      const r = await raw(port, 'GET', prefix + target);
      assert.equal(r.status, 200, prefix + target);
      assert.equal(r.headers['content-type'], type, prefix + target);
      assert.equal(r.headers['cache-control'], 'no-store');
      assert.equal(r.headers.vary, undefined, '頁面的檔不能帶 Vary: *——service worker 安裝時要把它們存進快取（cache.addAll 遇到 Vary: * 會整個失敗）');
    }
  }
  assert.match((await raw(port, 'GET', '/app/')).text, /<title>Trip Pilot<\/title>/);
  assert.deepEqual((await raw(port, 'GET', '/app/icons/icon-192.png')).body, PNG, '二進位檔逐位元組相同');
  assert.equal((await raw(port, 'GET', '/app/?v=1')).status, 200, '帶查詢字串照給');
  const head = await raw(port, 'HEAD', '/app/sw.js');
  assert.equal(head.status, 200);
  assert.equal(head.body.length, 0);
  for (const target of ['/app', '/trip-pilot/app']) {
    const r = await raw(port, 'GET', target);
    assert.equal(r.status, 302, target);
    assert.equal(r.headers.location, 'app/', '相對轉址：/app → /app/、/trip-pilot/app → /trip-pilot/app/（tailscale 會把前綴剝掉，伺服器看不到它）');
  }
  assert.equal((await raw(port, 'GET', '/app?x=1')).headers.location, 'app/?x=1');
  assert.equal((await raw(port, 'GET', '/app/nope.js')).status, 404);
  assert.equal((await raw(port, 'GET', '/app/icons')).status, 404, '資料夾不是檔');
  assert.equal((await raw(port, 'POST', '/app/', { headers: MD, body: 'x' })).status, 405);
  assert.equal((await raw(port, 'GET', '/apple.json')).status, 404, '/app 開頭但不是 /app/ 的照舊當打包檔路徑');
});

test('/app/ 的路徑穿越：各種寫法都拿不到 dist 外面的檔（403／404／400），也不會把 trips 裡的需求單讀出去', async (t) => {
  const { port, dirs } = await start(t);
  await writeFile(path.join(dirs.trips, 'x.brief.md'), 'SECRET-BRIEF');
  await writeFile(path.join(dirs.dist, '.env'), 'SECRET-ENV');
  const attempts = ['/app/..%2Fsecret.txt', '/app/..%5Csecret.txt', '/app/%2e%2e%2fsecret.txt', '/app/%2e%2e/secret.txt', '/app/../secret.txt', '/app/icons/..%2F..%2Fsecret.txt',
    '/app/icons%2F..%2F..%2Fsecret.txt', '/app//secret.txt', '/app/..%2Ftrips%2Fx.brief.md', '/app/....%2F%2Fsecret.txt', '/app/.env', '/app/index.html.', '/app/index.html%20',
    '/app/index.html::$DATA', '/app/C:%5Csecret.txt', '/app/icons/', '/app/%2Fsecret.txt', '/trip-pilot/app/..%2Fsecret.txt', '/app/..%252Fsecret.txt'];
  for (const target of attempts) {
    const r = await raw(port, 'GET', target);
    assert.ok([400, 403, 404].includes(r.status), `${target} → ${r.status}`);
    assert.ok(!r.text.includes('SECRET'), target);
  }
  const off = await start(t, { appDir: null });
  assert.equal((await raw(off.port, 'GET', '/app/')).status, 404, '沒給 appDir 就不供應頁面');
  assert.equal((await raw(off.port, 'GET', '/pack.json')).status, 200);
});

test('GET /brief：{ accepts: true, dir }，頁面用來探測交不交得出去——不給 CORS、Vary: *（不進 service worker 的快取）、X-Trip-Pilot-Brief；HEAD 一樣只是沒本文；帶前綴也通', async (t) => {
  const { port } = await start(t);
  for (const target of ['/brief', '/trip-pilot/brief']) {
    const r = await raw(port, 'GET', target);
    assert.equal(r.status, 200);
    assert.deepEqual(r.json(), { accepts: true, dir: 'trips' });
    assert.equal(r.headers['content-type'], 'application/json; charset=utf-8');
    assert.equal(r.headers['cache-control'], 'no-store');
    assert.equal(r.headers.vary, '*');
    assert.equal(r.headers['x-trip-pilot-brief'], 'accepts');
    assert.equal(r.headers['access-control-allow-origin'], undefined, '別的來源讀不到');
    const head = await raw(port, 'HEAD', target);
    assert.equal(head.status, 200);
    assert.equal(head.body.length, 0);
    assert.equal(head.headers['x-trip-pilot-brief'], 'accepts');
  }
  const opt = await raw(port, 'OPTIONS', '/brief');
  assert.equal(opt.status, 204);
  assert.equal(opt.headers['access-control-allow-origin'], undefined, '預檢不放行：帶自訂標頭的跨來源請求送不出來');
  for (const method of ['PUT', 'DELETE', 'PATCH']) {
    const r = await raw(port, method, '/brief', { headers: MD, body: 'x' });
    assert.equal(r.status, 405, method);
    assert.equal(r.headers.allow, 'GET, HEAD, POST, OPTIONS');
  }
});

test('POST /brief?name=<名字> 寫成 <名字>.brief.md：中文內容與中文檔名逐位元組相同，回 file／replaced／history，記一行 log；帶前綴、text/plain 也收', async (t) => {
  const { port, dirs, logs } = await start(t);
  const r = await post(port, NAME, BRIEF_V1);
  assert.equal(r.status, 200);
  assert.deepEqual(r.json(), { ok: true, file: `trips/${NAME}.brief.md`, replaced: false, history: null, unchanged: false, bytes: Buffer.byteLength(BRIEF_V1) });
  assert.equal(r.headers['access-control-allow-origin'], undefined);
  assert.deepEqual(await readFile(path.join(dirs.trips, `${NAME}.brief.md`)), Buffer.from(BRIEF_V1));
  assert.deepEqual(await tree(dirs.trips), [`${NAME}.brief.md`]);
  const line = logs.find((l) => l.includes('POST /brief'));
  assert.match(line, new RegExp(`^\\S+Z POST /brief\\?name=\\S+ 200 ${Buffer.byteLength(BRIEF_V1)} → trips/${NAME}\\.brief\\.md（新檔）$`), '每次寫入一行 log：大小、寫到哪、是新檔還是取代');
  const viaPrefix = await raw(port, 'POST', `/trip-pilot${q('2026-09-東京')}`, { headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, body: '# 東京\n' });
  assert.equal(viaPrefix.status, 200);
  assert.equal(viaPrefix.json().file, 'trips/2026-09-東京.brief.md');
  assert.equal(await readFile(path.join(dirs.trips, '2026-09-東京.brief.md'), 'utf8'), '# 東京\n');
});

test('同名同內容不動（mtime 不變、沒有歷史資料夾）；同名不同內容：舊的先搬到 _brief-history/<名字>-<YYYYMMDD-HHmmss>.brief.md 再寫——他提交後手改的那份原封留在歷史裡；同一秒再換一次接 -2', async (t) => {
  const clock = { now: new Date(2026, 10, 6, 15, 30, 5) };
  const { port, dirs, logs } = await start(t, { now: () => clock.now });
  const file = path.join(dirs.trips, `${NAME}.brief.md`);
  const history = (name) => path.join(dirs.trips, '_brief-history', name);
  await post(port, NAME, BRIEF_V1);
  const before = (await stat(file)).mtimeMs;
  const same = await post(port, NAME, BRIEF_V1);
  assert.deepEqual(same.json(), { ok: true, file: `trips/${NAME}.brief.md`, replaced: false, history: null, unchanged: true, bytes: Buffer.byteLength(BRIEF_V1) });
  assert.equal((await stat(file)).mtimeMs, before, '內容相同：檔沒被重寫');
  assert.deepEqual(await tree(dirs.trips), [`${NAME}.brief.md`], '沒有歷史資料夾');
  assert.ok(logs.at(-1).endsWith('（內容相同，沒動）'), logs.at(-1));

  const handEdited = `${BRIEF_V1}\n他提交後自己加的一行\n`;
  await writeFile(file, handEdited);
  const v2 = `${BRIEF_V1}- 一日遊：松島\n`;
  const r2 = await post(port, NAME, v2);
  assert.deepEqual(r2.json(), { ok: true, file: `trips/${NAME}.brief.md`, replaced: true, history: `trips/_brief-history/${NAME}-20261106-153005.brief.md`, unchanged: false, bytes: Buffer.byteLength(v2) });
  assert.equal(await readFile(history(`${NAME}-20261106-153005.brief.md`), 'utf8'), handEdited, '手改的那份原封在歷史裡，沒被蓋掉');
  assert.equal(await readFile(file, 'utf8'), v2);
  assert.ok(logs.at(-1).endsWith(`（取代，舊的搬到 trips/_brief-history/${NAME}-20261106-153005.brief.md）`), logs.at(-1));

  const v3 = `${v2}- 夜間站：國分町\n`;
  const r3 = await post(port, NAME, v3);
  assert.equal(r3.json().history, `trips/_brief-history/${NAME}-20261106-153005-2.brief.md`, '同一秒第二次：歷史檔不蓋歷史檔');
  assert.equal(await readFile(history(`${NAME}-20261106-153005.brief.md`), 'utf8'), handEdited);
  assert.equal(await readFile(history(`${NAME}-20261106-153005-2.brief.md`), 'utf8'), v2);

  clock.now = new Date(2026, 10, 7, 9, 0, 0);
  const r4 = await post(port, NAME, v2);
  assert.equal(r4.json().history, `trips/_brief-history/${NAME}-20261107-090000.brief.md`);
  assert.equal(await readFile(file, 'utf8'), v2);
  assert.deepEqual(await tree(dirs.trips), [`${NAME}.brief.md`, `_brief-history/${NAME}-20261106-153005-2.brief.md`, `_brief-history/${NAME}-20261106-153005.brief.md`, `_brief-history/${NAME}-20261107-090000.brief.md`]);
  assert.equal(historyStamp(new Date(2026, 0, 2, 3, 4, 5)), '20260102-030405');
});

test('名字淨化：路徑字元進不了檔名、怎麼寫都落在需求單資料夾裡；空的用 brief-<日期>；整個檔名也收；Windows 裝置名加前綴；最長 80 個字', async (t) => {
  const today = '2026-11-06';
  const table = [
    ['2026-08-仙台', '2026-08-仙台'], ['2026-08-仙台.brief.md', '2026-08-仙台'], ['notes.md', 'notes'], [' 2026-08 仙台 松島 ', '2026-08-仙台-松島'],
    ['../../etc/passwd', 'etc-passwd'], ['..\\..\\windows\\system32', 'windows-system32'], ['C:\\x\\y', 'C-x-y'], ['a/b', 'a-b'], ['a:b*c?d"e<f>g|h', 'a-b-c-d-e-f-g-h'],
    ['東京、鎌倉', '東京-鎌倉'], ['2026-08-ソウル', '2026-08-ソウル'], ['2026-08-ｼﾞｬﾊﾟﾝ', '2026-08-ｼﾞｬﾊﾟﾝ'], ['2026-08-서울', '2026-08-서울'], ['アーケード々', 'アーケード々'], ['𠮷野家-2026', '𠮷野家-2026'],
    ['.hidden', 'hidden'], ['a..b', 'a-b'], ['名前\n改行', '名前-改行'], ['\u0000x', 'x'], ['_draft_', 'draft'],
    ['con', 'brief-con'], ['NUL', 'brief-NUL'], ['COM1', 'brief-COM1'], ['console', 'console'],
    ['', `brief-${today}`], ['   ', `brief-${today}`], ['...', `brief-${today}`], ['-_-', `brief-${today}`], ['/', `brief-${today}`],
    [null, `brief-${today}`], [undefined, `brief-${today}`], [42, `brief-${today}`],
  ];
  for (const [input, want] of table) assert.equal(sanitizeBriefName(input, today), want, JSON.stringify(input));
  assert.equal(sanitizeBriefName('仙'.repeat(200), today), '仙'.repeat(80));
  assert.equal([...sanitizeBriefName(`${'𠮷'.repeat(79)}-x`, today)].length, 79, '80 個字切在 - 上，尾巴的 - 去掉；代理對不會被切一半');
  for (const [input] of table) assert.match(sanitizeBriefName(input, today), /^[\p{L}\p{N}_-]{1,80}$/u, JSON.stringify(input));
  for (const [input] of table) assert.equal(sanitizeBriefName(sanitizeBriefName(input, today), today), sanitizeBriefName(input, today), '淨化過的再淨化一次不變');

  const { port, root, dirs } = await start(t, { now: () => new Date(2026, 10, 6, 12, 0, 0) });
  const send = async (name, body) => (await raw(port, 'POST', name === null ? '/brief' : q(name), { headers: MD, body })).json().file;
  assert.equal(await send('../../evil', 'a'), 'trips/evil.brief.md');
  assert.equal(await send('..\\..\\secret', 'b'), 'trips/secret.brief.md');
  assert.equal(await send('C:\\Windows\\win', 'c'), 'trips/C-Windows-win.brief.md');
  assert.equal(await send('', 'd'), 'trips/brief-2026-11-06.brief.md');
  assert.equal(await send(null, 'd'), 'trips/brief-2026-11-06.brief.md', '沒帶 name 一樣');
  assert.equal(await send(`${NAME}.brief.md`, 'e'), `trips/${NAME}.brief.md`);
  assert.equal(await send('con', 'f'), 'trips/brief-con.brief.md');
  assert.deepEqual(await tree(dirs.trips), ['2026-08-仙台.brief.md', 'C-Windows-win.brief.md', 'brief-2026-11-06.brief.md', 'brief-con.brief.md', 'evil.brief.md', 'secret.brief.md'].sort());
  assert.deepEqual((await readdir(root)).sort(), ['dist', 'packs', 'secret.txt', 'trips'], '需求單資料夾外面沒多出任何東西');
  assert.equal(await readFile(path.join(root, 'secret.txt'), 'utf8'), 'SECRET');
  assert.ok(!existsSync(path.join(root, '..', 'evil.brief.md')));
});

test('頁面算的檔名（briefMdName）過伺服器的淨化不變：畫面講的檔名就是實際寫出來的', () => {
  const today = '2026-11-06';
  const briefs = [
    { city: '仙台', dates: { from: '2026-08-12' } }, { city: '東京、鎌倉', dates: { from: '2026-03-01' } }, { city: ' New  York , Boston', dates: { from: '2026-03-01' } },
    { city: 'a:b/c\\d', dates: { from: '2026-03-01' } }, { city: '仙台' }, { dates: { from: '2026-08-12' } }, {}, null, { city: 'con' }, { city: '???' }, { city: '.hidden.md' },
    { city: '仙'.repeat(200), dates: { from: '2026-08-12' } }, { city: 'ｼﾞｬﾊﾟﾝ ソウル' }, { city: '서울', dates: { from: '2026-12-31' } }, { city: '-_-' }, { city: 'x.brief.md' },
  ];
  for (const b of briefs) {
    const name = briefMdName(b, today);
    assert.equal(sanitizeBriefName(name, today), name, JSON.stringify(b));
    assert.equal(sanitizeBriefName(`${name}.brief.md`, today), name, '整個檔名丟進去也回同一個名字');
  }
});

test('大小上限 256 KB：剛好收、多 1 byte 回 413 且沒寫檔（讀完才回，客戶端拿得到 413 不是斷線）；離譜的大小直接斷線，伺服器還活著', async (t) => {
  const { port, dirs } = await start(t);
  const limit = 256 * 1024;
  const ok = await post(port, 'fits', 'x'.repeat(limit));
  assert.equal(ok.status, 200);
  assert.equal((await stat(path.join(dirs.trips, 'fits.brief.md'))).size, limit);
  for (const size of [limit + 1, 2 * 1024 * 1024]) {
    const r = await post(port, 'big', 'x'.repeat(size));
    assert.equal(r.status, 413, String(size));
    assert.deepEqual(r.json(), { ok: false, error: 'too-large', message: '需求單超過大小上限', limit, size });
  }
  // fetch 也拿得到 413（11-06 試作：邊讀邊斷線的寫法 5 MB 時 fetch 拿到的是 ECONNRESET）
  const viaFetch = await fetch(`http://127.0.0.1:${port}${q('big')}`, { method: 'POST', headers: MD, body: 'x'.repeat(3 * 1024 * 1024) });
  assert.equal(viaFetch.status, 413);
  await viaFetch.text();
  const huge = await post(port, 'huge', Buffer.alloc(6 * 1024 * 1024, 0x78)).then((r) => r.status, (err) => err.code ?? err.message);
  assert.ok(huge === 413 || typeof huge === 'string', `超過硬上限：斷線或 413，拿到 ${huge}`);
  assert.deepEqual(await tree(dirs.trips), ['fits.brief.md']);
  assert.equal((await raw(port, 'GET', '/brief')).status, 200);
  const small = await start(t, { briefMaxBytes: 16 });
  assert.equal((await post(small.port, 'a', '0123456789abcdef')).status, 200);
  assert.equal((await post(small.port, 'b', '0123456789abcdefg')).status, 413);
});

test('本文檢查：Content-Type 不是 text/markdown／text/plain 回 415、空的 400、不是 UTF-8 的 400（cp950 的位元組寫不進去）、BOM 不寫進檔；都沒寫檔', async (t) => {
  const { port, dirs } = await start(t);
  for (const type of ['application/json', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x', 'text/html', 'text/plainx', undefined]) {
    const r = await raw(port, 'POST', q('t'), { headers: type ? { 'Content-Type': type } : {}, body: '# x' });
    assert.equal(r.status, 415, String(type));
    assert.equal(r.json().error, 'bad-type');
  }
  for (const body of ['', '   \n\t', '\ufeff', '\ufeff \n']) {
    const r = await post(port, 'e', body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.equal(r.json().error, 'empty');
  }
  const cp950 = await post(port, 'c', Buffer.from([0xa5, 0x50, 0xa5, 0x78]));   // 「仙台」的 Big5 位元組
  assert.equal(cp950.status, 400);
  assert.deepEqual(cp950.json(), { ok: false, error: 'not-utf8', message: '本文不是 UTF-8' });
  assert.deepEqual(await tree(dirs.trips), []);
  for (const type of ['text/markdown', 'TEXT/Markdown; charset=utf-8', 'text/plain;charset=UTF-8', 'text/plain']) assert.equal((await post(port, 'ok', '# x\n', { 'Content-Type': type })).status, 200, type);
  await post(port, 'bom', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('# 標題\n')]));
  assert.deepEqual(await readFile(path.join(dirs.trips, 'bom.brief.md')), Buffer.from('# 標題\n'));
});

test('來源檢查：別的來源的頁面寫不進來（403、沒寫檔）；同源的收；DNS rebinding（Origin 與 Host 同名但不是本機也不是 ts.net）擋；tailscale 的網域收；沒帶 Origin（curl、node）收', async (t) => {
  const { port, dirs } = await start(t);
  const send = (headers) => raw(port, 'POST', q('o'), { headers: { ...MD, ...headers }, body: `# ${JSON.stringify(headers)}\n` });
  const ts = 'my-desktop.tail0example.ts.net';   // 編的：tailscale serve 給的網域長這樣（這個倉庫是公開的，不寫真的）
  const refused = [
    { Origin: 'https://hajimeutaarashiyuki.github.io' },                         // GitHub Pages 上的頁面
    { Origin: `http://127.0.0.1:${port + 1}` },                                  // 本機另一個埠的頁面（別的 App）
    { Origin: `http://localhost:${port}` },                                      // 主機名跟 Host 對不上
    { Origin: 'null' },                                                          // 沙盒 iframe、file://
    { Origin: `http://evil.example:${port}`, Host: `evil.example:${port}` },     // DNS rebinding：對瀏覽器來說是同源
    { Origin: 'http://evil-ts.net', Host: 'evil-ts.net' },                       // 結尾像 ts.net 但不是它的子網域
    { Origin: 'http://ts.net.evil.example', Host: 'ts.net.evil.example' },
    { Origin: `https://${ts}`, Host: `127.0.0.1:${port}` },                      // tailscale 的來源但請求不是經它來的
    { Origin: 'not a url' },
    { 'Sec-Fetch-Site': 'cross-site' },                                          // 瀏覽器說是跨站的（就算沒帶 Origin）
    { 'Sec-Fetch-Site': 'same-site', Origin: `http://127.0.0.1:${port}` },
  ];
  for (const headers of refused) {
    const r = await send(headers);
    assert.equal(r.status, 403, JSON.stringify(headers));
    assert.deepEqual(r.json(), { ok: false, error: 'cross-origin', message: '只收同一個來源的頁面送來的需求單' });
  }
  assert.deepEqual(await tree(dirs.trips), []);
  const accepted = [
    {},                                                                          // curl、node：不帶 Origin
    { Origin: `http://127.0.0.1:${port}` },                                      // 桌機瀏覽器開 http://127.0.0.1:<埠>/app/
    { Origin: `http://localhost:${port}`, Host: `localhost:${port}` },
    { Origin: `https://${ts}`, Host: ts },                                       // 經 tailscale serve（它保留 Host）
    { Origin: `https://${ts}`, Host: `127.0.0.1:${port}`, 'X-Forwarded-Host': ts },   // 代理改了 Host、原本的留在 X-Forwarded-Host
    { Origin: `HTTPS://${ts.toUpperCase()}`, Host: ts },                         // 大小寫不計
    { Origin: `http://127.0.0.1:${port}`, 'Sec-Fetch-Site': 'same-origin' },     // 瀏覽器實際送的樣子
  ];
  for (const headers of accepted) assert.equal((await send(headers)).status, 200, JSON.stringify(headers));
  // 探測（GET）不看來源：別的來源本來就讀不到回應
  assert.equal((await raw(port, 'GET', '/brief', { headers: { Origin: 'https://example.com' } })).status, 200);
});

test('不收需求單（--no-briefs＝acceptBriefs false，或沒給資料夾）：GET／HEAD /brief 回 404 accepts:false、POST 回 403、什麼都沒寫；打包檔與頁面照常', async (t) => {
  for (const options of [{ acceptBriefs: false }, { briefDir: null }]) {
    const { port, dirs, root } = await start(t, options);
    const get = await raw(port, 'GET', '/brief');
    assert.equal(get.status, 404);
    assert.deepEqual(get.json(), { accepts: false });
    assert.equal(get.headers['x-trip-pilot-brief'], undefined);
    assert.equal((await raw(port, 'HEAD', '/brief')).status, 404);
    const r = await post(port, NAME, BRIEF_V1);
    assert.equal(r.status, 403);
    assert.equal(r.json().error, 'disabled');
    assert.deepEqual(await tree(dirs.trips), []);
    assert.deepEqual((await readdir(root)).sort(), ['dist', 'packs', 'secret.txt', 'trips']);
    assert.equal((await raw(port, 'GET', '/pack.json')).status, 200);
    assert.equal((await raw(port, 'GET', '/app/')).status, 200);
  }
});

test('連按兩下「提交」：同時送兩份一樣的，都 200、只寫一次、沒有歷史檔；同時送兩份不一樣的，一份在檔裡、一份在歷史裡，沒有丟', async (t) => {
  const { port, dirs } = await start(t, { now: () => new Date(2026, 10, 6, 15, 30, 5) });
  const twins = await Promise.all([post(port, NAME, BRIEF_V1), post(port, NAME, BRIEF_V1)]);
  assert.deepEqual(twins.map((r) => r.status), [200, 200]);
  assert.deepEqual(twins.map((r) => r.json().unchanged).sort(), [false, true]);
  assert.deepEqual(await tree(dirs.trips), [`${NAME}.brief.md`]);
  const [a, b] = ['# A\n', '# B\n'];
  const pair = await Promise.all([post(port, 'race', a), post(port, 'race', b)]);
  assert.deepEqual(pair.map((r) => r.status), [200, 200]);
  const files = (await tree(dirs.trips)).filter((f) => f.includes('race'));
  assert.equal(files.length, 2, files.join(' '));
  const contents = await Promise.all(files.map((f) => readFile(path.join(dirs.trips, f), 'utf8')));
  assert.deepEqual(contents.sort(), [a, b]);
});

test('寫檔失敗（同名的是個資料夾）回 500 write-failed、不留半套；之後別的名字照樣寫得進去', async (t) => {
  const { port, dirs } = await start(t);
  await mkdir(path.join(dirs.trips, 'stuck.brief.md'));
  const r = await post(port, 'stuck', '# x\n');
  assert.equal(r.status, 500);
  assert.equal(r.json().error, 'write-failed');
  assert.equal((await post(port, 'fine', '# x\n')).status, 200);
  assert.deepEqual(await tree(dirs.trips), ['fine.brief.md']);
});

test('parseArgs：開機排程只帶 --log 時其餘都是檔首預設（packs、dist、trips 相對於 app/tools/）；--no-briefs 關掉；旗標沒接值丟錯', () => {
  const d = parseArgs(['--log', 'D:\\x\\packs-server.log']);
  assert.equal(d.port, 18810);
  assert.equal(d.dir, path.resolve(TOOLS, '../../packs'));
  assert.equal(d.appDir, path.resolve(TOOLS, '../dist'));
  assert.equal(d.briefDir, path.resolve(TOOLS, '../../trips'));
  assert.equal(d.logFile, 'D:\\x\\packs-server.log');
  assert.equal(typeof d.acceptBriefs, 'boolean');
  assert.equal(parseArgs([]).logFile, null);
  assert.equal(parseArgs(['--no-briefs']).acceptBriefs, false);
  const tmp = path.join(tmpdir(), 'x');
  const o = parseArgs(['--port', '18812', '--dir', tmp, '--app', path.join(tmp, 'dist'), '--briefs', path.join(tmp, 'trips')]);
  assert.deepEqual([o.port, o.dir, o.appDir, o.briefDir], [18812, tmp, path.join(tmp, 'dist'), path.join(tmp, 'trips')]);
  assert.equal(parseArgs(['--dir', '../packs']).dir, path.resolve(TOOLS, '../packs'), '相對路徑相對於 tools/（一直是這樣）');
  for (const argv of [['--briefs'], ['--app', '--no-briefs'], ['--port'], ['--log']]) assert.throws(() => parseArgs(argv), /後面要接一個值/, argv.join(' '));
});

/** 直接執行這支（開機排程與 .bat 的啟動方式），等它印出埠號。stop 可以重複叫。 */
function runCli(args) {
  const child = spawn(process.execPath, [path.join(TOOLS, 'serve-packs.mjs'), ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  let err = '';
  const exited = new Promise((resolve) => child.once('exit', resolve));
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`等不到伺服器啟動：${out}${err}`)), 15000);
    child.stdout.on('data', (chunk) => {
      out += chunk.toString('utf8');
      const m = out.match(/http:\/\/127\.0\.0\.1:(\d+)\/pack\.json/);
      if (m) { clearTimeout(timer); resolve(Number(m[1])); }
    });
    child.stderr.on('data', (chunk) => { err += chunk.toString('utf8'); });
    exited.then((code) => { clearTimeout(timer); reject(new Error(`伺服器自己結束了（${code}）：${out}${err}`)); });
  });
  const stop = () => { child.kill(); return exited; };
  return { ready, stop };
}
/** log 是非同步附加的：等到檔裡出現那一行（最多 5 秒）再往下，免得砍掉行程時最後幾行還沒寫進去。 */
async function logHas(file, re) {
  for (let i = 0; i < 100; i += 1) {
    if (existsSync(file) && re.test(await readFile(file, 'utf8'))) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

test('直接執行（node tools/serve-packs.mjs …）起得來：打包檔、頁面、需求單都通，--log 有寫；--no-briefs 就不收；被 import 不會自己開埠', async (t) => {
  const { root, dirs } = await makeRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const logFile = path.join(root, 'server.log');
  const common = ['--port', '0', '--dir', dirs.packs, '--app', dirs.dist, '--briefs', dirs.trips, '--log', logFile];
  const a = runCli(common);
  t.after(a.stop);
  const port = await a.ready;
  assert.notEqual(port, 18810, '測試不碰正在跑的 18810');
  assert.equal((await raw(port, 'GET', '/pack.json')).status, 200);
  assert.match((await raw(port, 'GET', '/app/')).text, /Trip Pilot/);
  const accepts = (await raw(port, 'GET', '/brief')).status === 200;   // 檔首 ACCEPT_BRIEFS 開著才收（預設開）
  const r = await post(port, NAME, BRIEF_V1);
  assert.equal(r.status, accepts ? 200 : 403);
  if (accepts) assert.equal(await readFile(path.join(dirs.trips, `${NAME}.brief.md`), 'utf8'), BRIEF_V1);
  assert.ok(await logHas(logFile, /POST \/brief\?name=\S+ (200|403)/), '--log 有寫到最後一個請求');
  await a.stop();
  const log = await readFile(logFile, 'utf8');
  assert.match(log, /packs 伺服器 http:\/\/127\.0\.0\.1:\d+\/pack\.json ← /, '第一行跟以前同一個樣子');
  assert.match(log, /頁面 http:\/\/127\.0\.0\.1:\d+\/app\/ ← /);
  assert.match(log, /GET \/pack\.json 200 37/);
  if (accepts) assert.match(log, new RegExp(`→ trips/${NAME}\\.brief\\.md（新檔）`));

  const b = runCli([...common, '--no-briefs']);
  t.after(b.stop);
  const port2 = await b.ready;
  assert.equal((await raw(port2, 'GET', '/brief')).status, 404);
  assert.equal((await post(port2, 'nope', '# x\n')).status, 403);
  assert.ok(!existsSync(path.join(dirs.trips, 'nope.brief.md')));
  assert.ok(await logHas(logFile, /需求單：不收/), '--no-briefs 啟動時 log 講明不收');
  await b.stop();
});
