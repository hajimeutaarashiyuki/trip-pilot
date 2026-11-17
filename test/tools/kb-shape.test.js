// 知識庫選填欄位的形狀檢查（tools/kb-shape.mjs；11-17）：meals、closedDates、samePlace、researchRank、closeRisk、連結的末班 last、國家層的餐段與特殊時刻表。
// 寫對的不報；寫壞的每一種都要抓得到、講得出是哪一筆的哪一欄；接進 kb-check 之後算「擋打包」。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkShapes, formatShapes, lastProblems, isDateString, isMonthDay, clockMin, loadShapeInputs, CLOSE_RISK_VALUES } from '../../tools/kb-shape.mjs';
import { checkKb, formatReport } from '../../tools/kb-check.mjs';
import { lastDepartMin, serviceDayOf } from '../../src/geo/matrix.js';
import { mealSlotsOf } from '../../src/rules/_slots.js';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FAKECITY = fileURLToPath(new URL('../fixtures/kb/fakecity/', import.meta.url));
const row = (name, over = {}) => ({ name_zh: name, name_local: name, category: '定食', area: '北町（北町1-1）', hours: '11:00-14:00', maps_query: name, ...over });
const dataOf = (...rows) => ({ categories: { x: { items: rows } } });
const msgs = (r, field = null) => r.problems.filter((p) => !field || p.field === field).map((p) => `${p.where}｜${p.msg}`);
// 待套用版知識庫實際的寫法（仙台 11-12）：全部都要過
const GOOD_ROWS = [
  row('朝市商店街', { meals: { breakfast: '魚店食堂 7:30 起有海鮮丼', lunch: true }, closedDates: ['2026-08-14', '2026-08-15', '2026-08-16'], samePlace: '朝市' }),
  row('朝市', { meals: { breakfast: '魚店食堂 7:30 起有海鮮丼' }, closedDates: ['2026-08-14'] }),
  row('飯糰舖', { meals: { breakfast: '外帶飯糰' }, closeRisk: 'irregular', researchRank: 'backup' }),
  row('百貨', { meals: {}, closeRisk: 'none', researchRank: 'first', samePlace: ['朝市', '朝市商店街'], closedDates: [] }),
  row('沒寫的店'),
  row('明講沒有', { meals: null, closedDates: null, samePlace: null, researchRank: null, closeRisk: null }),
];
const GOOD_LINKS = {
  'town|sea': { mode: 'jr', rideMin: 30, walkMin: 5, last: { sea: '22:41', town: '24:12' } },
  'town|far': { mode: 'bus', rideMin: 60, walkMin: 5, last: { far: { weekday: '21:01', saturday: '21:01', holiday: '19:18' }, town: { weekday: '00:12' } } },
  'town|hill': { mode: 'walk', rideMin: 0, walkMin: 10 },
};
const GOOD_COUNTRY = {
  mealSlots: { breakfast: ['07:00', '10:00'], lunch: ['11:30', '13:30'], dinner: ['18:00', '24:00'] },
  transportProfile: { specialSchedule: [{ name: 'お盆', from: '08-13', to: '08-16' }, { name: '年末年始', from: '12-29', to: '01-03' }, { name: '閏日', from: '02-29', to: '02-29' }] },
};

test('寫對的都不報：仙台待套用版實際用到的每一種寫法（meals 的三種值、closedDates、samePlace 字串與陣列、兩種 researchRank、closeRisk、末班單一值與分日別、國家層三段餐與跨年的特殊期間）', () => {
  const r = checkShapes({ data: dataOf(...GOOD_ROWS), links: GOOD_LINKS, country: GOOD_COUNTRY });
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.counts, { meals: 4, closedDates: 3, samePlace: 2, researchRank: 2, closeRisk: 2, last: 2, mealSlots: 3, specialSchedule: 3 }, '數的是「寫了這一欄」的筆數（null＝明講沒有，不算）');
  assert.deepEqual(r.checked, { data: true, links: true, country: true });
  assert.equal(formatShapes(r).split('\n').at(-1), '形狀檢查：沒有要改的');
  assert.deepEqual(CLOSE_RISK_VALUES, ['none', 'irregular', 'tempHistory'], 'DESIGN §4 POI 欄位表的三個值');
  // 什麼都沒給：不查、不報
  const none = checkShapes({});
  assert.deepEqual([none.problems, none.checked], [[], { data: false, links: false, country: false }]);
  assert.match(formatShapes(none), /站 沒查（沒有 data\.json）；連結 沒查（沒有 zones\.json 的 links）；國家層 沒查（找不到國家層檔）/);
});

