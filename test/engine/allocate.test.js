// 多日分配器 v1（T17；規則草案 docs/superpowers/plans/2026-10-16-trip-pilot-t17-allocator-draft.md）：
// 骨架不動、②先分、非主題日同類 ≤2、購物類只在購物日、一日遊只拿那區、沒開的不分、站數上限、planDay 驗證後搬天／換店／回填、同一家整趟一次、同一品項一個落點、門、不改傳入的 trip；
// 10-16 審查後加：品牌字不算店型請求、研究註記（首選／備案）、比較條目不進池、固定時段日只看空檔、抵達日有夜間站、留池理由最後重算。
// 11-06 研究註記搬成知識庫欄位（researchRank／researchSkip／notAStop；原話 #191 其餘照預設）：有欄位照欄位、整個欄位沒有才退回店名字樣；
// 小世界夾具（test/fixtures/alloc-world.js）留著店名字樣版＝還沒欄位化的知識庫，欄位版在這個檔裡另組（FIELD_POIS）、兩版分出來要一模一樣。
// 11-06 第二批：需求單點名的店不看「不主動排」的門（檔尾三條）；點名卻排不了的進 briefUnmatched 並講原因。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allocateTrip, poolEligible, poolGatesOf, NAMED_BYPASS, NAMED_CATEGORY_BYPASS, levelOf, briefTextMatches, isCategoryRequest, regionZonesFor, zoneGraph, walkCircle, openWithin, researchSaysSkip, researchRank, comparisonEntry, freeIntervals, ALLOC_DEFAULTS } from '../../src/engine/allocate.js';
import { planTrip } from '../../src/engine/trip.js';
import { researchNameHints } from '../../src/rules/_helpers.js';
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

// ── 11-06 研究註記搬成知識庫欄位：有欄位照欄位、整個欄位沒有才退回店名字樣 ──
/** 小世界的欄位版：四家靠店名字樣的店改成乾淨店名＋欄位（仙台包 11-06 之後的樣子）；其餘三十來家原樣。 */
const FIELD_POIS = {
  ...POIS,
  foodback: { ...POIS.foodback, name_zh: '巷口食堂', researchRank: 'backup', researchNote: '保底備案' },
  foodvs: { ...POIS.foodvs, name_zh: '站內兩家食堂', notAStop: true },
  itema2: { ...POIS.itema2, name_zh: '藥妝二', researchRank: 'first', researchNote: '首選' },
  gateskip: { ...POIS.gateskip, name_zh: '百貨香氛區', researchSkip: '查證結果：無貨，可略過' },
};

test('欄位版的小世界（店名清掉註記字、改寫欄位）分出來跟店名字樣版一模一樣：每天的 picks、池子、留池的店與理由', () => {
  for (const id of ['foodback', 'foodvs', 'itema2', 'gateskip']) assert.deepEqual(researchNameHints(FIELD_POIS[id]), { rank: null, skip: false, notAStop: false }, `${id} 的店名已經沒有註記字`);
  const byName = run();
  const byField = run({ pois: FIELD_POIS });
  assert.deepEqual(byField.days, byName.days, '每天分到的店、priority、順路購買都相同');
  assert.deepEqual(byField.report.pool, byName.report.pool);
  assert.deepEqual(byField.unplaced.map((u) => [u.poiId, u.level]), byName.unplaced.map((u) => [u.poiId, u.level]));
  assert.deepEqual(byField.unplaced.map((u) => u.reason), byName.unplaced.map((u) => u.reason.replace('藥妝二（首選）', '藥妝二')), '留池理由只差店名');
  assert.deepEqual([byField.report.moved, byField.report.swapped, byField.report.refilled, byField.report.verify], [byName.report.moved, byName.report.swapped, byName.report.refilled, byName.report.verify]);
  // 靠欄位擋的四件事都還在
  assert.equal(byField.unplaced.find((u) => u.poiId === 'foodback').reason, '研究標備案／保底的吃的站不主動排當一餐');
  assert.ok(!byField.days.some((d) => ids(d).includes('foodvs')) && !byField.unplaced.some((u) => u.poiId === 'foodvs'), '不是地點的條目連池都不進');
  assert.deepEqual(byField.days.flatMap((d) => d.picks.filter((p) => p.poiId.startsWith('itema'))).map((p) => p.poiId), ['itema2'], '同品項兩家一樣近，標 first 的先');
  assert.match(byField.unplaced.find((u) => u.poiId === 'itema1').reason, /品項「香水」落在 2026-08-\d\d 的 藥妝二$/);
  assert.equal(byField.unplaced.some((u) => u.poiId === 'gateskip'), false, '研究判可略過的連池都不進');
});

test('有欄位時不看店名：欄位跟店名字樣相反時照欄位（researchRank、researchSkip、notAStop）；寫 null／false／空字串＝明講沒有；看不懂的值當沒標', () => {
  assert.equal(researchRank({ name_zh: '店名還帶著（首選）', researchRank: 'backup' }), 2);
  assert.equal(researchRank({ name_zh: '店名還帶著（保底備案）', researchRank: 'first' }), 0);
  assert.equal(researchRank({ name_zh: '乾淨的店名', researchRank: 'first' }), 0);
  assert.equal(researchRank({ name_zh: '乾淨的店名', researchRank: 'backup' }), 2);
  assert.equal(researchRank({ name_zh: '店名還帶著（保底備案）', researchRank: null }), 1, 'null＝明講沒標，不退回店名');
  assert.equal(researchRank({ name_zh: '店名還帶著（首選）', researchRank: 'frist' }), 1, '看不懂的值當沒標、也不退回店名（normalizePoi 會記警告 research-field-bad）');
  assert.equal(researchSaysSkip({ name_zh: '乾淨的店名', researchSkip: '查證結果：未見 DKNY，可略過' }), true, '一句理由');
  assert.equal(researchSaysSkip({ name_zh: '乾淨的店名', researchSkip: true }), true);
  assert.equal(researchSaysSkip({ name_zh: '店名還帶著（可略過）', researchSkip: false }), false);
  assert.equal(researchSaysSkip({ name_zh: '店名還帶著（不可指望）', researchSkip: '  ' }), false, '空字串＝不略過');
  assert.equal(researchSaysSkip({ name_zh: '店名還帶著（可略過）', researchSkip: null }), false);
  assert.equal(researchSaysSkip({ name_zh: '乾淨的店名', researchSkip: null, skip: true }), false, '有 researchSkip 欄位就不看舊寫法 skip');
  assert.equal(researchSaysSkip({ name_zh: '乾淨的店名', researchSkip: 3 }), false, '看不懂的值不略過');
  assert.equal(comparisonEntry({ name_zh: '站內兩家牛舌', notAStop: true }), true);
  assert.equal(comparisonEntry({ name_zh: '甲 vs 乙', notAStop: false }), false);
  assert.equal(comparisonEntry({ name_zh: '甲 vs 乙', notAStop: null }), false);
  assert.equal(comparisonEntry({ name_zh: '站內兩家牛舌', notAStop: 'yes' }), false, 'true 才算');
  // 池的門照欄位
  assert.equal(poolEligible({ id: 'x', category: 'food', name_zh: '甲 vs 乙', notAStop: false }), true);
  assert.equal(poolEligible({ id: 'x', category: 'food', name_zh: '站內兩家牛舌', notAStop: true }), false);
  assert.equal(poolEligible({ id: 'x', category: 'store', name_zh: '乾淨的店名', researchSkip: '目標品不在' }), false);
  assert.equal(poolEligible({ id: 'x', category: 'store', name_zh: '店名還帶著（可略過）', researchSkip: false }), true);
  // 分配：同品項兩家一樣近，店名寫「首選」的那家（itema2）欄位標 backup、另一家標 first → 落標 first 的 itema1（店名字樣版落的是 itema2）
  const flipped = { ...POIS, itema1: { ...POIS.itema1, researchRank: 'first' }, itema2: { ...POIS.itema2, researchRank: 'backup' } };
  const r = run({ pois: flipped, options: { verify: false } });
  assert.deepEqual(r.days.flatMap((d) => d.picks.filter((p) => p.poiId.startsWith('itema'))).map((p) => p.poiId), ['itema1']);
  // 店名還寫「保底備案」但欄位明講沒有（null）：照一般的吃的站算，不再被「備案不排當一餐」擋
  const cleared = run({ pois: { ...POIS, foodback: { ...POIS.foodback, researchRank: null } }, options: { verify: false } });
  assert.notEqual(cleared.unplaced.find((u) => u.poiId === 'foodback')?.reason, '研究標備案／保底的吃的站不主動排當一餐');
  // 店名寫「A vs B」但欄位明講是地點（false）：進池
  const asStop = run({ pois: { ...POIS, foodvs: { ...POIS.foodvs, notAStop: false } }, options: { verify: false } });
  assert.ok(asStop.days.some((d) => ids(d).includes('foodvs')) || asStop.unplaced.some((u) => u.poiId === 'foodvs'), '進了池（排進某天或帶理由留池）');
});

