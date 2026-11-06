// 需求單「提交」（app.js submitBrief／probeBriefEndpoint；原話 #186 在電腦上填、#188 輸出成一份 MD 檔到 trip-pilot 資料夾）三條路：
// (a) 同源端點——對真的伺服器（tools/serve-packs.mjs 的 createPackServer，暫存資料夾，不碰專案的 trips/）跑一遍；(b) 另存對話框；(c) 下載；
// 加上 (a) 失效時接著走 (b)／(c)、探測、連按兩下、入口出不出現、畫面上的鍵。瀏覽器的東西用最小的假貨：fetch 把相對網址照「頁面網址」解（瀏覽器本來就這樣）、
// document 是一棵記得標籤／屬性／子節點／監聽的假樹（render 真的會畫進去，畫的時候丟錯測試就紅）、showSaveFilePicker 記下收到的選項與寫進去的字。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { resolveObjectURL } from 'node:buffer';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createPackServer } from '../../tools/serve-packs.mjs';
import { state, submitBrief, probeBriefEndpoint, setBrief, clearBrief, render, replanAll } from '../../src/ui/app.js';
import { briefEnv } from '../../src/ui/brief.js';
import { briefToMarkdown, normalizeBrief, canSubmitBrief, briefSubmitMode, emptyBrief } from '../../src/data/brief.js';
import { TEXT } from '../../src/ui/text.js';

const L = TEXT.brief;
const FILE = '2026-08-仙台.brief.md';

// ---- 假的瀏覽器 ----
const realFetch = globalThis.fetch;
const page = { url: 'http://127.0.0.1:1/app/', calls: [], downloads: [] };
globalThis.fetch = (input, init = {}) => {
  const url = new URL(input, page.url);
  if (url.hostname !== '127.0.0.1') throw new Error(`測試不准連外：${url.href}`);
  page.calls.push(`${init.method ?? 'GET'} ${url.pathname}${url.search}`);
  return realFetch(url, init);
};
/** 假的 DOM 節點：dom.js 的 el() 與各頁用到的那幾樣（className、屬性、監聽、子節點、textContent）。點下載用的 <a> 記進 page.downloads。 */
class FakeNode {
  constructor(tag) { this.tag = tag; this.className = ''; this.attrs = {}; this.listeners = {}; this.children = []; this.dataset = {}; this.style = { setProperty() {} }; }
  setAttribute(k, v) { this.attrs[k] = v; }
  addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  remove() {}
  querySelectorAll() { return []; }
  click() {
    if (this.attrs.download != null) page.downloads.push({ name: this.attrs.download, href: this.attrs.href });
    for (const fn of this.listeners.click ?? []) fn({ target: this });
  }
  get textContent() { return this.children.map((c) => (typeof c === 'string' ? c : c.textContent)).join(''); }
  set textContent(v) { this.children = [String(v)]; }
}
globalThis.Node = FakeNode;
const appRoot = new FakeNode('div');
globalThis.document = {
  getElementById: (id) => (id === 'app' ? appRoot : null),
  createElement: (tag) => new FakeNode(tag),
  createTextNode: (s) => { const n = new FakeNode('#text'); n.children = [String(s)]; return n; },
  querySelectorAll: () => [],
  body: { append() {} },
};
/** 畫面上（上一次 render 畫的）符合條件的節點。 */
function findAll(pred, node = appRoot, out = []) {
  for (const c of node.children) {
    if (typeof c === 'string') continue;
    if (pred(c)) out.push(c);
    findAll(pred, c, out);
  }
  return out;
}
const buttons = (label) => findAll((n) => (n.tag === 'button' || n.tag === 'a') && n.textContent === label);
/** 把「頁面」開在這個網址（location.pathname 與相對網址的基準）。 */
function openPage(url) {
  page.url = url;
  page.calls = [];
  page.downloads = [];
  globalThis.location = { pathname: new URL(url).pathname };
}
/** 假的另存對話框：記下選項、寫進去的字。 */
function fakePicker({ cancel = false, failOpen = false, failWrite = false } = {}) {
  const seen = { options: null, written: null, closed: false, opened: 0 };
  globalThis.showSaveFilePicker = async (options) => {
    seen.opened += 1;
    seen.options = options;
    if (cancel) throw Object.assign(new Error('The user aborted a request.'), { name: 'AbortError' });
    if (failOpen) throw Object.assign(new Error('Must be handling a user gesture to show a file picker.'), { name: 'SecurityError' });
    return {
      name: options.suggestedName,
      createWritable: async () => ({ write: async (data) => { if (failWrite) throw new Error('disk full'); seen.written = data; }, close: async () => { seen.closed = true; } }),
    };
  };
  state.savePicker = true;
  return seen;
}
function noPicker() { delete globalThis.showSaveFilePicker; state.savePicker = false; }