test('站的欄位寫壞：meals 的鍵與值、closedDates 的形狀與日期、samePlace 指到不存在的或自己、researchRank 與 closeRisk 的錯字——每一處都列出是哪一家、哪裡不對', () => {
  const r = checkShapes({ data: dataOf(
    row('甲', { meals: { diner: true, lunch: '' } }),
    row('乙', { meals: ['lunch'] }),
    row('丙', { closedDates: '2026-08-14' }),
    row('丁', { closedDates: ['2026-08-14', '2026/08/15', '8/16', '2026-02-30', 20260817, '2026-8-1'] }),
    row('戊', { samePlace: '不存在的店' }),
    row('己', { samePlace: '己' }),
    row('庚', { samePlace: ['甲', '沒有這家', 7, ''] }),
    row('辛', { samePlace: { id: '甲' } }),
    row('壬', { researchRank: '首選' }),
    row('癸', { closeRisk: 'irregluar' }),
    row('子', { closeRisk: true }),
  ) });
  assert.deepEqual(msgs(r, 'meals'), [
    '甲｜meals 有看不懂的鍵 "diner"（只收 breakfast／lunch／dinner）',
    '甲｜meals.lunch 的值看不懂：""（要寫 true 或一句說明；不能當這一餐就不要列這個鍵）',
    '乙｜meals 的值看不懂：["lunch"]（要寫物件：鍵是 breakfast／lunch／dinner，值是 true 或一句說明；{}＝不是吃正餐的地方）',
  ]);
  assert.deepEqual(msgs(r, 'closedDates'), [
    '丙｜closedDates 要寫成日期的陣列（["2026-08-14", …]）："2026-08-14"',
    '丁｜closedDates 有看不懂的日期 "2026/08/15"（要寫 YYYY-MM-DD，而且是真的有的一天）',
    '丁｜closedDates 有看不懂的日期 "8/16"（要寫 YYYY-MM-DD，而且是真的有的一天）',
    '丁｜closedDates 有看不懂的日期 "2026-02-30"（要寫 YYYY-MM-DD，而且是真的有的一天）',
    '丁｜closedDates 有看不懂的日期 20260817（要寫 YYYY-MM-DD，而且是真的有的一天）',
    '丁｜closedDates 有看不懂的日期 "2026-8-1"（要寫 YYYY-MM-DD，而且是真的有的一天）',
  ]);
  assert.deepEqual(msgs(r, 'samePlace'), [
    '戊｜samePlace 指到的 "不存在的店" 不在這份知識庫裡（id 是 name_local 轉的：小寫、非字母數字換成 -）',
    '己｜samePlace 指到自己（己）',
    '庚｜samePlace 指到的 "沒有這家" 不在這份知識庫裡（id 是 name_local 轉的：小寫、非字母數字換成 -）',
    '庚｜samePlace 裡有不是 id 的值：7',
    '庚｜samePlace 裡有不是 id 的值：""',
    '辛｜samePlace 要寫另一筆的 id（一筆指好幾筆時寫陣列）：{"id":"甲"}',
  ]);
  assert.deepEqual(msgs(r, 'researchRank'), ['壬｜researchRank 的值看不懂："首選"（要寫 first 或 backup）']);
  assert.deepEqual(msgs(r, 'closeRisk'), ['癸｜closeRisk 的值看不懂："irregluar"（只收 none／irregular／tempHistory）', '子｜closeRisk 的值看不懂：true（只收 none／irregular／tempHistory）']);
  assert.ok(r.problems.every((p) => p.level === 'block'), '都是擋打包等級');
  // samePlace 的 id 就是打包時的 id（name_local 轉的）：寫 name_local 原文裡有空白、大寫的要照轉過的寫
  const slug = checkShapes({ data: dataOf(row('朝市 A', { name_local: 'Asaichi Market' }), row('朝市 B', { samePlace: 'asaichi-market' }), row('朝市 C', { samePlace: 'Asaichi Market' })) });
  assert.deepEqual(msgs(slug), ['朝市 C｜samePlace 指到的 "Asaichi Market" 不在這份知識庫裡（id 是 name_local 轉的：小寫、非字母數字換成 -）']);
  assert.match(formatShapes(r).split('\n').at(-1), /^形狀檢查：先改這些（18 處/);
  assert.deepEqual([isDateString('2026-08-14'), isDateString('2024-02-29'), isDateString('2026-02-29'), isDateString('2026-13-01'), isDateString(' 2026-08-14')], [true, true, false, false, false]);
});

