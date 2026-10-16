// 多日分配器 v1（T17；規則草案 docs/superpowers/plans/2026-10-16-trip-pilot-t17-allocator-draft.md）：
// 骨架不動、②先分、非主題日同類 ≤2、購物類只在購物日、一日遊只拿那區、沒開的不分、站數上限、planDay 驗證後搬天／換店／回填、同一家整趟一次、同一品項一個落點、門、不改傳入的 trip；
// 10-16 審查後加：品牌字不算店型請求、研究註記（首選／備案）、比較條目不進池、固定時段日只看空檔、抵達日有夜間站、留池理由最後重算。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allocateTrip, poolEligible, levelOf, briefTextMatches, isCategoryRequest, regionZonesFor, zoneGraph, walkCircle, openWithin, researchSaysSkip, researchRank, comparisonEntry, freeIntervals, ALLOC_DEFAULTS } from '../../src/engine/allocate.js';
import { loadRules } from '../../src/rules/index.js';
import { BUILTIN } from '../../src/rules/builtin.js';
import { makeLegFn } from '../../src/geo/matrix.js';
import rulesJson from '../../src/rules.json' with { type: 'json' };
import { POIS, HOME, KB, COUNTRY, TRIP, ALL } from '../fixtures/alloc-world.js';

const rules = loadRules(BUILTIN, rulesJson.rules);
const settings = rulesJson.settings;
const legFn = makeLegFn({ walk: {}, settings, zoneLinks: KB.links });
const run = (over = {}) => allocateTrip({ trip: TRIP, pois: POIS, kb: KB, country: COUNTRY, settings, rules, legFn, ...over });
const dayOf = (r, date) => r.days.find((d) => d.date === date);
const ids = (day) => day.picks.map((p) => p.poiId);
const graph = zoneGraph({ kb: KB });

test('rules.json 有分配器的數字，跟 ALLOC_DEFAULTS 同值', () => {
  for (const [k, v] of Object.entries(ALLOC_DEFAULTS)) assert.equal(settings[k], v, k);
});

test('候選池的門：挖寶型、兩星、落選兩次、未解鎖、研究判可略過、交通／會場／一日遊／坐下來的地方都不進；品項落點進', () => {
  for (const id of ['gatecurated', 'gaterating', 'gateunlock', 'gatelosses', 'gateskip']) assert.equal(poolEligible(POIS[id]), false, id);
  for (const cat of ['logistics', 'venue', 'daytrip', 'spot']) assert.equal(poolEligible({ id: 'x', category: cat }), false, cat);
  assert.equal(poolEligible(POIS.itema1), true, '品項落點是④層，不像引擎插站那樣扣掉');
  assert.equal(researchSaysSkip({ name_zh: '藤崎 香氛區（查證結果：未見 DKNY，可略過）' }), true);
  assert.equal(researchSaysSkip({ name_zh: '仙台機場免稅店（備案查證結果：不可指望）' }), true);
  assert.equal(researchSaysSkip({ name_zh: '普通店', skip: true }), true);
  assert.equal(researchSaysSkip({ name_zh: '普通店' }), false);
  // 研究註記：首選 0、沒寫 1、備案／保底／備援 2；「A vs B」比較條目不是一個地點，連池都不進
  assert.equal(researchRank({ name_zh: '伊達的牛舌本舖 本店（推薦首選）' }), 0);
  assert.equal(researchRank({ name_zh: '松本清 仙台Clis Road店（首選：大店＋順路＋開到22點）' }), 0);
  assert.equal(researchRank({ name_zh: 'たんや善治郎 仙台站前本店（保底備案）' }), 2);
  assert.equal(researchRank({ name_zh: 'Yodobashi 仙台（深夜備援・東口）' }), 2);
  assert.equal(researchRank({ name_zh: '旨味太助（牛舌燒發源直系）' }), 1);
  assert.equal(comparisonEntry({ name_zh: '利久 vs 善治郎（站內牛舌通比較吃）' }), true);
  assert.equal(comparisonEntry({ name_zh: 'Vs Cafe' }), false, '店名開頭的 Vs 不是比較');
  assert.equal(poolEligible(POIS.foodvs), false);
  assert.equal(poolEligible(POIS.foodback), true, '備案的站進池、只是不主動排當一餐');
});

