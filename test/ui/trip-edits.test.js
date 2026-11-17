// 規劃頁的改動存在手機（T16b；原話 #154、#121、#171）：快照存整天的 picks／removed／swapped（11-06 第二批起另帶釘住的順序 pinned、早餐不排的紀錄 breakfast）與 deferred，過 JSON 再蓋回同一份、引擎排出一樣的序列；
// 打包時間或旅程不同就丟掉（規劃頁頂端那句在 app.js，這裡只驗 dropped 與那句存在）；跟打包那版比哪幾天有改、還原成打包版；
// 跟現場改案（field.applied）各存各的：規劃頁改了那天的 applied 由呼叫端清掉（withoutApplied 照舊），別天的改案重載後照還原。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planTrip, resolveHome } from '../../src/engine/trip.js';
import { applySwap } from '../../src/engine/swap.js';
import { insertTrial, applyInsert } from '../../src/engine/insert.js';
import { setBreakfast } from '../../src/engine/breakfast.js';
import { snapshotTripEdits, applyTripEdits, overlayTripEdits, diffTripEdits, validTripEdits } from '../../src/ui/trip-edits.js';
import { snapshotPlan, restoreApplied, withoutApplied } from '../../src/ui/applied.js';
import { TEXT } from '../../src/ui/text.js';
import { loadRules } from '../../src/rules/index.js';
import { BUILTIN } from '../../src/rules/builtin.js';
import rulesJson from '../../src/rules.json' with { type: 'json' };
import { POIS, KB, COUNTRY, legFn, demoTrip } from '../sendai/fixture.js';

const rules = loadRules(BUILTIN, rulesJson.rules);
const settings = rulesJson.settings;
const pois = Object.fromEntries(Object.values(POIS).map((p) => [p.id, p]));
const ctx = { rules, settings, country: COUNTRY, kb: KB, legFn };
const D13 = '2026-08-13'; const D17 = '2026-08-17';
const plansOf = (trip) => Object.fromEntries(planTrip({ trip, pois, restPool: Object.values(pois), ...ctx }).days.map((d) => [d.date, d]));
const ids = (seq) => seq.map((s) => s.poi.id);
const clone = (v) => JSON.parse(JSON.stringify(v));
const dayOf = (trip, date) => trip.days.find((d) => d.date === date);

/** 照 app.js 的動作改一份示範旅程：8/13「不去了」汐谷（picks 拿掉、removed 記一筆）；8/17「換一家」松本清 → 阿武隈書房（applySwap 記 swapped）；一筆順延紀錄（別天排不進的那種）。 */
function editedDemo() {
  const trip = demoTrip();
  const removedId = POIS['汐谷'].id;
  const d13 = dayOf(trip, D13);
  d13.picks = d13.picks.filter((p) => p.poiId !== removedId);
  d13.removed = [...(d13.removed ?? []), { poiId: removedId, at: '2026-08-13T10:00:00.000Z' }];
  const d17 = dayOf(trip, D17);
  Object.assign(d17, applySwap(d17, POIS['松本清'].id, POIS['阿武隈書房']));
  trip.deferred = [{ poiId: POIS.SQUAT.id, chosenPoiId: null, fromDate: D17, toDate: null, status: 'unplaced', at: '2026-08-13T10:01:00.000Z' }];
  return { trip, removedId };
}

