// 引擎插站（DESIGN §1.3「走路連跑要破 150 才由引擎插恢復站，來源＝候選池未勾 ∪ 當日區域 KB，標引擎插的、可拒絕」；原話 #126、#161）：
// 恢復站：走路連跑會破 150 的一天，restPool 有同區咖啡廳就插進去、總罰分變低；
// 填站：等開門超過留白（DESIGN §5.2 wait-at-door）觸發、任何站都可以填（原話 #161），但只能落在那段空檔內（規則 filler-gap）、候選只拿空檔內有開的；
// 插的站帶 insertedBy、價值 0、排不進不算落選、不佔每日站數上限；restPool 空時結果跟原本一樣；
// 拒絕過哪一種（removed 帶 insertedBy 與 priority）那天就不再插那一種、它的觸發警告降成提示（profile §2.4 細則）；
// 恢復站與填站一天合計最多插 settings.restInsertMaxPerDay 家；同一家店不在兩天都被插、任何一天按過「不去了」的不插。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planTrip, restCandidates, fillCandidates, extraCandidates } from '../../src/engine/trip.js';
import { loadRules } from '../../src/rules/index.js';
import { BUILTIN } from '../../src/rules/builtin.js';
import rulesJson from '../../src/rules.json' with { type: 'json' };

const rules = loadRules(BUILTIN, rulesJson.rules);
const settings = rulesJson.settings;
const country = { mealSlots: { lunch: ['11:30', '13:30'], dinner: ['18:00', '20:30'] }, nightSlot: ['20:00', '24:00'], climate: { summerMonths: [6, 7, 8, 9] }, utcOffsetMin: 540 };
const kb = { zones: { town: { environment: 'town', lat: 38.26, lng: 140.87 } } };
const ALL = { thu: [['09:00', '23:00']], fri: [['09:00', '23:00']] };   // 2026-08-13 是週四、08-14 週五
const poi = (id, over = {}) => ({ id, name_zh: id, category: 'street', walkFactor: 1, recovery: false, cafeLike: false, climbMin: 0, zoneId: 'town', hours: ALL, dwellMin: 70, daylightOnly: false, lat: 38.26, lng: 140.87, ...over });
const home = { id: 'home', name_zh: '飯店', zoneId: 'town', lat: 38.26, lng: 140.87 };
const legFn = () => ({ walkMin: 5, rideMin: 0, climbMin: 0 });

const walkers = [poi('街區A'), poi('街區B'), poi('街區C')];
const pois = Object.fromEntries(walkers.map((p) => [p.id, p]));
const trip = { id: 't', party: 1, homeBases: [{ poi: home }], days: [{ date: '2026-08-13', type: 'normal', designated: walkers.map((p) => p.id), picks: walkers.map((p) => ({ poiId: p.id, priority: 'must' })) }] };
const cafe = (id, over = {}) => poi(id, { category: 'cafe', walkFactor: 0, recovery: true, cafeLike: true, dwellMin: 40, ...over });
const ids = (plan) => plan.sequence.map((s) => s.poi.id);

// 等開門的情境：早的 11:00 關（只能排第一）、晚開 12:00 才開，中間要等 100 多分；兩站走路連跑沒破 150，觸發的只有等開門
const first = poi('早的', { hours: { thu: [['09:00', '11:00']] } });
const late = poi('晚開', { hours: { thu: [['12:00', '23:00']] } });
const p2 = { [first.id]: first, [late.id]: late };
const t2 = { id: 't2', party: 1, homeBases: [{ poi: home }], days: [{ date: '2026-08-13', type: 'normal', designated: [first.id, late.id], picks: [{ poiId: first.id, priority: 'must' }, { poiId: late.id, priority: 'must' }] }] };

test('三站各 70 分、係數 1.0、只靠走路串起來會破 150：restPool 有同區咖啡廳就插進去，總罰分比沒 restPool 低', () => {
  const bare = planTrip({ trip, pois, rules, settings, country, kb, legFn }).days[0].plan;
  const withRest = planTrip({ trip, pois, rules, settings, country, kb, legFn, restPool: [cafe('咖啡廳'), cafe('第二家咖啡廳', { lng: 140.879 }), cafe('別區咖啡廳', { zoneId: 'elsewhere' })] }).days[0].plan;
  assert.ok(bare.warnings.some((w) => w.ruleId === 'walk-run'), `沒恢復站時走路連跑要破 150：${ids(bare).join('→')}`);
  const inserted = withRest.sequence.find((s) => s.poi.id === '咖啡廳');
  assert.ok(inserted, `咖啡廳要被插進去：${ids(withRest).join('→')}`);
  assert.equal(inserted.insertedBy, 'engine');
  assert.equal(inserted.priority, 'rest');
  assert.equal(inserted.gap, null, '恢復站不綁空檔');
  // 規劃頁「不去了」的條件是 !designated && !isAnchor：引擎插的站兩個旗標都要是 false，按鈕才會出現（拒絕的入口）
  assert.equal(inserted.designated, false);
  assert.equal(inserted.isAnchor, false);
  assert.ok(withRest.penaltyMin < bare.penaltyMin, `罰分 ${withRest.penaltyMin} 要低於 ${bare.penaltyMin}`);
  assert.ok(!withRest.warnings.some((w) => w.ruleId === 'walk-run'), '插了恢復站後走路連跑不再破表');
  for (const p of walkers) assert.ok(ids(withRest).includes(p.id), `${p.id} 還是要在`);
  assert.equal(withRest.sequence.filter((s) => s.insertedBy).length, 1, '一家就夠，第二家不插');
  assert.deepEqual(withRest.dropped, [], '沒插進去的恢復站不算落選');
  assert.ok(withRest.complete);
});

