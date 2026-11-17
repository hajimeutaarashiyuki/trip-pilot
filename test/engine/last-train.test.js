// 末班車與一日遊的夜間站（原話 #190；11-06）的引擎層：planTrip 把知識庫連結的末班整理到 day 上（away、lastLegs），規則 last-train 照它擋引擎自己插的站；
// 他勾的站趕不上照排、掛提示（11-06 第二批：換個順序趕得上就換順序）；末班分日別；順路站不能害整天不成立、不能害後面的站趕不上。
// 一日遊晚回城——他勾的市區夜間站照排掛提示、沒有夜間站不罰、引擎插的不排。規則本身的單元測試在 test/rules/。小世界用分配器那一份（test/fixtures/alloc-world.js）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planTrip, awayOf, lastLegsOf, insertOnTheWay } from '../../src/engine/trip.js';
import { planDay } from '../../src/engine/core.js';
import { loadRules } from '../../src/rules/index.js';
import { BUILTIN } from '../../src/rules/builtin.js';
import { makeLegFn } from '../../src/geo/matrix.js';
import { lastTrainMisses, lastTrainHints } from '../../src/rules/_slots.js';
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

const lastTrainOf = (x) => x.plan.warnings.filter((w) => w.ruleId === 'last-train');

test('當地的夜間站只要趕得上末班車（原話 #190）：待到末班之前的照排、算有夜間站；他勾的待過頭也照排、那一站掛提示講得出哪一班（不罰、不是牆）；知識庫沒有末班資料就沒有提示', () => {
  const barsea = { ...POIS.barn1, id: 'barsea', name_zh: '海邊酒吧', zoneId: 'sea', hours: hours('21:00', '24:00') };
  const pois = { templesea: POIS.templesea, barsea };
  const day = (dwellMin) => ({ date: '2026-08-15', type: 'normal', dayTrip: true, anchor: { poiId: 'templesea' }, picks: [{ poiId: 'templesea', priority: 'must' }, { poiId: 'barsea', priority: 'want', dwellMin }] });
  const last = { sea: '21:40', town: '23:00' };   // 海邊 21:40 的末班，最晚 21:35 要走
  const fits = plan({ last, days: [day(30)], pois }).days[0];
  assert.deepEqual(seqOf(fits), ['templesea@575-665', 'barsea@1260-1290'], '21:00–21:30 喝完還趕得上');
  assert.ok(!warnsOf(fits).includes('今晚沒排夜間站'), '當地的夜間站算有');
  assert.deepEqual(fits.plan.dropped, []);
  assert.deepEqual(lastTrainOf(fits), []);
  // 停 75 分（21:00 才開門 → 22:15）：怎麼排都趕不上 21:40。上一版把它丟掉；現在照排、掛提示
  const late = plan({ last, days: [day(75)], pois }).days[0];
  assert.deepEqual(seqOf(late), ['templesea@575-665', 'barsea@1260-1335'], '他勾的照排');
  assert.deepEqual(late.plan.dropped, [], '不再因為末班車排不進');
  assert.equal(late.plan.complete, true);
  assert.deepEqual(lastTrainOf(late), [{ ruleId: 'last-train', code: 'hint', hint: true, poiId: 'barsea', kind: 'home', msg: '海邊酒吧 待到 22:15，回住宿趕不上 21:40 的末班車，海邊發車' }]);
  assert.ok(!warnsOf(late).includes('今晚沒排夜間站'), '照排的那一站算夜間站');
  const nodata = plan({ days: [day(75)], pois }).days[0];
  assert.deepEqual(seqOf(nodata), ['templesea@575-665', 'barsea@1260-1335'], '沒有末班資料的連結不判');
  assert.deepEqual(lastTrainOf(nodata), []);
  assert.equal(late.plan.score, nodata.plan.score, '提示不進分數：跟沒有末班資料時同分');
  assert.equal(late.day.lastTrainWall, undefined, '試排用的旗標不留在回傳的 day 上');
});

