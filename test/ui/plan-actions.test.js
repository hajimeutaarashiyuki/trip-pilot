// 規劃頁與現場頁的新動作，從鍵按到畫面（11-06 第二批；原話 #192–#197）：真的把 app.js 的 state 載入小世界、畫進假 DOM（_dom.js）、找到鍵來按，再看旅程檔、排出來的序列、頂端復原列與畫面上的字。
// 走廊清單每家的簡介、升級成站＝安插（排得下／排不下跳選項、三輪、算了不插）、釘住的日子的不去了／換一家／讓引擎重排這天、
// 換一家清單的餐別標題與說明、早餐卡的三顆鍵／改回來／或 X、現場頁早餐的鍵、改動存進 localStorage 重載還在、畫面不露鍵值。
// 小世界見 _world.js（THU 的順序釘死；FRI／SAT／SUN 引擎各排一家早餐）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom.js';
import { loadWorld, makeTrip, idsOf, WORLD, JP, kb, THU, FRI, SAT, SUN, A, B, C, D, E, F, G, Z, late, lunch, dinner, bar, small, big, izakaya, dinner2, cafe, noodle, stand, bakery, ORDER1 } from './_world.js';
import { TEXT } from '../../src/ui/text.js';

const dom = installDom();   // 要在 app.js 載入之前：它一載入就讀 localStorage
const app = await import('../../src/ui/app.js');
const { state } = app;
const EDITS_KEY = 'trip-pilot:trip-edits';

/** 等先畫一句再算的動作（afterPaint）跑完。 */
async function settle() {
  for (let i = 0; i < 400 && state.busy; i += 1) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(state.busy, false, '動作沒有跑完');
}
function load(trip = makeTrip()) {
  dom.storage.clear();
  loadWorld(state, trip);
  app.replanAll();
}
const plan = (date) => state.plans[date].plan;
const tripDay = (date) => state.trip.days.find((d) => d.date === date);
const dayNode = (date) => dom.root.querySelectorAll('section.day').find((n) => n.dataset.date === date) ?? assert.fail(`畫面上沒有 ${date}`);
const cardOf = (date, name) => dayNode(date).querySelectorAll('article.card').find((c) => c.querySelector('h3')?.textContent === name) ?? assert.fail(`${date} 沒有「${name}」的站卡`);
const labels = (node) => dom.findAll((n) => n.tag === 'button' || n.tag === 'a', node).map((n) => n.textContent);
/** 那張站卡自己的那一排鍵（不含下面走廊清單裡的）。 */
const cardKeys = (card) => labels(card.children.find((c) => typeof c !== 'string' && c.className === 'actions'));
const press = (label, node = dom.root) => { const b = dom.buttons(label, node)[0] ?? assert.fail(`找不到鍵「${label}」：${labels(node).join('｜')}`); b.click(); };
const undoBar = () => dom.root.querySelectorAll('.undo-bar').filter((n) => !n.classList.contains('notice')).map((n) => n.children[0].textContent);
const stored = () => JSON.parse(dom.storage.get(EDITS_KEY) ?? 'null');
/** 打開 date 那天第一段（住宿→第一站）的走廊清單，回清單節點。 */
function openFirstCorridor(date) {
  const block = dayNode(date).querySelector('.leg-block') ?? assert.fail(`${date} 第一段沒有走廊清單`);
  if (!block.querySelector('.corridor-list')) dom.findAll((n) => n.tag === 'button' && /^經過 \d+ 家$|可升級$/.test(n.textContent), block)[0].click();
  return block.querySelector('.corridor-list') ?? assert.fail('走廊清單沒展開');
}
const corridorItem = (date, name) => openFirstCorridor(date).querySelectorAll('.corridor-item').find((n) => n.querySelector('strong')?.textContent === name) ?? assert.fail(`走廊清單沒有「${name}」`);
/**
 * 升級排不下那一塊畫了哪些選項（照畫面的先後）：[{ group: 哪一組的小標, name: 第一行的店名（含「（要插的這家）」）, side: [右邊的重點…], notes: [後果、會多出來的黃字], intro, node }]。
 * 11-17 起選項分「少待一點」「這站不去」兩組，每個選項三行（店名＋重點／後果／簡介）。
 */