test('層級：需求單點名 ②（店名一邊包含另一邊、店型字樣不算）、六星與有憑據的意義類 ③、品項 ④、其餘', () => {
  const targets = { go: ['喫茶三', '神社', '古著店'], buy: ['香水'] };
  assert.equal(levelOf(POIS.cafe3, targets).level, 2);
  assert.match(levelOf(POIS.cafe3, targets).why, /需求單點名「喫茶三」/);
  assert.equal(levelOf(POIS.shrinea, targets).level, 'rest', '「神社」是店型請求，不把所有神社都當②');
  assert.equal(levelOf({ ...POIS.cafe1, my: { rating: 6 } }).level, 3);
  assert.equal(levelOf({ ...POIS.foodx, significance: 'origin', significanceSource: '公會名錄' }).level, 3);
  assert.equal(levelOf({ ...POIS.foodx, significance: 'origin', significanceSource: null }).level, 'rest', '只有店家自述的意義不拿豁免（DESIGN §4）');
  assert.equal(levelOf(POIS.itema1).level, 4);
  assert.equal(levelOf({ ...POIS.street1, items: ['香水', '手帕'] }, targets).level, 4, '需求單要買的對得上 items[]');
  assert.equal(levelOf(POIS.street1, targets).level, 'rest');
  assert.equal(briefTextMatches({ id: 'xxnt', name_zh: 'XXNT（メメント）', name_local: 'memento' }, 'me'), false, '兩個字的文字只能被店名包含、不能反過來');
  assert.equal(briefTextMatches({ id: 'utah', name_zh: 'Utah（ユタ）', name_local: 'Utah' }, '我要去 utah 跟 squat'), true);
  for (const t of ['神社', '古著店', '唱片行', '咖啡廳']) assert.equal(isCategoryRequest(t), true, t);
  for (const t of ['喫茶三', 'Utah', '']) assert.equal(isCategoryRequest(t), false, t);
  // 店型對照表裡的品牌字（derive/category.json brandKeywords）：需求單寫「Yodobashi」「藤崎」是點名一家店，不是店型請求（10-16 審查後；之前會被當成電器行、百貨丟進 briefUnmatched）
  for (const t of ['Yodobashi', 'ヨドバシ', '三越', '藤崎', 'PARCO', 'S-PAL', '松本清', 'ツルハ']) assert.equal(isCategoryRequest(t), false, t);
  const yodobashi = { id: 'yodobashi-camera', name_zh: 'Yodobashi Camera 仙台（友都八喜）', name_local: 'ヨドバシカメラ マルチメディア仙台', category: 'electronics' };
  assert.equal(levelOf(yodobashi, { go: ['Yodobashi'], buy: [] }).level, 2);
  assert.equal(levelOf({ id: 'fujisaki', name_zh: '藤崎百貨（仙台在地老牌百貨）', name_local: '藤崎', category: 'department' }, { go: ['藤崎'], buy: [] }).level, 2);
});

test('freeIntervals：時窗扣掉固定時段釘住的段', () => {
  assert.deepEqual(freeIntervals(500, 1440, []), [[500, 1440]]);
  assert.deepEqual(freeIntervals(500, 1440, [[530, 1200]]), [[500, 530], [1200, 1440]]);
  assert.deepEqual(freeIntervals(540, 1350, [[1110, 1250]]), [[540, 1110], [1250, 1350]]);
  assert.deepEqual(freeIntervals(540, 1350, [[500, 1400]]), [], '整天被釘住');
  assert.deepEqual(freeIntervals(540, 1350, [[600, 700], [650, 800]]), [[540, 600], [800, 1350]], '兩段重疊');
});

