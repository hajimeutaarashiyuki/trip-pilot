// 這家店能當哪一餐、這一站是哪一餐（rules/_slots.js；11-06 第二批，原話 #195「早中晚餐的換一間 應該要推薦對應餐廳吧 怎麼會爐端燒的換一間 推薦我咖啡廳 這可以當晚餐嗎 如果可以那也應該在簡介裡提及」）。
// 全引擎只有這一把尺：規則 meal-slots（test/rules/day-rules.test.js）、分配器（test/engine/allocate.test.js）、換一家（test/engine/swap.test.js）、plan.meals（test/engine/trip.test.js）都讀它。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stop, ctx, run, warnOf, country, settings, rules, kb } from './_fixtures.js';
import { servesMeal, mealNoteOf, hasMealsField, mealAssignments, missingMeals, planMealsOf, mealOfStop, unmetMeals, MEAL_KEYS, MEAL_NAMES, MAIN_MEALS, breakfastSlotOf, breakfastOffOf, breakfastMissing, breakfastHints, BREAKFAST_OFF_MODES } from '../../src/rules/_slots.js';
import { normalizePoi } from '../../src/data/schema.js';
import { evaluateDay } from '../../src/engine/evaluate.js';
import { emptyAcc } from '../../src/engine/dims.js';
import mealTable from '../../src/derive/meals.json' with { type: 'json' };
import rulesJson from '../../src/rules.json' with { type: 'json' };

const poi = (category, over = {}) => ({ id: over.id ?? category, name_zh: over.id ?? category, category, recovery: true, ...over });
const three = (p) => MEAL_KEYS.map((k) => servesMeal(p, k));
const at = (h, m = 0) => h * 60 + m;
const food = (name, startMin, dwellMin = 60, over = {}) => stop(name, { category: 'food', walkFactor: 0, recovery: true, startMin, dwellMin, ...over });
const JP3 = { ...country, mealSlots: { breakfast: ['07:00', '10:00'], ...country.mealSlots } };   // 國家層多了早餐段的樣子（日本值由文件段寫進 kb/country/jp.json）

test('三餐的鍵與名字：breakfast／lunch／dinner（derive/meals.json 的 slots）；規則管的是午餐、晚餐', () => {
  assert.deepEqual([...MEAL_KEYS], ['breakfast', 'lunch', 'dinner']);
  assert.deepEqual(mealTable.slots, ['breakfast', 'lunch', 'dinner']);
  assert.deepEqual(MEAL_KEYS.map((k) => MEAL_NAMES[k]), ['早餐', '午餐', '晚餐']);
  assert.deepEqual([...MAIN_MEALS], ['lunch', 'dinner']);
});

test('servesMeal 照知識庫欄位 meals：值 true 或一句說明＝能，沒列的那一餐＝不能，{}＝三餐都不能；有欄位就不再看店型與舊旗標', () => {
  const evian = poi('cafe', { meals: { breakfast: 'モーニング 7:30–11:00，厚片吐司套餐', lunch: true } });
  assert.deepEqual(three(evian), ['モーニング 7:30–11:00，厚片吐司套餐', true, false], '例子照主控給的規格');
  assert.equal(mealNoteOf(evian, 'breakfast'), 'モーニング 7:30–11:00，厚片吐司套餐');
  assert.equal(mealNoteOf(evian, 'lunch'), null, 'true 沒有另外的說明');
  assert.equal(mealNoteOf(evian, 'dinner'), null);
  assert.deepEqual(three(poi('food', { meals: {} })), [false, false, false], '吃的類標 {}（車站商場、甜點攤）：不是吃正餐的地方');
  assert.deepEqual(three(poi('cafe', { meals: {}, meal: true })), [false, false, false], '有欄位就照欄位，舊旗標 meal 不再看');
  assert.deepEqual(three(poi('shrine', { recovery: false, meals: { dinner: '境內的蕎麥麵店' } })), [false, false, '境內的蕎麥麵店'], '不看店型、不看是不是恢復站');
  assert.equal(servesMeal(poi('food', { meals: { dinner: '  晚場只開 18:00–20:00  ' } }), 'dinner'), '晚場只開 18:00–20:00', '說明去頭尾空白');
  // 看不懂的值當不能（normalizePoi 會記警告 meals-bad）；看不懂的鍵不理
  assert.deepEqual(three(poi('food', { meals: { lunch: false, dinner: '', breakfast: 1, diner: true } })), [false, false, false]);
  assert.equal(servesMeal(poi('food', { meals: { lunch: true } }), 'supper'), false, '不認得的餐');
  assert.equal(servesMeal(null, 'lunch'), false);
  assert.equal(servesMeal(undefined, 'lunch'), false);
});

