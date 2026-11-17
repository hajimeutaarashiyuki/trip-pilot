// 升級成站＝安插、釘住順序（engine/insert.js；11-06 第二批，原話 #192「順路站 升級成站時 不應該把原本的行程刪掉 應該是安插進來」、
// #194「當然安插進來後 會壓縮到後面的行程 那就再跳一組選項問我 要壓縮哪個行程或是砍掉」）：
// 安插試算（排得下／排不下＋選項、可以多輪）、套進旅程檔（applyInsert）、解除（unpinDay）、釘住的日子怎麼排（planTrip 遇到 days[].pinned）、
// 釘住之後的不去了／換一家／二選一／順延進來／早餐的三個鍵。小世界：town 一區、所有站同座標、站間走 5 分。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planTrip } from '../../src/engine/trip.js';
import { insertTrial, applyInsert, unpinDay, pinnedOf, pinEntriesOf, pinnedEngineIds, repinFromPlan, repinTrip, planPinnedDay, insertDwellMin, dwellFloorMin, isLockedStop, slotOpenOf, corridorPickIds, insertDroppedEngine, INSERT_MAX_ROUNDS, INSERT_POLICY, CORRIDOR_PICK, INSERT_DROP, PINNED_ORDER_HINT } from '../../src/engine/insert.js';
import { rawWindowDay, evaluateSequence } from '../../src/engine/sequence.js';
import { applySwap, swapCandidates } from '../../src/engine/swap.js';
import { defer, pinnedSwapCheck, pinnedChoiceCheck, choicesFor, chooseDay } from '../../src/engine/choices.js';
import { placeStop } from '../../src/engine/schedule.js';
import { setBreakfast, clearBreakfast, takeBreakfastOffer, swapBreakfast, breakfastSwapCandidates, breakfastOfPlan, isPlacedBreakfast, tryBreakfastAt, breakfastStop } from '../../src/engine/breakfast.js';
import { chooseOptionTrip, swapPick } from '../../src/ui/choices.js';
import { loadRules } from '../../src/rules/index.js';
import { BUILTIN } from '../../src/rules/builtin.js';
import rulesJson from '../../src/rules.json' with { type: 'json' };

const rules = loadRules(BUILTIN, rulesJson.rules);
const settings = rulesJson.settings;
// 夏季月份留空：這些小世界不測「夏天中午會曬」，免得順延幾分鐘就多一條不相干的罰
const COUNTRY = { mealSlots: { lunch: ['11:30', '13:30'], dinner: ['18:00', '20:30'] }, nightSlot: ['20:00', '24:00'], climate: { summerMonths: [] }, utcOffsetMin: 540 };
const JP = { ...COUNTRY, mealSlots: { breakfast: ['07:00', '10:00'], ...COUNTRY.mealSlots } };
const kb = { zones: { town: { environment: 'town', lat: 38.26, lng: 140.87 } } };
const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const daily = (open, close) => Object.fromEntries(DAYS.map((k) => [k, [[open, close]]]));
const mk = (id, over = {}) => ({ id, name_zh: id, category: 'street', walkFactor: 1, recovery: false, cafeLike: false, climbMin: 0, zoneId: 'town', hours: daily('09:00', '23:00'), dwellMin: 60, daylightOnly: false, lat: 38.26, lng: 140.87, my: {}, ...over });
const shop = (id, over = {}) => mk(id, { category: 'store', walkFactor: 0, dwellMin: 30, ...over });
const cafe = (id, over = {}) => mk(id, { category: 'cafe', walkFactor: 0, recovery: true, cafeLike: true, meals: {}, ...over });
const food = (id, over = {}) => mk(id, { category: 'food', walkFactor: 0, recovery: true, dwellMin: 30, meals: {}, ...over });
/** 能當早餐的店：每天 07:00–22:00、停 20 分 */
const eat = (id, over = {}) => mk(id, { category: 'food', walkFactor: 0, recovery: true, dwellMin: 20, hours: daily('07:00', '22:00'), meals: { breakfast: `${id}的早餐`, lunch: true }, ...over });
const home = { id: 'home', name_zh: '飯店', zoneId: 'town', lat: 38.26, lng: 140.87 };
const legFn = () => ({ walkMin: 5, rideMin: 0, climbMin: 0, mode: 'walk' });
const THU = '2026-08-13'; const FRI = '2026-08-14'; const SAT = '2026-08-15'; const SUN = '2026-08-16';
const AT = '2026-11-12T00:00:00.000Z';
const hm = (h, m = 0) => h * 60 + m;
const ids = (x) => (x.sequence ?? x).map((s) => s.poi.id);
const times = (x) => (x.sequence ?? x).map((s) => `${s.poi.id}@${s.startMin}-${s.endMin}`);
const tripOf = (days) => ({ id: 't', party: 1, homeBases: [{ poi: home }], days: days.map((d) => ({ type: 'normal', ...d })) });
const want = (...list) => list.map((id) => ({ poiId: id, priority: 'want' }));
const pinOf = (...list) => ({ at: AT, sequence: list.map((x) => (typeof x === 'string' ? { poiId: x } : x)) });
const poisOf = (world) => Object.fromEntries(world.map((p) => [p.id, p]));
const run = (trip, world, { pool = [], country = COUNTRY, options = {} } = {}) => planTrip({ trip, pois: poisOf(world), rules, settings, country, kb, legFn, restPool: pool, options });
const trialArgs = (d, extra = {}, country = COUNTRY) => ({ plan: d.plan, day: d.day, home, legFn, rules, settings, country, kb, ...extra });
const dayOf = (trip, date) => trip.days.find((d) => d.date === date);
const withoutPick = (trip, date, poiId, removedEntry) => ({ ...trip, days: trip.days.map((d) => (d.date === date ? { ...d, picks: d.picks.filter((p) => p.poiId !== poiId), removed: [...(d.removed ?? []), removedEntry ?? { poiId, at: AT, priority: 'want' }] } : d)) });

// 世界一：街區、午餐、街區、晚餐、夜間酒吧（22:30 剛好收工；時窗 09:00–24:00、留白 90 分）
const A = mk('街區A'); const B = mk('街區B'); const C = mk('街區C');
const lunch = mk('午餐店', { category: 'food', walkFactor: 0, recovery: true, hours: daily('11:30', '14:30'), meals: { lunch: true } });
const dinner = mk('晚餐店', { category: 'food', walkFactor: 0, recovery: true, hours: daily('17:30', '22:00'), meals: { dinner: true } });
const bar = mk('酒吧', { category: 'bar', walkFactor: 0, recovery: true, hours: daily('20:00', '24:00'), dwellMin: 150, meals: {} });
const small = shop('小店', { dwellMin: 20 }); const mid = shop('中店', { dwellMin: 120 }); const big = shop('大店', { dwellMin: 240 });
const noDwell = shop('沒寫停留', { dwellMin: undefined });
const W1 = [A, B, C, lunch, dinner, bar, small, mid, big, noDwell];
const ORDER1 = [A.id, C.id, lunch.id, dinner.id, B.id, bar.id];
/** 世界一的那一天（順序用 pinned 釘死，不靠搜尋）：A 09:05 → C 10:10 → 午餐 11:30 → 晚餐 17:30 → B 18:35 → 酒吧 20:00–22:30 */
const trip1 = () => tripOf([{ date: THU, picks: want(...ORDER1), pinned: pinOf(...ORDER1) }]);
const day1 = () => run(trip1(), W1).days[0];

test('小工具：新的一站停留＝店自己的、沒有用預設、至少 30 分（原話 #52）；少待的下限＝原停留一半且不少於 30；鎖住的站；rawWindowDay 把收工線換成原時窗；最多問三輪', () => {
  assert.equal(settings.insertMinDwellMin, 30);
  assert.equal(insertDwellMin(small, settings), 30, '店寫 20 分 → 至少 30');
  assert.equal(insertDwellMin(mid, settings), 120);
  assert.equal(insertDwellMin(noDwell, settings), settings.defaultDwellMin);
  assert.equal(insertDwellMin(small, { insertMinDwellMin: 45 }), 45);
  assert.equal(insertDwellMin({ id: 'x' }, {}), 60, '設定也沒有就 60');
  assert.deepEqual([240, 150, 61, 60, 40, 30].map((n) => dwellFloorMin(n, settings)), [120, 75, 31, 30, 30, 30]);
  assert.deepEqual([{ priority: 'must' }, { designated: true }, { isAnchor: true }, { fixedWindow: { startMin: 600 } }, { priority: 'want' }, null].map(isLockedStop), [true, true, true, true, false, false]);
  const day = { date: THU, window: { startMin: 540, endMin: 1350 }, windowRaw: { startMin: 540, endMin: 1440 }, openSlotMin: 90 };
  assert.deepEqual(rawWindowDay(day).window, { startMin: 540, endMin: 1440 });
  assert.equal(day.window.endMin, 1350, '不改傳入的');
  const same = { window: { startMin: 540, endMin: 750 }, windowRaw: { startMin: 540, endMin: 750 } };
  assert.equal(rawWindowDay(same), same, '沒留白就回原物件');
  assert.equal(rawWindowDay({ window: { startMin: 0, endMin: 10 } }).window.endMin, 10);
  assert.equal(INSERT_MAX_ROUNDS, 3);
  assert.equal(INSERT_POLICY.giveWay, 'fill');
});

test('排得下：插在那一段、原本的每一站都在、先後不變、只是往後順延；先用掉等開門的空檔、再用留白；回插在誰跟誰之間、最多順延幾分、用掉幾分留白、多了哪些黃字', () => {
  const d = day1();
  assert.deepEqual(times(d.plan), ['街區A@545-605', '街區C@610-670', '午餐店@690-750', '晚餐店@1050-1110', '街區B@1115-1175', '酒吧@1200-1350']);
  assert.equal(d.day.window.endMin, hm(22, 30)); assert.equal(d.day.windowRaw.endMin, hm(24)); assert.equal(d.day.openSlotMin, 90);
  // 在酒吧前（第 5 段）插小店：店寫 20 分 → 停 30 分；酒吧本來等開門 20 分先用掉，只晚 15 分；22:45 收工＝用掉 15 分留白
  const t = insertTrial(trialArgs(d, { poi: small, legIndex: 5 }));
  assert.equal(t.fits, true);
  assert.deepEqual([t.poiId, t.legIndex, t.index, t.round, t.dwellMin], [small.id, 5, 5, 1, 30]);
  assert.deepEqual(ids(t), [A.id, C.id, lunch.id, dinner.id, B.id, small.id, bar.id]);
  assert.deepEqual(ids(t).filter((id) => id !== small.id), ORDER1, '原本的站一站不少、先後不變');
  assert.deepEqual(times(t).slice(-2), ['小店@1180-1210', '酒吧@1215-1365']);
  assert.deepEqual([t.between.prev, t.between.next], [B, bar]);
  assert.equal(t.shiftMaxMin, 15);
  assert.deepEqual([t.openSlotUsedBeforeMin, t.openSlotUsedMin], [0, 15]);
  assert.deepEqual([t.adjust, t.options, t.blocked, t.conflicts, t.shrunk, t.revived], [[], [], null, [], [], []]);
  const s = t.sequence[t.index];
  assert.deepEqual([s.priority, s.insertedBy, s.optional, s.isAnchor, s.designated, s.fixedWindow, s.gap], ['want', null, false, false, false, null, null], '新的一站是他勾的');
  assert.equal(typeof t.score, 'number'); assert.equal(t.complete, true);
  assert.ok(t.newWarnings.every((w) => w.msg && w.code !== 'hard'));
  // 第 0 段＝住宿→第一站：prev 是 null（住宿）；早上的站各晚 35 分，傍晚等晚餐開門的空檔把它吸收掉，晚餐以後一分不晚、也沒用到留白
  const first = insertTrial(trialArgs(d, { poi: small, legIndex: 0 }));
  assert.equal(first.fits, true);
  assert.deepEqual([first.index, first.between.prev, first.between.next], [0, null, A]);
  assert.deepEqual(times(first), ['小店@545-575', '街區A@580-640', '街區C@645-705', '午餐店@710-770', '晚餐店@1050-1110', '街區B@1115-1175', '酒吧@1200-1350']);
  assert.deepEqual([first.shiftMaxMin, first.openSlotUsedMin], [35, 0]);
  // 沒寫停留的店用預設 60 分；legIndex 超過站數就接在最後（next 是 null）；不是整數當 0
  assert.equal(insertTrial(trialArgs(d, { poi: noDwell, legIndex: 0 })).dwellMin, 60);
  const lastOne = insertTrial(trialArgs(d, { poi: small, legIndex: 99 }));
  assert.deepEqual([lastOne.index, lastOne.legIndex, lastOne.between.next], [6, 6, null]);
  assert.equal(insertTrial(trialArgs(d, { poi: small, legIndex: '2' })).index, 0);
  // 輸入不成立回 null：那家已經在這天的行程裡、沒有 plan、沒有店
  assert.equal(insertTrial(trialArgs(d, { poi: bar, legIndex: 0 })), null);
  assert.equal(insertTrial({ ...trialArgs(d, { poi: small }), plan: null }), null);
  assert.equal(insertTrial(trialArgs(d, { poi: null })), null);
  // 不改傳入的 plan
  assert.deepEqual(times(d.plan), ['街區A@545-605', '街區C@610-670', '午餐店@690-750', '晚餐店@1050-1110', '街區B@1115-1175', '酒吧@1200-1350']);
});

