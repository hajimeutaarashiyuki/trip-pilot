// 分配器的兩條新規則（11-06；原話 #189、#190）：餐段放寬（跟規則 meal-slots 同一把尺）、一日遊的夜間站（當地的要趕得上末班車、市區的只在回城不晚時給）。
// 分配器其餘的規則在 test/engine/allocate.test.js；小世界共用 test/fixtures/alloc-world.js。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allocateTrip } from '../../src/engine/allocate.js';
import { loadRules } from '../../src/rules/index.js';
import { BUILTIN } from '../../src/rules/builtin.js';
import { makeLegFn } from '../../src/geo/matrix.js';
import rulesJson from '../../src/rules.json' with { type: 'json' };
import { POIS, HOME, KB, LINKS, COUNTRY } from '../fixtures/alloc-world.js';

const rules = loadRules(BUILTIN, rulesJson.rules);
const settings = rulesJson.settings;
const hours = (open, close) => Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, [[open, close]]]));
/** town|sea 那條 JR 帶不帶末班（last：{ sea: 'HH:MM', town: 'HH:MM' }）。 */
const worldOf = (last = null) => {
  const links = { ...LINKS, 'town|sea': { ...LINKS['town|sea'], ...(last ? { last } : {}) } };
  return { kb: { ...KB, links }, legFn: makeLegFn({ walk: {}, settings, zoneLinks: links }) };
};
const alloc = ({ days, pois, last = null, over = {}, verify = false }) => {
  const w = worldOf(last);
  return allocateTrip({ trip: { id: 'dt', party: 1, homeBases: [{ poi: HOME }], days }, pois, kb: w.kb, country: COUNTRY, settings: { ...settings, ...over }, rules, legFn: w.legFn, options: { verify } });
};
const pickOf = (r, id) => r.report.days.flatMap((d) => d.picks.map((p) => ({ ...p, date: d.date }))).find((p) => p.poiId === id) ?? null;
const reasonOf = (r, id) => r.unplaced.find((u) => u.poiId === id)?.reason ?? null;

test('餐段放寬（原話 #189）跟規則同一把尺：主行程佔住晚餐段那天，散場後才吃得到的店也能當晚餐；放寬量 0 就跟以前一樣；只開到傍晚的店不會變成晚餐', () => {
  // 小鎮祭 19:00 開始（18:30 卡位、停 110 分 → 分配器把 18:30–20:50 當釘住），晚餐段 18:00–20:30 只剩 18:00–18:30 的空檔
  const day = { date: '2026-08-13', type: 'normal', anchor: { poiId: 'evente' }, picks: [{ poiId: 'evente', priority: 'must', dwellMin: 110, fixedWindow: { startMin: 19 * 60, arriveEarlyMin: 30 } }] };
  const foodlate = { ...POIS.foodd, id: 'foodlate', name_zh: '宵夜食堂', hours: hours('20:00', '23:00') };   // 原本的晚餐段裡有開（20:00–20:30），但空檔裡沒有
  const market = { ...POIS.foodl, id: 'market', name_zh: '朝市', hours: hours('08:00', '17:30') };   // 只開到 17:30：碰得到放寬後的 17:00，但不是晚餐的店
  const market2 = { ...market, id: 'market2', name_zh: '朝市二' };
  const pois = { evente: POIS.evente, foodlate, market };
  const r = alloc({ days: [day], pois });
  assert.deepEqual(r.report.days[0].free, [[540, 18 * 60 + 30], [20 * 60 + 50, 1440]]);
  assert.equal(pickOf(r, 'foodlate')?.slot, 'dinner', '散場後 20:50–21:30 吃得到：算晚餐（晚餐延後）');
  assert.equal(pickOf(r, 'market')?.slot, 'lunch');
  // 兩家朝市、沒有別的店：一家當午餐，另一家不會因為 17:00–17:30 碰到放寬後的時窗就變成晚餐（晚餐的位子還空著）
  const markets = alloc({ days: [day], pois: { evente: POIS.evente, market, market2 } });
  assert.deepEqual([pickOf(markets, 'market')?.slot, pickOf(markets, 'market2')], ['lunch', null]);
  assert.equal(reasonOf(markets, 'market2'), '餐段對不上（已有的那餐佔了、另一餐它沒開或時窗外）', '朝市不會因為放寬變成晚餐的店');
  const strict = alloc({ days: [day], pois, over: { mealGraceMin: 0 } });
  assert.equal(pickOf(strict, 'foodlate'), null, '不放寬：晚餐段的空檔只有 18:00–18:30，它 20:00 才開');
  assert.equal(reasonOf(strict, 'foodlate'), '餐段對不上（已有的那餐佔了、另一餐它沒開或時窗外）');
  // 沒被釘住的日子：放不放寬分出來的餐一樣
  const plain = { date: '2026-08-13', type: 'normal', anchor: { poiId: 'gardeng' }, picks: [] };
  const world2 = { gardeng: POIS.gardeng, foodl: POIS.foodl, foodd: POIS.foodd, foodx: POIS.foodx, market };
  const slots = (res) => res.report.days[0].picks.map((p) => [p.poiId, p.slot]);
  assert.deepEqual(slots(alloc({ days: [plain], pois: world2 })), slots(alloc({ days: [plain], pois: world2, over: { mealGraceMin: 0 } })));
});

