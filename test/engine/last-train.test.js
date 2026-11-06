// 末班車與一日遊的夜間站（原話 #190；11-06）的引擎層：planTrip 把知識庫連結的末班整理到 day 上（away、lastLegs），規則 last-train 照它擋；
// 一日遊晚回城——他勾的市區夜間站照排掛提示、沒有夜間站不罰、引擎插的不排。規則本身的單元測試在 test/rules/。小世界用分配器那一份（test/fixtures/alloc-world.js）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planTrip, awayOf, lastLegsOf } from '../../src/engine/trip.js';
import { planDay } from '../../src/engine/core.js';
import { loadRules } from '../../src/rules/index.js';
import { BUILTIN } from '../../src/rules/builtin.js';
import { makeLegFn } from '../../src/geo/matrix.js';
import rulesJson from '../../src/rules.json' with { type: 'json' };
import { POIS, HOME, ZONES, LINKS, COUNTRY } from '../fixtures/alloc-world.js';

const rules = loadRules(BUILTIN, rulesJson.rules);
const settings = rulesJson.settings;
const hours = (open, close) => Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, [[open, close]]]));
/** 小世界：town（據點）—hill 走路 10 分、town—sea JR 30＋5、town—far 巴士 60＋5；last 給 town|sea 那條連結的末班。 */
const world = (last = null) => ({ legFn: makeLegFn({ walk: {}, settings, zoneLinks: { ...LINKS, 'town|sea': { ...LINKS['town|sea'], ...(last ? { last } : {}) } } }), kb: { zones: ZONES } });
const plan = ({ last = null, days, pois }) => {
  const w = world(last);
  return planTrip({ trip: { id: 'lt', party: 1, homeBases: [{ poi: HOME }], days }, pois, rules, settings, country: COUNTRY, kb: w.kb, legFn: w.legFn, restPool: [] });
};
const seqOf = (x) => x.plan.sequence.map((s) => `${s.poi.id}@${s.startMin}-${s.endMin}`);
const warnsOf = (x) => x.plan.warnings.map((w) => w.msg);
const L = (leaveByMin, departMin, fromZoneId) => ({ leaveByMin, departMin, fromZoneId });

test('planTrip 把末班整理到 day 上：away＝回住宿要搭車的區與回程的末班、lastLegs＝區對區搭車的末班（轉乘一次的也算）；知識庫沒資料、legFn 不是 makeLegFn 做的就沒有', () => {
  const day = { date: '2026-08-15', type: 'normal', dayTrip: true, anchor: { poiId: 'templesea' }, picks: [{ poiId: 'templesea', priority: 'must' }, { poiId: 'shrinea', priority: 'want' }] };
  const d = plan({ last: { sea: '21:40', town: '23:00' }, days: [day], pois: POIS }).days[0].day;
  assert.deepEqual([...d.regionZones].sort(), ['hill', 'sea', 'town']);
  assert.deepEqual(d.away, { sea: { homeMin: 35, last: L(21 * 60 + 35, 21 * 60 + 40, 'sea') } }, '海邊回旅館車 30＋走 5；山丘走路就到，不算外地');
  assert.deepEqual(d.lastLegs, {
    'town|sea': L(22 * 60 + 55, 23 * 60, 'town'),
    'sea|town': L(21 * 60 + 35, 21 * 60 + 40, 'sea'),
    'hill|sea': L(22 * 60 + 45, 23 * 60, 'town'),   // 走 10 分到小鎮、再扣上車前的 5 分
    'sea|hill': L(21 * 60 + 35, 21 * 60 + 40, 'sea'),
  });
  const none = plan({ days: [day], pois: POIS }).days[0].day;
  assert.deepEqual(none.away, { sea: { homeMin: 35 } }, '沒有末班資料：外地照認（一日遊的回城時刻要用），只是沒有 last');
  assert.equal(none.lastLegs, null);
  const custom = planTrip({ trip: { id: 'c', party: 1, homeBases: [{ poi: HOME }], days: [day] }, pois: POIS, rules, settings, country: COUNTRY, kb: { zones: ZONES }, legFn: () => ({ walkMin: 5, rideMin: 0, climbMin: 0, mode: 'walk' }), restPool: [] }).days[0].day;
  assert.deepEqual([custom.away, custom.lastLegs], [null, null], '自訂的 legFn 沒有 rideLink／linkBetween：兩張表都沒有，規則照平常算');
});

