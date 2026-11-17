// 分配器的兩條新規則（11-06；原話 #189、#190）：餐段放寬（跟規則 meal-slots 同一把尺）、一日遊的夜間站（當地的要趕得上末班車、市區的只在回城不晚時給）。
// 11-06 第二批：一日遊的晚餐可以回到市區才吃（#189 後半）、末班車的提示（單日引擎照排他勾的站）分配器自己分的收回、當地夜間站查末班帶那天的日別。
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
const alloc = ({ days, pois, last = null, over = {}, verify = false, brief = null, country = COUNTRY }) => {
  const w = worldOf(last);
  return allocateTrip({ trip: { id: 'dt', party: 1, homeBases: [{ poi: HOME }], days }, pois, kb: w.kb, country, settings: { ...settings, ...over }, rules, legFn: w.legFn, brief, options: { verify } });
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
  // 17:00–24:00。店型原文寫居酒屋＝酒場型、算得了晚餐（rules/_slots.js servesMeal 的推導；11-06 第二批起沒有店型原文的酒吧不算一餐）：
  // 這個兩站的小世界裡，單日引擎是因為它頂得了晚餐才願意等到 17:00 開門——換成喝酒為主的酒吧，驗證那一趟會把它丟掉（那是分數取捨，不是末班車擋的）
  const barsea = { ...POIS.barn1, id: 'barsea', name_zh: '海邊酒吧', zoneId: 'sea', categoryRaw: '居酒屋' };
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

// ── 11-06 第二批 ──
test('一日遊的晚餐也可以回到市區才吃（原話 #189 後半「晚餐地點在主行程去程回程順路或是周邊的地點都可以」）：據點步行圈的吃的店只當晚餐、估計回得不晚而且回來之後晚餐時段它還開著才給；當地有晚餐的店先挑當地的；不是一日遊的日子照舊', () => {
  const day = { date: '2026-08-15', type: 'normal', dayTrip: true, anchor: { poiId: 'templesea' }, picks: [] };   // 估計 11:40 回到市區
  // 只有市區的晚餐食堂（17:00–22:00）：當那天的晚餐。離主行程＝回程 35 分＋從旅館走過去 10 分
  const a = alloc({ days: [day], pois: { templesea: POIS.templesea, foodd: POIS.foodd } });
  const dinner = pickOf(a, 'foodd');
  assert.equal(dinner?.slot, 'dinner');
  assert.equal(dinner.travelMin, 45);
  assert.equal(dinner.why, '一日遊回到市區才吃，離住宿 10 分');
  assert.deepEqual(a.report.days[0].regionZones, ['sea'], '當日區域照舊只有主行程那一區（據點圈不併進去）');
  // 只開中午的午餐食堂（11:00–14:00）：午餐人還在外地，晚餐它沒開——不排
  const b = alloc({ days: [day], pois: { templesea: POIS.templesea, foodl: POIS.foodl } });
  assert.equal(pickOf(b, 'foodl'), null);
  assert.equal(reasonOf(b, 'foodl'), '一日遊回到市區才吃的晚餐：估計 11:40 回到市區，晚餐時段它沒開或來不及');
  // 當地（海邊）也有晚餐的店：先挑當地的（離主行程 10 分 < 45 分），市區的留池
  const fooddsea = { ...POIS.foodd, id: 'fooddsea', name_zh: '海邊晚餐食堂', zoneId: 'sea' };
  const c = alloc({ days: [day], pois: { templesea: POIS.templesea, fooddsea, foodd: POIS.foodd } });
  assert.equal(pickOf(c, 'fooddsea')?.slot, 'dinner');
  assert.equal(pickOf(c, 'fooddsea').why, null, '當地的店照舊，理由欄不加註');
  assert.equal(pickOf(c, 'foodd'), null);
  assert.equal(reasonOf(c, 'foodd'), '晚餐有了（一日遊那天據點附近的店只當晚餐）');
  // 估計回到市區晚於 21:00（遠方夕市 19:00 開始、停 59 分 → 19:59 散、回程 65 分 → 21:04）：跟市區的夜間站一樣不主動排。
  // 19:00 才開始：從晚餐段開始前就在進行的固定時段會被當成蓋住晚餐（大會供餐），那天就不要晚餐了
  const eventfar = { ...POIS.far1, id: 'eventfar', name_zh: '遠方夕市', category: 'event' };
  const farDay = (dwellMin) => ({ date: '2026-08-15', type: 'normal', dayTrip: true, anchor: { poiId: 'eventfar' }, picks: [{ poiId: 'eventfar', priority: 'must', dwellMin, fixedWindow: { startMin: 19 * 60, arriveEarlyMin: 0 } }] });
  const late = alloc({ days: [farDay(59)], pois: { eventfar, foodd: POIS.foodd } });
  assert.equal(late.report.days[0].dayTripBackMin, 21 * 60 + 4);
  assert.equal(pickOf(late, 'foodd'), null);
  assert.equal(reasonOf(late, 'foodd'), '一日遊回到市區已經晚於 21:00，不主動排回市區才吃的晚餐');
  // 停 40 分 → 估計 20:45 回到市區：開到 22:00 的晚餐食堂還吃得到（20:45–21:30）；20:50 就關的來不及
  const foodearly = { ...POIS.foodd, id: 'foodearly', name_zh: '早關食堂', hours: hours('17:00', '20:50') };
  const back = alloc({ days: [farDay(40)], pois: { eventfar, foodd: POIS.foodd, foodearly } });
  assert.equal(back.report.days[0].dayTripBackMin, 20 * 60 + 45);
  assert.equal(pickOf(back, 'foodd')?.slot, 'dinner');
  assert.equal(pickOf(back, 'foodearly'), null);
  assert.equal(reasonOf(back, 'foodearly'), '晚餐有了（一日遊那天據點附近的店只當晚餐）');
  const only = alloc({ days: [farDay(40)], pois: { eventfar, foodearly } });
  assert.equal(pickOf(only, 'foodearly'), null);
  assert.equal(reasonOf(only, 'foodearly'), '一日遊回到市區才吃的晚餐：估計 20:45 回到市區，晚餐時段它沒開或來不及');
  // 不是一日遊的日子：晚餐食堂照舊當晚餐、理由欄沒有那一句
  const normal = alloc({ days: [{ date: '2026-08-13', type: 'normal', anchor: { poiId: 'gardeng' }, picks: [] }], pois: { gardeng: POIS.gardeng, foodd: POIS.foodd } });
  assert.deepEqual([pickOf(normal, 'foodd')?.slot, pickOf(normal, 'foodd')?.why], ['dinner', null]);
  // 沒有國家層的晚餐段就沒有「晚餐」可言：一日遊那天據點圈的吃的店照舊不在當日區域
  const noSlots = alloc({ days: [day], pois: { templesea: POIS.templesea, foodd: POIS.foodd }, country: null });
  assert.equal(reasonOf(noSlots, 'foodd'), '不在當日區域');
});

test('回到市區才吃的晚餐排出來其實晚回城（估計只算骨架）：單日引擎在那一站掛提示 day-trip-night，分配器收回、理由講晚餐；排得進晚餐時段的留著', () => {
  // 骨架：主行程（白天的寺）＋指定站「夜間點燈」19:40–20:40——估計 12:40 就回得來，排出來 21:15 才回到市區
  const viewsea = { ...POIS.templesea, id: 'viewsea', name_zh: '海邊夜間點燈', hours: hours('19:40', '20:40'), dwellMin: 60 };
  const dayTemple = { ...POIS.templesea, hours: hours('09:00', '17:00') };
  const lateDay = { date: '2026-08-15', type: 'normal', dayTrip: true, anchor: { poiId: 'templesea' }, designated: ['viewsea'], picks: [] };
  const foodnight = { ...POIS.foodd, id: 'foodnight', name_zh: '宵夜食堂', hours: hours('20:10', '23:00') };   // 晚餐段裡有開（20:10–20:30），但他回來之前吃不到
  const pois = { templesea: dayTemple, viewsea, foodnight };
  const dry = alloc({ days: [lateDay], pois });
  assert.equal(pickOf(dry, 'foodnight')?.slot, 'dinner', '沒驗證時照估計分進去');
  const r = alloc({ days: [lateDay], pois, verify: true });
  assert.equal(pickOf(r, 'foodnight'), null, '排出來 21:15 才回到市區、宵夜食堂落在回城之後的夜間時段：收回');
  assert.equal(reasonOf(r, 'foodnight'), '2026-08-15 排不進（一日遊回到市區已經晚於 21:00，不主動排回市區才吃的晚餐）');
  assert.deepEqual(r.days[0].picks.map((p) => p.poiId).sort(), ['templesea', 'viewsea'], '骨架照舊');
  // 下午的活動 14:00–16:00、16:35 回到市區：晚餐食堂 17:00 開門就吃，驗證後留著
  const eventsea = { ...POIS.templesea, id: 'eventsea', name_zh: '海邊午後祭', category: 'event' };
  const earlyDay = { date: '2026-08-15', type: 'normal', dayTrip: true, anchor: { poiId: 'eventsea' }, picks: [{ poiId: 'eventsea', priority: 'must', fixedWindow: { startMin: 14 * 60, endMin: 16 * 60, arriveEarlyMin: 0, afterMin: 0 } }] };
  const kept = alloc({ days: [earlyDay], pois: { eventsea, foodd: POIS.foodd }, verify: true });
  assert.equal(kept.report.days[0].dayTripBackMin, 16 * 60 + 35);
  assert.equal(pickOf(kept, 'foodd')?.slot, 'dinner');
  assert.deepEqual(kept.report.verify.dropped, []);
  assert.ok(!kept.report.slotWarnings.some((w) => /晚餐/.test(w.msg)), '那天有晚餐了');
});

test('末班車的提示（單日引擎對他勾的站照排、掛 last-train）：分配器自己分進去的站收回、留池理由就是那一句；需求單點名的不收；旅程檔原本就有的（骨架）不動', () => {
  const onsen = { ...POIS.templesea, id: 'onsensea', name_zh: '海邊日歸湯', name_local: 'onsensea', category: 'onsen', walkFactor: 0, recovery: true, hours: hours('11:00', '21:00'), dwellMin: 90 };
  const day = { date: '2026-08-15', type: 'normal', dayTrip: true, anchor: { poiId: 'templesea' }, picks: [] };
  const pois = { templesea: POIS.templesea, onsensea: onsen };
  const last = { sea: '12:00', town: '23:00' };   // 11:00 才開、泡 90 分：最早 12:30 泡完，怎麼排都趕不上 12:00（寺排在它前面的早上，趕得上）
  const dry = alloc({ days: [day], pois, last });
  assert.ok(pickOf(dry, 'onsensea'), '沒驗證時分進去（那天有開、在當日區域；分配時不看末班）');
  const r = alloc({ days: [day], pois, last, verify: true });
  assert.equal(pickOf(r, 'onsensea'), null, '單日引擎照排但掛了提示：分配器自己分的收回');
  assert.equal(reasonOf(r, 'onsensea'), '2026-08-15 排不進（海邊日歸湯 待到 12:45，回住宿趕不上 12:00 的末班車，海邊發車）');
  assert.deepEqual(r.days[0].picks.map((p) => p.poiId), ['templesea']);
  assert.ok(r.report.verify.runs >= 2, '收回之後再驗一趟');
  // 末班夠晚（21:30）就留著
  const fine = alloc({ days: [day], pois, last: { sea: '21:30', town: '23:00' }, verify: true });
  assert.ok(pickOf(fine, 'onsensea'));
  // 需求單點名的（②）：不收，那一天照排（提示留在單日引擎的那一站）
  const named = alloc({ days: [day], pois, last, verify: true, brief: { persons: [{ isMe: true, go: { designated: ['海邊日歸湯'] }, buy: { own: [] } }], errands: [] } });
  assert.deepEqual([pickOf(named, 'onsensea')?.level, pickOf(named, 'onsensea')?.priority], [2, 'want']);
  assert.deepEqual(named.unplaced.map((u) => u.poiId), []);
  // 旅程檔原本就有的（指定站＝骨架）：不動，也不再被單日引擎丟（上一版會記進 verify.skeletonDropped）
  const skeleton = alloc({ days: [{ ...day, designated: ['onsensea'] }], pois, last, verify: true });
  assert.deepEqual(skeleton.days[0].picks.map((p) => p.poiId).sort(), ['onsensea', 'templesea']);
  assert.deepEqual(skeleton.report.verify.skeletonDropped, []);
});

test('當地夜間站查末班帶那天的日別（末班分日別）：同一家海邊酒吧，週六 22:30 的末班排得進、週日 20:10 的排不進；特殊時刻表期間取最早的', () => {
  const barsea = { ...POIS.barn1, id: 'barsea', name_zh: '海邊酒吧', zoneId: 'sea', categoryRaw: '居酒屋' };   // 17:00–24:00；酒場型（算得了晚餐，驗證那一趟才留得住；見上面那條的說明）
  const pois = { templesea: POIS.templesea, barsea };
  const last = { sea: { weekday: '22:30', saturday: '22:30', holiday: '20:10' }, town: '23:00' };
  const on = (date) => [{ date, type: 'normal', dayTrip: true, anchor: { poiId: 'templesea' }, picks: [] }];
  assert.equal(pickOf(alloc({ days: on('2026-08-15'), pois, last }), 'barsea')?.slot, 'night', '週六');
  const sun = alloc({ days: on('2026-08-16'), pois, last });
  assert.equal(pickOf(sun, 'barsea'), null, '週日');
  assert.equal(reasonOf(sun, 'barsea'), '當地的夜間站：夜間時段到末班車之前（最晚 20:05 要走）它開不夠久');
  const obon = alloc({ days: on('2026-08-15'), pois, last, country: { ...COUNTRY, transportProfile: { specialSchedule: [{ name: 'お盆', from: '08-13', to: '08-16' }] } } });
  assert.equal(pickOf(obon, 'barsea'), null, '盂蘭盆期間的週六：不知道跑哪一種，取最早的 20:10');
  // 驗證也過：週六那天單日引擎沒有掛末班車的提示
  const verified = alloc({ days: on('2026-08-15'), pois, last, verify: true });
  assert.equal(pickOf(verified, 'barsea')?.slot, 'night');
  assert.deepEqual(verified.report.verify.dropped, []);
});

test('回不了住宿的分配站逐站收回（11-17）：同一個外地的區有三家以上分配站都晚於末班時一趟全部收回，不靠單日引擎的提示（提示同一區只掛最晚離開的那一站）；同一區有骨架的站更晚離開、也回不了時，前面的分配站照舊不收', () => {
  // 海邊午後祭 15:00–16:30 固定時段（骨架、趕得上 16:50 的末班）；海邊五家 16:35 才開的夕市各 20 分——排在祭之後的每一家都晚於末班
  const eventsea = { ...POIS.templesea, id: 'eventsea', name_zh: '海邊午後祭', dwellMin: 90 };
  const evening = (i) => ({ ...POIS.templesea, id: `s${i}`, name_zh: `海邊夕市${i}`, name_local: `s${i}`, category: 'street', hours: hours('16:35', '22:00'), dwellMin: 20, walkFactor: 0.5 });
  const pois = { eventsea, ...Object.fromEntries([1, 2, 3, 4, 5].map((i) => [`s${i}`, evening(i)])) };
  const day = (endMin) => ({ date: '2026-08-15', type: 'normal', dayTrip: true, anchor: { poiId: 'eventsea' }, picks: [{ poiId: 'eventsea', priority: 'must', fixedWindow: { startMin: 15 * 60, endMin, arriveEarlyMin: 0, afterMin: 0 } }] });
  const last = { sea: '16:50', town: '23:00' };
  const dry = alloc({ days: [day(16 * 60 + 30)], pois, last });
  assert.ok(dry.days[0].picks.length >= 4, `沒驗證時分得進三家以上（${dry.days[0].picks.map((p) => p.poiId).join('、')}）`);
  const r = alloc({ days: [day(16 * 60 + 30)], pois, last, verify: true });
  assert.deepEqual(r.days[0].picks.map((p) => p.poiId), ['eventsea'], '晚於末班的分配站一家都不留（之前一趟只收一家，驗證三趟用完還留著回不了住宿的站）');
  assert.deepEqual(r.report.verify.dropped, [], '不是驗證趟數用完才丟的');
  assert.ok(r.report.verify.runs <= 2, `一趟就全部收回，再驗一趟（${r.report.verify.runs} 趟）`);
  for (const i of [1, 2, 3, 4, 5]) assert.match(reasonOf(r, `s${i}`) ?? '', /回住宿趕不上 16:50 的末班車，海邊發車/, `海邊夕市${i} 的留池理由講得出是哪一班`);
  // 骨架的花火自己就晚於末班（19:00–20:30 固定時段、海邊 17:30 的末班）：人本來就待到那時候，排在它前面、也待過末班的分配站不收
  // （兩家傍晚的市集 16:40–18:25 開、各 40 分：第二家 17:30–18:10 晚於末班；11-17 提示改成同一區只講一次要的就是這個效果——5514647 會把它們當成趕不上收回）
  const hanabi = { ...POIS.templesea, id: 'hanabi', name_zh: '海邊花火', name_local: 'hanabi', category: 'event', dwellMin: 90 };
  const dusk = (i) => ({ ...POIS.templesea, id: `e${i}`, name_zh: `海邊夕市${i}`, name_local: `e${i}`, category: 'street', hours: hours('16:40', '18:25'), dwellMin: 40, walkFactor: 0.5 });
  const hanabiDay = { date: '2026-08-15', type: 'normal', dayTrip: true, anchor: { poiId: 'hanabi' }, picks: [{ poiId: 'hanabi', priority: 'must', fixedWindow: { startMin: 19 * 60, endMin: 20 * 60 + 30, arriveEarlyMin: 30, afterMin: 0 } }] };
  const lateAnchor = alloc({ days: [hanabiDay], pois: { hanabi, e1: dusk(1), e2: dusk(2) }, last: { sea: '17:30', town: '23:00' }, verify: true });
  assert.deepEqual(lateAnchor.days[0].picks.map((p) => p.poiId).sort(), ['e1', 'e2', 'hanabi'], '第二家夕市也晚於 17:30 的末班，但花火更晚散：不收');
  assert.deepEqual([reasonOf(lateAnchor, 'e1'), reasonOf(lateAnchor, 'e2')], [null, null]);
  // 花火之後才去的分配站（20:40 才開的夜市）比花火更晚離開：它才是讓他更晚回不去的那一站，照收
  const night = { ...POIS.templesea, id: 'nightsea', name_zh: '海邊夜市', name_local: 'nightsea', category: 'street', hours: hours('20:40', '23:00'), dwellMin: 20, walkFactor: 0.5 };
  const withNight = alloc({ days: [hanabiDay], pois: { hanabi, nightsea: night }, last: { sea: '17:30', town: '23:00' }, verify: true });
  assert.deepEqual(withNight.days[0].picks.map((p) => p.poiId), ['hanabi'], '夜市比花火晚離開：收回');
  assert.match(reasonOf(withNight, 'nightsea') ?? '', /海邊夜市 待到 \d\d:\d\d，回住宿趕不上 17:30 的末班車，海邊發車/);
});
