// 二選一與順延的畫面邏輯（T16；原話 #119、#121、#138）：純函式——這站的二選一、選了 B（換站＋順延）、排不進清單的「排到別天」、復原列那句（10-24 起放復原列，原話 #181）、候選頁的「順延中」。
// 比照 applied.test 的做法，不碰 DOM：示範夾具（8/13 勾三家咖啡廳、只排得進兩家）驗 choice 的形狀，順延用自己造的小世界（示範旅程只有兩天、8/17 是購物日，沒有別天可排）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planTrip } from '../../src/engine/trip.js';
import { choiceOf, chooseOptionTrip, deferStopTrip, swapPick, deferNotice, deferredMark, displacedPicks } from '../../src/ui/choices.js';
import { snapshotTripEdits, overlayTripEdits, diffTripEdits } from '../../src/ui/trip-edits.js';
import { TEXT } from '../../src/ui/text.js';
import { loadRules } from '../../src/rules/index.js';
import { BUILTIN } from '../../src/rules/builtin.js';
import rulesJson from '../../src/rules.json' with { type: 'json' };
import { POIS, KB, COUNTRY, legFn, demoTrip } from '../sendai/fixture.js';

const rules = loadRules(BUILTIN, rulesJson.rules);
const settings = rulesJson.settings;
const pois = Object.fromEntries(Object.values(POIS).map((p) => [p.id, p]));
const demoArgs = { rules, settings, country: COUNTRY, kb: KB, legFn, restPool: Object.values(pois) };
const ids = (seq) => seq.map((s) => s.poi.id);

test('示範 8/13：勾三家咖啡廳只排得進兩家 → 排進的那家出「或 火星の庭」（source dropped）；choiceOf 找得到那站、別站 null；8/17 主題日 SEGA-RU 或 TRUE VINTAGE（原話 #119 的那兩家）', () => {
  const r = planTrip({ trip: demoTrip(), pois, ...demoArgs });
  const d13 = r.days[0].plan;
  assert.deepEqual(d13.dropped.map((x) => x.poi.id), [POIS['火星の庭'].id]);
  assert.equal(d13.choices.length, 1, JSON.stringify(d13.choices.map((c) => c.options)));
  const c = d13.choices[0];
  assert.equal(c.source, 'dropped');
  assert.equal(c.options[1], POIS['火星の庭'].id);
  assert.ok(ids(d13.sequence).includes(c.poiId), 'A 在序列裡');
  assert.equal(d13.sequence[c.slot].poi.id, c.poiId, 'slot 指到 A');
  assert.equal(choiceOf(d13, c.poiId), c);
  assert.equal(choiceOf(d13, POIS['汐谷'].id), null);
  assert.equal(choiceOf(null, 'x'), null);
  const d17 = r.days[1].plan;
  assert.ok(d17.choices.some((x) => x.poiId === POIS['SEGA-RU'].id && x.options[1] === POIS['TRUE VINTAGE'].id && x.source === 'dropped'), JSON.stringify(d17.choices.map((x) => x.options)));
});