test('restPool 空（或沒給）時結果跟原本一樣；被拒絕過（day.removed）的恢復站不再插', () => {
  const a = planTrip({ trip, pois, rules, settings, country, kb, legFn }).days[0].plan;
  const b = planTrip({ trip, pois, rules, settings, country, kb, legFn, restPool: [] }).days[0].plan;
  assert.deepEqual(ids(b), ids(a));
  assert.equal(b.penaltyMin, a.penaltyMin);
  assert.equal(b.score, a.score);
  const rejected = { ...trip, days: [{ ...trip.days[0], removed: [{ poiId: '咖啡廳', at: '2026-08-13T00:00:00Z' }] }] };
  const c = planTrip({ trip: rejected, pois, rules, settings, country, kb, legFn, restPool: [cafe('咖啡廳')] }).days[0].plan;
  assert.ok(!ids(c).includes('咖啡廳'));
  assert.deepEqual(ids(c), ids(a));
});

test('restCandidates：只收 recovery、當日區域內、不在 exclude（任何一天勾的、按過不去了的、前幾天插過的）的站；依離 picks 重心的距離取前 restPoolMax 家、沒座標的排最後', () => {
  const pool = [
    cafe('c8', { lng: 140.878 }), cafe('c1', { lng: 140.871 }), cafe('c3', { lng: 140.873 }), cafe('沒座標', { lat: null, lng: null }),
    cafe('c5', { lng: 140.875 }), cafe('c2', { lng: 140.872 }), cafe('c7', { lng: 140.877 }), cafe('c4', { lng: 140.874 }), cafe('c6', { lng: 140.876 }),
    cafe('已勾', { lng: 140.8701 }), cafe('拒絕過', { lng: 140.8702 }), cafe('別區', { lng: 140.8703, zoneId: 'elsewhere' }), poi('古著店', { category: 'vintage', walkFactor: 0, lng: 140.8704 }),
  ];
  const out = restCandidates({ restPool: pool, candidates: [{ poi: poi('A') }], day: { regionZones: ['town'] }, exclude: new Set(['已勾', '拒絕過']), home, settings });
  assert.deepEqual(out.map((c) => c.poi.id), ['c1', 'c2', 'c3', 'c4', 'c5', 'c6']);
  assert.ok(out.every((c) => c.priority === 'rest' && c.optional === true && c.insertedBy === 'engine' && c.dwellMin === 40));
  const few = restCandidates({ restPool: [cafe('沒座標', { lat: null, lng: null, dwellMin: undefined }), cafe('c1', { lng: 140.871 })], candidates: [{ poi: poi('A') }], day: { regionZones: ['town'] }, home, settings: { ...settings, restPoolMax: 2 } });
  assert.deepEqual(few.map((c) => c.poi.id), ['c1', '沒座標']);
  assert.equal(few[1].dwellMin, 30, '沒寫停留的恢復站用 restResetMin（至少 30）');
  assert.deepEqual(restCandidates({ restPool: [], candidates: [], day: { regionZones: ['town'] }, settings }), []);
});

test('拒絕過引擎插的恢復站（removed 帶 insertedBy engine）那天不再插別家恢復站、不罰；走路連跑的警告降成提示（hint）；他自己拿掉的站不算拒絕恢復站', () => {
  const pool = [cafe('咖啡廳'), cafe('第二家咖啡廳', { lng: 140.879 })];
  const bare = planTrip({ trip, pois, rules, settings, country, kb, legFn }).days[0].plan;
  // 舊資料的 removed 沒記 priority：當恢復站
  const rejected = { ...trip, days: [{ ...trip.days[0], removed: [{ poiId: '咖啡廳', at: '2026-08-13T00:00:00Z', insertedBy: 'engine' }] }] };
  const plan = planTrip({ trip: rejected, pois, rules, settings, country, kb, legFn, restPool: pool }).days[0].plan;
  assert.ok(!plan.sequence.some((s) => s.insertedBy), `拒絕一家後不插第二家：${ids(plan).join('→')}`);
  assert.deepEqual(ids(plan), ids(bare));
  assert.equal(plan.penaltyMin, bare.penaltyMin, '拒絕不罰');
  const runWarns = plan.warnings.filter((w) => w.ruleId === 'walk-run');
  assert.ok(runWarns.length > 0 && runWarns.every((w) => w.hint === true), '連跑警告變提示');
  assert.ok(plan.warnings.filter((w) => w.ruleId !== 'walk-run').every((w) => !w.hint), '其他警告不動');
  assert.ok(bare.warnings.every((w) => !w.hint), '沒拒絕過就沒有 hint');
  // 他勾的站按「不去了」（removed 沒 insertedBy）不算拒絕恢復站：還是會插
  const userRemoved = { ...trip, days: [{ ...trip.days[0], removed: [{ poiId: '街區D', at: '2026-08-13T00:00:00Z' }] }] };
  const plan2 = planTrip({ trip: userRemoved, pois, rules, settings, country, kb, legFn, restPool: pool }).days[0].plan;
  assert.ok(plan2.sequence.some((s) => s.insertedBy === 'engine'));
  assert.ok(plan2.warnings.every((w) => !w.hint));
});

