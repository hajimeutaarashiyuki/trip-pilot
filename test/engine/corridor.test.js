// 走廊清單（T15；原話 #57「在路程的旁邊塞我會經過的店家」、#124「可以升級成大站」；DESIGN §1.9「走廊清單不是站」）：
// 每段走路旁 ≤ corridorListRadiusM 的店掛在 plan.corridor，不是站——不改序列、時刻、分數；搭車段沒有；候選跟引擎插站同一道門；
// 長段提示 leg-suggest 只在走 ≥ legSuggestMin 分且那段有店時出現，是 hint 不是罰分。
// 10-16 審查後：經過時沒開的店不列（午休、當天休息）、沒營業時間資料的標 open: null；任何一天引擎插過的站也不列（七天排完才算）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planTrip, corridorFor, attachCorridor, pickedOrRemoved, corridorExclude, corridorEligible, visitedBefore } from '../../src/engine/trip.js';
import { loadRules } from '../../src/rules/index.js';
import { BUILTIN } from '../../src/rules/builtin.js';
import rulesJson from '../../src/rules.json' with { type: 'json' };

const rules = loadRules(BUILTIN, rulesJson.rules);
const settings = rulesJson.settings;
const country = { mealSlots: { lunch: ['11:30', '13:30'], dinner: ['18:00', '20:30'] }, nightSlot: ['20:00', '24:00'], climate: { summerMonths: [6, 7, 8, 9] }, utcOffsetMin: 540 };
const kb = { zones: { town: { environment: 'town', lat: 38.26, lng: 140.87 }, far: { environment: 'town', lat: 38.40, lng: 141.00 } } };
const ALL = { thu: [['09:00', '23:00']] };   // 2026-08-13 是週四
const poi = (id, over = {}) => ({ id, name_zh: id, category: 'street', walkFactor: 1, recovery: false, cafeLike: false, climbMin: 0, zoneId: 'town', hours: ALL, dwellMin: 60, daylightOnly: false, lat: 38.26, lng: 140.87, ...over });
const shop = (id, lat, lng, over = {}) => poi(id, { category: 'record', walkFactor: 0, dwellMin: 30, lat, lng, ...over });
// 小世界：住宿 (38.26, 140.87) → A 往東 875 m → B 再往東 875 m；C 在別區、搭車去
const home = { id: 'home', name_zh: '飯店', zoneId: 'town', lat: 38.26, lng: 140.87 };
const A = poi('A', { lat: 38.26, lng: 140.88 });
const B = poi('B', { lat: 38.26, lng: 140.89 });
const C = poi('C', { zoneId: 'far', lat: 38.40, lng: 141.00 });
const WALK = { 'home|A': 11, 'A|B': 5, 'home|B': 20 };
// 表裡沒有的配對一律 20 分：走廊店繞路 20＋20−11 遠超過 onTheWayDetourMin 8，不會被當順路站插進去（走廊清單要驗的是「不是站」）
const legFn = (a, b) => (a.zoneId !== b.zoneId ? { walkMin: 5, rideMin: 30, climbMin: 0, mode: 'ride' } : { walkMin: WALK[`${a.id}|${b.id}`] ?? WALK[`${b.id}|${a.id}`] ?? 20, rideMin: 0, climbMin: 0, mode: 'walk' });
const day = { date: '2026-08-13', regionZones: ['town', 'far'] };
const seqOf = (...list) => ({ sequence: list.map((p) => ({ poi: p })), warnings: [] });
const idsOf = (corridor, legIndex) => corridor.find((c) => c.legIndex === legIndex)?.pois.map((x) => x.poi.id) ?? [];