function filled() {
  return normalizeBrief({
    city: '仙台、松島', dates: { from: '2026-08-12', to: '2026-08-18' }, lodging: '東横INN 仙台東口', dayTrips: { count: 1, direction: '作並溫泉' },
    persons: [{ id: 'me', name: '我', isMe: true, go: { designated: ['作並溫泉', 'Utah'], mustEat: ['味太助'] } }],
    updatedAt: '2026-11-06T04:00:00.000Z',
  });
}
/** 每個測試開頭：一份填好的單子、還沒探測、沒有另存對話框。 */
function reset() {
  state.brief = filled();
  state.briefEndpoint = null;
  state.briefStatus = '';
  state.briefCopyText = 'x';
  state.briefBusy = false;
  state.briefSubmitted = null;
  state.briefUndo = null;
  state.country = null;
  state.trip = null;
  state.route = '#/brief';
  noPicker();
}
const expectedText = () => briefToMarkdown(state.brief);

async function startServer(t, options = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'trip-pilot-submit-'));
  const trips = path.join(root, 'trips');
  await mkdir(path.join(root, 'packs'));
  await mkdir(trips);
  await writeFile(path.join(root, 'packs', 'pack.json'), '{}');
  const server = createPackServer({ dir: path.join(root, 'packs'), briefDir: trips, ...options });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const close = async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); };
  t.after(async () => { await close(); await rm(root, { recursive: true, force: true }); });
  return { trips, port, close, base: `http://127.0.0.1:${port}` };
}
async function tree(dir, prefix = '') {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.isDirectory()) out.push(...await tree(path.join(dir, e.name), `${prefix}${e.name}/`));
    else out.push(`${prefix}${e.name}`);
  }
  return out.sort();
}

test('(a) 桌機伺服器供應的頁面：探測到端點 → 提交直接寫成 trips/<名字>.brief.md，內容就是「複製需求單文字」那一份；狀態句講檔在哪；沒改再交不動、改了再交舊的留在歷史', async (t) => {
  reset();
  const { trips, base } = await startServer(t);
  openPage(`${base}/app/#/brief`);
  assert.equal(canSubmitBrief(briefEnv(state)), false, '還沒探測、又沒有另存對話框：入口先不出現');
  assert.equal(await probeBriefEndpoint(), true);
  assert.equal(state.briefEndpoint, true);
  assert.deepEqual(page.calls, ['HEAD /brief'], '探測用 HEAD、相對網址 ../brief');
  assert.equal(briefSubmitMode(briefEnv(state)), 'server');
  assert.equal(canSubmitBrief(briefEnv(state)), true);

  const text = expectedText();
  const r = await submitBrief();
  assert.deepEqual(r, { via: 'server', file: `trips/${FILE}`, history: null, renamedFrom: null });
  assert.equal(await readFile(path.join(trips, FILE), 'utf8'), text, '寫進去的跟 briefToMarkdown 逐字相同');
  assert.ok(text.includes('作並溫泉') && text.includes('| 城市（主據點第一個） | 仙台、松島 |'));
  assert.equal(state.briefStatus, `已交到 trips/${FILE}，跟 Claude 說一聲就開始排；之後要改，改完再按一次提交，舊的會留一份`);
  assert.equal(state.briefCopyText, null);
  assert.equal(state.briefBusy, false);
  assert.equal(page.calls.at(-1), `POST /brief?name=${encodeURIComponent('2026-08-仙台')}`);
  assert.equal(page.downloads.length, 0);

  await submitBrief();
  assert.deepEqual(await tree(trips), [FILE], '內容相同：不動、沒有歷史檔');
  assert.equal(state.briefStatus, `已交到 trips/${FILE}，跟 Claude 說一聲就開始排；之後要改，改完再按一次提交，舊的會留一份`);

  // 他提交後在檔案裡手改了一行，回頁面又改了住宿再提交：手改的那份搬進歷史，狀態句講它在哪
  const handEdited = `${text}\n（我手動補的一行）\n`;
  await writeFile(path.join(trips, FILE), handEdited);
  setBrief((b) => ({ ...b, lodging: '作並溫泉 一の坊' }), { rerender: false });
  const again = await submitBrief();
  assert.equal(await readFile(path.join(trips, FILE), 'utf8'), expectedText());
  const files = await tree(trips);
  assert.equal(files.length, 2, files.join(' '));
  assert.match(files[1], /^_brief-history\/2026-08-仙台-\d{8}-\d{6}\.brief\.md$/);
  assert.equal(await readFile(path.join(trips, files[1]), 'utf8'), handEdited, '手改的那份原封在歷史裡');
  assert.deepEqual(again, { via: 'server', file: `trips/${FILE}`, history: `trips/${files[1]}`, renamedFrom: null });
  assert.equal(state.briefStatus, `已交到 trips/${FILE}，跟 Claude 說一聲就開始排；之後要改，改完再按一次提交，舊的會留一份（這次換下來的那份在 trips/${files[1]}）`);
});