test('當日區域：普通日＝據點步行圈 ∪ 錨點圈 ∪ 走廊；一日遊只拿主行程那一區、夜間站可回據點圈；離境日只拿據點那一區；抵達日據點圈', () => {
  assert.deepEqual([...walkCircle(graph, 'town', 20)].sort(), ['hill', 'town']);
  assert.deepEqual([...walkCircle(graph, 'town', 5)], ['town'], '走路 10 分超過 5 分就不算相鄰');
  const normal = regionZonesFor({ day: { type: 'normal' }, home: HOME, anchorPoi: POIS.shrinea, graph, settings });
  assert.deepEqual(normal.zones.sort(), ['hill', 'town']);
  assert.equal(normal.nightZones, null);
  const trip = regionZonesFor({ day: { type: 'normal', dayTrip: true }, home: HOME, anchorPoi: POIS.templesea, graph, settings });
  assert.deepEqual(trip.zones, ['sea']);
  assert.deepEqual(trip.nightZones.sort(), ['hill', 'town']);
  assert.deepEqual(regionZonesFor({ day: { type: 'departure' }, home: HOME, anchorPoi: null, graph, settings }).zones, ['town']);
  assert.deepEqual(regionZonesFor({ day: { type: 'arrival' }, home: HOME, anchorPoi: null, graph, settings }).zones.sort(), ['hill', 'town']);
  assert.deepEqual(regionZonesFor({ day: { type: 'normal' }, home: HOME, anchorPoi: null, graph, settings }).zones.sort(), ['hill', 'town'], '沒有主行程＝據點圈');
  // 直達 ≤15 分的區進錨點圈；走廊：經由某區轉一次比直達多不到 10 分
  const g2 = zoneGraph({ kb: { links: { 'a|b': { mode: 'subway', rideMin: 8, walkMin: 5 }, 'a|c': { mode: 'bus', rideMin: 30, walkMin: 5 }, 'b|c': { mode: 'bus', rideMin: 20, walkMin: 5 }, 'a|d': { mode: 'jr', rideMin: 40, walkMin: 5 } } } });
  const r2 = regionZonesFor({ day: { type: 'normal' }, home: { zoneId: 'a' }, anchorPoi: { zoneId: 'c' }, graph: g2, settings });
  assert.deepEqual(r2.zones.sort(), ['a', 'b', 'c'], 'b：a→b 13＋b→c 25＝38 ≤ 直達 35＋10，在走廊上；d 不在');
  assert.deepEqual(regionZonesFor({ day: { type: 'normal' }, home: { zoneId: 'c' }, anchorPoi: { zoneId: 'b' }, graph: g2, settings }).zones.sort(), ['a', 'b', 'c'], 'a 跟 b 直達 13 分 ≤ 15，進 b 的錨點圈');
  // 沒給 links 就拿 legFn 探
  const probed = zoneGraph({ legFn, zoneIds: ['town', 'hill', 'sea', 'far'] });
  assert.deepEqual([...walkCircle(probed, 'town', 20)].sort(), ['hill', 'town']);
  assert.equal(probed.direct.get('town').find((e) => e.to === 'sea').min, 35);
});

test('openWithin：時窗內開得夠久才算；沒有結構化營業時間回 null；當天休息 false', () => {
  assert.equal(openWithin(POIS.foodl, '2026-08-13', 540, 1350, 30), true);
  assert.equal(openWithin(POIS.foodl, '2026-08-13', 15 * 60, 22 * 60, 30), false, '午餐食堂 14:00 關');
  assert.equal(openWithin(POIS.closedpoi, '2026-08-13', 540, 1350, 30), false);
  assert.equal(openWithin({ hours: null }, '2026-08-13', 540, 1350, 30), null);
});

test('小世界四天：骨架不動、每天都有分到站、同一家整趟一次、站數不超過上限、不改傳入的 trip', () => {
  const before = JSON.stringify(TRIP);
  const r = run();
  assert.equal(JSON.stringify(TRIP), before, '不改傳入的 trip');
  assert.equal(r.days.length, 4);
  assert.deepEqual(ids(dayOf(r, '2026-08-13')).slice(0, 1), ['shrinea'], '主行程留在最前面');
  assert.deepEqual(dayOf(r, '2026-08-13').picks[0], { poiId: 'shrinea', priority: 'must', dwellMin: 60 }, '骨架的 pick 原樣');
  assert.ok(ids(dayOf(r, '2026-08-14')).includes('templet'), '指定站留著');
  assert.ok(ids(dayOf(r, '2026-08-14')).includes('gardeng'), '骨架只寫 anchor 沒寫 pick 的補上');
  assert.ok(!ids(dayOf(r, '2026-08-13')).includes('far1'), '換掉前的 picks 整個換掉（far1 區域外）');
  for (const d of r.days) assert.ok(d.picks.length >= 2, `${d.date} 要有分到站`);
  const all = r.days.flatMap(ids);
  assert.equal(new Set(all).size, all.length, '同一家整趟一次');
  for (const d of r.report.days) assert.ok(d.counts.total <= d.max, `${d.date} ${d.counts.total} ≤ ${d.max}`);
  assert.ok(r.report.verified, '跑了單日引擎驗證');
  for (const u of r.unplaced) assert.ok(u.reason, '留在候選池的都有理由');
  assert.equal(r.report.verify.skeletonDropped.length, 0);
  // 留池理由是最後重算的：說「落在 D 的 X」的，X 真的在 D 的 picks 裡；沒有程式鍵值露出
  for (const u of r.unplaced) {
    assert.doesNotMatch(u.reason, /undefined|\[object Object\]|NaN/);
    const m = u.reason.match(/落在 (\d{4}-\d{2}-\d{2}) 的 (.+)$/);
    if (m) assert.ok(ids(dayOf(r, m[1])).some((id) => (POIS[id]?.name_zh ?? id) === m[2]), `${u.name}：${u.reason}`);
  }
  assert.ok(Array.isArray(r.report.swapped) && Array.isArray(r.report.refilled) && Array.isArray(r.report.slotWarnings));
});