test('整個欄位沒有才照店型推導：吃的類（甜點除外）午餐晚餐；酒吧只有酒場型、坐下來吃喝的算晚餐（立飲、喝酒為主的不算）；咖啡廳與其他店型都不算；推導不給早餐', () => {
  assert.deepEqual(three(poi('food')), [false, true, true]);
  assert.deepEqual(three(poi('food', { categoryMatched: '牛たん', categoryRaw: '牛たん専門店' })), [false, true, true]);
  assert.deepEqual(three(poi('food', { categoryMatched: '甜點', categoryRaw: '甜點（仙台名物）' })), [false, false, false], '甜點攤可以當一站、不算一餐');
  assert.deepEqual(three(poi('food', { categoryMatched: '市場早餐', categoryRaw: '市場早餐' })), [false, true, true], '早餐不推導：要研究標 meals.breakfast');
  assert.deepEqual(three(poi('food', { recovery: false })), [false, false, false], '不是恢復站（外帶、邊走邊吃）不算');
  assert.deepEqual(three(poi('cafe', { categoryRaw: '昭和純喫茶（地下室洋食喫茶）' })), [false, false, false], '咖啡廳不再自動算一餐');
  // 酒吧：看店型原文（研究寫的那句）
  const note = mealTable.byCategory.bar.note;
  assert.ok(typeof note === 'string' && note.length > 0 && !/bar|food|dinner/i.test(note), '推導出來的那句是給他看的中文');
  const bar = (categoryRaw, over = {}) => poi('bar', { categoryRaw, ...over });
  assert.deepEqual(three(bar('居酒屋（發源店）／夜生活')), [false, false, note], '爐端燒發源的居酒屋');
  assert.equal(servesMeal(bar('橫丁酒場（はしご酒）'), 'dinner'), note);
  assert.equal(servesMeal(bar('爐端燒'), 'dinner'), note);
  assert.equal(servesMeal(bar('日本酒バー（めし＆地酒，夫婦二人經營）'), 'dinner'), note, '店型原文寫了めし（飯）');
  assert.equal(servesMeal(bar('立飲酒場（15 席全站立）'), 'dinner'), false, '立飲不是坐下來吃喝的');
  assert.equal(servesMeal(bar('日本酒バー（店主逐支選的全國日本酒）'), 'dinner'), false, '喝酒為主的吧台');
  assert.equal(servesMeal(bar('黑膠 bar（客人點播）'), 'dinner'), false);
  assert.equal(servesMeal(poi('bar'), 'dinner'), false, '沒有店型原文（手寫的站只給店型鍵）判不出來，不算');
  assert.equal(servesMeal(bar('居酒屋', { recovery: false }), 'dinner'), false);
  assert.equal(servesMeal(bar('居酒屋'), 'lunch'), false, '酒場型只推導晚餐');
  // 舊旗標 meal: true（祭典的縁日攤位，原話 #172）照舊算午餐、晚餐，不看店型與恢復站
  assert.deepEqual(three(poi('event', { recovery: false, meal: true })), [false, true, true]);
  for (const cat of ['shrine', 'vintage', 'store', 'market', 'brewery', 'onsen', 'spot']) assert.deepEqual(three(poi(cat)), [false, false, false], cat);
  // null、形狀不對的 meals 都當沒寫、走推導
  for (const bad of [null, undefined, true, 'dinner', ['lunch'], 3]) {
    assert.equal(hasMealsField({ meals: bad }), false, JSON.stringify(bad));
    assert.deepEqual(three(poi('food', { meals: bad })), [false, true, true], JSON.stringify(bad));
  }
  assert.equal(hasMealsField({ meals: {} }), true);
  assert.equal(hasMealsField(null), false);
});

test('真的知識庫那種寫法經過 normalizePoi 之後推導得出來（店型原文與命中的關鍵字是 normalizePoi 留下的）', () => {
  const n = (raw) => normalizePoi({ name_local: raw.name_zh, area: 'x', hours: '17:00-23:00', maps_query: 'x', ...raw }).poi;
  const robata = n({ name_zh: '鄉土酒亭 元祖 爐端', category: '居酒屋（發源店）／夜生活' });
  assert.deepEqual([robata.category, robata.categoryMatched, servesMeal(robata, 'dinner') !== false, servesMeal(robata, 'lunch')], ['bar', '居酒屋', true, false]);
  const ten = n({ name_zh: 'たちのみ てん.', category: '立飲酒場（15 席全站立；日本酒非主軸）' });
  assert.deepEqual([ten.category, ten.categoryMatched, servesMeal(ten, 'dinner')], ['bar', '酒場', false], '命中的關鍵字是「酒場」，但店型原文寫立飲');
  const zunda = n({ name_zh: 'ずんだ茶寮', category: '甜點（仙台名物）' });
  assert.deepEqual([zunda.category, servesMeal(zunda, 'lunch')], ['food', false]);
  const elbe = n({ name_zh: '喫茶 Elbe', category: '昭和純喫茶（1977年創業，地下室洋食喫茶）' });
  assert.deepEqual([elbe.category, servesMeal(elbe, 'lunch'), servesMeal(elbe, 'dinner')], ['cafe', false, false]);
  const marked = n({ name_zh: '喫茶 Elbe', category: '昭和純喫茶', meals: { lunch: '鹽味義大利麵、拿坡里、蛋包飯', dinner: '同午餐，晚間另收 350 円' } });
  assert.equal(servesMeal(marked, 'dinner'), '同午餐，晚間另收 350 円');
});

