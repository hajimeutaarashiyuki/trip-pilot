// 引擎自己插站要認「同一處」（知識庫欄位 samePlace：同一個地點寫成兩筆；主控 11-11 定「同一處當同一家」，11-24 補到引擎插站的池與走廊清單）。
// 之前只有早餐、分配器、換一家認：七天包與公務包 8/15，引擎把「瑞鳳殿（伊達政宗靈屋）」插在他勾的主行程「瑞鳳殿 盂蘭盆特別御開帳」前面，同一個地方連排兩站（10-27 起就這樣）。
// 這裡驗四個池（恢復站、填站、順路站、坐下來的地方）與走廊清單；哪一邊寫 samePlace 都認、陣列也收（engine/swap.js samePlace 同一個判法）；沒有這個欄位的知識庫結果不變。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planTrip, corridorFor } from '../../src/engine/trip.js';
import { loadRules } from '../../src/rules/index.js';
import { BUILTIN } from '../../src/rules/builtin.js';
import rulesJson from '../../src/rules.json' with { type: 'json' };

const rules = loadRules(BUILTIN, rulesJson.rules);
const settings = rulesJson.settings;
const country = { mealSlots: { lunch: ['11:30', '13:30'], dinner: ['18:00', '20:30'] }, nightSlot: ['20:00', '24:00'], climate: { summerMonths: [6, 7, 8, 9] }, utcOffsetMin: 540 };
const kb = { zones: { town: { environment: 'town', lat: 38.26, lng: 140.87 } } };
const ALL = { thu: [['09:00', '23:00']], fri: [['09:00', '23:00']] };   // 2026-08-13 是週四、08-14 週五
const poi = (id, over = {}) => ({ id, name_zh: id, category: 'street', walkFactor: 1, recovery: false, cafeLike: false, climbMin: 0, zoneId: 'town', hours: ALL, dwellMin: 70, daylightOnly: false, lat: 38.26, lng: 140.87, ...over });
const cafe = (id, over = {}) => poi(id, { category: 'cafe', walkFactor: 0, recovery: true, cafeLike: true, dwellMin: 40, ...over });
const home = { id: 'home', name_zh: '飯店', zoneId: 'town', lat: 38.26, lng: 140.87 };
const legFn = () => ({ walkMin: 5, rideMin: 0, climbMin: 0 });
const ids = (plan) => plan.sequence.map((s) => s.poi.id);
const engineIds = (plan) => plan.sequence.filter((s) => s.insertedBy).map((s) => s.poi.id);
const must = (list) => list.map((p) => ({ poiId: p.id, priority: 'must' }));
const dayOf = (date, list, over = {}) => ({ date, type: 'normal', designated: list.map((p) => p.id), picks: must(list), ...over });
const tripOf = (...days) => ({ id: 't', party: 1, homeBases: [{ poi: home }], days });
const run = (trip, pois, restPool, over = {}) => planTrip({ trip, pois: Object.fromEntries(pois.map((p) => [p.id, p])), rules, settings, country, kb, legFn, restPool, ...over }).days;

// 三站各 70 分、只靠走路串起來會破 150：引擎會插一家恢復站（test/engine/rest-pool.test.js 的情境）
const walkers = [poi('街區A'), poi('街區B'), poi('街區C')];

test('placeTwins：一批 POI 的同一處對照表——哪一邊寫都算、陣列也收、指到自己或寫壞的不算；整批沒有這個欄位就是空的', async () => {
  const { placeTwins } = await import('../../src/engine/swap.js');
  const t = placeTwins([{ id: 'a', samePlace: 'b' }, { id: 'b' }, { id: 'c', samePlace: ['d', 'e', '', 5] }, { id: 'f', samePlace: 'f' }, { id: 'g', samePlace: 7 }, null, { samePlace: 'a' }]);
  assert.deepEqual([...t.keys()].sort(), ['a', 'b', 'c', 'd', 'e']);
  assert.deepEqual([t.get('a'), t.get('b'), t.get('c'), t.get('d'), t.get('e')], [['b'], ['a'], ['d', 'e'], ['c'], ['c']]);
  assert.equal(placeTwins([{ id: 'a' }, { id: 'b' }]).size, 0);
  assert.equal(placeTwins().size, 0);
});

