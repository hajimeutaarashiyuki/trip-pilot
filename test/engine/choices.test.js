// 二選一與順延（T16；DESIGN §6.3.2；profile §7；原話 #119、#121、#138）：
// proposeChoices——序列裡④層（他勾的、非 must、非指定、非主行程、沒固定時段）同類上限那三類的站 A，配一家同店型的 B：先那天排不進的同類勾選站、再候選池（繞路 ≤10、那時有開、過 choiceEligible、不在 exclude）；
// 一個 A 一個 B、一個 B 只配一個 A；不進分數與時刻（planTrip 的序列跟沒有池時一模一樣）。
// defer——主題日優先、再其餘日子由早到晚；排除 fromDate、departure、購物日、那天休息、當日區域不含；每天用 planTrip options.onlyDates 試排，排得進就定案。
// 小世界照 rest-pool.test 的寫法：town 一區、所有站同座標、站間走 5 分（表裡有的照表）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planTrip } from '../../src/engine/trip.js';
import { proposeChoices, defer, deferCandidateDays, choiceEligible, isChoiceStop, deferredEntry, swappedAwayFrom } from '../../src/engine/choices.js';
import { loadRules } from '../../src/rules/index.js';
import { BUILTIN } from '../../src/rules/builtin.js';
import rulesJson from '../../src/rules.json' with { type: 'json' };

const rules = loadRules(BUILTIN, rulesJson.rules);
const settings = rulesJson.settings;
const country = { mealSlots: { lunch: ['11:30', '13:30'], dinner: ['18:00', '20:30'] }, nightSlot: ['20:00', '24:00'], climate: { summerMonths: [6, 7, 8, 9] }, utcOffsetMin: 540 };
const kb = { zones: { town: { environment: 'town', lat: 38.26, lng: 140.87 }, far: { environment: 'town', lat: 38.40, lng: 141.00 } } };
const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const ALL = Object.fromEntries(DAYS.map((d) => [d, [['09:00', '23:00']]]));   // 2026-08-12 週三、13 週四、14 週五、15 週六、16 週日
const poi = (id, over = {}) => ({ id, name_zh: id, category: 'street', walkFactor: 1, recovery: false, cafeLike: false, climbMin: 0, zoneId: 'town', hours: ALL, dwellMin: 40, daylightOnly: false, lat: 38.26, lng: 140.87, ...over });
// 咖啡廳：走路係數 0（不觸發走路連跑→不插恢復站）、同類上限那三類之一
const cafe = (id, over = {}) => poi(id, { category: 'cafe', walkFactor: 0, recovery: true, cafeLike: true, ...over });
const home = { id: 'home', name_zh: '飯店', zoneId: 'town', lat: 38.26, lng: 140.87 };
const WALK = { 'home|甲': 3, '甲|乙': 2, '乙|丙': 2, '甲|丙': 3, '街|丙': 10, '街|遠': 20, '甲|遠': 20, '乙|遠': 20, '街|丁': 2 };
const legFn = (a, b) => ({ walkMin: WALK[`${a.id}|${b.id}`] ?? WALK[`${b.id}|${a.id}`] ?? 5, rideMin: 0, climbMin: 0, mode: 'walk' });
const ids = (seq) => seq.map((s) => s.poi.id);
const choiceView = (plan) => plan.choices.map((c) => [c.poiId, c.options[1], c.source]);
const day = (date, over = {}) => ({ date, type: 'normal', picks: [], ...over });
const mkTrip = (days, over = {}) => ({ id: 't', party: 1, homeBases: [{ poi: home }], days, ...over });
const run = (trip, pois, restPool = [], options = {}) => planTrip({ trip, pois, rules, settings, country, kb, legFn, restPool, options });

// 8/13 勾三家咖啡廳（非主題日同類 ≤2）：兩家排得進、一家排不進
const A = cafe('甲'); const B = cafe('乙'); const C = cafe('丙');
const three = { 甲: A, 乙: B, 丙: C };
const threeDay = (over = {}) => day('2026-08-13', { picks: [{ poiId: '甲', priority: 'want' }, { poiId: '乙', priority: 'want' }, { poiId: '丙', priority: 'maybe' }], ...over });
// 手造的序列（proposeChoices 直接吃，繞路才算得準）：站 10:00 起每站 60 分，欄位照 planDay 排出的 stop；街 是走動的站，放第一站讓後面的咖啡廳有「前一站」可算繞路
const S = poi('街');
const stop = (p, i, over = {}) => ({ poi: p, priority: 'want', startMin: 600 + i * 60, endMin: 640 + i * 60, dwellMin: 40, insertedBy: null, designated: false, isAnchor: false, fixedWindow: null, ...over });
const mkPlan = (list, dropped = []) => ({ sequence: list.map((p, i) => (Array.isArray(p) ? stop(p[0], i, p[1]) : stop(p, i))), dropped: dropped.map((p) => ({ poi: p, priority: 'maybe', reason: '' })) });
const propose = (plan, pool = [], over = {}) => proposeChoices({ plan, date: '2026-08-13', pool, legFn, settings, ...over }).map((c) => [c.poiId, c.options[1], c.source, c.detourMin]);