test('沒欄位退回店名字樣（還沒欄位化的知識庫）：認「首選」「備案／保底／備援」「可略過／不可指望」「A vs B」；舊寫法 skip: true 也算', () => {
  assert.deepEqual(researchNameHints({ name_zh: '松本清 仙台Clis Road店（首選：大店＋順路＋開到22點）' }), { rank: 'first', skip: false, notAStop: false });
  assert.deepEqual(researchNameHints({ name_zh: '仙台機場免稅店 VEGA（備案查證結果：不可指望）' }), { rank: 'backup', skip: true, notAStop: false });
  assert.deepEqual(researchNameHints({ name_zh: '利久 vs 善治郎（站內牛舌通比較吃）' }), { rank: null, skip: false, notAStop: true });
  assert.deepEqual(researchNameHints({ name_zh: '首選之外也寫了備案的店（首選；備案是隔壁）' }), { rank: 'first', skip: false, notAStop: false }, '兩種都寫時算首選（跟搬欄位前同一個先後）');
  assert.deepEqual(researchNameHints({ name_zh: '松本清 仙台Clis Road店' }), { rank: null, skip: false, notAStop: false });
  assert.deepEqual(researchNameHints(null), { rank: null, skip: false, notAStop: false });
  // 整個欄位沒有（undefined）才看店名
  assert.equal(researchRank({ name_zh: '大國藥妝 仙台Clis Road店（開最晚：週一到22:50的保底站）' }), 2);
  assert.equal(researchRank({ name_zh: '唐吉訶德 仙台站西口本店（首選碰運氣點）', researchRank: undefined }), 0, 'undefined 視同沒有這個欄位');
  assert.equal(researchSaysSkip({ name_zh: '仙台三越 本館1F（查證結果：無 DKNY 專櫃，可略過）' }), true);
  assert.equal(researchSaysSkip({ name_zh: '普通店', skip: true }), true, '舊寫法');
  assert.equal(comparisonEntry({ name_zh: '食堂甲 vs. 食堂乙' }), true);
  // 小世界夾具本身就是沒欄位的知識庫：四家靠店名字樣的店照舊擋（這個檔其他用 run() 的測試跑的都是它）
  for (const id of ['foodback', 'foodvs', 'itema2', 'gateskip']) for (const f of ['researchRank', 'researchSkip', 'notAStop', 'skip']) assert.equal(POIS[id][f], undefined, `${id}.${f}`);
  assert.equal(researchRank(POIS.foodback), 2); assert.equal(researchRank(POIS.itema2), 0); assert.equal(researchRank(POIS.itema1), 1);
  assert.equal(poolEligible(POIS.foodvs), false); assert.equal(poolEligible(POIS.gateskip), false);
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

test('一日遊只拿主行程那一區（夜間站與回城後的晚餐可回據點圈，細節在 allocate-daytrip.test.js）；活動只跟著主行程也是活動的那天', () => {
  const r = run();
  const d15 = ids(dayOf(r, '2026-08-15'));
  assert.ok(d15.includes('templesea'));
  const slotOf = (id) => r.report.days.find((d) => d.date === '2026-08-15').picks.find((p) => p.poiId === id)?.slot;
  for (const id of d15) assert.ok(POIS[id].zoneId === 'sea' || POIS[id].category === 'bar' || (POIS[id].category === 'food' && slotOf(id) === 'dinner'), `${id} 不該在一日遊那天`);
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

// ── 11-06 第二批：需求單點名的店不看「不主動排」的門（總則 3：沒有硬排除清單、點名的一律排）──
test('poolGatesOf：一家店卡在哪幾道門；沒卡回空陣列；poolEligible 就是一道都沒卡；點名蓋得過的是不主動排的那五道，排不了的兩道蓋不過', () => {
  assert.deepEqual(poolGatesOf(POIS.cafe1), []);
  assert.deepEqual(poolGatesOf(POIS.gatecurated), ['curated']);
  assert.deepEqual(poolGatesOf(POIS.gaterating), ['rating']);
  assert.deepEqual(poolGatesOf(POIS.gatelosses), ['losses']);
  assert.deepEqual(poolGatesOf(POIS.gateunlock), ['unlock']);
  assert.deepEqual(poolGatesOf(POIS.gateskip), ['skip']);
  assert.deepEqual(poolGatesOf(POIS.foodvs), ['notAStop']);
  assert.deepEqual(poolGatesOf({ id: 'x', category: 'spot' }), ['category']);
  assert.deepEqual(poolGatesOf({ id: 'x', name_zh: '甲 vs 乙', category: 'daytrip', curated: false, unlockWhen: '下次' }), ['category', 'curated', 'unlock', 'notAStop'], '可以同時卡好幾道');
  assert.deepEqual(poolGatesOf(null), []);
  assert.equal(poolEligible(null), false);
  assert.equal(poolEligible({ name_zh: '沒有 id' }), false);
  assert.deepEqual([...NAMED_BYPASS].sort(), ['curated', 'losses', 'rating', 'skip', 'unlock']);
  assert.ok(!NAMED_BYPASS.has('category') && !NAMED_BYPASS.has('notAStop'));
  // 店型那一道門只有坐下來的地方被點名時蓋得過（11-11）；交通、會場、一日遊摘要蓋不過
  assert.deepEqual([...NAMED_CATEGORY_BYPASS], ['spot']);
});

test('需求單點名的店被候選池的門擋住時照點名那一層排（挖寶型、未解鎖、研究判可略過、≤2 星、落選兩次）、理由欄寫明哪道門被點名蓋過；研究標備案的吃的站被點名也排當一餐；沒被點名的照舊不進池', () => {
  const brief = { persons: [{ isMe: true, go: { designated: ['挖寶倉庫', '下次再說', '踩雷店', '落選兩次', '查證結果：無貨'], mustEat: ['保底食堂'] }, buy: { own: [] } }], errands: [] };
  const r = run({ brief });
  const picks = r.report.days.flatMap((d) => d.picks.map((p) => ({ ...p, date: d.date })));
  const pickOf = (id) => picks.find((p) => p.poiId === id);
  for (const [id, gate] of [['gatecurated', '挖寶型的店'], ['gateunlock', '還沒到解鎖條件'], ['gaterating', '你評過 2 星以下'], ['gatelosses', '落選過兩次'], ['gateskip', '研究判這趟可略過']]) {
    const p = pickOf(id);
    assert.ok(p, `${id} 被點名：排進去`);
    assert.deepEqual([p.level, p.priority], [2, 'want'], id);
    assert.match(p.why, /^需求單點名「.+」（.+，點名照排）$/, id);
    assert.ok(p.why.includes(gate), `${id} 的理由欄寫「${gate}」：${p.why}`);
  }
  // 可略過的那一筆是藥妝（購物類）、被點名後不是品項落點：照購物類只落在購物日（離境日）
  assert.equal(pickOf('gateskip').date, '2026-08-16');
  // 研究標備案的吃的站：沒被點名時「不主動排當一餐」，被點名就照排、佔一個餐段
  const back = pickOf('foodback');
  assert.ok(back && ['lunch', 'dinner'].includes(back.slot), '保底食堂被點名：排當一餐');
  assert.equal(back.why, '需求單點名「保底食堂」', '它本來就過得了門，理由欄不加註');
  assert.equal(r.report.pool.byLevel[2], 6);
  assert.deepEqual(r.report.briefUnmatched, []);
  // 寫進旅程檔的 picks 跟一般的 ② 一樣（沒有多的欄位）
  assert.deepEqual(r.days.flatMap((d) => d.picks).find((p) => p.poiId === 'gatecurated'), { poiId: 'gatecurated', priority: 'want' });
  // 沒被點名：五家照舊連池都不進、備案照舊不排
  const plain = run();
  for (const id of ['gatecurated', 'gateunlock', 'gaterating', 'gatelosses', 'gateskip']) assert.ok(!plain.days.some((d) => ids(d).includes(id)) && !plain.unplaced.some((u) => u.poiId === id), `${id} 沒被點名不進池`);
  assert.equal(plain.unplaced.find((u) => u.poiId === 'foodback').reason, '研究標備案／保底的吃的站不主動排當一餐');
  // 需求單要買的（④）不算點名：對到挖寶型的店照舊不進池
  const buy = run({ brief: { persons: [{ isMe: true, go: {}, buy: { own: ['挖寶倉庫'] } }], errands: [] } });
  assert.ok(!buy.days.some((d) => ids(d).includes('gatecurated')) && !buy.unplaced.some((u) => u.poiId === 'gatecurated'));
});

test('點名卻排不了的列進「對不上」並講原因：不是一個地點的條目、分配器不分的站型（交通、會場、一日遊摘要）、他按過「不去了」；同一句也對到排得了的店就不列', () => {
  const guide = { ...POIS.street1, id: 'guidex', name_zh: '海邊一日遊攻略', name_local: 'guidex', category: 'daytrip' };
  const hall = { ...POIS.street1, id: 'hallx', name_zh: '國際會議中心', name_local: 'hallx', category: 'venue' };
  const bus = { ...POIS.street1, id: 'busx', name_zh: '循環巴士一日券', name_local: 'busx', category: 'logistics' };
  const compare = { ...POIS.foodvs, id: 'foodvs3', name_zh: '整天食堂 vs 晚餐食堂', name_local: 'foodvs3' };
  const trip = { ...TRIP, days: TRIP.days.map((d, i) => (i === 1 ? { ...d, removed: [{ poiId: 'cafe3' }] } : d)) };
  const brief = { persons: [{ isMe: true, go: { designated: ['食堂甲 vs 食堂乙', '海邊一日遊攻略', '國際會議中心', '循環巴士一日券', '喫茶三', '整天食堂'], mustEat: [] }, buy: { own: [] } }], errands: [] };
  const r = allocateTrip({ trip, pois: { ...POIS, guidex: guide, hallx: hall, busx: bus, foodvs3: compare }, kb: KB, country: COUNTRY, settings, rules, legFn, brief, options: { verify: false } });
  const by = Object.fromEntries(r.report.briefUnmatched.map((b) => [b.text, b]));
  assert.deepEqual(Object.keys(by).sort(), ['喫茶三', '海邊一日遊攻略', '國際會議中心', '循環巴士一日券', '食堂甲 vs 食堂乙'].sort(), '「整天食堂」也對到比較條目，但對得到排得了的那家食堂，不列');
  assert.ok(r.report.days.some((d) => d.picks.some((p) => p.poiId === 'foodx' && p.level === 2)), '整天食堂照②排');
  assert.equal(by['食堂甲 vs 食堂乙'].reason, '對到「食堂甲 vs 食堂乙（站內比較吃）」，是比較或彙整的條目，不是一個可以排的地點，沒排');
  assert.equal(by['海邊一日遊攻略'].reason, '對到「海邊一日遊攻略」，是一日遊的摘要條目，不是一個地點，沒排');
  assert.equal(by['國際會議中心'].reason, '對到「國際會議中心」，是會場，那天有固定時段才排，沒排');
  assert.equal(by['循環巴士一日券'].reason, '對到「循環巴士一日券」，是交通或資訊的條目，不是一站，沒排');
  assert.equal(by['喫茶三'].reason, '對到「喫茶三」，你按過「不去了」，沒排');
  assert.deepEqual(by['喫茶三'].poiIds, ['cafe3']);
  for (const id of ['foodvs', 'guidex', 'hallx', 'busx', 'cafe3']) assert.ok(!r.days.some((d) => ids(d).includes(id)) && !r.unplaced.some((u) => u.poiId === id), `${id} 不排、也不在留池清單（在對不上清單）`);
  // 不是一個地點、又剛好未解鎖：只講排不了的那個原因（未解鎖是點名蓋得過的）
  const locked = { ...POIS.foodvs, id: 'foodvs2', name_zh: '麵店甲 vs 麵店乙', name_local: 'foodvs2', unlockWhen: '吃無可吃' };
  const r2 = allocateTrip({ trip: TRIP, pois: { ...POIS, foodvs2: locked }, kb: KB, country: COUNTRY, settings, rules, legFn, brief: { persons: [{ isMe: true, go: { designated: ['麵店甲 vs 麵店乙'] }, buy: { own: [] } }], errands: [] }, options: { verify: false } });
  assert.deepEqual(r2.report.briefUnmatched.map((b) => b.reason), ['對到「麵店甲 vs 麵店乙」，是比較或彙整的條目，不是一個可以排的地點，沒排']);
});

test('需求單點名「坐下來的地方」照點名那一層排（11-11；總則 3 點名的一律排）：②、want、理由欄寫明，不再列進對不上；沒被點名的照舊不進池；排進去之後單日引擎不會把同一家再當坐下來的候選加一次', () => {
  const bench = { ...POIS.street1, id: 'spotx', name_zh: '河邊長椅', name_local: 'spotx', category: 'spot', recovery: true, walkFactor: 0, dwellMin: 30 };
  const pois = { ...POIS, spotx: bench };
  const brief = { persons: [{ isMe: true, go: { designated: ['河邊長椅'], mustEat: [] }, buy: { own: [] } }], errands: [] };
  const r = run({ pois, brief });
  const hit = r.report.days.flatMap((d) => d.picks.map((p) => ({ ...p, date: d.date }))).find((p) => p.poiId === 'spotx');
  assert.ok(hit, '被點名：排進去');
  assert.deepEqual([hit.level, hit.priority, hit.slot], [2, 'want', null]);
  assert.equal(hit.why, '需求單點名「河邊長椅」（坐下來的地方，點名照排）');
  assert.deepEqual(r.report.briefUnmatched, []);
  assert.deepEqual(r.days.find((d) => d.date === hit.date).picks.find((p) => p.poiId === 'spotx'), { poiId: 'spotx', priority: 'want' }, '寫進旅程檔的 pick 跟一般的 ② 一樣');
  assert.ok(!r.report.verify.dropped.some((d) => d.poiId === 'spotx'), '單日引擎驗證沒有丟它');
  // 排進去之後它是他勾的站：帶整個知識庫當引擎可插的來源去排，那一天的序列裡它只出現一次、不是引擎插的
  const trip = { ...TRIP, days: TRIP.days.map((d) => ({ ...d, picks: r.days.find((x) => x.date === d.date).picks })) };
  const planned = planTrip({ trip, pois, rules, settings, country: COUNTRY, kb: KB, legFn, restPool: Object.values(pois) });
  const stops = planned.days.flatMap((d) => d.plan.sequence).filter((s) => s.poi.id === 'spotx');
  assert.equal(stops.length, 1);
  assert.equal(stops[0].insertedBy, null);
  // 沒被點名：照舊連池都不進（引擎每天自己視情況排）
  const plain = run({ pois });
  assert.ok(!plain.days.some((d) => ids(d).includes('spotx')) && !plain.unplaced.some((u) => u.poiId === 'spotx'));
  assert.equal(plain.report.pool.eligible + 1, r.report.pool.eligible, '點名之後池子多它一家');
  // 被點名、又卡在點名蓋不過的門（他按過「不去了」）：照舊不排、進對不上
  const removedTrip = { ...TRIP, days: TRIP.days.map((d, i) => (i === 1 ? { ...d, removed: [{ poiId: 'spotx' }] } : d)) };
  const gone = run({ trip: removedTrip, pois, brief, options: { verify: false } });
  assert.deepEqual(gone.report.briefUnmatched.map((b) => b.reason), ['對到「河邊長椅」，你按過「不去了」，沒排']);
});

// ── 11-06 第二批：「這家店能不能當午餐／晚餐」接到共用尺 rules/_slots.js servesMeal（知識庫欄位 meals 優先、沒欄位照店型推導；原話 #195）──
const mealWorld = (over) => ({ gardeng: POIS.gardeng, ...over });
const mealDay = [{ date: '2026-08-13', type: 'normal', anchor: { poiId: 'gardeng' }, picks: [] }];
const mealRun = (pois, days = mealDay) => allocateTrip({ trip: { id: 'm', party: 1, homeBases: [{ poi: HOME }], days }, pois, kb: KB, country: COUNTRY, settings, rules, legFn, options: { verify: false } });
const slotOf = (r, id) => r.report.days.flatMap((d) => d.picks).find((p) => p.poiId === id)?.slot;
const placed = (r, id) => r.days.some((d) => ids(d).includes(id));

test('分配器分午餐晚餐照 meals 欄位：只標午餐的整天食堂不會被分成晚餐、只標晚餐的不會被分成午餐；沒有欄位的照舊（推導出來就是原本的判法）', () => {
  // 兩家整天都開的食堂：沒標時一家午餐一家晚餐
  const plain = mealRun(mealWorld({ a: { ...POIS.foodx, id: 'a', name_zh: '甲食堂' }, b: { ...POIS.foodx, id: 'b', name_zh: '乙食堂' } }));
  assert.deepEqual([slotOf(plain, 'a'), slotOf(plain, 'b')].sort(), ['dinner', 'lunch']);
  // 兩家都只標午餐：一家當午餐，另一家不會因為晚餐的位子還空著就被分成晚餐
  const lunchOnly = { lunch: true };
  const both = mealRun(mealWorld({ a: { ...POIS.foodx, id: 'a', name_zh: '甲食堂', meals: lunchOnly }, b: { ...POIS.foodx, id: 'b', name_zh: '乙食堂', meals: lunchOnly } }));
  assert.deepEqual([slotOf(both, 'a'), slotOf(both, 'b')].filter(Boolean), ['lunch']);
  const left = both.unplaced.find((u) => ['a', 'b'].includes(u.poiId));
  assert.equal(left?.reason, '餐段對不上（已有的那餐佔了、另一餐它沒開或時窗外）');
  // 一家只標晚餐、一家只標午餐：各就各位，不看誰先被挑
  const split = mealRun(mealWorld({ a: { ...POIS.foodx, id: 'a', name_zh: '甲食堂', meals: { dinner: '晚場才有定食' } }, b: { ...POIS.foodx, id: 'b', name_zh: '乙食堂', meals: lunchOnly } }));
  assert.deepEqual([slotOf(split, 'a'), slotOf(split, 'b')], ['dinner', 'lunch']);
});

test('吃的類標了 {}（整座商場、甜點攤）或只標早餐：不是午餐晚餐的候選——可以當一站、不佔餐段；真正的食堂照樣分到午餐晚餐', () => {
  const mall = { ...POIS.foodx, id: 'mall', name_zh: '車站商場', meals: {}, dwellMin: 135 };
  const morning = { ...POIS.foodx, id: 'morning', name_zh: '朝市食堂', meals: { breakfast: '7:30 起的海鮮丼' }, hours: Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, [['07:30', '15:00']]])) };
  const r = mealRun(mealWorld({ mall, morning, foodl: POIS.foodl, foodd: POIS.foodd }));
  assert.deepEqual([slotOf(r, 'foodl'), slotOf(r, 'foodd')], ['lunch', 'dinner']);
  for (const id of ['mall', 'morning']) {
    assert.equal(placed(r, id), true, `${id} 照一般的站分進去`);
    assert.equal(slotOf(r, id), null, `${id} 不是午餐也不是晚餐`);
  }
  // 只有它們、沒有別的食堂：餐段就是空著（不會拿商場或早餐店湊數）
  const only = mealRun(mealWorld({ mall, morning }));
  assert.deepEqual([slotOf(only, 'mall'), slotOf(only, 'morning')], [null, null]);
  // 沒標的甜點攤照舊（推導：店型對照表「甜點」對到的不算一餐）
  const sweet = mealRun(mealWorld({ foodsweet: POIS.foodsweet }));
  assert.equal(slotOf(sweet, 'foodsweet'), null);
});

test('咖啡廳、酒吧不會被分配器分成一餐（就算知識庫標了能當午餐／晚餐）：咖啡廳走同類配額、酒吧走夜間站；骨架裡吃的站照它能當的那一餐佔位', () => {
  const lunchCafe = { ...POIS.cafe1, id: 'lunchcafe', name_zh: '洋食喫茶', meals: { lunch: '拿坡里義大利麵套餐', dinner: '拿坡里義大利麵套餐' } };
  const izakaya = { ...POIS.barn1, id: 'izakaya', name_zh: '站前居酒屋', categoryRaw: '居酒屋', meals: { dinner: '爐端燒與鄉土料理' } };
  const r = mealRun(mealWorld({ lunchcafe: lunchCafe, izakaya, foodx: POIS.foodx }));
  assert.equal(slotOf(r, 'lunchcafe'), null, '咖啡廳照一般的站');
  assert.equal(slotOf(r, 'izakaya'), 'night', '酒吧照夜間站');
  assert.equal(slotOf(r, 'foodx'), 'lunch', '午餐的位子沒有被咖啡廳佔掉');
  // 骨架：指定站是只標晚餐的食堂 → 它佔晚餐，分配器只再補午餐；沒標的指定食堂照舊先佔午餐
  const dinnerOnly = { ...POIS.foodx, id: 'kaiseki', name_zh: '只開晚上的料亭', meals: { dinner: '晚間套餐' } };
  const skeletonDay = (id) => [{ date: '2026-08-13', type: 'normal', anchor: { poiId: 'gardeng' }, designated: [id], picks: [] }];
  const a = mealRun(mealWorld({ kaiseki: dinnerOnly, foodx: POIS.foodx, foodd: POIS.foodd }), skeletonDay('kaiseki'));
  assert.equal(slotOf(a, 'foodx'), 'lunch', '晚餐被骨架的料亭佔了，整天食堂補午餐');
  assert.equal(placed(a, 'foodd'), false, '晚餐食堂沒位子');
  const b = mealRun(mealWorld({ foodx: POIS.foodx, foodl: POIS.foodl, foodd: POIS.foodd }), skeletonDay('foodx'));
  assert.equal(slotOf(b, 'foodd'), 'dinner');
  assert.equal(placed(b, 'foodl'), false, '沒標的指定食堂先佔午餐（照舊）');
});

// ── 11-17：分配器不把早餐候選當一般的站分（原話 #196「還有預設上每天都要有早餐的安排 但我也有可能在飯店吃早餐 所以早餐的按鈕會不太一樣 不是不去了可能是改天去或是我吃飯店早餐」的推導）──
// 每天的早餐由 engine/breakfast.js 挑（先後：沒排到 ＞ 用備案 ＞ 不合這天）；分配器把早餐候選當一般的站分掉，等於繞過那個先後。
// 上一輪審查在待套用版七天包實測到三件：8/17 11:03 排了只賣早餐的外帶飯糰、8/13 研究標備案的咖啡站被分成 09:02 的咖啡廳（成了那天的早餐）、8/18 朝市早餐佔掉午餐段（引擎排在 09:02，那天沒午餐）。
const BF_COUNTRY = { ...COUNTRY, mealSlots: { breakfast: ['07:00', '10:00'], ...COUNTRY.mealSlots } };
const hoursOf = (open, close) => Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, [[open, close]]]));
const bfRun = (pois, { days = mealDay, country = BF_COUNTRY, brief = null } = {}) => allocateTrip({ trip: { id: 'm', party: 1, homeBases: [{ poi: HOME }], days }, pois, kb: KB, country, settings, rules, legFn, brief, options: { verify: false } });
const reasonOf = (r, id) => r.unplaced.find((u) => u.poiId === id)?.reason ?? null;
const naming = (...names) => ({ persons: [{ isMe: true, go: { designated: names } }] });