/** 一天裡算一餐的站（吃的、而且不是甜點攤） */
const meals = (day) => ids(day).filter((id) => POIS[id].category === 'food' && POIS[id].categoryMatched !== '甜點');

test('配額：非主題日咖啡廳每天 ≤2、每天午餐晚餐各一家吃的（甜點攤不算一餐）、夜間站一家；吃的站挑停留像一餐的', () => {
  const r = run();
  for (const d of r.days) {
    const cats = ids(d).map((id) => POIS[id].category);
    assert.ok(cats.filter((c) => c === 'cafe').length <= 2, `${d.date} 咖啡廳 ≤2`);
    assert.ok(meals(d).length <= 2, `${d.date} 一餐的站 ≤2`);
    assert.ok(cats.filter((c) => c === 'bar').length <= 1, `${d.date} 夜間站 ≤1`);
  }
  const d13 = r.report.days.find((d) => d.date === '2026-08-13');
  assert.deepEqual(d13.picks.filter((p) => p.slot === 'lunch').length, 1);
  assert.deepEqual(d13.picks.filter((p) => p.slot === 'dinner').length, 1);
  assert.deepEqual(d13.picks.filter((p) => p.slot === 'night').length, 1);
  const lunch13 = d13.picks.find((p) => p.slot === 'lunch');
  assert.ok(['foodl', 'foodx'].includes(lunch13.poiId), '午餐只能是午餐有開的');
  assert.ok(!ids(dayOf(r, '2026-08-16')).includes('foodd'), '離境日 13:00 收工，晚餐食堂排不上');
  // 三家咖啡廳：兩個普通日各最多兩家，第三家落到另一天，不留在池裡當配額滿
  const cafeDays = r.days.filter((d) => ids(d).some((id) => id.startsWith('cafe') && id !== 'cafesea')).map((d) => d.date);
  assert.ok(cafeDays.length >= 2, `三家咖啡廳分到 ≥2 天：${cafeDays}`);
});

test('購物類只在購物日：百貨只落到離境日（兩個完整天的旅程只有離境日是購物日）；品項落點不受限、同一品項只一家、帶 errand', () => {
  const r = run();
  const deptDay = r.days.find((d) => ids(d).includes('depts'));
  assert.equal(deptDay?.date, '2026-08-16');
  const placedItems = r.days.flatMap((d) => d.picks.filter((p) => p.poiId.startsWith('itema')));
  assert.equal(placedItems.length, 1, '同一品項整趟一個落點');
  assert.deepEqual(placedItems[0], { poiId: 'itema2', priority: 'maybe', errand: true }, '品項落點 maybe＋errand；停留 15 不用裁；兩家一樣近，研究標「首選」的那家先');
  const other = r.unplaced.find((u) => u.poiId === 'itema1');
  assert.match(other.reason, /品項「香水」落在 2026-08-\d\d 的 藥妝二（首選）/);
  assert.equal(r.unplaced.some((u) => u.poiId === 'gateskip'), false, '可略過的連池都不進');
});