test('兩家同類④層都在 picks、只排得進一家：排進的那家出 choice，options [A, 排不進的]、source dropped；plan.choices 沒有就空陣列', () => {
  const r = run(mkTrip([threeDay()]), three);
  const { plan } = r.days[0];
  assert.deepEqual(plan.dropped.map((x) => x.poi.id), ['丙'], `丙要排不進：${ids(plan.sequence).join('→')}`);
  assert.equal(plan.choices.length, 1, JSON.stringify(choiceView(plan)));
  const c = plan.choices[0];
  assert.ok(['甲', '乙'].includes(c.poiId) && ids(plan.sequence).includes(c.poiId), 'A 是排進去的那家');
  assert.deepEqual([c.options, c.source, c.date], [[c.poiId, '丙'], 'dropped', '2026-08-13']);
  assert.equal(c.slot, ids(plan.sequence).indexOf(c.poiId));
  assert.equal(c.altPoi, C, 'altPoi 是 B 的 POI 本體');
  assert.equal(typeof c.detourMin, 'number');
  const bare = run(mkTrip([day('2026-08-13', { picks: [{ poiId: '甲', priority: 'want' }] })]), { 甲: A });
  assert.deepEqual(bare.days[0].plan.choices, [], '沒有 B 可配就是空陣列');
});

test('配對：一個 B 只配一個 A（繞路最小的那個）、一個 A 一個 B；排不進的勾選站優先於候選池、不套繞路門檻；當天休息的、must 的排不進站不配', () => {
  // 街→甲→乙，丙排不進：甲的繞路＝街→丙 10＋丙→乙 2−街→乙 5＝7，乙是最後一站＝甲→丙 3 → 丙配給乙
  assert.deepEqual(propose(mkPlan([S, A, B], [C])), [['乙', '丙', 'dropped', 3]]);
  // 候選池再加丁（街|丁 2）：這天已有同店型的勾選站排不進（丙），候選池的丁不拿出來問（10-16 主控覆核：問了只會把他勾的擠掉）——甲沒有 B、乙配丙
  assert.deepEqual(propose(mkPlan([S, A, B], [C]), [cafe('丁')]), [['乙', '丙', 'dropped', 3]]);
  // 排不進的那家是 must（不配）時也算「這類今天已經塞不下」，候選池照樣不問；排不進的是別的店型就照問
  assert.deepEqual(propose({ ...mkPlan([S, A, B]), dropped: [{ poi: C, priority: 'must', reason: '' }] }, [cafe('丁')]), [['甲', '丁', 'pool', 2]], 'must 的排不進站不算同類塞不下（它是他指定要去、不是二選一的對象）');
  assert.deepEqual(propose(mkPlan([S, A, B], [poi('別類', { category: 'record' })]), [cafe('丁')]), [['甲', '丁', 'pool', 2]], '排不進的是別的店型：候選池照問');
  // 排不進的勾選站優先：丙對甲繞路 10、候選池的丁只要 2，甲還是配丙（來源 (1) 先）
  assert.deepEqual(propose(mkPlan([S, A], [C]), [cafe('丁')]), [['甲', '丙', 'dropped', 10]], '甲是最後一站：繞路＝街→丙 10');
  assert.deepEqual(propose(mkPlan([S, A], [cafe('遠')])), [['甲', '遠', 'dropped', 20]], '排不進的勾選站不套繞路門檻（待確認）');
  assert.deepEqual(propose(mkPlan([S, A], [cafe('丙', { hours: { ...ALL, thu: [] } })])), [], '當天休息的排不進站不配');
  // 10-16 審查：B 因營業時間排不進（A 排 11:00、B 18:00 才開）不是「今天只塞得下一家」，不配；查不到營業時間的照配（跟候選池同一道門）
  assert.deepEqual(propose(mkPlan([S, A], [cafe('丙', { hours: Object.fromEntries(DAYS.map((d) => [d, [['18:00', '23:00']]])) })])), [], 'A 的時段 B 沒開：不配');
  assert.deepEqual(propose(mkPlan([S, A], [cafe('丙', { hours: Object.fromEntries(DAYS.map((d) => [d, [['09:00', '11:30']]])) })])), [], 'A 11:00 開始、停 40 分，B 11:30 關：塞不進 A 的時段');
  assert.deepEqual(propose(mkPlan([S, A], [cafe('丙', { hours: null })])), [['甲', '丙', 'dropped', 10]], '營業時間查不到的照配');
  assert.deepEqual(propose({ ...mkPlan([S, A]), dropped: [{ poi: C, priority: 'must', reason: '' }] }), [], 'must 的排不進站不配');
  assert.deepEqual(propose(mkPlan([S, A], [C])), [['甲', '丙', 'dropped', 10]]);
});