test('連結的末班 last 寫壞：時分不合法（"25:99" 之前會被算成 26:39）、不是 HH:MM、分日別的鍵與值、寫在不是這條連結兩端的區——引擎把這些當沒資料、不判，所以要在這裡講出來', () => {
  const links = {
    'town|sea': { rideMin: 30, last: { sea: '25:99', town: '23:60' } },
    'town|far': { rideMin: 60, last: { far: { weekday: '21:01', sunday: '19:18', holiday: '7:5' }, twon: '22:00' } },
    'town|hill': { rideMin: 5, last: '23:00' },
    'sea|far': { rideMin: 20, last: { sea: {}, far: 2300 } },
    'far|hill': { rideMin: 20, last: { far: '28:00', hill: '27:59' } },
  };
  const r = checkShapes({ links });
  assert.deepEqual(msgs(r), [
    'town|sea｜last.sea 的時刻看不懂："25:99"（要寫 HH:MM，分鐘 00–59；過了午夜寫 00:12 或 24:12 都行，最晚到 27:59）',
    'town|sea｜last.town 的時刻看不懂："23:60"（要寫 HH:MM，分鐘 00–59；過了午夜寫 00:12 或 24:12 都行，最晚到 27:59）',
    'town|far｜last.far 有看不懂的鍵 "sunday"（只收 weekday／saturday／holiday）',
    'town|far｜last.far.holiday 的時刻看不懂："7:5"（要寫 HH:MM，分鐘 00–59）',
    'town|far｜last 的鍵 "twon" 不是這條連結兩端的區（town、far）',
    'town|hill｜last 要寫成 { "<出發的區 id>": "HH:MM" }："23:00"',
    'sea|far｜last.sea 是空的物件（分日別至少寫一種：weekday／saturday／holiday）',
    'sea|far｜last.far 要寫 "HH:MM" 或 { weekday, saturday, holiday }：2300',
    'far|hill｜last.far 的時刻看不懂："28:00"（要寫 HH:MM，分鐘 00–59；過了午夜寫 00:12 或 24:12 都行，最晚到 27:59）',
  ]);
  assert.equal(r.counts.last, 5);
  // 檢查說看不懂的，引擎就是當沒資料（同一個判法函式）；檢查沒講話的，引擎讀得到
  assert.equal(lastDepartMin(links['town|sea'], 'sea'), null);
  assert.equal(lastDepartMin(links['town|sea'], 'town'), null);
  assert.equal(lastDepartMin(links['far|hill'], 'hill'), 27 * 60 + 59);
  assert.deepEqual(lastProblems(undefined, 'a', 'b'), []);
  assert.deepEqual(lastProblems({ a: '00:12', b: { saturday: '24:12' } }, 'a', 'b'), []);
  assert.deepEqual(msgs(checkShapes({ links: ['town|sea'] })), ['zones.json｜links 要是物件（"<區 a>|<區 b>" → 連結）：["town|sea"]']);
});