function askRows(ask) {
  const rows = []; let group = null;
  for (const c of ask.children) {
    if (typeof c === 'string') continue;
    if (c.classList.contains('ask-group')) { group = c.textContent; continue; }
    if (c.tag !== 'button' || !c.classList.contains('opt')) continue;
    const side = c.querySelector('.opt-side');
    rows.push({ group, name: c.querySelector('.opt-name').textContent, side: side.children.map((x) => (typeof x === 'string' ? x : x.textContent)), notes: c.querySelectorAll('.opt-note').map((n) => n.textContent), intro: c.querySelector('.opt-intro')?.textContent ?? null, node: c });
  }
  return rows;
}
/** 選項裡某一組的某一家（找不到就讓測試紅）。 */
const askRow = (ask, group, name) => askRows(ask).find((r) => r.group === group && r.name === name) ?? assert.fail(`「${group}」裡沒有「${name}」：${askRows(ask).map((r) => `${r.group}／${r.name}`).join('｜')}`);
const KEYS = /undefined|\[object|NaN|null|breakfast|hotel|later|pinned|shorten|drop|onway|filler|engine|chosen|picked/;

test('走廊清單每家多一行簡介；升級成站排得下：插進那一段、原本的站一站不少先後不變、那天釘住、頂端復原列講插在誰跟誰之間；復原回到原樣；改動存進 localStorage', async () => {
  load();
  assert.deepEqual(idsOf(plan(THU)), ORDER1);
  const list = openFirstCorridor(THU);
  const rows = list.querySelectorAll('.corridor-item');
  assert.ok(rows.length >= 3);
  for (const row of rows) {
    const name = row.querySelector('strong').textContent;
    assert.equal(row.querySelector('.intro')?.textContent, `${name}的簡介`, `「${name}」有一行簡介`);
    assert.deepEqual(labels(row), ['升級成站', '我進去了']);
  }
  press('升級成站', corridorItem(THU, small.name_zh));
  assert.equal(state.busy, true, '先畫一句再算');
  assert.ok(dom.text().includes('正在試排…'));
  await settle();
  assert.deepEqual(idsOf(plan(THU)), [small.id, ...ORDER1]);
  assert.equal(plan(THU).pinned, true);
  assert.deepEqual(undoBar(), ['已把 小店 排成第一站（街區A 之前），後面順延 35 分']);
  assert.ok(!dom.text().includes('正在試排…'));
  assert.deepEqual(tripDay(THU).pinned.sequence.map((e) => e.poiId), [small.id, ...ORDER1]);
  assert.deepEqual(tripDay(THU).picks.map((p) => p.poiId), [...ORDER1, small.id]);
  assert.deepEqual(stored().days[THU].pinned.sequence.map((e) => e.poiId), [small.id, ...ORDER1], '釘住的順序跟著存');
  assert.equal(cardOf(THU, small.name_zh).querySelector('h3').textContent, '小店', '它現在是一張站卡');
  assert.ok(!openFirstCorridor(THU).querySelectorAll('strong').some((n) => n.textContent === '小店'), '不再列在走廊清單');
  // 復原
  press('復原'); await settle();
  assert.deepEqual(idsOf(plan(THU)), ORDER1);
  assert.deepEqual(tripDay(THU).pinned.sequence.map((e) => e.poiId), ORDER1, '釘住的順序也回到動作前');
  assert.deepEqual(tripDay(THU).picks.map((p) => p.poiId), ORDER1);
  assert.deepEqual(undoBar(), []);
  assert.equal(stored(), null, '跟打包那版一樣就不留鍵');
});

test('升級成站排不下：那一家底下展開一組選項（為什麼排不下、每個選項一顆鍵附後果與簡介、算了不插）；選排得下的少待／不去就套用；算了不插什麼都沒動', async () => {
  load();
  const ask = () => corridorItem(THU, big.name_zh).querySelector('.insert-ask');
  press('升級成站', corridorItem(THU, big.name_zh));
  await settle();
  assert.deepEqual(idsOf(plan(THU)), ORDER1, '排不下：旅程沒動');
  assert.deepEqual(undoBar(), []);
  assert.ok(ask(), '選項畫在那一家底下，清單還開著');
  assert.equal(ask().querySelector('.warn-line').textContent, '插進 大店 之後排不下：午餐店 15:20 到的時候不在營業時間內（11:30–14:30）（差 110 分）');
  // 選項分兩組、各一行小標（11-17）：「少待一點」（要插的這家排第一個）與「這站不去」
  assert.deepEqual(ask().querySelectorAll('.ask-group').map((n) => n.textContent), ['少待一點', '這站不去']);
  const rows = askRows(ask());
  assert.equal(rows.length, ask().querySelectorAll('.alt').length, '每個選項一顆鍵，都在其中一組');
  const groupOrder = rows.map((r) => (r.group === '少待一點' ? 0 : 1));
  assert.deepEqual(groupOrder, [...groupOrder].sort(), '先少待、再不去');
  // 要插的這家自己少待：名字後面標出來、右邊寫幾分變幾分、後果一行、不重複附簡介（它的簡介就在上面那一列）
  assert.deepEqual({ ...rows[0], node: null }, { group: '少待一點', name: '大店（要插的這家）', side: ['240 → 130 分'], notes: [rows[0].notes[0]], intro: null, node: null });
  assert.match(rows[0].notes[0], /^排得下，後面最多順延 \d+ 分/);
  assert.equal(rows[0].node.querySelector('strong').textContent, '大店', '粗體只有店名');
  // 後面某一站少待：還不夠的也在同一組，後果那一行寫還差幾分
  const shortA = askRow(ask(), '少待一點', '街區A');
  assert.deepEqual([shortA.side, shortA.notes, shortA.intro], [['60 → 30 分'], ['還差 80 分，要再調一項'], '街區A的簡介']);
  assert.ok(!dom.text(ask()).includes('下面這幾個選了還不夠'), '那一句不畫了');
  // 不去：右邊是店型小標；後果一行、會多出來的黃字另起一行、再來是那一站的簡介
  const drop = askRow(ask(), '這站不去', '午餐店');
  assert.deepEqual(drop.side, ['吃的']);
  assert.equal(drop.node.querySelector('.opt-side').children[0].className, 'cat', '店型用既有的小標樣式');
  assert.match(drop.notes[0], /^排得下，後面最多順延 \d+ 分/);
  assert.deepEqual(drop.notes.slice(1), ['會多一句：今天沒排午餐']);
  assert.equal(drop.node.querySelectorAll('.opt-note')[1].className, 'opt-note adds', '會多出來的黃字是另外一行（warn 色的樣式）');
  assert.equal(drop.intro, '午餐店的簡介');
  assert.deepEqual(drop.node.children.map((n) => n.className), ['opt-top', 'opt-note', 'opt-note adds', 'opt-intro'], '三行的先後：店名與重點、後果（＋黃字）、簡介');
  assert.deepEqual(labels(ask()).at(-1), '算了，不插');
  // 算了，不插
  press('算了，不插', ask()); await settle();
  assert.equal(ask(), null);
  assert.equal(state.insertAsk, null);
  assert.deepEqual([idsOf(plan(THU)), undoBar(), stored()], [ORDER1, [], null]);
  // 選「插的這家少待」
  press('升級成站', corridorItem(THU, big.name_zh));
  await settle();
  ask().querySelectorAll('.alt')[0].click();
  await settle();
  assert.deepEqual(idsOf(plan(THU)), [big.id, ...ORDER1]);
  assert.equal(plan(THU).sequence[0].dwellMin, 130);
  assert.match(undoBar()[0], /^已把 大店 排成第一站（街區A 之前），後面順延 \d+ 分(?:（用掉留白 \d+ 分）)?；大店 只待 130 分（原本 240 分）$/);
  assert.equal(state.insertAsk, null);
  press('復原'); await settle();
  assert.deepEqual(idsOf(plan(THU)), ORDER1);
  // 選「不去某站」＝一般的不去了（記進 removed、不算落選）
  press('升級成站', corridorItem(THU, big.name_zh));
  await settle();
  askRow(ask(), '這站不去', '午餐店').node.click();
  await settle();
  assert.deepEqual(idsOf(plan(THU)), [big.id, ...ORDER1.filter((id) => id !== lunch.id)]);
  assert.equal(plan(THU).sequence[0].dwellMin, 240, '大店照它自己的停留');
  assert.deepEqual(tripDay(THU).removed.map((r) => [r.poiId, r.priority]), [[lunch.id, 'want']]);
  assert.ok(!tripDay(THU).picks.some((p) => p.poiId === lunch.id));
  assert.ok(undoBar()[0].endsWith('；不去 午餐店'), undoBar()[0]);
  assert.ok(dom.lines('hint', dayNode(THU)).concat(dayNode(THU).querySelectorAll('li').map((n) => n.textContent)).some((t) => t.includes('今天沒排午餐')), '選項上講的那一句真的出現在日期下面');
  press('復原'); await settle();
  assert.deepEqual([idsOf(plan(THU)), tripDay(THU).removed ?? []], [ORDER1, []]);
});

test('插在走廊清單掛的那一段（不是第一段）：晚餐店→街區B 那一段的店插在那兩站之間；選項開著時按了別的動作（重排）就把選項收掉', async () => {
  load();
  // 晚餐店那張卡下面的那一段（第 4 段）
  const block = cardOf(THU, dinner.name_zh).children.find((c) => typeof c !== 'string' && c.className === 'leg-block') ?? assert.fail('晚餐店→街區B 那一段沒有走廊清單');
  dom.findAll((n) => n.tag === 'button' && /^經過 \d+ 家$|可升級$/.test(n.textContent), block)[0].click(); await settle();
  const row = block.querySelectorAll('.corridor-item').find((n) => n.querySelector('strong').textContent === dinner2.name_zh) ?? assert.fail('那一段沒有晚餐二店');
  press('升級成站', row);
  await settle();
  assert.deepEqual(idsOf(plan(THU)), [A.id, C.id, lunch.id, dinner.id, dinner2.id, B.id, bar.id], '插在晚餐店和街區B之間');
  assert.equal(undoBar()[0], '已把 晚餐二店 插在 晚餐店 和 街區B 之間，後面順延 65 分（用掉留白 45 分）');
  // 用到留白：那天的留白那一行多寫一句（酒吧 20:45–23:15，超過扣過留白的收工 22:30 四十五分）
  assert.equal(plan(THU).openSlotUsedMin, 45);
  assert.ok(dayNode(THU).textContent.includes('留白 90 分（排在最後；等開門用掉 310 分；調過的行程用掉 45 分）'), dayNode(THU).querySelectorAll('p').map((n) => n.textContent).find((t) => t.startsWith('留白')));
  press('復原'); await settle();
  assert.deepEqual(idsOf(plan(THU)), ORDER1);
  // 選項開著 → 按別的站的「不去了」（會重排）→ 選項收掉（它是對重排前那一份行程算的）
  press('升級成站', corridorItem(THU, big.name_zh));
  await settle();
  assert.ok(state.insertAsk && dayNode(THU).querySelector('.insert-ask'));
  press('不去了', cardOf(THU, B.name_zh)); await settle();
  assert.equal(state.insertAsk, null);
  assert.equal(dom.root.querySelector('.insert-ask'), null);
  assert.deepEqual(idsOf(plan(THU)), ORDER1.filter((id) => id !== B.id));
});

test('三輪：選了還排不下就換成下一輪的選項並講還差多少；第三輪只剩選了就排得下的；套用後每個調整都在、其餘先後不變', async () => {
  load();
  const ask = () => corridorItem(THU, big.name_zh).querySelector('.insert-ask');
  const pick = async (group, name) => { askRow(ask(), group, name).node.click(); await settle(); };
  press('升級成站', corridorItem(THU, big.name_zh));
  await settle();
  await pick('少待一點', '街區A');
  assert.deepEqual(idsOf(plan(THU)), ORDER1, '還沒套');
  assert.match(ask().textContent, /已選：街區A 少待 30 分（60→30）/);
  assert.match(ask().querySelector('.warn-line').textContent, /^還是排不下：午餐店 \d\d:\d\d 到的時候不在營業時間內（11:30–14:30）（還差 80 分）$/);
  assert.ok(ask().textContent.includes('再選一項（第 2 輪，最多 3 輪）：'));
  await pick('少待一點', '街區C');
  assert.match(ask().textContent, /已選：街區A 少待 30 分（60→30）、街區C 少待 30 分（60→30）/);
  assert.ok(ask().textContent.includes('最後一輪，只列選了就排得下的：'));
  assert.ok(ask().querySelectorAll('.alt').length >= 1);
  assert.ok(ask().querySelectorAll('.alt').every((b) => b.textContent.includes('排得下') && !b.textContent.includes('要再調一項')), '最後一輪不列選了還不夠的');
  await pick('少待一點', '大店（要插的這家）');
  assert.deepEqual(idsOf(plan(THU)), [big.id, ...ORDER1]);
  assert.deepEqual(plan(THU).sequence.slice(0, 3).map((s) => [s.poi.id, s.dwellMin]), [[big.id, 190], [A.id, 30], [C.id, 30]]);
  assert.match(undoBar()[0], /^已把 大店 排成第一站（街區A 之前），後面順延 \d+ 分(?:（用掉留白 \d+ 分）)?；街區A 少待 30 分（60→30）；街區C 少待 30 分（60→30）；大店 只待 190 分（原本 240 分）$/);
  assert.deepEqual(stored().days[THU].pinned.sequence.slice(0, 3).map((e) => [e.poiId, e.dwellMin]), [[big.id, 190], [A.id, 30], [C.id, 30]], '少待調過的停留記在釘住的順序上');
});

test('釘住的日子：日期下面一行小字＋「讓引擎重排這天」；不去了、換一家都只動那一站，其餘各站先後不變；讓引擎重排＝解除（有一次性復原）', async () => {
  load();
  assert.deepEqual(dayNode(THU).querySelectorAll('.day-note').map((n) => n.textContent), ['這天照你調過的順序排讓引擎重排這天']);
  assert.deepEqual(dayNode(FRI).querySelectorAll('.day-note'), [], '沒釘住的日子沒有那一行');
  // 不去了
  // 不去了、換一家、復原也先畫一句「正在重排…」再算（11-24 主控；之前這三個是按下去就同步重排——七天包桌機要停 1.1 秒、
  // CPU 放慢 4 倍 4.9 秒，期間畫面沒有任何提示；升級成站、或 B、讓引擎重排這天、早餐的鍵本來就有這一句）
  press('不去了', cardOf(THU, B.name_zh));
  assert.ok(state.busy && dom.text().includes('正在重排…'), '不去了：先畫一句再算');
  assert.deepEqual(idsOf(plan(THU)), ORDER1, '那一句畫出來的時候還沒重排');
  await settle();
  assert.ok(!dom.text().includes('正在重排…'));
  assert.deepEqual(idsOf(plan(THU)), ORDER1.filter((id) => id !== B.id));
  assert.equal(plan(THU).pinned, true);
  assert.deepEqual(undoBar(), ['已把 街區B 從 8/13（四） 拿掉']);
  // 重排完畫面上那一條記回旅程檔（engine/insert.js repinTrip；11-12 審查）：順序裡不再留著拿掉的那一筆，手機上存的也是
  assert.deepEqual(tripDay(THU).pinned.sequence.map((e) => e.poiId), ORDER1.filter((id) => id !== B.id));
  assert.deepEqual(stored().days[THU].pinned.sequence.map((e) => e.poiId), ORDER1.filter((id) => id !== B.id));
  press('復原');
  assert.ok(state.busy && dom.text().includes('正在重排…'), '復原：先畫一句再算');
  assert.deepEqual(undoBar(), [], '復原列先收掉，只留那一句');
  await settle();
  assert.deepEqual(idsOf(plan(THU)), ORDER1);
  assert.deepEqual(tripDay(THU).pinned.sequence.map((e) => e.poiId), ORDER1, '復原：記著的順序也回來');
  // 換一家（街區只換街區，沒有餐別那一句）
  press('換一家', cardOf(THU, C.name_zh)); await settle();
  const list = cardOf(THU, C.name_zh).querySelector('.swap-list');
  assert.ok(!list.textContent.includes('換一家'), '不是哪一餐：清單最上面不寫那一句');
  // 哪一天都還沒排的那一家在最前面；FRI／SAT／SUN 勾的街區排在後面、店名後各帶一個小標（11-24；11-17 那一版整個不列，清單只剩一家）
  assert.deepEqual(list.querySelectorAll('.alt').map((b) => [b.querySelector('strong').textContent, b.querySelector('.cat')?.textContent ?? null]),
    [[Z.name_zh, null], [D.name_zh, '8/14（五）已排'], [E.name_zh, '8/14（五）已排'], [F.name_zh, '8/15（六）已排'], [G.name_zh, '8/15（六）已排'], ['街區H', '8/16（日）已排']]);
  list.querySelectorAll('.alt')[0].click();
  assert.ok(state.busy && dom.text().includes('正在重排…'), '換一家：先畫一句再算');
  await settle();
  assert.deepEqual(idsOf(plan(THU)), ORDER1.map((id) => (id === C.id ? Z.id : id)), '原位置換掉');
  assert.equal(plan(THU).pinned, true);
  // 讓引擎重排這天
  press('讓引擎重排這天', dayNode(THU));
  assert.ok(dom.text().includes('正在重排…'));
  await settle();
  assert.ok(!plan(THU).pinned, '解除了');
  assert.equal(tripDay(THU).pinned, undefined);
  assert.deepEqual(undoBar(), ['已讓引擎重排 8/13（四）']);
  assert.deepEqual(dayNode(THU).querySelectorAll('.day-note').filter((n) => n.textContent.includes('照你調過的順序')), []);
  for (const id of ORDER1.map((x) => (x === C.id ? Z.id : x))) assert.ok(idsOf(plan(THU)).includes(id), `他勾的 ${id} 還在`);
  press('復原'); await settle();
  assert.equal(plan(THU).pinned, true);
  assert.deepEqual(idsOf(plan(THU)), ORDER1.map((id) => (id === C.id ? Z.id : id)));
});

test('晚餐換一家：清單最上面寫「晚餐換一家」、只列能當晚餐的店（居酒屋附「可以當晚餐：…」與簡介）、不列咖啡廳；選了原位置換掉', async () => {
  load();
  press('換一家', cardOf(THU, dinner.name_zh)); await settle();
  const list = cardOf(THU, dinner.name_zh).querySelector('.swap-list');
  assert.equal(list.children[0].textContent, '晚餐換一家');
  const rows = list.querySelectorAll('.alt').map((b) => [b.querySelector('strong').textContent, b.querySelectorAll('.intro').map((n) => n.textContent)]);
  assert.deepEqual(rows.find((r) => r[0] === izakaya.name_zh), [izakaya.name_zh, ['可以當晚餐：串燒與釜飯，吃得飽', '居酒屋的導讀']]);
  assert.deepEqual(rows.find((r) => r[0] === dinner2.name_zh), [dinner2.name_zh, ['晚餐二店的簡介']], '吃的店沒有另外的說明就只有簡介');
  assert.ok(!rows.some((r) => r[0] === cafe.name_zh));
  list.querySelectorAll('.alt').find((b) => b.querySelector('strong').textContent === izakaya.name_zh).click(); await settle();
  assert.deepEqual(idsOf(plan(THU)), ORDER1.map((id) => (id === dinner.id ? izakaya.id : id)));
  assert.equal(plan(THU).meals.dinner, izakaya.id, '標了能當晚餐的居酒屋算這天的晚餐');
  // 再按一次換一家：收起來
  press('換一家', cardOf(THU, izakaya.name_zh)); await settle();
  assert.ok(cardOf(THU, izakaya.name_zh).querySelector('.swap-list'));
  press('換一家', cardOf(THU, izakaya.name_zh)); await settle();
  assert.equal(cardOf(THU, izakaya.name_zh).querySelector('.swap-list'), null);
});

test('早餐卡：店型旁「早餐」小標、引擎先挑的寫一句、鍵是換一家／改天去／吃飯店早餐／地圖（沒有不去了）；吃飯店早餐→那天不排不提示、日期下面一行＋改回來、後面第一天掛「或 X」', async () => {
  load();
  assert.deepEqual([plan(FRI).meals.breakfast, plan(SAT).meals.breakfast, plan(SUN).meals.breakfast], [noodle.id, stand.id, bakery.id]);
  const card = cardOf(FRI, noodle.name_zh);
  assert.deepEqual(card.querySelector('.tags').children.map((n) => n.textContent), ['吃的', '早餐']);
  assert.ok(card.textContent.includes(TEXT.breakfast.inserted));
  assert.deepEqual(cardKeys(card), ['換一家', '改天去', '吃飯店早餐', '地圖']);
  assert.equal(cardOf(FRI, D.name_zh).querySelector('.tags'), null, '別的站沒有那個小標');
  assert.deepEqual(cardKeys(cardOf(FRI, D.name_zh)), ['換一家', '不去了', '地圖']);
  const before = idsOf(plan(FRI));
  press('吃飯店早餐', card);
  await settle();
  assert.deepEqual(idsOf(plan(FRI)), before.filter((id) => id !== noodle.id), '早餐拿掉，其餘先後不變');
  assert.deepEqual(tripDay(FRI).breakfast.mode, 'hotel');
  assert.equal(tripDay(FRI).breakfast.poiId, noodle.id);
  assert.ok(!plan(FRI).warnings.some((w) => w.ruleId === 'breakfast-slot'), '不提示');
  assert.deepEqual(dayNode(FRI).querySelectorAll('.day-note').map((n) => n.textContent), ['早餐在飯店吃改回來']);
  assert.deepEqual(undoBar(), ['8/14（五） 的早餐改成在飯店吃']);
  assert.equal(stored().days[FRI].breakfast.mode, 'hotel', '存進 localStorage');
  // 後面第一天（SAT）的早餐卡多一行「或 麵店（8/14 沒去的）」＋說明與簡介；SUN 沒有（只推薦一次）
  const offer = cardOf(SAT, stand.name_zh).querySelectorAll('.choice');
  assert.equal(offer.length, 1);
  assert.equal(offer[0].textContent, '或麵店（8/14 沒去的）多繞 5 分可以當早餐：麵店的早餐麵店的簡介');
  assert.deepEqual(cardOf(SUN, bakery.name_zh).querySelectorAll('.choice'), []);
  // 復原
  press('復原'); await settle();
  assert.equal(plan(FRI).meals.breakfast, noodle.id);
  assert.equal(tripDay(FRI).breakfast, undefined);
  assert.deepEqual(cardOf(SAT, stand.name_zh).querySelectorAll('.choice'), []);
  assert.equal(stored(), null);
  // 再按一次、這次用「改回來」
  press('吃飯店早餐', cardOf(FRI, noodle.name_zh));
  await settle();
  press('改回來', dayNode(FRI));
  await settle();
  assert.equal(plan(FRI).meals.breakfast, noodle.id);
  assert.deepEqual([dayNode(FRI).querySelectorAll('.day-note'), undoBar()], [[], []]);
});

test('改天去：後面每個合格的日子都掛「或 X」；按了那天的早餐換成它（變成他指定的、不再寫引擎先挑的那一句）、原本那天的小字改寫、別天不再推薦；有一次性復原', async () => {
  load();
  press('改天去', cardOf(FRI, noodle.name_zh));
  await settle();
  assert.equal(tripDay(FRI).breakfast.mode, 'later');
  assert.deepEqual(dayNode(FRI).querySelectorAll('.day-note').map((n) => n.textContent), ['早餐這天不排（麵店 改天去）改回來']);
  assert.deepEqual(undoBar(), ['8/14（五） 不排早餐，麵店 改天去']);
  assert.deepEqual([cardOf(SAT, stand.name_zh).querySelectorAll('.choice').length, cardOf(SUN, bakery.name_zh).querySelectorAll('.choice').length], [1, 1]);
  const satBefore = idsOf(plan(SAT));
  press('麵店', cardOf(SUN, bakery.name_zh).querySelector('.choice'));
  await settle();
  assert.deepEqual(idsOf(plan(SUN)), [noodle.id, ...idsOf(plan(SUN)).slice(1)]);
  assert.equal(plan(SUN).meals.breakfast, noodle.id);
  assert.ok(!idsOf(plan(SUN)).includes(bakery.id), '原本那家換掉了');
  const sunCard = cardOf(SUN, noodle.name_zh);
  assert.ok(!sunCard.textContent.includes(TEXT.breakfast.inserted), '他指定的早餐不寫「引擎先挑的」');
  assert.deepEqual(cardKeys(sunCard), ['換一家', '吃飯店早餐', '地圖'], 'SUN 是旅程最後一天：不出「改天去」（11-17）');
  assert.deepEqual(undoBar(), ['已把 麵店 排成 8/16（日） 的早餐']);
  assert.deepEqual(dayNode(FRI).querySelectorAll('.day-note').map((n) => n.textContent), ['早餐這天不排（麵店 改到 8/16（日） 去）改回來']);
  assert.deepEqual(idsOf(plan(SAT)), satBefore, '別天沒動');
  assert.deepEqual(cardOf(SAT, stand.name_zh).querySelectorAll('.choice'), [], '排走了就不再推薦');
  assert.equal(stored().days[SUN].picks.find((p) => p.poiId === noodle.id).breakfast, true);
  press('復原'); await settle();
  assert.equal(plan(SUN).meals.breakfast, bakery.id);
  assert.equal(cardOf(SUN, bakery.name_zh).querySelectorAll('.choice').length, 1, '回到按之前：推薦還掛著');
});

test('早餐換一家：清單最上面寫「早餐換一家」、每家帶「可以當早餐：…」；引擎先挑的也能換，換了就變成他勾的；「今天沒排早餐」是提示樣式、旁邊一顆「吃飯店早餐」', async () => {
  load();
  // 三家早餐店三天各用一家：先把 SUN 的說成吃飯店，那家空出來
  press('吃飯店早餐', cardOf(SUN, bakery.name_zh));
  await settle();
  press('換一家', cardOf(FRI, noodle.name_zh)); await settle();
  const list = cardOf(FRI, noodle.name_zh).querySelector('.swap-list');
  assert.equal(list.children[0].textContent, '早餐換一家');
  assert.deepEqual(list.querySelectorAll('.alt').map((b) => [b.querySelector('strong').textContent, b.querySelectorAll('.intro').map((n) => n.textContent)]), [[bakery.name_zh, ['可以當早餐：麵包店的早餐', '麵包店的簡介']]]);
  list.querySelectorAll('.alt')[0].click(); await settle();
  assert.equal(plan(FRI).meals.breakfast, bakery.id);
  assert.equal(plan(FRI).sequence[0].poi.id, bakery.id, '照樣排在第一站');
  assert.deepEqual(tripDay(FRI).picks.find((p) => p.poiId === bakery.id), { poiId: bakery.id, priority: 'want', breakfast: true });
  assert.ok(!cardOf(FRI, bakery.name_zh).textContent.includes(TEXT.breakfast.inserted));
  assert.deepEqual(cardKeys(cardOf(FRI, bakery.name_zh)), ['換一家', '改天去', '吃飯店早餐', '地圖']);
  // THU 釘住時就沒有早餐：日期下面一句提示（不是黃字）＋小鍵
  const hint = dayNode(THU).querySelectorAll('li').find((n) => n.textContent.startsWith('今天沒排早餐')) ?? assert.fail('THU 沒有「今天沒排早餐」');
  assert.equal(hint.className, 'hint');
  assert.deepEqual(labels(hint), ['吃飯店早餐']);
  press('吃飯店早餐', hint);
  await settle();
  assert.deepEqual(tripDay(THU).breakfast.mode, 'hotel');
  assert.equal(tripDay(THU).breakfast.poiId, null);
  assert.ok(!dayNode(THU).textContent.includes('今天沒排早餐'));
  assert.ok(dayNode(THU).querySelectorAll('.day-note').some((n) => n.textContent === '早餐在飯店吃改回來'));
  assert.deepEqual(idsOf(plan(THU)), ORDER1);
});

test('這天沒有早餐站、卻有他沒去到的那家可以排：日期下面一行「8/14 沒去的 X 這天早上可以去」＋「排進這天」，附說明與簡介；按了排成第一站、提示消失', async () => {
  // SAT 只勾一站、11:00 才開（早上有空）、而且拒絕過引擎排的早餐：那天沒有早餐站
  const trip = makeTrip();
  const sat = trip.days.find((d) => d.date === SAT);
  sat.picks = [{ poiId: late.id, priority: 'want' }];
  sat.removed = [{ poiId: stand.id, insertedBy: 'engine', priority: 'breakfast' }];
  load(trip);
  assert.equal(plan(SAT).meals.breakfast, null);
  assert.ok(dayNode(SAT).querySelectorAll('li').some((n) => n.className === 'hint' && n.textContent.startsWith('今天沒排早餐')));
  const friB = plan(FRI).meals.breakfast;
  press('改天去', cardOf(FRI, friB));
  await settle();
  const note = dayNode(SAT).querySelectorAll('.day-note').find((n) => n.textContent.startsWith(`8/14 沒去的 ${friB} 這天早上可以去`)) ?? assert.fail(`SAT 沒有那一行：${dayNode(SAT).querySelectorAll('.day-note').map((n) => n.textContent).join('｜')}`);
  assert.deepEqual(labels(note), ['排進這天']);
  assert.deepEqual(note.querySelectorAll('.intro').map((n) => n.textContent), [`可以當早餐：${friB}的早餐`, `${friB}的簡介`]);
  press('排進這天', note);
  await settle();
  // 11-12 起太晚出門也觸發填站（engine/trip.js FILL_TRIGGERS）：SAT 早上的空檔引擎會填一家店，早餐排在它前面、他勾的展館照舊在最後
  const satIds = idsOf(plan(SAT));
  assert.deepEqual([satIds[0], satIds.at(-1)], [friB, late.id]);
  assert.deepEqual(plan(SAT).sequence.filter((s) => !s.insertedBy).map((s) => s.poi.id), [friB, late.id], '他勾的就這兩站（中間多的是引擎填的）');
  assert.equal(plan(SAT).meals.breakfast, friB);
  assert.ok(!dayNode(SAT).textContent.includes('今天沒排早餐'));
  assert.deepEqual(undoBar(), [`已把 ${friB} 排成 8/15（六） 的早餐`]);
  assert.deepEqual(dayNode(SAT).querySelectorAll('.day-note').filter((n) => n.textContent.includes('這天早上可以去')), []);
  press('復原'); await settle();
  assert.equal(plan(SAT).meals.breakfast, null);
});

test('現場頁：下一站是早餐時鍵是「吃飯店早餐」「改天去」（沒有「略過這站」）；按了那天不排早餐、下一站變成後面那一站，頁上有一次復原；出發之後不再提', async () => {
  load();
  state.route = '#/now';
  app.setField({ date: FRI, index: 0, simulate: true });
  const next = () => dom.root.querySelector('.next');
  assert.equal(next().querySelector('h2').textContent, noodle.name_zh);
  assert.ok(next().textContent.includes(TEXT.breakfast.insertedNow));
  assert.deepEqual(labels(next().children.at(-1)), ['Google Maps 路線', '吃飯店早餐', '改天去']);
  press('吃飯店早餐', next());
  assert.ok(dom.text().includes('正在重排…'), '現場頁也先畫一句，讓他知道按到了');
  await settle();
  assert.ok(!dom.text().includes('正在重排…'));
  assert.equal(next().querySelector('h2').textContent, D.name_zh, '下一站是後面那一站');
  assert.equal(tripDay(FRI).breakfast.mode, 'hotel');
  assert.deepEqual(undoBar(), ['8/14（五） 的早餐改成在飯店吃']);
  press('復原'); await settle();
  assert.equal(next().querySelector('h2').textContent, noodle.name_zh);
  assert.equal(tripDay(FRI).breakfast, undefined);
  // 改天去；出發去下一站之後，現場頁不再畫那條復原列（規劃頁照舊有）
  press('改天去', next());
  await settle();
  assert.equal(tripDay(FRI).breakfast.mode, 'later');
  assert.equal(undoBar().length, 1);
  app.setField({ index: 1 });
  assert.deepEqual(undoBar(), []);
  state.route = '#/plan';
  app.render();
  assert.deepEqual(undoBar(), ['8/14（五） 不排早餐，麵店 改天去']);
  assert.ok(dayNode(FRI).querySelectorAll('.day-note').some((n) => n.textContent.startsWith('早餐這天不排（麵店 改天去）')));
});

test('國家層沒有早餐段的旅程（仙台示範）照舊：沒有早餐小標、早餐的鍵與提示；走廊清單的「升級成站」一樣走安插（排得下就釘住、排不下就問）', async () => {
  dom.storage.clear();
  app.loadDemo();
  state.route = '#/plan';
  app.render();
  const page = dom.text();
  assert.ok(dom.root.querySelectorAll('article.card').length >= 5, '示範旅程畫得出站卡');
  assert.deepEqual([dom.root.querySelectorAll('.tags'), dom.root.querySelectorAll('.day-note')], [[], []]);
  assert.ok(!/早餐|改天去/.test(page), '沒有早餐這回事');
  assert.doesNotMatch(page, KEYS);
  // 示範資料沒有座標、畫不出走廊清單：直接叫那個動作——候選池裡沒排進任何一天的一家，插進第一天的第 1 段
  const date = state.trip.days[0].date;
  const placedAnywhere = new Set(Object.values(state.plans).flatMap((d) => idsOf(d.plan)));
  const extra = state.pool.map((c) => c.poi).find((p) => !placedAnywhere.has(p.id)) ?? assert.fail('示範資料每一家都排進去了');
  const before = idsOf(plan(date));
  app.upgradeCorridor(date, extra.id, 1);
  await settle();
  if (state.insertAsk) {
    assert.deepEqual(idsOf(plan(date)), before, '排不下：旅程沒動，在問他');
    app.cancelInsert();
    assert.equal(state.insertAsk, null);
  } else {
    assert.equal(idsOf(plan(date))[1], extra.id, '插在第 1 段（第一站之後）');
    assert.deepEqual(idsOf(plan(date)).filter((id) => id !== extra.id), before, '原本的站一站不少、先後不變');
    assert.equal(plan(date).pinned, true);
    assert.match(undoBar()[0], /^已把 /);
    press('復原'); await settle();
    assert.deepEqual(idsOf(plan(date)), before);
  }
  for (const route of ['#/now', '#/pool', '#/settings']) { state.route = route; app.render(); assert.doesNotMatch(dom.text(), KEYS); }
});

test('重載之後改動還在（存 localStorage、打包相同才蓋回）：安插釘住的順序、少待的停留、早餐的決定都回得來；畫面不露鍵值', async () => {
  load();
  press('升級成站', corridorItem(THU, small.name_zh));
  await settle();
  press('改天去', cardOf(FRI, noodle.name_zh));
  await settle();
  const saved = dom.storage.get(EDITS_KEY);
  assert.ok(saved);
  // 重載：同一份打包檔再載入一次（app.js loadFromPack → restoreTripEdits）
  app.loadFromPack({ pack: { trip: makeTrip(), country: JP, zones: { zones: kb.zones, links: {} }, city: null, rules: null, meta: {}, walk: { pairs: {} } }, pois: WORLD });
  assert.equal(dom.storage.get(EDITS_KEY), saved, '鍵還在');
  assert.deepEqual(tripDay(THU).pinned.sequence.map((e) => e.poiId), [small.id, ...ORDER1]);
  assert.deepEqual(idsOf(plan(THU)).slice(0, 2), [small.id, A.id]);
  assert.equal(tripDay(FRI).breakfast.mode, 'later');
  assert.equal(plan(FRI).meals.breakfast, null);
  assert.equal(state.undo, null, '復原列不跨重載');
  state.route = '#/plan';
  app.render();
  assert.ok(dayNode(THU).textContent.includes('這天照你調過的順序排'));
  assert.ok(dayNode(FRI).textContent.includes('早餐這天不排（麵店 改天去）'));
  // 設定頁：本機改動算得到這兩天；還原成打包版之後都沒了
  assert.deepEqual(app.state.tripBase.days[THU].pinned.sequence.map((e) => e.poiId), ORDER1);
  app.resetTripEdits();
  assert.deepEqual([tripDay(THU).pinned.sequence.map((e) => e.poiId), tripDay(FRI).breakfast, dom.storage.get(EDITS_KEY) ?? null], [ORDER1, undefined, null]);
  // 把各種狀態都畫一遍，整頁的字不露程式鍵值
  load();
  press('升級成站', corridorItem(THU, big.name_zh));
  await settle();
  const pages = [dom.text()];
  press('改天去', cardOf(FRI, noodle.name_zh));
  await settle();
  pages.push(dom.text());
  press('換一家', cardOf(SAT, stand.name_zh)); await settle();
  pages.push(dom.text());
  for (const route of ['#/now', '#/pool', '#/settings']) { state.route = route; app.render(); pages.push(dom.text()); }
  for (const page of pages) assert.doesNotMatch(page, KEYS);
  assert.ok(pages[0].includes('插進 大店 之後排不下') && pages[1].includes('或麵店（8/14 沒去的）') && pages[2].includes('早餐換一家'));
});

// ── 11-12 畫面審查後補的（修正段）──

test('換一家也有一次性復原，復原列多一顆「關閉」（只收掉那一列、不復原）；動到別天時復原列接「別天跟著變了：…」，按復原連別天一起回去；引擎記著每天的早餐，有改動時跟著存', async () => {
  load();
  // 引擎記著每天的早餐（旅程檔 days[].engineBreakfast）；他沒有改動時不存
  assert.deepEqual([THU, FRI, SAT, SUN].map((d) => tripDay(d).engineBreakfast), [undefined, noodle.id, stand.id, bakery.id]);
  assert.equal(stored(), null, '只有引擎的備忘、沒有他的改動：不留鍵');
  // 換一家：釘住的 THU 晚餐店 → 居酒屋
  press('換一家', cardOf(THU, dinner.name_zh)); await settle();
  cardOf(THU, dinner.name_zh).querySelector('.swap-list').querySelectorAll('.alt').find((b) => b.querySelector('strong').textContent === izakaya.name_zh).click(); await settle();
  assert.deepEqual(undoBar(), ['已把 8/13（四） 的 晚餐店 換成 居酒屋']);
  const bar0 = () => dom.root.querySelectorAll('.undo-bar').find((n) => !n.classList.contains('notice'));
  assert.deepEqual(labels(bar0()), ['復原', '關閉']);
  assert.deepEqual([FRI, SAT, SUN].map((d) => stored().days[d].engineBreakfast), [noodle.id, stand.id, bakery.id], '有改動時引擎記著的早餐跟著快照存（重開 App 才接得上）');
  // 關閉：只收掉那一列，旅程沒動、之後也不能復原這一個動作
  press('關閉', bar0()); await settle();
  assert.deepEqual([undoBar(), state.undo], [[], null]);
  assert.ok(idsOf(plan(THU)).includes(izakaya.id));
  // 再換回來、按復原：回到換之前（居酒屋）。晚餐店接在午餐店後面多一句「兩個坐下來的站連著」（居酒屋沒有）：復原列最後講這天多了幾句（11-24 甲2）
  app.swapStop(THU, izakaya.id, dinner); await settle();
  assert.deepEqual(undoBar(), ['已把 8/13（四） 的 居酒屋 換成 晚餐店；這天多 1 句提醒']);
  press('復原'); await settle();
  assert.ok(idsOf(plan(THU)).includes(izakaya.id) && !idsOf(plan(THU)).includes(dinner.id));
  assert.deepEqual(undoBar(), []);
  // 動到別天：把 SAT 的街區F 換成 FRI 引擎排的早餐（直接叫動作）——那家變成 SAT 勾的站、排在街區F 的原位置（SAT 原本引擎排的早餐照舊在第一站、照舊是那天的早餐）；
  // FRI 的早餐被挪走了：FRI 照畫面上那一版釘住、少掉那一家，引擎不另外補（11-24 甲1）——那天排不到早餐、日期下面多一句提示，復原列接在後面講
  load();
  const before = [FRI, SAT, SUN].map((d) => idsOf(plan(d)));
  app.swapStop(SAT, F.id, noodle); await settle();
  assert.deepEqual(idsOf(plan(SAT)), before[1].map((id) => (id === F.id ? noodle.id : id)), 'SAT：原位置換掉，其餘各站先後不變');
  assert.equal(plan(SAT).meals.breakfast, stand.id, 'SAT 原本的早餐繼續是早餐（換進來的麵店也能當早餐，但不搶早餐卡；11-24 甲5）');
  assert.deepEqual(idsOf(plan(FRI)), before[0].filter((id) => id !== noodle.id), 'FRI：少了被挪走的那一家，其餘不變');
  assert.equal(plan(FRI).meals.breakfast, null);
  assert.equal(plan(FRI).pinned, true, 'FRI 照畫面上那一版釘住了（引擎不替它補早餐）');
  // 最後一句：SAT 自己多了一句（麵店卡上的「站內店接著麵店，兩個坐下來的站連著」）；句子裡已經有 8/14 的日期，所以寫 8/15 不寫「這天」
  assert.deepEqual(undoBar(), ['已把 8/15（六） 的 街區F 換成 麵店（從 8/14（五）挪過來）；8/14（五） 今天沒排早餐；8/15（六） 多 1 句提醒']);
  assert.ok(plan(SAT).warnings.some((w) => w.poiId === noodle.id && w.ruleId === 'recovery-run'));
  assert.ok(dayNode(FRI).querySelectorAll('li').some((n) => n.textContent.startsWith('今天沒排早餐')), '那一句真的在 FRI 的日期下面');
  assert.deepEqual(dayNode(FRI).querySelectorAll('.day-note').map((n) => n.textContent), ['這天照你調過的順序排讓引擎重排這天'], '原本那天變成釘住由那天日期下面那一行表示，復原列不重複講');
  assert.deepEqual(idsOf(plan(SUN)), before[2], 'SUN 沒被動到，也沒被寫進那一句');
  assert.equal(tripDay(FRI).engineBreakfast, undefined, '記著的那一家拿掉了');
  press('復原'); await settle();
  assert.deepEqual([FRI, SAT, SUN].map((d) => idsOf(plan(d))), before, '復原：別天也回到原樣');
  assert.deepEqual([tripDay(FRI).engineBreakfast, stored(), tripDay(FRI).pinned, tripDay(SAT).pinned], [noodle.id, null, undefined, undefined], '兩天都回到沒釘住');
});

test('換一家清單列得到別天引擎排的站（11-24；11-17 那一版不列、這份清單是空的）：THU 的午餐清單上 FRI／SAT／SUN 引擎排的早餐各帶一個小標；選了就挪過來、復原列兩天各講一句（那天少了早餐多一句提示也講）；復原兩天一起回去', async () => {
  load();
  const before = [THU, FRI, SAT, SUN].map((d) => idsOf(plan(d)));
  press('換一家', cardOf(THU, lunch.name_zh)); await settle();
  const list = cardOf(THU, lunch.name_zh).querySelector('.swap-list');
  assert.equal(list.children[0].textContent, '午餐換一家');
  const rows = list.querySelectorAll('.alt');
  assert.deepEqual(rows.map((b) => [b.querySelector('strong').textContent, b.querySelector('.cat')?.textContent ?? null]), [[noodle.name_zh, '8/14（五）已排'], [stand.name_zh, '8/15（六）已排'], [bakery.name_zh, '8/16（日）已排']], '這個小世界裡能當午餐、順路的店只有那三家早餐店');
  assert.equal(rows[0].textContent, '麵店8/14（五）已排 · 多繞 5 分麵店的簡介', '小標緊跟在店名後面');
  rows[0].click(); await settle();
  assert.deepEqual(idsOf(plan(THU)), ORDER1.map((id) => (id === lunch.id ? noodle.id : id)), 'THU：午餐店的原位置換成麵店');
  assert.deepEqual(idsOf(plan(FRI)), before[1].filter((id) => id !== noodle.id), 'FRI 沒有它了，其餘不變（那天照畫面釘住、引擎不補別家）');
  assert.deepEqual(undoBar(), ['已把 8/13（四） 的 午餐店 換成 麵店（從 8/14（五）挪過來）；8/14（五） 今天沒排早餐'], '店名不寫第二次；引擎排的跟他勾的一樣寫「從…挪過來」');
  assert.deepEqual([plan(FRI).pinned, tripDay(FRI).pinned.sequence.map((e) => [e.poiId, e.off ?? false])], [true, [...idsOf(plan(FRI)).map((id) => [id, false]), [noodle.id, true]]], 'FRI 釘住；被挪走的那一筆引擎站記著但不排（別天照樣不拿它）');
  press('復原'); await settle();
  assert.deepEqual([THU, FRI, SAT, SUN].map((d) => idsOf(plan(d))), before);
  assert.deepEqual([stored(), tripDay(FRI).pinned], [null, undefined]);
  // 真的沒有候選時那一句照餐別寫（不寫「同類型」）；「（別天已經排了的店不列）」那半句拿掉了
  state.pool = state.pool.filter((c) => ![noodle.id, stand.id, bakery.id].includes(c.poi.id));
  app.render();
  press('換一家', cardOf(THU, lunch.name_zh)); await settle();
  assert.equal(cardOf(THU, lunch.name_zh).querySelector('.swap-list').children[1].textContent, '附近沒有能當午餐、順路又開著的店');
});

test('換一家清單（畫面；11-24 傍晚主控定）：有帶小標的店就多一行說明「標了日期的店原本在那一天，選了就挪到這裡」（放在餐別那一句下面、沒有那一句就在最上面），沒有帶小標的不寫；每一家的「· 多繞 N 分」連分隔點包成不換行的一塊', () => {
  load();
  const HINT = '標了日期的店原本在那一天，選了就挪到這裡';
  const open = (name) => { press('換一家', cardOf(THU, name)); return cardOf(THU, name).querySelector('.swap-list'); };
  const shape = (list) => list.children.map((n) => (n.tag === 'p' ? n.textContent : n.tag));
  // 午餐清單：三家都是別天引擎排的早餐（各帶小標）——餐別那一句、說明、三家
  const lunchList = open(lunch.name_zh);
  assert.deepEqual(shape(lunchList), ['午餐換一家', HINT, 'button', 'button', 'button']);
  assert.equal(lunchList.children[1].className, 'muted small', '跟餐別那一句同一種小字');
  // 不是哪一餐的清單（街區C：一家還沒排的＋五家別天勾的）：沒有餐別那一句，說明在最上面
  assert.deepEqual(shape(open(C.name_zh)), [HINT, ...Array(6).fill('button')]);
  // 晚餐清單：兩家都還沒排，沒有小標，不寫那一句
  assert.deepEqual(shape(open(dinner.name_zh)), ['晚餐換一家', 'button', 'button']);
  // 「· 多繞 N 分」：分隔點與那幾個字在同一個不換行的 span 裡（之前是一段字，390 寬會斷成「· 多」＋下一行「繞 7 分」，或把「·」留在行尾）；
  // 它前面隔一個空白的文字節點（要換行就換在這裡）；整列的字不變
  const row = lunchList.querySelectorAll('.alt')[0];
  assert.deepEqual(row.querySelectorAll('.nb').map((n) => [n.tag, n.textContent]), [['span', '· 多繞 5 分']]);
  const at = row.children.indexOf(row.querySelector('.nb'));
  assert.deepEqual([row.children[at - 1].tag, row.children[at - 1].textContent, row.children[at - 2].className], ['#text', ' ', 'cat'], '小標、空白、不換行的那一塊');
  assert.equal(row.textContent, '麵店8/14（五）已排 · 多繞 5 分麵店的簡介');
  // 營業時間沒查到的店：那半句的分隔點用不斷行空白黏在第一個字前面（整句太長、不包成不換行的一塊）
  const noHours = { ...Z, id: '沒有營業時間的街區', name_zh: '沒有營業時間的街區', hours: null, highlight: '這一家的簡介' };
  addPois(noHours);
  app.render();
  const rowOf = (list, name) => list.querySelectorAll('.alt').find((b) => b.querySelector('strong').textContent === name) ?? assert.fail(`清單上沒有「${name}」`);
  const unknown = rowOf(open(C.name_zh), noHours.name_zh);
  assert.equal(unknown.textContent, '沒有營業時間的街區 · 多繞 5 分 · 營業時間沒查到，要先確認這一家的簡介');
  assert.deepEqual(unknown.querySelectorAll('.nb').map((n) => n.textContent), ['· 多繞 5 分']);
});

test('吃飯店早餐按在他自己勾的站上：復原列與日期下面那行小字都講是哪一站（之前那一站無聲不見）；改回來放回原位', async () => {
  // 他自己勾了一家只在早上開、只當早餐的店（09:05 排在第一站，算那天的早餐）
  const morning = { ...noodle, id: '晨間食堂', name_zh: '晨間食堂', highlight: '晨間食堂的簡介', meals: { breakfast: '定食到十點半' }, hours: Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((k) => [k, [['07:00', '10:30']]])) };
  const trip = makeTrip();
  trip.days.find((d) => d.date === FRI).picks = [{ poiId: morning.id, priority: 'want' }, { poiId: D.id, priority: 'want' }, { poiId: E.id, priority: 'want' }];
  dom.storage.clear();
  loadWorld(state, trip);
  state.pois[morning.id] = morning;
  state.pool.push({ poi: morning });
  app.replanAll();
  assert.equal(plan(FRI).meals.breakfast, morning.id);
  assert.equal(plan(FRI).sequence.find((s) => s.poi.id === morning.id).insertedBy ?? null, null, '他勾的站自己落在早餐時段');
  const before = idsOf(plan(FRI));
  const card = cardOf(FRI, morning.name_zh);
  assert.deepEqual(cardKeys(card), ['換一家', '改天去', '吃飯店早餐', '地圖']);
  press('吃飯店早餐', card);
  await settle();
  assert.ok(!idsOf(plan(FRI)).includes(morning.id));
  assert.deepEqual(undoBar(), ['8/14（五） 的早餐改成在飯店吃，晨間食堂 這天不去']);
  assert.deepEqual(dayNode(FRI).querySelectorAll('.day-note').map((n) => n.textContent), ['早餐在飯店吃（晨間食堂 這天不去）改回來']);
  press('改回來', dayNode(FRI));
  await settle();
  assert.deepEqual(idsOf(plan(FRI)), before);
  assert.deepEqual(dayNode(FRI).querySelectorAll('.day-note'), []);
});

