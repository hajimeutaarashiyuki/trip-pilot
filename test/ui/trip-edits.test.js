// 規劃頁的改動存在手機（T16b；原話 #154、#121、#171）：快照只存整天的 picks／removed／swapped 與 deferred，過 JSON 再蓋回同一份、引擎排出一樣的序列；
// 打包時間或旅程不同就丟掉（規劃頁頂端那句在 app.js，這裡只驗 dropped 與那句存在）；跟打包那版比哪幾天有改、還原成打包版；
// 跟現場改案（field.applied）各存各的：規劃頁改了那天的 applied 由呼叫端清掉（withoutApplied 照舊），別天的改案重載後照還原。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planTrip } from '../../src/engine/trip.js';
import { applySwap } from '../../src/engine/swap.js';
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
  assert.deepEqual(Object.keys(snap.days[D13]).sort(), ['picks', 'removed', 'swapped'], '一天只存三個陣列');
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
