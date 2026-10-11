// 引擎插恢復站（DESIGN §1.3「走路連跑要破 150 才由引擎插恢復站，來源＝候選池未勾 ∪ 當日區域 KB，標引擎插的、可拒絕」；原話 #126）：
// 走路連跑會破 150 的一天，restPool 有同區咖啡廳就插進去、總罰分變低；等開門超過留白（DESIGN §5.2 wait-at-door）也觸發、在空檔放一家；
// 插的站帶 insertedBy、價值 0、排不進不算落選；restPool 空時結果跟原本一樣；
// 拒絕過引擎插的站（removed 帶 insertedBy）那天不再插別家、觸發的警告降成提示（profile §2.4 細則）；一天最多插 settings.restInsertMaxPerDay 家。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planTrip, restCandidates } from '../../src/engine/trip.js';
import { loadRules } from '../../src/rules/index.js';
import { BUILTIN } from '../../src/rules/builtin.js';
import rulesJson from '../../src/rules.json' with { type: 'json' };

const rules = loadRules(BUILTIN, rulesJson.rules);
const settings = rulesJson.settings;
const country = { mealSlots: { lunch: ['11:30', '13:30'], dinner: ['18:00', '20:30'] }, nightSlot: ['20:00', '24:00'], climate: { summerMonths: [6, 7, 8, 9] }, utcOffsetMin: 540 };
const kb = { zones: { town: { environment: 'town', lat: 38.26, lng: 140.87 } } };
const ALL = { thu: [['09:00', '23:00']] };
const poi = (id, over = {}) => ({ id, name_zh: id, category: 'street', walkFactor: 1, recovery: false, cafeLike: false, climbMin: 0, zoneId: 'town', hours: ALL, dwellMin: 70, daylightOnly: false, lat: 38.26, lng: 140.87, ...over });
const home = { id: 'home', name_zh: '飯店', zoneId: 'town', lat: 38.26, lng: 140.87 };
const legFn = () => ({ walkMin: 5, rideMin: 0, climbMin: 0 });

const walkers = [poi('街區A'), poi('街區B'), poi('街區C')];
const pois = Object.fromEntries(walkers.map((p) => [p.id, p]));
const trip = { id: 't', party: 1, homeBases: [{ poi: home }], days: [{ date: '2026-08-13', type: 'normal', designated: walkers.map((p) => p.id), picks: walkers.map((p) => ({ poiId: p.id, priority: 'must' })) }] };
const cafe = (id, over = {}) => poi(id, { category: 'cafe', walkFactor: 0, recovery: true, cafeLike: true, dwellMin: 40, ...over });
const ids = (plan) => plan.sequence.map((s) => s.poi.id);