test('候選池的 B（source pool）：同店型、繞路 ≤ swapDetourMaxMin、那時段有開（查不到也算）、過 choiceEligible、不在 exclude；繞路 >10、那時沒開、不同店型、curated:false／落選兩次／兩星都不出；有 item 的照出；同來源取繞路最小的', () => {
  const plan = mkPlan([S, A]);   // 街 → 甲：甲是最後一站，換成 B 的繞路＝街→B
  assert.deepEqual(propose(plan, [cafe('乙')]), [['甲', '乙', 'pool', 5]], '表裡沒有的配對走 5 分：順路');
  assert.deepEqual(propose(plan, [cafe('遠')]), [], '街→遠 20 分：繞路 20 > 10 不出');
  assert.deepEqual(propose(plan, [cafe('遠')], { settings: { ...settings, swapDetourMaxMin: 25 } }), [['甲', '遠', 'pool', 20]], '門檻可調');
  assert.deepEqual(propose(plan, [cafe('乙')], { settings: { ...settings, swapDetourMaxMin: 1 } }), []);
  assert.deepEqual(propose(plan, [cafe('乙', { hours: Object.fromEntries(DAYS.map((d) => [d, [['18:00', '23:00']]])) })]), [], '甲排在 11:00、乙 18:00 才開：不出');
  assert.deepEqual(propose(plan, [cafe('乙', { hours: null })]), [['甲', '乙', 'pool', 5]], '營業時間查不到的照出（open null）');
  assert.deepEqual(propose(plan, [poi('乙', { category: 'record', walkFactor: 0 })]), [], '唱片行不配咖啡廳');
  assert.deepEqual(propose(plan, [poi('乙', { category: 'food', walkFactor: 0, recovery: true })]), [], '餐段放寬那條不適用：吃的不配咖啡廳');
  for (const over of [{ curated: false }, { poolLosses: 2 }, { my: { rating: 2 } }, { unlockWhen: '同品類喝無可喝' }]) assert.deepEqual(propose(plan, [cafe('乙', over)]), [], JSON.stringify(over));
  assert.deepEqual(propose(plan, [cafe('乙', { item: '咖啡豆' })]), [['甲', '乙', 'pool', 5]], '④就是品項層：有 item 的照出');
  assert.deepEqual([choiceEligible(cafe('x', { item: 'y' })), choiceEligible(cafe('x', { curated: false })), choiceEligible(null)], [true, false, false]);
  assert.deepEqual(propose(plan, [cafe('乙')], { exclude: new Set(['乙']) }), [], 'exclude');
  assert.deepEqual(propose(plan, [cafe('乙'), cafe('丁')]), [['甲', '丁', 'pool', 2]], '同來源取繞路最小的：乙 5、丁 2');
  assert.deepEqual(propose(plan, []), [], '沒有池');
  // 透過 planTrip：候選池的 B 掛在 plan.choices
  const one = mkTrip([day('2026-08-13', { picks: [{ poiId: '街', priority: 'must' }, { poiId: '甲', priority: 'want' }] })]);
  assert.deepEqual(choiceView(run(one, { 街: S, 甲: A }, [cafe('乙')]).days[0].plan), [['甲', '乙', 'pool']]);
});

test('A 不是④層就不出：must、指定站、主行程、引擎插的、有固定時段；不是同類上限那三類也不出', () => {
  assert.deepEqual(propose(mkPlan([S, A]), [cafe('乙')]), [['甲', '乙', 'pool', 5]], '對照組');
  assert.deepEqual(propose(mkPlan([S, [A, { priority: 'must' }]]), [cafe('乙')]), [], 'must');
  assert.deepEqual(propose(mkPlan([S, [A, { designated: true }]]), [cafe('乙')]), [], '指定站');
  assert.deepEqual(propose(mkPlan([S, [A, { isAnchor: true }]]), [cafe('乙')]), [], '主行程');
  assert.deepEqual(propose(mkPlan([S, [A, { fixedWindow: { startMin: 660, arriveEarlyMin: 0 } }]]), [cafe('乙')]), [], '固定時段');
  assert.deepEqual(propose(mkPlan([S, [A, { insertedBy: 'engine', priority: 'filler', optional: true }]]), [cafe('乙')]), [], '引擎插的');
  assert.deepEqual(propose(mkPlan([S, poi('書店', { category: 'bookstore', walkFactor: 0 })]), [poi('乙', { category: 'bookstore', walkFactor: 0 })]), [], '書店不是同類上限那三類');
  assert.equal(isChoiceStop({ poi: cafe('x'), priority: 'want', insertedBy: 'engine' }), false);
  assert.equal(isChoiceStop({ poi: poi('x'), priority: 'want' }), false, 'street 不是同類上限那三類');
  assert.equal(isChoiceStop({ poi: poi('x', { category: 'vintage' }), priority: 'maybe' }), true);
  // 透過 planTrip：等開門空檔讓引擎填一家咖啡廳進去（早的 10:00 關、晚開 12:00 才開），那家是引擎插的、不出（另一家咖啡廳還在候選池也不出）
  const late = poi('晚開', { hours: Object.fromEntries(DAYS.map((d) => [d, [['12:00', '23:00']]])), dwellMin: 50 });
  const early = poi('早的', { hours: Object.fromEntries(DAYS.map((d) => [d, [['09:00', '10:00']]])), dwellMin: 50 });
  const filled = run(mkTrip([day('2026-08-13', { picks: [{ poiId: '早的', priority: 'must' }, { poiId: '晚開', priority: 'must' }] })]), { 早的: early, 晚開: late }, [cafe('填'), cafe('乙')]).days[0].plan;
  const ins = filled.sequence.find((s) => s.insertedBy === 'engine');
  assert.ok(ins && ins.poi.category === 'cafe', `要有引擎插的咖啡廳：${ids(filled.sequence).join('→')}`);
  assert.deepEqual(filled.choices, []);
});

