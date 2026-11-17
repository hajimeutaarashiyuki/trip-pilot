// tools/plan-report.mjs 的報告文字：提示分哪幾行印、每天三餐是誰（11-06 第二批）。整包排程的內容由 test/engine、test/sendai 管，這裡只看印法。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatReport, mealsLine } from '../../tools/plan-report.mjs';
import { planTrip } from '../../src/engine/trip.js';
import { loadRules } from '../../src/rules/index.js';
import { BUILTIN } from '../../src/rules/builtin.js';
import { makeLegFn } from '../../src/geo/matrix.js';
import rulesJson from '../../src/rules.json' with { type: 'json' };
import { POIS, HOME, ZONES, LINKS, COUNTRY } from '../fixtures/alloc-world.js';

const rules = loadRules(BUILTIN, rulesJson.rules);
const settings = rulesJson.settings;
const hours = (open, close) => Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, [[open, close]]]));

test('他勾的站照排、只提醒一句的兩種提示（一日遊晚回城還排了市區夜間站、趕不上末班車）印在自己的一行「提示：…」，不混進「拒絕過引擎插的站」那行；那一行照舊只印拒絕之後降成提示的警告', () => {
  // 海邊花火 19:00–20:30（海邊 20:00 的末班）→ 21:05 回到小鎮 → 他勾的深夜酒吧
  const eventsea = { ...POIS.templesea, id: 'eventsea', name_zh: '海邊花火', category: 'event', dwellMin: 90 };
  const barlate = { ...POIS.barn1, id: 'barlate', name_zh: '深夜酒吧', hours: hours('21:00', '24:00') };
  const legFn = makeLegFn({ walk: {}, settings, zoneLinks: { ...LINKS, 'town|sea': { ...LINKS['town|sea'], last: { sea: '20:00' } } } });
  const trip = { id: 'pr', name: '報告測試', party: 1, homeBases: [{ poi: HOME }], days: [{ date: '2026-08-15', type: 'normal', dayTrip: true, anchor: { poiId: 'eventsea' }, picks: [
    { poiId: 'eventsea', priority: 'must', fixedWindow: { startMin: 19 * 60, endMin: 20 * 60 + 30, arriveEarlyMin: 30, afterMin: 0 } },
    { poiId: 'barlate', priority: 'want', dwellMin: 30 },
  ] }] };
  const result = planTrip({ trip, pois: { eventsea, barlate }, rules, settings, country: COUNTRY, kb: { zones: ZONES }, legFn, restPool: [] });
  const pack = { trip, city: { id: 'town', name_zh: '小鎮' }, meta: { generatedAt: '2026-11-06T00:00:00.000Z' } };
  const lines = formatReport({ pack, result, legFn }).split('\n');
  assert.deepEqual(lines.filter((l) => l.startsWith('提示')), ['提示：一日遊回到市區約 21:05（晚於 21:00），深夜酒吧 是你勾的，照排；海邊花火 待到 20:30，回住宿趕不上 20:00 的末班車，海邊發車；去 深夜酒吧 趕不上 20:00 的末班車，海邊發車']);
  assert.ok(!lines.some((l) => l.startsWith('警告') && /末班車|是你勾的/.test(l)), '這兩種提示不印進警告那行');
  assert.ok(lines.some((l) => /^- 18:30–20:30　海邊花火/.test(l)) && lines.some((l) => /^- 21:05–21:35　深夜酒吧/.test(l)), '兩站都照排');
  // 拒絕過引擎插的站之後降成提示的警告（連跑、等開門；trip.js 把它們標 hint）照舊印在「拒絕過引擎插的站」那一行，跟上面那行分開
  const rejected = { ...result, days: result.days.map((d) => ({ ...d, plan: { ...d.plan, warnings: [...d.plan.warnings, { ruleId: 'walk-run', code: 'soft', hint: true, msg: '連著走太久了' }] } })) };
  const lines2 = formatReport({ pack, result: rejected, legFn }).split('\n');
  assert.deepEqual(lines2.filter((l) => l.startsWith('提示（')), ['提示（拒絕過引擎插的站，不再插）：連著走太久了']);
  assert.equal(lines2.filter((l) => l.startsWith('提示：')).length, 1);
  // 沒有這兩種提示的日子不多印一行
  const plain = planTrip({ trip: { ...trip, days: [{ date: '2026-08-13', type: 'normal', picks: [{ poiId: 'barlate', priority: 'want', dwellMin: 30 }] }] }, pois: { eventsea, barlate }, rules, settings, country: COUNTRY, kb: { zones: ZONES }, legFn, restPool: [] });
  assert.deepEqual(formatReport({ pack, result: plain, legFn }).split('\n').filter((l) => l.startsWith('提示')), []);
  assert.deepEqual(formatReport({ pack, result: plain, legFn }).split('\n').filter((l) => l.startsWith('三餐')), [], '打包檔沒有國家層餐段就不印三餐那一行');
});