test('servesMeal 的答案跟著資料走：事後改了 meals、meal、店型原文，下一次問就是新的（同一個 poi 物件有快取）', () => {
  const p = poi('bar', { categoryRaw: '日本酒バー' });
  assert.equal(servesMeal(p, 'dinner'), false);
  p.categoryRaw = '居酒屋';
  assert.notEqual(servesMeal(p, 'dinner'), false);
  p.meals = {};
  assert.equal(servesMeal(p, 'dinner'), false);
  p.meals = { dinner: true };
  assert.equal(servesMeal(p, 'dinner'), true);
  delete p.meals; p.recovery = false;
  assert.equal(servesMeal(p, 'dinner'), false);
  const e = poi('event', { recovery: false });
  assert.equal(servesMeal(e, 'dinner'), false);
  e.meal = true;
  assert.equal(servesMeal(e, 'dinner'), true);
});

test('mealAssignments：每一餐配到哪一站——那家店能當那一餐、落在放寬後的時窗、每站最多算一餐；缺的在 missing、不需要的在 notNeeded', () => {
  const lunch = food('一隆', at(11, 40), 65);
  const cafe = stop('Elbe', { category: 'cafe', walkFactor: 0, recovery: true, startMin: at(12, 56), dwellMin: 60 });   // 沒標：不是哪一餐
  const izakaya = stop('汐谷', { category: 'bar', walkFactor: 0, recovery: true, startMin: at(17), dwellMin: 90, categoryRaw: '日本酒バー（めし＆地酒）' });
  const a = mealAssignments({ sequence: [lunch, cafe, izakaya], day: { windowRaw: { startMin: 540, endMin: 1440 } }, settings, country });
  assert.deepEqual(a.meals, { lunch: '一隆', dinner: '汐谷' });
  assert.equal(a.stops.lunch, lunch); assert.equal(a.stops.dinner, izakaya);
  assert.deepEqual(a.missing, []); assert.deepEqual(a.notNeeded, {});
  assert.equal(mealOfStop(a.meals, '汐谷'), 'dinner');
  assert.equal(mealOfStop(a.meals, 'Elbe'), null, '下午的咖啡不是哪一餐');
  assert.equal(mealOfStop(null, '汐谷'), null);
  assert.deepEqual(planMealsOf({ sequence: [lunch, cafe, izakaya], day: {}, settings, country }), { breakfast: null, lunch: '一隆', dinner: '汐谷' }, 'plan.meals 三個鍵都在');
  // 只有咖啡廳與黑膠 bar：兩餐都缺
  const banzai = stop('バンザイ', { category: 'bar', walkFactor: 0, recovery: true, startMin: at(18), dwellMin: 90, categoryRaw: '黑膠 bar' });
  const none = mealAssignments({ sequence: [{ ...cafe, startMin: at(12), endMin: at(13) }, banzai], day: {}, settings, country });
  assert.deepEqual(none.meals, { lunch: null, dinner: null });
  assert.deepEqual(none.missing, ['lunch', 'dinner']);
  // 這天不需要的餐：時窗外（抵達日傍晚才開始）、被固定時段蓋住（研討會供餐）
  const arrival = mealAssignments({ sequence: [izakaya], day: { windowRaw: { startMin: at(17, 30), endMin: 1440 } }, settings, country });
  assert.deepEqual([arrival.meals, arrival.missing, arrival.notNeeded], [{ lunch: null, dinner: '汐谷' }, [], { lunch: 'window' }]);
  const venue = stop('會場', { category: 'venue', walkFactor: 0, startMin: at(8, 50), dwellMin: 670, fixedWindow: { startMin: at(9, 30), endMin: at(19, 30), arriveEarlyMin: 40, afterMin: 30 } });
  const fixed = mealAssignments({ sequence: [venue], day: {}, settings, country });
  assert.deepEqual([fixed.meals, fixed.missing, fixed.notNeeded], [{ lunch: null, dinner: null }, [], { lunch: 'covered', dinner: 'covered' }]);
  // 引擎插的站（恢復站、填站、順路站）不算哪一餐
  const inserted = mealAssignments({ sequence: [food('引擎插的', at(12), 60, { insertedBy: 'engine', priority: 'filler' })], day: {}, settings, country });
  assert.deepEqual(inserted.missing, ['lunch', 'dinner']);
  // 沒有國家層餐段：沒有三餐這回事
  assert.deepEqual(mealAssignments({ sequence: [lunch], day: {}, settings, country: null }), { meals: {}, stops: {}, missing: [], notNeeded: {} });
  assert.deepEqual(planMealsOf({ sequence: [lunch], day: {}, settings, country: null }), { breakfast: null, lunch: null, dinner: null });
  assert.deepEqual(mealAssignments(), { meals: {}, stops: {}, missing: [], notNeeded: {} }, '什麼都不給也不丟錯');
});

