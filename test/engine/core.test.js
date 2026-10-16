// T4：核心搜尋。小候選集就能看出：守營業時間、never 的站進 dropped 帶理由、會避開咖啡廳連排、永遠回得出東西、節點預算。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planDay, absorbIntoSpot, spotLatestEnd as absorbIntoSpotLatest } from '../../src/engine/core.js';
import { placeStop } from '../../src/engine/schedule.js';
import { loadRules } from '../../src/rules/index.js';
import { BUILTIN } from '../../src/rules/builtin.js';
import rulesJson from '../../src/rules.json' with { type: 'json' };

const settings = rulesJson.settings;
const rules = loadRules(BUILTIN, rulesJson.rules);
const country = { mealSlots: { lunch: ['11:30', '13:30'], dinner: ['18:00', '20:30'] }, nightSlot: ['20:00', '24:00'], climate: { summerMonths: [6, 7, 8, 9] } };
const kb = { zones: { town: { environment: 'urban' } } };
const home = { id: 'home', name_zh: '飯店', zoneId: 'town' };
const ALL = { thu: [['09:00', '23:00']] };
const poi = (id, over = {}) => ({ id, name_zh: id, category: 'shrine', walkFactor: 0.5, recovery: false, cafeLike: false, climbMin: 0, zoneId: 'town', hours: ALL, dwellMin: 60, ...over });
const day = (over = {}) => ({ date: '2026-08-13', type: 'normal', earlyDay: false, party: 1, dayTripNext: false, themeCategory: null, prevThemeCategory: null, anchorPoiId: null, designated: [], regionZones: ['town'], window: { startMin: 9 * 60, endMin: 24 * 60 }, ...over });
const flatLeg = () => ({ walkMin: 10, rideMin: 0, climbMin: 0 });

test('placeStop：開門前到就等到開門；固定時段提前到位', () => {
  const p = placeStop({ prevEndMin: 9 * 60, leg: { walkMin: 10 }, poi: poi('x', { hours: { thu: [['10:00', '18:00']] } }), dwellMin: 60, date: '2026-08-13' });
  assert.equal(p.arriveMin, 9 * 60 + 10); assert.equal(p.startMin, 10 * 60); assert.equal(p.waitMin, 50); assert.equal(p.endMin, 11 * 60);
  const f = placeStop({ prevEndMin: 18 * 60, leg: { walkMin: 10 }, poi: poi('花火'), dwellMin: 20, date: '2026-08-13', fixedWindow: { startMin: 19 * 60 + 30, arriveEarlyMin: 30 } });
  assert.equal(f.startMin, 19 * 60);
});

test('placeStop：固定時段有 endMin 就結束在 endMin＋afterMin、不看停留（研討會前 40 後 30 掛在窗上，DESIGN §11.1 Q7）；afterMin 缺當 0；沒有 endMin 的照 startMin＋停留（10-14 T23）', () => {
  const venue = poi('會場', { category: 'venue', walkFactor: 0, hours: { fri: [['09:30', '19:30']] } });
  const s = placeStop({ prevEndMin: 8 * 60 + 20, leg: { walkMin: 5, rideMin: 15 }, poi: venue, dwellMin: 60, date: '2026-08-14', fixedWindow: { startMin: 9 * 60 + 30, endMin: 19 * 60 + 30, arriveEarlyMin: 40, afterMin: 30 }, dayStartMin: 8 * 60 + 20, first: true });
  assert.deepEqual(s, { arriveMin: 8 * 60 + 50, startMin: 8 * 60 + 50, waitMin: 0, endMin: 20 * 60 }, '08:20 出門、車 20 分 08:40 到，卡位時刻 08:50 → 第一站改成晚點出門；結束 19:30＋30＝20:00，停留 60 不算');
  const noAfter = placeStop({ prevEndMin: 8 * 60, leg: { walkMin: 10 }, poi: venue, dwellMin: 60, date: '2026-08-14', fixedWindow: { startMin: 9 * 60 + 30, endMin: 19 * 60 + 30, arriveEarlyMin: 40 } });
  assert.equal(noAfter.endMin, 19 * 60 + 30, 'afterMin 缺當 0（預設 30 由 trip.js fixedWindowOf 補，placeStop 不補）');
  const onlyStart = placeStop({ prevEndMin: 18 * 60, leg: { walkMin: 10 }, poi: poi('花火'), dwellMin: 20, date: '2026-08-13', fixedWindow: { startMin: 19 * 60 + 30, arriveEarlyMin: 30 } });
  assert.deepEqual([onlyStart.startMin, onlyStart.endMin], [19 * 60, 19 * 60 + 20], '只釘開始的（花火）照停留算');
  const late = placeStop({ prevEndMin: 9 * 60 + 30, leg: { walkMin: 10 }, poi: venue, dwellMin: 60, date: '2026-08-14', fixedWindow: { startMin: 9 * 60 + 30, endMin: 19 * 60 + 30, arriveEarlyMin: 40, afterMin: 30 } });
  assert.deepEqual([late.startMin, late.endMin], [9 * 60 + 40, 20 * 60], '遲到了也照散場時刻結束（到得太晚由 fixed-window 規則判 never）');
});