test('排不下：回哪一站因為什麼排不下（硬規則那句），加一組選項——插的這家少待、後面的站少待（最少要減幾分、5 分一階）、後面的站不去；排得下的在前；每個選項帶套了之後的結果', () => {
  const d = day1();
  // 酒吧前插中店（120 分）：酒吧 21:45 才到、要待到 24:15，超過它自己的關門也超過原時窗
  const t = insertTrial(trialArgs(d, { poi: mid, legIndex: 5 }));
  assert.equal(t.fits, false);
  assert.deepEqual([t.blocked.poiId, t.blocked.name, t.blocked.ruleId, t.blocked.shortMin], [bar.id, '酒吧', 'hours', 15]);
  assert.match(t.blocked.msg, /^酒吧 待到 24:15，超過 24:00 關門$/);   // 21:45 到的時候有開、待不完才關門：句子照實寫（rules/hours.js，11-12）
  assert.deepEqual(t.conflicts.map((c) => [c.poiId, c.ruleId]), [[bar.id, 'hours'], [bar.id, 'window']], '同一站撞兩條都列');
  assert.match(t.conflicts[1].msg, /超過今天收工時間 24:00/, '收工線是原時窗，不是扣過留白的 22:30');
  assert.deepEqual(t.options.map((o) => [o.kind, o.poiId, o.fromMin, o.toMin, o.fits, o.shortMin]), [
    ['shorten-new', mid.id, 120, 105, true, 0],
    ['shorten', bar.id, 150, 135, true, 0],
    ['drop', bar.id, 150, 0, true, 0],
  ]);
  assert.equal(t.options[0].poi, mid); assert.equal(t.options[1].poi, bar, '選項帶對象的 POI（畫面拿它寫店名與簡介，原話 #193）');
  // 最少要減幾分：120→105 才排得下（110 還差 5 分），不會一口氣減到下限 60
  const r0 = t.options[0].result;
  assert.deepEqual([r0.fits, r0.dwellMin, r0.round, r0.options.length], [true, 105, 2, 0]);
  assert.deepEqual(r0.adjust, [{ kind: 'shorten', poiId: mid.id, fromMin: 120, toMin: 105 }]);
  assert.deepEqual(times(r0).slice(-2), ['中店@1180-1285', '酒吧@1290-1440']);
  assert.deepEqual([r0.shiftMaxMin, r0.openSlotUsedMin], [90, 90], '留白 90 分整個用掉');
  // 不去酒吧：序列裡沒有它，其餘一站不少
  const r2 = t.options[2].result;
  assert.deepEqual(ids(r2), [A.id, C.id, lunch.id, dinner.id, B.id, mid.id]);
  assert.deepEqual(r2.adjust, [{ kind: 'drop', poiId: bar.id, insertedBy: null, priority: 'want' }]);
  // 午餐前插大店（240 分）：午餐 15:20 才到、已經關門 → 插的這家少待 240→130（最少減的那一階）或不去午餐；午餐自己少待也沒用但有比較接近，列在排不下的那一段
  const noon = insertTrial(trialArgs(d, { poi: big, legIndex: 2 }));
  assert.deepEqual([noon.fits, noon.blocked.poiId, noon.blocked.shortMin], [false, lunch.id, 110]);
  assert.deepEqual(noon.options.map((o) => [o.kind, o.poiId, o.toMin, o.fits, o.shortMin]), [
    ['shorten-new', big.id, 130, true, 0],
    ['drop', lunch.id, 0, true, 0],
    ['shorten', lunch.id, 30, false, 80],
  ]);
  assert.ok(!noon.options.some((o) => [dinner.id, B.id, bar.id].includes(o.poiId)), '排在卡住那一站後面的站，少待或不去都沒有比較接近，不列');
});

test('單一選項解不掉：照還差幾分由少到多列；選了一個拿它當草稿再問一輪（round 2），調整累積；排得下的草稿再丟進來就是 fits', () => {
  const d = day1();
  // 酒吧前插大店（240 分）：它自己 23:40 才結束（23:00 關）、酒吧也排不下
  const t = insertTrial(trialArgs(d, { poi: big, legIndex: 5 }));
  assert.equal(t.fits, false);
  assert.deepEqual([t.blocked.poiId, t.blocked.shortMin], [big.id, 135]);
  assert.deepEqual(t.options.map((o) => [o.kind, o.poiId, o.fromMin, o.toMin, o.fits, o.shortMin]), [
    ['shorten-new', big.id, 240, 120, false, 15],   // 減到下限（一半）還差 15 分
    ['drop', bar.id, 150, 0, false, 40],
    ['shorten', bar.id, 150, 75, false, 60],
  ]);
  assert.ok(t.options.every((o) => !o.fits && o.result.blocked && o.result.options.length === 0));
  // 第二輪：拿「插的這家少待到 120」當草稿 → 酒吧少待 150→135 或不去酒吧就排得下；大店已經到下限，不再列
  const second = insertTrial(trialArgs(d, { poi: big, legIndex: 5, draft: t.options[0] }));
  assert.deepEqual([second.fits, second.round, second.dwellMin], [false, 2, 120]);
  assert.deepEqual(second.adjust, [{ kind: 'shorten', poiId: big.id, fromMin: 240, toMin: 120 }]);
  assert.deepEqual(second.options.map((o) => [o.kind, o.poiId, o.fromMin, o.toMin, o.fits]), [['shorten', bar.id, 150, 135, true], ['drop', bar.id, 150, 0, true]]);
  const done = second.options[0].result;
  assert.deepEqual([done.fits, done.round], [true, 3]);
  assert.deepEqual(done.adjust.map((a) => [a.kind, a.poiId, a.toMin]), [['shorten', big.id, 120], ['shorten', bar.id, 135]]);
  assert.deepEqual(times(done).slice(-2), ['大店@1180-1300', '酒吧@1305-1440']);
  // 草稿給選項物件或它的 result 都行；排得下的草稿丟進來＝fits、沒有選項
  const again = insertTrial(trialArgs(d, { poi: big, legIndex: 5, draft: done }));
  assert.deepEqual([again.fits, again.options.length, times(again).join()], [true, 0, times(done).join()]);
  assert.deepEqual(insertTrial(trialArgs(d, { poi: big, legIndex: 5, draft: t.options[0].result })).options.map((o) => o.kind), ['shorten', 'drop']);
  // 草稿裡看不懂的調整丟掉（不認得的站、不能不去插的那一家）
  const junk = insertTrial(trialArgs(d, { poi: big, legIndex: 5, draft: { adjust: [{ kind: 'drop', poiId: big.id }, { kind: 'drop', poiId: '沒這站' }, { kind: 'shorten', poiId: bar.id, toMin: -5 }, null] } }));
  assert.deepEqual(junk.adjust, []);
});

test('選項的範圍：固定時段的站不列少待；必去、指定、主行程、固定時段的站不列不去；沒有任何選項有幫助就回空的 options（只剩算了不插）', () => {
  // 順序釘死：早店 → 指定店 → 必去店 → 花火（固定 19:00、提前 30 分到）→ 夜店
  const early = shop('早店', { dwellMin: 60 }); const D = shop('指定店', { dwellMin: 60 }); const M = shop('必去店', { dwellMin: 60 }); const late = shop('夜店', { dwellMin: 60 });
  const fire = mk('花火', { category: 'event', walkFactor: 0 });
  const huge = shop('超大店', { dwellMin: 420 });
  const order = [early.id, D.id, M.id, fire.id, late.id];
  const trip = tripOf([{ date: THU, anchor: { poiId: fire.id }, designated: [D.id], pinned: pinOf(...order), picks: [
    { poiId: early.id, priority: 'want' }, { poiId: D.id, priority: 'want' }, { poiId: M.id, priority: 'must' },
    { poiId: fire.id, priority: 'want', fixedWindow: { startMin: hm(19), arriveEarlyMin: 30 } }, { poiId: late.id, priority: 'want' },
  ] }]);
  const world = [early, D, M, fire, late, huge, small];
  const d = run(trip, world).days[0];
  assert.deepEqual(times(d.plan), ['早店@545-605', '指定店@610-670', '必去店@675-735', '花火@1110-1170', '夜店@1175-1235']);
  // 指定店前插 420 分的店：指定店 17:15、必去店 18:20、花火 19:25 才到（要 18:30 前到）
  const t = insertTrial(trialArgs(d, { poi: huge, legIndex: 1 }));
  assert.equal(t.fits, false);
  assert.deepEqual([t.blocked.poiId, t.blocked.ruleId, t.blocked.shortMin], [fire.id, 'fixed-window', 55]);
  assert.match(t.blocked.msg, /花火 要在 18:30 前到，現在排到 19:25/);
  assert.deepEqual(t.options.map((o) => [o.kind, o.poiId, o.fromMin, o.toMin, o.fits, o.shortMin]), [
    ['shorten-new', huge.id, 420, 365, true, 0],
    ['shorten', D.id, 60, 30, false, 25],
    ['shorten', M.id, 60, 30, false, 25],
  ]);
  assert.ok(!t.options.some((o) => o.kind === 'drop'), '指定、必去、主行程（固定時段）都不列不去；夜店在花火後面，不去也沒用');
  assert.ok(!t.options.some((o) => o.poiId === fire.id), '固定時段的站不列少待');
  // 固定時段的站少待「看起來有幫助」的時候也不列：開演 12:00、看 120 分，後面接 14:40 關的店；前面插 130 分 → 開演趕不上、後面那家也超過關門。
  // 把開演那一站縮短可以讓後面那家不超過關門（卡住的少一站），但它是固定時段，不列
  const show = mk('開演', { category: 'event', walkFactor: 0, dwellMin: 120 });
  const closesEarly = shop('早關店', { dwellMin: 30, hours: daily('09:00', '14:40') });
  const longer = shop('逛很久的店', { dwellMin: 130 });
  const order2 = [early.id, show.id, closesEarly.id];
  const trip2 = tripOf([{ date: THU, pinned: pinOf(...order2), picks: [{ poiId: early.id, priority: 'want' }, { poiId: show.id, priority: 'want', fixedWindow: { startMin: hm(12), arriveEarlyMin: 0 } }, { poiId: closesEarly.id, priority: 'want' }] }]);
  const d2 = run(trip2, [early, show, closesEarly, longer]).days[0];
  assert.deepEqual(times(d2.plan), ['早店@545-605', '開演@720-840', '早關店@845-875']);
  const t2 = insertTrial(trialArgs(d2, { poi: longer, legIndex: 1 }));
  assert.deepEqual(t2.conflicts.map((c) => [c.poiId, c.ruleId]), [[show.id, 'fixed-window'], [closesEarly.id, 'hours']]);
  assert.ok(!t2.options.some((o) => o.poiId === show.id), '開演那一站不列少待也不列不去');
  assert.deepEqual(t2.options.filter((o) => o.fits).map((o) => [o.kind, o.poiId, o.toMin]), [['shorten-new', longer.id, 105]]);
  // 插不進：關門前剩不到 30 分的店（至少待 30 分），少待已經到下限、後面沒有站可以動 → options 空的
  const closing = shop('快關的店', { dwellMin: 30, hours: daily('09:00', '20:50') });
  const tail = insertTrial(trialArgs(d, { poi: closing, legIndex: 99 }));
  assert.deepEqual([tail.fits, tail.blocked.poiId, tail.blocked.shortMin, tail.options.length], [false, closing.id, 20, 0]);
});

test('卡住的原因不是差幾分鐘（同類的店超過上限、一天站數滿了）：shortMin 是 null、少待都沒用不列，不去連前面的站也試——少去同類的另一家就排得下', () => {
  const ca = cafe('咖啡甲'); const cb = cafe('咖啡乙'); const cc = cafe('咖啡丙');
  const order = [lunch.id, ca.id, A.id, cb.id, dinner.id];
  const d = run(tripOf([{ date: THU, picks: want(...order), pinned: pinOf(...order) }]), [lunch, ca, A, cb, dinner, cc]).days[0];
  const t = insertTrial(trialArgs(d, { poi: cc, legIndex: 4 }));   // 咖啡乙之後、晚餐之前：第三家咖啡廳是它自己
  assert.deepEqual([t.fits, t.blocked.poiId, t.blocked.ruleId, t.blocked.shortMin], [false, cc.id, 'same-type-day', null]);
  assert.match(t.blocked.msg, /今天咖啡廳已經 2 家/);
  assert.deepEqual(t.options.map((o) => [o.kind, o.poiId, o.fits]), [['drop', ca.id, true], ['drop', cb.id, true]], '前面的兩家咖啡廳都可以讓');
  assert.deepEqual(ids(t.options[0].result), [lunch.id, A.id, cb.id, cc.id, dinner.id]);
  // 插在最前面：第三家變成咖啡乙（序列裡排最後的那家），選項一樣是少去一家
  const front = insertTrial(trialArgs(d, { poi: cc, legIndex: 0 }));
  assert.deepEqual([front.blocked.poiId, front.blocked.shortMin], [cb.id, null]);
  assert.deepEqual(front.options.map((o) => [o.kind, o.poiId, o.fits]), [['drop', ca.id, true], ['drop', cb.id, true]]);
  // 一天 8 站滿了：第 9 站撞站數上限，少去哪一站都排得下
  const eight = Array.from({ length: 4 }, (_, i) => [shop(`店${i + 1}`), food(`食${i + 1}`)]).flat();
  const d8 = run(tripOf([{ date: THU, picks: want(...eight.map((p) => p.id)), pinned: pinOf(...eight.map((p) => p.id)) }]), [...eight, small]).days[0];
  assert.equal(d8.plan.sequence.length, 8);
  const ninth = insertTrial(trialArgs(d8, { poi: small, legIndex: 3 }));
  assert.deepEqual([ninth.fits, ninth.blocked.ruleId, ninth.blocked.shortMin], [false, 'max-stops', null]);
  assert.match(ninth.blocked.msg, /今天已經 8 站，上限 8/);
  assert.equal(ninth.options.length, 8);
  assert.ok(ninth.options.every((o) => o.kind === 'drop' && o.fits && o.result.sequence.length === 8));
});

test('趕不上末班車的站變多也算排不下（他勾的站不受末班車規則擋，所以另外數）：卡住的那句是末班車的句子、還差幾分照末班算', () => {
  const sea = shop('海邊店', { zoneId: 'sea', dwellMin: 60, hours: daily('09:00', '23:00') });
  const order = [A.id, sea.id];
  const d = run(tripOf([{ date: THU, picks: want(...order), pinned: pinOf(...order) }]), [A, sea, small, mid]).days[0];
  // 手上給這天一張外地的表：海邊回住宿最晚 11:30 要離開（末班 11:40 發車）
  const day = { ...d.day, away: { sea: { homeMin: 30, last: { leaveByMin: hm(11, 30), departMin: hm(11, 40), fromZoneId: 'sea' } } } };
  assert.deepEqual(times(d.plan), ['街區A@545-605', '海邊店@610-670']);
  const ok = insertTrial({ ...trialArgs(d, { poi: small, legIndex: 2 }), day });
  assert.equal(ok.fits, true, '接在最後、不動海邊店：照樣排得下');
  const t = insertTrial({ ...trialArgs(d, { poi: mid, legIndex: 1 }), day });   // 海邊店前插 120 分：海邊店待到 13:15
  assert.deepEqual([t.fits, t.blocked.poiId, t.blocked.ruleId, t.blocked.shortMin], [false, sea.id, 'last-train', 105]);
  assert.match(t.blocked.msg, /海邊店 待到 13:15，回住宿趕不上 11:40 的末班車/);
  assert.deepEqual(t.options.map((o) => [o.kind, o.poiId, o.fits]).slice(0, 2), [['drop', sea.id, true], ['shorten-new', mid.id, false]]);
});