test('chooseOptionTrip（示範 8/13 選火星の庭）：A 換成 B（B 本來就是今天的勾選就不重複、優先度提到 A 的）、day.swapped 有紀錄、A 走順延；示範只有兩天、8/17 是購物日 → unplaced、A 留在候選池；不改傳入的 trip', () => {
  const trip = demoTrip();
  const r = planTrip({ trip, pois, ...demoArgs });
  const c = r.days[0].plan.choices[0];
  const out = chooseOptionTrip({ trip, pois, date: '2026-08-13', fromPoiId: c.poiId, toPoi: c.altPoi, baseline: { days: r.days }, planArgs: demoArgs });
  const picks = out.trip.days[0].picks;
  assert.ok(!picks.some((p) => p.poiId === c.poiId), 'A 不在 8/13 的 picks');
  assert.equal(picks.filter((p) => p.poiId === c.altPoi.id).length, 1, 'B 只有一筆');
  assert.equal(picks.find((p) => p.poiId === c.altPoi.id).priority, 'want', 'B 原本 maybe，提到 A 的 want');
  assert.deepEqual(out.trip.days[0].swapped.map((s) => [s.from, s.to]), [[c.poiId, c.altPoi.id]]);
  assert.deepEqual({ ...out.entry, at: undefined }, { poiId: c.poiId, chosenPoiId: c.altPoi.id, fromDate: '2026-08-13', toDate: null, status: 'unplaced', at: undefined });
  assert.equal(out.toDate, null);
  assert.ok(!out.trip.days[1].picks.some((p) => p.poiId === c.poiId), '8/17 是購物日，不排');
  assert.deepEqual(trip.days[0].picks.map((p) => p.poiId), demoTrip().days[0].picks.map((p) => p.poiId), '傳入的 trip 沒動');
  assert.equal(trip.deferred, undefined);
  // 重排：A 不在 8/13（他剛選了 B 頂掉它，引擎那天也不把它當恢復站插回來）、別天只會是引擎插的不是勾的；B 是他勾的站，排不排得進照引擎（跟「換一家」一樣，不保證）；候選頁標「順延中」
  const re = planTrip({ trip: out.trip, pois, ...demoArgs });
  assert.ok(!ids(re.days[0].plan.sequence).includes(c.poiId), `A 不在 8/13：${ids(re.days[0].plan.sequence).join('→')}`);
  assert.ok(re.days.every((d) => d.plan.sequence.every((s) => s.poi.id !== c.poiId || s.insertedBy === 'engine')));
  assert.ok(ids(re.days[0].plan.sequence).includes(c.altPoi.id) || re.days[0].plan.dropped.some((x) => x.poi.id === c.altPoi.id), 'B 是 8/13 的勾選站：在序列裡或在排不進清單');
  assert.ok(!re.days[0].plan.choices.some((x) => x.options[1] === c.poiId), 'unplaced 的 A 在這天不再當任何一站的 B（10-16 審查）');
  assert.equal(deferredMark(out.trip, c.poiId), TEXT.deferredPending);
  assert.equal(deferredMark(out.trip, c.altPoi.id), null);
  assert.equal(deferredMark(trip, c.poiId), null, '沒順延紀錄就沒有標記');
  assert.equal(deferNotice(out.entry, POIS['珈巣多夢'].name_zh), TEXT.deferredUnplaced('珈巣多夢'));
});

test('swapPick：B 不在今天的 picks 就照 applySwap（A 的那筆換成 B、優先度與停留沿用）；B 已在就拿掉 A、留 B 自己那筆、優先度取 A 與 B 自己之間高的（不降級）；不改傳入的 day', () => {
  assert.deepEqual(swapPick({ date: 'x', picks: [{ poiId: 'a', priority: 'maybe' }, { poiId: 'b', priority: 'want' }] }, 'a', { id: 'b' }).picks, [{ poiId: 'b', priority: 'want' }], 'A maybe、B want：B 不降級（10-16 審查）');
  assert.deepEqual(swapPick({ date: 'x', picks: [{ poiId: 'a' }, { poiId: 'b' }] }, 'a', { id: 'b' }).picks, [{ poiId: 'b', priority: 'want' }], '兩邊都沒寫就 want');
  const day = { date: '2026-08-13', picks: [{ poiId: 'a', priority: 'want', dwellMin: 60 }, { poiId: 'b', priority: 'maybe', dwellMin: 75 }] };
  const toC = swapPick(day, 'a', { id: 'c' });
  assert.deepEqual(toC.picks, [{ poiId: 'c', priority: 'want', dwellMin: 60 }, { poiId: 'b', priority: 'maybe', dwellMin: 75 }]);
  assert.deepEqual(toC.swapped.map((s) => [s.from, s.to]), [['a', 'c']]);
  const toB = swapPick(day, 'a', { id: 'b' });
  assert.deepEqual(toB.picks, [{ poiId: 'b', priority: 'want', dwellMin: 75 }], 'B 留自己的停留、優先度提到 want');
  assert.deepEqual(toB.swapped.map((s) => [s.from, s.to]), [['a', 'b']]);
  assert.deepEqual(day.picks.map((p) => p.poiId), ['a', 'b'], '不改傳入的');
  assert.deepEqual(swapPick({ date: 'x' }, 'a', { id: 'b' }).picks, [], '沒 picks 也不丟錯');
});