test('研究標備案／保底的吃的站不主動排當一餐（原話 #6、#13 的善治郎）；比較條目不在池裡也不在報告裡；甜點攤不佔餐段', () => {
  const r = run();
  assert.ok(!r.days.some((d) => ids(d).includes('foodback')));
  assert.equal(r.unplaced.find((u) => u.poiId === 'foodback').reason, '研究標備案／保底的吃的站不主動排當一餐');
  assert.ok(!r.days.some((d) => ids(d).includes('foodvs')) && !r.unplaced.some((u) => u.poiId === 'foodvs'));
  const sweet = r.report.days.flatMap((d) => d.picks).find((p) => p.poiId === 'foodsweet');
  if (sweet) assert.equal(sweet.slot, null, '甜點攤排進去也不是午餐／晚餐');
  else assert.doesNotMatch(r.unplaced.find((u) => u.poiId === 'foodsweet').reason, /餐/, '甜點攤留池的理由不是餐段');
});

test('需求單點名的店名也對到品項研究站時：有不是品項站的店對得上就只算那家②、品項站照④；只有品項站對得上的照②', () => {
  const camera = { ...POIS.street1, id: 'yodocam', name_zh: 'Yodobashi Camera 小鎮', name_local: 'ヨドバシカメラ', category: 'electronics' };
  const sports = { ...POIS.itema1, id: 'yodosports', name_zh: 'Art Sports Yodobashi 小鎮店', name_local: 'アートスポーツ', item: '鞋' };
  const pois = { ...POIS, yodocam: camera, yodosports: sports };
  const r = allocateTrip({ trip: TRIP, pois, kb: KB, country: COUNTRY, settings, rules, legFn, brief: { persons: [{ isMe: true, go: { designated: ['Yodobashi'] } }] }, options: { verify: false } });
  const lvl = (res, id) => res.report.days.flatMap((d) => d.picks).find((p) => p.poiId === id)?.level ?? res.unplaced.find((u) => u.poiId === id)?.level;
  assert.equal(lvl(r, 'yodocam'), 2);
  assert.equal(lvl(r, 'yodosports'), 4, '品項站不因為店名裡有 Yodobashi 升成②');
  assert.equal(r.report.pool.byLevel[2], 1);
  const r2 = allocateTrip({ trip: TRIP, pois, kb: KB, country: COUNTRY, settings, rules, legFn, brief: { persons: [{ isMe: true, go: { designated: ['Art Sports'] } }] }, options: { verify: false } });
  assert.equal(lvl(r2, 'yodosports'), 2, '只有品項站對得上：照②');
});

test('固定時段日：候選只看釘住以外的空檔有沒有開（整天看有開不算）；站數目標扣掉釘住的整段', () => {
  const venuev = { ...POIS.gardeng, id: 'venuev', name_zh: '會場', category: 'venue' };
  const dayshop = { ...POIS.street1, id: 'dayshop', name_zh: '白天的店', hours: Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, [['12:00', '17:00']]])) };
  const fixedDay = { date: '2026-08-13', type: 'fixed', earlyDay: true, departHM: '08:20', anchor: { poiId: 'venuev' }, picks: [{ poiId: 'venuev', priority: 'must', fixedWindow: { startMin: 570, endMin: 1170, arriveEarlyMin: 40, afterMin: 30 } }] };
  const pois = { venuev, dayshop, barn1: POIS.barn1, street1: POIS.street1 };
  const one = allocateTrip({ trip: { id: 'fixed1', party: 1, homeBases: [{ poi: HOME }], days: [fixedDay] }, pois, kb: KB, country: COUNTRY, settings, rules, legFn, options: { verify: false } });
  const d13 = one.report.days[0];
  assert.deepEqual(d13.free, [[500, 530], [1200, 1440]], '08:20–08:50 與 20:00–24:00 是空檔');
  assert.deepEqual([d13.target, d13.max], [3, 3], '時窗 08:20–22:30 扣掉 08:50–20:00 剩三小時');
  assert.ok(!ids(one.days[0]).includes('dayshop'), '12:00–17:00 開的店整天看是有開、空檔裡沒有');
  assert.equal(one.unplaced.find((u) => u.poiId === 'dayshop').reason, '固定時段以外沒有它開著的空檔');
  assert.ok(ids(one.days[0]).includes('barn1'), '晚上空檔開著的酒吧當夜間站');
  assert.ok(ids(one.days[0]).includes('street1'), '整天開的店落在晚上的空檔');
  // 多一個普通日：白天的店分到那天
  const two = allocateTrip({ trip: { id: 'fixed2', party: 1, homeBases: [{ poi: HOME }], days: [fixedDay, { date: '2026-08-14', type: 'normal', anchor: { poiId: 'gardeng' }, picks: [] }] }, pois: { ...pois, gardeng: POIS.gardeng }, kb: KB, country: COUNTRY, settings, rules, legFn, options: { verify: false } });
  assert.ok(ids(dayOf(two, '2026-08-14')).includes('dayshop'));
});