test('三站各 70 分、係數 1.0、只靠走路串起來會破 150：restPool 有同區咖啡廳就插進去，總罰分比沒 restPool 低', () => {
  const bare = planTrip({ trip, pois, rules, settings, country, kb, legFn }).days[0].plan;
  const withRest = planTrip({ trip, pois, rules, settings, country, kb, legFn, restPool: [cafe('咖啡廳'), cafe('第二家咖啡廳', { lng: 140.879 }), cafe('別區咖啡廳', { zoneId: 'elsewhere' })] }).days[0].plan;
  assert.ok(bare.warnings.some((w) => w.ruleId === 'walk-run'), `沒恢復站時走路連跑要破 150：${ids(bare).join('→')}`);
  const inserted = withRest.sequence.find((s) => s.poi.id === '咖啡廳');
  assert.ok(inserted, `咖啡廳要被插進去：${ids(withRest).join('→')}`);
  assert.equal(inserted.insertedBy, 'engine');
  assert.equal(inserted.priority, 'rest');
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

test('restCandidates：只收 recovery、當日區域內、沒勾在任何一天、沒被拒絕的站；依離 picks 重心的距離取前 restPoolMax 家、沒座標的排最後', () => {
  const pool = [
    cafe('c8', { lng: 140.878 }), cafe('c1', { lng: 140.871 }), cafe('c3', { lng: 140.873 }), cafe('沒座標', { lat: null, lng: null }),
    cafe('c5', { lng: 140.875 }), cafe('c2', { lng: 140.872 }), cafe('c7', { lng: 140.877 }), cafe('c4', { lng: 140.874 }), cafe('c6', { lng: 140.876 }),
    cafe('已勾', { lng: 140.8701 }), cafe('拒絕過', { lng: 140.8702 }), cafe('別區', { lng: 140.8703, zoneId: 'elsewhere' }), poi('古著店', { category: 'vintage', walkFactor: 0, lng: 140.8704 }),
  ];
  const out = restCandidates({ restPool: pool, candidates: [{ poi: poi('A') }], day: { regionZones: ['town'] }, removed: [{ poiId: '拒絕過' }], pickedAnywhere: new Set(['已勾']), home, settings });
  assert.deepEqual(out.map((c) => c.poi.id), ['c1', 'c2', 'c3', 'c4', 'c5', 'c6']);
  assert.ok(out.every((c) => c.priority === 'rest' && c.optional === true && c.insertedBy === 'engine' && c.dwellMin === 40));
  const few = restCandidates({ restPool: [cafe('沒座標', { lat: null, lng: null, dwellMin: undefined }), cafe('c1', { lng: 140.871 })], candidates: [{ poi: poi('A') }], day: { regionZones: ['town'] }, home, settings: { ...settings, restPoolMax: 2 } });
  assert.deepEqual(few.map((c) => c.poi.id), ['c1', '沒座標']);
  assert.equal(few[1].dwellMin, 30, '沒寫停留的恢復站用 restResetMin（至少 30）');
  assert.deepEqual(restCandidates({ restPool: [], candidates: [], day: { regionZones: ['town'] }, settings }), []);
});

test('拒絕過引擎插的站（removed 帶 insertedBy engine）那天不再插別家、不罰；走路連跑的警告降成提示（hint）；他自己拿掉的站不算拒絕恢復站', () => {
  const pool = [cafe('咖啡廳'), cafe('第二家咖啡廳', { lng: 140.879 })];
  const bare = planTrip({ trip, pois, rules, settings, country, kb, legFn }).days[0].plan;
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

test('等開門超過留白（wait-at-door）也觸發第二趟：空檔放一家恢復站、等待變短；拒絕過就不放、警告變提示；restInsertMaxPerDay 0 一家都不插', () => {
  // 早的 11:00 關（只能排第一）、晚開 12:00 才開：中間要等 100 多分；兩站走路連跑沒破 150，觸發的只有等開門
  const first = poi('早的', { hours: { thu: [['09:00', '11:00']] } });
  const late = poi('晚開', { hours: { thu: [['12:00', '23:00']] } });
  const p2 = { [first.id]: first, [late.id]: late };
  const t2 = { id: 't2', party: 1, homeBases: [{ poi: home }], days: [{ date: '2026-08-13', type: 'normal', designated: [first.id, late.id], picks: [{ poiId: first.id, priority: 'must' }, { poiId: late.id, priority: 'must' }] }] };
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
  assert.ok(filled.sequence.find((s) => s.poi.id === '晚開').waitMin < bareLate.waitMin, '等待變短');
  assert.ok(filled.penaltyMin < bare.penaltyMin, `罰分 ${filled.penaltyMin} 要低於 ${bare.penaltyMin}`);
  const rejected = { ...t2, days: [{ ...t2.days[0], removed: [{ poiId: '咖啡廳', at: '2026-08-13T00:00:00Z', insertedBy: 'engine' }] }] };
  const kept = planTrip({ trip: rejected, pois: p2, rules, settings, country, kb, legFn, restPool: [cafe('咖啡廳'), cafe('第二家咖啡廳', { lng: 140.879 })] }).days[0].plan;
  assert.ok(!kept.sequence.some((s) => s.insertedBy), '拒絕過就不放別家');
  const waitWarns = kept.warnings.filter((w) => w.ruleId === 'wait-at-door');
  assert.ok(waitWarns.length > 0 && waitWarns.every((w) => w.hint === true), '等開門的警告變提示');
  const none = planTrip({ trip: t2, pois: p2, rules, settings: { ...settings, restInsertMaxPerDay: 0 }, country, kb, legFn, restPool: [cafe('咖啡廳')] }).days[0].plan;
  assert.ok(!none.sequence.some((s) => s.insertedBy), 'restInsertMaxPerDay 0 一家都不插');
  assert.deepEqual(ids(none), ids(bare));
});

test('引擎插的恢復站不拿錢湯：要準備的站只有他自己勾才會出現', async () => {
  const { restCandidates } = await import('../../src/engine/trip.js');
  const day = { regionZones: ['town'] };
  const pool = [
    { id: 'sento', name_zh: '錢湯', category: 'onsen', recovery: true, zoneId: 'town', lat: 38.26, lng: 140.88 },
    { id: 'cafe', name_zh: '咖啡廳', category: 'cafe', recovery: true, zoneId: 'town', lat: 38.26, lng: 140.88 },
  ];
  const ids = restCandidates({ restPool: pool, candidates: [], day, settings: {} }).map((c) => c.poi.id);
  assert.deepEqual(ids, ['cafe']);
});

test('等開門空檔任何站都可以填（原話 #161）：非恢復站的店離空檔最近就排進去，活動類不拿', () => {
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
  assert.ok(!ids(filled).includes('活動'), '活動類不拿來填');
  assert.ok(filled.penaltyMin < bare.penaltyMin, `罰分 ${filled.penaltyMin} 要低於 ${bare.penaltyMin}`);
  assert.ok(!filled.warnings.some((w) => w.ruleId === 'wait-at-door' && !w.hint), '填了之後不再等開門');
});