test('一日遊市區的夜間站（原話 #190「回程不算晚(9:00)也可以排進來」）：估計回到市區晚於 21:00 就不給據點圈、理由講得出來；回得來照給；估計只算骨架', () => {
  // 遠方的傍晚活動 18:00 開始（不提早卡位）：自己沒跨進 20:00 的夜間時段（跨進去的話那晚就是它，不再要酒吧），但回程要 65 分
  const eventfar = { ...POIS.far1, id: 'eventfar', name_zh: '遠方夕市', category: 'event' };
  const day = (dwellMin) => ({ date: '2026-08-15', type: 'normal', dayTrip: true, anchor: { poiId: 'eventfar' }, picks: [{ poiId: 'eventfar', priority: 'must', dwellMin, fixedWindow: { startMin: 18 * 60, arriveEarlyMin: 0 } }] });
  const pois = { eventfar, barn1: POIS.barn1, street1: POIS.street1 };
  // 停 119 分 → 19:59 散、回程 65 分 → 21:04
  const late = alloc({ days: [day(119)], pois });
  assert.equal(late.report.days[0].dayTripBackMin, 21 * 60 + 4);
  assert.deepEqual(late.report.days[0].nightZones, [], '不給據點圈');
  assert.equal(pickOf(late, 'barn1'), null);
  assert.equal(reasonOf(late, 'barn1'), '一日遊回到市區已經晚於 21:00，不主動排市區的夜間站');
  // 停 100 分 → 19:40 散 → 20:45 回到市區：照給
  const ok = alloc({ days: [day(100)], pois });
  assert.equal(ok.report.days[0].dayTripBackMin, 20 * 60 + 45);
  assert.deepEqual([...ok.report.days[0].nightZones].sort(), ['hill', 'town']);
  assert.equal(pickOf(ok, 'barn1')?.slot, 'night');
  // 門檻是設定
  assert.equal(pickOf(alloc({ days: [day(119)], pois, over: { dayTripNightReturnByHM: '21:30' } }), 'barn1')?.slot, 'night');
  // 沒有固定時段的一日遊：時窗起點 09:00＋去程 35＋主行程 90＋回程 35＝11:40，回得來
  const free = alloc({ days: [{ date: '2026-08-15', type: 'normal', dayTrip: true, anchor: { poiId: 'templesea' }, picks: [] }], pois: { templesea: POIS.templesea, barn1: POIS.barn1 } });
  assert.equal(free.report.days[0].dayTripBackMin, 11 * 60 + 40);
  assert.equal(pickOf(free, 'barn1')?.slot, 'night');
  // 不是一日遊的日子沒有這個估計
  const normal = alloc({ days: [{ date: '2026-08-13', type: 'normal', anchor: { poiId: 'gardeng' }, picks: [] }], pois: { gardeng: POIS.gardeng, barn1: POIS.barn1 } });
  assert.equal(normal.report.days[0].dayTripBackMin, null);
  assert.equal(normal.report.days[0].nightZones, null);
});