test('換一家選了當天勾了但排不進的那一家（11-17）：這一站換成它、它自己那筆勾選留著，同一家不會在同一天出現兩次（之前兩筆勾選都排進去）；別天勾的（排進去的與沒排進的）列在後面、帶小標，選了就挪過來（11-24）', async () => {
  // SAT 勾三家咖啡廳（不是主題日，同類一天最多 2 家）：有一家排不進。FRI 也勾一家咖啡廳。帶 item：引擎不會自己把它們插進別天
  const mkCafe = (id) => ({ ...cafe, id, name_zh: id, highlight: `${id}的簡介`, curated: true, item: '咖啡豆' });
  const cafes = ['咖啡一', '咖啡二', '咖啡三'].map(mkCafe);
  const friCafe = mkCafe('咖啡四');
  const trip = makeTrip();
  trip.days.find((d) => d.date === SAT).picks = [F, G, ...cafes].map((p) => ({ poiId: p.id, priority: 'want' }));
  trip.days.find((d) => d.date === FRI).picks.push({ poiId: friCafe.id, priority: 'want' });
  dom.storage.clear();
  loadWorld(state, trip);
  for (const p of [...cafes, friCafe]) { state.pois[p.id] = p; state.pool.push({ poi: p }); }
  app.replanAll();
  assert.equal(plan(SAT).dropped.length, 1, `SAT 排不進的：${plan(SAT).dropped.map((x) => x.poi.id).join('、')}`);
  const out = plan(SAT).dropped[0].poi.id;
  assert.ok(cafes.some((p) => p.id === out));
  const [a, b] = cafes.filter((p) => p.id !== out);
  // 排進去的咖啡廳按「換一家」：清單列得到當天排不進的那一家
  press('換一家', cardOf(SAT, a.name_zh)); await settle();
  const row = cardOf(SAT, a.name_zh).querySelector('.swap-list').querySelectorAll('.alt').find((n) => n.querySelector('strong').textContent === out) ?? assert.fail(`清單裡沒有 ${out}`);
  row.click(); await settle();
  assert.deepEqual(idsOf(plan(SAT)).filter((id) => cafes.some((p) => p.id === id)).sort(), [b.id, out].sort(), '那一站換成它：兩家咖啡廳各出現一次');
  assert.deepEqual(tripDay(SAT).picks.map((p) => p.poiId).filter((id) => id === out), [out], '勾選只有一筆（之前 A 的那筆被改成它、它原本那筆還在，同一家排兩次）');
  assert.ok(!tripDay(SAT).picks.some((p) => p.poiId === a.id), 'A 的那筆拿掉了');
  assert.deepEqual(plan(SAT).dropped, []);
  assert.deepEqual(undoBar(), [`已把 8/15（六） 的 ${a.name_zh} 換成 ${out}`]);
  press('復原'); await settle();
  assert.deepEqual(plan(SAT).dropped.map((x) => x.poi.id), [out]);
  assert.deepEqual(tripDay(SAT).picks.map((p) => p.poiId), [F.id, G.id, ...cafes.map((p) => p.id)]);
  // 別天（FRI）那家咖啡廳的清單：SAT 排進去的寫「8/15（六）已排」、勾了沒排進的寫「8/15（六）勾了沒排進」（11-17 那一版都不列）
  const friBefore = idsOf(plan(FRI)); const satBefore = idsOf(plan(SAT));
  press('換一家', cardOf(FRI, friCafe.name_zh)); await settle();
  const friRows = () => cardOf(FRI, friCafe.name_zh).querySelector('.swap-list').querySelectorAll('.alt');
  assert.deepEqual(Object.fromEntries(friRows().map((n) => [n.querySelector('strong').textContent, n.querySelector('.cat')?.textContent ?? null])), Object.fromEntries(cafes.map((p) => [p.name_zh, p.id === out ? '8/15（六）勾了沒排進' : '8/15（六）已排'])));
  // 選 SAT 排進去的那一家：FRI 原位置換掉、它只在 FRI；SAT 的那筆勾選拿掉（不是不去了：不留拒絕紀錄）。
  // SAT 不整天重排（11-24 甲1）：照畫面上那一版釘住、少掉那一家，其餘各站先後不變；原本排不進的那一家因為空出同類的名額排進來（復原列照實講）
  friRows().find((n) => n.querySelector('strong').textContent === a.name_zh).click(); await settle();
  assert.deepEqual(idsOf(plan(FRI)), friBefore.map((id) => (id === friCafe.id ? a.id : id)), 'FRI：原位置換掉，其餘各站先後不變');
  assert.equal(plan(FRI).pinned, true, 'FRI 從此照他調過的順序排');
  assert.ok(!idsOf(plan(SAT)).includes(a.id) && !tripDay(SAT).picks.some((p) => p.poiId === a.id), '它原本那天沒有它');
  assert.deepEqual([tripDay(SAT).removed ?? [], tripDay(SAT).swapped ?? []], [[], []], 'SAT 不留「不去了」或換掉的紀錄');
  assert.equal(plan(SAT).pinned, true, 'SAT 也照畫面釘住（引擎不重排它）');
  assert.deepEqual(idsOf(plan(SAT)).filter((id) => id !== out), satBefore.filter((id) => id !== a.id), 'SAT：原順序少掉那一家，其餘各站（引擎排的早餐、他勾的）先後不變');
  assert.ok(idsOf(plan(SAT)).includes(out), `原本排不進的 ${out} 排進來：${idsOf(plan(SAT)).join('、')}`);
  assert.deepEqual(undoBar(), [`已把 8/14（五） 的 咖啡四 換成 ${a.name_zh}（從 8/15（六）挪過來）；8/15（六） ${out} 排進來了`]);
  assert.deepEqual([FRI, SAT].map((d) => dayNode(d).querySelectorAll('.day-note').map((n) => n.textContent)), [['這天照你調過的順序排讓引擎重排這天'], ['這天照你調過的順序排讓引擎重排這天']]);
  press('復原'); await settle();
  assert.deepEqual([idsOf(plan(FRI)), idsOf(plan(SAT)), plan(FRI).pinned ?? false, plan(SAT).pinned ?? false], [friBefore, satBefore, false, false], '復原：兩天逐站回到原樣，兩天都不再是釘住的');
  assert.deepEqual(tripDay(SAT).picks.map((p) => p.poiId), [F.id, G.id, ...cafes.map((p) => p.id)]);
  assert.equal(stored(), null, '本機改動的鍵回到原樣（沒有改動就不留鍵）');
  // 選 SAT 勾了沒排進的那一家：一樣挪過來，那一句寫的是「原本勾在…、那天沒排進」；SAT 畫面上沒有站要動——只拿掉勾選，重排後整趟逐站相同就不釘住
  press('換一家', cardOf(FRI, friCafe.name_zh)); await settle();
  friRows().find((n) => n.querySelector('strong').textContent === out).click(); await settle();
  assert.deepEqual(idsOf(plan(FRI)), friBefore.map((id) => (id === friCafe.id ? out : id)));
  assert.ok(!tripDay(SAT).picks.some((p) => p.poiId === out));
  assert.deepEqual(undoBar(), [`已把 8/14（五） 的 咖啡四 換成 ${out}（原本勾在 8/15（六）、那天沒排進）`]);
  assert.deepEqual([idsOf(plan(SAT)), plan(SAT).pinned ?? false, tripDay(SAT).pinned], [satBefore, false, undefined], 'SAT 的行程沒變（它本來就沒排進）、也沒被釘住');
  press('復原'); await settle();
  assert.deepEqual([idsOf(plan(FRI)), idsOf(plan(SAT)), stored()], [friBefore, satBefore, null]);
});