test('awayOf／lastLegsOf：走得回住宿的區不算外地（就算有地下鐵連結與末班）；據點沒有區、legFn 沒有方法回 null', () => {
  const legFn = makeLegFn({ settings, zoneLinks: { 'town|near': { mode: 'subway', rideMin: 8, walkMin: 5, last: { near: '23:50' } }, 'town|sea': { mode: 'jr', rideMin: 30, walkMin: 5, last: { sea: '21:40' } } } });
  const kb = { zones: { town: { lat: 38.26, lng: 140.87 }, near: { lat: 38.266, lng: 140.87 }, sea: { lat: 38.37, lng: 141.06 } } };
  const home = { id: 'home', name_zh: '旅館', zoneId: 'town', lat: 38.2595, lng: 140.878 };
  assert.deepEqual(awayOf({ zones: ['town', 'near', 'sea'], home, legFn, kb }), { sea: { homeMin: 35, last: L(21 * 60 + 35, 21 * 60 + 40, 'sea') } }, 'near 的區中心走十幾分鐘就到旅館：市區');
  assert.deepEqual(lastLegsOf({ zones: ['town', 'near', 'sea'], legFn }), { 'near|town': L(23 * 60 + 45, 23 * 60 + 50, 'near'), 'near|sea': L(23 * 60 + 45, 23 * 60 + 50, 'near'), 'sea|town': L(21 * 60 + 35, 21 * 60 + 40, 'sea'), 'sea|near': L(21 * 60 + 35, 21 * 60 + 40, 'sea') });
  assert.equal(legFn.warnings.length, 0, '拿區中心探路不留估算警告');
  assert.equal(awayOf({ zones: ['sea'], home: { id: 'home', zoneId: null }, legFn, kb }), null);
  assert.equal(awayOf({ zones: ['sea'], home, legFn: () => ({}), kb }), null);
  assert.equal(lastLegsOf({ zones: ['town', 'sea'], legFn: () => ({}) }), null);
  assert.equal(lastLegsOf({ zones: ['town'], legFn }), null);
});

test('當地的夜間站只要趕得上末班車（原話 #190）：待到末班之前的照排、算有夜間站；待過頭的排不進、理由講得出哪一班；知識庫沒有末班資料就不擋', () => {
  const barsea = { ...POIS.barn1, id: 'barsea', name_zh: '海邊酒吧', zoneId: 'sea', hours: hours('21:00', '24:00') };
  const pois = { templesea: POIS.templesea, barsea };
  const day = (dwellMin) => ({ date: '2026-08-15', type: 'normal', dayTrip: true, anchor: { poiId: 'templesea' }, picks: [{ poiId: 'templesea', priority: 'must' }, { poiId: 'barsea', priority: 'want', dwellMin }] });
  const last = { sea: '21:40', town: '23:00' };   // 海邊 21:40 的末班，最晚 21:35 要走
  const fits = plan({ last, days: [day(30)], pois }).days[0];
  assert.deepEqual(seqOf(fits), ['templesea@575-665', 'barsea@1260-1290'], '21:00–21:30 喝完還趕得上');
  assert.ok(!warnsOf(fits).includes('今晚沒排夜間站'), '當地的夜間站算有');
  assert.deepEqual(fits.plan.dropped, []);
  const late = plan({ last, days: [day(75)], pois }).days[0];
  assert.deepEqual(seqOf(late), ['templesea@575-665']);
  assert.deepEqual(late.plan.dropped.map((x) => [x.poi.id, x.reason]), [['barsea', '海邊酒吧 待到 22:15，回住宿趕不上 21:40 的末班車，海邊發車']]);
  assert.ok(warnsOf(late).includes('今晚沒排夜間站'), '下午就回來了、又沒有夜間站：照罰');
  const nodata = plan({ days: [day(75)], pois }).days[0];
  assert.deepEqual(seqOf(nodata), ['templesea@575-665', 'barsea@1260-1335'], '沒有末班資料的連結不判');
});