test('corridorFor：半徑內（≤100 m）收、外的不收；依離路線距離近到遠、distM 取整數；legIndex 0 是住宿→第一站', () => {
  const pool = [shop('遠', 38.262, 140.875), shop('近67', 38.2606, 140.872), shop('近33', 38.2603, 140.875), shop('剛好外', 38.2609, 140.876)];
  const out = corridorFor({ plan: seqOf(A), home, pool, legFn, settings, day });
  assert.deepEqual(out.map((c) => c.legIndex), [0]);
  assert.deepEqual(idsOf(out, 0), ['近33', '近67'], '100.07 m 的「剛好外」與 222 m 的「遠」不收');
  assert.deepEqual(out[0].pois.map((x) => x.distM), [33, 67]);
  assert.ok(Number.isInteger(out[0].pois[0].distM));
  // 半徑可調
  assert.deepEqual(idsOf(corridorFor({ plan: seqOf(A), home, pool, legFn, settings: { ...settings, corridorListRadiusM: 50 }, day }), 0), ['近33']);
  assert.deepEqual(idsOf(corridorFor({ plan: seqOf(A), home, pool, legFn, settings: { ...settings, corridorListRadiusM: 250 }, day }), 0), ['近33', '近67', '剛好外', '遠']);
});

test('corridorFor：每段最多 corridorListMaxPerLeg 家（預設 5）、取最近的；同一家店靠近兩段時只歸最近的那段', () => {
  const along = [1, 2, 3, 4, 5, 6, 7].map((n) => shop(`店${n}`, 38.26 + n * 0.00008, 140.871 + n * 0.001));   // 離住宿→A 線 9、18、27…62 m
  const out = corridorFor({ plan: seqOf(A, B), home, pool: along, legFn, settings, day });
  assert.deepEqual(idsOf(out, 0), ['店1', '店2', '店3', '店4', '店5'], '七家只列最近五家');
  assert.deepEqual(idsOf(corridorFor({ plan: seqOf(A, B), home, pool: along, legFn, settings: { ...settings, corridorListMaxPerLeg: 2 }, day }), 0), ['店1', '店2']);
  // 站 A 旁的店離「住宿→A」與「A→B」兩段一樣近（都是端點 A）：只在第一段；靠 A→B 線中段的店只在第二段
  const nearA = shop('A旁', 38.2602, 140.88); const midAB = shop('AB中', 38.2602, 140.885);
  const two = corridorFor({ plan: seqOf(A, B), home, pool: [nearA, midAB], legFn, settings, day });
  assert.deepEqual(two.map((c) => [c.legIndex, c.pois.map((x) => x.poi.id)]), [[0, ['A旁']], [1, ['AB中']]]);
});

test('corridorFor：序列裡的站、exclude（勾過、拒絕過、前幾天插過）、不主動排的（curated:false、item）、交通／活動／錢湯／一日遊／會場、坐下來的地方、別區、沒座標的都不列', () => {
  const at = (id, over = {}) => shop(id, 38.2603, 140.875, over);
  const pool = [
    at('可以'), A, at('勾過'), at('拒絕過'), at('前天插過'), at('挖寶型', { curated: false }), at('代購站', { item: 'DKNY香水' }), at('兩星', { my: { rating: 2 } }),
    at('交通', { category: 'logistics' }), at('活動', { category: 'event' }), at('錢湯', { category: 'onsen' }), at('一日遊', { category: 'daytrip' }), at('會場', { category: 'venue' }),
    at('海邊', { category: 'spot' }), at('別區', { zoneId: 'elsewhere' }), at('沒座標', { lat: null, lng: null }), at('咖啡廳', { category: 'cafe', recovery: true }), at('藥妝', { category: 'drugstore' }),
    at('落選兩次', { poolLosses: 2 }), at('未解鎖', { unlockWhen: '同品類吃無可吃' }),
  ];
  const out = corridorFor({ plan: seqOf(A), home, pool, legFn, settings: { ...settings, corridorListMaxPerLeg: 10 }, day, exclude: new Set(['勾過', '拒絕過', '前天插過']) });   // 上限放寬，這裡驗的是門不是名額
  // 10-16 主控覆核：走廊清單是被過濾掉的長尾回到他手上（profile §8、DESIGN §4 poolLosses ≥2 只進走廊清單、KB _curated說明），挖寶型、落選兩次、代購站都列；他鎖掉的（≤2 星、未解鎖）不列
  assert.deepEqual(idsOf(out, 0).sort(), ['可以', '咖啡廳', '藥妝', '挖寶型', '代購站', '落選兩次'].sort(), '恢復站、購物類、引擎不主動排的都照列（走廊只是會經過的店，不是引擎插站）');
  assert.equal(corridorEligible({ my: { rating: 2 } }), false); assert.equal(corridorEligible({ unlockWhen: 'x' }), false); assert.equal(corridorEligible(null), false);
  assert.equal(corridorEligible({ curated: false, poolLosses: 5, item: 'x', my: { rating: 3 } }), true);
  assert.deepEqual(corridorFor({ plan: seqOf(A), home, pool: [], legFn, settings, day }), []);
  assert.deepEqual(corridorFor({ plan: { sequence: [] }, home, pool, legFn, settings, day }), []);
});

