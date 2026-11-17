// 規劃頁新動作的小世界（不是測試檔；test/ui/insert.test.js、meals.test.js、plan-actions.test.js 共用）：
// town 一區、所有站同座標、站間走 5 分（跟 test/engine/insert.test.js 的世界一同一組數字，時刻在那邊驗過）。
// 四天：THU 順序釘死（不靠搜尋、引擎不插站）——街區A 09:05 → 街區C 10:10 → 午餐店 11:30 → 晚餐店 17:30 → 街區B 18:35 → 酒吧 20:00–22:30（時窗 09:00–24:00、留白 90 分）；
// FRI／SAT／SUN 各勾兩站，國家層有早餐段，引擎每天從三家早餐店挑一家排成第一站。
// 小店／中店／大店是挖寶型（curated: false）：引擎不會自己插，走廊清單照列——拿來按「升級成站」。
import { planTrip } from '../../src/engine/trip.js';
import { loadRules } from '../../src/rules/index.js';
import { BUILTIN } from '../../src/rules/builtin.js';
import { snapshotTripEdits } from '../../src/ui/trip-edits.js';
import rulesJson from '../../src/rules.json' with { type: 'json' };

export const rules = loadRules(BUILTIN, rulesJson.rules);
export const settings = rulesJson.settings;
// 夏季月份留空：不測「夏天中午會曬」，免得順延幾分鐘就多一條不相干的罰
export const COUNTRY = { mealSlots: { lunch: ['11:30', '13:30'], dinner: ['18:00', '20:30'] }, nightSlot: ['20:00', '24:00'], climate: { summerMonths: [] }, utcOffsetMin: 540 };
export const JP = { ...COUNTRY, mealSlots: { breakfast: ['07:00', '10:00'], ...COUNTRY.mealSlots } };
export const kb = { zones: { town: { environment: 'town', lat: 38.26, lng: 140.87 } } };
const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const daily = (open, close) => Object.fromEntries(DAYS.map((k) => [k, [[open, close]]]));
const mk = (id, over = {}) => ({ id, name_zh: id, category: 'street', walkFactor: 1, recovery: false, cafeLike: false, climbMin: 0, zoneId: 'town', hours: daily('09:00', '23:00'), dwellMin: 60, daylightOnly: false, lat: 38.26, lng: 140.87, my: {}, highlight: `${id}的簡介`, ...over });
const shop = (id, over = {}) => mk(id, { category: 'store', walkFactor: 0, dwellMin: 30, curated: false, ...over });
const eat = (id, over = {}) => mk(id, { category: 'food', walkFactor: 0, recovery: true, dwellMin: 20, hours: daily('07:00', '22:00'), meals: { breakfast: `${id}的早餐`, lunch: true }, ...over });
export const home = { id: 'home', name_zh: '飯店', zoneId: 'town', lat: 38.26, lng: 140.87 };
export const legFn = () => ({ walkMin: 5, rideMin: 0, climbMin: 0, mode: 'walk' });
export const THU = '2026-08-13'; export const FRI = '2026-08-14'; export const SAT = '2026-08-15'; export const SUN = '2026-08-16';