test('抵達日晚上有夜間站（#18 每晚都排；night-slot 只是不要求、沒禁）；離境日沒有', () => {
  const trip = { id: 'arr', party: 1, homeBases: [{ poi: HOME }], days: [
    { date: '2026-08-13', type: 'arrival', arriveMin: 15 * 60, picks: [] },
    { date: '2026-08-14', type: 'normal', anchor: { poiId: 'gardeng' }, picks: [] },
    { date: '2026-08-15', type: 'departure', departAirportMin: 23 * 60, picks: [] },
  ] };
  const pois = { gardeng: POIS.gardeng, barn1: POIS.barn1, barn2: POIS.barn2, barn3: POIS.barn3, street1: POIS.street1, foodd: POIS.foodd };
  const r = allocateTrip({ trip, pois, kb: KB, country: COUNTRY, settings, rules, legFn, options: { verify: false } });
  assert.deepEqual([r.report.days[0].window.startMin, r.report.days[0].window.endMin], [16 * 60, 22 * 60 + 30]);
  assert.ok(ids(dayOf(r, '2026-08-13')).some((id) => id.startsWith('barn')), '抵達晚上排一家');
  assert.ok(!ids(dayOf(r, '2026-08-15')).some((id) => id.startsWith('barn')), '離境日沒有夜間站');
  // 只有離境日的旅程：酒吧的理由就是離境日那一條（三天的旅程報的是多數天的「夜間站有了」）
  const dep = allocateTrip({ trip: { ...trip, days: [trip.days[2]] }, pois: { barn1: POIS.barn1, street1: POIS.street1 }, kb: KB, country: COUNTRY, settings, rules, legFn, options: { verify: false } });
  assert.equal(dep.unplaced.find((u) => u.poiId === 'barn1').reason, '離境日、城際移動日晚上沒有夜間站');
});

test('驗證丟了品項落點的那家：第二輪換同品項的另一家（report.swapped），留池理由指向新落點', () => {
  const anchor1 = { ...POIS.gardeng, id: 'anchor1', name_zh: '庭園一' };
  // 近的那家跟第一天的主行程同區、遠的跟第二天的同區；同區的腳程壓到 2 分（town↔hill 走路 10），兩家各對自己那天 2 分、同分取 id 序在前的：item1near 先落第一天
  const itemnear = { ...POIS.itema1, id: 'item1near', name_zh: '藥妝近', item: '鞋' };
  const itemfar = { ...POIS.itema1, id: 'item2far', name_zh: '藥妝遠', item: '鞋', zoneId: 'hill' };
  const pois = { anchor1, shrinea: POIS.shrinea, item1near: itemnear, item2far: itemfar };
  const legFn2 = makeLegFn({ walk: {}, settings, zoneLinks: KB.links, fallbackMin: { sameZone: 2 } });
  const trip = { id: 'swap', party: 1, homeBases: [{ poi: HOME }], days: [
    { date: '2026-08-13', type: 'normal', anchor: { poiId: 'anchor1' }, picks: [] },
    { date: '2026-08-14', type: 'normal', anchor: { poiId: 'shrinea' }, picks: [] },
  ] };
  const dry = allocateTrip({ trip, pois, kb: KB, country: COUNTRY, settings, rules, legFn: legFn2, options: { verify: false } });
  assert.ok(ids(dayOf(dry, '2026-08-13')).includes('item1near'), '沒驗證時近的那家落第一天');
  // 單日引擎加一條測試用硬規則：藥妝近哪天都排不進
  const dropNear = { id: 'test-drop-near', kind: 'hard', reads: ['stop.poi.id'], defaults: {}, apply: (ctx) => (ctx.stop.poi.id === 'item1near' ? 'never' : 'ok'), warn: () => '測試：這家排不進' };
  const r = allocateTrip({ trip, pois, kb: KB, country: COUNTRY, settings, rules: loadRules([...BUILTIN, dropNear], rulesJson.rules), legFn: legFn2 });
  assert.ok(!r.days.some((d) => ids(d).includes('item1near')));
  assert.ok(ids(dayOf(r, '2026-08-14')).includes('item2far'), '同品項的另一家接手（近的那家對第二天 10 分、遠的 0 分）');
  assert.equal(r.report.swapped.length, 1);
  assert.deepEqual([r.report.swapped[0].item, r.report.swapped[0].from.poiId, r.report.swapped[0].from.date, r.report.swapped[0].to.poiId, r.report.swapped[0].to.date], ['鞋', 'item1near', '2026-08-13', 'item2far', '2026-08-14']);
  assert.equal(r.report.moved.length, 0, '換店不算搬天');
  assert.equal(r.unplaced.find((u) => u.poiId === 'item1near').reason, '品項「鞋」落在 2026-08-14 的 藥妝遠', '理由指向最後的落點、不是被丟的那家');
  assert.equal(r.report.verify.dropped.length, 0);
});