test('corridorFor：搭車段沒有走廊；住宿沒座標就沒有第 0 段', () => {
  const nearBC = shop('BC線旁', 38.33, 140.945);   // B→C 的直線中點附近
  const out = corridorFor({ plan: seqOf(A, B, C), home, pool: [nearBC, shop('A旁', 38.2602, 140.88)], legFn, settings, day });
  assert.deepEqual(out.map((c) => c.legIndex), [0], 'B→C 是搭車段，線旁的店不列');
  const noHome = corridorFor({ plan: seqOf(A, B), home: { id: 'home', name_zh: '飯店', zoneId: 'town' }, pool: [shop('A旁', 38.2602, 140.88), shop('AB中', 38.2602, 140.885)], legFn, settings, day });
  assert.deepEqual(noHome.map((c) => [c.legIndex, c.pois.map((x) => x.poi.id)]), [[1, ['A旁', 'AB中']]], '沒有第 0 段，A 旁的店歸 A→B');
});

test('planTrip 回 plan.corridor；走廊清單不是站——序列、時刻、分數、罰分跟沒有池時一模一樣；長段提示 leg-suggest 只在走 ≥10 分且那段有店時出現、是 hint 不是罰分', () => {
  const pool = [shop('近33', 38.2603, 140.875), shop('近67', 38.2606, 140.872), shop('AB中', 38.2602, 140.885)];
  const mk = (restPool, over = {}) => planTrip({ trip: { id: 't', party: 1, homeBases: [{ poi: home }], days: [{ date: '2026-08-13', type: 'normal', designated: ['A', 'B'], picks: [{ poiId: 'A', priority: 'must' }, { poiId: 'B', priority: 'must' }] }] }, pois: { A, B }, rules, settings: { ...settings, ...over }, country, kb, legFn, restPool }).days[0].plan;
  const bare = mk([]); const withPool = mk(pool);
  const strip = (s) => [s.poi.id, s.startMin, s.endMin, s.waitMin, s.insertedBy ?? null];
  assert.deepEqual(withPool.sequence.map(strip), bare.sequence.map(strip), '走廊清單的店不進序列');
  assert.deepEqual(withPool.sequence.map((s) => s.poi.id), ['A', 'B']);
  assert.equal(withPool.score, bare.score);
  assert.equal(withPool.penaltyMin, bare.penaltyMin);
  assert.deepEqual(bare.corridor, [], '沒池就是空陣列（畫面不用判 undefined）');
  assert.deepEqual(withPool.corridor.map((c) => [c.legIndex, c.pois.map((x) => x.poi.id)]), [[0, ['近33', '近67']], [1, ['AB中']]]);
  assert.ok(withPool.corridor.every((c) => c.pois.every((x) => x.open === true)), '09:00–23:00 都開著：open true');
  // 住宿→A 走 11 分 ≥ 10 又有店 → 提示；A→B 走 5 分 → 不提示
  const hints = withPool.warnings.filter((w) => w.ruleId === 'leg-suggest');
  assert.equal(hints.length, 1, JSON.stringify(withPool.warnings));
  assert.deepEqual({ ...hints[0], msg: undefined }, { ruleId: 'leg-suggest', code: 'hint', hint: true, legIndex: 0, walkMin: 11, msg: undefined });
  assert.equal(hints[0].msg, '飯店→A 這段走 11 分，經過 近33、近67，可升級成站');
  assert.deepEqual(withPool.warnings.filter((w) => w.ruleId !== 'leg-suggest'), bare.warnings, '其他警告不動');
  assert.ok(!bare.warnings.some((w) => w.ruleId === 'leg-suggest'), '沒店就沒提示');
  // 門檻可調：legSuggestMin 12 → 11 分的那段不提示；只有第二段有店（5 分）也不提示
  assert.deepEqual(mk(pool, { legSuggestMin: 12 }).warnings.filter((w) => w.ruleId === 'leg-suggest'), []);
  assert.deepEqual(mk([shop('AB中', 38.2602, 140.885)]).warnings.filter((w) => w.ruleId === 'leg-suggest'), []);
  // 超過三家只點名三家、寫「等 N 家」
  const many = mk([1, 2, 3, 4].map((n) => shop(`店${n}`, 38.26 + n * 0.00008, 140.871 + n * 0.001)));
  assert.match(many.warnings.find((w) => w.ruleId === 'leg-suggest').msg, /經過 店1、店2、店3 等 4 家，可升級成站$/);
});