test('守營業時間、主行程必排、指定站一定在、沒開的進 dropped 帶理由', () => {
  const cands = [
    { poi: poi('神社', { hours: { thu: [['09:00', '16:00']] } }), priority: 'want', isAnchor: true },
    { poi: poi('午餐', { category: 'food', walkFactor: 0, recovery: true, hours: { thu: [['11:30', '14:00']] } }), priority: 'want' },
    { poi: poi('古著', { category: 'vintage', walkFactor: 0, hours: { thu: [['12:00', '20:00']] } }), priority: 'must', designated: true },
    { poi: poi('休週四', { hours: { mon: [['09:00', '17:00']] } }), priority: 'want' },
    // 15:00 就開：17:00 才開的話其他站 13:40 就走完，在門口等 200 分會被 wait-at-door 罰到不如不去（#155），那是另一件事
    { poi: poi('夜間站', { category: 'bar', walkFactor: 0, recovery: true, hours: { thu: [['15:00', '26:00']] } }), priority: 'want' },
  ];
  const r = planDay({ candidates: cands, day: day({ anchorPoiId: '神社', anchorName: '神社', designated: ['古著'] }), home, legFn: flatLeg, rules, settings, country, kb, options: { explain: true } });
  const ids = r.sequence.map((s) => s.poi.id);
  assert.ok(r.complete, '主行程有排進去');
  assert.ok(ids.includes('神社') && ids.includes('古著') && ids.includes('午餐') && ids.includes('夜間站'), ids.join(','));
  assert.ok(!ids.includes('休週四'));
  const dropped = r.dropped.find((d) => d.poi.id === '休週四');
  assert.match(dropped.reason, /今天沒開/);
  for (const s of r.sequence) assert.ok(s.startMin >= 9 * 60 && s.endMin <= 24 * 60);
  const lunch = r.sequence.find((s) => s.poi.id === '午餐');
  assert.ok(lunch.startMin >= 11 * 60 + 30 && lunch.endMin <= 14 * 60, '午餐在營業時間內');
  assert.ok(r.breakdown && r.breakdown.stops.length === r.sequence.length);
  assert.ok(r.stats.ms < 1000 && !r.stats.truncated, `${r.stats.nodes} 節點 ${r.stats.ms} ms`);
});

test('兩家咖啡廳都想去時不排連著；有第三家可插就插中間', () => {
  const cafe = (id) => ({ poi: poi(id, { category: 'cafe', walkFactor: 0, recovery: true, cafeLike: true }), priority: 'want' });
  const cands = [cafe('咖啡A'), cafe('咖啡B'), { poi: poi('唱片行', { category: 'record', walkFactor: 0 }), priority: 'want' }];
  const r = planDay({ candidates: cands, day: day(), home, legFn: flatLeg, rules, settings, country, kb });
  const ids = r.sequence.map((s) => s.poi.id);
  assert.equal(ids.length, 3);
  assert.notEqual(ids.indexOf('唱片行'), 0 === 1 ? 0 : -1);
  assert.equal(ids[1], '唱片行', `唱片行要夾在中間：${ids.join('→')}`);
  assert.ok(!r.warnings.some((w) => w.ruleId === 'cafe-adjacent'));
});

test('沒有候選也回得出東西；節點預算用完回目前最好的', () => {
  const empty = planDay({ candidates: [], day: day(), home, legFn: flatLeg, rules, settings, country, kb });
  assert.deepEqual(empty.sequence, []);
  assert.ok(empty.warnings.some((w) => w.ruleId === 'meal-slots'));
  const many = Array.from({ length: 11 }, (_, i) => ({ poi: poi(`p${i}`, { category: i % 2 ? 'vintage' : 'shrine', walkFactor: i % 2 ? 0 : 0.5 }), priority: 'maybe' }));
  const r = planDay({ candidates: many, day: day(), home, legFn: flatLeg, rules, settings, country, kb, options: { maxNodes: 500 } });
  assert.ok(r.stats.truncated);
  assert.ok(r.sequence.length > 0);
});