test('國家層有早餐段時，吃的類、只供早餐的店沒被點名就不分（哪一天吃由引擎的早餐安排挑）；點名的照排、算那天的早餐；國家層沒有早餐段照舊當一般的站分', () => {
  const onigiri = { ...POIS.foodx, id: 'onigiri', name_zh: '阿美飯糰舖', meals: { breakfast: '外帶飯糰，賣完就收' }, hours: hoursOf('06:00', '14:00'), dwellMin: 10 };
  const world = mealWorld({ onigiri, foodl: POIS.foodl, foodd: POIS.foodd });
  const r = bfRun(world);
  assert.equal(placed(r, 'onigiri'), false, '沒被點名：不分');
  assert.equal(reasonOf(r, 'onigiri'), '只供早餐，由每天的早餐安排');
  assert.deepEqual([slotOf(r, 'foodl'), slotOf(r, 'foodd')], ['lunch', 'dinner'], '午餐晚餐照分');
  // 點名（總則 3：點名的一律排）：照排，佔的是早餐、不是午餐晚餐
  const n = bfRun(world, { brief: naming('阿美飯糰舖') });
  assert.equal(placed(n, 'onigiri'), true);
  assert.equal(slotOf(n, 'onigiri'), 'breakfast');
  assert.deepEqual([slotOf(n, 'foodl'), slotOf(n, 'foodd')], ['lunch', 'dinner']);
  // 國家層沒有早餐段（舊打包檔）：引擎不排早餐，這種店照舊當一般的站分、不佔餐段
  const old = bfRun(world, { country: COUNTRY });
  assert.equal(placed(old, 'onigiri'), true);
  assert.equal(slotOf(old, 'onigiri'), null);
});