test('國家層寫壞：mealSlots 的鍵、兩個時刻、先後；transportProfile.specialSchedule 的 name 與 MM-DD——引擎把寫壞的餐段整段跳過、把寫壞的特殊期間當沒有', () => {
  const country = {
    mealSlots: { lunch: ['11:30', '13:75'], dinner: ['20:30', '18:00'], brunch: ['10:00', '11:00'], breakfast: ['07:00'], },
    transportProfile: { specialSchedule: [{ name: 'お盆', from: '8/13', to: '08-16' }, { from: '12-29', to: '01-03' }, { name: '  ', from: '02-30', to: '13-01' }, 'お正月'] },
  };
  const r = checkShapes({ country });
  assert.deepEqual(msgs(r, 'mealSlots'), [
    '國家層｜mealSlots.lunch 要是兩個時刻 ["HH:MM", "HH:MM"]（00:00–24:00、分鐘 00–59）：["11:30","13:75"]',
    '國家層｜mealSlots.dinner 的結束要晚於開始：["20:30","18:00"]',
    '國家層｜mealSlots 有看不懂的鍵 "brunch"（只收 breakfast／lunch／dinner）',
    '國家層｜mealSlots.breakfast 要是兩個時刻 ["HH:MM", "HH:MM"]（00:00–24:00、分鐘 00–59）：["07:00"]',
  ]);
  assert.deepEqual(msgs(r, 'specialSchedule'), [
    '國家層｜transportProfile.specialSchedule 第 1 筆（お盆）的 from 看不懂："8/13"（要寫 MM-DD，而且是一年裡有的一天）',
    '國家層｜transportProfile.specialSchedule 第 2 筆 沒有 name（這段期間叫什麼）：{"from":"12-29","to":"01-03"}',
    '國家層｜transportProfile.specialSchedule 第 3 筆 沒有 name（這段期間叫什麼）：{"name":"  ","from":"02-30","to":"13-01"}',
    '國家層｜transportProfile.specialSchedule 第 3 筆（沒名字）的 from 看不懂："02-30"（要寫 MM-DD，而且是一年裡有的一天）',
    '國家層｜transportProfile.specialSchedule 第 3 筆（沒名字）的 to 看不懂："13-01"（要寫 MM-DD，而且是一年裡有的一天）',
    '國家層｜transportProfile.specialSchedule 第 4 筆 要是 { name, from, to }："お正月"',
  ]);
  // 引擎真的把 13:75 當成一個時刻（14:15）：所以這種錯只有這裡抓得到
  assert.deepEqual(mealSlotsOf({ mealSlots: { lunch: ['11:30', '13:75'] } }, {}).map((m) => m.core), [[690, 855]]);
  assert.deepEqual(msgs(checkShapes({ country: { mealSlots: [['11:30', '13:30']], transportProfile: { specialSchedule: { name: 'お盆' } } } })), [
    '國家層｜mealSlots 要寫成 { lunch: ["HH:MM", "HH:MM"], … }：[["11:30","13:30"]]',
    '國家層｜transportProfile.specialSchedule 要是陣列（[{ name, from: "MM-DD", to: "MM-DD" }, …]）：{"name":"お盆"}',
  ]);
  assert.deepEqual([clockMin('00:00'), clockMin('24:00'), clockMin('9:05'), clockMin('24:01'), clockMin('13:75'), clockMin('1330'), clockMin(690)], [0, 1440, 545, null, null, null, null]);
  assert.deepEqual([isMonthDay('02-29'), isMonthDay('12-31'), isMonthDay('02-30'), isMonthDay('00-10'), isMonthDay('8-13'), isMonthDay('2026-08-13')], [true, true, false, false, false, false]);
  // 沒有這兩欄的國家層（舊的 jp.json 沒有 specialSchedule）不報
  assert.deepEqual(checkShapes({ country: { mealSlots: { lunch: ['11:30', '13:30'], dinner: ['18:00', '20:30'] }, transportProfile: { nightWalk: { risk: 'low' } } } }).problems, []);
});