test('配站：一站只算一餐；同一餐有幾站可配時挑跟原本的餐段重疊最多的；後面那一餐沒別的站可配時，前面那餐讓出來改配別站', () => {
  const day = {};
  // 14:00–17:20 的一頓：午餐、晚餐的時窗都碰到，只算午餐，晚餐缺
  const long = food('吃很久', at(14), 200);
  assert.deepEqual(mealAssignments({ sequence: [long], day, settings, country }).meals, { lunch: '吃很久', dinner: null });
  // 再來一家同時段的：一家午餐、一家晚餐
  const long2 = food('另一家', at(14, 10), 200);
  const both = mealAssignments({ sequence: [long, long2], day, settings, country });
  assert.deepEqual(Object.values(both.meals).sort(), ['另一家', '吃很久']);
  assert.deepEqual(both.missing, []);
  // 10:40 的朝市（能當午餐、只碰到放寬後的時窗）與 11:30 的牛舌：午餐是牛舌那一站
  const market = food('朝市', at(10, 10), 60);   // 10:10–11:10
  const tongue = food('牛舌', at(11, 30), 60);
  assert.equal(mealAssignments({ sequence: [market, tongue], day, settings, country }).meals.lunch, '牛舌');
  // 重疊一樣多照序列先後
  const twinA = food('甲', at(11, 30), 60); const twinB = food('乙', at(12, 30), 60);
  assert.equal(mealAssignments({ sequence: [twinA, twinB], day, settings, country }).meals.lunch, '甲');
  // 午餐偏好的那一站也是晚餐唯一的候選：午餐改配另一站，晚餐才有著落（放寬量 240 分讓兩個時窗疊在一起）
  const wide = { ...settings, mealGraceMin: 240 };
  const noonBest = food('正中午', at(11, 30), 120);   // 跟午餐段重疊 120
  const early = food('早一點', at(8), 30);            // 午餐時窗（07:30–17:30）裡、晚餐時窗（14:00–24:30）外
  const r = mealAssignments({ sequence: [early, { ...noonBest, startMin: at(13), endMin: at(15) }], day, settings: wide, country });
  assert.deepEqual(r.meals, { lunch: '早一點', dinner: '正中午' }, '13:00–15:00 那一站午晚都碰得到，讓給晚餐');
});