test('「只供早餐的吃的店不分」只管引擎排得成早餐的店（11-17 審查）：帶品項的（品項落點）、六星與有憑據的意義類、離住宿要搭車的照舊分——引擎的早餐不拿帶品項的店、不拿要搭車的店、也不看星等，那一句「由每天的早餐安排」對它們不成立', () => {
  const bfOnly = (over = {}) => ({ ...POIS.foodx, id: 'onigiri', name_zh: '阿美飯糰舖', meals: { breakfast: '外帶飯糰，賣完就收' }, hours: hoursOf('06:00', '14:00'), dwellMin: 10, ...over });
  // 對照：住宿走得到、沒被點名、不帶品項、不是六星——照舊不分
  assert.equal(reasonOf(bfRun(mealWorld({ onigiri: bfOnly() })), 'onigiri'), '只供早餐，由每天的早餐安排');
  // 品項落點（④）：唯一賣明太子的店——照品項那一層分（順路購買），不然品項沒有落點
  const item = bfRun(mealWorld({ onigiri: bfOnly({ item: '明太子' }) }));
  assert.deepEqual(item.days[0].picks.find((p) => p.poiId === 'onigiri'), { poiId: 'onigiri', priority: 'maybe', errand: true });
  // 六星（③；profile §2.2「可移日，不可丟」）與有憑據的意義類：照排，這天的早餐算它的
  const six = bfRun(mealWorld({ onigiri: bfOnly({ my: { rating: 6 } }), foodl: POIS.foodl, foodd: POIS.foodd }));
  assert.deepEqual([placed(six, 'onigiri'), slotOf(six, 'onigiri'), slotOf(six, 'foodl'), slotOf(six, 'foodd')], [true, 'breakfast', 'lunch', 'dinner']);
  assert.equal(placed(bfRun(mealWorld({ onigiri: bfOnly({ significance: 'origin', significanceSource: '公會名錄' }) })), 'onigiri'), true);
  // 外地（從住宿要搭車）：一日遊那天海邊只有早上開的朝市食堂——引擎的早餐是「先吃再上車」、不會排它，照舊當一般的站分
  const seaDay = [{ date: '2026-08-15', type: 'normal', dayTrip: true, anchor: { poiId: 'templesea' }, picks: [] }];
  const sea = bfRun({ templesea: POIS.templesea, seabf: bfOnly({ id: 'seabf', name_zh: '海邊朝市食堂', zoneId: 'sea', hours: hoursOf('06:00', '13:00'), dwellMin: 60 }) }, { days: seaDay });
  assert.equal(placed(sea, 'seabf'), true);
  assert.equal(slotOf(sea, 'seabf'), null, '不是早餐也不是午餐晚餐：一般的站');
});