test('恢復站：跟他勾的站同一處的不插、換下一家（哪一邊寫 samePlace 都認、陣列也收、勾在別天也算）；沒有這個欄位照舊插最近的那一家', () => {
  const second = cafe('第二家咖啡廳', { lng: 140.879 });
  const base = run(tripOf(dayOf('2026-08-13', walkers)), walkers, [cafe('咖啡廳'), second])[0].plan;
  assert.deepEqual(engineIds(base), ['咖啡廳'], `對照（沒有 samePlace）：插最近的咖啡廳：${ids(base).join('→')}`);
  // 池裡那一筆指到他勾的站
  const a = run(tripOf(dayOf('2026-08-13', walkers)), walkers, [cafe('咖啡廳', { samePlace: '街區A' }), second])[0].plan;
  assert.deepEqual(engineIds(a), ['第二家咖啡廳'], `同一處的不插：${ids(a).join('→')}`);
  // 他勾的那一筆指到池裡的（只有一邊寫也算）
  const pickedSide = [poi('街區A', { samePlace: '咖啡廳' }), walkers[1], walkers[2]];
  assert.deepEqual(engineIds(run(tripOf(dayOf('2026-08-13', pickedSide)), pickedSide, [cafe('咖啡廳'), second])[0].plan), ['第二家咖啡廳']);
  // 陣列寫法
  assert.deepEqual(engineIds(run(tripOf(dayOf('2026-08-13', walkers)), walkers, [cafe('咖啡廳', { samePlace: ['不存在的', '街區C'] }), second])[0].plan), ['第二家咖啡廳']);
  // 勾在別天的站也算（整趟任何一天他勾的站）
  const other = poi('別天的站', { dwellMin: 30 });
  const two = run(tripOf(dayOf('2026-08-13', walkers), dayOf('2026-08-14', [other])), [...walkers, other], [cafe('咖啡廳', { samePlace: '別天的站' }), second]);
  assert.deepEqual(engineIds(two[0].plan), ['第二家咖啡廳'], `8/14 勾的站的另一筆，8/13 也不插：${ids(two[0].plan).join('→')}`);
  // 只有那一家可以插時就不插（不會為了有恢復站把同一個地方排兩次）
  assert.deepEqual(engineIds(run(tripOf(dayOf('2026-08-13', walkers)), walkers, [cafe('咖啡廳', { samePlace: '街區A' })])[0].plan), []);
});

test('別天引擎已經排的站，同一處的另一筆也當成用掉了：第二天不插它、換再下一家', () => {
  const others = [poi('街區D'), poi('街區E'), poi('街區F')];
  const trip = tripOf(dayOf('2026-08-13', walkers), dayOf('2026-08-14', others));
  const pool = (over = {}) => [cafe('咖啡廳'), cafe('咖啡廳別館', { lng: 140.8701, ...over }), cafe('第三家咖啡廳', { lng: 140.8702 })];
  const base = run(trip, [...walkers, ...others], pool());
  assert.deepEqual([engineIds(base[0].plan), engineIds(base[1].plan)], [['咖啡廳'], ['咖啡廳別館']], '對照（沒有 samePlace）：第二天換下一家');
  const r = run(trip, [...walkers, ...others], pool({ samePlace: '咖啡廳' }));
  assert.deepEqual([engineIds(r[0].plan), engineIds(r[1].plan)], [['咖啡廳'], ['第三家咖啡廳']], `第一天插了咖啡廳，別館是同一處：${ids(r[1].plan).join('→')}`);
});

test('填站：等開門的空檔不填跟他勾的站同一處的店、換下一家', () => {
  const first = poi('早的', { hours: { thu: [['09:00', '11:00']] } });
  const late = poi('晚開', { hours: { thu: [['12:00', '23:00']] } });
  const trip = tripOf(dayOf('2026-08-13', [first, late]));
  const second = cafe('第二家咖啡廳', { lng: 140.879 });
  const fillers = (plan) => plan.sequence.filter((s) => s.insertedBy).map((s) => [s.poi.id, s.priority]);
  const base = run(trip, [first, late], [cafe('咖啡廳'), second])[0].plan;
  assert.deepEqual(fillers(base), [['咖啡廳', 'filler'], ['第二家咖啡廳', 'filler']], `對照（沒有 samePlace）：空檔夠長，兩家都填（一天最多兩家引擎站）：${ids(base).join('→')}`);
  const r = run(trip, [first, late], [cafe('咖啡廳', { samePlace: '晚開' }), second])[0].plan;
  assert.deepEqual(fillers(r), [['第二家咖啡廳', 'filler']], `同一處的不填：${ids(r).join('→')}`);
  // 池裡兩筆彼此同一處：同一天只填一筆（排在前面的那一筆），不會把同一個地方排成兩站
  const twins = run(trip, [first, late], [cafe('咖啡廳'), cafe('咖啡廳別館', { lng: 140.879, samePlace: '咖啡廳' })])[0].plan;
  assert.deepEqual(fillers(twins), [['咖啡廳', 'filler']], `同一處的兩筆只填一筆：${ids(twins).join('→')}`);
});