test('等開門超過留白（wait-at-door）也觸發第二趟：空檔放一家店（填站，綁在空檔內）、等待變短；拒絕過填站就不放、警告變提示；restInsertMaxPerDay 0 一家都不插', () => {
  const bare = planTrip({ trip: t2, pois: p2, rules, settings, country, kb, legFn }).days[0].plan;
  assert.deepEqual(ids(bare), ['早的', '晚開']);
  assert.ok(!bare.warnings.some((w) => w.ruleId === 'walk-run'), '走路連跑沒破');
  assert.ok(bare.warnings.some((w) => w.ruleId === 'wait-at-door' && !w.hint), '等開門的警告在');
  const bareLate = bare.sequence.find((s) => s.poi.id === '晚開');
  assert.ok(bareLate.waitMin > 15, `要在門口等：${bareLate.waitMin}`);
  const filled = planTrip({ trip: t2, pois: p2, rules, settings, country, kb, legFn, restPool: [cafe('咖啡廳')] }).days[0].plan;
  const inserted = filled.sequence.find((s) => s.insertedBy === 'engine');
  assert.ok(inserted, `空檔要放一家：${ids(filled).join('→')}`);
  assert.equal(inserted.poi.id, '咖啡廳');
  assert.equal(inserted.priority, 'filler', '只有等開門觸發：咖啡廳是填站，不是恢復站');
  assert.deepEqual(inserted.gap, { startMin: 10 * 60 + 15, endMin: 12 * 60 }, '空檔＝早的結束 10:15（9:05 到、待 70）到晚開開門 12:00');
  assert.ok(inserted.startMin >= inserted.gap.startMin && inserted.endMin <= inserted.gap.endMin, `填站要落在空檔內：${inserted.startMin}–${inserted.endMin}`);
  assert.ok(filled.sequence.find((s) => s.poi.id === '晚開').waitMin < bareLate.waitMin, '等待變短');
  assert.ok(filled.penaltyMin < bare.penaltyMin, `罰分 ${filled.penaltyMin} 要低於 ${bare.penaltyMin}`);
  const rejected = { ...t2, days: [{ ...t2.days[0], removed: [{ poiId: '咖啡廳', at: '2026-08-13T00:00:00Z', insertedBy: 'engine', priority: 'filler' }] }] };
  const kept = planTrip({ trip: rejected, pois: p2, rules, settings, country, kb, legFn, restPool: [cafe('咖啡廳'), cafe('第二家咖啡廳', { lng: 140.879 })] }).days[0].plan;
  assert.ok(!kept.sequence.some((s) => s.insertedBy), '拒絕過填站就不放別家');
  const waitWarns = kept.warnings.filter((w) => w.ruleId === 'wait-at-door');
  assert.ok(waitWarns.length > 0 && waitWarns.every((w) => w.hint === true), '等開門的警告變提示');
  const none = planTrip({ trip: t2, pois: p2, rules, settings: { ...settings, restInsertMaxPerDay: 0 }, country, kb, legFn, restPool: [cafe('咖啡廳')] }).days[0].plan;
  assert.ok(!none.sequence.some((s) => s.insertedBy), 'restInsertMaxPerDay 0 一家都不插');
  assert.deepEqual(ids(none), ids(bare));
});

test('引擎插的恢復站不拿錢湯：要準備的站只有他自己勾才會出現', () => {
  const day = { regionZones: ['town'] };
  const pool = [
    { id: 'sento', name_zh: '錢湯', category: 'onsen', recovery: true, zoneId: 'town', lat: 38.26, lng: 140.88 },
    { id: 'cafe', name_zh: '咖啡廳', category: 'cafe', recovery: true, zoneId: 'town', lat: 38.26, lng: 140.88 },
  ];
  const out = restCandidates({ restPool: pool, candidates: [], day, settings: {} }).map((c) => c.poi.id);
  assert.deepEqual(out, ['cafe']);
});