test('早餐段（國家層 mealSlots 有 breakfast 才有；細節由早餐那一段做）：尺認得它，配站時午餐晚餐先配、早餐配剩下的；規則 meal-slots 仍然只管午餐與晚餐', () => {
  const day = { windowRaw: { startMin: 540, endMin: 1440 } };
  const morning = stop('Cafe de 埃比昂', { category: 'cafe', walkFactor: 0, recovery: true, startMin: at(9, 5), dwellMin: 45, meals: { breakfast: 'モーニング 7:30–11:00', lunch: '拿坡里義大利麵套餐' } });
  const lunch = food('一隆', at(11, 40), 65);
  const dinner = food('髙也', at(18), 70);
  const a = mealAssignments({ sequence: [morning, lunch, dinner], day, settings, country: JP3 });
  assert.deepEqual(a.meals, { breakfast: 'Cafe de 埃比昂', lunch: '一隆', dinner: '髙也' });
  assert.deepEqual(a.missing, []);
  // 沒有能當早餐的站：missing 有 breakfast，但規則不罰（只管午餐晚餐）
  const noBreakfast = mealAssignments({ sequence: [lunch, dinner], day, settings, country: JP3 });
  assert.deepEqual(noBreakfast.missing, ['breakfast']);
  assert.equal(run('meal-slots', ctx(null, { sequence: [lunch, dinner], country: JP3 })), 0, '缺早餐不是黃字');
  assert.deepEqual(missingMeals({ sequence: [lunch, dinner], day, settings, country: JP3 }, MAIN_MEALS), []);
  assert.deepEqual(missingMeals({ sequence: [], day, settings, country: JP3 }), ['breakfast', 'lunch', 'dinner'], '照時間排');
  // 早午餐一站兩用時午餐優先：10:40–11:40 的那一站早餐、午餐都算得了，又沒有別的午餐 → 它是午餐、早餐缺
  const brunch = stop('早午餐', { category: 'cafe', walkFactor: 0, recovery: true, startMin: at(10, 40), dwellMin: 60, meals: { breakfast: '早午餐盤', lunch: '早午餐盤' } });
  const b = mealAssignments({ sequence: [brunch, dinner], day, settings, country: JP3 });
  assert.deepEqual([b.meals, b.missing], [{ breakfast: null, lunch: '早午餐', dinner: '髙也' }, ['breakfast']]);
  // 國家層多了早餐段，午餐晚餐缺不缺的答案不變
  for (const seq of [[morning], [brunch], [morning, lunch], [lunch, dinner], [brunch, dinner], []]) {
    assert.deepEqual(missingMeals({ sequence: seq, day, settings, country: JP3 }, MAIN_MEALS), missingMeals({ sequence: seq, day, settings, country }, MAIN_MEALS), seq.map((s) => s.poi.id).join('、'));
  }
  // 時窗 11:00 才開始的日子（晚出門日）不需要早餐
  assert.deepEqual(mealAssignments({ sequence: [lunch, dinner], day: { windowRaw: { startMin: at(11), endMin: 1440 } }, settings, country: JP3 }).notNeeded, { breakfast: 'window' });
  // 引擎替他排的早餐（priority 'breakfast'）算早餐、只算早餐；別種引擎插的站照舊不算
  const engineBreakfast = stop('朝市食堂', { category: 'food', walkFactor: 0, recovery: true, startMin: at(9, 5), dwellMin: 45, meals: { breakfast: '海鮮丼', lunch: '海鮮丼' }, insertedBy: 'engine', priority: 'breakfast' });
  assert.deepEqual(mealAssignments({ sequence: [engineBreakfast], day, settings, country: JP3 }).meals, { breakfast: '朝市食堂', lunch: null, dinner: null });
  const filler = { ...engineBreakfast, priority: 'filler' };
  assert.deepEqual(mealAssignments({ sequence: [filler], day, settings, country: JP3 }).meals, { breakfast: null, lunch: null, dinner: null });
});