test('檔名跟著城市與起日月份變：同一份單子改了起日的月份再交是另一個檔，舊名那份伺服器不動——狀態句提醒它還在；清空後另起一份就不提醒（那是另一趟）', async (t) => {
  reset();
  const { trips, base } = await startServer(t);
  openPage(`${base}/app/#/brief`);
  await probeBriefEndpoint();
  await submitBrief();
  setBrief((b) => ({ ...b, dates: { from: '2026-09-02', to: '2026-09-08' } }), { rerender: false });
  const moved = await submitBrief();
  assert.deepEqual(moved, { via: 'server', file: 'trips/2026-09-仙台.brief.md', history: null, renamedFrom: `trips/${FILE}` });
  assert.deepEqual(await tree(trips), [FILE, '2026-09-仙台.brief.md'], '舊名那份還在 trips/，沒被搬走');
  assert.equal(state.briefStatus, `已交到 trips/2026-09-仙台.brief.md，跟 Claude 說一聲就開始排；之後要改，改完再按一次提交，舊的會留一份（檔名跟上次不一樣：上次交的 trips/${FILE} 還在的話，不用了記得刪掉）`);
  assert.equal((await submitBrief()).renamedFrom, null, '同一個檔再交：不再提醒');

  clearBrief();
  setBrief((b) => ({ ...b, city: '東京', dates: { from: '2027-03-01', to: '2027-03-05' } }), { rerender: false });
  const other = await submitBrief();
  assert.deepEqual(other, { via: 'server', file: 'trips/2027-03-東京.brief.md', history: null, renamedFrom: null });
  assert.equal(state.briefStatus, '已交到 trips/2027-03-東京.brief.md，跟 Claude 說一聲就開始排；之後要改，改完再按一次提交，舊的會留一份');
});

test('剛開頁面、探測還沒回來就按「提交」：等探測的結果再決定走哪條路，不會白跳一次另存或下載', async (t) => {
  reset();
  const { trips, base } = await startServer(t);
  openPage(`${base}/app/#/brief`);
  const probing = probeBriefEndpoint();
  assert.equal(state.briefEndpoint, null, '還沒回來');
  const r = await submitBrief();
  assert.equal(r.via, 'server');
  assert.equal(await probing, true);
  assert.equal(page.downloads.length, 0);
  assert.deepEqual(await tree(trips), [FILE]);
});

test('(a) 經 tailscale 的前綴（/trip-pilot/app/）開：相對網址落在 /trip-pilot/brief，一樣交得出去', async (t) => {
  reset();
  const { trips, base } = await startServer(t);
  openPage(`${base}/trip-pilot/app/index.html#/brief`);
  assert.equal(await probeBriefEndpoint(), true);
  assert.equal((await submitBrief()).via, 'server');
  assert.deepEqual(page.calls, ['HEAD /trip-pilot/brief', `POST /trip-pilot/brief?name=${encodeURIComponent('2026-08-仙台')}`]);
  assert.deepEqual(await tree(trips), [FILE]);
});