test('等開門空檔任何站都可以填（原話 #161）：非恢復站的店離空檔最近就排進去、落在空檔內、先去的站仍第一位；活動類不拿', () => {
  const A = poi('先去的站', { dwellMin: 60, hours: { thu: [['09:00', '11:00']] } });   // 只開到 11 點：不能把它挪到晚開的站後面
  const B = poi('晚開的站', { dwellMin: 60, hours: { thu: [['12:00', '23:00']] } });
  const shop = poi('唱片行', { category: 'record', walkFactor: 0, dwellMin: 110, lng: 140.8705 });
  const event = poi('活動', { category: 'event', walkFactor: 0, dwellMin: 110, lng: 140.8702 });
  const pois2 = { [A.id]: A, [B.id]: B };
  const trip2 = { id: 't2', party: 1, homeBases: [{ poi: home }], days: [{ date: '2026-08-13', type: 'normal', designated: [A.id, B.id], picks: [{ poiId: A.id, priority: 'must' }, { poiId: B.id, priority: 'must' }] }] };
  const bare = planTrip({ trip: trip2, pois: pois2, rules, settings, country, kb, legFn }).days[0].plan;
  assert.ok(bare.warnings.some((w) => w.ruleId === 'wait-at-door'), `先去的站結束後要等晚開的站：${ids(bare).join('→')}`);
  const filled = planTrip({ trip: trip2, pois: pois2, rules, settings, country, kb, legFn, restPool: [shop, event] }).days[0].plan;
  const inserted = filled.sequence.find((s) => s.poi.id === '唱片行');
  assert.ok(inserted, `唱片行要填進空檔：${ids(filled).join('→')}`);
  assert.equal(inserted.priority, 'filler');
  assert.equal(inserted.insertedBy, 'engine');
  assert.deepEqual(inserted.gap, { startMin: 10 * 60 + 5, endMin: 12 * 60 }, '空檔＝先去的站結束 10:05（9:05 到、待 60）到晚開的站開門 12:00');
  assert.ok(inserted.startMin >= inserted.gap.startMin && inserted.endMin <= inserted.gap.endMin, `填站要在空檔 10:05–12:00 內：${inserted.startMin}–${inserted.endMin}`);
  assert.equal(ids(filled)[0], '先去的站', '先去的站仍第一位');
  assert.ok(!ids(filled).includes('活動'), '活動類不拿來填');
  assert.ok(filled.penaltyMin < bare.penaltyMin, `罰分 ${filled.penaltyMin} 要低於 ${bare.penaltyMin}`);
  assert.ok(!filled.warnings.some((w) => w.ruleId === 'wait-at-door' && !w.hint), '填了之後不再等開門');
});

test('fillCandidates：每個等開門警告算出空檔（前一站結束→那站開門）；只拿區域內、不在 exclude、不是交通／活動／錢湯、空檔內有開的站，依離中點距離取 fillPoolMax 家；dwell 裁到空檔長度；空檔太短不填', () => {
  const day = { date: '2026-08-13', regionZones: ['town'], window: { startMin: 540, endMin: 1440 } };
  const A = poi('A', { lng: 140.87 }); const B = poi('B', { lng: 140.88, hours: { thu: [['12:00', '23:00']] } });
  const seq = [{ poi: A, arriveMin: 540, startMin: 540, endMin: 600, waitMin: 0 }, { poi: B, arriveMin: 605, startMin: 720, endMin: 790, waitMin: 115 }];
  const plan = { sequence: seq, warnings: [{ ruleId: 'wait-at-door', code: 'soft', poiId: 'B', msg: '' }] };
  // 中點在 lng 140.875；排除的那幾家故意放得更近，驗「沒開的、被排除的不佔名額」
  const pool = [
    poi('近1', { lng: 140.8751, dwellMin: 30 }),
    poi('近3', { lng: 140.8753, dwellMin: 200 }),
    poi('近2', { lng: 140.8752, dwellMin: undefined }),
    poi('近4', { lng: 140.8754 }),
    poi('沒時段', { lng: 140.8755, hours: null }),
    poi('週四定休', { lng: 140.87501, hours: { mon: [['09:00', '18:00']] } }),
    poi('傍晚才開', { lng: 140.87502, hours: { thu: [['18:00', '23:00']] } }),
    poi('別區', { lng: 140.87503, zoneId: 'elsewhere' }),
    poi('已勾', { lng: 140.87504 }),
    poi('拒絕過', { lng: 140.87505 }),
    poi('活動', { lng: 140.87506, category: 'event' }),
    poi('交通', { lng: 140.87507, category: 'logistics' }),
    poi('錢湯', { lng: 140.87508, category: 'onsen' }),
    poi('會場', { lng: 140.87509, category: 'venue' }),   // 研討會會場：只有旅程檔那天勾了才有意義，不當填站（10-14 T23 審查）
  ];
  const exclude = new Set(['已勾', '拒絕過']);
  const out = fillCandidates({ restPool: pool, candidates: [], day, exclude, home, plan, settings: { ...settings, fillPoolMax: 3 } });
  assert.deepEqual(out.map((c) => c.poi.id), ['近1', '近2', '近3'], '空檔內有開的、依離中點距離取 fillPoolMax 家；沒開的、被排除的不佔名額');
  for (const c of out) {
    assert.deepEqual(c.gap, { startMin: 600, endMin: 720 }, '空檔＝A 結束 10:00 到 B 開門 12:00');
    assert.ok(c.priority === 'filler' && c.optional === true && c.insertedBy === 'engine');
  }
  assert.equal(out[0].dwellMin, 30);
  assert.equal(out[1].dwellMin, settings.defaultDwellMin, '沒寫停留用預設');
  assert.equal(out[2].dwellMin, 105, '停留 200 分裁到空檔 120 減留給移動的 15');
  const more = fillCandidates({ restPool: pool, candidates: [], day, exclude, home, plan, settings: { ...settings, fillPoolMax: 20 } }).map((c) => c.poi.id);
  assert.deepEqual(more, ['近1', '近2', '近3', '近4', '沒時段'], '沒有結構化時段視為有開；定休、傍晚才開、別區、已勾、拒絕過、活動、交通、錢湯、會場都不拿');
  // 等開門那站沒有結構化時段：空檔結束用它排定的開始時刻
  const B2 = poi('B2', { lng: 140.88, hours: null });
  const plan2 = { sequence: [seq[0], { poi: B2, arriveMin: 605, startMin: 700, endMin: 770, waitMin: 95 }], warnings: [{ ruleId: 'wait-at-door', code: 'soft', poiId: 'B2', msg: '' }] };
  assert.deepEqual(fillCandidates({ restPool: pool, candidates: [], day, exclude, home, plan: plan2, settings })[0].gap, { startMin: 600, endMin: 700 });
  // 空檔不到 fillMinGapMin（15）分不填；沒有等開門警告不填；restPool 空不填
  const plan3 = { sequence: [seq[0], { poi: B, arriveMin: 605, startMin: 720, endMin: 790, waitMin: 115 }], warnings: plan.warnings };
  assert.deepEqual(fillCandidates({ restPool: pool, candidates: [], day, exclude, home, plan: { ...plan3, sequence: [{ ...seq[0], endMin: 710 }, plan3.sequence[1]] }, settings }), []);
  assert.deepEqual(fillCandidates({ restPool: pool, candidates: [], day, exclude, home, plan: { sequence: seq, warnings: [] }, settings }), []);
  assert.deepEqual(fillCandidates({ restPool: [], candidates: [], day, exclude, home, plan, settings }), []);
});