test('規則 breakfast-slot（原話 #196）：國家層有早餐段、這天要早餐卻沒有站算早餐才罰 10 分（比午餐晚餐的 20 輕）；quiet——不出黃字，「今天沒排早餐」是另外掛的提示；他說這天不排（吃飯店／改天去）不罰不提示', () => {
  const day = { windowRaw: { startMin: 540, endMin: 1440 } };
  const lunch = food('一隆', at(11, 40), 65);
  const morning = stop('朝市食堂', { category: 'food', walkFactor: 0, recovery: true, startMin: at(9, 5), dwellMin: 40, meals: { breakfast: '海鮮丼' } });
  const rule = rules.byId.get('breakfast-slot');
  assert.deepEqual([rule.kind, rule.scope, rule.quiet, rule.params.missMin, rule.weight], ['soft', 'day', true, 10, 1]);
  assert.equal(rulesJson.rules['breakfast-slot'].missMin, 10);
  assert.equal(warnOf('breakfast-slot', ctx(null, { sequence: [], country: JP3 })), '今天沒排早餐');
  const pen = (sequence, c = JP3, d = day) => run('breakfast-slot', ctx(null, { sequence, country: c, day: d }));
  assert.equal(pen([lunch], country), 0, '國家層沒有早餐段：永遠 0（舊打包檔不受影響）');
  assert.equal(pen([lunch], { ...country, mealSlots: undefined }), 0, '連餐段都沒有的國家層也不出錯');
  assert.equal(pen([lunch]), 10, '要早餐卻沒有');
  assert.equal(pen([morning, lunch]), 0, '他勾的站裡有早餐');
  assert.equal(pen([{ ...morning, insertedBy: 'engine', priority: 'breakfast' }, lunch]), 0, '引擎排的早餐也算');
  assert.equal(pen([{ ...morning, insertedBy: 'engine', priority: 'filler' }, lunch]), 10, '別種引擎插的站不算');
  assert.equal(pen([lunch], JP3, { windowRaw: { startMin: at(11), endMin: 1440 } }), 0, '晚出門日：早餐段不在時窗裡');
  assert.equal(pen([lunch], JP3, { ...day, breakfast: { mode: 'hotel', poiId: null } }), 0, '他說吃飯店早餐');
  assert.equal(pen([lunch], JP3, { ...day, breakfast: { mode: 'later', poiId: '朝市食堂' } }), 0, '他說改天去');
  assert.equal(pen([lunch], JP3, { ...day, breakfast: { mode: 'weird' } }), 10, '看不懂的 mode 當沒寫');
  // 整天評一次：罰分進總分、不出警告（quiet）
  const ev = evaluateDay({ day: { ...day, date: '2026-08-13', type: 'normal' }, sequence: [lunch], acc: emptyAcc(rules.dims), settings, country: JP3, kb }, rules);
  assert.ok(ev.breakdown.some((b) => b.ruleId === 'breakfast-slot' && b.weighted === 10));
  assert.ok(!ev.warnings.some((w) => w.ruleId === 'breakfast-slot'), '不出黃字');
  // 尺：早餐段、他說不排、缺不缺、提示
  assert.deepEqual(breakfastSlotOf(JP3, settings), { slot: 'breakfast', core: [at(7), at(10)], window: [at(6), at(11)] });
  assert.equal(breakfastSlotOf(country, settings), null);
  assert.equal(breakfastSlotOf(null, settings), null);
  assert.deepEqual([...BREAKFAST_OFF_MODES], ['hotel', 'later']);
  assert.deepEqual([breakfastOffOf({ breakfast: { mode: 'hotel' } }), breakfastOffOf({ breakfast: { mode: 'later' } }), breakfastOffOf({ breakfast: { mode: 'x' } }), breakfastOffOf({ breakfast: null }), breakfastOffOf({}), breakfastOffOf(null)], ['hotel', 'later', null, null, null, null]);
  const off = mealAssignments({ sequence: [morning, lunch], day: { ...day, breakfast: { mode: 'hotel', poiId: null } }, settings, country: JP3 });
  assert.deepEqual([off.meals.breakfast, off.notNeeded, off.missing], [null, { breakfast: 'hotel' }, ['dinner']], '他說不排：那天不配早餐、不算缺');
  assert.deepEqual(mealAssignments({ sequence: [lunch], day: { ...day, breakfast: { mode: 'later', poiId: 'x' } }, settings, country: JP3 }).notNeeded, { breakfast: 'later' });
  assert.equal(breakfastMissing({ sequence: [lunch], day, settings, country: JP3 }), true);
  assert.equal(breakfastMissing({ sequence: [morning], day, settings, country: JP3 }), false);
  assert.equal(breakfastMissing({ sequence: [lunch], day, settings, country }), false);
  assert.equal(breakfastMissing(), false);
  assert.deepEqual(breakfastHints({ sequence: [lunch], day, settings, country: JP3 }), [{ ruleId: 'breakfast-slot', code: 'hint', hint: true, msg: '今天沒排早餐' }]);
  assert.deepEqual(breakfastHints({ sequence: [morning, lunch], day, settings, country: JP3 }), []);
  assert.deepEqual(breakfastHints({ sequence: [lunch], day: { ...day, breakfast: { mode: 'hotel', poiId: null } }, settings, country: JP3 }), []);
  assert.deepEqual(breakfastHints({ sequence: [lunch], day, settings, country }), []);
  // 一站最多算一餐：10:40 的朝市丼能當早餐也能當午餐，這天又沒有別的午餐——它被午餐配走，早餐還是缺（罰、提示、plan.meals 三邊要一致）
  const brunch = stop('朝市丼', { category: 'food', walkFactor: 0, recovery: true, startMin: at(10, 40), dwellMin: 40, meals: { breakfast: '海鮮丼', lunch: true } });
  const taken = mealAssignments({ sequence: [brunch], day, settings, country: JP3 });
  assert.deepEqual([taken.meals.lunch, taken.meals.breakfast, taken.missing.includes('breakfast')], ['朝市丼', null, true]);
  assert.equal(breakfastMissing({ sequence: [brunch], day, settings, country: JP3 }), true, '那一站被午餐配走了');
  assert.equal(pen([brunch]), 10);
  assert.equal(breakfastHints({ sequence: [brunch], day, settings, country: JP3 }).length, 1);
  assert.equal(breakfastMissing({ sequence: [brunch, lunch], day, settings, country: JP3 }), false, '另外有午餐：朝市丼就是早餐');
  // 他說不排早餐的日子，午餐晚餐的結果不變
  assert.deepEqual(missingMeals({ sequence: [lunch], day: { ...day, breakfast: { mode: 'hotel', poiId: null } }, settings, country: JP3 }, MAIN_MEALS), missingMeals({ sequence: [lunch], day, settings, country: JP3 }, MAIN_MEALS));
});