test('引擎填的站讓位：填站是拿來填等開門的空檔的，前面多插一站就短一點（最短 15 分、不拿掉），它在等的那一站不晚；不讓位的話那一站要往後挪；縮短的列在 shrunk', () => {
  const fill = shop('填空店', { dwellMin: 60 });
  const lateDinner = { ...dinner, hours: daily('16:30', '22:00') };
  const world = [A, lunch, lateDinner, fill, small, mid];
  const trip = tripOf([{ date: THU, picks: want(A.id, lunch.id, lateDinner.id) }]);
  const d = run(trip, world, { pool: [fill] }).days[0];
  assert.deepEqual(times(d.plan), ['街區A@545-605', '填空店@610-670', '午餐店@690-750', '晚餐店@990-1050']);
  const f = d.plan.sequence[1];
  assert.deepEqual([f.insertedBy, f.priority, f.optional, f.gap], ['engine', 'filler', true, { startMin: 540, endMin: 690 }]);
  // 填空店前插小店（30 分）：填空店 60→40，午餐照舊 11:30
  const t = insertTrial(trialArgs(d, { poi: small, legIndex: 1 }));
  assert.equal(t.fits, true);
  assert.deepEqual(times(t), ['街區A@545-605', '小店@610-640', '填空店@645-685', '午餐店@690-750', '晚餐店@990-1050']);
  assert.deepEqual(t.shrunk, [{ poiId: fill.id, fromMin: 60, toMin: 40 }]);
  assert.equal(t.sequence[2].gap, null, '釘住之後填站不再綁在那段空檔上');
  assert.deepEqual([t.sequence[2].insertedBy, t.sequence[2].priority], ['engine', 'filler'], '還是引擎插的那一站');
  // 插在填空店後面也一樣：夾在填空店跟它在等的午餐之間
  assert.deepEqual(times(insertTrial(trialArgs(d, { poi: small, legIndex: 2 }))), ['街區A@545-605', '填空店@610-650', '小店@655-685', '午餐店@690-750', '晚餐店@990-1050']);
  // 插 120 分的店：填空店縮到最短 15 分，午餐只好往後
  const m = insertTrial(trialArgs(d, { poi: mid, legIndex: 1 }));
  assert.deepEqual([m.fits, m.shrunk], [true, [{ poiId: fill.id, fromMin: 60, toMin: 15 }]]);
  assert.deepEqual(times(m).slice(1, 4), ['中店@610-730', '填空店@735-750', '午餐店@755-815']);
  // 不讓位（比過沒採用）：午餐晚 20 分
  const none = insertTrial(trialArgs(d, { poi: small, legIndex: 1, giveWay: 'none' }));
  assert.deepEqual([none.fits, none.shrunk, times(none).slice(2, 4)], [true, [], ['填空店@645-705', '午餐店@710-770']]);
  // 套進旅程檔：pinned 記著引擎插的那一站（哪一種、縮短後的停留）；重排出來就是試算的那一條；別天引擎不再插同一家
  const two = tripOf([{ date: THU, picks: want(A.id, lunch.id, lateDinner.id) }, { date: FRI, picks: want(A.id, lunch.id, lateDinner.id) }]);
  const base = run(two, world, { pool: [fill] });
  assert.ok(ids(base.days[0].plan).includes(fill.id) && !ids(base.days[1].plan).includes(fill.id), '同一家店只插一天');
  const pinnedSecond = applyInsert(two, FRI, insertTrial(trialArgs(base.days[1], { poi: small, legIndex: 1 })), AT);
  const fakeFill = { ...pinnedSecond, days: pinnedSecond.days.map((x) => (x.date === FRI ? { ...x, pinned: pinOf(A.id, small.id, { poiId: fill.id, dwellMin: 40, insertedBy: 'engine', priority: 'filler' }, lunch.id, lateDinner.id) } : x)) };
  assert.deepEqual([...pinnedEngineIds(fakeFill)], [fill.id]);
  const r = run(fakeFill, world, { pool: [fill] });
  assert.ok(!ids(r.days[0].plan).includes(fill.id), '8/14 釘住的順序裡記著填空店：8/13 的引擎不再插它');
  assert.deepEqual(times(r.days[1].plan), ['街區A@545-605', '小店@610-640', '填空店@645-685', '午餐店@690-750', '晚餐店@990-1050']);
  const applied = applyInsert(trip, THU, t, AT);
  assert.deepEqual(dayOf(applied, THU).pinned.sequence, [
    { poiId: A.id, dwellMin: 60 }, { poiId: small.id, dwellMin: 30 }, { poiId: fill.id, dwellMin: 40, insertedBy: 'engine', priority: 'filler' }, { poiId: lunch.id, dwellMin: 60 }, { poiId: lateDinner.id, dwellMin: 60 },
  ]);
  const after = run(applied, world, { pool: [fill] }).days[0];
  assert.deepEqual(times(after.plan), times(t));
  assert.equal(after.plan.score, t.score);
});

test('applyInsert：picks 加那家、那天釘住順序（每站記停留，少待調過的也在）、選了不去的照「不去了」記；排不下的結果不套；unpinDay 解除；pinnedOf 讀壞掉的欄位', () => {
  const d = day1();
  const trip = trip1();
  const t = insertTrial(trialArgs(d, { poi: small, legIndex: 5 }));
  const next = applyInsert(trip, THU, t, AT);
  assert.notEqual(next, trip);
  const day = dayOf(next, THU);
  // 那筆勾選帶 via 'corridor'（走廊清單升級來的）：別天挑引擎插站時，這家改成「挑好名單才拿掉」（engine/trip.js lateIds；11-12 審查）
  assert.deepEqual(day.picks, [...want(...ORDER1), { poiId: small.id, priority: 'want', via: 'corridor', dwellMin: 30 }], '店自己寫 20 分：勾選上記「至少 30 分」，解除釘住之後也不會縮回去');
  assert.deepEqual(t.pick, { poiId: small.id, priority: 'want', via: 'corridor', dwellMin: 30 });
  assert.deepEqual(insertTrial(trialArgs(d, { poi: mid, legIndex: 0 })).pick, { poiId: mid.id, priority: 'want', via: 'corridor' }, '店自己的停留夠長就不另外記');
  assert.deepEqual(insertTrial(trialArgs(d, { poi: noDwell, legIndex: 0 })).pick, { poiId: noDwell.id, priority: 'want', via: 'corridor' });
  assert.deepEqual([CORRIDOR_PICK, INSERT_DROP], ['corridor', 'insert']);
  assert.deepEqual([...corridorPickIds(next)], [small.id]);
  assert.deepEqual([...corridorPickIds(trip)], [], '沒升級過就是空的');
  assert.deepEqual(day.pinned, { at: AT, sequence: [A.id, C.id, lunch.id, dinner.id, B.id].map((id) => ({ poiId: id, dwellMin: 60 })).concat([{ poiId: small.id, dwellMin: 30 }, { poiId: bar.id, dwellMin: 150 }]) });
  assert.deepEqual(day.removed, []);
  assert.deepEqual(dayOf(trip, THU).picks, want(...ORDER1), '不改傳入的');
  assert.equal(typeof dayOf(applyInsert(trip, THU, t), THU).pinned.at, 'string', '沒給時刻就用現在');
  // 之前對它按過「不去了」的那筆拿掉；已經在 picks 就不重複加
  const again = applyInsert({ ...trip, days: trip.days.map((x) => ({ ...x, picks: [...x.picks, { poiId: small.id, priority: 'maybe' }], removed: [{ poiId: small.id, at: 'x' }, { poiId: '別家', at: 'x' }] })) }, THU, t, AT);
  assert.deepEqual(dayOf(again, THU).picks.filter((p) => p.poiId === small.id), [{ poiId: small.id, priority: 'maybe' }]);
  assert.deepEqual(dayOf(again, THU).removed, [{ poiId: '別家', at: 'x' }]);
  // 選項：少待的停留記在 pinned；不去的那站從 picks 拿掉、removed 記一筆（他勾的記 priority；引擎插的另記 insertedBy）
  const blocked = insertTrial(trialArgs(d, { poi: mid, legIndex: 5 }));
  assert.equal(applyInsert(trip, THU, blocked, AT), trip, '排不下的結果不套（回原 trip）');
  const shorter = dayOf(applyInsert(trip, THU, blocked.options[1], AT), THU);   // 酒吧少待 150→135
  assert.deepEqual(shorter.pinned.sequence.slice(-2), [{ poiId: mid.id, dwellMin: 120 }, { poiId: bar.id, dwellMin: 135 }]);
  assert.deepEqual(shorter.picks.find((p) => p.poiId === bar.id), { poiId: bar.id, priority: 'want' }, '少待不改 picks');
  const dropped = dayOf(applyInsert(trip, THU, blocked.options[2].result, AT), THU);   // 不去酒吧（給 result 也收）
  assert.ok(!dropped.picks.some((p) => p.poiId === bar.id));
  assert.deepEqual(dropped.removed, [{ poiId: bar.id, at: AT, priority: 'want' }]);
  assert.ok(!dropped.pinned.sequence.some((e) => e.poiId === bar.id));
  const engineDrop = applyInsert(trip, THU, { fits: true, poiId: small.id, sequence: t.sequence, adjust: [{ kind: 'drop', poiId: '引擎站', insertedBy: 'engine', priority: 'filler' }] }, AT);
  assert.deepEqual(dayOf(engineDrop, THU).removed, [{ poiId: '引擎站', at: AT, insertedBy: 'engine', priority: 'filler', via: 'insert' }], '引擎站在選項裡被選了不去：多記 via insert');
  assert.deepEqual([...insertDroppedEngine(engineDrop)], [[THU, ['引擎站']]]);
  assert.deepEqual([...insertDroppedEngine({ days: [dropped] })], [], '他勾的站被選了不去不算（照一般的不去了）');
  assert.equal(applyInsert(trip, '2026-01-01', t, AT), trip, '沒有那一天');
  assert.equal(applyInsert(trip, THU, null, AT), trip);
  // 解除：pinned 拿掉、其餘不動；沒釘住回同一個物件
  const un = unpinDay(next, THU);
  assert.equal(dayOf(un, THU).pinned, undefined);
  assert.deepEqual(dayOf(un, THU).picks, day.picks);
  assert.equal(unpinDay(un, THU), un);
  assert.equal(unpinDay(next, '2026-01-01'), next);
  // pinnedOf：形狀不對回 null；看不懂的筆跳過、同一家只留第一筆；pinEntriesOf 扣掉坐下來的地方併進去的等待
  assert.equal(pinnedOf({}), null); assert.equal(pinnedOf({ pinned: 'x' }), null); assert.equal(pinnedOf({ pinned: { sequence: 'x' } }), null); assert.equal(pinnedOf({ pinned: [] }), null);
  assert.deepEqual(pinnedOf({ pinned: { sequence: [] } }), { at: null, sequence: [] }, '空的也算釘住');
  assert.deepEqual(pinnedOf({ pinned: { at: AT, sequence: [{ poiId: 'a', dwellMin: 30, junk: 1 }, null, { poiId: '' }, { poiId: 'a' }, { poiId: 'b', dwellMin: -3, insertedBy: 'engine' }, { poiId: 'c', insertedBy: 'me', priority: 'rest' }] } }),
    { at: AT, sequence: [{ poiId: 'a', dwellMin: 30 }, { poiId: 'b', insertedBy: 'engine', priority: 'rest' }, { poiId: 'c' }] });
  assert.deepEqual(pinEntriesOf([{ poi: { id: 'x' }, dwellMin: 80, flexedMin: 20, insertedBy: 'engine', priority: 'rest' }, { poi: { id: 'y' }, dwellMin: 45 }]), [{ poiId: 'x', dwellMin: 60, insertedBy: 'engine', priority: 'rest' }, { poiId: 'y', dwellMin: 45 }]);
  // slotOpenMin（記的時候排在第二段以後的營業時間）與 off（記著但不排的引擎站）讀得進來；off 只有引擎站認、slotOpenMin 要是數字
  assert.deepEqual(pinnedOf({ pinned: { sequence: [{ poiId: 'a', dwellMin: 55, slotOpenMin: 1050 }, { poiId: 'b', slotOpenMin: 'x', off: true }, { poiId: 'c', insertedBy: 'engine', priority: 'onway', off: true }] } }).sequence,
    [{ poiId: 'a', dwellMin: 55, slotOpenMin: 1050 }, { poiId: 'b' }, { poiId: 'c', insertedBy: 'engine', priority: 'onway', off: true }]);
});

test('套完重排：釘住的日子不跑搜尋（節點 0、plan.pinned、day.pinned），排出來的每一站時刻與分數就是試算的那一條；用掉的留白記在 plan.openSlotUsedMin；後處理照掛；解除就回到搜尋', () => {
  const trip = tripOf([{ date: THU, picks: want(...ORDER1) }]);   // 沒釘住：引擎自己排
  const base = run(trip, W1).days[0];
  assert.equal(base.plan.pinned, undefined); assert.equal(base.day.pinned, undefined);
  assert.deepEqual(base.plan.unplaced, [], '沒有排不進的站');
  const t = insertTrial(trialArgs(base, { poi: small, legIndex: base.plan.sequence.length - 1 }));
  assert.equal(t.fits, true);
  const applied = applyInsert(trip, THU, t, AT);
  const after = run(applied, W1, { pool: [mid, noDwell] }).days[0];
  assert.deepEqual(times(after.plan), times(t));
  assert.deepEqual([after.plan.score, after.plan.penaltyMin, after.plan.complete], [t.score, t.penaltyMin, t.complete]);
  assert.deepEqual([after.plan.pinned, after.day.pinned, after.plan.stats.nodes, after.plan.stats.truncated], [true, true, 0, false]);
  assert.equal(after.plan.openSlotUsedMin, t.openSlotUsedMin);
  assert.equal(after.day.window.endMin, hm(22, 30), 'day.window 照舊是扣過留白的收工');
  assert.ok(Array.isArray(after.plan.corridor) && Array.isArray(after.plan.choices) && Array.isArray(after.plan.dropped) && Array.isArray(after.plan.breakfastOffers) && Array.isArray(after.plan.unplaced));
  assert.deepEqual(after.plan.meals, { breakfast: null, lunch: lunch.id, dinner: dinner.id });
  assert.ok(!after.plan.sequence.some((s) => s.insertedBy), '釘住的日子引擎不插恢復站、填站、順路站');
  assert.ok(after.plan.sequence.every((s) => s.gap === null && Number.isFinite(s.startMin)));
  // 重算跟 evaluateSequence 對得起來（收工線用原時窗）
  const ev = evaluateSequence({ sequence: after.plan.sequence, day: rawWindowDay(after.day), home, legFn, rules, settings, country: COUNTRY, kb });
  assert.deepEqual([ev.score, ev.penaltyMin], [after.plan.score, after.plan.penaltyMin]);
  // 再插一次（釘住的日子上再安插）：一樣原本的站都在、先後不變，套完重排＝試算
  const t2 = insertTrial(trialArgs(after, { poi: noDwell, legIndex: 0 }));
  assert.equal(t2.fits, true);
  assert.deepEqual(ids(t2).filter((id) => id !== noDwell.id), ids(after.plan));
  const twice = run(applyInsert(applied, THU, t2, AT), W1).days[0];
  assert.deepEqual(times(twice.plan), times(t2));
  // 解除：回到搜尋（有節點、沒有 pinned）
  const free = run(unpinDay(applied, THU), W1).days[0];
  assert.equal(free.plan.pinned, undefined);
  assert.ok(free.plan.stats.nodes > 0);
  // options.explain 給得出每站的罰分明細
  assert.equal(after.plan.breakdown, null);
  assert.equal(run(applied, W1, { options: { explain: true } }).days[0].plan.breakdown.stops.length, after.plan.sequence.length);
});