test('planTrip：任何一天勾過、按過「不去了」的、前幾天插過的店不進走廊清單（跟引擎插站同一份 exclude）；pickedOrRemoved 含主行程', () => {
  const near = shop('近33', 38.2603, 140.875);
  const mk = (days) => planTrip({ trip: { id: 't', party: 1, homeBases: [{ poi: home }], days }, pois: { A, B, 近33: near }, rules, settings, country, kb, legFn, restPool: [near] }).days;
  const d13 = { date: '2026-08-13', type: 'normal', designated: ['A'], picks: [{ poiId: 'A', priority: 'must' }] };
  assert.deepEqual(mk([d13])[0].plan.corridor.map((c) => c.pois.map((x) => x.poi.id)), [['近33']]);
  assert.deepEqual(mk([d13, { date: '2026-08-14', type: 'normal', picks: [{ poiId: '近33', priority: 'want' }] }])[0].plan.corridor, [], '別天勾了就不列');
  assert.deepEqual(mk([{ ...d13, removed: [{ poiId: '近33', at: '2026-08-13T00:00:00Z' }] }])[0].plan.corridor, [], '按過不去了就不列');
  assert.deepEqual([...pickedOrRemoved({ days: [{ picks: [{ poiId: 'x' }], anchor: { poiId: 'y' }, removed: [{ poiId: 'z' }] }, { anchor: { theme: 'vintage', poiIds: ['u', 'v'] } }] })].sort(), ['u', 'v', 'x', 'y', 'z']);
  assert.deepEqual([...pickedOrRemoved(null)], []);
});