test('分級（11-17 審查）：特殊時刻表少 name 只提醒、不擋打包——引擎不讀 name，那一筆的期間照樣生效（「讀的那邊看不懂就當沒寫」不適用）；from／to 看不懂照舊擋', () => {
  const noName = { transportProfile: { specialSchedule: [{ from: '08-13', to: '08-16' }] } };
  const r = checkShapes({ country: noName });
  assert.deepEqual(r.problems.map((p) => [p.level, p.field, p.msg]), [['note', 'specialSchedule', 'transportProfile.specialSchedule 第 1 筆 沒有 name（這段期間叫什麼）：{"from":"08-13","to":"08-16"}']]);
  // 引擎真的照樣認這一段期間：盂蘭盆那幾天取最早的一班（special）
  assert.equal(serviceDayOf('2026-08-14', noName), 'special');
  const text = formatShapes(r).split('\n');
  assert.equal(text.at(-1), '形狀檢查：沒有要改的（另有 1 處提醒，不擋打包）');
  assert.ok(text.some((l) => l.startsWith('　（提醒）［特殊時刻表 specialSchedule］國家層：')), text.join('\n'));
  // 同一筆的 from 也寫壞：那一處照舊擋，少 name 那一處另外算提醒
  const both = checkShapes({ country: { transportProfile: { specialSchedule: [{ from: '8/13', to: '08-16' }] } } });
  assert.deepEqual(both.problems.map((p) => p.level).sort(), ['block', 'note']);
  assert.equal(formatShapes(both).split('\n').at(-1), '形狀檢查：先改這些（1 處；寫壞的值引擎會靜靜當成沒寫）；另有 1 處提醒');
  // 接進 kb-check：提醒進「要注意」、不進「先補這些」
  const viaCheck = checkKb({ data: dataOf(row('甲食堂')), links: GOOD_LINKS, country: { ...GOOD_COUNTRY, ...noName } });
  assert.equal(viaCheck.verdict.ok, true, viaCheck.verdict.blocking.join(' / '));
  assert.ok(viaCheck.verdict.notes.some((n) => n.includes('沒有 name')), viaCheck.verdict.notes.join(' / '));
  assert.equal(formatReport(viaCheck, 'test').split('\n').at(-1), '結論：可以打包');
});