test('placeStop：當天第一站要等開門，就改成晚點出門，不在門口等', () => {
  const x = poi('x', { hours: { thu: [['10:00', '18:00']] } });
  const g = placeStop({ prevEndMin: 9 * 60, leg: { walkMin: 10 }, poi: x, dwellMin: 60, date: '2026-08-13', dayStartMin: 9 * 60, first: true });
  assert.equal(g.waitMin, 0); assert.equal(g.arriveMin, 10 * 60); assert.equal(g.startMin, 10 * 60); assert.equal(g.endMin, 11 * 60);
  // 不是第一站就照舊：到了等
  const h = placeStop({ prevEndMin: 9 * 60, leg: { walkMin: 10 }, poi: x, dwellMin: 60, date: '2026-08-13', dayStartMin: 9 * 60, first: false });
  assert.equal(h.waitMin, 50);
});

test('折返：先去遠的再走回飯店旁的站會罰，引擎改成先近後遠', () => {
  // 飯店—B 10 分；D 就在飯店旁（1 分）；B—D 9 分。飯店→B→D 走回頭路 8 分（×2＝罰 16）；飯店→D→B 不折返。
  const walk = { 'home|B': 10, 'home|D': 1, 'B|D': 9 };
  const legFn = (a, b) => ({ walkMin: walk[`${a.id}|${b.id}`] ?? walk[`${b.id}|${a.id}`] ?? 10, rideMin: 0, climbMin: 0 });
  const cands = [{ poi: poi('B'), priority: 'must' }, { poi: poi('D'), priority: 'want' }];
  const r = planDay({ candidates: cands, day: day(), home, legFn, rules, settings, country, kb, options: { explain: true } });
  assert.deepEqual(r.sequence.map((s) => s.poi.id), ['D', 'B']);
  assert.ok(!r.warnings.some((w) => w.code === 'skipped-missing' && /backtrack/.test(w.ruleId ?? w.msg ?? '')), '折返規則有在跑');
});

test('固定時段的站（花火）：提前量以內是卡位，比它更早到的空等照罰、警告寫「空等」，照排', () => {
  const cands = [
    { poi: poi('神社', { hours: { thu: [['09:00', '12:00']] } }), priority: 'want' },
    { poi: poi('花火', { category: 'event', walkFactor: 0, hours: null, dwellMin: 60 }), priority: 'want', fixedWindow: { startMin: 19 * 60 + 30, arriveEarlyMin: 30 } },
  ];
  const r = planDay({ candidates: cands, day: day(), home, legFn: flatLeg, rules, settings, country, kb });
  const ids = r.sequence.map((s) => s.poi.id);
  assert.deepEqual(ids, ['神社', '花火'], ids.join('→'));
  const fw = r.sequence.find((s) => s.poi.id === '花火');
  assert.equal(fw.startMin, 19 * 60, '提早 30 分到位');
  assert.ok(fw.waitMin > 60, `提早到的空檔算在 waitMin：${fw.waitMin}`);
  assert.ok(r.warnings.some((w) => w.ruleId === 'wait-at-door' && /比卡位時刻還早/.test(w.msg)), '卡位提前量之外的空等照罰（10-13 七天實驗 8/16）');
  assert.deepEqual(r.dropped, []);
});

test('太晚出門（late-departure）：第一站 11:30 才開的店不再把整天推到 11:30 出門，先排 09:00 開的站；只有晚開的店時罰 60 封頂、警告寫幾點出門', () => {
  const lateShop = { poi: poi('晚開的店', { walkFactor: 0, hours: { thu: [['11:30', '23:00']] } }), priority: 'must' };
  const earlyShop = { poi: poi('早開的店', { walkFactor: 0, dwellMin: 90 }), priority: 'want' };
  const r = planDay({ candidates: [lateShop, earlyShop], day: day(), home, legFn: flatLeg, rules, settings, country, kb });
  assert.deepEqual(r.sequence.map((s) => s.poi.id), ['早開的店', '晚開的店'], '沒這條規則時引擎會先去晚開的店、11:30 出門（等開門罰 25 比晚出門罰 0 貴）');
  assert.equal(r.sequence[0].startMin, 9 * 60 + 10);
  assert.ok(!r.warnings.some((w) => w.ruleId === 'late-departure'));
  const only = planDay({ candidates: [lateShop], day: day(), home, legFn: flatLeg, rules, settings, country, kb, options: { explain: true } });
  assert.equal(only.sequence[0].startMin, 11 * 60 + 30);
  const w = only.warnings.find((x) => x.ruleId === 'late-departure');
  assert.ok(w, '太晚出門要有警告');
  assert.match(w.msg, /^今天 11:20 才出門，比預設晚 140 分$/);
  assert.deepEqual(only.breakdown.stops[0].items.filter((i) => i.ruleId === 'late-departure').map((i) => i.minutes), [60]);
});