test('釘住之後按「不去了」：那一站從順序拿掉、其餘各站都在而且先後不變（他勾的、引擎插的都一樣）；pinned 裡多出來的舊筆被跳過', () => {
  const fill = shop('填空店', { dwellMin: 60 });
  const world = [...W1, fill];
  const order = [A.id, C.id, lunch.id, { poiId: fill.id, dwellMin: 40, insertedBy: 'engine', priority: 'filler' }, dinner.id, B.id, bar.id];
  const trip = tripOf([{ date: THU, picks: want(...ORDER1), pinned: pinOf(...order) }]);
  const base = run(trip, world, { pool: [fill] }).days[0];
  const all = [A.id, C.id, lunch.id, fill.id, dinner.id, B.id, bar.id];
  assert.deepEqual(ids(base.plan), all);
  assert.deepEqual([base.plan.sequence[3].insertedBy, base.plan.sequence[3].priority, base.plan.sequence[3].dwellMin, base.plan.sequence[3].optional], ['engine', 'filler', 40, true], '引擎插的站照 pinned 記的還原');
  for (const id of ORDER1) {
    const p = run(withoutPick(trip, THU, id), world, { pool: [fill] }).days[0].plan;
    assert.deepEqual(ids(p), all.filter((x) => x !== id), `不去 ${id}`);
    assert.deepEqual(p.dropped, []);
  }
  // 引擎插的那一站按不去了（removed 記 insertedBy）：它不見、其餘不動
  const noFill = { ...trip, days: trip.days.map((d) => ({ ...d, removed: [{ poiId: fill.id, at: AT, insertedBy: 'engine', priority: 'filler' }] })) };
  assert.deepEqual(ids(run(noFill, world, { pool: [fill] }).days[0].plan), ORDER1);
  // 知識庫裡沒有的引擎站、pinned 裡不是引擎站又不在 picks 的舊筆：跳過
  const stale = tripOf([{ date: THU, picks: want(A.id, lunch.id), pinned: pinOf({ poiId: '不存在', insertedBy: 'engine', priority: 'rest' }, A.id, '走掉的站', lunch.id) }]);
  assert.deepEqual(ids(run(stale, world).days[0].plan), [A.id, lunch.id]);
  // 順序裡記著的引擎站所在的區也算這天的區域：他把同一區唯一勾的那一站按掉之後，引擎那一站不會變成「出了今天的區域」多罰一筆
  const eastFill = shop('東區的店', { zoneId: 'east' });
  const eastTrip = tripOf([{ date: THU, picks: want(A.id), pinned: pinOf(A.id, { poiId: eastFill.id, dwellMin: 30, insertedBy: 'engine', priority: 'filler' }) }]);
  const east = run(eastTrip, [...world, eastFill], { pool: [eastFill] }).days[0];
  assert.deepEqual(ids(east.plan), [A.id, eastFill.id]);
  assert.ok(east.day.regionZones.includes('east'), `當日區域要含引擎站的區：${east.day.regionZones}`);
});

test('釘住之後按「換一家」：applySwap 把順序裡那一筆原位置換掉（停留不沿用舊那家的），其餘各站先後不變；pinned 沒被改寫時靠 swapped 紀錄對回原位置', () => {
  const D = mk('街區D', { dwellMin: 45 });
  const world = [...W1, D];
  const trip = tripOf([{ date: THU, picks: want(...ORDER1), pinned: pinOf(A.id, { poiId: C.id, dwellMin: 30 }, lunch.id, dinner.id, B.id, bar.id) }]);
  const before = run(trip, world).days[0].plan;
  assert.equal(before.sequence[1].dwellMin, 30, '停留用 pinned 記的');
  // 換一家的清單照舊從 swapCandidates 來（釘住的日子不另外算）：同店型、順路、已經在行程裡的不列
  assert.deepEqual(swapCandidates({ plan: before, stopId: C.id, pool: [D, B].map((poi) => ({ poi })), legFn, date: THU, settings }).map((c) => c.poi.id), [D.id]);
  const swappedDay = applySwap(dayOf(trip, THU), C.id, D);
  assert.deepEqual(swappedDay.pinned.sequence.map((e) => e.poiId), [A.id, D.id, lunch.id, dinner.id, B.id, bar.id]);
  assert.deepEqual(swappedDay.pinned.sequence[1], { poiId: D.id }, '舊那家的停留不沿用');
  assert.equal(swappedDay.pinned.at, AT);
  assert.deepEqual(dayOf(trip, THU).pinned.sequence[1], { poiId: C.id, dwellMin: 30 }, '不改傳入的');
  const after = run({ ...trip, days: [swappedDay] }, world).days[0].plan;
  assert.deepEqual(ids(after), [A.id, D.id, lunch.id, dinner.id, B.id, bar.id]);
  assert.equal(after.sequence[1].dwellMin, 45, '新那家用它自己的停留');
  // 沒釘住的日子 applySwap 不多 pinned 這個鍵；from 不在順序裡就不動 pinned
  assert.equal('pinned' in applySwap({ picks: want(C.id) }, C.id, D), false);
  assert.deepEqual(applySwap({ picks: want(C.id), pinned: pinOf(A.id) }, C.id, D).pinned, pinOf(A.id));
  // 殘留的舊筆（D 之前在順序裡、後來拿掉）先清掉，不會同一家出現兩次
  assert.deepEqual(applySwap({ picks: want(C.id), pinned: pinOf(D.id, A.id, C.id) }, C.id, D).pinned.sequence.map((e) => e.poiId), [A.id, D.id]);
  // pinned 沒被改寫（二選一選了今天排不進的那家：ui/choices.js swapPick 只動 picks 與 swapped）：照 swapped 紀錄把接手的那家放在原位置
  const viaRecord = { ...trip, days: trip.days.map((d) => ({ ...d, picks: d.picks.map((p) => (p.poiId === C.id ? { ...p, poiId: D.id } : p)), swapped: [{ from: C.id, to: D.id, at: AT }] })) };
  assert.deepEqual(ids(run(viaRecord, world).days[0].plan), [A.id, D.id, lunch.id, dinner.id, B.id, bar.id]);
  // 換了兩次（C→D→B2）：一路追到還在 picks 裡的那一家
  const B2 = mk('街區E');
  const chain = { ...trip, days: trip.days.map((d) => ({ ...d, picks: d.picks.map((p) => (p.poiId === C.id ? { ...p, poiId: B2.id } : p)), swapped: [{ from: C.id, to: D.id, at: AT }, { from: D.id, to: B2.id, at: AT }] })) };
  assert.deepEqual(ids(run(chain, [...world, B2]).days[0].plan), [A.id, B2.id, lunch.id, dinner.id, B.id, bar.id]);
});

test('釘住之後二選一選了 B：B 在 A 的原位置、其餘先後不變，A 順延到別天；順延到釘住的日子：試每個位置、挑分數最高的插，排定的位置記回那天的 pinned', () => {
  const ca = cafe('咖啡甲'); const cb = cafe('咖啡乙'); const cd = cafe('咖啡丁'); const cx = cafe('咖啡戊');
  const world = [A, B, lunch, dinner, ca, cb, cd, cx, small];
  const planArgs = { rules, settings, country: COUNTRY, kb, legFn, restPool: [cx] };
  // 四天（最後兩天是購物日，不收順延）：8/13 釘住 午餐→咖啡甲→A→晚餐；8/14 釘住 午餐→B→晚餐
  const trip = tripOf([
    { date: THU, picks: want(lunch.id, ca.id, A.id, dinner.id), pinned: pinOf(lunch.id, ca.id, A.id, dinner.id) },
    { date: FRI, picks: want(lunch.id, B.id, dinner.id), pinned: pinOf(lunch.id, B.id, dinner.id) },
    { date: SAT, picks: [] }, { date: SUN, picks: [] },
  ]);
  const base = planTrip({ trip, pois: poisOf(world), ...planArgs });
  assert.deepEqual(ids(base.days[0].plan), [lunch.id, ca.id, A.id, dinner.id]);
  const choice = base.days[0].plan.choices.find((c) => c.poiId === ca.id);
  assert.ok(choice && choice.options[1] === cx.id, `釘住的日子照樣出二選一：${JSON.stringify(base.days[0].plan.choices.map((c) => c.options))}`);
  // 選了咖啡戊：8/13 原位置換掉；咖啡甲順延到 8/14（釘住的日子），排定的位置記進那天的 pinned
  const out = chooseOptionTrip({ trip, pois: poisOf(world), date: THU, fromPoiId: ca.id, toPoi: cx, baseline: base, planArgs });
  assert.equal(out.toDate, FRI);
  assert.deepEqual(dayOf(out.trip, THU).pinned.sequence.map((e) => e.poiId), [lunch.id, cx.id, A.id, dinner.id]);
  const r = planTrip({ trip: out.trip, pois: poisOf(world), ...planArgs });
  assert.deepEqual(ids(r.days[0].plan), [lunch.id, cx.id, A.id, dinner.id], '8/13：B 在 A 的原位置');
  const fri = ids(r.days[1].plan);
  assert.ok(fri.includes(ca.id));
  assert.deepEqual(fri.filter((id) => id !== ca.id), [lunch.id, B.id, dinner.id], '8/14 原本的站先後不變');
  assert.deepEqual(dayOf(out.trip, FRI).pinned.sequence.map((e) => e.poiId), fri, '順延進來的站排在哪記回 pinned');
  assert.equal(r.days[1].plan.sequence.find((s) => s.poi.id === ca.id).deferredFrom, THU);
  assert.equal(r.days[1].plan.pinned, true);
  // defer 直接用也一樣；排不進的日子（同類上限）就換下一天或留在候選池
  const full = tripOf([
    { date: THU, picks: want(ca.id, lunch.id), pinned: pinOf(ca.id, lunch.id) },
    { date: FRI, picks: want(cb.id, lunch.id, cd.id), pinned: pinOf(cb.id, lunch.id, cd.id) },   // 已經兩家咖啡廳
    { date: SAT, picks: [] }, { date: SUN, picks: [] },
  ]);
  const fullBase = planTrip({ trip: full, pois: poisOf(world), ...planArgs });
  const stuck = defer({ trip: full, pois: poisOf(world), poiId: ca.id, fromDate: THU, baseline: fullBase, planArgs });
  assert.deepEqual([stuck.toDate, stuck.entry.status], [null, 'unplaced'], '8/14 釘住又滿了兩家咖啡廳：排不進，留在候選池');
  assert.deepEqual(dayOf(stuck.trip, FRI).pinned, dayOf(full, FRI).pinned, '試排不留痕跡');
  // repinFromPlan：那天沒釘住、或 plan 不是釘住排的就回原 trip
  assert.equal(repinFromPlan(trip, SAT, r.days[1].plan), trip);
  assert.equal(repinFromPlan(trip, FRI, { sequence: [] }), trip);
});

test('釘住的日子上二選一的「或 B」先試算（pinnedChoiceCheck、choicesFor；11-17）：選了會害別的站不見或排不進的不出；放行的選下去就是原位置換掉、其餘不動；沒釘住的日子不試', () => {
  const ca = cafe('咖啡甲'); const cx = cafe('咖啡戊'); const slow = cafe('坐很久的咖啡', { dwellMin: 300 });
  const world = [A, lunch, dinner, ca, cx, slow];
  const planArgs = { rules, settings, country: COUNTRY, kb, legFn, restPool: [slow] };
  // 釘住：咖啡甲 09:05 → 午餐 11:30（14:30 關）→ A → 晚餐。候選池只有「坐很久的咖啡」（停 300 分）：引擎照樣出「咖啡甲 或 坐很久的咖啡」
  const order = [ca.id, lunch.id, A.id, dinner.id];
  const trip = tripOf([{ date: THU, picks: want(...order), pinned: pinOf(...order) }, { date: FRI, picks: [] }, { date: SAT, picks: [] }, { date: SUN, picks: [] }]);
  const base = planTrip({ trip, pois: poisOf(world), ...planArgs });
  const d = base.days[0];
  assert.deepEqual(ids(d.plan), order);
  const risky = d.plan.choices.find((c) => c.poiId === ca.id);
  assert.equal(risky?.options[1], slow.id, '引擎出的二選一沒有試算過');
  // 沒試算就選下去：午餐會超過關門、落到排不進清單（這就是要擋的事）
  const blind = chooseOptionTrip({ trip, pois: poisOf(world), date: THU, fromPoiId: ca.id, toPoi: slow, baseline: base, planArgs });
  const blindPlan = planTrip({ trip: blind.trip, pois: poisOf(world), ...planArgs }).days[0].plan;
  assert.deepEqual(blindPlan.dropped.map((x) => x.poi.id), [lunch.id]);
  // 試算：坐很久的不出、停 50 分的可以出
  const check = pinnedChoiceCheck({ trip, date: THU, plan: d.plan, pois: poisOf(world), planArgs });
  assert.equal(check(risky), false, '選了午餐會排不進');
  const fine = { date: THU, poiId: ca.id, slot: 0, options: [ca.id, cx.id], source: 'pool', detourMin: 5, altPoi: cx };
  assert.equal(check(fine), true);
  assert.equal(check({ ...fine, altPoi: undefined }), true, '沒帶 altPoi 就拿 options[1] 去 pois 找');
  assert.equal(check(null), false);
  assert.equal(check({ ...fine, poiId: '不在序列裡' }), false);
  assert.deepEqual(choicesFor({ trip, date: THU, plan: d.plan, pois: poisOf(world), planArgs }), [], '畫面拿這一份：釘住的日子只留選了沒事的');
  const ok = planTrip({ trip, pois: poisOf(world), ...planArgs, restPool: [cx] }).days[0];
  assert.deepEqual(choicesFor({ trip, date: THU, plan: ok.plan, pois: poisOf(world), planArgs: { ...planArgs, restPool: [cx] } }).map((c) => c.options), [[ca.id, cx.id]]);
  // 放行的選下去：原位置換掉、其餘不動（畫面照 chooseDay 改那一天、再把 A 順延）
  const chosenDay = chooseDay(dayOf(trip, THU), ca.id, cx, AT);
  assert.deepEqual(chosenDay.pinned.sequence.map((e) => e.poiId), [cx.id, lunch.id, A.id, dinner.id]);
  assert.deepEqual(chosenDay.swapped, [{ from: ca.id, to: cx.id, at: AT }]);
  assert.deepEqual(ids(run({ ...trip, days: [chosenDay, ...trip.days.slice(1)] }, world).days[0].plan), [cx.id, lunch.id, A.id, dinner.id]);
  // 沒釘住的日子：永遠 true（選了本來就整天重排）、choicesFor 原樣回
  const freeTrip = tripOf([{ date: THU, picks: want(...order) }]);
  const fd = planTrip({ trip: freeTrip, pois: poisOf(world), ...planArgs }).days[0];
  assert.equal(pinnedChoiceCheck({ trip: freeTrip, date: THU, plan: fd.plan, pois: poisOf(world), planArgs })(risky), true);
  assert.equal(choicesFor({ trip: freeTrip, date: THU, plan: fd.plan, pois: poisOf(world), planArgs }), fd.plan.choices);
});