test('planTrip options.visited：按過「我進去了」的店，進去那天照列（勾要看得到），之後的日子走廊不列、引擎的 exclude 也含它；corridorExclude 第三個參數就是這份', () => {
  const H2 = { thu: [['09:00', '23:00']], fri: [['09:00', '23:00']] };   // 8/13 週四、8/14 週五都要有開（夾具的 ALL 只有週四）
  const near = shop('近33', 38.2603, 140.875, { hours: H2 });
  const A2 = poi('A', { lat: 38.26, lng: 140.88, hours: H2 });
  const d = (date) => ({ date, type: 'normal', designated: ['A'], picks: [{ poiId: 'A', priority: 'must' }] });
  const mk = (visited) => planTrip({ trip: { id: 't', party: 1, homeBases: [{ poi: home }], days: [d('2026-08-13'), d('2026-08-14')] }, pois: { A: A2 }, rules, settings, country, kb, legFn, restPool: [near], options: { visited } }).days;
  const lists = (days) => days.map((x) => x.plan.corridor.map((c) => c.pois.map((p) => p.poi.id)));
  assert.deepEqual(lists(mk({})), [[['近33']], [['近33']]]);
  assert.deepEqual(lists(mk({ 近33: '2026-08-13' })), [[['近33']], []], '8/13 進去過：8/13 照列、8/14 不列');
  assert.deepEqual(lists(mk({ 近33: '2026-08-12' })), [[], []], '更早去過：兩天都不列');
  assert.deepEqual(lists(mk({ 近33: null })), [[['近33']], [['近33']]], '沒日期的不算');
  assert.deepEqual([...corridorExclude({ days: [] }, [], ['v', null])], ['v']);
  assert.deepEqual(visitedBefore({ a: '2026-08-12', b: '2026-08-13', c: null }, '2026-08-13'), ['a']);
  assert.deepEqual(visitedBefore(undefined, '2026-08-13'), []);
});

test('attachCorridor：掛上 corridor、提示加進 warnings，其他欄位原封不動；沒有走廊時 warnings 是同一個陣列', () => {
  const plan = { sequence: [{ poi: A }], score: 10, penaltyMin: 3, warnings: [{ code: 'x', msg: 'x' }], dropped: [] };
  const out = attachCorridor({ plan, home, pool: [shop('近33', 38.2603, 140.875)], legFn, settings, day });
  assert.equal(out.score, 10); assert.equal(out.penaltyMin, 3); assert.equal(out.sequence, plan.sequence); assert.equal(out.dropped, plan.dropped);
  assert.deepEqual(out.warnings.map((w) => w.code), ['x', 'hint']);
  assert.equal(plan.warnings.length, 1, '不改傳入的 plan');
  const none = attachCorridor({ plan, home, pool: [], legFn, settings, day });
  assert.deepEqual(none.corridor, []);
  assert.equal(none.warnings, plan.warnings);
});

test('corridorFor：經過那段的時間沒開的店不列（午休、當天休息、closedDates）；剛好開門的算開；沒營業時間資料的照列、open: null；序列沒帶時刻就只看當天有沒有營業', () => {
  // 住宿→A 走 11 分，10:49 離開、11:00 到；店都在線旁 33 m
  const at = (id, over = {}) => shop(id, 38.2603, 140.875, over);
  const timed = { sequence: [{ poi: A, arriveMin: 11 * 60, startMin: 11 * 60, endMin: 12 * 60 }], warnings: [] };
  const pool = [
    at('開著', { hours: { thu: [['10:00', '20:00']] } }),
    at('午休', { hours: { thu: [['09:00', '10:30'], ['12:00', '20:00']] } }),
    at('剛開', { hours: { thu: [['11:00', '20:00']] } }),
    at('剛關', { hours: { thu: [['09:00', '10:49']] } }),
    at('週四休', { hours: { fri: [['09:00', '20:00']] } }),
    at('臨休', { hours: ALL, closedDates: ['2026-08-13'] }),
    at('沒時段', { hours: undefined }),
  ];
  const out = corridorFor({ plan: timed, home, pool, legFn, settings, day });
  assert.deepEqual(out[0].pois.map((x) => [x.poi.id, x.open]).sort(), [['剛開', true], ['剛關', true], ['沒時段', null], ['開著', true]].sort(), '午休、週四休、臨休不列');
  // 第二段 A→B：12:00 離開、12:05 到，午休那家開了就列在第二段
  const nearA = shop('A旁午休', 38.2602, 140.88, { hours: { thu: [['12:00', '20:00']] } });
  const two = corridorFor({ plan: { sequence: [{ poi: A, arriveMin: 660, startMin: 660, endMin: 720 }, { poi: B, arriveMin: 725, startMin: 725, endMin: 785 }], warnings: [] }, home, pool: [nearA], legFn, settings, day });
  assert.deepEqual(two.map((c) => [c.legIndex, c.pois.map((x) => x.poi.id)]), [[1, ['A旁午休']]], '離第 0 段一樣近但那時沒開，歸第 1 段');
  // 序列沒帶時刻（純幾何）：只看當天有沒有營業
  const geo = corridorFor({ plan: seqOf(A), home, pool, legFn, settings, day });
  assert.deepEqual(geo[0].pois.map((x) => x.poi.id).sort(), ['剛開', '剛關', '午休', '沒時段', '開著'].sort());
});