test('探測：頁面不在 …/app/ 底下（GitHub Pages）不發請求、算沒有；伺服器不收、伺服器關著、別的主機對什麼都回 200 也都算沒有', async (t) => {
  reset();
  openPage('http://127.0.0.1:1/trip-pilot/#/brief');
  state.briefEndpoint = true;
  assert.equal(await probeBriefEndpoint(), false);
  assert.equal(state.briefEndpoint, false);
  assert.deepEqual(page.calls, [], 'GitHub Pages 上不白打一個請求');

  const off = await startServer(t, { acceptBriefs: false });
  openPage(`${off.base}/app/`);
  assert.equal(await probeBriefEndpoint(), false, '--no-briefs');
  assert.deepEqual(page.calls, ['HEAD /brief']);

  const gone = await startServer(t);
  await gone.close();
  openPage(`${gone.base}/app/`);
  assert.equal(await probeBriefEndpoint(), false, '伺服器關著');

  const other = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<html>'); });
  await new Promise((resolve) => other.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => { other.closeAllConnections(); other.close(resolve); }));
  openPage(`http://127.0.0.1:${other.address().port}/app/`);
  assert.equal(await probeBriefEndpoint(), false, '回 200 但不是這支伺服器（沒有 X-Trip-Pilot-Brief）');
  assert.equal(briefSubmitMode(briefEnv(state)), 'download');
});

test('(a) 沒成功就接著走存檔、狀態句最前面講原因：伺服器關了→另存；不收→另存；他在另存按取消→只剩原因；本文太大→端點還在、改下載', async (t) => {
  reset();
  const gone = await startServer(t);
  await gone.close();
  openPage(`${gone.base}/app/`);
  state.briefEndpoint = true;   // 之前探測到過，之後伺服器被關掉
  let picker = fakePicker();
  let r = await submitBrief();
  assert.deepEqual(r, { via: 'picker', file: FILE });
  assert.equal(picker.written, expectedText());
  assert.equal(state.briefStatus, `沒交到桌機（桌機的伺服器沒回應），改成存檔。已存成 ${FILE}；請放在 trip-pilot 的 trips 資料夾，再跟 Claude 說一聲`);
  assert.equal(state.briefEndpoint, false, '之後不再當它在：下一次直接開另存');
  page.calls = [];
  await submitBrief();
  assert.deepEqual(page.calls, [], '第二次沒再去打伺服器');

  reset();
  const off = await startServer(t, { acceptBriefs: false });
  openPage(`${off.base}/app/`);
  state.briefEndpoint = true;
  picker = fakePicker({ cancel: true });
  r = await submitBrief();
  assert.deepEqual(r, { via: 'cancelled' });
  assert.equal(state.briefStatus, '沒交出去：桌機的伺服器現在不收需求單');
  assert.equal(state.briefEndpoint, false);
  assert.deepEqual(await tree(off.trips), []);

  reset();
  const tiny = await startServer(t, { briefMaxBytes: 64 });
  openPage(`${tiny.base}/app/`);
  state.briefEndpoint = true;
  r = await submitBrief();
  assert.deepEqual(r, { via: 'download', file: FILE, pickerFailed: false });
  assert.equal(state.briefStatus, `沒交到桌機（內容超過大小上限），改成存檔。已存成 ${FILE}；請放在 trip-pilot 的 trips 資料夾，再跟 Claude 說一聲`);
  assert.equal(state.briefEndpoint, true, '端點還在，只是這一份它不收');
  assert.equal(page.downloads.length, 1);
  assert.deepEqual(await tree(tiny.trips), []);
});