test('拒絕分種類（原話 #126 拒絕的是恢復）：拒絕過填站不影響插恢復站，拒絕過恢復站不影響填站；舊資料沒記 priority 的當恢復站', () => {
  // 走路連跑的那天：拒絕過一家填站（藥妝店），恢復站照插、連跑警告不降提示
  const rejectedFiller = { ...trip, days: [{ ...trip.days[0], removed: [{ poiId: '藥妝店', at: '2026-08-13T00:00:00Z', insertedBy: 'engine', priority: 'filler' }] }] };
  const a = planTrip({ trip: rejectedFiller, pois, rules, settings, country, kb, legFn, restPool: [cafe('咖啡廳')] }).days[0].plan;
  const rest = a.sequence.find((s) => s.insertedBy === 'engine');
  assert.ok(rest && rest.priority === 'rest', `恢復站照插：${ids(a).join('→')}`);
  assert.ok(a.warnings.every((w) => !w.hint), '沒拒絕過恢復站，警告不降提示');
  // 等開門的那天：拒絕過一家恢復站，填站照放、等開門警告不降提示
  const rejectedRest = { ...t2, days: [{ ...t2.days[0], removed: [{ poiId: '別家咖啡廳', at: '2026-08-13T00:00:00Z', insertedBy: 'engine', priority: 'rest' }] }] };
  const b = planTrip({ trip: rejectedRest, pois: p2, rules, settings, country, kb, legFn, restPool: [cafe('咖啡廳')] }).days[0].plan;
  const filler = b.sequence.find((s) => s.insertedBy === 'engine');
  assert.ok(filler && filler.priority === 'filler', `填站照放：${ids(b).join('→')}`);
  assert.ok(b.warnings.every((w) => !w.hint), '沒拒絕過填站，警告不降提示');
  // 舊資料：removed 有 insertedBy 沒 priority ＝ 拒絕過恢復站，填站還是放
  const legacy = { ...t2, days: [{ ...t2.days[0], removed: [{ poiId: '咖啡廳', at: '2026-08-13T00:00:00Z', insertedBy: 'engine' }] }] };
  const c = planTrip({ trip: legacy, pois: p2, rules, settings, country, kb, legFn, restPool: [cafe('咖啡廳'), cafe('第二家咖啡廳', { lng: 140.879 })] }).days[0].plan;
  const filler2 = c.sequence.find((s) => s.insertedBy === 'engine');
  assert.ok(filler2 && filler2.priority === 'filler' && filler2.poi.id === '第二家咖啡廳', `拒絕過的那家不放、別家當填站放：${ids(c).join('→')}`);
  assert.ok(c.warnings.every((w) => !w.hint));
  // 兩種都拒絕過：兩種都不插、兩種警告都降提示
  const lateC = poi('街區C晚開', { hours: { thu: [['14:00', '23:00']] } });
  const both = { ...trip, days: [{ ...trip.days[0], designated: ['街區A', '街區B', lateC.id], picks: [{ poiId: '街區A', priority: 'must' }, { poiId: '街區B', priority: 'must' }, { poiId: lateC.id, priority: 'must' }], removed: [{ poiId: 'x', insertedBy: 'engine', priority: 'rest' }, { poiId: 'y', insertedBy: 'engine', priority: 'filler' }] }] };
  const d = planTrip({ trip: both, pois: { ...pois, [lateC.id]: lateC }, rules, settings, country, kb, legFn, restPool: [cafe('咖啡廳')] }).days[0].plan;
  assert.ok(!d.sequence.some((s) => s.insertedBy), '兩種都拒絕過就都不插');
  const trig = d.warnings.filter((w) => w.ruleId === 'walk-run' || w.ruleId === 'wait-at-door');
  assert.ok(trig.some((w) => w.ruleId === 'walk-run') && trig.some((w) => w.ruleId === 'wait-at-door') && trig.every((w) => w.hint === true), '兩種觸發警告都降提示');
});