test('chooseDay（二選一選了 B，那一天怎麼改）：候選池來的 B＝換一家；B 本來就是今天排不進的勾選站＝A 那筆拿掉、B 留著、優先度取高的，釘住的日子把順序裡 A 的那一筆原位置換成 B；跟畫面的 swapPick 改出來的 picks 相同', () => {
  const ca = cafe('咖啡甲'); const cb = cafe('咖啡乙'); const cd = cafe('咖啡丁'); const cx = cafe('咖啡戊');
  const world = [A, lunch, dinner, ca, cb, cd, cx];
  const planArgs = { rules, settings, country: COUNTRY, kb, legFn, restPool: [] };
  // 釘住：午餐 → 咖啡甲 → 咖啡乙 → 晚餐；咖啡丁也勾了（maybe 改成 want 以外的優先度看取高的）、因為咖啡廳一天 2 家排不進
  const picks = [...want(lunch.id, ca.id, cb.id, dinner.id), { poiId: cd.id, priority: 'must' }];
  const trip = tripOf([{ date: THU, picks, pinned: pinOf(lunch.id, ca.id, cb.id, dinner.id) }, { date: FRI, picks: [] }, { date: SAT, picks: [] }, { date: SUN, picks: [] }]);
  const base = planTrip({ trip, pois: poisOf(world), ...planArgs });
  const d = base.days[0];
  assert.deepEqual(ids(d.plan), [lunch.id, ca.id, cb.id, dinner.id]);
  assert.deepEqual(d.plan.dropped.map((x) => x.poi.id), [cd.id]);
  // 今天排不進的那家（咖啡丁）頂掉咖啡甲
  const day = chooseDay(dayOf(trip, THU), ca.id, cd, AT);
  assert.deepEqual(day.picks, [...want(lunch.id, cb.id, dinner.id), { poiId: cd.id, priority: 'must' }], 'A 那筆拿掉、B 自己那筆留著，優先度取兩者之間高的');
  assert.deepEqual(day.swapped, [{ from: ca.id, to: cd.id, at: AT }]);
  assert.deepEqual(day.pinned.sequence.map((e) => e.poiId), [lunch.id, cd.id, cb.id, dinner.id], '釘住的順序裡 A 的那一筆原位置換成 B');
  assert.deepEqual(dayOf(trip, THU).pinned.sequence.map((e) => e.poiId), [lunch.id, ca.id, cb.id, dinner.id], '不改傳入的');
  assert.deepEqual(ids(run({ ...trip, days: [day, ...trip.days.slice(1)] }, world).days[0].plan), [lunch.id, cd.id, cb.id, dinner.id]);
  // 試算放行（B 原本排不進、選了排進來是本意，不算多掉進排不進）
  assert.equal(pinnedChoiceCheck({ trip, date: THU, plan: d.plan, pois: poisOf(world), planArgs })({ poiId: ca.id, options: [ca.id, cd.id], source: 'dropped', altPoi: cd }), true);
  // 優先度：A 是 want、B 是 maybe → 升成 want；B 的停留照它自己的
  const low = chooseDay({ picks: [{ poiId: ca.id, priority: 'want', dwellMin: 90 }, { poiId: cd.id, priority: 'maybe', dwellMin: 20 }] }, ca.id, cd, AT);
  assert.deepEqual(low.picks, [{ poiId: cd.id, priority: 'want', dwellMin: 20 }]);
  assert.equal('pinned' in low, false, '沒釘住的日子不多 pinned 這個鍵');
  // 順序裡殘留的 B 舊筆先清掉；A 不在順序裡就不動 pinned
  assert.deepEqual(chooseDay({ picks: want(ca.id, cd.id), pinned: pinOf(cd.id, lunch.id, ca.id) }, ca.id, cd, AT).pinned.sequence.map((e) => e.poiId), [lunch.id, cd.id]);
  assert.deepEqual(chooseDay({ picks: want(ca.id, cd.id), pinned: pinOf(lunch.id) }, ca.id, cd, AT).pinned, pinOf(lunch.id));
  // 候選池來的 B：就是換一家（applySwap）；兩種來源改出來的 picks 都跟畫面現在的 swapPick 一樣
  const pool = chooseDay(dayOf(trip, THU), ca.id, cx, AT);
  assert.deepEqual(pool.picks, applySwap(dayOf(trip, THU), ca.id, cx).picks);
  assert.deepEqual(pool.pinned.sequence.map((e) => e.poiId), [lunch.id, cx.id, cb.id, dinner.id]);
  for (const to of [cd, cx]) {
    const ui = swapPick(dayOf(trip, THU), ca.id, to);
    const en = chooseDay(dayOf(trip, THU), ca.id, to, AT);
    assert.deepEqual(en.picks, ui.picks, `${to.id}：picks 相同`);
    assert.deepEqual(en.swapped.map(({ from, to: t }) => [from, t]), ui.swapped.map(({ from, to: t }) => [from, t]), `${to.id}：swapped 相同`);
    assert.deepEqual(ids(run({ ...trip, days: [en, ...trip.days.slice(1)] }, world).days[0].plan), ids(run({ ...trip, days: [ui, ...trip.days.slice(1)] }, world).days[0].plan), `${to.id}：排出來相同`);
  }
});

test('順序以外的勾選站（釘住時就排不進的、順延進來的）：排得下、分數有變好、不多用留白才自己排進來；不然留在排不進清單並講原因；試算先講會不會跟著排進來（revived）', () => {
  const ca = cafe('咖啡甲'); const cb = cafe('咖啡乙'); const cd = cafe('咖啡丁');
  const eveDinner = { ...dinner, hours: daily('16:30', '22:00') };
  const huge = shop('超大店', { dwellMin: 330 });
  const world = [A, lunch, eveDinner, ca, cb, cd, huge, small];
  const picks = want(A.id, ca.id, lunch.id, cb.id, eveDinner.id, cd.id);
  const trip = tripOf([{ date: THU, picks }]);
  const base = run(trip, world).days[0];
  assert.deepEqual(ids(base.plan), [lunch.id, ca.id, A.id, cb.id, eveDinner.id]);
  assert.deepEqual(base.plan.dropped.map((x) => x.poi.id), [cd.id], '第三家咖啡廳排不進');
  assert.deepEqual(base.plan.unplaced.map((s) => [s.poi.id, s.dwellMin, s.priority, s.optional, s.insertedBy]), [[cd.id, 60, 'want', false, null]], 'plan.unplaced：排不進的勾選站照原樣（還沒定時刻）');
  // 直接排得下的安插：咖啡丁還是排不進（同類上限），理由換成釘住的日子的講法
  const t = insertTrial(trialArgs(base, { poi: small, legIndex: 1 }));
  assert.deepEqual([t.fits, t.revived], [true, []]);
  const pinnedTrip = applyInsert(trip, THU, t, AT);
  const p1 = run(pinnedTrip, world).days[0].plan;
  assert.deepEqual(times(p1), times(t));
  assert.deepEqual(p1.dropped.map((x) => [x.poi.id, x.reason]), [[cd.id, '照你調過的順序排不進：今天咖啡廳已經 2 家，不是咖啡廳主題日不再排']]);
  // 之後不去咖啡甲：咖啡丁排得進來了（其餘各站先後不變）
  const p2 = run(withoutPick(pinnedTrip, THU, ca.id), world).days[0].plan;
  assert.ok(ids(p2).includes(cd.id));
  assert.deepEqual(ids(p2).filter((id) => id !== cd.id), ids(p1).filter((id) => id !== ca.id));
  assert.deepEqual(p2.dropped, []);
  // 試算先講：插 330 分的店排不下，選「不去咖啡甲」→ 咖啡丁會跟著排進來（revived），套完重排就是那樣
  const blocked = insertTrial(trialArgs(base, { poi: huge, legIndex: 1 }));
  assert.equal(blocked.fits, false);
  const dropCa = blocked.options.find((o) => o.kind === 'drop' && o.poiId === ca.id);
  assert.deepEqual([dropCa.fits, dropCa.result.revived], [true, [cd.id]]);
  assert.deepEqual(blocked.options.find((o) => o.kind === 'shorten-new').result.revived, []);
  const p3 = run(applyInsert(trip, THU, dropCa, AT), world).days[0].plan;
  assert.deepEqual(times(p3), times(dropCa.result), '跟著排進來的那一站也在試算裡，套完重排一模一樣');
  assert.equal(p3.score, dropCa.result.score);
  // 要用到留白才排得進的不自己排（留白是留給他臨時起意的）：酒吧 22:30 剛好收工，再多一站就要吃留白
  const late = tripOf([{ date: THU, picks: want(...ORDER1, small.id), pinned: pinOf(...ORDER1) }]);
  const pl = run(late, W1).days[0].plan;
  assert.deepEqual(ids(pl), [...ORDER1.slice(0, 3), small.id, ...ORDER1.slice(3)], '午餐後到晚餐前有空檔：排得進、不用留白');
  // 抵達日 17:00 才開始（16:00 落地＋60 分出關）：晚餐前沒有空檔，中店排在哪都會把酒吧推過 22:30 → 不自己排，理由講留白
  const tight = tripOf([{ date: THU, type: 'arrival', arriveMin: hm(16), picks: want(dinner.id, B.id, bar.id, mid.id), pinned: pinOf(dinner.id, B.id, bar.id) }]);
  const td = run(tight, W1).days[0];
  assert.deepEqual([td.day.window.startMin, td.day.window.endMin, td.day.windowRaw.endMin], [hm(17), hm(22, 30), hm(24)]);
  assert.deepEqual(ids(td.plan), [dinner.id, B.id, bar.id]);
  assert.deepEqual(td.plan.dropped.map((x) => [x.poi.id, x.reason]), [[mid.id, '照你調過的順序，要用到今天的留白才排得進，先不排']]);
  assert.equal(td.plan.openSlotUsedMin, 0);
  // 排得進、但排進去整天的分數反而低的不自己排（跟搜尋同一個取捨）：非購物日的藥妝店（可去可不去），購物類排在非購物日的罰比它的價值高
  const drug = shop('藥妝店', { category: 'drugstore', dwellMin: 30 });
  const fourDays = tripOf([{ date: THU, picks: [...want(...ORDER1), { poiId: drug.id, priority: 'maybe' }], pinned: pinOf(...ORDER1) }, { date: FRI, picks: [] }, { date: SAT, picks: [] }, { date: SUN, picks: [] }]);
  const fd = run(fourDays, [...W1, drug]).days[0];
  assert.equal(fd.day.shoppingDay, false, '四天的旅程，第一天不是購物日');
  assert.deepEqual(ids(fd.plan), ORDER1);
  assert.deepEqual(fd.plan.dropped.map((x) => [x.poi.id, x.priority, x.reason]), [[drug.id, 'maybe', '排得進，但排進去整天的分數反而低']]);
});