test('一日遊當地的夜間站（原話 #190「可以是在當地進行 只要趕的上末班車都可以」）：回程查得到末班、夜間時段到末班之前開得夠久才排；查不到末班不排；太早收班不排', () => {
  const barsea = { ...POIS.barn1, id: 'barsea', name_zh: '海邊酒吧', zoneId: 'sea' };   // 17:00–24:00
  const day = { date: '2026-08-15', type: 'normal', dayTrip: true, anchor: { poiId: 'templesea' }, picks: [] };
  const pois = { templesea: POIS.templesea, barsea, barn1: POIS.barn1 };
  const withLast = alloc({ days: [day], pois, last: { sea: '22:30', town: '23:00' } });
  assert.equal(pickOf(withLast, 'barsea')?.slot, 'night', '22:30 的末班：20:00–22:25 喝得到，離主行程最近，當地的先排');
  assert.equal(reasonOf(withLast, 'barn1'), '夜間站有了');
  const noData = alloc({ days: [day], pois });
  assert.equal(pickOf(noData, 'barsea'), null);
  assert.equal(reasonOf(noData, 'barsea'), '當地的夜間站要查得到回程的末班車才排');
  assert.equal(pickOf(noData, 'barn1')?.slot, 'night', '當地的不行，回城的照給（估計 11:40 就回得來）');
  const early = alloc({ days: [day], pois, last: { sea: '20:10', town: '23:00' } });
  assert.equal(pickOf(early, 'barsea'), null);
  assert.equal(reasonOf(early, 'barsea'), '當地的夜間站：夜間時段到末班車之前（最晚 20:05 要走）它開不夠久');
  // 自訂的 legFn（沒有 rideLink）查不到末班：當地的不排
  const custom = allocateTrip({ trip: { id: 'c', party: 1, homeBases: [{ poi: HOME }], days: [day] }, pois: { templesea: POIS.templesea, barsea }, kb: KB, country: COUNTRY, settings, rules, legFn: (a, b) => (a.zoneId === b.zoneId ? { walkMin: 5, rideMin: 0, climbMin: 0, mode: 'walk' } : { walkMin: 5, rideMin: 30, climbMin: 0, mode: 'ride', source: 'link' }), options: { verify: false } });
  assert.equal(custom.unplaced.find((u) => u.poiId === 'barsea')?.reason, '當地的夜間站要查得到回程的末班車才排');
  // 單日引擎驗證也過：當地的酒吧排得進（規則 last-train 不擋）
  const verified = alloc({ days: [day], pois: { templesea: POIS.templesea, barsea }, last: { sea: '22:30', town: '23:00' }, verify: true });
  assert.equal(pickOf(verified, 'barsea')?.slot, 'night');
  assert.deepEqual(verified.report.verify.dropped, []);
});

test('一日遊估計回得來、排出來其實晚回城：單日引擎在那家市區酒吧掛提示，分配器把自己分的收回、理由記得住；骨架的站不動', () => {
  // 骨架：主行程（白天的寺）＋指定站「夜間點燈」19:40–20:40（沒有固定時段，估計只會把停留往後疊：09:00＋35＋90＋60＋35＝12:40，當回得來）
  const viewsea = { ...POIS.templesea, id: 'viewsea', name_zh: '海邊夜間點燈', hours: hours('19:40', '20:40'), dwellMin: 60 };
  const dayTemple = { ...POIS.templesea, hours: hours('09:00', '17:00') };
  const day = { date: '2026-08-15', type: 'normal', dayTrip: true, anchor: { poiId: 'templesea' }, designated: ['viewsea'], picks: [] };
  const pois = { templesea: dayTemple, viewsea, barn1: POIS.barn1 };
  const dry = alloc({ days: [day], pois });
  assert.equal(dry.report.days[0].dayTripBackMin, 12 * 60 + 40);
  assert.equal(pickOf(dry, 'barn1')?.slot, 'night', '沒驗證時照估計分進去');
  const r = alloc({ days: [day], pois, verify: true });
  assert.equal(pickOf(r, 'barn1'), null, '排出來 21:15 才回到市區：收回');
  assert.deepEqual(r.days[0].picks.map((p) => p.poiId).sort(), ['templesea', 'viewsea'], '骨架照舊');
  assert.equal(reasonOf(r, 'barn1'), '2026-08-15 排不進（一日遊回到市區已經晚於 21:00，不主動排市區的夜間站）');
  assert.deepEqual(r.report.verify.skeletonDropped, []);
  assert.ok(!r.report.slotWarnings.some((w) => /夜間站/.test(w.msg)), '晚回城又沒有夜間站：規則 night-slot 不罰');
});