test('每天多印一行「三餐：…」（原話 #195）：配到的站印時刻與店名、那一餐有說明的附在括號裡；要卻沒有的寫沒排；這天不需要的寫原因', () => {
  const legFn = makeLegFn({ walk: {}, settings, zoneLinks: LINKS });
  const cafe = { ...POIS.cafe1, id: 'lunchcafe', name_zh: '洋食喫茶', meals: { lunch: '拿坡里義大利麵套餐' }, hours: hours('11:30', '15:00') };
  const pois = { foodd: POIS.foodd, lunchcafe: cafe, barn1: POIS.barn1, cafe2: POIS.cafe2, gardeng: POIS.gardeng };
  const mk = (days) => ({ id: 'meals', name: '三餐測試', party: 1, homeBases: [{ poi: HOME }], days });
  const plan = (days) => planTrip({ trip: mk(days), pois, rules, settings, country: COUNTRY, kb: { zones: ZONES }, legFn, restPool: [] });
  const reportOf = (result, trip) => formatReport({ pack: { trip, city: { id: 'town', name_zh: '小鎮' }, meta: { generatedAt: '2026-11-06T00:00:00.000Z' }, country: COUNTRY }, result, legFn, settings }).split('\n');
  // 標了午餐的喫茶＋晚餐食堂：兩餐都有，喫茶的說明附在後面，食堂沒有另外的說明
  const days = [{ date: '2026-08-13', type: 'normal', picks: [{ poiId: 'lunchcafe', priority: 'want' }, { poiId: 'foodd', priority: 'want' }] }];
  const full = plan(days);
  const d = full.days[0].plan;
  const at = (id) => d.sequence.find((s) => s.poi.id === id).startMin;
  const hm = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
  assert.deepEqual(d.meals, { breakfast: null, lunch: 'lunchcafe', dinner: 'foodd' });
  assert.deepEqual(reportOf(full, mk(days)).filter((l) => l.startsWith('三餐')), [`三餐：午餐 ${hm(at('lunchcafe'))} 洋食喫茶（拿坡里義大利麵套餐）；晚餐 ${hm(at('foodd'))} 晚餐食堂`]);
  // 沒標的咖啡廳與酒吧：不算哪一餐 → 兩餐都寫沒排（午餐晚餐另有警告那一行）
  const bare = [{ date: '2026-08-13', type: 'normal', picks: [{ poiId: 'cafe2', priority: 'want' }, { poiId: 'barn1', priority: 'want' }] }];
  const lines = reportOf(plan(bare), mk(bare));
  assert.deepEqual(lines.filter((l) => l.startsWith('三餐')), ['三餐：午餐 沒排；晚餐 沒排']);
  assert.ok(lines.some((l) => l.startsWith('警告') && l.includes('今天沒排午餐、晚餐')));
  // 這天不需要的餐：離境日中午前收工不用晚餐；抵達日傍晚才開始不用午餐
  const edge = [
    { date: '2026-08-13', type: 'arrival', arriveMin: 16 * 60, picks: [{ poiId: 'foodd', priority: 'want' }] },
    { date: '2026-08-14', type: 'departure', departAirportMin: 15 * 60, picks: [{ poiId: 'gardeng', priority: 'want' }] },
  ];
  const e = reportOf(plan(edge), mk(edge)).filter((l) => l.startsWith('三餐'));
  assert.match(e[0], /^三餐：午餐 不用（不在這天的時窗裡）；晚餐 \d\d:\d\d 晚餐食堂$/);
  assert.equal(e[1], '三餐：午餐 沒排；晚餐 不用（不在這天的時窗裡）');
  // 純函式：固定時段蓋住的餐、國家層多了早餐段時的早餐
  const venue = { poi: { id: 'v', name_zh: '會場', category: 'venue' }, startMin: 8 * 60 + 50, endMin: 20 * 60, fixedWindow: { startMin: 9 * 60 + 30, endMin: 19 * 60 + 30 } };
  assert.equal(mealsLine({ plan: { sequence: [venue] }, day: {}, country: COUNTRY, settings }), '三餐：午餐 不用（固定時段裡有供餐）；晚餐 不用（固定時段裡有供餐）');
  const morning = { poi: { id: 'm', name_zh: '朝市食堂', category: 'food', recovery: true, meals: { breakfast: '7:30 起的海鮮丼' } }, startMin: 8 * 60, endMin: 9 * 60 };
  const withBreakfast = { ...COUNTRY, mealSlots: { breakfast: ['07:00', '10:00'], ...COUNTRY.mealSlots } };
  assert.equal(mealsLine({ plan: { sequence: [morning] }, day: {}, country: withBreakfast, settings }), '三餐：早餐 08:00 朝市食堂（7:30 起的海鮮丼）；午餐 沒排；晚餐 沒排');
  assert.equal(mealsLine({ plan: { sequence: [morning] }, day: {}, country: null, settings }), null);
});