test('釘住的日子撞硬規則：那一站移到排不進清單、附那條規則的句子，其餘照排（總則 0）；撞的是必去／指定／主行程／固定時段的站，就先拿掉排在它前面的別站', () => {
  // 酒吧 20:00–24:00 停 150；把 B 的停留記成 200 分（18:35–21:55）：酒吧 22:00 才到、要待到 24:30 → 酒吧排不進
  const trip = tripOf([{ date: THU, picks: want(...ORDER1), pinned: pinOf(A.id, C.id, lunch.id, dinner.id, { poiId: B.id, dwellMin: 200 }, bar.id) }]);
  const p = run(trip, W1).days[0].plan;
  assert.deepEqual(ids(p), [A.id, C.id, lunch.id, dinner.id, B.id]);
  assert.deepEqual(p.dropped.map((x) => x.poi.id), [bar.id]);
  assert.match(p.dropped[0].reason, /^酒吧 待到 24:30，超過 24:00 關門/);
  assert.equal(p.pinned, true);
  // 酒吧是必去：改拿掉排在它前面、不是鎖住的站裡拿掉就讓它過的那一站（B），理由講是為了誰
  const must = { ...trip, days: trip.days.map((d) => ({ ...d, picks: d.picks.map((x) => (x.poiId === bar.id ? { ...x, priority: 'must' } : x)) })) };
  const pm = run(must, W1).days[0].plan;
  assert.deepEqual(ids(pm), [A.id, C.id, lunch.id, dinner.id, bar.id]);
  assert.deepEqual(pm.dropped.map((x) => x.poi.id), [B.id]);
  assert.match(pm.dropped[0].reason, /^排在它後面的 酒吧 會排不進（酒吧 待到 24:30，超過 24:00 關門/);
  // 自己待太久超過關門的那一站：拿掉的是它自己（B 記成 300 分，23:35 才結束、23:00 關）
  const self = tripOf([{ date: THU, picks: want(...ORDER1), pinned: pinOf(A.id, C.id, lunch.id, dinner.id, { poiId: B.id, dwellMin: 300 }, bar.id) }]);
  const ps = run(self, W1).days[0].plan;
  assert.deepEqual([ids(ps), ps.dropped.map((x) => x.poi.id)], [[A.id, C.id, lunch.id, dinner.id, bar.id], [B.id]]);
  assert.match(ps.dropped[0].reason, /^街區B 待到 23:35，超過 23:00 關門/);
  // 引擎插的站撞到：直接不見、不進排不進清單（跟搜尋一樣，不算落選）
  const fill = shop('填空店', { hours: daily('09:00', '12:00') });
  const eng = tripOf([{ date: THU, picks: want(A.id, lunch.id), pinned: pinOf(A.id, lunch.id, { poiId: fill.id, dwellMin: 60, insertedBy: 'engine', priority: 'filler' }) }]);
  const pe = run(eng, [...W1, fill], { pool: [fill] }).days[0].plan;
  assert.deepEqual([ids(pe), pe.dropped], [[A.id, lunch.id], []]);
  // 引擎插的站先讓：排在前面的引擎站害他勾的站排不進（酒吧 22:05 才到、要待到 24:35）。
  // 填站先縮短再說拿掉（11-12 審查；跟安插試算、引擎排早餐同一個做法）：140 分縮到 105 分，酒吧 21:30 進得去——填站還在、他勾的酒吧也在，沒有提示
  const longFill = shop('久逛店', { dwellMin: 60 });
  const giveOf = (priority, dwellMin = 140) => tripOf([{ date: THU, picks: want(...ORDER1), pinned: pinOf(A.id, C.id, lunch.id, dinner.id, B.id, { poiId: longFill.id, dwellMin, insertedBy: 'engine', priority }, bar.id) }]);
  const pg = run(giveOf('filler'), [...W1, longFill], { pool: [longFill] }).days[0].plan;
  assert.deepEqual([ids(pg), pg.dropped, pg.yielded], [[...ORDER1.slice(0, 5), longFill.id, bar.id], [], []]);
  assert.deepEqual(times(pg).slice(-2), ['久逛店@1180-1285', '酒吧@1290-1440'], '縮到剛好讓酒吧過（5 分一階）');
  assert.ok(!pg.warnings.some((w) => w.ruleId === PINNED_ORDER_HINT));
  // 縮到最短（15 分）也救不了的填站、不是填站的引擎站（順路站）：拿掉它、他勾的酒吧留著；不進排不進清單，但出一句提示（之前無聲拿掉）、plan.yielded 列它
  const bigB = tripOf([{ date: THU, picks: want(...ORDER1), pinned: pinOf(A.id, C.id, lunch.id, dinner.id, { poiId: B.id, dwellMin: 160 }, { poiId: longFill.id, dwellMin: 40, insertedBy: 'engine', priority: 'filler' }, bar.id) }]);
  const pb = run(bigB, [...W1, longFill], { pool: [longFill] }).days[0].plan;   // B 18:35–21:15：填站縮到 15 分酒吧也要 21:40 才到
  assert.deepEqual([ids(pb), pb.dropped, pb.yielded], [ORDER1, [], [longFill.id]]);
  const po = run(giveOf('onway'), [...W1, longFill], { pool: [longFill] }).days[0].plan;
  assert.deepEqual([ids(po), po.dropped, po.yielded], [ORDER1, [], [longFill.id]]);
  assert.deepEqual(po.warnings.filter((w) => w.ruleId === PINNED_ORDER_HINT), [{ ruleId: 'pinned-order', code: 'hint', hint: true, msg: '照你調過的順序排不下，引擎排的 久逛店 這天先拿掉' }]);
  // 畫面每次重排完把那一條記回旅程檔（repinTrip）：被讓掉的引擎站留一筆 off（不再排、別天照樣不拿它），再排一次就沒有那句提示了
  const kept = repinTrip(giveOf('onway'), [{ date: THU, plan: po }]);
  assert.deepEqual(dayOf(kept, THU).pinned.sequence.at(-1), { poiId: longFill.id, insertedBy: 'engine', priority: 'onway', off: true });
  assert.deepEqual([...pinnedEngineIds(kept)], [longFill.id], '記著：別天的引擎不拿它');
  const again = run(kept, [...W1, longFill], { pool: [longFill] }).days[0].plan;
  assert.deepEqual([ids(again), again.yielded, again.warnings.filter((w) => w.ruleId === PINNED_ORDER_HINT)], [ORDER1, [], []]);
  assert.equal(repinTrip(kept, [{ date: THU, plan: again }]), kept, '沒有東西要記就回同一個物件');
  // 空的順序：picks 當成順序以外的站一家一家試
  const empty = run(tripOf([{ date: THU, picks: want(A.id, lunch.id), pinned: pinOf() }]), W1).days[0].plan;
  assert.deepEqual(ids(empty).sort(), [A.id, lunch.id].sort());
  // planPinnedDay 直接叫：沒有候選、沒有順序也回得出空的 plan
  const bare = planPinnedDay({ pinned: pinOf(), candidates: [], day: run(trip1(), W1).days[0].day, home, legFn, rules, settings, country: COUNTRY, kb });
  assert.deepEqual([bare.sequence, bare.dropped, bare.pinned, bare.stats.nodes], [[], [], true, 0]);
});

// ── 早餐（國家層有早餐段；engine/breakfast.js）在釘住的日子上 ──
const noodle = eat('麵店'); const stand = eat('站內店'); const bakery = eat('麵包店');
const eveDinner = { ...dinner, hours: daily('16:30', '22:00') };
const other = shop('另一家店');
const WB = [A, B, lunch, eveDinner, noodle, stand, bakery, small, other];
const bfPicks = want(A.id, lunch.id, B.id, eveDinner.id);
const bfTrip = () => tripOf([{ date: THU, picks: bfPicks }, { date: FRI, picks: bfPicks }]);
const runB = (trip, pool = [noodle, stand]) => run(trip, WB, { pool, country: JP });

test('釘住的日子不重排早餐：引擎排的早餐記在順序裡、照樣是那天的早餐；引擎不另排、別天也不拿同一家；在早餐前安插也照插', () => {
  const base = runB(bfTrip());
  assert.deepEqual(ids(base.days[0].plan), [noodle.id, A.id, B.id, lunch.id, eveDinner.id]);
  assert.deepEqual(ids(base.days[1].plan)[0], stand.id);
  const t = insertTrial(trialArgs(base.days[0], { poi: small, legIndex: 2 }, JP));
  assert.equal(t.fits, true);
  assert.deepEqual(ids(t), [noodle.id, A.id, small.id, B.id, lunch.id, eveDinner.id]);
  const trip = applyInsert(bfTrip(), THU, t, AT);
  assert.deepEqual(dayOf(trip, THU).pinned.sequence[0], { poiId: noodle.id, dwellMin: 20, insertedBy: 'engine', priority: 'breakfast' });
  const r = runB(trip, [stand, noodle, bakery]);   // 池的先後換了也不影響釘住的那天
  const p = r.days[0].plan;
  assert.deepEqual(times(p), times(t));
  assert.deepEqual([p.meals.breakfast, p.sequence[0].insertedBy, p.sequence[0].priority, isPlacedBreakfast(p.sequence[0])], [noodle.id, 'engine', 'breakfast', true]);
  assert.equal(p.sequence.filter((s) => s.priority === 'breakfast').length, 1, '引擎不另排一家');
  assert.ok(!ids(r.days[1].plan).includes(noodle.id), '8/14 的早餐不拿 8/13 釘住的那一家');
  assert.ok(r.days[1].plan.meals.breakfast);
  // 在早餐前（第 0 段）安插：照插，早餐變第二站、還是那天的早餐
  const front = insertTrial(trialArgs(base.days[0], { poi: small, legIndex: 0 }, JP));
  assert.deepEqual([front.fits, ids(front).slice(0, 2)], [true, [small.id, noodle.id]]);
  const pf = runB(applyInsert(bfTrip(), THU, front, AT)).days[0].plan;
  assert.deepEqual(times(pf), times(front));
  assert.equal(pf.meals.breakfast, noodle.id);
  // 釘住的日子沒有早餐（順序裡沒記）：引擎不替它排，照樣出「今天沒排早餐」的提示
  const noBf = tripOf([{ date: THU, picks: bfPicks, pinned: pinOf(A.id, B.id, lunch.id, eveDinner.id) }]);
  const pn = runB(noBf).days[0].plan;
  assert.deepEqual(ids(pn), [A.id, B.id, lunch.id, eveDinner.id]);
  assert.equal(pn.meals.breakfast, null);
  assert.deepEqual(pn.warnings.filter((w) => w.ruleId === 'breakfast-slot').map((w) => [w.hint, w.msg]), [[true, '今天沒排早餐']]);
});

test('釘住的日子按「吃飯店早餐」「改天去」：早餐那一站從順序拿掉、其餘各站先後不變、不提示；「改回來」回到原位；原定那家照樣在後面的日子推薦', () => {
  const base = runB(bfTrip());
  const trip = applyInsert(bfTrip(), THU, insertTrial(trialArgs(base.days[0], { poi: small, legIndex: 2 }, JP)), AT);
  const pinnedPlan = runB(trip).days[0].plan;
  const rest = ids(pinnedPlan).filter((id) => id !== noodle.id);
  for (const mode of ['hotel', 'later']) {
    const off = setBreakfast(trip, THU, mode, noodle.id, AT);
    assert.deepEqual(dayOf(off, THU).pinned, dayOf(trip, THU).pinned, '順序的紀錄不動（改回來才回得到原位）');
    const r = runB(off);
    const p = r.days[0].plan;
    assert.deepEqual(ids(p), rest, `${mode}：早餐拿掉、其餘先後不變`);
    assert.equal(p.meals.breakfast, null);
    assert.deepEqual(p.warnings.filter((w) => w.ruleId === 'breakfast-slot'), [], '他說不排就不提示');
    assert.deepEqual([r.days[0].day.breakfast.mode, r.days[0].day.breakfast.poiId, p.pinned], [mode, noodle.id, true]);
    // 原定那家在後面的日子推薦（8/14 沒釘住：換掉引擎排的站內店）
    assert.deepEqual(r.days[1].plan.breakfastOffers.map((o) => [o.poiId, o.fromDate, o.mode, o.replaces]), [[noodle.id, THU, mode, stand.id]]);
    assert.ok(!ids(r.days[1].plan).includes(noodle.id), '不自動換');
    // 改回來：回到原位、時刻跟按之前一樣
    assert.deepEqual(times(runB(clearBreakfast(off, THU)).days[0].plan), times(pinnedPlan));
  }
  // 他說吃飯店之後又安插了一家：重寫的順序裡留著那一筆早餐（被跳過），改回來還是回到第一站
  const off = setBreakfast(trip, THU, 'hotel', noodle.id, AT);
  const offDay = runB(off).days[0];
  const t2 = insertTrial(trialArgs(offDay, { poi: other, legIndex: offDay.plan.sequence.length - 1 }, JP));   // 晚餐前的空檔
  assert.equal(t2.fits, true);
  const again = applyInsert(off, THU, t2, AT);
  assert.deepEqual(dayOf(again, THU).pinned.sequence.map((e) => e.poiId), [noodle.id, ...ids(t2)]);
  assert.deepEqual(times(runB(again).days[0].plan), times(t2), '不排早餐的期間：就是試算的那一條');
  const back = runB(clearBreakfast(again, THU)).days[0].plan;
  assert.deepEqual(ids(back), [noodle.id, ...ids(t2)]);
  assert.equal(back.meals.breakfast, noodle.id);
  // 還沒釘住就先說吃飯店（引擎排的那家被記著）、之後才安插：釘住的順序最前面補一筆那家早餐，改回來它回到第一站
  const hotelFirst = setBreakfast(bfTrip(), THU, 'hotel', noodle.id, AT);
  const hf = runB(hotelFirst).days[0];
  assert.ok(!ids(hf.plan).includes(noodle.id));
  const t3 = insertTrial(trialArgs(hf, { poi: small, legIndex: 1 }, JP));
  const pinnedLater = applyInsert(hotelFirst, THU, t3, AT);
  assert.deepEqual(dayOf(pinnedLater, THU).pinned.sequence[0], { poiId: noodle.id, insertedBy: 'engine', priority: 'breakfast' });
  assert.deepEqual(times(runB(pinnedLater).days[0].plan), times(t3));
  const restored = runB(clearBreakfast(pinnedLater, THU)).days[0].plan;
  assert.deepEqual(ids(restored), [noodle.id, ...ids(t3)]);
  assert.deepEqual([restored.meals.breakfast, restored.sequence[0].insertedBy, restored.sequence[0].dwellMin], [noodle.id, 'engine', 20]);
  // 早餐是他勾的站（指定的那一筆）：setBreakfast 把那筆勾選拿出 picks，順序裡那一筆跟著被跳過；改回來放回原位
  const chosen = { ...trip, days: trip.days.map((d) => (d.date === THU ? { ...d, picks: [...d.picks, { poiId: bakery.id, priority: 'want', breakfast: true }], pinned: pinOf(bakery.id, ...d.pinned.sequence.filter((e) => e.poiId !== noodle.id)) } : d)) };
  const pc = runB(chosen, [noodle, stand, bakery]).days[0].plan;
  assert.deepEqual([ids(pc)[0], pc.meals.breakfast, pc.sequence[0].breakfast, pc.sequence[0].optional], [bakery.id, bakery.id, true, true]);
  const offChosen = setBreakfast(chosen, THU, 'hotel', bakery.id, AT);
  assert.deepEqual(ids(runB(offChosen, [noodle, stand, bakery]).days[0].plan), ids(pc).slice(1));
  assert.deepEqual(ids(runB(clearBreakfast(offChosen, THU), [noodle, stand, bakery]).days[0].plan), ids(pc));
});