test('研究標備案的吃喝類（咖啡廳、酒吧、不算一餐的吃的站）沒被點名就不主動分；點名的照排；品項落點的備案照舊（首選排不下才輪到它）', () => {
  const backupCafe = { ...POIS.cafe1, id: 'cafeback', name_zh: '朝市咖啡站', researchRank: 'backup' };
  const backupBar = { ...POIS.barn1, id: 'barback', name_zh: '巷口立飲', researchRank: 'backup' };
  const backupSweet = { ...POIS.foodsweet, id: 'sweetback', name_zh: '備用麻糬攤', researchRank: 'backup' };
  const world = mealWorld({ cafeback: backupCafe, barback: backupBar, sweetback: backupSweet, cafe1: POIS.cafe1, barn1: POIS.barn1 });
  const r = bfRun(world, { country: COUNTRY });   // 這一條跟早餐段無關：沒有早餐段的國家層也一樣
  assert.equal(placed(r, 'cafe1'), true, '沒標的咖啡廳照分');
  assert.equal(slotOf(r, 'barn1'), 'night', '沒標的酒吧照夜間站');
  assert.equal(reasonOf(r, 'cafeback'), '研究標備案／保底的咖啡廳不主動排');
  assert.equal(reasonOf(r, 'barback'), '研究標備案／保底的酒吧不主動排');
  assert.equal(reasonOf(r, 'sweetback'), '研究標備案／保底的吃的站不主動排');
  // 只管吃喝類：別的店型標了備案（不是品項落點的街區）照舊分
  const backupStreet = { ...POIS.street1, id: 'streetback', name_zh: '備用街區', researchRank: 'backup' };
  assert.equal(placed(bfRun(mealWorld({ streetback: backupStreet }), { country: COUNTRY }), 'streetback'), true);
  // 只有備案的酒吧時，夜間站寧可空著（不主動排），不拿備案湊數
  const lone = bfRun(mealWorld({ barback: backupBar }), { country: COUNTRY });
  assert.equal(placed(lone, 'barback'), false);
  // 點名的照排
  const n = bfRun(world, { country: COUNTRY, brief: naming('朝市咖啡站', '巷口立飲') });
  assert.equal(placed(n, 'cafeback'), true);
  assert.equal(slotOf(n, 'barback'), 'night');
  // 品項落點的備案是另一回事：同品項只有備案那一家排得了時照樣輪到它（店型是咖啡廳也一樣）
  const beansFirst = { ...POIS.cafe2, id: 'beans1', name_zh: '焙煎所甲', item: '咖啡豆', researchRank: 'first', hours: { mon: [['09:00', '18:00']] } };   // 這趟的日子（週四）沒開
  const beansBackup = { ...POIS.cafe3, id: 'beans2', name_zh: '焙煎所乙', item: '咖啡豆', researchRank: 'backup' };
  const items = bfRun(mealWorld({ beans1: beansFirst, beans2: beansBackup }), { country: COUNTRY });
  assert.equal(placed(items, 'beans2'), true, '首選那天沒開，備案的落點照樣分');
  assert.deepEqual(items.days[0].picks.find((p) => p.poiId === 'beans2'), { poiId: 'beans2', priority: 'maybe', errand: true, dwellMin: 30 });
});