export const A = mk('街區A'); export const B = mk('街區B'); export const C = mk('街區C');
export const D = mk('街區D'); export const E = mk('街區E'); export const F = mk('街區F'); export const G = mk('街區G'); export const H = mk('街區H'); export const I = mk('街區I');
export const Z = mk('街區Z（備用）');   // 沒勾：換一家的候選（同店型）
export const late = mk('晚開的展館', { category: 'museum', hours: daily('11:00', '23:00'), curated: false });   // 沒勾；測試自己勾進某一天當第一站：早上有空，早餐排進來不會讓別的站晚
export const lunch = mk('午餐店', { category: 'food', walkFactor: 0, recovery: true, hours: daily('11:30', '14:30'), meals: { lunch: true } });
export const dinner = mk('晚餐店', { category: 'food', walkFactor: 0, recovery: true, hours: daily('17:30', '22:00'), meals: { dinner: true } });
// 晚餐的換一家候選：吃的店（沒有另外的說明）與標了能當晚餐的居酒屋（有說明）；咖啡廳標了不是吃正餐的地方
export const dinner2 = mk('晚餐二店', { category: 'food', walkFactor: 0, recovery: true, hours: daily('17:30', '22:00'), meals: { dinner: true } });
export const izakaya = mk('居酒屋', { category: 'bar', walkFactor: 0, recovery: true, hours: daily('17:00', '24:00'), meals: { dinner: '串燒與釜飯，吃得飽' }, guide: { intro: '居酒屋的導讀' } });
export const cafe = mk('咖啡廳', { category: 'cafe', walkFactor: 0, recovery: true, cafeLike: true, hours: daily('09:00', '22:00'), meals: {}, curated: false });
export const bar = mk('酒吧', { category: 'bar', walkFactor: 0, recovery: true, hours: daily('20:00', '24:00'), dwellMin: 150, meals: {} });
export const small = shop('小店', { dwellMin: 20 }); export const mid = shop('中店', { dwellMin: 120 }); export const big = shop('大店（挖寶）', { dwellMin: 240 });
export const noodle = eat('麵店'); export const stand = eat('站內店'); export const bakery = eat('麵包店');
export const WORLD = [A, B, C, D, E, F, G, H, I, Z, late, lunch, dinner, dinner2, izakaya, cafe, bar, small, mid, big, noodle, stand, bakery];
export const pois = Object.fromEntries(WORLD.map((p) => [p.id, p]));
export const ORDER1 = [A.id, C.id, lunch.id, dinner.id, B.id, bar.id];
const want = (...list) => list.map((id) => ({ poiId: id, priority: 'want' }));

/** 四天的旅程（每次回新的一份）。 */
export function makeTrip() {
  return {
    id: 'ui-world', name: '小世界', party: 1, homeBases: [{ poi: home }],
    days: [
      { date: THU, type: 'normal', picks: want(...ORDER1), pinned: { at: '2026-11-12T00:00:00.000Z', sequence: ORDER1.map((poiId) => ({ poiId })) } },
      { date: FRI, type: 'normal', picks: want(D.id, E.id) },
      // 第三天起預設 11:00 才出門（早餐段不在時窗裡、不排早餐）：這兩天標 09:00 出門，才有早餐
      { date: SAT, type: 'normal', earlyDay: true, departHM: '09:00', picks: want(F.id, G.id) },
      { date: SUN, type: 'normal', earlyDay: true, departHM: '09:00', picks: want(H.id, I.id) },
    ],
  };
}

/** 直接排（不經過 app.js）：純函式的測試用。回 { [date]: { date, day, plan } }。 */
export function planWorld(trip = makeTrip(), { country = JP } = {}) {
  const r = planTrip({ trip, pois, rules, settings, country, kb, legFn, restPool: WORLD });
  return Object.fromEntries(r.days.map((d) => [d.date, d]));
}

/** 畫面的 state 形狀（純函式的測試用；app.js 的 state 由 loadWorld 填）。 */
export function stateOf(trip = makeTrip(), { country = JP } = {}) {
  return { trip, pois, country, kb, legFn, rules, settings, pool: WORLD.map((poi) => ({ poi })), plans: planWorld(trip, { country }), field: { visited: {} }, corridorOpen: {} };
}

/** 把小世界載進 app.js 的 state（跟 loadFromPack 做的事一樣，只是不經過打包檔）；呼叫端接著 replanAll()。 */
export function loadWorld(state, trip = makeTrip(), { country = JP } = {}) {
  Object.assign(state, {
    trip, pois: { ...pois }, country, kb, legFn, pool: WORLD.map((poi) => ({ poi })), packRules: null, packMeta: null,
    undo: null, notice: null, busy: false, insertAsk: null, corridorOpen: {}, planScroll: false, route: '#/plan',
    field: { date: THU, index: 0, simulate: true, simNowMin: null, ratings: {}, progress: {}, visited: {} },
  });
  state.tripBase = JSON.parse(JSON.stringify(snapshotTripEdits(trip, null)));
}

export const idsOf = (plan) => plan.sequence.map((s) => s.poi.id);