test('快照：整天的 picks／removed／swapped 與 deferred，過 JSON 再蓋回同一份（別的欄位照打包檔）、引擎對蓋回的旅程排出一樣的序列；不改傳入的', () => {
  const { trip: edited, removedId } = editedDemo();
  const snap = clone(snapshotTripEdits(edited, 'p1'));
  assert.equal(snap.packAt, 'p1');
  assert.equal(snap.tripId, edited.id);
  assert.deepEqual(Object.keys(snap.days), [D13, D17]);
  assert.deepEqual(Object.keys(snap.days[D13]).sort(), ['breakfast', 'engineBreakfast', 'picks', 'pinned', 'removed', 'swapped'], '一天存三個陣列＋釘住的順序＋早餐不排的紀錄（11-06 第二批加的）＋引擎的備忘（上一版引擎挑的早餐，11-12 加的）');
  assert.deepEqual([snap.days[D13].pinned, snap.days[D13].breakfast, snap.days[D13].engineBreakfast], [null, null, null], '沒有就存 null');
  assert.deepEqual(snap.days[D13].picks, dayOf(edited, D13).picks);
  assert.deepEqual(snap.days[D13].removed, dayOf(edited, D13).removed);
  assert.deepEqual(snap.days[D17].swapped, dayOf(edited, D17).swapped);
  assert.deepEqual(snap.days[D17].removed, [], '沒有的陣列存空的');
  assert.deepEqual(snap.deferred, edited.deferred);
  const fresh = demoTrip();
  const r = applyTripEdits(fresh, snap, 'p1');
  assert.equal(r.dropped, false);
  assert.notEqual(r.trip, fresh);
  const three = (d) => clone({ picks: d.picks ?? [], removed: d.removed ?? [], swapped: d.swapped ?? [] });
  for (const date of [D13, D17]) {
    assert.deepEqual(three(dayOf(r.trip, date)), three(dayOf(edited, date)), `${date} 三個陣列蓋回`);
    assert.equal(dayOf(r.trip, date).anchor, dayOf(fresh, date).anchor, '別的欄位照打包檔');
    assert.deepEqual(dayOf(r.trip, date).designated, dayOf(fresh, date).designated);
  }
  assert.deepEqual(r.trip.deferred, edited.deferred);
  assert.deepEqual(clone(fresh), clone(demoTrip()), '傳進來的 trip 沒被改');
  // 引擎：蓋回的跟當場改的排出一樣的序列；8/13 沒有不去了的那站（removed 也擋引擎插回來）、8/17 是換過的
  const a = plansOf(edited); const b = plansOf(r.trip);
  for (const date of [D13, D17]) assert.deepEqual(ids(b[date].plan.sequence), ids(a[date].plan.sequence), date);
  assert.ok(ids(plansOf(demoTrip())[D13].plan.sequence).includes(removedId), '示範 8/13 本來有汐谷');
  assert.ok(!ids(b[D13].plan.sequence).includes(removedId));
  assert.ok(!ids(b[D17].plan.sequence).includes(POIS['松本清'].id));
});

test('載入對照：packAt 或 tripId 不同（手機更新了新打包、換了旅程）就丟掉、trip 原封；沒有快照也原封；null 對 null 算相同；日期不在這趟的跳過、快照沒有的那天不動；丟掉那句有字', () => {
  const { trip: edited } = editedDemo();
  const fresh = demoTrip();
  const snap = clone(snapshotTripEdits(edited, 'p1'));
  const r1 = applyTripEdits(fresh, snap, 'p2');
  assert.equal(r1.dropped, true);
  assert.equal(r1.trip, fresh);
  assert.equal(applyTripEdits({ ...fresh, id: 'other-trip' }, snap, 'p1').dropped, true, '換了旅程也丟');
  assert.deepEqual(applyTripEdits(fresh, null, 'p1'), { trip: fresh, dropped: false });
  assert.deepEqual(applyTripEdits(fresh, undefined, 'p1'), { trip: fresh, dropped: false });
  assert.deepEqual(applyTripEdits(fresh, 'junk', 'p1'), { trip: fresh, dropped: true }, '不是物件的鍵當壞掉：丟掉（呼叫端刪鍵）');
  const demoSnap = clone(snapshotTripEdits(edited, null));
  assert.equal(applyTripEdits(fresh, demoSnap).dropped, false, '示範旅程沒有打包：null 對 null');
  assert.equal(applyTripEdits(fresh, demoSnap, null).dropped, false);
  assert.equal(applyTripEdits(fresh, demoSnap, 'p1').dropped, true);
  const partial = { ...snap, days: { [D13]: snap.days[D13], '2025-01-01': snap.days[D17] } };
  const r3 = applyTripEdits(fresh, partial, 'p1');
  assert.equal(r3.dropped, false);
  assert.deepEqual(r3.trip.days.map((d) => d.date), [D13, D17], '不在這趟的日期不會多出來');
  assert.equal(dayOf(r3.trip, D17), dayOf(fresh, D17), '快照沒有的那天原物件');
  assert.deepEqual(dayOf(r3.trip, D13).picks, snap.days[D13].picks);
  // 丟掉時規劃頁頂端那句（app.js state.notice）
  assert.match(TEXT.tripEdits.dropped, /旅程更新過了/);
  assert.doesNotMatch(TEXT.tripEdits.dropped, /packAt|tripId|undefined/);
});