test('選項上的小標與店名（畫面；11-17）：引擎排的站多一個小標「引擎排的」；同一塊裡短店名撞名的兩家都寫全名；鍵上的字不露鍵值', () => {
  load();
  openFirstCorridor(THU);   // 走廊清單開著（記在 state.corridorOpen），重畫後還開著
  const res = { shiftMaxMin: 0, openSlotUsedMin: 0, openSlotUsedBeforeMin: 0 };
  const twin = { ...A, id: '街區A別館', name_zh: '街區A（別館）', highlight: '別館的簡介' };   // 括號拿掉之後短名跟街區A 一樣
  const stop = (poi, extra = {}) => ({ poi, dwellMin: 60, startMin: 600, insertedBy: null, ...extra });
  const opt = (kind, poi, fromMin, toMin) => ({ kind, poiId: poi.id, poi, fromMin, toMin, fits: true, shortMin: 0, result: res });
  state.insertAsk = { date: THU, legIndex: 0, poiId: big.id, chosen: [], trial: { round: 1, sequence: [stop(big), stop(A, { insertedBy: 'engine', priority: 'filler' }), stop(twin), stop(lunch)], index: 0, conflicts: [{ msg: '午餐店 排不進' }], blocked: { shortMin: 10 }, options: [opt('shorten', A, 60, 30), opt('drop', A, 60, 0), opt('drop', twin, 60, 0), opt('drop', lunch, 60, 0)] } };
  app.render();
  const ask = corridorItem(THU, big.name_zh).querySelector('.insert-ask') ?? assert.fail('選項沒畫出來');
  assert.deepEqual(askRows(ask).map((r) => [r.group, r.name, r.side, r.intro]), [
    ['少待一點', '街區A', ['60 → 30 分', '引擎排的'], '街區A的簡介'],
    ['這站不去', '街區A', ['街區', '引擎排的'], '街區A的簡介'],
    ['這站不去', '街區A（別館）', ['街區'], '別館的簡介'],
    ['這站不去', '午餐店', ['吃的'], '午餐店的簡介'],
  ]);
  assert.deepEqual(askRow(ask, '這站不去', '街區A').node.querySelector('.opt-side').children.map((n) => n.className), ['cat', 'cat'], '兩個都是既有的小標樣式');
  assert.doesNotMatch(dom.text(ask), KEYS);
  // 選項四個以下簡介留兩行；五個以上那一塊多一個 many（樣式把簡介收成一行，390×844 才進得了一個螢幕）
  assert.equal(ask.className, 'insert-ask');
  state.insertAsk.trial.options.push(opt('drop', C, 60, 0));
  app.render();
  const five = corridorItem(THU, big.name_zh).querySelector('.insert-ask');
  assert.equal(five.querySelectorAll('.opt').length, 5);
  assert.equal(five.className, 'insert-ask many');
  state.insertAsk = null;
});