test('國家層有早餐段時分配器認得早餐：能當早餐也能當午餐的食堂贏了午餐的位子，佔的是早餐、午餐另外分一家；早餐不由分配器主動分', () => {
  // 朝市：早上 07:30 開、能當早餐與午餐、離住宿走得到；停留 60 分最像一餐，午餐的位子它先贏
  const market = { ...POIS.foodx, id: 'amarket', name_zh: '朝市食堂', meals: { breakfast: '7:30 起的海鮮丼', lunch: true }, hours: hoursOf('07:30', '15:00') };
  const world = mealWorld({ amarket: market, foodl: POIS.foodl, foodd: POIS.foodd });
  const r = bfRun(world);
  assert.equal(slotOf(r, 'amarket'), 'breakfast', '這一站在這天會是早餐，不佔午餐');
  assert.deepEqual([slotOf(r, 'foodl'), slotOf(r, 'foodd')], ['lunch', 'dinner'], '午餐另外分一家');
  // 沒有早餐段的國家層（舊打包檔）：照舊，朝市佔午餐、午餐食堂沒位子
  const old = bfRun(world, { country: COUNTRY });
  assert.equal(slotOf(old, 'amarket'), 'lunch');
  assert.equal(placed(old, 'foodl'), false);
  // 早餐不由分配器主動分：午餐晚餐的位子都被別家贏走時，能當早餐的食堂不會因為早餐的位子空著就被分進去
  const loser = { ...market, id: 'zmarket', name_zh: '遠一點的朝市食堂', dwellMin: 20 };   // 停留離 60 分遠、id 也排後面：午餐的位子輪不到它
  const full = bfRun(mealWorld({ zmarket: loser, foodx: POIS.foodx, foodd: POIS.foodd }));
  assert.equal(slotOf(full, 'foodx'), 'lunch');
  assert.equal(placed(full, 'zmarket'), false, '沒贏到午餐晚餐的位子就不分');
  assert.equal(reasonOf(full, 'zmarket'), '午餐、晚餐都有了');
  // 要搭車才到得了的（外地）不算早餐：引擎的早餐也是「先吃再上車」——一日遊那天海邊的朝市食堂照舊佔午餐
  const seaDay = [{ date: '2026-08-13', type: 'normal', dayTrip: true, anchor: { poiId: 'templesea' }, picks: [] }];
  const sea = bfRun({ templesea: POIS.templesea, seamarket: { ...market, id: 'seamarket', name_zh: '海邊朝市食堂', zoneId: 'sea' } }, { days: seaDay });
  assert.equal(slotOf(sea, 'seamarket'), 'lunch');
  // 晚出門的日子（旅程第三天起 11:00 出門）沒有早餐這回事：照舊佔午餐
  const lateDays = ['2026-08-11', '2026-08-12', '2026-08-13'].map((date, i) => ({ date, type: 'normal', anchor: i === 2 ? { poiId: 'gardeng' } : undefined, picks: [] }));
  const late = bfRun({ gardeng: POIS.gardeng, amarket: { ...market, hours: { thu: [['07:30', '15:00']] } } }, { days: lateDays });
  assert.equal(slotOf(late, 'amarket'), 'lunch', '只有第三天（週四）有開，那天 11:00 才出門');
  // 早餐段過了才出門的日子（10:30 出門、早餐段到 10:00）同樣沒有早餐：沒有營業時間資料的店也不會被當成早餐
  const lateStart = [{ date: '2026-08-13', type: 'normal', earlyDay: true, departHM: '10:30', anchor: { poiId: 'gardeng' }, picks: [] }];
  assert.equal(slotOf(bfRun(mealWorld({ amarket: { ...market, hours: null } }), { days: lateStart }), 'amarket'), 'lunch');
  // 一天只有一個早餐的位子：同一天第二家能當早餐的食堂贏到午餐時，早餐已經有人佔了，它照舊算午餐
  const two = bfRun(mealWorld({ amarket: market, bmarket: { ...market, id: 'bmarket', name_zh: '另一家朝市食堂' }, foodd: POIS.foodd }));
  assert.deepEqual([slotOf(two, 'amarket'), slotOf(two, 'bmarket'), slotOf(two, 'foodd')], ['breakfast', 'lunch', 'dinner']);
});