test('B 的排除：別天勾過、別天按過「不去了」、別天序列裡（含引擎插的）、知識庫去過（my.visits 非空）、按過「我進去了」的都不出', () => {
  const pool = [cafe('乙')];
  const d13 = day('2026-08-13', { picks: [{ poiId: '甲', priority: 'want' }] });
  const two = (d14, pois = { 甲: A }, options = {}) => run(mkTrip([d13, d14]), pois, pool, options).days[0].plan;
  assert.deepEqual(choiceView(two(day('2026-08-14'))), [['甲', '乙', 'pool']], '對照組');
  assert.deepEqual(choiceView(two(day('2026-08-14', { picks: [{ poiId: '乙', priority: 'want' }] }), { 甲: A, 乙: B })), [], '別天勾過');
  assert.deepEqual(choiceView(two(day('2026-08-14', { removed: [{ poiId: '乙', at: '2026-08-13T00:00:00Z' }] }))), [], '別天按過不去了');
  // 別天引擎插的：8/14 等開門空檔會把乙當填站插進去 → 8/13 不當 B（七天排完才算）
  const late = poi('晚開', { hours: Object.fromEntries(DAYS.map((d) => [d, [['12:00', '23:00']]])), dwellMin: 50 });
  const early = poi('早的', { hours: Object.fromEntries(DAYS.map((d) => [d, [['09:00', '10:00']]])), dwellMin: 50 });
  const r = run(mkTrip([d13, day('2026-08-14', { picks: [{ poiId: '早的', priority: 'must' }, { poiId: '晚開', priority: 'must' }] })]), { 甲: A, 早的: early, 晚開: late }, pool);
  assert.ok(r.days[1].plan.sequence.some((s) => s.poi.id === '乙' && s.insertedBy === 'engine'), `8/14 要把乙當填站插進去：${ids(r.days[1].plan.sequence).join('→')}`);
  assert.deepEqual(choiceView(r.days[0].plan), [], '別天序列裡的（引擎插的）不出');
  assert.deepEqual(choiceView(run(mkTrip([d13]), { 甲: A }, [cafe('乙', { my: { visits: [{ on: '2025-08-13' }] } })]).days[0].plan), [], '去過的不再出現（原話 #138）');
  assert.deepEqual(choiceView(two(day('2026-08-14'), { 甲: A }, { visited: { 乙: '2026-08-12' } })), [], '按過「我進去了」之後的日子不出');
  assert.deepEqual(choiceView(two(day('2026-08-14'), { 甲: A }, { visited: { 乙: '2026-08-13' } })), [['甲', '乙', 'pool']], '進去那天本身照出（跟走廊清單同一種算法）');
  // proposeChoices 直接呼叫：exclude 自己給
  const plan = r.days[0].plan;
  assert.deepEqual(proposeChoices({ plan, date: '2026-08-13', pool, legFn, settings, exclude: new Set() }).map((c) => c.options), [['甲', '乙']]);
  assert.deepEqual(proposeChoices({ plan, date: '2026-08-13', pool, legFn, settings, exclude: new Set(['乙']) }), []);
  assert.deepEqual(proposeChoices({ plan: { sequence: [] }, date: '2026-08-13', pool, legFn, settings }), []);
});

// 順延的小世界：8/12 普通、8/13 出發日（fromDate）、8/14 咖啡廳主題日、8/15 普通、8/16 離境日
const FOUR = [day('2026-08-12'), day('2026-08-13', { picks: [{ poiId: '甲', priority: 'want' }] }), day('2026-08-14', { anchor: { theme: 'cafe' } }), day('2026-08-15'), day('2026-08-16', { type: 'departure', departAirportMin: 15 * 60 })];
const planArgs = { rules, settings, country, kb, legFn, restPool: [] };
const baselineOf = (trip, pois) => ({ days: planTrip({ trip, pois, ...planArgs }).days });