test('早餐（原話 #196、#197）在報告上：引擎排的與他指定的各有標記；他說這天不排的印「在飯店吃」「這天不排（X 改天去）」；「今天沒排早餐」印在提示那一行、不進警告；有推薦多印一行', () => {
  const JP = { ...COUNTRY, mealSlots: { breakfast: ['07:00', '10:00'], ...COUNTRY.mealSlots } };
  const food = { id: 'm', name_zh: '朝市食堂', category: 'food', recovery: true, meals: { breakfast: '7:30 起的海鮮丼' } };
  const at = (over) => ({ poi: food, startMin: 9 * 60 + 5, endMin: 9 * 60 + 25, dwellMin: 20, ...over });
  const day = { windowRaw: { startMin: 540, endMin: 1440 } };
  const line = (stop, d = day, nameOf) => mealsLine({ plan: { sequence: stop ? [stop] : [] }, day: d, country: JP, settings, nameOf }).split('；')[0];
  assert.equal(line(at({ insertedBy: 'engine', priority: 'breakfast', optional: true })), '三餐：早餐 09:05 朝市食堂（7:30 起的海鮮丼）〔引擎排〕');
  assert.equal(line(at({ breakfast: true, priority: 'want' })), '三餐：早餐 09:05 朝市食堂（7:30 起的海鮮丼）〔你指定的〕');
  assert.equal(line(at({ priority: 'want' })), '三餐：早餐 09:05 朝市食堂（7:30 起的海鮮丼）', '他勾的站自己落在早餐時段：不標');
  assert.equal(line(null), '三餐：早餐 沒排');
  const names = (id) => ({ m: '朝市食堂' }[id] ?? id);
  assert.equal(line(null, { ...day, breakfast: { mode: 'hotel', poiId: 'm' } }, names), '三餐：早餐 在飯店吃（原定 朝市食堂）');
  assert.equal(line(null, { ...day, breakfast: { mode: 'hotel', poiId: null } }, names), '三餐：早餐 在飯店吃');
  assert.equal(line(null, { ...day, breakfast: { mode: 'later', poiId: 'm' } }, names), '三餐：早餐 這天不排（朝市食堂 改天去）');
  assert.equal(line(null, { ...day, breakfast: { mode: 'later', poiId: 'm' } }), '三餐：早餐 這天不排（m 改天去）', '沒給店名對照就印 id（報告是給桌機看的）');
  assert.equal(line(null, { windowRaw: { startMin: 660, endMin: 1440 } }), '三餐：早餐 不用（不在這天的時窗裡）');

  // 整份報告：兩天的小旅程，第一天他說吃飯店、原定那家推薦到第二天
  const legFn = makeLegFn({ walk: {}, settings, zoneLinks: LINKS });
  const morning = { ...POIS.foodd, id: 'bf1', name_zh: '早餐甲', hours: hours('07:00', '22:00'), dwellMin: 20, meals: { breakfast: '定食' } };
  const other = { ...POIS.foodd, id: 'bf2', name_zh: '早餐乙', hours: hours('07:00', '22:00'), dwellMin: 20, meals: { breakfast: '飯糰' } };
  const pois = { gardeng: POIS.gardeng, bf1: morning, bf2: other };
  const picks = [{ poiId: 'gardeng', priority: 'want' }];
  const trip = { id: 'bf', name: '早餐測試', party: 1, homeBases: [{ poi: HOME }], days: [{ date: '2026-08-13', type: 'normal', picks }, { date: '2026-08-14', type: 'normal', picks: [] }] };
  const report = (t, pool) => {
    const result = planTrip({ trip: t, pois, rules, settings, country: JP, kb: { zones: ZONES }, legFn, restPool: pool });
    return { result, lines: formatReport({ pack: { trip: t, city: { id: 'town', name_zh: '小鎮' }, meta: { generatedAt: '2026-11-11T00:00:00.000Z' }, country: JP }, result, legFn, settings, pois: Object.values(pois) }).split('\n') };
  };
  const a = report(trip, [morning, other]);
  const first = a.result.days[0].plan.meals.breakfast;
  assert.ok(first, '第一天引擎排了早餐');
  assert.ok(a.lines.some((l) => l.startsWith('- ') && l.endsWith('（引擎排的早餐）')), '站那一行標「引擎排的早餐」');
  assert.ok(a.lines.some((l) => l.startsWith('三餐：早餐') && l.includes('〔引擎排〕')));
  assert.deepEqual(a.lines.filter((l) => l.startsWith('早餐推薦')), []);
  // 沒有能當早餐的店：提示一行，不進警告
  const none = report(trip, []);
  assert.deepEqual(none.lines.filter((l) => l.startsWith('提示')), ['提示：今天沒排早餐', '提示：今天沒排早餐']);
  assert.ok(!none.lines.some((l) => l.startsWith('警告') && l.includes('早餐')));
  // 吃飯店早餐：那天印「在飯店吃」，後面那天多一行推薦
  const hotel = { ...trip, days: [{ ...trip.days[0], breakfast: { mode: 'hotel', poiId: first, at: '2026-11-11T00:00:00.000Z' } }, trip.days[1]] };
  const b = report(hotel, [morning, other]);
  const firstName = pois[first].name_zh; const secondName = pois[b.result.days[1].plan.meals.breakfast].name_zh;
  assert.ok(b.lines.some((l) => l.startsWith(`三餐：早餐 在飯店吃（原定 ${firstName}）`)));
  assert.deepEqual(b.lines.filter((l) => l.startsWith('早餐推薦')), [`早餐推薦（不自動換）：或 ${firstName}（8/13 沒去的；換掉 ${secondName}，其餘各站最多晚 0 分）`]);
  assert.deepEqual(b.lines.filter((l) => l.startsWith('提示')), [], '他說吃飯店的那天不提示');
});