test('一日遊只拿主行程那一區（夜間站可回據點圈）；活動只跟著主行程也是活動的那天', () => {
  const r = run();
  const d15 = ids(dayOf(r, '2026-08-15'));
  assert.ok(d15.includes('templesea'));
  for (const id of d15) assert.ok(POIS[id].zoneId === 'sea' || POIS[id].category === 'bar', `${id} 不該在一日遊那天`);
  assert.ok(d15.includes('cafesea') && d15.includes('foodsea'), '海邊的喫茶與食堂跟著一日遊');
  assert.match(r.unplaced.find((u) => u.poiId === 'evente').reason, /活動只跟著主行程也是活動的那天/);
});

test('分不進的理由：整趟沒開、不在當日區域；位子不夠時站數滿', () => {
  const r = run();
  assert.equal(r.unplaced.find((u) => u.poiId === 'closedpoi').reason, '那天沒開');
  assert.equal(r.unplaced.find((u) => u.poiId === 'far1').reason, '不在當日區域');
  assert.equal(r.unplaced.some((u) => /^站數滿/.test(u.reason)), false, '小世界四天位子夠，沒有站數滿');
  const tight = allocateTrip({ trip: TRIP, pois: POIS, kb: KB, country: COUNTRY, settings: { ...settings, allocTargetStops: 3, allocMaxStops: 3, allocDayTripTargetStops: 2, allocDayTripMaxStops: 2 }, rules, legFn, options: { verify: false } });
  assert.ok(tight.unplaced.some((u) => u.reason === '站數滿（上限 3）'), `上限 3 時要有站數滿：${tight.unplaced.map((u) => `${u.poiId}:${u.reason}`).join('；')}`);
});

test('站數上限：目標與上限照 settings，時窗短的日子照一點一小時縮；一日遊用一日遊的數字', () => {
  const r = run();
  const by = Object.fromEntries(r.report.days.map((d) => [d.date, d]));
  assert.deepEqual([by['2026-08-13'].target, by['2026-08-13'].max], [6, 8]);
  assert.deepEqual([by['2026-08-15'].target, by['2026-08-15'].max], [5, 6]);
  assert.deepEqual([by['2026-08-16'].target, by['2026-08-16'].max], [4, 5], '離境日 09:00–13:00 四小時');
  const tight = allocateTrip({ trip: TRIP, pois: POIS, kb: KB, country: COUNTRY, settings: { ...settings, allocTargetStops: 3, allocMaxStops: 3 }, rules, legFn, options: { verify: false } });
  for (const d of tight.report.days.filter((d) => !d.dayTrip)) assert.ok(d.counts.total <= 3, `${d.date} 上限 3`);
});

test('②先分：需求單點名的店先分、priority want；店型字樣與對不上的記進 briefUnmatched', () => {
  const brief = { persons: [{ isMe: true, go: { designated: ['喫茶三', '神社', '不存在的店'], mustEat: ['晚餐食堂'] }, buy: { own: [] } }], errands: [{ what: '香水' }] };
  const r = run({ brief });
  const cafe3 = r.days.flatMap((d) => d.picks).find((p) => p.poiId === 'cafe3');
  assert.deepEqual(cafe3, { poiId: 'cafe3', priority: 'want' });
  const foodd = r.days.flatMap((d) => d.picks).find((p) => p.poiId === 'foodd');
  assert.deepEqual(foodd, { poiId: 'foodd', priority: 'want' });
  assert.deepEqual(r.report.briefUnmatched.map((b) => b.text).sort(), ['不存在的店', '神社']);
  assert.equal(r.report.briefUnmatched.find((b) => b.text === '神社').reason, '寫的是店型，研究來分');
  assert.equal(r.report.pool.byLevel[2], 2);
  // 沒給 brief 就讀 trip.brief
  const r2 = allocateTrip({ trip: { ...TRIP, brief }, pois: POIS, kb: KB, country: COUNTRY, settings, rules, legFn, options: { verify: false } });
  assert.equal(r2.report.pool.byLevel[2], 2);
});