test('去程也看末班：散場後才出發、趕不上往外地的最後一班就排不進；趕得上照排', () => {
  const venue = { ...POIS.gardeng, id: 'venuet', name_zh: '小鎮會場', category: 'venue' };
  const barsea = { ...POIS.barn1, id: 'barsea', name_zh: '海邊酒吧', zoneId: 'sea', hours: hours('20:00', '24:00') };   // 20:00 才開：排在會場前面也得 19:25 出門，一樣趕不上 19:00
  const pois = { venuet: venue, barsea };
  const day = { date: '2026-08-15', type: 'fixed', earlyDay: true, departHM: '08:20', anchor: { poiId: 'venuet' }, picks: [
    { poiId: 'venuet', priority: 'must', fixedWindow: { startMin: 570, endMin: 1170, arriveEarlyMin: 40, afterMin: 30 } },   // 08:50–20:00
    { poiId: 'barsea', priority: 'want', dwellMin: 30 },
  ] };
  const missed = plan({ last: { town: '19:00', sea: '23:30' }, days: [day], pois }).days[0];
  assert.deepEqual(seqOf(missed), ['venuet@530-1200']);
  assert.deepEqual(missed.plan.dropped.map((x) => x.reason), ['去 海邊酒吧 趕不上 19:00 的末班車，小鎮發車']);
  const caught = plan({ last: { town: '20:10', sea: '23:30' }, days: [day], pois }).days[0];
  assert.deepEqual(seqOf(caught), ['venuet@530-1200', 'barsea@1235-1265'], '20:00 散場、20:05 以前離開：趕得上 20:10，20:35 到海邊');
});

test('一日遊晚回城（原話 #190「回程不算晚(9:00)也可以排進來」）：他勾的市區夜間站照排、那站掛一條提示（不罰）；回得不晚沒有提示；沒有夜間站而回城已晚於 21:00 不罰', () => {
  const eventsea = { ...POIS.templesea, id: 'eventsea', name_zh: '海邊花火', category: 'event', dwellMin: 90 };
  const barlate = { ...POIS.barn1, id: 'barlate', name_zh: '深夜酒吧', hours: hours('21:00', '24:00') };
  const pois = { eventsea, barlate };
  const day = (endMin) => ({ date: '2026-08-15', type: 'normal', dayTrip: true, anchor: { poiId: 'eventsea' }, picks: [
    { poiId: 'eventsea', priority: 'must', fixedWindow: { startMin: 19 * 60, endMin, arriveEarlyMin: 30, afterMin: 0 } },
    { poiId: 'barlate', priority: 'want', dwellMin: 30 },
  ] });
  const late = plan({ days: [day(20 * 60 + 30)], pois }).days[0];   // 20:30 散 → 21:05 回到小鎮
  assert.deepEqual(seqOf(late), ['eventsea@1110-1230', 'barlate@1265-1295'], '照排');
  const hints = late.plan.warnings.filter((w) => w.ruleId === 'day-trip-night');
  assert.deepEqual(hints.map((w) => [w.code, w.hint, w.poiId, w.msg]), [['hint', true, 'barlate', '一日遊回到市區已經 21:05（晚於 21:00），深夜酒吧 照你勾的排；太晚就別去了']]);
  assert.equal(late.plan.complete, true, '提示不是牆');
  const scoreWith = late.plan.score;
  const early = plan({ days: [day(20 * 60 + 20)], pois }).days[0];   // 20:20 散 → 20:55
  assert.deepEqual(seqOf(early), ['eventsea@1110-1220', 'barlate@1260-1290']);
  assert.deepEqual(early.plan.warnings.filter((w) => w.ruleId === 'day-trip-night'), []);
  assert.ok(Math.abs(scoreWith - early.plan.score) < 5, `提示不進分數（${scoreWith} vs ${early.plan.score}，差的只有等開門那幾分鐘）`);
  // 沒有夜間站：晚上才開的當地景點待到 20:40 → 21:15 回到市區，不要求夜間站；20:00 就走的（20:35 回到）照罰。
  // 主行程的寺只開到 17:00（白天的站）：不然兩站誰先誰後罰分一樣（晚出門與中間等開門都封頂 60），引擎會挑晚回城、不罰夜間站的那個排法
  const view = (open, close) => ({ ...POIS.templesea, id: 'viewsea', name_zh: '海邊夜間點燈', hours: hours(open, close), dwellMin: 60 });
  const dayTemple = { ...POIS.templesea, hours: hours('09:00', '17:00') };
  const only = (v) => plan({ days: [{ date: '2026-08-15', type: 'normal', dayTrip: true, anchor: { poiId: 'templesea' }, picks: [{ poiId: 'templesea', priority: 'must' }, { poiId: 'viewsea', priority: 'want' }] }], pois: { templesea: dayTemple, viewsea: v } }).days[0];
  const lateView = only(view('19:40', '20:40'));
  assert.deepEqual(seqOf(lateView), ['templesea@575-665', 'viewsea@1180-1240']);
  assert.ok(!warnsOf(lateView).includes('今晚沒排夜間站'));
  const earlyView = only(view('19:00', '20:00'));
  assert.deepEqual(seqOf(earlyView), ['templesea@575-665', 'viewsea@1140-1200']);
  assert.ok(warnsOf(earlyView).includes('今晚沒排夜間站'));
});