test('去程也看末班：散場後才出發、趕不上往外地的最後一班——他勾的照排、提示講「去 X 趕不上」；趕得上就沒有提示', () => {
  const venue = { ...POIS.gardeng, id: 'venuet', name_zh: '小鎮會場', category: 'venue' };
  const barsea = { ...POIS.barn1, id: 'barsea', name_zh: '海邊酒吧', zoneId: 'sea', hours: hours('20:00', '24:00') };   // 20:00 才開：排在會場前面也得 19:25 出門，一樣趕不上 19:00
  const pois = { venuet: venue, barsea };
  const day = { date: '2026-08-15', type: 'fixed', earlyDay: true, departHM: '08:20', anchor: { poiId: 'venuet' }, picks: [
    { poiId: 'venuet', priority: 'must', fixedWindow: { startMin: 570, endMin: 1170, arriveEarlyMin: 40, afterMin: 30 } },   // 08:50–20:00
    { poiId: 'barsea', priority: 'want', dwellMin: 30 },
  ] };
  const missed = plan({ last: { town: '19:00', sea: '23:30' }, days: [day], pois }).days[0];
  assert.deepEqual(seqOf(missed), ['venuet@530-1200', 'barsea@1235-1265'], '照排');
  assert.deepEqual(missed.plan.dropped, []);
  assert.deepEqual(lastTrainOf(missed).map((w) => [w.poiId, w.kind, w.hint, w.msg]), [['barsea', 'leg', true, '去 海邊酒吧 趕不上 19:00 的末班車，小鎮發車']]);
  const caught = plan({ last: { town: '20:10', sea: '23:30' }, days: [day], pois }).days[0];
  assert.deepEqual(seqOf(caught), ['venuet@530-1200', 'barsea@1235-1265'], '20:00 散場、20:05 以前離開：趕得上 20:10，20:35 到海邊');
  assert.deepEqual(lastTrainOf(caught), []);
});