test('釘住的日子接受早餐推薦（按了「或 X」）、早餐換一家：原位置換掉，其餘各站先後不變；那天沒早餐就排在第一站；推薦在釘住的日子照樣掛得出來', () => {
  // 8/13 改天去（麵店）；8/14 釘住（引擎排的站內店在第一站、中間安插了小店）
  const base = runB(bfTrip());
  const t = insertTrial(trialArgs(base.days[1], { poi: small, legIndex: 2 }, JP));
  const trip = setBreakfast(applyInsert(bfTrip(), FRI, t, AT), THU, 'later', noodle.id, AT);
  const r = runB(trip);
  const fri = r.days[1].plan;
  assert.equal(fri.pinned, true);
  assert.deepEqual(ids(fri), [stand.id, A.id, small.id, B.id, lunch.id, eveDinner.id]);
  assert.deepEqual(fri.breakfastOffers.map((o) => [o.poiId, o.fromDate, o.mode, o.replaces, o.shiftMin]), [[noodle.id, THU, 'later', stand.id, 0]], '釘住的日子也掛推薦（照原位置換掉驗過）');
  // 按了：原位置換掉、變成他指定的早餐；8/13 記 movedTo；不再推薦
  const taken = takeBreakfastOffer(trip, FRI, noodle.id, fri, AT);
  assert.deepEqual(dayOf(taken, FRI).pinned.sequence.map((e) => e.poiId), [noodle.id, A.id, small.id, B.id, lunch.id, eveDinner.id]);
  assert.deepEqual(dayOf(taken, FRI).pinned.sequence[0], { poiId: noodle.id });
  assert.equal(dayOf(taken, THU).breakfast.movedTo, FRI);
  const r2 = runB(taken);
  const fri2 = r2.days[1].plan;
  assert.deepEqual(ids(fri2), [noodle.id, A.id, small.id, B.id, lunch.id, eveDinner.id]);
  assert.deepEqual(ids(fri2).slice(1), ids(fri).slice(1), '其餘各站先後不變');
  assert.deepEqual([fri2.meals.breakfast, fri2.sequence[0].breakfast, fri2.sequence[0].insertedBy, fri2.pinned], [noodle.id, true, null, true]);
  assert.deepEqual(fri2.breakfastOffers, []);
  assert.ok(!r2.days.some((x) => ids(x.plan).includes(stand.id)), '被換掉的那家不會自己跑去別天');
  // 早餐換一家（釘住的日子）：清單照原位置試、換了就在原位置
  const cands = breakfastSwapCandidates({ plan: fri, day: r.days[1].day, home, pool: [bakery, noodle, stand], legFn, rules, settings, country: JP, kb, exclude: [] });
  assert.ok(cands.some((c) => c.poi.id === bakery.id), `清單要有麵包店：${cands.map((c) => c.poi.id)}`);
  const swappedTrip = swapBreakfast(trip, FRI, bakery.id, fri, AT);
  assert.deepEqual(dayOf(swappedTrip, FRI).pinned.sequence[0], { poiId: bakery.id });
  assert.deepEqual(ids(runB(swappedTrip, [noodle, stand, bakery]).days[1].plan), [bakery.id, A.id, small.id, B.id, lunch.id, eveDinner.id]);
  // 那天沒早餐（順序裡沒有）、早上有空（第一站是 11:30 才開的午餐）：推薦掛得出來，按了就排在第一站
  const noBf = setBreakfast(tripOf([{ date: THU, picks: bfPicks }, { date: FRI, picks: bfPicks, pinned: pinOf(lunch.id, A.id, B.id, eveDinner.id) }]), THU, 'later', noodle.id, AT);
  const rn = runB(noBf);
  assert.deepEqual(rn.days[1].plan.breakfastOffers.map((o) => [o.poiId, o.replaces, o.shiftMin]), [[noodle.id, null, 0]]);
  const tn = takeBreakfastOffer(noBf, FRI, noodle.id, rn.days[1].plan, AT);
  assert.deepEqual(dayOf(tn, FRI).pinned.sequence.map((e) => e.poiId), [noodle.id, lunch.id, A.id, B.id, eveDinner.id]);
  const pn = runB(tn).days[1].plan;
  assert.deepEqual(ids(pn), [noodle.id, lunch.id, A.id, B.id, eveDinner.id]);
  assert.deepEqual(times(pn).slice(1), times(rn.days[1].plan), '其餘各站時刻不動');
  // 早上沒空的日子（09:05 就有站）：排成第一站後面每站都要晚超過 10 分，不推薦
  const busy = setBreakfast(tripOf([{ date: THU, picks: bfPicks }, { date: FRI, picks: bfPicks, pinned: pinOf(A.id, B.id, lunch.id, eveDinner.id) }]), THU, 'later', noodle.id, AT);
  assert.deepEqual(runB(busy).days[1].plan.breakfastOffers, []);
  // 早餐不是第一站的釘住日子（他在早餐前安插過一家）：推薦照「原位置換掉」驗——排成第一站的話小店要晚 25 分、掛不出來；原位置換掉一分不晚
  const frontTrial = insertTrial(trialArgs(base.days[1], { poi: small, legIndex: 0 }, JP));
  const frontTrip = setBreakfast(applyInsert(bfTrip(), FRI, frontTrial, AT), THU, 'later', noodle.id, AT);
  const rf = runB(frontTrip);
  assert.deepEqual(ids(rf.days[1].plan).slice(0, 2), [small.id, stand.id]);
  assert.deepEqual(rf.days[1].plan.breakfastOffers.map((o) => [o.poiId, o.replaces, o.shiftMin]), [[noodle.id, stand.id, 0]]);
  const takenFront = takeBreakfastOffer(frontTrip, FRI, noodle.id, rf.days[1].plan, AT);
  assert.deepEqual(ids(runB(takenFront).days[1].plan), ids(rf.days[1].plan).map((id) => (id === stand.id ? noodle.id : id)), '換在第二站的原位置');
  // 同一天早餐換一家的清單也照原位置試：換成麵包店一分不晚（排成第一站的話小店要晚 25 分）
  const frontCands = breakfastSwapCandidates({ plan: rf.days[1].plan, day: rf.days[1].day, home, pool: [bakery, noodle, stand], legFn, rules, settings, country: JP, kb, exclude: [] });
  assert.deepEqual(frontCands.filter((c) => c.poi.id === bakery.id).map((c) => c.shiftMin), [0]);
  // tryBreakfastAt：位置不是第一站也試得了（早餐前安插過一站）；收工線用原時窗
  const day = r.days[1].day;
  const seq = fri.sequence.filter((s) => s.poi.id !== stand.id);
  const at1 = tryBreakfastAt({ sequence: [fri.sequence[2], ...seq.filter((s) => s.poi.id !== small.id)], index: 1, stop: breakfastStop(noodle, settings, { poiId: noodle.id, priority: 'want' }), day, home, legFn, rules, settings, country: JP, kb });
  assert.equal(at1.ok, true);
  assert.equal(at1.trial[1].poi.id, noodle.id);
  assert.deepEqual([at1.displaced, at1.shrunk], [[], []]);
  assert.equal(tryBreakfastAt({ sequence: seq, index: 0, stop: breakfastStop(mk('沒時間', { hours: null }), settings), day, home, legFn, rules, settings, country: JP, kb }).why, 'hours-unknown');
  assert.equal(breakfastOfPlan(fri).poi.id, stand.id);
});

// ── 11-12 審查後補的（修正段）──

test('升級成站（釘住）不動到別天（原話 #192；11-12 審查）：釘住的日子記著的引擎站、升級進來的那筆勾選，在別天都是挑好引擎插站的名單之後才拿掉——名單的組成不變，那天搜出來的行程也就不變', () => {
  // 兩天都有一段等開門的空檔（午後才開的站）；填站的名單只取最近的 1 家（fillPoolMax 1），池的先後是 [藥妝, 小吃店]。
  // 藥妝是購物類：非購物日排進去要罰、引擎不會填它；小吃店填得進去。
  const s1 = { ...settings, fillPoolMax: 1 };
  const X = mk('午後才開', { hours: daily('13:00', '23:00') }); const Y = mk('午後才開二', { hours: daily('13:00', '23:00') });
  const drug = shop('藥妝', { category: 'drugstore' }); const snack = food('小吃店');
  const world = [A, B, X, Y, drug, snack];
  const plan = (trip, pool) => planTrip({ trip, pois: poisOf(world), rules, settings: s1, country: COUNTRY, kb, legFn, restPool: pool });
  // (1) 釘住的日子記著的引擎站：FRI 是購物日，引擎把藥妝填進 FRI 的空檔；THU 的名單是 [藥妝]（不填）
  const trip = { ...tripOf([{ date: THU, picks: want(A.id, X.id) }, { date: FRI, picks: want(B.id, Y.id) }]), shoppingDays: [FRI] };
  const base = plan(trip, [drug, snack]);
  assert.deepEqual(ids(base.days[0].plan), [A.id, X.id], 'THU：名單只有藥妝（非購物日不填），空檔沒填');
  assert.deepEqual(base.days[1].plan.sequence.map((s) => [s.poi.id, s.insertedBy]), [[B.id, null], [drug.id, 'engine'], [Y.id, null]], 'FRI：藥妝填進空檔');
  const pinnedFri = { ...trip, days: trip.days.map((d) => (d.date === FRI ? { ...d, pinned: { at: AT, sequence: pinEntriesOf(base.days[1].plan.sequence, FRI) } } : d)) };
  assert.deepEqual([...pinnedEngineIds(pinnedFri)], [drug.id]);
  const after = plan(pinnedFri, [drug, snack]);
  assert.deepEqual(times(after.days[1].plan), times(base.days[1].plan), 'FRI 照原順序釘住＝沒釘住');
  assert.deepEqual(times(after.days[0].plan), times(base.days[0].plan), 'THU 不變：藥妝一開始就扣掉的話，名單會遞補成 [小吃店]、THU 就多一站');
  assert.equal(after.days[0].plan.score, base.days[0].plan.score);
  // 藥妝照樣不會被排到 THU（它是 FRI 的）：把 THU 也設成購物日，名單 [藥妝] 挑好之後拿掉，THU 還是不填
  const bothShop = plan({ ...pinnedFri, shoppingDays: [THU, FRI] }, [drug, snack]);
  assert.ok(!ids(bothShop.days[0].plan).includes(drug.id), '釘住的日子記著的引擎站，前面的日子不能先插走');
  // 釘住的日子上拒絕那個引擎站（畫面的「不去了」記 removed、帶 via insert；安插的選項裡選「不去」同一個記號）：THU 照樣不變、FRI 少那一站；沒帶記號就是一開始扣掉、THU 的名單遞補一家
  const rejectOn = (via) => ({ ...pinnedFri, days: pinnedFri.days.map((d) => (d.date === FRI ? { ...d, removed: [{ poiId: drug.id, at: AT, insertedBy: 'engine', priority: 'filler', ...(via ? { via } : {}) }] } : d)) });
  const rejected = plan(rejectOn('insert'), [drug, snack]);
  assert.deepEqual([times(rejected.days[0].plan), ids(rejected.days[1].plan)], [times(base.days[0].plan), [B.id, Y.id]]);
  assert.deepEqual([...insertDroppedEngine(rejectOn('insert'))], [[FRI, [drug.id]]]);
  assert.ok(ids(plan(rejectOn(null), [drug, snack]).days[0].plan).includes(snack.id), '沒帶記號時 THU 會變（對照）');
  // 釘住的那天之後的日子照舊算「前幾天插過的」（一開始就扣掉）：SAT 的名單遞補成 [小吃店]
  const three = { ...pinnedFri, days: [...pinnedFri.days, { type: 'normal', date: SAT, picks: want(C.id, mk('午後才開三', { hours: daily('13:00', '23:00') }).id) }] };
  const Z3 = mk('午後才開三', { hours: daily('13:00', '23:00') });
  const sat = planTrip({ trip: three, pois: poisOf([...world, C, Z3]), rules, settings: s1, country: COUNTRY, kb, legFn, restPool: [drug, snack] }).days[2].plan;
  assert.deepEqual(sat.sequence.filter((s) => s.insertedBy).map((s) => s.poi.id), [snack.id]);

  // (2) 升級進來的那筆勾選：FRI 沒有空檔；藥妝在 FRI 的走廊清單上，他把它升級成站
  const trip2 = { ...tripOf([{ date: THU, picks: want(A.id, X.id) }, { date: FRI, picks: want(B.id) }]), shoppingDays: [] };
  const base2 = plan(trip2, [drug, snack]);
  assert.deepEqual(ids(base2.days[0].plan), [A.id, X.id]);
  assert.ok(base2.days[1].plan.corridor.some((c) => c.pois.some((x) => x.poi.id === drug.id)), 'FRI 的走廊清單上有藥妝');
  const t = insertTrial({ plan: base2.days[1].plan, day: base2.days[1].day, home, poi: drug, legIndex: 0, legFn, rules, settings: s1, country: COUNTRY, kb });
  assert.equal(t.fits, true);
  const up = applyInsert(trip2, FRI, t, AT);
  assert.deepEqual(dayOf(up, FRI).picks.at(-1), { poiId: drug.id, priority: 'want', via: 'corridor' });
  const after2 = plan(up, [drug, snack]);
  assert.ok(ids(after2.days[1].plan).includes(drug.id));
  assert.deepEqual(times(after2.days[0].plan), times(base2.days[0].plan), 'THU 不變');
  // 對照：那筆勾選沒有記號（一般的勾選）就是一開始扣掉——THU 的名單遞補成 [小吃店]，THU 多一站。這是記號要擋的事
  const plain = { ...up, days: up.days.map((d) => ({ ...d, picks: d.picks.map(({ via: _via, ...p }) => p) })) };
  assert.ok(ids(plan(plain, [drug, snack]).days[0].plan).includes(snack.id), '沒有記號時 THU 會變（對照）');
  // 解除釘住之後記號還在，THU 照樣不變；走廊清單、二選一照舊不列它（那些看的是「任何一天勾過的」全部）
  const free = plan(unpinDay(up, FRI), [drug, snack]);
  assert.deepEqual(times(free.days[0].plan), times(base2.days[0].plan));
  assert.ok(!free.days[0].plan.corridor.some((c) => c.pois.some((x) => x.poi.id === drug.id)), '已經是 FRI 的站：THU 的走廊清單不列');
  // 之後對升級進來的那一站按「不去了」：removed 那一筆沿用記號（ui/app.js removeStop 帶過去），THU 照樣不變；不沿用的話它變成一開始就扣掉、THU 的名單又遞補一家
  const removedWith = (via) => ({ ...up, days: up.days.map((d) => (d.date === FRI ? { ...d, picks: d.picks.filter((p) => p.poiId !== drug.id), removed: [{ poiId: drug.id, at: AT, priority: 'want', ...(via ? { via } : {}) }] } : d)) });
  assert.deepEqual(times(plan(removedWith('corridor'), [drug, snack]).days[0].plan), times(base2.days[0].plan));
  assert.deepEqual([...corridorPickIds(removedWith('corridor'))], [drug.id]);
  assert.ok(ids(plan(removedWith(null), [drug, snack]).days[0].plan).includes(snack.id), '沒帶記號時 THU 會變（對照）');
  // 換一家換進來的店沿用記號（applySwap 把那筆勾選整筆帶過去）
  const drug2 = shop('藥妝二', { category: 'drugstore' });
  assert.equal(applySwap(dayOf(up, FRI), drug.id, drug2).picks.at(-1).via, 'corridor');
});