test('引擎不主動排（規則 day-trip-night）：一日遊晚回城之後，引擎插的市區夜間站（填站）不進序列；不是一日遊的日子照插', () => {
  const w = world();
  const viewsea = { ...POIS.templesea, id: 'viewsea', name_zh: '海邊夜間點燈', hours: hours('19:40', '20:40'), dwellMin: 60 };
  const barlate = { ...POIS.barn1, id: 'barlate', name_zh: '深夜酒吧', hours: hours('22:00', '24:00') };
  const day = (dayTrip) => ({
    date: '2026-08-15', type: 'normal', dayTrip, earlyDay: false, party: 1, dayTripNext: false, themeCategory: null, prevThemeCategory: null, anchorPoiId: null, designated: [],
    regionZones: ['town', 'sea'], homeZoneId: 'town', window: { startMin: 540, endMin: 22 * 60 + 30 }, windowRaw: { startMin: 540, endMin: 1440 },
    away: awayOf({ zones: ['town', 'sea'], home: HOME, legFn: w.legFn, kb: w.kb }), lastLegs: null,
  });
  // 21:15 回到小鎮、他勾的酒吧 22:00 才開：中間的空檔引擎想填一家食堂（21:15–21:45，落在夜間時段的 food＝夜間站）
  const candidates = [
    { poi: viewsea, priority: 'must' },
    { poi: barlate, priority: 'want', dwellMin: 30 },
    { poi: POIS.foodx, priority: 'filler', optional: true, insertedBy: 'engine', dwellMin: 30, gap: { startMin: 20 * 60 + 40, endMin: 22 * 60 } },
  ];
  const run = (dayTrip) => planDay({ candidates, day: day(dayTrip), home: HOME, legFn: w.legFn, rules, settings, country: COUNTRY, kb: w.kb });
  const normal = run(false);
  assert.deepEqual(normal.sequence.map((s) => s.poi.id), ['viewsea', 'foodx', 'barlate'], '平常日：填站照插');
  const trip = run(true);
  assert.deepEqual(trip.sequence.map((s) => s.poi.id), ['viewsea', 'barlate'], '一日遊 21:15 才回到市區：引擎不再多排，他勾的酒吧照排');
  assert.equal(trip.complete, true);
  assert.deepEqual(trip.dropped, [], '引擎插的站排不進不算落選');
});