test('候選日只拿 normal 日：抵達、固定時段、離境、一日遊都不是；他在那天換掉過它的（day.swapped）也不是——再順延不會彈回當初選 B 的那天（10-16 審查）', () => {
  const days = [day('2026-08-12', { type: 'arrival' }), day('2026-08-13', { picks: [{ poiId: '甲', priority: 'want' }] }), day('2026-08-14', { type: 'fixed' }), day('2026-08-15', { dayTrip: true }), day('2026-08-16'), day('2026-08-17'), day('2026-08-18', { type: 'departure', departAirportMin: 15 * 60 })];
  const pois = { 甲: A, 丙: C };
  const trip = mkTrip(days, { shoppingDays: [] });
  assert.deepEqual(deferCandidateDays({ trip, poi: A, fromDate: '2026-08-13', baseline: baselineOf(trip, pois) }), ['2026-08-16', '2026-08-17']);
  // 8/13 他選了丙頂掉甲（day.swapped 記著）、甲順延到 8/16；之後從 8/16 再順延 → 8/13 不在候選日裡（之前會彈回去、把丙擠出去）
  const chosen = mkTrip(days.map((d) => (d.date === '2026-08-13' ? { ...d, picks: [{ poiId: '丙', priority: 'want' }], swapped: [{ from: '甲', to: '丙', at: 'T0' }] } : d)), { shoppingDays: [] });
  const first = defer({ trip: chosen, pois, poiId: '甲', fromDate: '2026-08-13', chosenPoiId: '丙', baseline: baselineOf(chosen, pois), planArgs });
  assert.equal(first.toDate, '2026-08-16');
  assert.deepEqual(deferCandidateDays({ trip: first.trip, poi: A, fromDate: '2026-08-16', baseline: baselineOf(first.trip, pois) }), ['2026-08-17']);
  const second = defer({ trip: first.trip, pois, poiId: '甲', fromDate: '2026-08-16', chosenPoiId: null, baseline: baselineOf(first.trip, pois), planArgs });
  assert.equal(second.toDate, '2026-08-17', '不彈回 8/13');
  assert.deepEqual(second.trip.days.find((d) => d.date === '2026-08-13').picks.map((p) => p.poiId), ['丙'], '8/13 的丙沒被擠');
  // swappedAwayFrom：那天換掉過的 ∪ unplaced 的 A（fromDate 那天）；別天空
  const away = { ...chosen, deferred: [{ poiId: '戊', chosenPoiId: '丙', fromDate: '2026-08-13', toDate: null, status: 'unplaced', at: 'T0' }, { poiId: '己', chosenPoiId: null, fromDate: '2026-08-13', toDate: '2026-08-16', status: 'placed', at: 'T0' }] };
  assert.deepEqual(swappedAwayFrom(away, '2026-08-13'), ['甲', '戊']);
  assert.deepEqual(swappedAwayFrom(away, '2026-08-16'), []);
  assert.deepEqual(swappedAwayFrom(null, '2026-08-13'), []);
});

test('順延的 pick 沿用它在 fromDate 的優先度（maybe 搬走還是 maybe；規格寫 want，10-16 審查後改，待確認）；defer 也可以直接給 priority', () => {
  const trip = mkTrip(FOUR.map((d) => (d.date === '2026-08-13' ? { ...d, picks: [{ poiId: '甲', priority: 'maybe' }] } : d)), { shoppingDays: [] });
  const pois = { 甲: A, 丙: C };
  const r = defer({ trip, pois, poiId: '甲', fromDate: '2026-08-13', chosenPoiId: null, baseline: baselineOf(trip, pois), planArgs });
  assert.equal(r.toDate, '2026-08-14');
  assert.deepEqual(r.trip.days.find((d) => d.date === r.toDate).picks, [{ poiId: '甲', priority: 'maybe', deferredFrom: '2026-08-13' }]);
  const w = defer({ trip, pois, poiId: '甲', fromDate: '2026-08-13', chosenPoiId: null, baseline: baselineOf(trip, pois), planArgs, priority: 'want' });
  assert.equal(w.trip.days.find((d) => d.date === w.toDate).picks[0].priority, 'want');
});