// 順延的小世界（跟 test/engine/choices.test 同款）：8/12 普通、8/13 出發日、8/14 咖啡廳主題日、8/15 普通、8/16 離境日
const country = COUNTRY;
const kb = { zones: { town: { environment: 'town', lat: 38.26, lng: 140.87 } } };
const ALL = Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, [['09:00', '23:00']]]));
const cafe = (id) => ({ id, name_zh: id, category: 'cafe', walkFactor: 0, recovery: true, cafeLike: true, climbMin: 0, zoneId: 'town', hours: ALL, dwellMin: 40, daylightOnly: false, lat: 38.26, lng: 140.87 });
const home = { id: 'home', name_zh: '飯店', zoneId: 'town', lat: 38.26, lng: 140.87 };
const flat = () => ({ walkMin: 5, rideMin: 0, climbMin: 0, mode: 'walk' });
const smallPois = { 甲: cafe('甲'), 乙: cafe('乙') };
const smallArgs = { rules, settings, country, kb, legFn: flat, restPool: Object.values(smallPois) };
const day = (date, over = {}) => ({ date, type: 'normal', picks: [], ...over });
const smallTrip = () => ({ id: 't', party: 1, homeBases: [{ poi: home }], shoppingDays: [], days: [day('2026-08-12'), day('2026-08-13', { picks: [{ poiId: '甲', priority: 'want' }] }), day('2026-08-14', { anchor: { theme: 'cafe' } }), day('2026-08-15'), day('2026-08-16', { type: 'departure', departAirportMin: 15 * 60 })] });

test('chooseOptionTrip 排得進：A 換成候選池的 B、A 順延到主題日 8/14；復原列那句「甲 已排到 8/14（五）」；重排後 8/14 的站卡帶「從 8/13 順延」、8/13 的 B 是他勾的站', () => {
  const trip = smallTrip();
  const r = planTrip({ trip, pois: smallPois, ...smallArgs });
  const c = r.days[1].plan.choices[0];
  assert.deepEqual([c.poiId, c.options[1], c.source], ['甲', '乙', 'pool'], JSON.stringify(r.days[1].plan.choices));
  const out = chooseOptionTrip({ trip, pois: smallPois, date: '2026-08-13', fromPoiId: '甲', toPoi: c.altPoi, baseline: { days: r.days }, planArgs: smallArgs });
  assert.equal(out.toDate, '2026-08-14');
  assert.deepEqual(out.trip.days[1].picks, [{ poiId: '乙', priority: 'want' }]);
  assert.deepEqual(out.trip.days[2].picks, [{ poiId: '甲', priority: 'want', deferredFrom: '2026-08-13' }]);
  assert.equal(deferNotice(out.entry, '甲'), '甲 已排到 8/14（五）');
  assert.equal(deferredMark(out.trip, '甲'), null, 'placed 的不標順延中（序列會標已排）');
  const re = planTrip({ trip: out.trip, pois: smallPois, ...smallArgs });
  const placed = re.days[2].plan.sequence.find((s) => s.poi.id === '甲');
  assert.equal(placed?.deferredFrom, '2026-08-13');
  const b = re.days[1].plan.sequence.find((s) => s.poi.id === '乙');
  assert.ok(b && !b.insertedBy && b.priority === 'want', '選的 B 是他勾的站');
  assert.deepEqual(re.warnings, []);
});