test('missingMeals 與 mealAssignments(...).missing 是同一個答案（規則用前者、畫面與報告用後者）：亂數序列逐一比', () => {
  let seed = 20261106;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const pick = (list) => list[Math.floor(rnd() * list.length)];
  const kinds = [
    () => ({ category: 'food' }),
    () => ({ category: 'cafe' }),
    () => ({ category: 'cafe', meals: { breakfast: '早餐套餐', lunch: '午餐套餐' } }),
    () => ({ category: 'bar', categoryRaw: '居酒屋' }),
    () => ({ category: 'bar', categoryRaw: '日本酒バー' }),
    () => ({ category: 'food', meals: { breakfast: '朝市丼', lunch: true } }),
    () => ({ category: 'food', meals: {} }),
    () => ({ category: 'shrine', recovery: false }),
    () => ({ category: 'food', insertedBy: 'engine', priority: 'filler' }),
    () => ({ category: 'venue', recovery: false, fixedWindow: { startMin: 0, endMin: 0 } }),
  ];
  for (let n = 0; n < 400; n++) {
    const len = Math.floor(rnd() * 6);
    const sequence = Array.from({ length: len }, (_, i) => {
      const startMin = 6 * 60 + Math.floor(rnd() * 16 * 12) * 5; const dwellMin = pick([20, 45, 60, 90, 200, 600]);
      return stop(`s${i}`, { walkFactor: 0, recovery: true, startMin, dwellMin, ...pick(kinds)() });
    });
    const day = pick([{}, { windowRaw: { startMin: 540, endMin: 1440 } }, { windowRaw: { startMin: at(17), endMin: 1440 } }, { windowRaw: { startMin: 540, endMin: at(12, 30) } }]);
    const c = pick([country, JP3]);
    const s = { ...settings, mealGraceMin: pick([0, 60, 120, 240]) };
    for (const only of [null, MAIN_MEALS, ['breakfast']]) {
      const full = mealAssignments({ sequence, day, settings: s, country: c }, only);
      assert.deepEqual(missingMeals({ sequence, day, settings: s, country: c }, only), full.missing);
      // 配到的站各不相同、都落在序列裡；沒配到的餐不是 missing 就是 notNeeded
      const ids = Object.values(full.meals).filter(Boolean);
      assert.equal(new Set(ids).size, ids.length, '一站最多算一餐');
      for (const [k, id] of Object.entries(full.meals)) assert.ok(id ? sequence.some((x) => x.poi.id === id) : (full.missing.includes(k) || k in full.notNeeded));
    }
    // 缺不缺早餐（規則 breakfast-slot 罰的、「今天沒排早餐」的提示）跟整套配出來的是同一個答案：一站最多算一餐，
    // 能當早餐也能當午餐的那一站被午餐配走的時候，早餐還是缺（plan.meals.breakfast 是 null 的日子就要有提示）
    assert.equal(breakfastMissing({ sequence, day, settings: s, country: c }), mealAssignments({ sequence, day, settings: s, country: c }).missing.includes('breakfast'), `第 ${n} 組：${sequence.map((x) => `${x.poi.id}@${x.startMin}+${x.dwellMin}`).join(' ')}`);
    // 午餐晚餐的結果不受早餐段影響
    const m2 = mealAssignments({ sequence, day, settings: s, country }, MAIN_MEALS).missing;
    const m3 = mealAssignments({ sequence, day, settings: s, country: JP3 }).missing.filter((k) => k !== 'breakfast');
    assert.deepEqual(m3, m2);
  }
});

test('配法兩條路（兩餐以內直接配、三餐以上走配對）是同一個：兩餐的題目後面多掛一個不相干的第三餐，前兩餐缺不缺不變', () => {
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const pool = ['a', 'b', 'c', 'd'].map((id) => ({ id }));
  const lone = { id: 'z' };
  for (let n = 0; n < 500; n++) {
    const some = () => pool.filter(() => rnd() < 0.4);
    const two = [{ slot: 'lunch', cands: some() }, { slot: 'dinner', cands: some() }];
    const viaThree = unmetMeals([...two, { slot: 'x', cands: [lone] }]);
    assert.deepEqual(viaThree, unmetMeals(two), JSON.stringify(two.map((t) => t.cands.map((c) => c.id))));
  }
});

// ── 11-12 審查後補的（修正段）──