test('defer 先挑排得進又不擠掉別的勾選站的日子：8/12 已有兩家咖啡廳（同類上限）、甲排進去會擠掉一家 → 先試但不收，8/14 空著就排 8/14；只剩 8/12 時退而求其次排 8/12（擠掉誰由畫面那句講）', () => {
  const D = cafe('丁');
  const pois = { 甲: A, 乙: B, 丁: D };
  const crowded = day('2026-08-12', { picks: [{ poiId: '乙', priority: 'want' }, { poiId: '丁', priority: 'want' }] });
  const from = day('2026-08-13', { picks: [{ poiId: '甲', priority: 'want' }] });
  const trip = mkTrip([crowded, from, day('2026-08-14'), day('2026-08-15', { type: 'departure', departAirportMin: 15 * 60 })], { shoppingDays: [] });
  const base = baselineOf(trip, pois);
  assert.deepEqual(base.days[0].plan.dropped, [], '8/12 兩家都排得進');
  assert.deepEqual(deferCandidateDays({ trip, poi: A, fromDate: '2026-08-13', baseline: base }), ['2026-08-12', '2026-08-14'], '8/12 排前面');
  const r = defer({ trip, pois, poiId: '甲', fromDate: '2026-08-13', chosenPoiId: null, baseline: base, planArgs });
  assert.equal(r.toDate, '2026-08-14', '8/12 排得進但會擠掉乙或丁，跳過');
  const only = mkTrip([crowded, from, day('2026-08-14', { dayTrip: true }), day('2026-08-15', { type: 'departure', departAirportMin: 15 * 60 })], { shoppingDays: [] });
  const r2 = defer({ trip: only, pois, poiId: '甲', fromDate: '2026-08-13', chosenPoiId: null, baseline: baselineOf(only, pois), planArgs });
  assert.equal(r2.toDate, '2026-08-12', '沒有不擠人的日子就用第一個排得進的');
  const re = planTrip({ trip: r2.trip, pois, ...planArgs });
  assert.ok(re.days[0].plan.sequence.some((s) => s.poi.id === '甲' && s.deferredFrom === '2026-08-13'));
  assert.equal(re.days[0].plan.dropped.length, 1, `乙或丁有一家被擠掉（畫面那句會寫）：${ids(re.days[0].plan.sequence).join('→')}`);
  assert.ok(['乙', '丁'].includes(re.days[0].plan.dropped[0].poi.id));
});

test('defer：同店型主題日優先（8/14 在 8/12 之後也先試）；排得進 → toDate、trip.deferred placed、那天 picks 有它帶 deferredFrom、fromDate 的那筆拿掉；排進去的 stop 帶 deferredFrom；不改傳入的 trip', () => {
  const trip = mkTrip(FOUR, { shoppingDays: [] });
  const pois = { 甲: A, 丙: C };
  const r = defer({ trip, pois, poiId: '甲', fromDate: '2026-08-13', chosenPoiId: '丙', baseline: baselineOf(trip, pois), planArgs });
  assert.equal(r.toDate, '2026-08-14');
  assert.deepEqual({ ...r.entry, at: undefined }, { poiId: '甲', chosenPoiId: '丙', fromDate: '2026-08-13', toDate: '2026-08-14', status: 'placed', at: undefined });
  assert.ok(typeof r.entry.at === 'string');
  assert.deepEqual(r.trip.deferred, [r.entry]);
  assert.deepEqual(r.trip.days.find((d) => d.date === '2026-08-14').picks, [{ poiId: '甲', priority: 'want', deferredFrom: '2026-08-13' }]);
  assert.deepEqual(r.trip.days.find((d) => d.date === '2026-08-13').picks, [], '搬走了：fromDate 的那筆拿掉，不然同一家店兩天都勾');
  assert.deepEqual(trip.days.find((d) => d.date === '2026-08-13').picks, [{ poiId: '甲', priority: 'want' }], '不改傳入的 trip');
  assert.equal(trip.deferred, undefined);
  assert.equal(deferredEntry(r.trip, '甲'), r.entry); assert.equal(deferredEntry(r.trip, '乙'), null); assert.equal(deferredEntry(null, '甲'), null);
  // 重排後那天的 stop 帶 deferredFrom（畫面寫「從 8/13 順延」）；沒順延的站是 null
  const re = planTrip({ trip: r.trip, pois, ...planArgs });
  const s = re.days.find((d) => d.date === '2026-08-14').plan.sequence.find((x) => x.poi.id === '甲');
  assert.equal(s?.deferredFrom, '2026-08-13');
  assert.deepEqual(re.warnings, [], '順延過來排得進就沒有整趟警告');
  assert.ok(re.days.every((d) => d.plan.sequence.every((x) => x.poi.id === '甲' || x.deferredFrom === null)));
  // 候選日順序：主題日先、其餘由早到晚；fromDate、離境日不在
  assert.deepEqual(deferCandidateDays({ trip, poi: A, fromDate: '2026-08-13', baseline: baselineOf(trip, pois) }), ['2026-08-14', '2026-08-12', '2026-08-15']);
});