test('deferStopTrip（排不進清單的「排到別天」）：chosenPoiId null、排得進就從這天搬到別天；B 不在 pois 裡（候選池來的）chooseOptionTrip 也帶進去試排', () => {
  const trip = smallTrip();
  trip.days[1].picks.push({ poiId: '乙', priority: 'maybe' }, { poiId: '丙', priority: 'maybe' });
  const three = { ...smallPois, 丙: cafe('丙') };
  const args = { ...smallArgs, restPool: Object.values(three) };
  const r = planTrip({ trip, pois: three, ...args });
  const dropped = r.days[1].plan.dropped[0];
  assert.ok(dropped, '三家咖啡廳非主題日要有一家排不進');
  const out = deferStopTrip({ trip, pois: three, date: '2026-08-13', poiId: dropped.poi.id, baseline: { days: r.days }, planArgs: args });
  assert.equal(out.entry.chosenPoiId, null);
  assert.equal(out.toDate, '2026-08-14');
  assert.ok(!out.trip.days[1].picks.some((p) => p.poiId === dropped.poi.id), '搬走了');
  assert.deepEqual(out.trip.days[2].picks, [{ poiId: dropped.poi.id, priority: 'maybe', deferredFrom: '2026-08-13' }], '優先度沿用它自己的 maybe（10-16 審查後：之前一律 want）');
  // 候選池來的 B 不在 pois：一起帶進去，順延試排才認得它
  const outside = cafe('外面的');
  const out2 = chooseOptionTrip({ trip: smallTrip(), pois: smallPois, date: '2026-08-13', fromPoiId: '甲', toPoi: outside, baseline: { days: r.days }, planArgs: smallArgs });
  assert.equal(out2.toDate, '2026-08-14');
  assert.deepEqual(out2.trip.days[1].picks.map((p) => p.poiId), ['外面的']);
  // A 是 maybe：換進來的 B 跟順延走的 A 都是 maybe（之前順延一律 want）
  const mtrip = smallTrip(); mtrip.days[1].picks = [{ poiId: '甲', priority: 'maybe' }];
  const rm = planTrip({ trip: mtrip, pois: smallPois, ...smallArgs });
  assert.deepEqual([rm.days[1].plan.choices[0]?.poiId, rm.days[1].plan.choices[0]?.options[1]], ['甲', '乙']);
  const om = chooseOptionTrip({ trip: mtrip, pois: smallPois, date: '2026-08-13', fromPoiId: '甲', toPoi: smallPois.乙, baseline: { days: rm.days }, planArgs: smallArgs });
  assert.deepEqual(om.trip.days[1].picks, [{ poiId: '乙', priority: 'maybe' }]);
  assert.deepEqual(om.trip.days[2].picks, [{ poiId: '甲', priority: 'maybe', deferredFrom: '2026-08-13' }]);
});

// 一次性復原（原話 #181；app.js chooseOption／deferStop 的 undo 與 undoLast）：動作前 snapshotTripEdits 的快照（過 JSON），動作後 overlayTripEdits 蓋回去＝原本
const clone = (v) => JSON.parse(JSON.stringify(v));
const three = (trip) => clone(trip.days.map((d) => [d.date, d.picks ?? [], d.removed ?? [], d.swapped ?? []]));
const roundTrip = (trip, act) => {
  const before = clone(snapshotTripEdits(trip, 'p1'));
  const out = act(trip);
  assert.notDeepEqual(three(out.trip), three(trip), '動作真的改了 picks');
  const back = overlayTripEdits(out.trip, clone(before));
  assert.deepEqual(three(back), three(trip), 'days 的 picks／removed／swapped 跟原本一樣');
  assert.deepEqual(back.deferred, trip.deferred ?? [], 'deferred 跟原本一樣（原本沒有＝空）');
  assert.deepEqual(clone(snapshotTripEdits(back, 'p1')), before, '快照逐鍵相同');
  assert.equal(diffTripEdits(back, before).any, false);
  assert.ok(out.trip.deferred.length === 1 && back.deferred.length === 0, '蓋回去順延紀錄也拿掉');
  return back;
};