test('他勾的站不擋、但能趕上就趕上：換個順序就趕得上的那天換順序、沒有提示；真的趕不上的那一站照排掛提示，同一天別的站照樣要趕上（不跟著排到末班之後）', () => {
  // (一) 換順序：夏天中午待在市區會被罰（noon-urban），分數上偏好「先逛小鎮庭園、中午在海邊」；海邊 12:00 的末班（最晚 11:55 走）
  const pois = { templesea: POIS.templesea, gardeng: POIS.gardeng };
  const day = { date: '2026-08-13', type: 'normal', picks: [{ poiId: 'templesea', priority: 'want' }, { poiId: 'gardeng', priority: 'want' }] };
  const free = plan({ days: [day], pois }).days[0];
  assert.deepEqual(seqOf(free), ['gardeng@550-610', 'templesea@645-735'], '沒有末班資料：先庭園、再去海邊（12:15 才離開）');
  const tight = plan({ last: { sea: '12:00' }, days: [day], pois }).days[0];
  assert.deepEqual(seqOf(tight), ['templesea@575-665', 'gardeng@700-760'], '有 12:00 的末班：先去海邊（11:05 走）、再回來逛庭園');
  assert.deepEqual(lastTrainOf(tight), [], '每一站都趕得上，沒有提示');
  assert.deepEqual(tight.plan.dropped, []);
  assert.ok(tight.plan.score < free.plan.score, `趕得上的順序分數比較低（${tight.plan.score} < ${free.plan.score}），還是用它`);
  // (二) 海邊的日歸湯 18:00 才開、泡 90 分：怎麼排都趕不上 19:18。它照排；海邊寺不能跟著排到晚上（只放行不再排的話，寺會排在泡完湯之後的 19:40）
  const onsen = { ...POIS.templesea, id: 'onsensea', name_zh: '海邊日歸湯', category: 'onsen', walkFactor: 0, recovery: true, hours: hours('18:00', '21:00'), dwellMin: 90 };
  const yu = plan({ last: { sea: '19:18' }, days: [{ date: '2026-08-15', type: 'normal', dayTrip: true, anchor: { poiId: 'templesea' }, picks: [{ poiId: 'templesea', priority: 'must' }, { poiId: 'onsensea', priority: 'want' }] }], pois: { templesea: POIS.templesea, onsensea: onsen } }).days[0];
  assert.deepEqual(seqOf(yu), ['templesea@575-665', 'onsensea@1080-1170'], '寺排在早上、湯照排');
  assert.deepEqual(lastTrainOf(yu).map((w) => [w.poiId, w.msg]), [['onsensea', '海邊日歸湯 待到 19:30，回住宿趕不上 19:18 的末班車，海邊發車']], '只有真的趕不上的那一站有提示');
  assert.deepEqual(yu.plan.dropped, []);
  // (三) 主行程是固定時段的花火、散場晚於末班：主行程照排（上一版整個主行程被丟掉、這一天不成立）；市區的庭園排在出發前、不排到散場之後
  const eventsea = { ...POIS.templesea, id: 'eventsea', name_zh: '海邊花火', category: 'event', dwellMin: 90 };
  const hanabi = plan({ last: { sea: '20:00' }, days: [{ date: '2026-08-15', type: 'normal', dayTrip: true, anchor: { poiId: 'eventsea' }, picks: [{ poiId: 'eventsea', priority: 'must', fixedWindow: { startMin: 19 * 60, endMin: 20 * 60 + 30, arriveEarlyMin: 30, afterMin: 0 } }, { poiId: 'gardeng', priority: 'want' }] }], pois: { eventsea, gardeng: POIS.gardeng } }).days[0];
  assert.deepEqual(seqOf(hanabi), ['gardeng@550-610', 'eventsea@1110-1230']);
  assert.equal(hanabi.plan.complete, true, '主行程在');
  assert.deepEqual(lastTrainOf(hanabi).map((w) => [w.poiId, w.kind]), [['eventsea', 'home']]);
  // (四) 趕得上的順序會少一站（市區的朝市只開到 11:00，先去海邊就逛不到）：不為了末班車丟他勾的站，照原本的排、掛提示
  const market = { ...POIS.gardeng, id: 'market', name_zh: '小鎮朝市', category: 'street', hours: hours('09:00', '11:00') };
  const both = plan({ last: { sea: '12:00' }, days: [{ date: '2026-08-13', type: 'normal', picks: [{ poiId: 'templesea', priority: 'want' }, { poiId: 'market', priority: 'want' }] }], pois: { templesea: POIS.templesea, market } }).days[0];
  assert.deepEqual(seqOf(both), ['market@550-610', 'templesea@645-735'], '兩站都在');
  assert.deepEqual(both.plan.dropped, []);
  assert.deepEqual(lastTrainOf(both).map((w) => w.poiId), ['templesea']);
});