test('corridorExclude：勾過／拒絕過 ∪ 任何一天引擎插過的；planTrip 七天排完才算走廊，別天引擎插的站不列', () => {
  const ex = corridorExclude({ days: [{ picks: [{ poiId: 'x' }], removed: [{ poiId: 'z' }] }] }, [[{ poi: { id: 'e1' }, insertedBy: 'engine' }, { poi: { id: 'p1' } }], null, [{ poi: { id: 'e2' }, insertedBy: 'engine' }]]);
  assert.deepEqual([...ex].sort(), ['e1', 'e2', 'x', 'z']);
  assert.deepEqual([...corridorExclude(null)], []);
  // 8/13 拒絕過順路站（那天不插）、8/14 沒拒絕：近33 在 8/14 被當順路站插進去（住宿→近33 5 分、近33→A 7 分，繞路 1 分）→ 8/13 的走廊不列它
  const both = { thu: [['09:00', '23:00']], fri: [['09:00', '23:00']] };
  const A2 = poi('A', { lat: 38.26, lng: 140.88, hours: both });
  const near = shop('近33', 38.2603, 140.875, { hours: both });
  const walk = { 'home|A': 11, 'home|近33': 5, '近33|A': 7 };
  const legFn2 = (a, b) => ({ walkMin: walk[`${a.id}|${b.id}`] ?? walk[`${b.id}|${a.id}`] ?? 20, rideMin: 0, climbMin: 0, mode: 'walk' });
  const days = [
    { date: '2026-08-13', type: 'normal', designated: ['A'], picks: [{ poiId: 'A', priority: 'must' }], removed: [{ poiId: 'other', at: '2026-08-13T00:00:00Z', insertedBy: 'engine', priority: 'onway' }] },
    { date: '2026-08-14', type: 'normal', designated: ['A'], picks: [{ poiId: 'A', priority: 'must' }] },
  ];
  const r = planTrip({ trip: { id: 't', party: 1, homeBases: [{ poi: home }], days }, pois: { A: A2 }, rules, settings, country, kb, legFn: legFn2, restPool: [near] }).days;
  const d14 = r[1].plan.sequence.find((s) => s.poi.id === '近33');
  assert.ok(d14?.insertedBy === 'engine', `8/14 要把近33 當順路站插進去：${r[1].plan.sequence.map((s) => s.poi.id).join('→')}`);
  assert.deepEqual(r[0].plan.corridor, [], '8/13 的走廊不列別天引擎插的站');
  // 8/14 也沒拒絕過時兩天都不插（8/13 先插、8/14 的 exclude 含前幾天插過的）→ 8/13 它是站、8/14 的走廊不列
  const r2 = planTrip({ trip: { id: 't', party: 1, homeBases: [{ poi: home }], days: [{ ...days[0], removed: [] }, days[1]] }, pois: { A: A2 }, rules, settings, country, kb, legFn: legFn2, restPool: [near] }).days;
  assert.ok(r2[0].plan.sequence.some((s) => s.poi.id === '近33' && s.insertedBy === 'engine'));
  assert.deepEqual(r2[1].plan.corridor, []);
});