test('形狀壞掉的鍵（手改或別版本寫的）不會把 App 弄到開不起來：days／deferred／三個陣列型別不對的整份當丟掉；陣列裡的 null 靜靜濾掉（10-16 審查）', () => {
  const fresh = demoTrip();
  const ok = clone(snapshotTripEdits(editedDemo().trip, 'p1'));
  assert.equal(validTripEdits(ok), true);
  for (const bad of [
    { ...ok, days: { [D13]: { picks: 5 } } },
    { ...ok, days: { [D13]: { removed: 'x' } } },
    { ...ok, days: { [D13]: [1, 2] } },
    { ...ok, days: [1] },
    { ...ok, days: 'junk' },
    { ...ok, deferred: 'x' },
    { ...ok, deferred: {} },
    [], 'junk', 1,
  ]) {
    assert.equal(validTripEdits(bad), false, JSON.stringify(bad).slice(0, 60));
    const r = applyTripEdits(fresh, bad, 'p1');
    assert.equal(r.dropped, true); assert.equal(r.trip, fresh);
  }
  // days 缺、deferred 缺都算合法（舊版鍵）；陣列裡的 null 與非物件濾掉、其餘照蓋
  assert.equal(validTripEdits({ packAt: 'p1', tripId: fresh.id }), true);
  const withNull = { ...ok, days: { [D13]: { picks: [null, ...ok.days[D13].picks, 7], removed: ok.days[D13].removed, swapped: [] } }, deferred: [null, ...ok.deferred] };
  const r = applyTripEdits(fresh, withNull, 'p1');
  assert.equal(r.dropped, false);
  assert.deepEqual(dayOf(r.trip, D13).picks, ok.days[D13].picks);
  assert.deepEqual(r.trip.deferred, ok.deferred);
  assert.doesNotThrow(() => plansOf(r.trip), '蓋回後引擎排得動');
});

test('diffTripEdits：跟打包那版比——沒改 any false；不去了那天算有改、復原回去就不算（app.js 這時刪鍵）；只有順延紀錄 dates 空；鍵的順序不算差異；overlayTripEdits 蓋回打包那版＝還原', () => {
  const base = clone(snapshotTripEdits(demoTrip(), 'p1'));
  assert.deepEqual(diffTripEdits(demoTrip(), base), { dates: [], deferredChanged: false, any: false });
  const trip = demoTrip();
  const d13 = dayOf(trip, D13);
  const pick = d13.picks.find((p) => p.poiId === POIS['汐谷'].id); const idx = d13.picks.indexOf(pick);
  const entry = { poiId: pick.poiId, at: '2026-08-13T10:00:00.000Z' };
  d13.picks = d13.picks.filter((p) => p !== pick); d13.removed = [entry];
  assert.deepEqual(diffTripEdits(trip, base), { dates: [D13], deferredChanged: false, any: true });
  // 復原（undoLast 的做法：removed 那筆拿掉、勾選放回原位）
  d13.removed = d13.removed.filter((r) => r !== entry);
  const picks = [...d13.picks]; picks.splice(idx, 0, pick); d13.picks = picks;
  assert.equal(diffTripEdits(trip, base).any, false);
  trip.deferred = [{ poiId: POIS.SQUAT.id, chosenPoiId: null, fromDate: D17, toDate: null, status: 'unplaced', at: 'x' }];
  assert.deepEqual(diffTripEdits(trip, base), { dates: [], deferredChanged: true, any: true });
  trip.deferred = [];
  assert.equal(diffTripEdits(trip, base).any, false, '空陣列跟沒有一樣');
  d13.picks = d13.picks.map((p) => ({ priority: p.priority, poiId: p.poiId, fixedWindow: undefined }));
  assert.equal(diffTripEdits(trip, base).any, false, '鍵的順序與 undefined 的鍵不算差異');
  assert.deepEqual(diffTripEdits(trip).dates, [D13, D17], '沒給 base 就跟空的比');
  // 還原成打包版：三個陣列與 deferred 放回去、不改傳入的
  const { trip: edited } = editedDemo();
  const restored = overlayTripEdits(edited, clone(base));
  assert.equal(diffTripEdits(restored, base).any, false);
  assert.deepEqual(clone(restored.days.map((d) => [d.picks, d.removed, d.swapped])), demoTrip().days.map((d) => [d.picks, [], []]));
  assert.deepEqual(restored.deferred, []);
  assert.equal(dayOf(edited, D13).removed.length, 1, '傳進來的沒被改');
  assert.equal(dayOf(edited, D17).swapped.length, 1);
});