test('驗證收回標成早餐的站，早餐的位子要還回去：同一天之後贏到午餐的食堂才能再算早餐、午餐留給下一家（11-17 審查的變異測試：這一行拿掉沒有測試會紅）', () => {
  // 甲朝市：分配器看得到它早上與中午都有開（各 50 分），其實要待 60 分、哪一段都待不完——分進去之後單日引擎一定丟它。
  // 一天最多 2 站（主行程＋1）：甲先贏到午餐、算成早餐，站數就滿了，乙朝市排不進；甲被收回之後乙才分得進來
  const twice = { thu: [['09:00', '09:50'], ['11:30', '12:20']] };
  const doomed = { ...POIS.foodx, id: 'aamarket', name_zh: '甲朝市食堂', meals: { breakfast: '海鮮丼', lunch: true }, hours: twice, dwellMin: 60 };
  const market = { ...POIS.foodx, id: 'zzmarket', name_zh: '乙朝市食堂', meals: { breakfast: '7:30 起的海鮮丼', lunch: true }, hours: hoursOf('07:30', '15:00') };
  const tight = { ...settings, allocMaxStops: 2, allocTargetStops: 2 };
  const go = (verify) => allocateTrip({ trip: { id: 'm', party: 1, homeBases: [{ poi: HOME }], days: mealDay }, pois: mealWorld({ aamarket: doomed, zzmarket: market }), kb: KB, country: BF_COUNTRY, settings: tight, rules, legFn, options: { verify } });
  const dry = go(false);
  assert.deepEqual([slotOf(dry, 'aamarket'), placed(dry, 'zzmarket'), reasonOf(dry, 'zzmarket')], ['breakfast', false, '站數滿（上限 2）'], '沒驗證：甲佔了早餐、站數滿');
  const r = go(true);
  assert.equal(placed(r, 'aamarket'), false, '單日引擎排不進甲（哪一段營業時間都待不完），收回');
  assert.equal(slotOf(r, 'zzmarket'), 'breakfast', '早餐的位子還回去了：乙贏到午餐、這天會是早餐，佔的算早餐（沒還的話它會被標成午餐）');
});

test('骨架與點名的站也照同一把尺：指定站是能當早餐的食堂就佔早餐（分配器再補午餐晚餐）；點名的在午餐晚餐都滿時還能佔早餐', () => {
  const market = { ...POIS.foodx, id: 'amarket', name_zh: '朝市食堂', meals: { breakfast: '7:30 起的海鮮丼', lunch: true }, hours: hoursOf('07:30', '15:00') };
  const skeletonDay = [{ date: '2026-08-13', type: 'normal', anchor: { poiId: 'gardeng' }, designated: ['amarket'], picks: [] }];
  const a = bfRun(mealWorld({ amarket: market, foodl: POIS.foodl, foodd: POIS.foodd }), { days: skeletonDay });
  assert.deepEqual([slotOf(a, 'foodl'), slotOf(a, 'foodd')], ['lunch', 'dinner'], '指定的朝市佔早餐，午餐晚餐都還分得到');
  const old = bfRun(mealWorld({ amarket: market, foodl: POIS.foodl, foodd: POIS.foodd }), { days: skeletonDay, country: COUNTRY });
  assert.equal(placed(old, 'foodl'), false, '沒有早餐段：指定的朝市照舊先佔午餐');
  // 點名：午餐（骨架的整天食堂）與晚餐（另一家點名的）都有人了，點名的朝市還是排得進——它佔的是早餐
  const days = [{ date: '2026-08-13', type: 'normal', anchor: { poiId: 'gardeng' }, designated: ['foodx'], picks: [] }];
  const n = bfRun(mealWorld({ amarket: market, foodx: POIS.foodx, foodd: POIS.foodd }), { days, brief: naming('晚餐食堂', '朝市食堂') });
  assert.equal(slotOf(n, 'foodd'), 'dinner');
  assert.equal(slotOf(n, 'amarket'), 'breakfast');
});

test('同一處在知識庫寫成兩筆（samePlace）：整趟只分其中一筆，另一筆留池並講原因（同一家整趟一次；主控 11-11 定「同一處當同一家」）', () => {
  const market = { ...POIS.foodx, id: 'amarket', name_zh: '朝市食堂', meals: { breakfast: '7:30 起的海鮮丼', lunch: true }, hours: hoursOf('07:30', '15:00') };
  const street = { ...market, id: 'amarketstreet', name_zh: '朝市商店街（買＋吃）', samePlace: 'amarket' };
  const r = bfRun(mealWorld({ amarket: market, amarketstreet: street, foodd: POIS.foodd }));
  assert.equal(slotOf(r, 'amarket'), 'breakfast');
  assert.equal(placed(r, 'amarketstreet'), false, '同一處的另一筆不會接著佔掉空出來的午餐');
  assert.equal(reasonOf(r, 'amarketstreet'), '同一處的另一筆（朝市食堂）已經排在 2026-08-13');
  // 骨架裡有其中一筆：另一筆也不分
  const days = [{ date: '2026-08-13', type: 'normal', anchor: { poiId: 'gardeng' }, designated: ['amarketstreet'], picks: [] }];
  const s = bfRun(mealWorld({ amarket: market, amarketstreet: street, foodd: POIS.foodd }), { days });
  assert.equal(placed(s, 'amarket'), false);
  assert.equal(reasonOf(s, 'amarket'), '同一處的另一筆（朝市商店街（買＋吃））已經排在 2026-08-13');
  // 沒有這個欄位的知識庫（舊打包檔）：兩筆照舊各分各的
  const { samePlace: _gone, ...plainStreet } = street;
  const old = bfRun(mealWorld({ amarket: market, amarketstreet: plainStreet, foodd: POIS.foodd }), { country: COUNTRY });
  assert.equal(slotOf(old, 'amarket'), 'lunch');
  assert.equal(reasonOf(old, 'amarketstreet'), '午餐、晚餐都有了', '沒有欄位：照舊是兩家各自比，理由是餐段、不是同一處');
});