test('defer 的排除：購物日、那天休息的、當日區域不含它的 Zone 的都跳過；全排不進 → status unplaced、toDate null、picks 沒它、fromDate 的那筆不動', () => {
  const pois = { 甲: A, 丙: C };
  // 8/14、8/15 是購物日（覆寫）、8/12 週三休 → 沒有候選日
  const closedWed = cafe('甲', { hours: { ...ALL, wed: [] } });
  const trip = mkTrip(FOUR, { shoppingDays: ['2026-08-14', '2026-08-15'] });
  const base = baselineOf(trip, { 甲: closedWed, 丙: C });
  assert.deepEqual(deferCandidateDays({ trip, poi: closedWed, fromDate: '2026-08-13', baseline: base }), []);
  const r = defer({ trip, pois: { 甲: closedWed, 丙: C }, poiId: '甲', fromDate: '2026-08-13', chosenPoiId: '丙', baseline: base, planArgs });
  assert.deepEqual({ ...r.entry, at: undefined }, { poiId: '甲', chosenPoiId: '丙', fromDate: '2026-08-13', toDate: null, status: 'unplaced', at: undefined });
  assert.equal(r.toDate, null);
  assert.ok(r.trip.days.every((d) => d.date === '2026-08-13' || !d.picks.some((p) => p.poiId === '甲')), '別天的 picks 沒它');
  assert.deepEqual(r.trip.days.find((d) => d.date === '2026-08-13').picks, [{ poiId: '甲', priority: 'want' }], '排不進就留在原處（排不進清單那站不動）');
  assert.deepEqual(r.trip.deferred, [r.entry]);
  // 區域不含：別區的店，沒有一天的當日區域有 far → 跳過；8/12 勾了一家 far 的站那天就含
  const farCafe = cafe('遠', { zoneId: 'far' });
  const base2 = baselineOf(mkTrip(FOUR, { shoppingDays: [] }), { 甲: A, 遠: farCafe });
  assert.deepEqual(deferCandidateDays({ trip: mkTrip(FOUR, { shoppingDays: [] }), poi: farCafe, fromDate: '2026-08-13', baseline: base2 }), []);
  const withFar = mkTrip([day('2026-08-12', { picks: [{ poiId: '遠站', priority: 'want' }] }), ...FOUR.slice(1)], { shoppingDays: [] });
  const farPoi = poi('遠站', { zoneId: 'far' });
  const base3 = baselineOf(withFar, { 甲: A, 遠: farCafe, 遠站: farPoi });
  assert.deepEqual(deferCandidateDays({ trip: withFar, poi: farCafe, fromDate: '2026-08-13', baseline: base3 }), ['2026-08-12']);
  // 沒有 baseline（上下文）就沒有候選日；沒這家店也是 unplaced、不丟錯
  assert.deepEqual(deferCandidateDays({ trip, poi: A, fromDate: '2026-08-13', baseline: null }), []);
  assert.equal(defer({ trip, pois, poiId: 'ghost', fromDate: '2026-08-13', baseline: base, planArgs }).entry.status, 'unplaced');
});

test('同一家店第二次順延覆蓋同一筆：上一次順延到的那天的 pick 拿掉、trip.deferred 只有一筆；排不進的勾選站直接順延（chosenPoiId null）', () => {
  const trip = mkTrip(FOUR, { shoppingDays: [] });
  const pois = { 甲: A, 丙: C };
  const first = defer({ trip, pois, poiId: '甲', fromDate: '2026-08-13', chosenPoiId: null, baseline: baselineOf(trip, pois), planArgs });
  assert.equal(first.toDate, '2026-08-14');
  assert.equal(first.entry.chosenPoiId, null);
  // 8/14 又不要它：從 8/14 順延 → 8/12（主題日不能再選，其餘由早到晚）
  const second = defer({ trip: first.trip, pois, poiId: '甲', fromDate: '2026-08-14', chosenPoiId: null, baseline: baselineOf(first.trip, pois), planArgs });
  assert.equal(second.toDate, '2026-08-12');
  assert.deepEqual(second.trip.deferred.map((e) => [e.fromDate, e.toDate, e.status]), [['2026-08-14', '2026-08-12', 'placed']], '只有一筆、是新的');
  assert.deepEqual(second.trip.days.find((d) => d.date === '2026-08-14').picks, [], '上一次順延到的那天不再有它');
  assert.deepEqual(second.trip.days.find((d) => d.date === '2026-08-12').picks, [{ poiId: '甲', priority: 'want', deferredFrom: '2026-08-14' }]);
  assert.equal(second.trip.days.filter((d) => d.picks.some((p) => p.poiId === '甲')).length, 1, '整趟只勾一次');
});

test('planTrip options.onlyDates：只排清單內的日子，其餘 plan 為 null、day 上下文照回；那天的序列跟整趟排一樣', () => {
  const trip = mkTrip(FOUR, { shoppingDays: [] });
  const pois = { 甲: A };
  const full = planTrip({ trip, pois, ...planArgs });
  const only = planTrip({ trip, pois, ...planArgs, options: { onlyDates: ['2026-08-13'] } });
  assert.equal(only.days.length, 5);
  assert.deepEqual(only.days.map((d) => [d.date, d.plan === null]), [['2026-08-12', true], ['2026-08-13', false], ['2026-08-14', true], ['2026-08-15', true], ['2026-08-16', true]]);
  assert.deepEqual(ids(only.days[1].plan.sequence), ids(full.days[1].plan.sequence));
  assert.equal(only.days[1].plan.score, full.days[1].plan.score);
  assert.deepEqual(only.days[1].plan.choices, full.days[1].plan.choices);
  assert.equal(only.days[2].day.themeCategory, 'cafe', '跳過的日子上下文照回');
  assert.equal(only.days[3].day.prevThemeCategory, 'cafe', '主題照傳給下一天');
  assert.deepEqual(only.days[4].day.type, 'departure');
  assert.deepEqual(only.warnings, full.warnings);
});