test('排不下的選項「這站不去」那一組有 6 個以上：先列前 4 個、其餘收在一顆「再列 N 站」後面（11-24；原話 #194「再跳一組選項問我 要壓縮哪個行程或是砍掉」的版面）——按了展開、不再收回、重畫還開著；至少藏 2 個才收（剛好 5 個全列：收 1 個只換來一顆鍵）、「少待一點」那一組不收；下一輪的選項重新收合', async () => {
  load();
  openFirstCorridor(THU);
  const res = { shiftMaxMin: 0, openSlotUsedMin: 0, openSlotUsedBeforeMin: 0 };
  const stop = (poi, extra = {}) => ({ poi, dwellMin: 60, startMin: 600, insertedBy: null, ...extra });
  const opt = (kind, poi, fromMin, toMin) => ({ kind, poiId: poi.id, poi, fromMin, toMin, fits: true, shortMin: 0, result: res });
  const stops = [A, C, lunch, dinner, B, bar, D, E];
  const askOf = (drops, shortens = stops) => ({ date: THU, legIndex: 0, poiId: big.id, chosen: [], trial: { round: 1, sequence: [stop(big), ...stops.map((p) => stop(p))], index: 0, conflicts: [{ msg: '午餐店 排不進' }], blocked: { shortMin: 10 }, options: [...shortens.map((p) => opt('shorten', p, 60, 30)), ...drops.map((p) => opt('drop', p, 60, 0))] } });
  const ask = () => corridorItem(THU, big.name_zh).querySelector('.insert-ask') ?? assert.fail('選項沒畫出來');
  const dropNames = () => askRows(ask()).filter((r) => r.group === '這站不去').map((r) => r.name);
  const more = () => ask().children.filter((c) => typeof c !== 'string' && c.tag === 'button' && c.classList.contains('ask-more'));
  // 七個「不去」：列前四個（照引擎給的先後）＋一顆「再列 3 站」；「少待一點」八個全列
  state.insertAsk = askOf([A, C, lunch, dinner, B, bar, D]);
  app.render();
  assert.deepEqual(dropNames(), ['街區A', '街區C', '午餐店', '晚餐店']);
  assert.deepEqual(more().map((b) => [b.textContent, b.getAttribute('type')]), [['再列 3 站', 'button']], '是一顆真的鍵（鍵盤也按得到）');
  assert.equal(askRows(ask()).filter((r) => r.group === '少待一點').length, 8, '少待那一組不收');
  const kids = ask().children.filter((c) => typeof c !== 'string');
  assert.equal(kids.indexOf(more()[0]), kids.indexOf(askRow(ask(), '這站不去', '晚餐店').node) + 1, '那顆鍵接在第四個後面');
  // 按了：其餘三個接在原位置、那顆鍵不見；焦點落在第一個新出來的選項上
  more()[0].click(); await settle();
  assert.deepEqual(dropNames(), ['街區A', '街區C', '午餐店', '晚餐店', '街區B', '酒吧', '街區D']);
  assert.deepEqual(more(), []);
  assert.equal(document.activeElement, askRow(ask(), '這站不去', '街區B').node);
  // 不再收回：整頁重畫（按了別的不重排的鍵）還開著
  app.render();
  assert.deepEqual([dropNames().length, more().length], [7, 0]);
  // 展開出來的選項一樣按得動（按了就走選項那條路：這組假選項套不進旅程，選項收掉、旅程沒動）
  askRow(ask(), '這站不去', '街區D').node.click();
  await settle();
  assert.deepEqual([state.insertAsk, idsOf(plan(THU))], [null, ORDER1]);
  // 剛好四個、五個：都不收（11-24 傍晚主控裁決乙5：至少藏 2 個才收——五個時收 1 個只換來一顆鍵，那一塊只矮 35px）；六個收成四個＋「再列 2 站」
  state.insertAsk = askOf([A, C, lunch, dinner]);
  app.render();
  assert.deepEqual([dropNames().length, more().length], [4, 0]);
  state.insertAsk = askOf([A, C, lunch, dinner, B]);
  app.render();
  assert.deepEqual([dropNames(), more().length], [['街區A', '街區C', '午餐店', '晚餐店', '街區B'], 0], '五個全列，沒有「再列 1 站」');
  state.insertAsk = askOf([A, C, lunch, dinner, B, bar]);
  app.render();
  assert.deepEqual([dropNames().length, more().map((b) => b.textContent)], [4, ['再列 2 站']], '下一輪（新的一組選項）重新收合');
  assert.doesNotMatch(dom.text(ask()), KEYS);
  state.insertAsk = null;
});

// ── 11-17 補的（原話 #196、#197 的畫面收尾）──

/** 他自己勾了一家只在早上開、只當早餐的店（FRI 09:05 排在第一站，算那天的早餐）；回那家店。over 可以改那家店的欄位（例：只有星期六開）。 */
function loadWithPickedBreakfast(date = FRI, over = {}) {
  const morning = { ...noodle, id: '晨間食堂', name_zh: '晨間食堂', highlight: '晨間食堂的簡介', meals: { breakfast: '定食到十點半' }, hours: Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((k) => [k, [['07:00', '10:30']]])), ...over };
  const trip = makeTrip();
  const day = trip.days.find((d) => d.date === date);
  day.picks = [{ poiId: morning.id, priority: 'want' }, ...day.picks];
  dom.storage.clear();
  loadWorld(state, trip);
  state.pois[morning.id] = morning;
  state.pool.push({ poi: morning });
  app.replanAll();
  assert.equal(plan(date).meals.breakfast, morning.id);
  return morning;
}
/** 候選頁上某一家店那一列尾巴的字（「已排 8/14（五）」「沒排進」…）。 */
function poolMark(name) {
  state.route = '#/pool';
  app.render();
  const row = dom.root.querySelectorAll('li').find((n) => n.querySelector('strong')?.textContent === name) ?? assert.fail(`候選頁沒有「${name}」`);
  state.route = '#/plan';
  return row.children.at(-1).textContent.trim();
}

test('候選頁：被「吃飯店早餐／改天去」拿掉的勾選站講實情（之前寫「沒排進」）；改回來就是已排；引擎排的早餐不是他勾的，照舊', async () => {
  const morning = loadWithPickedBreakfast(FRI);
  assert.equal(poolMark(morning.name_zh), '已排 8/14（五）');
  app.render();
  press('吃飯店早餐', cardOf(FRI, morning.name_zh));
  await settle();
  assert.equal(poolMark(morning.name_zh), '8/14（五） 早餐在飯店吃，這天不去');
  app.render();
  press('改回來', dayNode(FRI));
  await settle();
  assert.equal(poolMark(morning.name_zh), '已排 8/14（五）');
  app.render();
  press('改天去', cardOf(FRI, morning.name_zh));
  await settle();
  assert.equal(poolMark(morning.name_zh), '8/14（五） 不排早餐，改天去');
  // 後來在別天按了「或 X」排進去：就是已排那一天
  app.render();
  const offerDay = [SAT, SUN].find((d) => dayNode(d).querySelectorAll('.choice').some((n) => n.textContent.includes(morning.name_zh)));
  if (offerDay) {
    press(morning.name_zh, dayNode(offerDay));
    await settle();
    assert.match(poolMark(morning.name_zh), /^已排 8\/1[56]（.）$/);
  }
  // 引擎排的早餐（麵店不是他勾的）說成吃飯店：候選頁照舊寫沒排進（它本來就只是候選）
  load();
  press('吃飯店早餐', cardOf(FRI, noodle.name_zh));
  await settle();
  assert.equal(poolMark(noodle.name_zh), '沒排進');
  assert.doesNotMatch(dom.text(), KEYS);
});

test('旅程最後一天的早餐卡不出「改天去」（後面沒有日子可以去），「吃飯店早餐」照出；規劃頁與現場頁都是；前面幾天照舊兩顆都有', () => {
  load();
  assert.equal(state.trip.days.at(-1).date, SUN, '小世界的最後一天是 SUN');
  assert.deepEqual(cardKeys(cardOf(SUN, bakery.name_zh)), ['換一家', '吃飯店早餐', '地圖']);
  assert.deepEqual(cardKeys(cardOf(FRI, noodle.name_zh)), ['換一家', '改天去', '吃飯店早餐', '地圖']);
  assert.deepEqual(cardKeys(cardOf(SAT, stand.name_zh)), ['換一家', '改天去', '吃飯店早餐', '地圖']);
  // 卡上那一句也不叫他按卡上沒有的鍵：最後一天不提「改天去」，前面的日子照舊
  const sunText = cardOf(SUN, bakery.name_zh).textContent;
  assert.ok(sunText.includes(TEXT.breakfast.insertedLast) && !sunText.includes('改天去'), sunText);
  assert.ok(cardOf(SAT, stand.name_zh).textContent.includes(TEXT.breakfast.inserted));
  assert.ok(TEXT.breakfast.inserted.includes('改天去') && !TEXT.breakfast.insertedLast.includes('改天去') && TEXT.breakfast.insertedNow.includes('改天去') && !TEXT.breakfast.insertedNowLast.includes('改天去'));
  state.route = '#/now';
  app.setField({ date: SUN, index: 0, simulate: true });
  const next = () => dom.root.querySelector('.next');
  assert.equal(next().querySelector('h2').textContent, bakery.name_zh);
  assert.deepEqual(labels(next().children.at(-1)), ['Google Maps 路線', '吃飯店早餐']);
  assert.ok(next().textContent.includes(TEXT.breakfast.insertedNowLast) && !next().textContent.includes('改天去'), next().textContent);
  app.setField({ date: SAT, index: 0, simulate: true });
  assert.deepEqual(labels(next().children.at(-1)), ['Google Maps 路線', '吃飯店早餐', '改天去']);
  assert.ok(next().textContent.includes(TEXT.breakfast.insertedNow));
});