test('一次性復原往返（原話 #181）：chooseOptionTrip 之後蓋回動作前的快照，days 三個陣列與 deferred 都回到原本——示範 8/13 選火星の庭（A unplaced）、小世界選候選池的乙（A 排到 8/14）；deferStopTrip 同樣；引擎對蓋回的旅程排出原本的序列', () => {
  const trip = demoTrip();
  const r = planTrip({ trip, pois, ...demoArgs });
  const c = r.days[0].plan.choices[0];
  const back = roundTrip(trip, (t) => chooseOptionTrip({ trip: t, pois, date: '2026-08-13', fromPoiId: c.poiId, toPoi: c.altPoi, baseline: { days: r.days }, planArgs: demoArgs }));
  const re = planTrip({ trip: back, pois, ...demoArgs });
  assert.deepEqual(re.days.map((d) => ids(d.plan.sequence)), r.days.map((d) => ids(d.plan.sequence)), '蓋回去引擎排的跟原本一樣');
  const small = smallTrip();
  const rs = planTrip({ trip: small, pois: smallPois, ...smallArgs });
  roundTrip(small, (t) => chooseOptionTrip({ trip: t, pois: smallPois, date: '2026-08-13', fromPoiId: '甲', toPoi: rs.days[1].plan.choices[0].altPoi, baseline: { days: rs.days }, planArgs: smallArgs }));
  const td = smallTrip();
  td.days[1].picks.push({ poiId: '乙', priority: 'maybe' }, { poiId: '丙', priority: 'maybe' });
  const three3 = { ...smallPois, 丙: cafe('丙') };
  const args3 = { ...smallArgs, restPool: Object.values(three3) };
  const rd = planTrip({ trip: td, pois: three3, ...args3 });
  const backD = roundTrip(td, (t) => deferStopTrip({ trip: t, pois: three3, date: '2026-08-13', poiId: rd.days[1].plan.dropped[0].poi.id, baseline: { days: rd.days }, planArgs: args3 }));
  assert.deepEqual(backD.days[1].picks.map((p) => p.poiId), ['甲', '乙', '丙'], '搬走的放回原位');
  assert.deepEqual(backD.days[2].picks, [], '8/14 沒有順延來的');
});

test('displacedPicks：重排前不在排不進清單、重排後在的勾選站（fromDate 與 toDate）；deferNotice 接「擠掉了 8/13（四） 的 X」；deferredMark：placed 但順延到的那天重排後排不進也標「順延中」', () => {
  const p = (id) => ({ id, name_zh: id });
  const plan = (dropped) => ({ plan: { dropped: dropped.map((id) => ({ poi: p(id), priority: 'want', reason: '' })) } });
  const before = { '2026-08-13': plan(['火']), '2026-08-15': plan([]) };
  const after = { '2026-08-13': plan(['火', '珈']), '2026-08-15': plan(['駒']) };
  assert.deepEqual(displacedPicks({ before, after, dates: ['2026-08-13', '2026-08-15', null] }).map((x) => [x.date, x.poi.id]), [['2026-08-13', '珈'], ['2026-08-15', '駒']]);
  assert.deepEqual(displacedPicks({ before, after: before, dates: ['2026-08-13'] }), [], '沒變就沒有');
  assert.deepEqual(displacedPicks({ before: {}, after, dates: ['2026-08-16'] }), [], '那天沒排就沒有');
  const entry = { poiId: 'E', chosenPoiId: 'F', fromDate: '2026-08-13', toDate: '2026-08-15', status: 'placed', at: 'T0' };
  assert.equal(deferNotice(entry, 'Elbe', displacedPicks({ before, after, dates: ['2026-08-13', '2026-08-15'] })), 'Elbe 已排到 8/15（六）；擠掉了 8/13（四） 的 珈、8/15（六） 的 駒');
  assert.equal(deferNotice(entry, 'Elbe', []), 'Elbe 已排到 8/15（六）');
  assert.equal(deferNotice(entry, 'Elbe'), 'Elbe 已排到 8/15（六）');
  assert.equal(deferNotice({ ...entry, toDate: null, status: 'unplaced' }, 'Elbe', [{ date: '2026-08-13', poi: p('F') }]), 'Elbe 先留在候選池（別天排不進）；擠掉了 8/13（四） 的 F', '選的 B 自己排不進也列');
  const trip = { deferred: [entry] };
  assert.equal(deferredMark(trip, 'E', { '2026-08-15': plan(['E']) }), TEXT.deferredPending, 'placed 但 8/15 重排後排不進');
  assert.equal(deferredMark(trip, 'E', { '2026-08-15': plan([]) }), null);
  assert.equal(deferredMark(trip, 'E'), null, '沒給 plans 就當排進去了');
  assert.equal(deferredMark(trip, 'Z', {}), null);
});