test('unplaced 的 A 在被頂掉的那天不再當 B（10-16 審查：重排後 B 的卡立刻出「或 A」，跟頂端那句矛盾）；別天照出；這天換掉過的（day.swapped）同樣不當 B', () => {
  const pool = [cafe('乙')];
  const d13 = day('2026-08-13', { picks: [{ poiId: '甲', priority: 'want' }] });
  const d14 = day('2026-08-14', { picks: [{ poiId: '丙', priority: 'want' }] });
  const pois = { 甲: A, 丙: C };
  assert.deepEqual(run(mkTrip([d13, d14]), pois, pool).days.map((d) => choiceView(d.plan)), [[['甲', '乙', 'pool']], [['丙', '乙', 'pool']]], '對照組');
  const away = mkTrip([d13, d14], { deferred: [{ poiId: '乙', chosenPoiId: '甲', fromDate: '2026-08-13', toDate: null, status: 'unplaced', at: 'T0' }] });
  assert.deepEqual(run(away, pois, pool).days.map((d) => choiceView(d.plan)), [[], [['丙', '乙', 'pool']]]);
  const swapped = mkTrip([{ ...d13, swapped: [{ from: '乙', to: '甲', at: 'T0' }] }, d14]);
  assert.deepEqual(run(swapped, pois, pool).days.map((d) => choiceView(d.plan)), [[], [['丙', '乙', 'pool']]]);
});

test('二選一沒選、別天也排不進的那家（trip.deferred unplaced）：被頂掉的那天引擎不再把它當填站插回來，別天照舊可以（原話 #138）；這天換掉過的（day.swapped）也不插回來', () => {
  const late = poi('晚開', { hours: Object.fromEntries(DAYS.map((d) => [d, [['12:00', '23:00']]])), dwellMin: 50 });
  const early = poi('早的', { hours: Object.fromEntries(DAYS.map((d) => [d, [['09:00', '10:00']]])), dwellMin: 50 });
  const gapDay = (date) => day(date, { picks: [{ poiId: '早的', priority: 'must' }, { poiId: '晚開', priority: 'must' }] });
  const pois = { 早的: early, 晚開: late };
  const plain = run(mkTrip([gapDay('2026-08-13')]), pois, [cafe('乙')]).days[0].plan;
  assert.ok(plain.sequence.some((s) => s.poi.id === '乙' && s.insertedBy === 'engine'), `對照組：乙被當填站插進去：${ids(plain.sequence).join('→')}`);
  const away = mkTrip([gapDay('2026-08-13'), gapDay('2026-08-14')], { deferred: [{ poiId: '乙', chosenPoiId: '甲', fromDate: '2026-08-13', toDate: null, status: 'unplaced', at: 'T0' }] });
  const r = run(away, pois, [cafe('乙')]);
  assert.ok(!r.days[0].plan.sequence.some((s) => s.poi.id === '乙'), `8/13 不插乙：${ids(r.days[0].plan.sequence).join('→')}`);
  assert.ok(r.days[1].plan.sequence.some((s) => s.poi.id === '乙' && s.insertedBy === 'engine'), `8/14 照插：${ids(r.days[1].plan.sequence).join('→')}`);
  const placed = mkTrip([gapDay('2026-08-13')], { deferred: [{ poiId: '乙', chosenPoiId: '甲', fromDate: '2026-08-13', toDate: '2026-08-15', status: 'placed', at: 'T0' }] });
  assert.ok(run(placed, pois, [cafe('乙')]).days[0].plan.sequence.some((s) => s.poi.id === '乙'), 'placed 的不走這條（它在 toDate 的 picks 裡，由 pickedOrRemoved 擋）');
  // 這天換掉過的（二選一選了 B 頂掉它、或「換一家」換掉它）：引擎同樣不把它當填站插回同一天
  const swapped = mkTrip([{ ...gapDay('2026-08-13'), swapped: [{ from: '乙', to: '丁', at: 'T0' }] }, gapDay('2026-08-14')]);
  const r2 = run(swapped, pois, [cafe('乙')]);
  assert.ok(!r2.days[0].plan.sequence.some((s) => s.poi.id === '乙'), `8/13 換掉過乙：不插：${ids(r2.days[0].plan.sequence).join('→')}`);
  assert.ok(r2.days[1].plan.sequence.some((s) => s.poi.id === '乙' && s.insertedBy === 'engine'), `8/14 照插：${ids(r2.days[1].plan.sequence).join('→')}`);
});