test('按了「改天去」「吃飯店早餐」之後，後面目前沒有排得進這家的日子：復原列那一句後面多半句（之前一句話都沒有）；後面排得進的照舊不多話', async () => {
  // 他勾的早餐店只有星期六開：SAT 按了改天去，後面只剩 SUN、那天它沒開
  const satOnly = { hours: { sat: [['07:00', '10:30']] } };
  const morning = loadWithPickedBreakfast(SAT, satOnly);
  press('改天去', cardOf(SAT, morning.name_zh));
  await settle();
  assert.equal(tripDay(SAT).breakfast.mode, 'later');
  assert.deepEqual(undoBar(), ['8/15（六） 不排早餐，晨間食堂 改天去；目前後面沒有排得進這家的日子']);
  assert.deepEqual(dayNode(SUN).querySelectorAll('.choice').filter((n) => n.textContent.includes(morning.name_zh)), [], 'SUN 真的沒有掛「或 晨間食堂」');
  assert.deepEqual(dayNode(SUN).querySelectorAll('.day-note').filter((n) => n.textContent.includes(morning.name_zh)), []);
  press('復原'); await settle();
  assert.equal(plan(SAT).meals.breakfast, morning.id);
  // 吃飯店早餐也一樣：那家之後不會被推薦到，講一聲
  press('吃飯店早餐', cardOf(SAT, morning.name_zh));
  await settle();
  assert.deepEqual(undoBar(), ['8/15（六） 的早餐改成在飯店吃，晨間食堂 這天不去；目前後面沒有排得進這家的日子']);
  press('復原'); await settle();
  // 現場頁按的也是同一句
  state.route = '#/now';
  app.setField({ date: SAT, index: 0, simulate: true });
  press('改天去', dom.root.querySelector('.next'));
  await settle();
  assert.deepEqual(undoBar(), ['8/15（六） 不排早餐，晨間食堂 改天去；目前後面沒有排得進這家的日子']);
  // 旅程最後一天吃飯店早餐：後面本來就沒有日子，不接那半句（11-17 畫面審查：「目前後面沒有排得進…」在最後一天是廢話，「目前」還讀得像之後可能會有）
  load();
  press('吃飯店早餐', cardOf(SUN, bakery.name_zh));
  await settle();
  assert.deepEqual(undoBar(), ['8/16（日） 的早餐改成在飯店吃']);
  press('復原'); await settle();
  // 原定那家是引擎排的（那一句裡沒有店名）、後面有日子卻都排不進：把店名寫出來。FRI 的早餐換成只有星期五開的店，再按吃飯店早餐
  load();
  const friOnly = { ...noodle, id: '週五食堂', name_zh: '週五食堂', highlight: '週五食堂的簡介', meals: { breakfast: '週五限定的定食' }, hours: { fri: [['07:00', '10:30']] } };
  state.pois[friOnly.id] = friOnly;
  state.pool = state.pool.filter((c) => ![noodle.id, stand.id, bakery.id].includes(c.poi.id));   // 別的早餐店拿掉：引擎在 FRI 只挑得到它
  state.pool.push({ poi: friOnly });
  for (const id of [noodle.id, stand.id, bakery.id]) delete state.pois[id];
  app.replanAll();
  assert.equal(plan(FRI).meals.breakfast, friOnly.id, '引擎排的早餐是只有星期五開的那一家');
  assert.equal(plan(FRI).sequence.find((s) => s.poi.id === friOnly.id).insertedBy, 'engine');
  press('吃飯店早餐', cardOf(FRI, friOnly.name_zh));
  await settle();
  assert.deepEqual(undoBar(), ['8/14（五） 的早餐改成在飯店吃；原定的 週五食堂 目前後面沒有排得進的日子']);
  // 後面排得進的：不多那半句（FRI 的麵店，SAT／SUN 都掛得上）
  load();
  press('改天去', cardOf(FRI, noodle.name_zh));
  await settle();
  assert.deepEqual(undoBar(), ['8/14（五） 不排早餐，麵店 改天去']);
  press('復原'); await settle();
  press('吃飯店早餐', cardOf(FRI, noodle.name_zh));
  await settle();
  assert.deepEqual(undoBar(), ['8/14（五） 的早餐改成在飯店吃']);
  // 那天本來就沒排到早餐、他只是說在飯店吃（沒有哪一家可問）：不多話
  const hint = dayNode(THU).querySelectorAll('li').find((n) => n.textContent.startsWith('今天沒排早餐')) ?? assert.fail('THU 沒有「今天沒排早餐」');
  press('吃飯店早餐', hint);
  await settle();
  assert.deepEqual(undoBar(), ['8/13（四） 的早餐改成在飯店吃']);
  for (const s of [TEXT.breakfast.noLaterDay, TEXT.breakfast.noLaterDayNamed('麵包店')]) assert.doesNotMatch(s, KEYS, s);
});

test('釘住的日子的「或 B」（11-17）：選了會讓其餘各站排不進的 B 不出現（比照釘住的日子的換一家清單）；出現的選了就是原位置換掉、其餘各站先後不變、A 順延到別天；有一次性復原', async () => {
  // THU 釘住的順序裡放兩家他勾的咖啡廳（09:05 的咖啡甲、18:35 的咖啡乙）；候選池多兩家沒勾過的咖啡廳：要坐 300 分的與一般的。
  // 帶 item（代購研究的店）：引擎不會自己把它們插進別天，二選一照樣可以出（engine/choices.js choiceEligible）
  const mkCafe = (id, over = {}) => ({ ...cafe, id, name_zh: id, highlight: `${id}的簡介`, ...over });
  const cafeA = mkCafe('咖啡甲'); const cafeB = mkCafe('咖啡乙');
  const longCafe = mkCafe('久坐咖啡', { curated: true, dwellMin: 300, item: '咖啡豆' });
  const okCafe = mkCafe('街角咖啡', { curated: true, item: '咖啡豆' });
  const order = [cafeA.id, C.id, lunch.id, dinner.id, cafeB.id, bar.id];
  const trip = makeTrip();
  Object.assign(trip.days.find((d) => d.date === THU), { picks: order.map((poiId) => ({ poiId, priority: 'want' })), pinned: { at: '2026-11-12T00:00:00.000Z', sequence: order.map((poiId) => ({ poiId })) } });
  dom.storage.clear();
  loadWorld(state, trip);
  for (const p of [cafeA, cafeB, longCafe, okCafe]) { state.pois[p.id] = p; state.pool.push({ poi: p }); }
  app.replanAll();
  assert.deepEqual(idsOf(plan(THU)), order);
  assert.equal(plan(THU).pinned, true);
  // 引擎照樣提了兩個二選一；畫面只出選了沒事的那一個
  assert.deepEqual(plan(THU).choices.map((c) => c.options), [[cafeA.id, longCafe.id], [cafeB.id, okCafe.id]]);
  assert.deepEqual(cardOf(THU, cafeA.name_zh).querySelectorAll('.choice'), [], '久坐咖啡頂掉咖啡甲的話午餐店（14:30 關）就排不進：這個「或」不出');
  const line = cardOf(THU, cafeB.name_zh).querySelector('.choice') ?? assert.fail('咖啡乙的卡上沒有「或 街角咖啡」');
  assert.ok(line.textContent.startsWith('或街角咖啡'), line.textContent);
  press(okCafe.name_zh, line);
  await settle();
  assert.deepEqual(idsOf(plan(THU)), order.map((id) => (id === cafeB.id ? okCafe.id : id)), '原位置換掉，其餘各站先後不變');
  assert.equal(plan(THU).pinned, true);
  assert.deepEqual(plan(THU).dropped, []);
  assert.deepEqual(tripDay(THU).pinned.sequence.map((e) => e.poiId), order.map((id) => (id === cafeB.id ? okCafe.id : id)), '記著的順序裡 B 就在 A 的原位置');
  assert.match(undoBar()[0], /^咖啡乙 (已排到 8\/1[456]（.）|先留在候選池（別天排不進）)/);
  assert.ok(!tripDay(THU).picks.some((p) => p.poiId === cafeB.id), 'A 不在這天的勾選裡了');
  press('復原'); await settle();
  assert.deepEqual(idsOf(plan(THU)), order);
  assert.deepEqual(tripDay(THU).pinned.sequence.map((e) => e.poiId), order);
  assert.equal(stored(), null);
});

test('引擎排的早餐不再是當天的早餐（他在它前面插了一家能當早餐的店）：早餐的小標與鍵移到那一家，原本那張卡回到「不去了」、那一句不再叫他按卡上沒有的鍵；現場頁同理', async () => {
  load();
  const extra = { ...noodle, id: '早餐四店', name_zh: '早餐四店', highlight: '早餐四店的簡介', meals: { breakfast: '早餐四店的早餐', lunch: true } };
  state.pois[extra.id] = extra;
  state.pool.push({ poi: extra });
  app.upgradeCorridor(FRI, extra.id, 0);
  await settle();
  assert.equal(state.insertAsk, null, '排得下，直接插');
  assert.deepEqual(idsOf(plan(FRI)).slice(0, 2), [extra.id, noodle.id]);
  assert.equal(plan(FRI).meals.breakfast, extra.id, '排在前面的那一家算這天的早餐');
  const old = cardOf(FRI, noodle.name_zh);
  assert.deepEqual(cardKeys(old), ['不去了', '地圖']);
  assert.ok(old.textContent.includes(TEXT.engineInserted) && !old.textContent.includes(TEXT.breakfast.inserted), old.textContent);
  assert.equal(old.querySelector('.tags'), null, '早餐的小標不在這張卡上了');
  assert.deepEqual(cardKeys(cardOf(FRI, extra.name_zh)), ['換一家', '改天去', '吃飯店早餐', '地圖']);
  // 現場頁：走到引擎排的那一站，鍵是「略過這站」，那一句也講略過
  state.route = '#/now';
  app.setField({ date: FRI, index: 1, simulate: true });
  const next = dom.root.querySelector('.next');
  assert.equal(next.querySelector('h2').textContent, noodle.name_zh);
  assert.ok(next.textContent.includes(TEXT.engineInsertedNow) && !next.textContent.includes(TEXT.breakfast.insertedNow), next.textContent);
  assert.deepEqual(labels(next.children.at(-1)), ['Google Maps 路線', '略過這站']);
  // 真的是當天早餐的那一站，兩頁的那一句照舊
  app.setField({ date: SAT, index: 0, simulate: true });
  assert.ok(dom.root.querySelector('.next').textContent.includes(TEXT.breakfast.insertedNow));
  state.route = '#/plan';
  app.render();
  assert.ok(cardOf(SAT, stand.name_zh).textContent.includes(TEXT.breakfast.inserted));
});

test('升級排不下的選項多的時候（三個以上），「算了，不插」在提示那一行也有一顆（不用捲到最底下才收得掉）；選項少就只有最底下那一顆', async () => {
  load();
  const ask = () => corridorItem(THU, big.name_zh).querySelector('.insert-ask');
  const cancels = () => labels(ask()).filter((x) => x === '算了，不插').length;
  const head = () => ask().querySelector('.ask-head');
  press('升級成站', corridorItem(THU, big.name_zh));
  await settle();
  assert.ok(ask().querySelectorAll('.alt').length >= 3);
  assert.equal(cancels(), 2);
  assert.deepEqual(labels(head()), ['算了，不插']);
  assert.ok(head().textContent.startsWith('選一個讓它排得下，或算了不插：'));
  // 走到最後一輪（只列選了就排得下的，剩沒幾個）
  const pick = async (group, name) => { askRow(ask(), group, name).node.click(); await settle(); };
  await pick('少待一點', '街區A');
  await pick('少待一點', '街區C');
  const n = ask().querySelectorAll('.alt').length;
  assert.equal(cancels(), n >= 3 ? 2 : 1, `最後一輪 ${n} 個選項`);
  // 提示行那一顆按了一樣是收掉、旅程沒動
  load();
  press('升級成站', corridorItem(THU, big.name_zh));
  await settle();
  press('算了，不插', head()); await settle();
  assert.deepEqual([state.insertAsk, idsOf(plan(THU)), undoBar(), stored()], [null, ORDER1, [], null]);
});

// ── 沒釘住的日子換一家：選的那家要排進去；排不進、或擠掉了當天別的勾選站，復原列要講實情（11-17 畫面審查）。
// 11-24 起換一家與「或 B」一律原位置換掉、把那天釘住（engine/choices.js swapInPlace），清單上的每一家先試排——從清單選的一定排得進；不經過清單直接叫動作時照實講 ──
/** SAT 勾四家咖啡廳（不是主題日，同類一天最多 2 家）：咖啡一、咖啡二評過五星先排進去，咖啡三、咖啡四排不進。帶 item：引擎不會自己把它們插進別天。 */
function loadFourCafes() {
  const mkCafe = (id, over = {}) => ({ ...cafe, id, name_zh: id, highlight: `${id}的簡介`, curated: true, item: '咖啡豆', ...over });
  const cafes = [mkCafe('咖啡一', { my: { rating: 5 } }), mkCafe('咖啡二', { my: { rating: 5 } }), mkCafe('咖啡三'), mkCafe('咖啡四')];
  const trip = makeTrip();
  trip.days.find((d) => d.date === SAT).picks = [F, G, ...cafes].map((p) => ({ poiId: p.id, priority: 'want' }));
  dom.storage.clear();
  loadWorld(state, trip);
  for (const p of cafes) { state.pois[p.id] = p; state.pool.push({ poi: p }); }
  app.replanAll();
  return cafes;
}