test('走路連跑與等開門同時觸發：同一家店兩邊都選到只留恢復站那份（候選不重複），排進去的也只有一份', () => {
  const lateC = poi('街區C晚開', { hours: { thu: [['14:00', '23:00']] } });
  const picks = ['街區A', '街區B', lateC.id];
  const both = { ...trip, days: [{ ...trip.days[0], designated: picks, picks: picks.map((id) => ({ poiId: id, priority: 'must' })) }] };
  const allPois = { ...pois, [lateC.id]: lateC };
  const r = planTrip({ trip: both, pois: allPois, rules, settings, country, kb, legFn });
  const bare = r.days[0].plan;
  assert.ok(bare.warnings.some((w) => w.ruleId === 'walk-run') && bare.warnings.some((w) => w.ruleId === 'wait-at-door'), `兩種都要觸發：${ids(bare).join('→')}`);
  const extra = extraCandidates({ restPool: [cafe('咖啡廳')], candidates: [], day: r.days[0].day, exclude: new Set(), home, plan: bare, settings });
  assert.deepEqual(extra.map((c) => [c.poi.id, c.priority]), [['咖啡廳', 'rest']]);
  const filled = planTrip({ trip: both, pois: allPois, rules, settings, country, kb, legFn, restPool: [cafe('咖啡廳')] }).days[0].plan;
  assert.equal(filled.sequence.filter((s) => s.poi.id === '咖啡廳').length, 1, `咖啡廳只出現一次：${ids(filled).join('→')}`);
  assert.equal(filled.sequence.find((s) => s.poi.id === '咖啡廳').priority, 'rest');
});

test('跨天：前一天插過的店第二天不再插（換下一家）；任何一天按過「不去了」的站不當候選', () => {
  const dayOf = (date) => ({ date, type: 'normal', designated: walkers.map((p) => p.id), picks: walkers.map((p) => ({ poiId: p.id, priority: 'must' })) });
  const two = { ...trip, days: [dayOf('2026-08-13'), dayOf('2026-08-14')] };
  const pool = [cafe('咖啡廳'), cafe('第二家咖啡廳', { lng: 140.8701 })];
  const r = planTrip({ trip: two, pois, rules, settings, country, kb, legFn, restPool: pool });
  const d1 = r.days[0].plan.sequence.find((s) => s.insertedBy); const d2 = r.days[1].plan.sequence.find((s) => s.insertedBy);
  assert.ok(d1 && d2, '兩天都要插');
  assert.equal(d1.poi.id, '咖啡廳');
  assert.equal(d2.poi.id, '第二家咖啡廳', '第一天插過的咖啡廳第二天不再插');
  const removedElsewhere = { ...two, days: [{ ...two.days[0], removed: [{ poiId: '第二家咖啡廳', at: '2026-08-13T00:00:00Z' }] }, two.days[1]] };
  const r2 = planTrip({ trip: removedElsewhere, pois, rules, settings, country, kb, legFn, restPool: pool });
  assert.equal(r2.days[0].plan.sequence.find((s) => s.insertedBy)?.poi.id, '咖啡廳');
  assert.ok(!r2.days[1].plan.sequence.some((s) => s.insertedBy), '第一天「不去了」的第二家咖啡廳第二天也不當候選；咖啡廳已在第一天插過');
});