test('釘住順序的日子（升級成站安插之後；原話 #192）在報告上：分數那一行寫「照你調過的順序排（沒重新搜尋）」、用到留白寫幾分，不印節點與毫秒；沒釘住的日子照舊', () => {
  const legFn = makeLegFn({ walk: {}, settings, zoneLinks: LINKS });
  const pois = { gardeng: POIS.gardeng, templet: POIS.templet, barn1: POIS.barn1 };
  const picks = [{ poiId: 'gardeng', priority: 'want' }, { poiId: 'templet', priority: 'want' }];
  const report = (trip) => {
    const result = planTrip({ trip, pois, rules, settings, country: COUNTRY, kb: { zones: ZONES }, legFn, restPool: [] });
    return { result, lines: formatReport({ pack: { trip, city: { id: 'town', name_zh: '小鎮' }, meta: { generatedAt: '2026-11-12T00:00:00.000Z' }, country: COUNTRY }, result, legFn, settings, pois: Object.values(pois) }).split('\n') };
  };
  const mk = (days) => ({ id: 'pin', name: '釘住測試', party: 1, homeBases: [{ poi: HOME }], days });
  const free = report(mk([{ date: '2026-08-13', type: 'normal', picks }]));
  assert.ok(free.lines.some((l) => l.startsWith('分數 ') && /　節點 \d+　\d+ ms/.test(l)));
  assert.ok(!free.lines.some((l) => l.includes('照你調過的順序排')));
  const pinned = report(mk([{ date: '2026-08-13', type: 'normal', picks, pinned: { at: 'x', sequence: [{ poiId: 'templet' }, { poiId: 'gardeng' }] } }]));
  const scoreLine = pinned.lines.find((l) => l.startsWith('分數 '));
  assert.match(scoreLine, /^分數 \S+　罰分 \d+ 分鐘　全排進　照你調過的順序排（沒重新搜尋）$/);
  assert.ok(!scoreLine.includes('節點'));
  assert.deepEqual(pinned.lines.filter((l) => l.startsWith('- ')).map((l) => l.split('　')[1]), ['小鎮寺', '小鎮庭園'], '照釘住的先後印');
  // 用到留白：把最後一站的停留記到超過扣過留白的收工（22:30）
  const late = report(mk([{ date: '2026-08-13', type: 'normal', picks: [...picks, { poiId: 'barn1', priority: 'want' }], pinned: { at: 'x', sequence: [{ poiId: 'templet' }, { poiId: 'gardeng' }, { poiId: 'barn1', dwellMin: 360 }] } }]));
  const used = late.result.days[0].plan.openSlotUsedMin;
  assert.ok(used > 0, `要用到留白：${late.lines.filter((l) => l.startsWith('- ')).join(' / ')}`);
  assert.ok(late.lines.some((l) => l.startsWith('分數 ') && l.endsWith(`照你調過的順序排（沒重新搜尋），用掉留白 ${used} 分`)));
});