test('(b) 另存對話框（沒有端點）：建議檔名 <名字>.brief.md、id 讓瀏覽器記住資料夾、類型 Markdown；寫進去的就是需求單文字；按取消不算錯也不留字；開不起來或寫不進去改下載', async () => {
  reset();
  openPage('http://127.0.0.1:1/trip-pilot/');   // GitHub Pages 那種網址：沒有端點
  let picker = fakePicker();
  assert.equal(briefSubmitMode(briefEnv(state)), 'picker');
  let r = await submitBrief();
  assert.deepEqual(r, { via: 'picker', file: FILE });
  assert.deepEqual(picker.options, { suggestedName: FILE, id: 'trip-pilot-brief', types: [{ description: 'Markdown 文件', accept: { 'text/markdown': ['.md'] } }] });
  assert.equal(picker.written, expectedText());
  assert.equal(picker.closed, true);
  assert.equal(state.briefStatus, `已存成 ${FILE}；請放在 trip-pilot 的 trips 資料夾，再跟 Claude 說一聲`);
  assert.deepEqual(page.calls, [], '沒有端點就不發請求（更不會去打 http://127.0.0.1 的絕對網址）');
  assert.equal(page.downloads.length, 0);

  state.briefStatus = '上一句';
  picker = fakePicker({ cancel: true });
  r = await submitBrief();
  assert.deepEqual(r, { via: 'cancelled' });
  assert.equal(state.briefStatus, '', '按取消：不算錯、不留字');
  assert.equal(state.briefBusy, false);
  assert.equal(page.downloads.length, 0);

  picker = fakePicker({ failOpen: true });
  r = await submitBrief();
  assert.deepEqual(r, { via: 'download', file: FILE, pickerFailed: false });
  assert.equal(state.briefStatus, `已存成 ${FILE}；請放在 trip-pilot 的 trips 資料夾，再跟 Claude 說一聲`);
  assert.equal(page.downloads.length, 1);

  picker = fakePicker({ failWrite: true });
  r = await submitBrief();
  assert.deepEqual(r, { via: 'download', file: FILE, pickerFailed: true });
  assert.equal(state.briefStatus, `另存沒寫成功，改成下載。已存成 ${FILE}；請放在 trip-pilot 的 trips 資料夾，再跟 Claude 說一聲`);
  assert.equal(page.downloads.length, 2);
});

test('(c) 兩樣都沒有（iPhone Safari 直接開 #/brief）：下載 <名字>.brief.md，內容就是需求單文字；狀態句同另存；沒填城市與日期的檔名是 brief-<今天>', async () => {
  reset();
  openPage('http://127.0.0.1:1/trip-pilot/');
  assert.equal(briefSubmitMode(briefEnv(state)), 'download');
  assert.equal(canSubmitBrief(briefEnv(state)), false, '入口不出現');
  const r = await submitBrief();
  assert.deepEqual(r, { via: 'download', file: FILE, pickerFailed: false });
  assert.equal(page.downloads.length, 1);
  assert.equal(page.downloads[0].name, FILE);
  assert.equal(await resolveObjectURL(page.downloads[0].href).text(), expectedText());
  assert.equal(state.briefStatus, `已存成 ${FILE}；請放在 trip-pilot 的 trips 資料夾，再跟 Claude 說一聲`);
  assert.deepEqual(page.calls, []);

  state.brief = emptyBrief();
  const empty = await submitBrief();
  assert.match(empty.file, /^brief-\d{4}-\d{2}-\d{2}\.brief\.md$/);
});

test('連按兩下「提交」：第二下不理，只送一次', async (t) => {
  reset();
  const { trips, base } = await startServer(t);
  openPage(`${base}/app/`);
  state.briefEndpoint = true;
  const first = submitBrief();
  assert.equal(state.briefBusy, true);
  assert.equal(state.briefStatus, '提交中…');
  assert.equal(await submitBrief(), null);
  assert.equal((await first).via, 'server');
  assert.equal(page.calls.filter((c) => c.startsWith('POST')).length, 1);
  assert.deepEqual(await tree(trips), [FILE]);
  assert.equal(state.briefBusy, false);
});

test('畫面：需求單頁頂端與頁尾各一顆「提交」、是這頁唯二的主要鍵，「存成檔案」降成次要、名字照舊；按頁尾那顆就交出去，狀態句頂端與頁尾各印一次', async (t) => {
  reset();
  const { trips, base } = await startServer(t);
  openPage(`${base}/app/#/brief`);
  await probeBriefEndpoint();
  render();
  const submits = buttons('提交');
  assert.equal(submits.length, 2);
  assert.deepEqual(findAll((n) => n.className.split(' ').includes('primary')), submits, '主要鍵只有這兩顆');
  assert.deepEqual(buttons('存成檔案').map((b) => b.className), ['btn']);
  assert.deepEqual(['複製需求單文字', '清空'].map((label) => buttons(label).length), [1, 1], '其他鍵照舊');
  assert.ok(findAll((n) => n.className === 'muted small intro')[0].textContent.endsWith('改了就自動存在這台裝置，填完按「提交」。'));
  assert.equal(findAll((n) => n.className === 'small status').length, 0, '還沒按：沒有狀態句');
  assert.equal(submits[1], findAll((n) => n.className === 'actions submit-end')[0].children[0], '第二顆在頁尾那一排');

  submits[1].click();
  for (let i = 0; i < 200 && (state.briefBusy || state.briefStatus === L.submitting || state.briefStatus === ''); i += 1) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(await tree(trips), [FILE]);
  const status = findAll((n) => n.className === 'small status').map((n) => n.textContent);
  assert.deepEqual(status, Array(2).fill(`已交到 trips/${FILE}，跟 Claude 說一聲就開始排；之後要改，改完再按一次提交，舊的會留一份`));
});