test('沒釘住的日子換一家：選了當天排不進的那一家、當天同類排不進的不只一家——選的那家就排在原位置、其餘各站先後不變、那天從此照他調過的順序排（之前整天重新搜尋，選的那家還在排不進清單，復原列卻寫換好了）；復原回原樣、不再是釘住的', async () => {
  const [c1, c2, c3, c4] = loadFourCafes();
  const cafeIds = (p) => idsOf(p).filter((id) => /^咖啡/.test(id)).sort();
  assert.deepEqual(cafeIds(plan(SAT)), [c1.id, c2.id]);
  assert.deepEqual(plan(SAT).dropped.map((x) => x.poi.id).sort(), [c3.id, c4.id]);
  assert.ok(!plan(SAT).pinned, 'SAT 還沒釘住');
  const order = idsOf(plan(SAT)); const others = [THU, FRI, SUN].map((d) => idsOf(plan(d)));
  // 咖啡一的清單列得到當天排不進的兩家（沒有小標：它們就是今天勾的）；選排在後面的咖啡四——跟咖啡三同分量，光比分數輪不到它
  press('換一家', cardOf(SAT, c1.name_zh)); await settle();
  const rows = cardOf(SAT, c1.name_zh).querySelector('.swap-list').querySelectorAll('.alt');
  const names = rows.map((n) => n.querySelector('strong').textContent);
  assert.ok(names.includes(c3.id) && names.includes(c4.id), `清單：${names.join('、')}`);
  assert.ok(rows.every((n) => !n.querySelector('.cat')), '當天勾了但排不進的不帶「別天已排」的小標');
  rows.find((n) => n.querySelector('strong').textContent === c4.id).click(); await settle();
  assert.deepEqual(idsOf(plan(SAT)), order.map((id) => (id === c1.id ? c4.id : id)), '選的那一家在咖啡一的原位置，其餘各站（引擎排的早餐、他勾的）先後不變');
  assert.deepEqual(plan(SAT).dropped.map((x) => x.poi.id), [c3.id], '咖啡三照舊排不進；沒有別的站因此掉下去');
  assert.deepEqual(undoBar(), ['已把 8/15（六） 的 咖啡一 換成 咖啡四']);
  assert.equal(plan(SAT).pinned, true, '那天釘住了');
  assert.deepEqual(tripDay(SAT).pinned.sequence.map((e) => e.poiId), order.map((id) => (id === c1.id ? c4.id : id)));
  assert.deepEqual(dayNode(SAT).querySelectorAll('.day-note').map((n) => n.textContent), ['這天照你調過的順序排讓引擎重排這天'], '日期下面出現那一行與「讓引擎重排這天」，跟升級成站之後一樣');
  assert.deepEqual([THU, FRI, SUN].map((d) => idsOf(plan(d))), others, '別天逐站不變');
  assert.ok(stored().days[SAT].pinned, '釘住的順序跟著存');
  press('復原'); await settle();
  assert.deepEqual(idsOf(plan(SAT)), order, '復原：逐站回到原樣');
  assert.deepEqual([plan(SAT).pinned ?? false, tripDay(SAT).pinned, stored()], [false, undefined, null], '那天不再是釘住的，本機改動的鍵回到原樣');
  assert.deepEqual(dayNode(SAT).querySelectorAll('.day-note'), []);
  assert.deepEqual(cafeIds(plan(SAT)), [c1.id, c2.id]);
  assert.deepEqual(plan(SAT).dropped.map((x) => x.poi.id).sort(), [c3.id, c4.id]);
  // 「或 B」同一條路（engine/choices.js chooseDay 記的是同一種換站紀錄）：直接叫動作選排在後面的那一家
  app.chooseOption(SAT, c1.id, c4);
  await settle();
  assert.ok(idsOf(plan(SAT)).includes(c4.id), `選了 B 就排進這天：${idsOf(plan(SAT)).join('、')}`);
  assert.ok(!idsOf(plan(SAT)).includes(c1.id));
  assert.doesNotMatch(undoBar()[0], /今天排不進/, undoBar()[0]);
});

test('沒釘住的日子換一家，選的那家還是排不進（今天沒開）：復原列講實情「已把 A 拿掉，但 B 今天排不進」，不寫換好了；二選一同理', async () => {
  load();
  const closed = { ...Z, id: '週一才開', name_zh: '週一才開（備用）', hours: { mon: [['09:00', '18:00']] } };   // SAT 是週六：今天沒開
  state.pois[closed.id] = closed;
  app.swapStop(SAT, F.id, closed); await settle();
  assert.ok(!idsOf(plan(SAT)).includes(closed.id) && !idsOf(plan(SAT)).includes(F.id));
  assert.deepEqual(plan(SAT).dropped.map((x) => x.poi.id), [closed.id]);
  assert.deepEqual(undoBar(), ['已把 8/15（六） 的 街區F 拿掉，但 週一才開 今天排不進']);
  press('復原'); await settle();
  assert.ok(idsOf(plan(SAT)).includes(F.id));
  // 二選一選了 B、B 自己排不進：那一句不把它寫成「擠掉了」
  app.chooseOption(SAT, F.id, closed);
  await settle();
  assert.ok(!idsOf(plan(SAT)).includes(closed.id));
  assert.match(undoBar()[0], /^街區F (已排到 8\/1[346]（.）|先留在候選池（別天排不進）)；週一才開 今天排不進/, undoBar()[0]);
  assert.doesNotMatch(undoBar()[0], /擠掉了[^；]*週一才開/, undoBar()[0]);
});

test('換一家擠掉了當天別的勾選站（不經過清單直接叫動作；清單上的每一家都試排過，不會列這種）：復原列接「擠掉了 8/13（四） 的 X」；清單不列它', async () => {
  // THU（順序釘死）第一站街區A 換成要逛 600 分的街區：09:05 逛到 19:05，午餐店（14:30 關）與酒吧（24:00 關）排不進
  const long = { ...Z, id: '逛很久的街區', name_zh: '逛很久的街區', dwellMin: 600 };
  load();
  state.pois[long.id] = long;
  state.pool.push({ poi: long });
  press('換一家', cardOf(THU, A.name_zh)); await settle();
  const names = cardOf(THU, A.name_zh).querySelector('.swap-list').querySelectorAll('.alt').map((n) => n.querySelector('strong').textContent);
  assert.ok(names.includes(Z.name_zh) && !names.includes(long.name_zh), `試排過：會害別的站排不進的不列（${names.join('、')}）`);
  app.swapStop(THU, A.id, long); await settle();
  assert.equal(idsOf(plan(THU))[0], long.id, '選的那家在原位置');
  assert.deepEqual(plan(THU).dropped.map((x) => x.poi.id), [lunch.id, bar.id]);
  // 最後那一句（11-24 甲2）：這天多了兩句——日期下面的「今天沒排午餐」、第一站卡上的「連續走路已經 605 分…」（「今天走路會到 N 分」換之前就有，不算）
  assert.ok(plan(THU).warnings.some((w) => !w.poiId && w.msg === '今天沒排午餐') && plan(THU).warnings.some((w) => w.poiId === long.id && w.ruleId === 'walk-run'));
  assert.deepEqual(undoBar(), ['已把 8/13（四） 的 街區A 換成 逛很久的街區；擠掉了 8/13（四） 的 午餐店、8/13（四） 的 酒吧；這天多 2 句提醒']);
  press('復原'); await settle();
  assert.deepEqual([idsOf(plan(THU)), plan(THU).dropped], [ORDER1, []]);
});

test('沒釘住的日子的「或 B」（11-24）：卡上只出試排過的；選了 B 就在 A 的原位置、其餘各站先後不變、那天釘住、A 順延到別天；復原之後那天不再是釘住的', async () => {
  // SAT 勾兩個街區與兩家咖啡廳（都排得進）；候選池另有兩家沒勾過的咖啡廳：要坐 700 分的與一般的。帶品項：引擎不會自己把它們插進哪一天，二選一照樣可以出
  const mkCafe = (id, over = {}) => ({ ...cafe, id, name_zh: id, highlight: `${id}的簡介`, curated: true, item: '咖啡豆', ...over });
  const c1 = mkCafe('咖啡一'); const c2 = mkCafe('咖啡二'); const okCafe = mkCafe('街角咖啡'); const longCafe = mkCafe('久坐咖啡', { dwellMin: 700 });
  const trip = makeTrip();
  trip.days.find((d) => d.date === SAT).picks = [F, c1, G, c2].map((p) => ({ poiId: p.id, priority: 'want' }));
  dom.storage.clear();
  loadWorld(state, trip);
  for (const p of [c1, c2, okCafe, longCafe]) { state.pois[p.id] = p; state.pool.push({ poi: p }); }
  app.replanAll();
  assert.ok(!plan(SAT).pinned && plan(SAT).dropped.length === 0, `SAT 沒釘住、都排得進：${idsOf(plan(SAT)).join('、')}`);
  const order = idsOf(plan(SAT));
  const offered = plan(SAT).choices.map((c) => [c.poiId, c.options[1]]);
  const lines = dayNode(SAT).querySelectorAll('.choice').map((n) => n.querySelector('button').textContent);
  assert.ok(offered.length >= 1, `引擎提了二選一：${JSON.stringify(offered)}`);
  assert.ok(!lines.includes(longCafe.name_zh), `坐 700 分的那一家選了後面的站會排不進：卡上不出（${lines.join('、')}）`);
  const line = dayNode(SAT).querySelectorAll('.choice').find((n) => n.querySelector('button').textContent === okCafe.name_zh) ?? assert.fail(`卡上沒有「或 街角咖啡」：引擎提的 ${JSON.stringify(offered)}`);
  const fromId = plan(SAT).choices.find((c) => c.options[1] === okCafe.id).poiId;
  press(okCafe.name_zh, line);
  await settle();
  assert.deepEqual(idsOf(plan(SAT)), order.map((id) => (id === fromId ? okCafe.id : id)), 'B 在 A 的原位置，其餘各站先後不變');
  assert.equal(plan(SAT).pinned, true);
  assert.deepEqual(plan(SAT).dropped, []);
  assert.match(undoBar()[0], new RegExp(`^${fromId} (已排到 8/1[346]（.）|先留在候選池（別天排不進）)`));
  assert.doesNotMatch(undoBar()[0], /今天排不進|擠掉了 8\/15/);
  press('復原'); await settle();
  assert.deepEqual([idsOf(plan(SAT)), plan(SAT).pinned ?? false, stored()], [order, false, null]);
});

// ── 11-24 傍晚主控裁決（甲線；都是推導，依據寫在各段）：挪別天已排的店，它原本那天不整天重排；復原列改短、照實講；早餐是他勾的站時也原位置換掉；
// 換進來的店不搶早餐卡；「讓引擎重排這天」講掉進排不進的站 ──
const everyDay = (open, close) => Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((k) => [k, [[open, close]]]));
const timesOf = (date) => plan(date).sequence.map((s) => [s.poi.id, s.insertedBy ?? null, s.startMin, s.endMin]);
const pinNote = (date) => dayNode(date).querySelectorAll('.day-note').map((n) => n.textContent).filter((t) => t.includes('照你調過的順序'));
/** 把幾家店加進知識庫與候選池（loadWorld 之後、重排之前）。 */
function addPois(...list) { for (const p of list) { state.pois[p.id] = p; state.pool.push({ poi: p }); } }

test('挪別天他勾的站（甲1）：它原本那天不整天重排——照畫面上那一版釘住、原順序少掉那一家，引擎排的站不跟著變；這天與那天以外逐站逐時刻不變；復原列「（從 8/14（五）挪過來）」；復原兩天都回到沒釘住', async () => {
  // 原話 #192「順路站 升級成站時 不應該把原本的行程刪掉 應該是安插進來」的類推：他只動了一站，別的站不該跟著動。
  // FRI：只開早上的街區 → 12:00 才開的街區，中間等開門的空檔引擎填了一站。把後面那一家挪到 THU：之前 FRI 整天重新搜尋，空檔沒了、引擎填的那一站跟著不見
  const early = { ...Z, id: '只開早上的街區', name_zh: '只開早上的街區', highlight: '只開早上', hours: everyDay('09:00', '11:00') };
  const noon = { ...Z, id: '中午才開的街區', name_zh: '中午才開的街區', highlight: '中午才開', hours: everyDay('12:00', '23:00') };
  const trip = makeTrip();
  trip.days.find((d) => d.date === FRI).picks = [early, noon].map((p) => ({ poiId: p.id, priority: 'want' }));
  const gapCafe = { ...cafe, id: '空檔咖啡廳', name_zh: '空檔咖啡廳', highlight: '空檔咖啡廳的簡介', curated: true, dwellMin: 70 };
  dom.storage.clear();
  loadWorld(state, trip);
  addPois(early, noon, gapCafe);
  app.replanAll();
  const friBefore = idsOf(plan(FRI));
  const filler = plan(FRI).sequence.find((s) => s.insertedBy === 'engine' && s.priority === 'filler') ?? assert.fail(`FRI 的空檔引擎沒填站：${friBefore.join('、')}`);
  assert.ok(friBefore.indexOf(early.id) < friBefore.indexOf(filler.poi.id) && friBefore.indexOf(filler.poi.id) < friBefore.indexOf(noon.id), friBefore.join('、'));
  const others = [SAT, SUN].map(timesOf); const friTimes = timesOf(FRI);
  app.swapStop(THU, C.id, noon); await settle();
  assert.deepEqual(idsOf(plan(THU)), ORDER1.map((id) => (id === C.id ? noon.id : id)), 'THU：原位置換掉');
  assert.deepEqual(idsOf(plan(FRI)), friBefore.filter((id) => id !== noon.id), 'FRI：原順序少掉那一家，引擎填的那一站還在');
  assert.deepEqual(timesOf(FRI), friTimes.filter(([id]) => id !== noon.id), 'FRI 排在它前面的各站時刻不動');
  assert.equal(plan(FRI).pinned, true);
  assert.deepEqual(pinNote(FRI), ['這天照你調過的順序排讓引擎重排這天'], '原本那天變成釘住，由那天日期下面那一行表示');
  assert.deepEqual([SAT, SUN].map(timesOf), others, '這天與原本那天以外逐站、逐時刻不變');
  assert.deepEqual([THU, FRI, SAT, SUN].flatMap((d) => plan(d).dropped), [], '每一天他勾的站一站不少');
  assert.ok(undoBar()[0].startsWith('已把 8/13（四） 的 街區C 換成 中午才開的街區（從 8/14（五）挪過來）'), undoBar()[0]);
  assert.ok(!undoBar()[0].includes('別天跟著變了') && !undoBar()[0].includes('不去了'), undoBar()[0]);
  assert.deepEqual(tripDay(FRI).picks.map((p) => p.poiId), [early.id]);
  assert.deepEqual([tripDay(FRI).removed ?? [], tripDay(FRI).swapped ?? []], [[], []], '不是不去了：不留拒絕紀錄');
  press('復原'); await settle();
  assert.deepEqual([idsOf(plan(THU)), idsOf(plan(FRI)), plan(FRI).pinned ?? false, tripDay(FRI).pinned, stored()], [ORDER1, friBefore, false, undefined, null], '復原：兩天逐站回到原樣，FRI 不再是釘住的，本機改動的鍵回到原樣');
  assert.deepEqual([pinNote(FRI), [SAT, SUN].map(timesOf)], [[], others]);
});