test('營業分兩段的店（11-12 審查）：記的時候排在晚上那一段，前面的站拿掉之後提早到、下午那一段待不完——等到晚上那一段開門，不是整站排不進；原本就待得完就照常', () => {
  const twoSlots = (o1, c1, o2, c2) => Object.fromEntries(DAYS.map((k) => [k, [[o1, c1], [o2, c2]]]));
  const split = shop('兩段店', { dwellMin: 55, hours: twoSlots('11:30', '17:00', '17:30', '21:00') });
  const long = mk('久待區', { dwellMin: 100 }); const quick = shop('順便店', { dwellMin: 30 });
  const world = [A, lunch, mid, long, quick, split, bar];
  const order = [A.id, lunch.id, mid.id, long.id, quick.id, split.id, bar.id];
  // 照這個順序排：A 09:05 → 午餐 11:30 → 中店 12:35–14:35 → 久待區 14:40–16:20 → 順便店 16:25–16:55 → 兩段店 17:00 到（下午那段剛關）→ 17:30 進去
  const loose = tripOf([{ date: THU, picks: want(...order), pinned: pinOf(...order) }]);
  const p0 = run(loose, world).days[0].plan;
  assert.deepEqual(times(p0).slice(-3), ['順便店@985-1015', '兩段店@1050-1105', '酒吧@1200-1350']);
  assert.deepEqual([slotOpenOf(p0.sequence[5], THU), slotOpenOf(p0.sequence[1], THU), slotOpenOf({ poi: split, startMin: 600, endMin: 655 }, THU), slotOpenOf({ poi: mk('沒時段', { hours: null }), startMin: 600, endMin: 660 }, THU)], [1050, 690, null, null]);
  // 記進 pinned：排在第二段的那一站多記 slotOpenMin（那一段的開門時刻）；排在第一段（或只有一段）的不記
  const entries = pinEntriesOf(p0.sequence, THU);
  assert.deepEqual(entries.map((e) => e.slotOpenMin), [undefined, undefined, undefined, undefined, undefined, 1050, undefined]);
  const trip = tripOf([{ date: THU, picks: want(...order), pinned: { at: AT, sequence: entries } }]);
  assert.deepEqual(times(run(trip, world).days[0].plan), times(p0));
  // 不去了 順便店：兩段店 16:25 就到、待到 17:20 會超過 17:00 → 等到 17:30（原本那一段），後面的酒吧不動；多一句等開門的黃字
  const p1 = run(withoutPick(trip, THU, quick.id), world).days[0].plan;
  assert.deepEqual(ids(p1), order.filter((id) => id !== quick.id));
  assert.deepEqual(times(p1).slice(-2), ['兩段店@1050-1105', '酒吧@1200-1350']);
  assert.deepEqual([p1.dropped, p1.sequence.at(-2).waitMin], [[], 65]);
  assert.ok(p1.warnings.some((w) => w.ruleId === 'wait-at-door' && w.poiId === split.id));
  // 不去了 中店（提早兩個多小時）：14:55 到、下午那一段待得完 → 照常 14:55 進去，不會傻等到晚上
  const p2 = run(withoutPick(trip, THU, mid.id), world).days[0].plan;
  assert.deepEqual(times(p2).find((x) => x.startsWith('兩段店')), '兩段店@895-950');
  // 沒記 slotOpenMin 的舊資料（或記的時候就在第一段）：照舊——待不完就排不進，理由是營業時間那一句
  const p3 = run(withoutPick(loose, THU, quick.id), world).days[0].plan;
  assert.deepEqual(p3.dropped.map((x) => x.poi.id), [split.id]);
  assert.match(p3.dropped[0].reason, /^兩段店 待到 17:20，超過 17:00 關門/);
  // 排程那一層：placeStop 只在「這一段待不完、而且有不晚於 slotOpenMin 的下一段待得完」時才等
  const at = (prevEndMin, slotOpenMin, dwellMin = 55) => placeStop({ prevEndMin, leg: { walkMin: 5 }, poi: split, dwellMin, date: THU, slotOpenMin });
  assert.deepEqual([at(980, 1050).startMin, at(980, 1050).waitMin], [1050, 65]);
  assert.equal(at(980, null).startMin, 985, '不給：照舊排在到的時候（硬規則 hours 會擋）');
  assert.equal(at(980, 690).startMin, 985, '原本就在第一段：不會被推到晚上那一段');
  assert.equal(at(895, 1050).startMin, 900, '這一段待得完就照常');
  assert.equal(at(980, 1050, 240).startMin, 985, '晚上那一段也待不完：不等（照舊撞硬規則）');
  // 安插試算：原本的每一站帶著現在所在的那一段——選項裡「不去」讓後面提早時同樣等到原本那一段；被往後推的不會自己跳到更晚的一段
  const d0 = run(trip, world).days[0];
  const blocked = insertTrial(trialArgs(d0, { poi: big, legIndex: 6 }));   // 酒吧前插 240 分的店：排不下
  assert.equal(blocked.fits, false);
  const dropQuick = blocked.options.find((o) => o.kind === 'drop' && o.poiId === quick.id);
  if (dropQuick) assert.equal(dropQuick.result.sequence.find((s) => s.poi.id === split.id).startMin, 1050, '選項試算裡兩段店一樣等到 17:30');
});

test('釘住的日子重排完把畫面上那一條記回旅程檔（repinTrip；11-12 審查）：按了別站「不去了」才排進來的站記下位置，下一個動作它不會自己換位置；已經記著的沿用原本那一筆；不去了的舊筆清掉', () => {
  const ca = cafe('咖啡甲'); const cb = cafe('咖啡乙'); const cd = cafe('咖啡丁');
  const eveDinner = { ...dinner, hours: daily('16:30', '22:00') };
  const world = [A, lunch, eveDinner, ca, cb, cd, small];
  const trip = tripOf([{ date: THU, picks: want(A.id, ca.id, lunch.id, cb.id, eveDinner.id, cd.id) }]);
  const base = run(trip, world).days[0];
  assert.deepEqual(base.plan.dropped.map((x) => x.poi.id), [cd.id], '第三家咖啡廳排不進');
  const pinnedTrip = applyInsert(trip, THU, insertTrial(trialArgs(base, { poi: small, legIndex: 1 })), AT);
  const r1 = run(pinnedTrip, world);
  assert.equal(repinTrip(pinnedTrip, r1.days), pinnedTrip, '剛釘住：畫面上那一條就是記著的，沒有東西要記');
  // 不去咖啡甲 → 咖啡丁排得進來了；重排完記回去：順序裡多了咖啡丁那一筆、咖啡甲那一筆清掉、其餘各筆是原本的物件
  const gone = withoutPick(pinnedTrip, THU, ca.id);
  const r2 = run(gone, world);
  const p2 = r2.days[0].plan;
  assert.ok(ids(p2).includes(cd.id));
  const kept = repinTrip(gone, r2.days);
  assert.notEqual(kept, gone);
  const seq = dayOf(kept, THU).pinned.sequence;
  assert.deepEqual(seq.map((e) => e.poiId), ids(p2), '順序＝畫面上那一條');
  assert.ok(!seq.some((e) => e.poiId === ca.id));
  assert.deepEqual(seq.find((e) => e.poiId === cd.id), { poiId: cd.id, dwellMin: 60 });
  assert.equal(dayOf(kept, THU).pinned.at, AT, '釘住的時刻不動');
  assert.deepEqual(dayOf(gone, THU).pinned, dayOf(pinnedTrip, THU).pinned, '不改傳入的');
  // 記了之後再排一次結果相同；再按一個「不去了」：咖啡丁跟其餘各站的先後不變
  const r3 = run(kept, world);
  assert.deepEqual(times(r3.days[0].plan), times(p2));
  assert.equal(repinTrip(kept, r3.days), kept);
  const p4 = run(withoutPick(kept, THU, A.id), world).days[0].plan;
  assert.deepEqual(ids(p4), ids(p2).filter((id) => id !== A.id));
  // 落到排不進清單的勾選站不記（之後每次重排都當順序以外的站再試）；沒釘住的日子、沒排的日子（plan null）跳過
  const full = tripOf([{ date: THU, picks: want(A.id, ca.id, cb.id, cd.id), pinned: pinOf(A.id, ca.id, cb.id, cd.id) }, { date: FRI, picks: want(lunch.id) }]);
  const rf = run(full, world);
  assert.deepEqual(rf.days[0].plan.dropped.map((x) => x.poi.id), [cd.id]);
  assert.deepEqual(dayOf(repinTrip(full, rf.days), THU).pinned.sequence.map((e) => e.poiId), [A.id, ca.id, cb.id]);
  assert.equal(dayOf(repinTrip(full, rf.days), FRI).pinned, undefined);
  assert.equal(repinTrip(full, [{ date: THU, plan: null }, null]), full);
  assert.equal(repinTrip(full, undefined), full);
});

test('釘住的日子按「換一家」先試算（pinnedSwapCheck；11-12 審查）：每一家真的換過去排一次——會害別的站不見或排不進的不列；沒釘住的日子不試', () => {
  const D = mk('街區D', { dwellMin: 45 }); const slow = mk('逛很久', { dwellMin: 300 });
  const world = [...W1, D, slow];
  const trip = trip1();   // 釘住：A → C → 午餐 11:30（14:30 關）→ 晚餐 → B → 酒吧
  const d = run(trip, world).days[0];
  const planArgs = { rules, settings, country: COUNTRY, kb, legFn, restPool: [] };
  const check = pinnedSwapCheck({ trip, date: THU, fromPoiId: C.id, plan: d.plan, pois: poisOf(world), planArgs });
  assert.equal(check(D), true, '停 45 分：原位置換掉，其餘不動');
  assert.equal(check(slow), false, '停 300 分：午餐會超過關門、落到排不進');
  assert.equal(check(null), false);
  const pool = [D, slow].map((poi) => ({ poi }));
  const args = { plan: d.plan, stopId: C.id, pool, legFn, date: THU, settings };
  assert.deepEqual(swapCandidates(args).map((c) => c.poi.id), [D.id, slow.id], '不試算：兩家都列（之前的行為）');
  assert.deepEqual(swapCandidates({ ...args, check }).map((c) => c.poi.id), [D.id], '試算過：只列換了不出事的');
  // 換過去真的就是試算說的那樣
  const after = run({ ...trip, days: [applySwap(dayOf(trip, THU), C.id, D)] }, world).days[0].plan;
  assert.deepEqual(ids(after), ORDER1.map((id) => (id === C.id ? D.id : id)));
  // 引擎站會被讓掉的也不列：酒吧前有一個引擎填的站，換進停比較久的店會讓它整站不見
  const fill = shop('填空店', { dwellMin: 60 }); const longer = mk('街區長', { dwellMin: 200 });
  const withFill = tripOf([{ date: THU, picks: want(...ORDER1), pinned: pinOf(A.id, C.id, lunch.id, dinner.id, B.id, { poiId: fill.id, dwellMin: 20, insertedBy: 'engine', priority: 'onway' }, bar.id) }]);
  const w2 = [...world, fill, longer];
  const d2 = run(withFill, w2, { pool: [fill] }).days[0];
  assert.deepEqual(ids(d2.plan), [A.id, C.id, lunch.id, dinner.id, B.id, fill.id, bar.id]);
  const check2 = pinnedSwapCheck({ trip: withFill, date: THU, fromPoiId: B.id, plan: d2.plan, pois: poisOf(w2), planArgs: { ...planArgs, restPool: [fill] } });
  assert.equal(check2(longer), false, 'B 換成停 200 分的：引擎那一站被讓掉');
  assert.equal(check2(D), true);
  // 沒釘住的日子：永遠 true（換了本來就整天重排）
  const freeTrip = tripOf([{ date: THU, picks: want(...ORDER1) }]);
  const fd = run(freeTrip, world).days[0];
  assert.equal(pinnedSwapCheck({ trip: freeTrip, date: THU, fromPoiId: C.id, plan: fd.plan, pois: poisOf(world), planArgs })(slow), true);
});

test('小修（11-12 審查）：接手的那一家自己在順序裡有一筆就不搬；順延進來的站不看分數那道門；輪數照草稿記的走、不拿調整的個數算', () => {
  // 之前把 S 換成 T，後來又把 S 升級回同一天（順序 S、A、T、B），再對 S 按不去了：T 留在自己的位置，不會被搬到 S 的位置
  const S = mk('街區S'); const T = mk('街區T');
  const world = [...W1, S, T];
  const day = { date: THU, picks: want(A.id, T.id, B.id), removed: [{ poiId: S.id, at: AT }], swapped: [{ from: S.id, to: T.id, at: AT }], pinned: pinOf(S.id, A.id, T.id, B.id) };
  assert.deepEqual(ids(run(tripOf([day]), world).days[0].plan), [A.id, T.id, B.id]);
  // 對照：T 自己沒有一筆（換了之後 pinned 沒被改寫）時，照舊接在 S 的位置
  assert.deepEqual(ids(run(tripOf([{ ...day, pinned: pinOf(S.id, A.id, B.id) }]), world).days[0].plan), [T.id, A.id, B.id]);

  // 順延進來的站（picks[].deferredFrom）：排得下就插，不看「整天分數要變好」——非購物日的藥妝店一般的勾選不會自己排進來，順延來的會
  const drug = shop('藥妝店', { category: 'drugstore', dwellMin: 30 });
  const fourDays = (pick) => tripOf([{ date: THU, picks: [...want(...ORDER1), pick], pinned: pinOf(...ORDER1) }, { date: FRI, picks: [] }, { date: SAT, picks: [] }, { date: SUN, picks: [] }]);
  const own = run(fourDays({ poiId: drug.id, priority: 'maybe' }), [...W1, drug]).days[0].plan;
  assert.deepEqual([ids(own), own.dropped.map((x) => x.reason)], [ORDER1, ['排得進，但排進去整天的分數反而低']]);
  const deferred = run(fourDays({ poiId: drug.id, priority: 'maybe', deferredFrom: FRI }), [...W1, drug]).days[0].plan;
  assert.ok(ids(deferred).includes(drug.id), `順延來的排進去了：${ids(deferred).join('→')}`);
  assert.deepEqual([ids(deferred).filter((id) => id !== drug.id), deferred.dropped], [ORDER1, []]);
  assert.ok(deferred.score < own.score + 45, '分數沒有變好也照排');
  // 留白那道門照舊：要用到留白才排得進的順延站不排
  const tight = tripOf([{ date: THU, type: 'arrival', arriveMin: hm(16), picks: [...want(dinner.id, B.id, bar.id), { poiId: mid.id, priority: 'want', deferredFrom: FRI }], pinned: pinOf(dinner.id, B.id, bar.id) }]);
  assert.deepEqual(run(tight, W1).days[0].plan.dropped.map((x) => x.reason), ['照你調過的順序，要用到今天的留白才排得進，先不排']);

  // 輪數：第 1 輪的選項記「選了之後是第 2 輪」；拿它當草稿再算就是第 2 輪；第 2 輪改選「不去同一站」（調整還是一筆）→ 第 3 輪
  const d = day1();
  const args = trialArgs(d, { poi: big, legIndex: 0 });
  const first = insertTrial(args);
  assert.deepEqual([first.fits, first.round], [false, 1]);
  const shortenA = first.options.find((o) => o.kind === 'shorten' && o.poiId === A.id && !o.fits) ?? assert.fail(`第 1 輪要有「街區A 少待」而且還排不下：${first.options.map((o) => `${o.kind}:${o.poiId}:${o.fits}`).join('、')}`);
  assert.equal(shortenA.result.round, 2);
  const second = insertTrial({ ...args, draft: shortenA });
  assert.deepEqual([second.round, second.adjust.length], [2, 1]);
  const dropA = second.options.find((o) => o.kind === 'drop' && o.poiId === A.id) ?? assert.fail('第 2 輪要有「不去 街區A」');
  assert.deepEqual([dropA.result.round, dropA.result.adjust.length], [3, 1], '不去 A 蓋掉 A 少待：調整一筆，輪數照樣往前');
  const third = insertTrial({ ...args, draft: dropA });
  assert.deepEqual([third.round, third.adjust.length], [3, 1]);
  assert.equal(insertTrial({ ...args, draft: { adjust: shortenA.result.adjust } }).round, 2, '草稿沒記輪數（舊形狀）：退回調整的個數＋1');
});