test('三樣都沒查到（資料夾打錯字）：最後一行講沒查到東西，不寫「沒有要改的」', () => {
  const none = checkShapes({});
  assert.equal(formatShapes(none, 'X:/打錯的資料夾').split('\n').at(-1), '形狀檢查：什麼都沒查到（這個資料夾裡沒有 data.json、zones.json 的 links，也找不到國家層檔；資料夾打對了嗎）');
  const run = spawnSync(process.execPath, [path.join(APP, 'tools', 'kb-shape.mjs'), path.join(APP, 'test', 'fixtures', 'kb', 'no-such-city')], { cwd: APP, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout.trim().split(/\r?\n/).at(-1), /^形狀檢查：什麼都沒查到/);
  // 只要查到一樣就照舊
  assert.equal(formatShapes(checkShapes({ data: dataOf(row('甲')) })).split('\n').at(-1), '形狀檢查：沒有要改的');
});

test('samePlace 把三筆以上連成同一處時要兩兩互指（11-17 審查）：引擎只認「一邊直接指到另一邊」，甲、乙都只被丙指到的話甲與乙彼此不算同一處——同一個地方會排兩次', () => {
  const hub = checkShapes({ data: dataOf(row('甲'), row('乙'), row('丙', { samePlace: ['甲', '乙'] })) });
  assert.deepEqual(msgs(hub, 'samePlace'), ['丙｜samePlace 把 丙、甲、乙 連成同一處，但 甲 與 乙 之間沒有互指（引擎只認直接指到的兩筆）：在其中一筆補上另一筆的 id']);
  assert.equal(hub.problems[0].level, 'block');
  // 兩兩都有一邊指到：過
  assert.deepEqual(checkShapes({ data: dataOf(row('甲'), row('乙', { samePlace: '甲' }), row('丙', { samePlace: ['甲', '乙'] })) }).problems, []);
  // 兩筆一組（現在三份知識庫都是這種）不受影響
  assert.deepEqual(checkShapes({ data: dataOf(row('甲'), row('乙', { samePlace: '甲' })) }).problems, []);
});

test('接進 kb-check：形狀看不懂算「先補這些」（擋打包）、報告多一行「欄位形狀」；meals 與 researchRank 原本就各有一行在報、不重複算；沒給 links／country 就寫沒查', () => {
  const clean = [row('甲食堂'), row('乙食堂', { meals: { lunch: true }, closedDates: ['2026-08-14'], samePlace: '甲食堂', closeRisk: 'irregular' })];
  const ok = checkKb({ data: dataOf(...clean), links: GOOD_LINKS, country: GOOD_COUNTRY });
  assert.equal(ok.verdict.ok, true, ok.verdict.blocking.join(' / '));
  const okReport = formatReport(ok, 'test');
  assert.match(okReport, /欄位形狀：closedDates 1、samePlace 1、closeRisk 1 筆有寫；連結的末班 last 2 條；國家層餐段 3 段、特殊時刻表 3 筆；都看得懂/);
  assert.equal(okReport.split('\n').at(-1), '結論：可以打包');
  // 寫壞：末班的時分、公休日的格式、同一處指錯
  const bad = checkKb({
    data: dataOf(row('甲食堂', { closedDates: ['8/14'] }), row('乙食堂', { samePlace: '丙食堂', meals: { diner: true }, researchRank: '備案' })),
    links: { 'town|sea': { rideMin: 30, last: { sea: '25:99' } } },
    country: { mealSlots: { lunch: ['11:30', '13:75'] } },
  });
  assert.equal(bad.verdict.ok, false);
  assert.deepEqual(bad.verdict.blocking.filter((b) => /形狀|meals|研究註記/.test(b)).map((b) => b.replace(/（.*$/, '')), ['研究註記欄位的值看不懂 1 處', '能當哪一餐', '欄位形狀看不懂 4 處'], 'meals 與 researchRank 各算在自己那一條，形狀那一條只算其餘四處');
  assert.match(bad.verdict.blocking.at(-1), /^欄位形狀看不懂 4 處（closedDates、samePlace、last、mealSlots；/);
  const badReport = formatReport(bad, 'test');
  assert.match(badReport, /欄位形狀：.*；看不懂 4：甲食堂［closedDates 有看不懂的日期 "8\/14".*town\|sea［last\.sea 的時刻看不懂："25:99"/);
  assert.match(badReport.split('\n').at(-1), /^結論：先補這些：/);
  // 舊的呼叫法（沒給 links、country）：站的欄位照查，另外兩段寫沒查
  const old = checkKb({ data: dataOf(...clean) });
  assert.equal(old.verdict.ok, true);
  assert.match(formatReport(old), /連結的末班沒查（沒有 zones\.json 的 links）；國家層的餐段與特殊時刻表沒查（找不到國家層檔）/);
});

test('命令列與讀檔：kb-shape 單獨跑（假城市：沒有 zones.json、國家層照 city.json 的 countryId 找）、永遠 exit 0、最後一行是結論；kb-check 的報告有「欄位形狀」那一行', async () => {
  const input = await loadShapeInputs(FAKECITY);
  assert.ok(input.data && Array.isArray(Object.values(input.data.categories)[0].items ?? Object.values(input.data.categories)[0]));
  assert.equal(input.links, null, '假城市沒有 zones.json');
  assert.match(input.countryFile.replace(/\\/g, '/'), /fixtures\/kb\/country\/jp\.json$/, '照 city.json 的 countryId 找 ../country/<id>.json');
  const viaOption = await loadShapeInputs(FAKECITY, { countryFile: path.join(FAKECITY, 'city.json') });
  assert.equal(viaOption.country.id, 'fakecity', '--country 指哪個檔就讀哪個');
  const run = (tool, ...args) => spawnSync(process.execPath, [path.join(APP, 'tools', tool), ...args], { cwd: APP, encoding: 'utf8' });
  const shape = run('kb-shape.mjs', FAKECITY);
  assert.equal(shape.status, 0, shape.stderr);
  assert.match(shape.stdout.trim().split(/\r?\n/).at(-1), /^形狀檢查：沒有要改的$/);
  assert.match(shape.stdout, /連結 沒查（沒有 zones\.json 的 links）/);
  const usage = run('kb-shape.mjs');
  assert.equal(usage.status, 2);
  assert.match(usage.stderr, /用法：node tools\/kb-shape\.mjs/);
  const check = run('kb-check.mjs', FAKECITY);
  assert.equal(check.status, 0, check.stderr);
  assert.match(check.stdout, /欄位形狀：closedDates 0、samePlace 0、closeRisk 0 筆有寫；連結的末班沒查/);
});