test('同一處的兩筆各帶一樣他要買的東西（知識庫一樣東西一筆、同一家店）：品項落點可以跟另一筆排同一天（進去一次買兩樣），別天不再去一次；不是品項落點的另一筆照舊整趟只分一筆', () => {
  // 11-17 在較新的待套用版（知識庫 samePlace 6 對，其中兩對是同一家藥妝各帶一個品項）量到：整趟只分一筆時第二樣東西改落到別家店（9 組裡 7 組），
  // 品項落點完全不看同一處時同一家店被分在兩天各去一次（9 組裡 4 組）。
  const mascara = { ...POIS.itema1, id: 'druga', name_zh: '大藥妝（睫毛膏）', item: '睫毛膏' };
  const mask = { ...POIS.itema1, id: 'drugb', name_zh: '大藥妝（面膜）', item: '面膜', samePlace: 'druga' };
  // 一天的旅程：兩筆都分得到、都是順路購買
  const one = bfRun(mealWorld({ druga: mascara, drugb: mask }), { country: COUNTRY });
  assert.equal(placed(one, 'druga'), true);
  assert.equal(placed(one, 'drugb'), true, '同一家店的第二樣東西排在同一天');
  assert.deepEqual(one.days[0].picks.filter((p) => p.poiId === 'druga' || p.poiId === 'drugb').map((p) => p.errand), [true, true]);
  // 兩天的旅程、他自己把其中一筆排在第一天（骨架）：另一筆只會排在同一天，就算第二天比較空
  const days = [
    { date: '2026-08-13', type: 'normal', anchor: { poiId: 'gardeng' }, designated: ['druga'], picks: [] },
    { date: '2026-08-14', type: 'normal', anchor: { poiId: 'templet' }, picks: [] },
  ];
  const world = (over = {}) => ({ gardeng: POIS.gardeng, templet: POIS.templet, street1: POIS.street1, street2: POIS.street2, druga: mascara, drugb: { ...mask, ...over } });
  const two = bfRun(world(), { days, country: COUNTRY });
  assert.equal(two.days.find((d) => ids(d).includes('drugb'))?.date, '2026-08-13');
  // 第一天它沒開（只開週五）：不會改排到第二天再去同一家店一次，留池並講原因
  const friOnly = bfRun(world({ hours: { fri: [['09:00', '23:00']] } }), { days, country: COUNTRY });
  assert.equal(placed(friOnly, 'drugb'), false);
  assert.equal(reasonOf(friOnly, 'drugb'), '同一處的另一筆（大藥妝（睫毛膏））已經排在 2026-08-13；要買的東西只跟它排同一天');
  // 那天的品項落點已經滿了（一天最多 2 個：骨架的睫毛膏與別家的鞋）：同一家店的第二樣東西照排（進去一次買兩樣）——
  // 不然這天排不進、別天又不准去，面膜就沒有落點（11-17 審查；5514647 是排到第二天再去一次）
  const shoes = { ...POIS.itema1, id: 'itemz', name_zh: '別家（鞋）', item: '鞋' };
  const fullDays = [{ ...days[0], designated: ['druga', 'itemz'] }, days[1]];
  const full = bfRun({ ...world(), itemz: shoes }, { days: fullDays, country: COUNTRY });
  assert.equal(full.days.find((d) => ids(d).includes('drugb'))?.date, '2026-08-13', `面膜跟睫毛膏排同一天（留池：${reasonOf(full, 'drugb')}）`);
  // 不是同一家店的第三個品項照舊受名額限制
  const third = { ...POIS.itema1, id: 'itemy', name_zh: '第三家（帽子）', item: '帽子' };
  const capped = bfRun({ gardeng: POIS.gardeng, druga: mascara, itemz: shoes, itemy: third }, { days: [fullDays[0]], country: COUNTRY });
  assert.equal(reasonOf(capped, 'itemy'), '品項落點一天 2 個滿了');
  // 同一家店的第二樣東西照樣算一個落點（平常的算法不動）：睫毛膏＋面膜就是 2 個，別家的帽子這天排不進
  const counted = bfRun({ gardeng: POIS.gardeng, druga: mascara, drugb: mask, itemy: third }, { days: [{ ...days[0], designated: ['druga'] }], country: COUNTRY });
  assert.deepEqual([placed(counted, 'drugb'), reasonOf(counted, 'itemy')], [true, '品項落點一天 2 個滿了']);
  // 不是品項落點的另一筆（同一家店的一般條目）照舊：同一天也不分第二筆
  const plain = { ...POIS.street1, id: 'drugstorefront', name_zh: '大藥妝（逛）', samePlace: 'druga' };
  const p = bfRun(mealWorld({ druga: mascara, drugstorefront: plain }), { country: COUNTRY });
  assert.equal(placed(p, 'druga'), true);
  assert.equal(reasonOf(p, 'drugstorefront'), '同一處的另一筆（大藥妝（睫毛膏））已經排在 2026-08-13');
});

test('留池理由「品項落在哪一天的哪家」指的是品項那一層的落點：需求單點名的店剛好帶同一個品項標記（研究判可略過的香氛區）不算落點', () => {
  // 11-12 審查：點名「藤崎百貨 本館1F 香氛區」（帶 DKNY 香水的品項標記、研究判可略過）排在 8/12，品項真正的落點是 8/18 的唐吉訶德，同品項其餘四家的留池理由卻寫「落在 8/12 的香氛區」
  const brief = naming('百貨香氛區');
  const r = run({ pois: FIELD_POIS, brief, options: { verify: false } });
  const where = (id) => r.report.days.find((d) => d.picks.some((p) => p.poiId === id));
  assert.equal(where('gateskip')?.picks.find((p) => p.poiId === 'gateskip').level, 2, '點名的香氛區照點名那一層排');
  const drop = where('itema2');
  assert.equal(drop?.picks.find((p) => p.poiId === 'itema2').level, 4, '品項的落點是首選那家藥妝');
  assert.ok(where('gateskip').date <= drop.date, '點名的那家排在落點的同一天或更早（舊的寫法會先看到它）');
  assert.equal(reasonOf(r, 'itema1'), `品項「香水」落在 ${drop.date} 的 藥妝二`);
});

test('原話 #198「可抽菸店家 都是可接受的」：全店可吸菸的店不因為吸菸被任何一道門擋——分配器的候選池、引擎插站、換一家、二選一都照常過，分配器照分', async () => {
  // 引擎本來就沒有任何跟吸菸有關的判斷（11-17 兩位審查各自搜過 src 與 tools）；這一條把他的話釘住：之後有人加這種門，這裡會紅。
  // 知識庫現在把它寫在簡介裡（「全店可吸菸」）；profile §10 另有在地訊號 frictionSignals.smokingAllowed 的寫法，兩種都試
  const { engineMayInsert } = await import('../../src/engine/trip.js');
  const { swapGated } = await import('../../src/engine/swap.js');
  const { choiceEligible } = await import('../../src/engine/choices.js');
  const smoky = { ...POIS.cafe1, id: 'smokycafe', name_zh: '路旁的昭和喫茶', highlight: '辦公街巷子裡的昭和喫茶，全店可吸菸。', frictionSignals: { smokingAllowed: true } };
  const plainCafe = { ...POIS.cafe1, id: 'plaincafe', name_zh: '一般的喫茶' };
  for (const p of [smoky, plainCafe]) assert.deepEqual([poolEligible(p), poolGatesOf(p), engineMayInsert(p), swapGated(p), choiceEligible(p)], [true, [], true, false, true], p.id);
  const r = bfRun(mealWorld({ smokycafe: smoky }));
  assert.equal(placed(r, 'smokycafe'), true, '分配器照分');
  assert.equal(reasonOf(r, 'smokycafe'), null);
});