test('重疊率：換掉前的 picks（骨架以外）有幾家分配器也選到、同一天幾家', () => {
  const r = run();
  assert.equal(r.report.overlap.original, 2, 'cafe1 與 far1');
  assert.equal(r.report.overlap.matched, 1, 'cafe1 有分到、far1 區域外');
  assert.ok(r.report.overlap.sameDay <= 1);
  const skeletonOnly = { ...TRIP, days: TRIP.days.map((d) => ({ ...d, picks: d.picks.filter((p) => p.poiId === 'shrinea') })) };
  assert.equal(allocateTrip({ trip: skeletonOnly, pois: POIS, kb: KB, country: COUNTRY, settings, rules, legFn, options: { verify: false } }).report.overlap, null);
});

test('planDay 驗證後搬天：營業時間太短、單日引擎排不進的站搬到下一個合適的天（丟掉的那天不再試）', () => {
  const mover = { id: 'amover', name_zh: '搬家測試', name_local: 'amover', category: 'street', walkFactor: 1, recovery: false, cafeLike: false, climbMin: 0, zoneId: 'town', dwellMin: 70, daylightOnly: false, my: {}, hours: { thu: [['09:00', '10:00']], fri: [['09:00', '20:00']] } };
  const anchor1 = { ...POIS.gardeng, id: 'anchor1', name_zh: '庭園一' };
  const anchor2 = { ...POIS.gardeng, id: 'anchor2', name_zh: '庭園二' };
  const pois = { anchor1, anchor2, amover: mover };   // 只有主行程與它：兩天站數一樣多，分數同分取第一天
  const trip = { id: 'mover', party: 1, homeBases: [{ poi: HOME }], days: [
    { date: '2026-08-13', type: 'normal', anchor: { poiId: 'anchor1' }, picks: [] },
    { date: '2026-08-14', type: 'normal', anchor: { poiId: 'anchor2' }, picks: [] },
  ] };
  const dry = allocateTrip({ trip, pois, kb: KB, country: COUNTRY, settings, rules, legFn, options: { verify: false } });
  assert.ok(ids(dayOf(dry, '2026-08-13')).includes('amover'), '沒驗證時它落在第一天（09:00–10:00 開一小時過了預篩）');
  const r = allocateTrip({ trip, pois, kb: KB, country: COUNTRY, settings, rules, legFn });
  assert.deepEqual(r.report.moved.map((m) => [m.poiId, m.from, m.to]), [['amover', '2026-08-13', '2026-08-14']]);
  assert.ok(ids(dayOf(r, '2026-08-14')).includes('amover'));
  assert.ok(!ids(dayOf(r, '2026-08-13')).includes('amover'));
  assert.equal(r.report.verify.dropped.length, 0, '搬過去排得進');
});

test('沒有國家層餐段時吃的一天最多 2 家、夜間站仍一家；沒有主行程的普通日照據點圈分', () => {
  const trip = { ...TRIP, days: TRIP.days.map((d) => ({ ...d, anchor: undefined, designated: undefined, picks: [] })) };
  const r = allocateTrip({ trip, pois: POIS, kb: KB, country: null, settings, rules, legFn, options: { verify: false } });
  for (const d of r.days) {
    const cats = ids(d).map((id) => POIS[id].category);
    assert.ok(meals(d).length <= 2, `${d.date} 一餐的站 ≤2`);
    assert.ok(cats.filter((c) => c === 'bar').length <= 1, `${d.date} 夜間站 ≤1`);
  }
  assert.ok(r.report.days.every((d) => d.anchorName === null));
  // 一日遊卻沒寫主行程＝不知道往哪個方向：退回據點圈照普通日分（總則 0 永遠排得出來；推導）
  assert.deepEqual(r.report.days.find((d) => d.date === '2026-08-15').regionZones.sort(), ['hill', 'town']);
  assert.ok(ids(dayOf(r, '2026-08-15')).every((id) => ['town', 'hill'].includes(POIS[id].zoneId)));
});