test('末班分日別：planTrip 照那天的日別整理末班（day.serviceDay；週六、週日與假日、平日各用各的），特殊時刻表期間與沒寫的日別取最早的；同一站週六趕得上、週日趕不上', () => {
  const barsea = { ...POIS.barn1, id: 'barsea', name_zh: '海邊酒吧', zoneId: 'sea', hours: hours('21:00', '24:00') };
  const pois = { templesea: POIS.templesea, barsea };
  const last = { sea: { weekday: '21:40', saturday: '22:40', holiday: '20:40' }, town: '23:00' };
  const day = (date) => ({ date, type: 'normal', dayTrip: true, anchor: { poiId: 'templesea' }, picks: [{ poiId: 'templesea', priority: 'must' }, { poiId: 'barsea', priority: 'want', dwellMin: 75 }] });   // 21:00–22:15
  const run = (date, country = COUNTRY, lastOver = last) => {
    const w = world(lastOver);
    return planTrip({ trip: { id: 'sd', party: 1, homeBases: [{ poi: HOME }], days: [day(date)] }, pois, rules, settings, country, kb: w.kb, legFn: w.legFn, restPool: [] }).days[0];
  };
  const fri = run('2026-08-14'); const sat = run('2026-08-15'); const sun = run('2026-08-16');
  assert.deepEqual([fri.day.serviceDay, sat.day.serviceDay, sun.day.serviceDay], ['weekday', 'saturday', 'holiday']);
  assert.deepEqual([fri, sat, sun].map((x) => x.day.away.sea.last.departMin), [21 * 60 + 40, 22 * 60 + 40, 20 * 60 + 40]);
  assert.deepEqual([fri, sat, sun].map((x) => x.day.lastLegs['sea|town'].leaveByMin), [21 * 60 + 35, 22 * 60 + 35, 20 * 60 + 35]);
  assert.deepEqual([fri, sat, sun].map((x) => x.day.lastLegs['town|sea'].departMin), [23 * 60, 23 * 60, 23 * 60], '寫單一值的方向每天同一個');
  for (const x of [fri, sat, sun]) assert.deepEqual(seqOf(x), ['templesea@575-665', 'barsea@1260-1335'], '三天都照排');
  assert.deepEqual(lastTrainOf(sat), [], '週六 22:40 的末班：22:15 喝完趕得上');
  assert.deepEqual(lastTrainOf(fri).map((w) => w.msg), ['海邊酒吧 待到 22:15，回住宿趕不上 21:40 的末班車，海邊發車']);
  assert.deepEqual(lastTrainOf(sun).map((w) => w.msg), ['海邊酒吧 待到 22:15，回住宿趕不上 20:40 的末班車，海邊發車']);
  // 國家層列的特殊時刻表期間（盂蘭盆）：不知道業者跑哪一種，取最早的
  const obon = run('2026-08-15', { ...COUNTRY, transportProfile: { specialSchedule: [{ name: 'お盆', from: '08-13', to: '08-16' }] } });
  assert.equal(obon.day.serviceDay, 'special');
  assert.equal(obon.day.away.sea.last.departMin, 20 * 60 + 40);
  assert.deepEqual(lastTrainOf(obon).map((w) => w.msg), ['海邊酒吧 待到 22:15，回住宿趕不上 20:40 的末班車，海邊發車']);
  // 那一種沒寫：取有寫的裡面最早的
  const partial = run('2026-08-15', COUNTRY, { sea: { weekday: '21:40', holiday: '22:10' } });
  assert.equal(partial.day.away.sea.last.departMin, 21 * 60 + 40, '週六沒寫 → 平日與假日裡比較早的 21:40');
  // awayOf／lastLegsOf 直接呼叫：不給日期就取最早的
  const w = world(last);
  assert.equal(awayOf({ zones: ['town', 'sea'], home: HOME, legFn: w.legFn, kb: w.kb }).sea.last.departMin, 20 * 60 + 40);
  assert.equal(awayOf({ zones: ['town', 'sea'], home: HOME, legFn: w.legFn, kb: w.kb, date: '2026-08-15' }).sea.last.departMin, 22 * 60 + 40);
  assert.equal(lastLegsOf({ zones: ['town', 'sea'], legFn: w.legFn, date: '2026-08-15' })['sea|town'].departMin, 22 * 60 + 40);
  assert.equal(lastLegsOf({ zones: ['town', 'sea'], legFn: w.legFn })['sea|town'].departMin, 20 * 60 + 40);
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
  assert.deepEqual(hints.map((w) => [w.code, w.hint, w.poiId, w.msg]), [['hint', true, 'barlate', '一日遊回到市區約 21:05（晚於 21:00），深夜酒吧 是你勾的，照排']]);
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

// ── 順路站（insertOnTheWay）：貪婪插入只看每一站的硬規則不夠（11-06 審查 low 1）──
/** 兩站之間各走 3 分的那家店（直接走是同區預設的 10 分）：在路上、繞路是負的。 */
const between = (a, mid, b) => ({ [`${a}|${mid}`]: { min: 3, m: 240 }, [`${mid}|${a}`]: { min: 3, m: 240 }, [`${mid}|${b}`]: { min: 3, m: 240 }, [`${b}|${mid}`]: { min: 3, m: 240 } });

test('順路站也看整天的硬規則：一日遊晚回城之後，落在夜間時段的店不當順路站插進兩個他勾的市區站之間（撞的是整天規則 day-trip-night，站層級看不到）；回得不晚照插。走 planTrip＋restPool', () => {
  const eventsea = { ...POIS.templesea, id: 'eventsea', name_zh: '海邊花火', category: 'event', dwellMin: 90 };
  const bar = (id, name) => ({ ...POIS.barn1, id, name_zh: name, hours: hours('21:00', '24:00') });
  // 路上的小吃攤：吃的、不是恢復站（順路站只拿「逛的」，不拿坐下來的）、20:00 才開（早上的空檔填不進去）
  const stall = { ...POIS.foodx, id: 'stall', name_zh: '路上的小吃攤', recovery: false, hours: hours('20:00', '24:00'), dwellMin: 20 };
  const pois = { eventsea, bar1: bar('bar1', '第一家酒吧'), bar2: bar('bar2', '第二家酒吧'), stall };
  const legFn = makeLegFn({ walk: between('bar1', 'stall', 'bar2'), settings, zoneLinks: LINKS });
  const kb = { zones: ZONES };
  const run = (endMin) => planTrip({ trip: { id: 'ow', party: 1, homeBases: [{ poi: HOME }], days: [{ date: '2026-08-15', type: 'normal', dayTrip: true, anchor: { poiId: 'eventsea' }, picks: [
    { poiId: 'eventsea', priority: 'must', fixedWindow: { startMin: 19 * 60, endMin, arriveEarlyMin: 30, afterMin: 0 } },
    { poiId: 'bar1', priority: 'want', dwellMin: 20 }, { poiId: 'bar2', priority: 'want', dwellMin: 20 },
  ] }] }, pois, rules, settings, country: COUNTRY, kb, legFn, restPool: [stall] }).days[0];
  // 20:20 散 → 20:55 回到小鎮（不晚）：小吃攤在兩家酒吧中間，照插
  const early = run(20 * 60 + 20);
  const earlyIds = early.plan.sequence.map((s) => s.poi.id);
  assert.equal(earlyIds.length, 4, `回得不晚：小吃攤插進去（${seqOf(early).join('、')}）`);
  assert.equal(earlyIds[2], 'stall', '插在兩家酒吧中間');
  assert.deepEqual([early.plan.sequence[2].insertedBy, early.plan.sequence[2].priority], ['engine', 'onway']);
  assert.equal(early.plan.complete, true);
  // 20:30 散 → 21:05 才回到小鎮：插了這一天就不成立（引擎自己不插市區的夜間站），跳過
  const late = run(20 * 60 + 30);
  assert.equal(late.plan.sequence.some((s) => s.poi.id === 'stall'), false, `晚回城：小吃攤不插（${seqOf(late).join('、')}）`);
  assert.equal(late.plan.sequence.length, 3);
  assert.equal(late.plan.complete, true);
  assert.ok(!late.plan.warnings.some((w) => w.ruleId === 'day-trip-night' && w.code === 'hard'), '序列裡沒有引擎插的市區夜間站，也就沒有那條硬警告');
  assert.deepEqual(late.plan.warnings.filter((w) => w.ruleId === 'day-trip-night').map((w) => [w.code, w.poiId]).sort(), [['hint', 'bar1'], ['hint', 'bar2']], '他勾的兩家酒吧照排、各一條提示');
  // insertOnTheWay 直接呼叫：晚回城那天原樣回（同一個物件）；回得不晚那天收下，plan.complete 跟著重算的結果走
  const onway = [{ poi: stall, priority: 'onway', optional: true, insertedBy: 'engine', detourMin: -4, dwellMin: 20 }];
  assert.equal(insertOnTheWay({ plan: late.plan, onway, day: late.day, home: HOME, legFn, rules, settings, country: COUNTRY, kb }), late.plan);
  const bare = { ...early.plan, sequence: early.plan.sequence.filter((s) => s.poi.id !== 'stall'), complete: undefined };
  const inserted = insertOnTheWay({ plan: bare, onway, day: early.day, home: HOME, legFn, rules, settings, country: COUNTRY, kb });
  assert.equal(inserted.sequence[2].poi.id, 'stall');
  assert.equal(inserted.complete, true, '收下時 complete 是重算出來的，不是沿用傳進來的');
});

test('順路站不能害他勾的站趕不上末班車：插一家店把後面外地的站推過末班的跳過（他勾的站不受規則 last-train 擋，站層級看不到）；末班夠晚照插', () => {
  const morna = { ...POIS.street1, id: 'morna', name_zh: '早市甲', hours: hours('09:00', '12:00') };
  const mornb = { ...POIS.street2, id: 'mornb', name_zh: '早市乙', hours: hours('09:00', '12:00') };
  const shop = { ...POIS.vint1, id: 'onwayshop', name_zh: '路上的古著店', dwellMin: 20 };
  const pois = { morna, mornb, templesea: POIS.templesea, onwayshop: shop };
  const run = (seaLast) => {
    const legFn = makeLegFn({ walk: between('morna', 'onwayshop', 'mornb'), settings, zoneLinks: { ...LINKS, 'town|sea': { ...LINKS['town|sea'], last: { sea: seaLast } } } });
    return planTrip({ trip: { id: 'lt2', party: 1, homeBases: [{ poi: HOME }], days: [{ date: '2026-08-13', type: 'normal', picks: [{ poiId: 'morna', priority: 'want' }, { poiId: 'mornb', priority: 'want' }, { poiId: 'templesea', priority: 'want' }] }] }, pois, rules, settings, country: COUNTRY, kb: { zones: ZONES }, legFn, restPool: [shop] }).days[0];
  };
  // 兩個早市（中午關）→ 搭車去海邊寺 11:55–13:25。海邊 13:35 的末班（最晚 13:30 走）：再插一家 20 分的店，寺就拖過 13:30
  const tight = run('13:35');
  assert.equal(tight.plan.sequence.at(-1).poi.id, 'templesea');
  assert.equal(tight.plan.sequence.at(-1).endMin, 13 * 60 + 25, `寺 13:25 結束（${seqOf(tight).join('、')}）`);
  assert.ok(!tight.plan.sequence.some((s) => s.poi.id === 'onwayshop'), '會害寺趕不上末班：不插');
  assert.deepEqual(lastTrainOf(tight), []);
  assert.deepEqual(tight.plan.dropped, []);
  // 末班 14:30：插了也趕得上，照插
  const loose = run('14:30');
  assert.ok(loose.plan.sequence.some((s) => s.poi.id === 'onwayshop' && s.insertedBy === 'engine'), `末班夠晚：照插（${seqOf(loose).join('、')}）`);
  assert.deepEqual(lastTrainOf(loose), []);
});

test('回不了住宿的提示同一區只講一次（11-17）：主行程散場晚於末班、同一區前面的站也待過末班時，只有最晚離開的那一站掛提示；判定本身（lastTrainMisses）不變', () => {
  // 海邊的日歸湯 17:40 才開（泡 40 分）、花火 19:00–20:30 固定時段；海邊 17:30 的末班——兩站怎麼排都晚於末班。
  // 之前兩站各掛一句；他整晚都在海邊，回不回得去看的是最後離開的那一站（11-12 審查：主行程本身晚於末班時，同區前面的站也各掛一句，分配器還會把它們收回）
  const onsen = { ...POIS.templesea, id: 'onsensea', name_zh: '海邊日歸湯', category: 'onsen', walkFactor: 0, recovery: true, hours: hours('17:40', '21:00'), dwellMin: 40 };
  const eventsea = { ...POIS.templesea, id: 'eventsea', name_zh: '海邊花火', category: 'event', dwellMin: 90 };
  const day = { date: '2026-08-15', type: 'normal', dayTrip: true, anchor: { poiId: 'eventsea' }, picks: [{ poiId: 'eventsea', priority: 'must', fixedWindow: { startMin: 19 * 60, endMin: 20 * 60 + 30, arriveEarlyMin: 30, afterMin: 0 } }, { poiId: 'onsensea', priority: 'want' }] };
  const w = world({ sea: '17:30' });
  const d = planTrip({ trip: { id: 'lt', party: 1, homeBases: [{ poi: HOME }], days: [day] }, pois: { eventsea, onsensea: onsen }, rules, settings, country: COUNTRY, kb: w.kb, legFn: w.legFn, restPool: [] }).days[0];
  assert.deepEqual(d.plan.sequence.map((s) => s.poi.id), ['onsensea', 'eventsea'], '兩站都照排');
  assert.deepEqual(lastTrainMisses({ sequence: d.plan.sequence, day: d.day, home: HOME, legFn: w.legFn }).map((m) => [m.stop.poi.id, m.kind]), [['onsensea', 'home'], ['eventsea', 'home']], '判定不變：兩站都晚於末班');
  assert.deepEqual(lastTrainOf(d).map((x) => [x.poiId, x.kind, x.msg]), [['eventsea', 'home', '海邊花火 待到 20:30，回住宿趕不上 17:30 的末班車，海邊發車']], '提示只掛在最晚離開的那一站');
  // 直接問提示：同一區兩站只留最晚離開的；兩個外地的區各講各的；引擎插的站不算
  const stop = (id, zoneId, startMin, endMin, over = {}) => ({ poi: { id, name_zh: id, zoneId }, startMin, endMin, arriveMin: startMin, dwellMin: endMin - startMin, ...over });
  const dayCtx = { away: { sea: { homeMin: 35, last: { leaveByMin: 1045, departMin: 1050, fromZoneId: 'sea' } }, far: { homeMin: 65, last: { leaveByMin: 1000, departMin: 1005, fromZoneId: 'far' } } }, lastLegs: null, homeZoneId: 'town' };
  const seq = [stop('遠方甲', 'far', 960, 1020), stop('海邊甲', 'sea', 1060, 1100), stop('海邊乙', 'sea', 1110, 1230), stop('海邊丙', 'sea', 1235, 1240, { insertedBy: 'engine' })];
  assert.deepEqual(lastTrainHints({ sequence: seq, day: dayCtx }).map((x) => x.poiId), ['遠方甲', '海邊乙'], '每個外地的區一句、掛在他勾的站裡最晚離開的那一站；引擎插的站不算（規則會擋它）');
  assert.equal(lastTrainMisses({ sequence: seq, day: dayCtx }).length, 4);
  // 只有一站趕不上：照舊就是那一站
  assert.deepEqual(lastTrainHints({ sequence: seq.slice(1, 2), day: dayCtx }).map((x) => x.poiId), ['海邊甲']);
  // 去程趕不上的那一種（leg）不併：同一區一站去程趕不上、一站回不了住宿，兩句都在
  const legDay = { away: dayCtx.away, lastLegs: { 'town|sea': { leaveByMin: 1000, departMin: 1005, fromZoneId: 'town' } }, homeZoneId: 'town' };
  const rideLeg = () => ({ walkMin: 5, rideMin: 30, climbMin: 0, mode: 'ride' });
  const both = lastTrainHints({ sequence: [stop('海邊甲', 'sea', 1060, 1100), stop('海邊乙', 'sea', 1110, 1230)], day: legDay, home: { id: 'home', zoneId: 'town' }, legFn: (a, b) => (a.zoneId === b.zoneId ? { walkMin: 5, rideMin: 0, climbMin: 0, mode: 'walk' } : rideLeg()) });
  assert.deepEqual(both.map((x) => [x.poiId, x.kind]), [['海邊甲', 'leg'], ['海邊乙', 'home']], '第一站是去程那一班趕不上（判法先看去程），第二站是回不了住宿');
  // 併的只有「回不了住宿」那一種：同一區較早的站回不了住宿、中途回過市區再出來的那一站是去程趕不上（而且更晚離開）——兩句都留
  const laterLeg = { away: dayCtx.away, lastLegs: { 'town|sea': { leaveByMin: 1100, departMin: 1105, fromZoneId: 'town' } }, homeZoneId: 'town' };
  const roundTrip = lastTrainHints({ sequence: [stop('海邊甲', 'sea', 1060, 1100), stop('市區', 'town', 1140, 1160), stop('海邊乙', 'sea', 1200, 1230)], day: laterLeg, home: { id: 'home', zoneId: 'town' }, legFn: (a, b) => (a.zoneId === b.zoneId ? { walkMin: 5, rideMin: 0, climbMin: 0, mode: 'walk' } : rideLeg()) });
  assert.deepEqual(roundTrip.map((x) => [x.poiId, x.kind]), [['海邊甲', 'home'], ['海邊乙', 'leg']]);
});