test('入口：設定頁的「需求單」與空白頁的「先填需求單」只在交得出去的環境出現（同源端點會收，或有另存對話框）；兩樣都沒有（iPhone Safari）不出現；探測結果讓入口冒出來時設定頁自己重畫、需求單頁不重畫', async (t) => {
  reset();
  replanAll();   // 沒旅程不會排，只是把 state.settings 建起來（設定頁要讀）
  const seen = () => {
    state.route = '#/settings';
    render();
    const inSettings = findAll((n) => n.tag === 'a' && n.attrs.href === '#/brief').map((n) => n.textContent);
    state.route = '#/plan';
    render();
    return [inSettings, buttons('先填需求單').length, buttons('去更新').length, buttons('載入仙台示範').length];
  };
  assert.deepEqual(seen(), [[], 0, 1, 1], '還沒探測、沒有另存對話框：兩個入口都不出現，其餘照舊');
  state.briefEndpoint = true;
  assert.deepEqual(seen(), [['需求單'], 1, 1, 1], '桌機伺服器供應的頁面');
  state.briefEndpoint = false;
  assert.deepEqual(seen(), [[], 0, 1, 1], 'iPhone Safari：沒有端點、沒有另存對話框');
  state.savePicker = true;
  assert.deepEqual(seen(), [['需求單'], 1, 1, 1], '桌機 Chrome 開 GitHub Pages 的頁面');

  // 探測回來才知道交得出去：人在設定頁就重畫一次讓入口出現；人在需求單頁不重畫（打字中的焦點會被踢掉）
  noPicker();
  state.briefEndpoint = null;
  const { base } = await startServer(t);
  openPage(`${base}/app/#/settings`);
  state.route = '#/settings';
  render();
  const entry = () => findAll((n) => n.tag === 'a' && n.attrs.href === '#/brief').length;
  assert.equal(entry(), 0);
  await probeBriefEndpoint();
  assert.equal(entry(), 1, '探測到端點：設定頁自己重畫，入口出現');
  state.briefEndpoint = null;
  state.route = '#/brief';
  render();
  const drawn = appRoot.children[0];
  await probeBriefEndpoint();
  assert.equal(state.briefEndpoint, true);
  assert.equal(appRoot.children[0], drawn, '需求單頁沒有被重畫');
});

test('狀態句與原因都是中文、不露鍵值；伺服器回的每個錯誤代碼頁面都有對應的字', () => {
  const samples = [L.submitted(`trips/${FILE}`), L.submittedReplaced(`trips/_brief-history/${FILE}`), L.submittedRenamed(`trips/${FILE}`), L.savedForClaude(FILE), L.submitFellBack(L.submitErrors.offline), L.submitFailed(L.submitErrors.http(500)), L.pickerFailed, L.submitting,
    ...Object.values(L.submitErrors).filter((v) => typeof v === 'string')];
  for (const s of samples) assert.doesNotMatch(s, /undefined|\[object|null|NaN|cross-origin|too-large|write-failed|disabled|offline/, s);
  for (const code of ['disabled', 'cross-origin', 'too-large', 'write-failed']) assert.equal(typeof L.submitErrors[code], 'string', code);
  assert.equal(L.submitErrors.http(503), '桌機的伺服器回了錯誤 503');
  assert.ok(L.intro.includes('這台裝置') && L.intro.includes('提交') && !L.intro.includes('手機'), '頁上的字：存在這台裝置、填完按提交');
});