test('坐下來的地方：跟他勾的站同一處的不排（瑞鳳殿那種：主行程是活動、同一個地點另有一筆常設的）；別的坐下來的地方照排', () => {
  const shrine = poi('神社', { hours: { thu: [['09:00', '12:00']] } });
  const fw = poi('花火', { category: 'event', walkFactor: 0, hours: null, dwellMin: 60 });
  const spot = (id, over = {}) => poi(id, { category: 'spot', walkFactor: 0, recovery: true, hours: null, dwellMin: 30, ...over });
  const trip = tripOf({ date: '2026-08-13', type: 'normal', designated: ['神社', '花火'], picks: [{ poiId: '神社', priority: 'must' }, { poiId: '花火', priority: 'must', fixedWindow: { startMin: 13 * 60, arriveEarlyMin: 30 } }] });
  assert.deepEqual(ids(run(trip, [shrine, fw], [spot('會場旁的海邊')])[0].plan), ['神社', '會場旁的海邊', '花火'], '對照（沒有 samePlace）');
  const r = run(trip, [shrine, fw], [spot('會場旁的海邊', { samePlace: '花火' }), spot('公園')])[0].plan;
  assert.deepEqual(ids(r), ['神社', '公園', '花火'], `花火會場的另一筆不排，換公園：${ids(r).join('→')}`);
  assert.deepEqual(ids(run(trip, [shrine, fw], [spot('會場旁的海邊', { samePlace: '花火' })])[0].plan), ['神社', '花火'], '只有那一筆就不排');
});

test('順路站：跟他勾的站同一處的不插；兩筆同一處的順路店只插一筆（排在前面的那一筆）', () => {
  // A→B 直走 10 分，經順路店是 3＋3（繞路 −4 ≤ 8）；test/engine/rest-pool.test.js 的情境
  const A = poi('A', { dwellMin: 60 }); const B = poi('B', { dwellMin: 60 });
  const stop = (id, over = {}) => poi(id, { category: 'record', walkFactor: 0, dwellMin: 30, ...over });
  const near = ['順路店', '順路店別館', '另一家順路店'];
  const walkFn = (a, b) => {
    const k = [a.id, b.id];
    const n = k.filter((id) => near.includes(id)).length;
    if (n === 2) return { walkMin: 2, rideMin: 0, climbMin: 0 };
    if (n === 1 && k.includes('home')) return { walkMin: 12, rideMin: 0, climbMin: 0 };
    if (n === 1) return { walkMin: 3, rideMin: 0, climbMin: 0 };
    return { walkMin: 10, rideMin: 0, climbMin: 0 };
  };
  const plan = (pool, pois = [A, B]) => run(tripOf(dayOf('2026-08-13', pois)), pois, pool, { legFn: walkFn })[0].plan;
  assert.deepEqual(engineIds(plan([stop('順路店')])), ['順路店'], '對照：順路的店排進去');
  assert.deepEqual(engineIds(plan([stop('順路店', { samePlace: 'A' }), stop('另一家順路店')])), ['另一家順路店'], '他勾的 A 的另一筆不插');
  assert.deepEqual(engineIds(plan([stop('順路店'), stop('另一家順路店')], [A, poi('B', { dwellMin: 60, samePlace: ['順路店'] })])), ['另一家順路店'], '他勾的那一筆指過來也算');
  // 兩筆同一處：沒有這個欄位時兩筆都插（一天最多兩家引擎站），有就只插前面那一筆
  const both = engineIds(plan([stop('順路店'), stop('順路店別館')]));
  assert.deepEqual([...both].sort(), ['順路店', '順路店別館'].sort(), `對照（沒有 samePlace）兩筆都插：${both.join('、')}`);
  assert.deepEqual(engineIds(plan([stop('順路店'), stop('順路店別館', { samePlace: '順路店' })])), ['順路店'], '同一處的兩筆只插前面那一筆');
  assert.deepEqual(engineIds(plan([stop('順路店', { samePlace: '順路店別館' }), stop('順路店別館')])), ['順路店'], '寫在前面那一筆上也一樣');
});