test('順路站不害人等開門（10-13 七天實驗 8/13）：插在 11:00 才開的第一站前面會讓它在門口等，改插後面；沒營業時間、藥妝店不當順路站', async () => {
  const { onTheWayCandidates, insertOnTheWay } = await import('../../src/engine/trip.js');
  const A = poi('A', { hours: { thu: [['11:00', '23:00']] } });
  const B = poi('B');
  const C = poi('順路店', { category: 'record', walkFactor: 0, dwellMin: 30 });
  const walk = { 'home|A': 10, 'home|B': 20, 'A|B': 10, 'home|順路店': 3, '順路店|A': 3, '順路店|B': 3 };
  const legFn = (a, b) => ({ walkMin: walk[`${a.id}|${b.id}`] ?? walk[`${b.id}|${a.id}`] ?? 10, rideMin: 0, climbMin: 0 });
  const mkTrip = (picks) => ({ id: 't', party: 1, homeBases: [{ poi: home }], days: [{ date: '2026-08-13', type: 'normal', designated: picks, picks: picks.map((id) => ({ poiId: id, priority: 'must' })) }] });
  // 只有 A（11:00 才開、當天第一站）：順路店在 home→A 那段是順路，但插進去 A 就得在門口等 84 分 → 不插
  const one = planTrip({ trip: mkTrip(['A']), pois: { A }, rules, settings, country, kb, legFn, restPool: [] }).days[0];
  const onway = onTheWayCandidates({ restPool: [C], day: one.day, home, plan: one.plan, legFn, settings });
  assert.deepEqual(onway.map((c) => c.poi.id), ['順路店'], '順路店是 home→A 那段的順路站');
  const after = insertOnTheWay({ plan: one.plan, onway, day: one.day, home, legFn, rules, settings, country, kb });
  assert.deepEqual(ids(after), ['A'], `插在 A 前面會讓 A 在門口等，不插：${ids(after).join('→')}`);
  // A＋B：順路店插在誰前面都不會害人多等，就插；插完沒有人在門口等更久
  const two = planTrip({ trip: mkTrip(['A', 'B']), pois: { A, B }, rules, settings, country, kb, legFn, restPool: [C] }).days[0].plan;
  assert.ok(ids(two).includes('順路店'), `A＋B 的那天順路店要排進去：${ids(two).join('→')}`);
  assert.ok(two.sequence.find((s) => s.poi.id === '順路店').waitMin === 0, '順路店自己不等開門');
  assert.ok(ids(two).at(-1) !== '順路店', '不接在最後一站後面');
  const dayCtx = { regionZones: ['town'] };
  const noHours = poi('不知道開不開', { category: 'record', walkFactor: 0, dwellMin: 30, hours: null });
  const drug = poi('藥妝', { category: 'drugstore', walkFactor: 0, dwellMin: 15 });
  const errand = poi('代購站', { category: 'store', walkFactor: 0, dwellMin: 15, item: 'DKNY香水' });
  const near = (a, b) => ({ walkMin: a.id === b.id ? 0 : 3, rideMin: 0, climbMin: 0 });
  assert.deepEqual(onTheWayCandidates({ restPool: [noHours, drug, errand, C], day: dayCtx, home, plan: { sequence: [{ poi: A }] }, legFn: near, settings }).map((c) => c.poi.id), ['順路店'], '沒營業時間的、藥妝店、代購研究的站不當順路站');
});

test('順路站（原話 #170）：知識庫裡繞路 ≤8 分的店直接排進去、價值低於 maybe；繞遠的不排；按過不去了的那天不再插順路站', async () => {
  const { onTheWayCandidates } = await import('../../src/engine/trip.js');
  const A = poi('A', { lat: 38.26, lng: 140.87 }); const B = poi('B', { lat: 38.26, lng: 140.88 });
  const C = poi('順路店', { category: 'record', walkFactor: 0, dwellMin: 30 });
  const D = poi('繞遠店', { category: 'record', walkFactor: 0, dwellMin: 30 });
  const walk = { 'home|A': 10, 'A|B': 10, 'A|順路店': 3, '順路店|B': 3, 'A|繞遠店': 15, '繞遠店|B': 15, 'home|順路店': 12, 'home|繞遠店': 20, '順路店|home': 12 };
  const legFn = (a, b) => ({ walkMin: walk[`${a.id}|${b.id}`] ?? walk[`${b.id}|${a.id}`] ?? 10, rideMin: 0, climbMin: 0 });
  const pois2 = { A, B };
  const mk = (removed = []) => ({ id: 't', party: 1, homeBases: [{ poi: home }], days: [{ date: '2026-08-13', type: 'normal', designated: ['A', 'B'], picks: [{ poiId: 'A', priority: 'must' }, { poiId: 'B', priority: 'must' }], removed }] });
  const plan = planTrip({ trip: mk(), pois: pois2, rules, settings, country, kb, legFn, restPool: [C, D] }).days[0].plan;
  const on = plan.sequence.find((s) => s.poi.id === '順路店');
  assert.ok(on, `順路店要排進去：${ids(plan).join('→')}`);
  assert.equal(on.priority, 'onway'); assert.equal(on.insertedBy, 'engine');
  assert.ok(!ids(plan).includes('繞遠店'), '繞路 20 分的不排');
  const cands = onTheWayCandidates({ restPool: [C, D], day: { regionZones: ['town'] }, home, plan: { sequence: [{ poi: A }, { poi: B }] }, legFn, settings });
  assert.deepEqual(cands.map((c) => c.poi.id), ['順路店']);
  const rejected = planTrip({ trip: mk([{ poiId: '順路店', insertedBy: 'engine', priority: 'onway' }]), pois: pois2, rules, settings, country, kb, legFn, restPool: [C, D] }).days[0].plan;
  assert.ok(!ids(rejected).includes('順路店'), '拒絕過順路站那天不再插');
});