test('跟現場改案各存各的：規劃頁改了 8/13 → 呼叫端清那天的 applied（withoutApplied 照舊，8/17 的不動）；重載＝蓋回改動 → 重排 → 8/17 的現場改案照還原、8/13 照引擎且沒有那站', () => {
  const trip = demoTrip();
  const plans = plansOf(trip);
  const applied = { [D17]: clone(snapshotPlan(plans[D17].plan, 0, { packAt: 'p1' })) };
  // app.js removeStop 的順序：改 trip → clearApplied(date) → saveTripEdits
  const d13 = dayOf(trip, D13);
  const target = plans[D13].plan.sequence.find((s) => !s.insertedBy && !s.isAnchor && !s.designated).poi.id;
  d13.picks = d13.picks.filter((p) => p.poiId !== target); d13.removed = [{ poiId: target, at: 'x' }];
  const afterClear = withoutApplied(applied, D13);
  assert.equal(afterClear, applied, '8/13 沒有現場改案就回原物件、8/17 的不動');
  const snap = clone(snapshotTripEdits(trip, 'p1'));
  // 重開 App：載入打包檔 → 蓋回改動 → 重排 → 還原現場改案（app.js replan 的順序）
  const restoredTrip = applyTripEdits(demoTrip(), snap, 'p1').trip;
  const plans2 = plansOf(restoredTrip);
  assert.ok(ids(plans[D13].plan.sequence).includes(target));
  assert.ok(!ids(plans2[D13].plan.sequence).includes(target), '改動蓋回後引擎排的 8/13 沒有那站');
  const r = restoreApplied({ plans: plans2, applied: afterClear, packAt: 'p1', pois, trip: restoredTrip, ...ctx });
  assert.deepEqual(r.dropped, []);
  assert.equal(r.plans[D17].plan.applied, true);
  assert.deepEqual(ids(r.plans[D17].plan.sequence), ids(plans[D17].plan.sequence));
  assert.equal(r.plans[D13].plan.applied, undefined);
  // 規劃頁改了 8/17 那天：那天的現場改案清掉、8/13 的改動照存
  const cleared = withoutApplied(afterClear, D17);
  assert.deepEqual(cleared, {});
  assert.notEqual(cleared, afterClear);
});