test('現場改案（day.resumed）從當下接著排：第一個剩下的站等開門算真的在門口等（wait-at-door 罰），不像出門那樣改成晚點出門；late-departure 不罰', () => {
  const late = { poi: poi('晚開的店', { walkFactor: 0, hours: { thu: [['17:00', '23:00']] } }), priority: 'want' };
  const base = { candidates: [late], home, legFn: flatLeg, rules, settings, country, kb };
  const out = planDay({ ...base, day: day({ window: { startMin: 15 * 60, endMin: 24 * 60 } }) });
  assert.equal(out.sequence[0].waitMin, 0, '出門前：改成 16:50 出門，不在門口等');
  const resumed = planDay({ ...base, day: day({ resumed: true, window: { startMin: 15 * 60, endMin: 24 * 60 } }) });
  assert.equal(resumed.sequence[0].arriveMin, 15 * 60 + 10, '15:00 從現在位置走 10 分就到');
  assert.equal(resumed.sequence[0].startMin, 17 * 60);
  assert.equal(resumed.sequence[0].waitMin, 110);
  assert.ok(resumed.warnings.some((w) => w.ruleId === 'wait-at-door'), '在門口等 110 分要被 wait-at-door 罰');
  assert.ok(!resumed.warnings.some((w) => w.ruleId === 'late-departure'));
});

test('落選理由：在某條分支排進去過的站是分數取捨，不拿硬約束那句（例如天黑）當理由', () => {
  // 三站都排得進但只准 2 站：第三站是分數取捨，不是「排不進」
  const cands = [{ poi: poi('A'), priority: 'must' }, { poi: poi('B'), priority: 'want' }, { poi: poi('C'), priority: 'maybe' }];
  const r = planDay({ candidates: cands, day: day(), home, legFn: flatLeg, rules, settings: { ...settings, maxStopsPerDay: 2 }, country, kb });
  assert.equal(r.sequence.length, 2);
  assert.equal(r.dropped.length, 1);
  assert.equal(r.dropped[0].reason, '今天勾了 3 站、上限 2，它排在後面');   // 排進去過＝取捨；勾的比名額多就寫名額那句（10-12 對抗審查）
});

test('落選理由：主題日那一類沒有家數上限，第 5 家被逛店連跑的罰分擋下時寫連跑那句，不寫泛泛的分數取捨（10-14 T25 審查）', () => {
  // 古著主題日、5 家古著、中間沒吃的：排 4 家剛好 4 家／240 分不罰；第 5 家 shop-run 罰 60＋超過 240 分的 60，比 want 的 90 還多，排進去反而低
  const cands = ['V1', 'V2', 'V3', 'V4', 'V5'].map((id) => ({ poi: poi(id, { category: 'vintage', walkFactor: 0 }), priority: 'want' }));
  const r = planDay({ candidates: cands, day: day({ themeCategory: 'vintage' }), home, legFn: flatLeg, rules, settings, country, kb });
  assert.equal(r.sequence.length, 4);
  assert.equal(r.dropped.length, 1);
  assert.equal(r.dropped[0].reason, '主題日不設家數上限，但今天已經連著逛了 4 家店、240 分，中間沒吃點東西或坐一下，它排在後面');
  // 非主題日的書店（不在同類上限那三類、但算逛店連跑）第 5 家同一句、沒有主題日那個前綴
  const books = ['B1', 'B2', 'B3', 'B4', 'B5'].map((id) => ({ poi: poi(id, { category: 'bookstore', walkFactor: 0 }), priority: 'want' }));
  const rb = planDay({ candidates: books, day: day(), home, legFn: flatLeg, rules, settings, country, kb });
  assert.equal(rb.sequence.length, 4);
  assert.equal(rb.dropped[0].reason, '今天已經連著逛了 4 家店、240 分，中間沒吃點東西或坐一下，它排在後面');
  // 中間有吃的（恢復 ≥10 分重置連跑）：5 家都排得進，沒有落選
  const withLunch = [...cands, { poi: poi('午餐', { category: 'food', walkFactor: 0, recovery: true }), priority: 'must' }];
  const rl = planDay({ candidates: withLunch, day: day({ themeCategory: 'vintage' }), home, legFn: flatLeg, rules, settings, country, kb });
  assert.deepEqual(rl.dropped, []);
});