test('引擎插站的池（10-14 T22）：curated:false、2 星、落選兩次、unlockWhen、有品項的店三個池都不插（engineMayInsert）；藥妝店不當順路站但可當填站；他自己勾的 curated:false 店照排', async () => {
  const { onTheWayCandidates, engineMayInsert } = await import('../../src/engine/trip.js');
  const day = { date: '2026-08-13', regionZones: ['town'], window: { startMin: 540, endMin: 1440 } };
  const near = (a, b) => ({ walkMin: a.id === b.id ? 0 : 3, rideMin: 0, climbMin: 0 });
  const blocked = [
    cafe('挖寶型', { curated: false }), cafe('兩星', { my: { rating: 2 } }), cafe('落選兩次', { poolLosses: 2 }), cafe('未解鎖', { unlockWhen: '牛舌吃無可吃' }), cafe('代購站', { item: 'DKNY香水' }),
  ];
  const ok = cafe('咖啡廳');
  assert.deepEqual(blocked.map(engineMayInsert), [false, false, false, false, false]);
  for (const p of [ok, cafe('三星', { my: { rating: 3 } }), cafe('落選一次', { poolLosses: 1 }), cafe('選品未知', { curated: 'unknown' }), cafe('選品店', { curated: true })]) assert.equal(engineMayInsert(p), true, p.id);
  assert.equal(engineMayInsert(null), false);
  // 恢復站池
  assert.deepEqual(restCandidates({ restPool: [...blocked, ok], candidates: [{ poi: poi('A') }], day, home, settings }).map((c) => c.poi.id), ['咖啡廳']);
  // 填站池：藥妝店（購物類）可以當填站（原話 #161 任何站都可以；非購物日由規則 shopping-day 罰掉）；池的門照擋
  const drug = poi('藥妝', { category: 'drugstore', walkFactor: 0, dwellMin: 15 });
  const seq = [{ poi: poi('A'), arriveMin: 540, startMin: 540, endMin: 600, waitMin: 0 }, { poi: poi('B', { hours: { thu: [['12:00', '23:00']] } }), arriveMin: 605, startMin: 720, endMin: 790, waitMin: 115 }];
  const plan = { sequence: seq, warnings: [{ ruleId: 'wait-at-door', code: 'soft', poiId: 'B', msg: '' }] };
  const shopBlocked = blocked.map((p) => ({ ...p, category: 'store', recovery: false, cafeLike: false }));   // 不是恢復站的版本，驗填站池與順路站池
  assert.deepEqual(fillCandidates({ restPool: [...shopBlocked, drug, ok], candidates: [], day, home, plan, settings }).map((c) => c.poi.id).sort(), ['咖啡廳', '藥妝']);
  // 順路站池：購物類（SHOPPING_CATEGORIES）不拿、池的門照擋
  const shop = (id, category) => poi(id, { category, walkFactor: 0, dwellMin: 30 });
  const onwayPool = [...shopBlocked, drug, shop('百貨', 'department'), shop('商店街', 'arcade'), shop('電器', 'electronics'), shop('outlet', 'outlet'), shop('伴手禮', 'gift'), shop('順路店', 'record'), shop('會場', 'venue')];
  assert.deepEqual(onTheWayCandidates({ restPool: onwayPool, day, home, plan: { sequence: [{ poi: poi('A') }] }, legFn: near, settings }).map((c) => c.poi.id).sort(), ['伴手禮', '順路店'], '只拿逛的店；百貨、商店街、藥妝、電器、outlet、會場不當順路站');
  // 他自己勾的 curated:false 店照排（總則 3「指定行程凌駕偏好」）
  const jam = poi('古著屋JAM', { category: 'vintage', walkFactor: 0, dwellMin: 30, curated: false });
  const t = { id: 't', party: 1, homeBases: [{ poi: home }], days: [{ date: '2026-08-13', type: 'normal', picks: [{ poiId: jam.id, priority: 'want' }] }] };
  const r = planTrip({ trip: t, pois: { [jam.id]: jam }, rules, settings, country, kb, legFn, restPool: [jam] }).days[0].plan;
  assert.deepEqual(ids(r), ['古著屋JAM']);
});

test('購物類的填站只在購物日填進去（規則 shopping-day）：同一段等開門空檔，非購物日百貨不填、購物日照填且不出警告', () => {
  // 一天的旅程：預設那天就是離境日＝購物日；shoppingDays: [] 蓋成沒有購物日
  const dept = poi('百貨', { category: 'department', walkFactor: 0, dwellMin: 60, lng: 140.8705 });
  const off = planTrip({ trip: { ...t2, shoppingDays: [] }, pois: p2, rules, settings, country, kb, legFn, restPool: [dept] }).days[0];
  assert.equal(off.day.shoppingDay, false);
  assert.ok(!ids(off.plan).includes('百貨'), `非購物日不填百貨：${ids(off.plan).join('→')}`);
  assert.ok(!off.plan.warnings.some((w) => w.ruleId === 'shopping-day'), '沒填進去就沒有購物日警告');
  const on = planTrip({ trip: t2, pois: p2, rules, settings, country, kb, legFn, restPool: [dept] }).days[0];
  assert.equal(on.day.shoppingDay, true, '一天的旅程：那天就是離境日＝購物日');
  const filled = on.plan.sequence.find((s) => s.poi.id === '百貨');
  assert.ok(filled && filled.priority === 'filler' && filled.insertedBy === 'engine', `購物日照填：${ids(on.plan).join('→')}`);
  assert.equal(filled.errand, false);
  assert.ok(!on.plan.warnings.some((w) => w.ruleId === 'shopping-day'));
  assert.ok(on.plan.penaltyMin < off.plan.penaltyMin, `購物日填了之後罰分 ${on.plan.penaltyMin} 要低於沒填的 ${off.plan.penaltyMin}`);
});