test('釘住的順序與早餐不排的紀錄也跟著存（11-06 第二批；原話 #192、#196）：安插之後快照帶 pinned、蓋回去引擎照那個順序排；一次性復原＝蓋回動作前的快照；舊版的鍵沒有這兩欄照舊讀得進來；形狀壞掉的當丟掉', () => {
  const AT = '2026-11-12T00:00:00.000Z';
  const trip = demoTrip();
  const base = clone(snapshotTripEdits(trip, 'p1'));
  const d = plansOf(trip)[D13];
  const home = resolveHome(trip, D13);
  // 示範資料的 19 站都勾了：另外造一家路邊的店（走廊清單上那種）插進 8/13。那天已經 8 站，第 9 站要先少去一站——用選項裡「不去某站」排得下的那一個
  const extra = { ...POIS['松本清'], id: 'roadside-shop', name_zh: '路邊的店', dwellMin: 30 };
  const pois2 = { ...pois, [extra.id]: extra };
  const plansWith = (tr) => Object.fromEntries(planTrip({ trip: tr, pois: pois2, restPool: Object.values(pois), ...ctx }).days.map((x) => [x.date, x]));
  const blocked = insertTrial({ plan: d.plan, day: d.day, home, poi: extra, legIndex: 6, ...ctx });
  assert.equal(blocked.fits, false, '示範的 8/13 已經 8 站');
  const option = blocked.options.find((o) => o.fits && o.kind === 'drop');
  assert.ok(option, `要有「不去某站」排得下的選項：${blocked.options.map((o) => `${o.kind} ${o.poiId} ${o.fits}`).join('；')}`);
  const t = option.result;
  const before = clone(snapshotTripEdits(trip, 'p1'));   // 動作前先留一份（app.js 的一次性復原就是蓋回這一份）
  const inserted = applyInsert(trip, D13, option, AT);
  const snap = clone(snapshotTripEdits(inserted, 'p1'));
  assert.deepEqual(snap.days[D13].pinned, clone(dayOf(inserted, D13).pinned));
  assert.equal(snap.days[D13].pinned.sequence.length, t.sequence.length);
  assert.deepEqual(snap.days[D13].removed.map((x) => x.poiId), [option.poiId], '選了不去的那一站記在 removed');
  assert.ok(!snap.days[D13].picks.some((x) => x.poiId === option.poiId) && snap.days[D13].picks.some((x) => x.poiId === extra.id));
  assert.equal(snap.days[D17].pinned, null);
  assert.deepEqual(diffTripEdits(inserted, base), { dates: [D13], deferredChanged: false, any: true });
  // 重開 App：蓋回 → 引擎照釘住的順序排，就是試算的那一條
  const reloaded = applyTripEdits(demoTrip(), snap, 'p1').trip;
  assert.deepEqual(clone(dayOf(reloaded, D13).pinned), snap.days[D13].pinned);
  const p = plansWith(reloaded)[D13].plan;
  assert.equal(p.pinned, true);
  assert.deepEqual(p.sequence.map((s) => [s.poi.id, s.startMin]), t.sequence.map((s) => [s.poi.id, s.startMin]));
  // 一次性復原：蓋回動作前的快照 → pinned 拿掉、picks 回到原樣、那天回到搜尋
  const undone = overlayTripEdits(inserted, before);
  assert.equal('pinned' in dayOf(undone, D13), false);
  assert.deepEqual(dayOf(undone, D13).picks, dayOf(trip, D13).picks);
  assert.equal(diffTripEdits(undone, base).any, false);
  assert.equal(plansWith(undone)[D13].plan.pinned, undefined);
  assert.ok(dayOf(inserted, D13).pinned, '不改傳入的');
  // 早餐不排的紀錄（吃飯店早餐）一樣存、一樣還原
  const withBf = setBreakfast(inserted, D17, 'hotel', null, AT);
  const snapBf = clone(snapshotTripEdits(withBf, 'p1'));
  assert.deepEqual(snapBf.days[D17].breakfast, { mode: 'hotel', poiId: null, at: AT });
  assert.deepEqual(diffTripEdits(withBf, base).dates, [D13, D17]);
  assert.deepEqual(dayOf(applyTripEdits(demoTrip(), snapBf, 'p1').trip, D17).breakfast, { mode: 'hotel', poiId: null, at: AT });
  assert.equal('breakfast' in dayOf(overlayTripEdits(withBf, before), D17), false, '蓋回沒有紀錄的快照：那天的 breakfast 拿掉');
  // 舊版存的鍵（那天沒有 pinned、breakfast 這兩個鍵）：合法、三個陣列照蓋，旅程檔那天本來有的這兩欄不動
  const old = { packAt: 'p1', tripId: trip.id, days: { [D13]: { picks: before.days[D13].picks, removed: [], swapped: [] }, [D17]: { picks: before.days[D17].picks, removed: [], swapped: [] } }, deferred: [] };
  assert.equal(validTripEdits(old), true);
  assert.equal(applyTripEdits(demoTrip(), old, 'p1').dropped, false);
  const kept = overlayTripEdits(withBf, old);
  assert.deepEqual(dayOf(kept, D13).pinned, dayOf(withBf, D13).pinned);
  assert.deepEqual(dayOf(kept, D17).breakfast, dayOf(withBf, D17).breakfast);
  assert.deepEqual(dayOf(kept, D13).picks, before.days[D13].picks);
  assert.equal(diffTripEdits(demoTrip(), old).any, false, '對照那份少了這兩欄：當作沒有，不算差異');
  // 形狀壞掉：pinned 不是帶 sequence 陣列的物件、breakfast 不是物件 → 整份當丟掉；sequence 裡的 null 靜靜濾掉
  for (const bad of [{ pinned: 5 }, { pinned: [] }, { pinned: { sequence: 'x' } }, { pinned: {} }, { breakfast: 'hotel' }, { breakfast: [1] }]) {
    const edits = { ...snap, days: { ...snap.days, [D13]: { ...snap.days[D13], ...bad } } };
    assert.equal(validTripEdits(edits), false, JSON.stringify(bad));
    assert.equal(applyTripEdits(demoTrip(), edits, 'p1').dropped, true);
  }
  const holes = { ...snap, days: { ...snap.days, [D13]: { ...snap.days[D13], pinned: { at: AT, sequence: [null, ...snap.days[D13].pinned.sequence, 7] } } } };
  assert.equal(validTripEdits(holes), true);
  assert.deepEqual(dayOf(applyTripEdits(demoTrip(), holes, 'p1').trip, D13).pinned.sequence, snap.days[D13].pinned.sequence);
});