test('祭典會場的攤位把那一餐包了（原話 #172 採的提案；11-12 審查）：主行程是活動、佔著餐段，他又勾了同一區能當那一餐的攤位——那一餐不需要（notNeeded stalls），不管攤位那一站被排在幾點；沒有站可配時才這樣算', () => {
  const day = { windowRaw: { startMin: 540, endMin: 1440 } };
  // 七天包 8/16 的樣子：午餐牛舌 11:30；縁日攤位被引擎排在 13:25（午餐時窗裡）；主行程流灯会 18:30–20:20 佔住晚餐段；回城那一杯是立飲（meals {}）
  const tongue = food('和顔', at(11, 30), 60, { zoneId: 'ichibancho' });
  const stalls = stop('縁日廣場', { category: 'event', walkFactor: 0.5, startMin: at(13, 25), dwellMin: 60, zoneId: 'matsushima', meals: { lunch: '祭典會場的飲食攤位', dinner: '祭典會場的飲食攤位，花火前邊逛邊吃' } });
  const festival = stop('流灯会', { category: 'event', walkFactor: 0, startMin: at(18, 30), dwellMin: 110, zoneId: 'matsushima', isAnchor: true, fixedWindow: { startMin: at(19), arriveEarlyMin: 30 } });
  const standing = stop('てん.', { category: 'bar', walkFactor: 0, recovery: true, startMin: at(21, 3), dwellMin: 30, meals: {} });
  const seq = [tongue, stalls, festival, standing];
  const a = mealAssignments({ sequence: seq, day, settings, country });
  assert.deepEqual([a.meals, a.missing, a.notNeeded], [{ lunch: '和顔', dinner: null }, [], { dinner: 'stalls' }]);
  assert.deepEqual(missingMeals({ sequence: seq, day, settings, country }, MAIN_MEALS), [], '規則 meal-slots 不罰、沒有「今天沒排晚餐」');
  assert.equal(evaluateDay({ day: { ...day, window: day.windowRaw }, sequence: seq, acc: emptyAcc(rules.dims), settings, country, kb }, rules).warnings.some((w) => w.ruleId === 'meal-slots'), false);
  assert.deepEqual(planMealsOf({ sequence: seq, day, settings, country }), { breakfast: null, lunch: '和顔', dinner: null }, 'plan.meals 的晚餐是 null：攤位那一站不改標成晚餐');
  // 舊旗標 meal: true 的攤位（沒有 meals 欄位）一樣算
  const legacy = { ...stalls, poi: { ...stalls.poi, meals: undefined, meal: true } };
  assert.deepEqual(mealAssignments({ sequence: [tongue, legacy, festival, standing], day, settings, country }).notNeeded, { dinner: 'stalls' });
  // 不成立的幾種，都照舊缺晚餐：
  const miss = (list) => mealAssignments({ sequence: list, day, settings, country }).missing;
  assert.deepEqual(miss([tongue, festival, standing]), ['dinner'], '沒勾攤位');
  assert.deepEqual(miss([tongue, stalls, { ...festival, isAnchor: false }, standing]), ['dinner'], '那個活動不是這天的主行程');
  assert.deepEqual(miss([tongue, { ...stalls, poi: { ...stalls.poi, zoneId: 'ichibancho' } }, festival, standing]), ['dinner'], '攤位不在主行程那一區');
  assert.deepEqual(miss([tongue, stalls, { ...festival, startMin: at(14, 30), endMin: at(16, 20) }, standing]), ['dinner'], '主行程沒佔到晚餐的餐段');
  assert.deepEqual(miss([tongue, { ...stalls, poi: { ...stalls.poi, meals: { lunch: '只有午餐' } } }, festival, standing]), ['dinner'], '攤位不能當晚餐');
  assert.deepEqual(miss([tongue, { ...stalls, insertedBy: 'engine', priority: 'filler' }, festival, standing]), ['dinner'], '引擎自己插的攤位不算');
  assert.deepEqual(miss([tongue, { ...stalls, poi: { ...stalls.poi, category: 'food' } }, festival, standing]), ['dinner'], '不是活動類的站（一般的餐廳排在 13:25）不能這樣算');
  // 有站可配就照常配（不走這一條）：攤位排在傍晚、自己落在晚餐時窗
  const evening = mealAssignments({ sequence: [tongue, { ...stalls, startMin: at(17), endMin: at(18) }, festival, standing], day, settings, country });
  assert.deepEqual([evening.meals.dinner, evening.notNeeded], ['縁日廣場', {}]);
  // 午餐同理：主行程（白天的祭典）佔著午餐段、攤位被排在別的時段
  const dayFest = stop('白天的祭典', { category: 'event', walkFactor: 0, startMin: at(11), dwellMin: 180, zoneId: 'matsushima', isAnchor: true });
  const lunchStalls = mealAssignments({ sequence: [{ ...stalls, startMin: at(15), endMin: at(16) }, dayFest, food('晚餐店', at(18), 60)], day, settings, country });
  assert.deepEqual([lunchStalls.missing, lunchStalls.notNeeded], [[], { lunch: 'stalls' }]);
});