test('二選一的「或 B」也認同一處（11-24 傍晚主控裁決乙6）：別天他勾的站、別天引擎已經排的站、按過「不去了」的站，同一處的另一筆都不拿來當 B（換下一家）；哪一邊寫 samePlace 都認；沒有這個欄位照舊', () => {
  // 代購研究的咖啡廳（帶 item）：引擎不會自己插（engineMayInsert），二選一照樣可以出（④品項層）——這樣每天的序列只有他勾的站，看得清楚 B 是誰
  const bean = (id, over = {}) => cafe(id, { item: '咖啡豆', ...over });
  const want = (list) => list.map((p) => ({ poiId: p.id, priority: 'want' }));
  const plain = (date, list, over = {}) => ({ date, type: 'normal', picks: want(list), ...over });
  const mine = bean('甲咖啡'); const theirs = bean('乙咖啡');
  const choices = (days, i = 0) => days[i].plan.choices.map((c) => c.options);
  const trip = tripOf(plain('2026-08-13', [mine]), plain('2026-08-14', [theirs]));
  const base = run(trip, [mine, theirs], [bean('乙咖啡別館'), bean('丙咖啡')]);
  assert.deepEqual(choices(base), [['甲咖啡', '乙咖啡別館']], '對照（沒有 samePlace）：候選池裡排前面的那一家');
  // 別館是 8/14 他勾的乙咖啡的另一筆：8/13 的「或 B」不拿它，換丙咖啡
  assert.deepEqual(choices(run(trip, [mine, theirs], [bean('乙咖啡別館', { samePlace: '乙咖啡' }), bean('丙咖啡')])), [['甲咖啡', '丙咖啡']]);
  // 寫在他勾的那一筆上也算
  const theirs2 = bean('乙咖啡', { samePlace: ['乙咖啡別館'] });
  assert.deepEqual(choices(run(trip, [mine, theirs2], [bean('乙咖啡別館'), bean('丙咖啡')])), [['甲咖啡', '丙咖啡']]);
  // 只有那一家可以配時就不出「或 B」
  assert.deepEqual(choices(run(trip, [mine, theirs], [bean('乙咖啡別館', { samePlace: '乙咖啡' })])), []);
  // 別天按過「不去了」的站的另一筆
  const removedTrip = tripOf(plain('2026-08-13', [mine]), plain('2026-08-14', [], { removed: [{ poiId: '乙咖啡', at: 'x' }] }));
  assert.deepEqual(choices(run(removedTrip, [mine, theirs], [bean('乙咖啡別館', { samePlace: '乙咖啡' }), bean('丙咖啡')])), [['甲咖啡', '丙咖啡']]);
  // 別天引擎已經排的站的另一筆：8/14 三個街區連著走，引擎插了「咖啡廳」；它的別館（代購研究站）在 8/13 不當 B
  const trip2 = tripOf(plain('2026-08-13', [mine]), dayOf('2026-08-14', walkers));
  const pool2 = (over = {}) => [cafe('咖啡廳'), bean('咖啡廳別館', over), bean('丙咖啡')];
  const base2 = run(trip2, [mine, ...walkers], pool2());
  assert.deepEqual([engineIds(base2[1].plan), choices(base2)], [['咖啡廳'], [['甲咖啡', '咖啡廳別館']]], '對照（沒有 samePlace）');
  const r2 = run(trip2, [mine, ...walkers], pool2({ samePlace: '咖啡廳' }));
  assert.deepEqual([engineIds(r2[1].plan), choices(r2)], [['咖啡廳'], [['甲咖啡', '丙咖啡']]]);
});

test('二選一來源是「今天排不進的同類勾選站」時：跟今天行程裡的站同一處的那一筆不列（選了等於同一個地方排兩次、或拿一家店換它自己）；別的排不進的照列', async () => {
  const { proposeChoices } = await import('../../src/engine/choices.js');
  const stop = (p, i) => ({ poi: p, priority: 'want', startMin: 600 + i * 60, endMin: 640 + i * 60, dwellMin: 40, insertedBy: null, designated: false, isAnchor: false, fixedWindow: null });
  const propose = (seq, dropped) => proposeChoices({ plan: { sequence: seq.map(stop), dropped: dropped.map((p) => ({ poi: p, priority: 'want', reason: '' })) }, date: '2026-08-13', pool: [], legFn, settings }).map((c) => c.options);
  const a = cafe('甲咖啡'); const b = cafe('乙咖啡'); const c = cafe('丙咖啡');
  assert.deepEqual(propose([a, b], [c]), [['甲咖啡', '丙咖啡']], '對照（沒有 samePlace）：排不進的那一家配給其中一站');
  // 排不進的那一筆是乙咖啡的另一筆：不出「甲咖啡 或 乙咖啡別館」（那天已經有乙咖啡），也不出「乙咖啡 或 乙咖啡別館」
  assert.deepEqual(propose([a, b], [cafe('乙咖啡別館', { samePlace: '乙咖啡' })]), []);
  assert.deepEqual(propose([a, cafe('乙咖啡', { samePlace: '乙咖啡別館' })], [cafe('乙咖啡別館')]), [], '寫在行程裡那一筆上也算');
  // 兩筆排不進：同一處的那一筆跳過，另一筆照配
  assert.deepEqual(propose([a, b], [cafe('乙咖啡別館', { samePlace: '乙咖啡' }), c]), [['甲咖啡', '丙咖啡']]);
});