test('挪別天「勾了沒排進」的那一家（甲1）：只拿掉勾選；重排後別天逐站相同就不釘住，不相同（少了那筆勾選，那天搜出來的不一樣）才照畫面釘住', async () => {
  // FRI 勾了一家只有週四開的遠方街區（FRI 沒開、排不進）：它在別的區，那天的當日區域因為它才含那一區——空檔引擎填的是那一區的咖啡廳。
  // 把它挪到 THU：FRI 少了那筆勾選，那一區不在當日區域了，整天重排的話引擎填的那一站會換掉；所以這種時候 FRI 照畫面釘住
  const early = { ...Z, id: '只開早上的街區', name_zh: '只開早上的街區', hours: everyDay('09:00', '11:00') };
  const noon = { ...Z, id: '中午才開的街區', name_zh: '中午才開的街區', hours: everyDay('12:00', '23:00') };
  const far = { ...Z, id: '遠方的街區', name_zh: '遠方的街區', zoneId: 'far', hours: { thu: [['09:00', '23:00']] } };
  const farCafe = { ...cafe, id: '遠方的咖啡廳', name_zh: '遠方的咖啡廳', highlight: '遠方的咖啡廳的簡介', zoneId: 'far', curated: true, dwellMin: 75 };
  const setup = (friPicks) => {
    const trip = makeTrip();
    trip.days.find((d) => d.date === FRI).picks = friPicks.map((p) => ({ poiId: p.id, priority: 'want' }));
    dom.storage.clear();
    loadWorld(state, trip);
    addPois(early, noon, far, farCafe);
    app.replanAll();
  };
  setup([early, noon, far]);
  assert.deepEqual(plan(FRI).dropped.map((x) => x.poi.id), [far.id], 'FRI 沒開、排不進');
  const friBefore = timesOf(FRI);
  assert.ok(friBefore.some(([id, by]) => id === farCafe.id && by === 'engine'), `FRI 的空檔填的是那一區的咖啡廳：${idsOf(plan(FRI)).join('、')}`);
  app.swapStop(THU, C.id, far); await settle();
  assert.deepEqual(idsOf(plan(THU)), ORDER1.map((id) => (id === C.id ? far.id : id)));
  assert.deepEqual([timesOf(FRI), plan(FRI).dropped, plan(FRI).pinned], [friBefore, [], true], 'FRI 逐站逐時刻不變（照畫面釘住了），排不進清單少了那一家');
  assert.deepEqual(undoBar(), ['已把 8/13（四） 的 街區C 換成 遠方的街區（原本勾在 8/14（五）、那天沒排進）']);
  press('復原'); await settle();
  assert.deepEqual([timesOf(FRI), plan(FRI).pinned ?? false, stored()], [friBefore, false, null]);
  // 對照：那一區另外還有他勾的站撐著（遠方的咖啡廳是他自己勾的）——拿掉那筆勾選，FRI 搜出來的還是同一條，就不釘住
  setup([early, noon, far, farCafe]);
  const same = timesOf(FRI);
  app.swapStop(THU, C.id, far); await settle();
  assert.deepEqual([timesOf(FRI), plan(FRI).pinned ?? false, tripDay(FRI).pinned], [same, false, undefined]);
});

test('復原列最後一句「多 N 句提醒」（甲2）：換了之後這天多出來的黃字只寫句數（黃字本身在那天看得到）；句子裡另有別的日期時把這天的日期寫出來；沒多就不接', async () => {
  load();
  const dayLines = (date) => plan(date).warnings.filter((w) => !w.poiId).map((w) => w.msg);
  const was = dayLines(THU);
  // 晚餐店換成街區（不經過清單直接叫動作）：THU 少了晚餐，日期下面多一句黃字。
  // 「今天走路會到 N 分，超過上限」換之前就有（寫在第一次超過的那一站上），換了之後只是數字與掛的那一站變了，不算多出來的；「兩個坐下來的站連著」那一句不見了也不用講
  app.swapStop(THU, dinner.id, Z); await settle();
  assert.deepEqual(dayLines(THU).filter((x) => !was.includes(x)), ['今天沒排晚餐']);
  assert.deepEqual(undoBar(), ['已把 8/13（四） 的 晚餐店 換成 街區Z；這天多 1 句提醒']);
  press('復原'); await settle();
  // 沒多出黃字：不接那一句（晚餐店換成能當晚餐的居酒屋）
  app.swapStop(THU, dinner.id, izakaya); await settle();
  assert.deepEqual(undoBar(), ['已把 8/13（四） 的 晚餐店 換成 居酒屋']);
  press('復原'); await settle();
  // 挪別天的店過來、這天又多出黃字：前面已經出現另一天的日期，「這天」會讀成那一天，所以寫日期
  app.swapStop(THU, dinner.id, D); await settle();
  assert.deepEqual(undoBar(), ['已把 8/13（四） 的 晚餐店 換成 街區D（從 8/14（五）挪過來）；8/13（四） 多 1 句提醒']);
  press('復原'); await settle();
  // 「或 B」同理（那一句講的是 A 排到哪一天，沒有這天的日期）：直接叫動作，把晚餐店換成街區
  app.chooseOption(THU, dinner.id, Z);
  await settle();
  assert.match(undoBar()[0], /^晚餐店 (已排到 8\/1[456]（.）|先留在候選池（別天排不進）).*；8\/13（四） 多 1 句提醒$/, undoBar()[0]);
});

test('「讓引擎重排這天」之後有站掉進排不進（甲6）：復原列接「X 排不進了」（之前只寫已讓引擎重排；不寫「擠掉了」——沒有誰擠它，是交回引擎之後排不進）', async () => {
  // THU（釘住）最後一站酒吧換成要待 200 分的酒吧：照調過的順序排得下（20:00–23:20，用到留白）；交回引擎整天重排時收工線扣掉留白（22:30），它就排不進
  const longBar = { ...bar, id: '待很久的酒吧', name_zh: '待很久的酒吧', highlight: '待很久的酒吧的簡介', dwellMin: 200 };
  load();
  addPois(longBar);
  app.swapStop(THU, bar.id, longBar); await settle();
  assert.deepEqual([idsOf(plan(THU)).at(-1), plan(THU).dropped], [longBar.id, []], '釘住的順序上排得下');
  press('讓引擎重排這天', dayNode(THU));
  await settle();
  assert.deepEqual(plan(THU).dropped.map((x) => x.poi.id), [longBar.id]);
  assert.deepEqual(undoBar(), ['已讓引擎重排 8/13（四）；待很久的酒吧 排不進了']);
  press('復原'); await settle();
  assert.deepEqual([idsOf(plan(THU)).at(-1), plan(THU).dropped, plan(THU).pinned], [longBar.id, [], true]);
});

test('早餐那一站是他自己勾的（甲4）：早餐的換一家也原位置換掉並把那天釘住——同一天引擎排的站不動、其餘各站先後不變（之前整天重新搜尋，引擎排的站不見而復原列沒講）；復原回到沒釘住', async () => {
  // FRI：他勾的晨間食堂（只開早上、只當早餐，排在第一站算那天的早餐）→ 12:00 才開的街區，中間的空檔引擎填了一站
  const morning = { ...noodle, id: '晨間食堂', name_zh: '晨間食堂', highlight: '晨間食堂的簡介', meals: { breakfast: '定食到十點半' }, hours: everyDay('07:00', '10:30') };
  const noon = { ...Z, id: '中午才開的街區', name_zh: '中午才開的街區', hours: everyDay('12:00', '23:00') };
  const gapCafe = { ...cafe, id: '空檔咖啡廳', name_zh: '空檔咖啡廳', highlight: '空檔咖啡廳的簡介', curated: true, dwellMin: 70 };
  const trip = makeTrip();
  trip.days.find((d) => d.date === FRI).picks = [morning, noon].map((p) => ({ poiId: p.id, priority: 'want' }));
  dom.storage.clear();
  loadWorld(state, trip);
  addPois(morning, noon, gapCafe);
  app.replanAll();
  const before = idsOf(plan(FRI));
  assert.deepEqual([before[0], before.at(-1), plan(FRI).dropped], [morning.id, noon.id, []], `FRI 他勾的兩站都排進去：${before.join('、')}`);
  assert.equal(plan(FRI).meals.breakfast, morning.id);
  assert.equal(plan(FRI).sequence.find((s) => s.poi.id === morning.id).insertedBy ?? null, null, '他勾的站自己落在早餐時段');
  const engineStops = plan(FRI).sequence.filter((s) => s.insertedBy === 'engine').map((s) => s.poi.id);
  assert.ok(engineStops.length >= 1, `FRI 有引擎排的站：${before.join('、')}`);
  const others = [THU, SAT, SUN].map(timesOf);
  press('換一家', cardOf(FRI, morning.name_zh)); await settle();
  const list = cardOf(FRI, morning.name_zh).querySelector('.swap-list');
  assert.equal(list.children[0].textContent, '早餐換一家');
  const row = list.querySelectorAll('.alt')[0] ?? assert.fail('早餐清單是空的');
  const picked = row.querySelector('strong').textContent;
  row.click(); await settle();
  assert.deepEqual(idsOf(plan(FRI)), before.map((id) => (id === morning.id ? picked : id)), '原位置換掉：其餘各站（含引擎排的）先後不變');
  assert.deepEqual(plan(FRI).sequence.filter((s) => s.insertedBy === 'engine').map((s) => s.poi.id), engineStops, '引擎排的站一站不少');
  assert.deepEqual([plan(FRI).meals.breakfast, plan(FRI).pinned, plan(FRI).dropped], [picked, true, []], '換進來的那家是這天的早餐；那天照他調過的順序排');
  assert.deepEqual(pinNote(FRI), ['這天照你調過的順序排讓引擎重排這天']);
  assert.deepEqual([THU, SAT, SUN].map(timesOf), others, '別天逐站、逐時刻不變');
  assert.ok(undoBar()[0].startsWith(`已把 8/14（五） 的 晨間食堂 換成 ${picked}`), undoBar()[0]);
  press('復原'); await settle();
  assert.deepEqual([idsOf(plan(FRI)), plan(FRI).pinned ?? false, tripDay(FRI).pinned, stored()], [before, false, undefined, null]);
  // 早餐是引擎先挑的（SAT）照舊：換了就變成他勾的、排成第一站，那天不釘住
  const satFirst = idsOf(plan(SAT))[0];
  press('換一家', cardOf(SAT, state.pois[satFirst].name_zh)); await settle();
  cardOf(SAT, state.pois[satFirst].name_zh).querySelector('.swap-list').querySelectorAll('.alt')[0].click(); await settle();
  assert.deepEqual([plan(SAT).pinned ?? false, tripDay(SAT).pinned], [false, undefined]);
});

test('換進來的店剛好也能當早餐（甲5）：不搶早餐卡——那天原本的早餐（引擎排的、或他在早餐卡換過的那一家）繼續是早餐、三顆鍵照舊，換進來的那家是一般的站；「吃飯店早餐」只拿掉早餐那一筆', async () => {
  // 早餐四店：能當早餐、要待 30 分（比引擎排的早餐待得久——照「跟早餐時段重疊多的算早餐」會把早餐卡搶走）
  const extra = { ...noodle, id: '早餐四店', name_zh: '早餐四店', highlight: '早餐四店的簡介', dwellMin: 30, meals: { breakfast: '早餐四店的早餐', lunch: true } };
  const fifth = { ...noodle, id: '早餐五店', name_zh: '早餐五店', highlight: '早餐五店的簡介', meals: { breakfast: '早餐五店的早餐' } };
  const start = () => { load(); addPois(extra, fifth); app.replanAll(); };
  // (1) 引擎排的早餐在第一站：把後面的街區D 換成早餐四店
  start();
  const first = idsOf(plan(FRI))[0];
  assert.deepEqual([first, plan(FRI).meals.breakfast, plan(FRI).sequence[0].insertedBy], [noodle.id, noodle.id, 'engine']);
  app.swapStop(FRI, D.id, extra); await settle();
  assert.deepEqual(idsOf(plan(FRI)).slice(0, 2), [noodle.id, extra.id], '早餐四店排在街區D 的原位置（09:30 起，落在早餐時段裡）');
  assert.equal(plan(FRI).meals.breakfast, noodle.id, '這天的早餐還是引擎排的那一家');
  assert.deepEqual(cardKeys(cardOf(FRI, noodle.name_zh)), ['換一家', '改天去', '吃飯店早餐', '地圖'], '早餐卡的三顆鍵照舊');
  assert.ok(cardOf(FRI, noodle.name_zh).querySelector('.tags'), '「早餐」小標還在原本那張卡上');
  assert.deepEqual(cardKeys(cardOf(FRI, extra.name_zh)), ['換一家', '不去了', '地圖'], '換進來的那家是一般的站');
  assert.equal(cardOf(FRI, extra.name_zh).querySelector('.tags'), null);
  assert.equal(tripDay(FRI).picks.find((p) => p.poiId === extra.id).breakfast, false, '那筆勾選記著「不當早餐」');
  // 吃飯店早餐：只拿掉早餐那一筆，換進來的那家留著
  press('吃飯店早餐', cardOf(FRI, noodle.name_zh));
  await settle();
  assert.ok(!idsOf(plan(FRI)).includes(noodle.id) && idsOf(plan(FRI)).includes(extra.id), idsOf(plan(FRI)).join('、'));
  assert.deepEqual(cardKeys(cardOf(FRI, extra.name_zh)), ['換一家', '不去了', '地圖']);
  // (2) 先在早餐卡換成別家（變成他指定的早餐），再把同一天的街區D 換成早餐四店：指定的那一家繼續是早餐
  start();
  press('換一家', cardOf(FRI, noodle.name_zh)); await settle();
  const row = cardOf(FRI, noodle.name_zh).querySelector('.swap-list').querySelectorAll('.alt').find((n) => n.querySelector('strong').textContent === fifth.name_zh) ?? assert.fail('早餐清單沒有早餐五店');
  const chosen = row.querySelector('strong').textContent;
  row.click(); await settle();
  assert.equal(state.pois[plan(FRI).meals.breakfast].name_zh, chosen);
  const chosenId = plan(FRI).meals.breakfast;
  app.swapStop(FRI, D.id, extra); await settle();
  assert.ok(idsOf(plan(FRI)).includes(extra.id));
  assert.equal(plan(FRI).meals.breakfast, chosenId, '他指定的早餐沒有失去早餐卡');
  assert.deepEqual(cardKeys(cardOf(FRI, chosen)), ['換一家', '改天去', '吃飯店早餐', '地圖']);
  assert.deepEqual(cardKeys(cardOf(FRI, extra.name_zh)), ['換一家', '不去了', '地圖']);
  // (3) 這天沒有早餐（他說吃飯店）：換進來的店不用讓——照一般的勾選，不記那個記號
  start();
  press('吃飯店早餐', cardOf(FRI, noodle.name_zh));
  await settle();
  app.swapStop(FRI, D.id, extra); await settle();
  assert.equal(tripDay(FRI).picks.find((p) => p.poiId === extra.id).breakfast, undefined);
});