test('引擎的備忘（上一版引擎替那天挑的早餐 engineBreakfast；11-12 畫面審查）：跟著快照存、蓋得回來、復原帶得回去；不算他的改動——只有它不一樣時是「沒有改」；寫壞的當丟掉', () => {
  const AT = '2026-11-12T00:00:00.000Z';
  const trip = demoTrip();
  const base = clone(snapshotTripEdits(trip, 'p1'));   // 載入時留的對照：還沒排過，沒有備忘
  assert.equal(base.days[D13].engineBreakfast, null);
  // 重排完記回來的樣子（engine/breakfast.js keepBreakfasts 寫的）
  const noted = { ...trip, days: trip.days.map((d) => (d.date === D13 ? { ...d, engineBreakfast: '麵店' } : d)) };
  const snap = clone(snapshotTripEdits(noted, 'p1'));
  assert.equal(snap.days[D13].engineBreakfast, '麵店');
  assert.equal(snap.days[D17].engineBreakfast, null);
  assert.deepEqual(diffTripEdits(noted, base), { dates: [], deferredChanged: false, any: false }, '只有備忘不一樣：不算有改（設定頁不寫「1 天有改」、鍵照刪）');
  // 他真的改了一天：那天算有改，別天只有備忘不一樣的不算
  const edited = { ...noted, days: noted.days.map((d) => (d.date === D17 ? { ...d, engineBreakfast: '站內店', removed: [{ poiId: 'x', at: AT }] } : d)) };
  assert.deepEqual(diffTripEdits(edited, base).dates, [D17]);
  // 重開 App：蓋回 → 兩天的備忘都回來
  const reloaded = applyTripEdits(demoTrip(), clone(snapshotTripEdits(edited, 'p1')), 'p1').trip;
  assert.deepEqual([dayOf(reloaded, D13).engineBreakfast, dayOf(reloaded, D17).engineBreakfast], ['麵店', '站內店']);
  // 一次性復原／還原成打包版：蓋回那天是 null 的快照 → 那一欄拿掉；蓋回舊版存的快照（沒有這個鍵）→ 不動
  assert.equal('engineBreakfast' in dayOf(overlayTripEdits(edited, base), D13), false);
  const old = { packAt: 'p1', tripId: trip.id, days: { [D13]: { picks: base.days[D13].picks, removed: [], swapped: [] } }, deferred: [] };
  assert.equal(validTripEdits(old), true);
  assert.equal(dayOf(overlayTripEdits(edited, old), D13).engineBreakfast, '麵店');
  // 形狀壞掉：不是字串 → 整份當丟掉；空字串當沒有
  for (const bad of [5, {}, ['麵店'], true]) {
    const edits = { ...snap, days: { ...snap.days, [D13]: { ...snap.days[D13], engineBreakfast: bad } } };
    assert.equal(validTripEdits(edits), false, JSON.stringify(bad));
    assert.equal(applyTripEdits(demoTrip(), edits, 'p1').dropped, true);
  }
  const empty = { ...snap, days: { ...snap.days, [D13]: { ...snap.days[D13], engineBreakfast: '' } } };
  assert.equal(validTripEdits(empty), true);
  assert.equal('engineBreakfast' in dayOf(applyTripEdits(noted, empty, 'p1').trip, D13), false);
});