// ── 11-12 審查後補的（修正段）──

test('報告上的兩個新印法（11-12）：會場的攤位包了那一餐印「不用（主行程會場的攤位）」；釘住的日子引擎站被讓掉的那一句印在「提示：」那一行', () => {
  const at = (h, m = 0) => h * 60 + m;
  const stopOf = (id, category, startMin, dwellMin, { poi = {}, ...over } = {}) => ({ ...over, poi: { id, name_zh: id, category, zoneId: 'sea', recovery: false, ...poi }, startMin, endMin: startMin + dwellMin, dwellMin });
  const lunch = stopOf('午餐食堂', 'food', at(11, 30), 60, { poi: { recovery: true, zoneId: 'town' } });
  const stalls = stopOf('祭典攤位', 'event', at(13, 30), 60, { poi: { meals: { dinner: '會場的攤位' } } });
  const festival = stopOf('海邊花火', 'event', at(18, 30), 110, { isAnchor: true });
  const day = { windowRaw: { startMin: 540, endMin: 1440 }, window: { startMin: 540, endMin: 1350 } };
  assert.equal(mealsLine({ plan: { sequence: [lunch, stalls, festival] }, day, country: COUNTRY, settings }), '三餐：午餐 11:30 午餐食堂；晚餐 不用（主行程會場的攤位）');
  // 釘住的日子：引擎站被讓掉的提示（engine/insert.js planPinnedDay 掛的，ruleId pinned-order）印在自己的「提示：」那一行，不混進「拒絕過引擎插的站」
  const legFn = makeLegFn({ walk: {}, settings, zoneLinks: LINKS });
  const trip = { id: 'pr2', name: '報告測試二', party: 1, homeBases: [{ poi: HOME }], days: [{ date: '2026-08-13', type: 'normal', picks: [{ poiId: 'gardeng', priority: 'want' }] }] };
  const result = planTrip({ trip, pois: { gardeng: POIS.gardeng }, rules, settings, country: COUNTRY, kb: { zones: ZONES }, legFn, restPool: [] });
  const hinted = { ...result, days: result.days.map((d) => ({ ...d, plan: { ...d.plan, warnings: [...d.plan.warnings, { ruleId: 'pinned-order', code: 'hint', hint: true, msg: '照你調過的順序排不下，引擎排的 某店 這天先拿掉' }] } })) };
  const lines = formatReport({ pack: { trip, city: { id: 'town', name_zh: '小鎮' }, meta: { generatedAt: '2026-11-12T00:00:00.000Z' } }, result: hinted, legFn }).split('\n');
  assert.deepEqual(lines.filter((l) => l.startsWith('提示')), ['提示：照你調過的順序排不下，引擎排的 某店 這天先拿掉']);
});