test('走廊清單：兩筆同一處、兩筆都不是站，只列知識庫裡排前面的那一筆（空出來的位子給別家）；其中一筆是站時另一筆本來就不列', () => {
  const A = poi('A', { lat: 38.26, lng: 140.88, dwellMin: 60 }); const B = poi('B', { lat: 38.26, lng: 140.89, dwellMin: 60 });
  const WALK = { 'home|A': 11, 'A|B': 5, 'home|B': 20 };
  const walkFn = (a, b) => ({ walkMin: WALK[`${a.id}|${b.id}`] ?? WALK[`${b.id}|${a.id}`] ?? 20, rideMin: 0, climbMin: 0, mode: 'walk' });
  const shop = (id, lat, lng, over = {}) => poi(id, { category: 'record', walkFactor: 0, dwellMin: 30, lat, lng, ...over });
  const day = { date: '2026-08-13', regionZones: ['town'] };
  const plan = { sequence: [{ poi: A }, { poi: B }], warnings: [] };
  const list = (pool, over = {}) => corridorFor({ plan, home, pool, legFn: walkFn, settings, day, ...over }).map((c) => [c.legIndex, c.pois.map((x) => x.poi.id)]);
  // 住宿→A 那一段旁邊：本館離路線 33 m、別館 67 m；A→B 中段另有一家
  const main = shop('本館', 38.2603, 140.875); const annex = shop('別館', 38.2606, 140.872); const mid = shop('AB中', 38.2602, 140.885);
  assert.deepEqual(list([annex, main, mid]), [[0, ['本館', '別館']], [1, ['AB中']]], '對照（沒有 samePlace）：兩筆都列，近的在前');
  assert.deepEqual(list([{ ...annex, samePlace: '本館' }, main, mid]), [[0, ['別館']], [1, ['AB中']]], '只列知識庫裡排前面的那一筆（別館排在前面，就算離路線比較遠）');
  assert.deepEqual(list([main, { ...annex, samePlace: '本館' }, mid]), [[0, ['本館']], [1, ['AB中']]]);
  assert.deepEqual(list([{ ...main, samePlace: ['別館'] }, annex, mid]), [[0, ['本館']], [1, ['AB中']]], '寫在哪一筆上都一樣、陣列也收');
  // 同一處的兩筆落在不同的兩段：也只列一筆
  assert.deepEqual(list([main, { ...mid, samePlace: '本館' }]), [[0, ['本館']]]);
  // 每段取前幾家之前就拿掉：位子給後面的店（每段最多 2 家時，第三近的那一家補上來）
  const third = shop('第三家', 38.2607, 140.874);
  const cap2 = { settings: { ...settings, corridorListMaxPerLeg: 2 } };
  assert.deepEqual(list([main, annex, third], cap2), [[0, ['本館', '別館']]], '對照（沒有 samePlace）：第三家排不上');
  assert.deepEqual(list([main, { ...annex, samePlace: '本館' }, third], cap2), [[0, ['本館', '第三家']]]);
  // 排前面的那一筆經過時沒開：列有開的那一筆（只有它過得了門）
  assert.deepEqual(list([{ ...main, hours: { mon: [['09:00', '18:00']] } }, { ...annex, samePlace: '本館' }]), [[0, ['別館']]]);
  // 其中一筆是站：另一筆不列（11-11 就有的行為，照舊）
  assert.deepEqual(corridorFor({ plan: { sequence: [{ poi: { ...A, samePlace: '本館' } }, { poi: B }], warnings: [] }, home, pool: [main, mid], legFn: walkFn, settings, day }).map((c) => c.pois.map((x) => x.poi.id)), [['AB中']]);
});