test('坐下來的地方（spot，原話 #172）：排在固定時段前面，等的時間併進它的停留（坐到卡位時刻），花火前不空等；最多 spotFlexMaxMin；重定時刻不會越坐越久', async () => {
  const { retimeSequence } = await import('../../src/engine/sequence.js');
  const seaside = poi('海邊', { category: 'spot', walkFactor: 0, recovery: true, hours: null, dwellMin: 30, daylightOnly: false });
  const cands = [
    { poi: poi('神社', { hours: { thu: [['09:00', '12:00']] } }), priority: 'want' },
    { poi: seaside, priority: 'rest', optional: true, insertedBy: 'engine', dwellMin: 30 },
    { poi: poi('花火', { category: 'event', walkFactor: 0, hours: null, dwellMin: 60 }), priority: 'must', fixedWindow: { startMin: 13 * 60 + 30, arriveEarlyMin: 30 } },
  ];
  const r = planDay({ candidates: cands, day: day(), home, legFn: flatLeg, rules, settings, country, kb });
  const ids = r.sequence.map((s) => s.poi.id);
  assert.deepEqual(ids, ['神社', '海邊', '花火'], ids.join('→'));
  const sea = r.sequence[1]; const fw = r.sequence[2];
  assert.equal(fw.waitMin, 0, '花火前不空等：時間坐在海邊');
  assert.equal(sea.endMin + 10, fw.startMin, '海邊坐到走過去剛好卡位');
  assert.ok(sea.flexedMin > 0 && sea.dwellMin === 30 + sea.flexedMin, `併進去的分鐘記在 flexedMin：${sea.flexedMin}`);
  assert.ok(!r.warnings.some((w) => w.ruleId === 'wait-at-door'), '沒有等開門警告');
  // 最多 spotFlexMaxMin：等 200 分只坐掉 120，剩下照罰
  const a = absorbIntoSpot({ poi: seaside, endMin: 600, dwellMin: 30, fixedWindow: null }, { arriveMin: 610, startMin: 810, waitMin: 200, endMin: 870 }, { spotFlexMaxMin: 120 });
  assert.equal(a.prev.endMin, 720); assert.equal(a.prev.flexedMin, 120); assert.equal(a.placed.waitMin, 80); assert.equal(a.placed.arriveMin, 730);
  assert.equal(absorbIntoSpot({ poi: poi('店'), endMin: 600, dwellMin: 30 }, { arriveMin: 610, startMin: 700, waitMin: 90, endMin: 760 }, settings).placed.waitMin, 90, '不是坐下來的地方就不併');
  // 重定時刻：併過的停留先扣掉再算，重定兩次結果一樣
  const once = retimeSequence({ sequence: r.sequence, day: day(), home, legFn: flatLeg, settings, country, kb });
  const twice = retimeSequence({ sequence: once, day: day(), home, legFn: flatLeg, settings, country, kb });
  // 白天站：最晚坐到日落−30（spotLatestEnd）；位置不明或不是白天站就不設限
  const lit = { ...seaside, daylightOnly: true, lat: 38.37, lng: 141.06 };
  const latest = absorbIntoSpotLatest({ poi: lit, startMin: 16 * 60, day: day(), settings, country: { ...country, utcOffsetMin: 540 }, kb });
  assert.ok(latest > 17 * 60 && latest < 19 * 60, `8/13 松島日落前 30 分應落在 17–19 點之間：${latest}`);
  assert.equal(absorbIntoSpotLatest({ poi: seaside, startMin: 16 * 60, day: day(), settings, country, kb }), day().window.endMin, '不是白天站、沒時段：只受當天收工限制');
  assert.deepEqual(once.map((s) => [s.startMin, s.endMin, s.waitMin, s.flexedMin ?? 0]), r.sequence.map((s) => [s.startMin, s.endMin, s.waitMin, s.flexedMin ?? 0]));
  assert.deepEqual(twice.map((s) => [s.startMin, s.endMin, s.waitMin, s.flexedMin ?? 0]), once.map((s) => [s.startMin, s.endMin, s.waitMin, s.flexedMin ?? 0]));
});
