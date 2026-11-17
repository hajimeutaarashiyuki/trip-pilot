// 換這一站：順路、那時段有開；這一站是哪一餐就只列能當那一餐的店（店型不限、帶那一餐的說明），不是哪一餐只列同店型（原話 #195；11-06 第二批）；
// 不是一個地點、研究判可略過、還沒解鎖、挖寶型的不列；換掉的記在 day.swapped 不算落選。
// 11-11 補：餐段的換一家不列活動類的站（除非主行程也是活動、同一區）；那一餐的說明不分店型。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { swapCandidates, swapMealOf, swapGated, mealEventZones, samePlace, applySwap } from '../../src/engine/swap.js';
import { planDay } from '../../src/engine/core.js';
import { planTrip } from '../../src/engine/trip.js';
import { loadRules } from '../../src/rules/index.js';
import { BUILTIN } from '../../src/rules/builtin.js';
import rulesJson from '../../src/rules.json' with { type: 'json' };
import { POIS, HOME, KB, COUNTRY, legFn, DAY_0817, CANDS_0817, demoTrip } from '../sendai/fixture.js';

const rules = loadRules(BUILTIN, rulesJson.rules);
const settings = rulesJson.settings;
const wide = { ...settings, swapDetourMaxMin: 999 };
const names = (list) => list.map((c) => c.poi.name_zh);
const plan0817 = (cands = CANDS_0817) => planDay({ candidates: cands, day: DAY_0817, home: HOME, legFn, rules, settings, country: COUNTRY, kb: KB });
// 知識庫標了「能當哪一餐」的幾家（meals 欄位；示範資料本身還沒標）：洋食喫茶 Elbe 午晚都有正餐、汐谷是有飯的日本酒小店（晚餐）、珈巣多夢是咖啡專門店（{}＝不是吃正餐的地方）
const MEALS = {
  '喫茶 Elbe': { lunch: '鹽味義大利麵、拿坡里、蛋包飯', dinner: '鹽味義大利麵、拿坡里、蛋包飯，晚間另收 350 円' },
  '汐谷': { dinner: '魚料理配日本酒，吃得成一頓晚餐' },
  '文化横丁 小酒場': { dinner: '橫丁小店一家吃一點，煎餃、小菜配地酒' },
  '珈巣多夢': {},
};
const annotated = Object.fromEntries(Object.values(POIS).map((p) => [p.name_zh, MEALS[p.name_zh] ? { ...p, meals: MEALS[p.name_zh] } : p]));
const poolOf = (map) => Object.values(map).map((poi) => ({ poi }));

test('8/17 把 me 換掉：候選是同區順路、當時有開的古著店；換成 SQUAT 後 picks 更新、swapped 有紀錄', () => {
  const plan = plan0817();
  const me = plan.sequence.find((s) => s.poi.id === POIS.me.id);
  assert.ok(me, '夾具裡 me 會被排進去');
  const pool = poolOf(POIS);
  const cands = swapCandidates({ plan, stopId: POIS.me.id, pool, legFn, date: DAY_0817.date, settings });
  assert.ok(cands.length >= 1 && cands.every((c) => c.poi.category === 'vintage'), `要是同類型：${names(cands).join('、')}`);
  assert.ok(!names(cands).includes('Utah'), '已經在行程裡的不列');
  assert.ok(!names(cands).includes('星山珈琲店'), '不同類型不列');
  assert.ok(cands.every((c) => c.detourMin <= (settings.swapDetourMaxMin ?? 10)), '預設門檻內');
  assert.ok(cands.every((c) => c.meal === null && c.mealNote === null), '古著店不是哪一餐：meal、mealNote 都是 null');
  // 門檻放到夠寬：列出來的還是只有沒排進去的同類店；縮到比最小繞路還小：一家都不列（不綁死順序，引擎改排法測試也成立）
  const more = swapCandidates({ plan, stopId: POIS.me.id, pool, legFn, date: DAY_0817.date, settings: wide });
  assert.ok(more.length >= cands.length && more.every((c) => c.poi.category === 'vintage' && !plan.sequence.some((s) => s.poi.id === c.poi.id)), '放寬後仍是沒排進的古著店');
  const minDetour = Math.min(...more.map((c) => c.detourMin));
  const narrow = swapCandidates({ plan, stopId: POIS.me.id, pool, legFn, date: DAY_0817.date, settings: { ...settings, swapDetourMaxMin: minDetour - 1 } });
  assert.equal(narrow.length, 0, '門檻比最小繞路還小就沒有候選');
  const day = applySwap({ date: DAY_0817.date, picks: CANDS_0817.map((c) => ({ poiId: c.poi.id, priority: c.priority })) }, POIS.me.id, POIS.SQUAT);
  assert.ok(day.picks.some((p) => p.poiId === POIS.SQUAT.id) && !day.picks.some((p) => p.poiId === POIS.me.id));
  assert.equal(day.swapped[0].from, POIS.me.id);
});

test('午餐的站按換一家只列能當午餐的店（原話 #195「早中晚餐的換一間 應該要推薦對應餐廳吧」）：食堂列；沒標的咖啡廳、酒吧不列；知識庫標了能當午餐的咖啡廳列出來、帶那一餐的說明', () => {
  const plan = plan0817();
  const base = { plan, stopId: POIS['おやま'].id, legFn, date: DAY_0817.date, settings: wide, day: DAY_0817, country: COUNTRY };
  assert.equal(swapMealOf(base), 'lunch', 'おやま 11:30 是這天的午餐');
  // 示範資料沒有 meals 欄位、走店型推導：吃的類算午餐晚餐，咖啡廳都不算、酒吧只有酒場型的算晚餐
  const derived = swapCandidates({ ...base, pool: poolOf(POIS) });
  assert.deepEqual(names(derived), ['たん焼き一隆'], '以前會列星山珈琲店、喫茶 Elbe 這些咖啡廳');
  assert.deepEqual(derived.map((c) => [c.meal, c.mealNote]), [['lunch', null]], '吃的類本來就是正餐，沒有另外的說明');
  // 知識庫標了 meals：Elbe 有午餐（帶說明）；汐谷只有晚餐、珈巣多夢 {}、沒標的咖啡廳都不列
  const list = swapCandidates({ ...base, pool: poolOf(annotated) });
  assert.deepEqual(names(list).sort(), ['たん焼き一隆', '喫茶 Elbe'].sort());
  assert.equal(list.find((c) => c.poi.name_zh === '喫茶 Elbe').mealNote, '鹽味義大利麵、拿坡里、蛋包飯', '不是吃的類要帶說明（原話 #195「如果可以那也應該在簡介裡提及」）');
  assert.ok(list.every((c) => c.meal === 'lunch'));
});

test('晚餐的站按換一家只列能當晚餐的店：店型不限（食堂、標了晚餐的喫茶與酒場），那時段沒開的、已經在行程裡的不列；爐端燒不會再換成沒標的咖啡廳', () => {
  // 把 8/17 的小酒場換成標了晚餐的那一份去排，它就是那天的晚餐
  const cands = CANDS_0817.map((c) => (c.poi.name_zh === '文化横丁 小酒場' ? { ...c, poi: annotated['文化横丁 小酒場'] } : c));
  const plan = plan0817(cands);
  const izakaya = plan.sequence.find((s) => s.poi.name_zh === '文化横丁 小酒場');
  assert.ok(izakaya && izakaya.startMin >= 17 * 60, '小酒場排在傍晚以後');
  const base = { plan, stopId: izakaya.poi.id, pool: poolOf(annotated), legFn, date: DAY_0817.date, settings: wide, day: DAY_0817, country: COUNTRY };
  assert.equal(swapMealOf(base), 'dinner');
  const list = swapCandidates(base);
  assert.deepEqual(names(list).sort(), ['たん焼き一隆', '喫茶 Elbe', '汐谷'].sort(), 'おやま、バンザイ 已經在行程裡；星山珈琲店、火星の庭、珈巣多夢 不能當晚餐');
  assert.deepEqual(Object.fromEntries(list.map((c) => [c.poi.name_zh, c.mealNote])), { 'たん焼き一隆': null, '喫茶 Elbe': MEALS['喫茶 Elbe'].dinner, '汐谷': MEALS['汐谷'].dinner });
  assert.ok(list.every((c) => c.meal === 'dinner'));
  assert.deepEqual(names(list.filter((c) => c.poi.category === 'cafe')), ['喫茶 Elbe'], '咖啡廳只有標了晚餐的那一家');
  // 呼叫端直接指定是哪一餐（現場頁自己知道時）：結果一樣；指定 null＝當作不是哪一餐、只列同店型
  assert.deepEqual(names(swapCandidates({ ...base, day: undefined, country: undefined, meal: 'dinner' })).sort(), names(list).sort());
  const same = swapCandidates({ ...base, meal: null });
  assert.ok(same.length > 0 && same.every((c) => c.poi.category === 'bar' && c.meal === null && c.mealNote === null), `只列酒吧：${names(same).join('、')}`);
});

test('那一餐的說明不分店型（11-11）：吃的店在知識庫 meals 寫的是一句話（「晚場只開兩小時」這種限制）也帶出來；那一餐只寫 true 的沒有說明', () => {
  const cands = CANDS_0817.map((c) => (c.poi.name_zh === '文化横丁 小酒場' ? { ...c, poi: annotated['文化横丁 小酒場'] } : c));
  const plan = plan0817(cands);
  const izakaya = plan.sequence.find((s) => s.poi.name_zh === '文化横丁 小酒場');
  const limit = '晚場只開 18:00–20:00，週三、五與假日晚上不開';
  const pool = poolOf({ ...annotated, 'たん焼き一隆': { ...POIS['たん焼き一隆'], meals: { lunch: true, dinner: limit } } });
  const base = { plan, pool, legFn, date: DAY_0817.date, settings: wide, day: DAY_0817, country: COUNTRY };
  const noteOf = (list) => list.find((c) => c.poi.name_zh === 'たん焼き一隆')?.mealNote;
  const dinner = swapCandidates({ ...base, stopId: izakaya.poi.id });
  assert.equal(dinner.find((c) => c.poi.name_zh === 'たん焼き一隆').poi.category, 'food');
  assert.equal(noteOf(dinner), limit, '吃的店晚餐寫的是一句限制：照樣帶出來');
  const lunch = swapCandidates({ ...base, stopId: POIS['おやま'].id });
  assert.ok(names(lunch).includes('たん焼き一隆'));
  assert.equal(noteOf(lunch), null, '午餐只寫 true：沒有說明');
});

test('餐段的換一家不列活動類的站（祭典攤位只有那幾天有；11-11），除非這天的主行程也是活動、而且在同一區——比照分配器「活動只跟著主行程也是活動的那天」', () => {
  // 縁日攤位：活動類、知識庫標了能當午餐晚餐、營業時間天天有開（知識庫的活動常解析成這樣）、跟小酒場同一區
  const stall = { ...POIS['文化横丁 小酒場'], id: 'ennichi', name_zh: '縁日攤位', name_local: 'ennichi', category: 'event', meals: { lunch: '祭典會場的飲食攤位', dinner: '祭典會場的飲食攤位，花火前邊逛邊吃' } };
  const cands = CANDS_0817.map((c) => (c.poi.name_zh === '文化横丁 小酒場' ? { ...c, poi: annotated['文化横丁 小酒場'] } : c));
  const plan = plan0817(cands);
  const izakaya = plan.sequence.find((s) => s.poi.name_zh === '文化横丁 小酒場');
  const pool = poolOf({ ...annotated, ennichi: stall });
  const base = { plan, stopId: izakaya.poi.id, pool, legFn, date: DAY_0817.date, settings: wide, day: DAY_0817, country: COUNTRY };
  assert.equal(swapMealOf(base), 'dinner');
  // 平常日（主行程是古著店 Utah）：攤位能當晚餐、那時有開、順路，照樣不列；其餘候選不受影響
  assert.deepEqual([...mealEventZones(base)], []);
  const plain = swapCandidates(base);
  assert.deepEqual(names(plain).sort(), ['たん焼き一隆', '喫茶 Elbe', '汐谷'].sort());
  // 主行程也是活動：把序列裡的主行程換成同一區（一番町）的祭典 → 攤位列出來、帶那一餐的說明
  const festival = (zoneId) => ({ ...POIS.Utah, id: 'matsuri', name_zh: '夏祭', name_local: 'matsuri', category: 'event', zoneId });
  const anchoredAt = (zoneId) => ({ ...plan, sequence: plan.sequence.map((s) => (s.isAnchor ? { ...s, poi: festival(zoneId) } : s)) });
  assert.ok(plan.sequence.some((s) => s.isAnchor), '夾具的 8/17 序列裡有主行程');
  assert.deepEqual([...mealEventZones({ ...base, plan: anchoredAt(stall.zoneId) })], [stall.zoneId]);
  const same = swapCandidates({ ...base, plan: anchoredAt(stall.zoneId) });
  assert.equal(same.find((c) => c.poi.id === 'ennichi')?.mealNote, '祭典會場的飲食攤位，花火前邊逛邊吃');
  assert.deepEqual(names(same).filter((n) => n !== '縁日攤位').sort(), names(plain).sort(), '只多了攤位這一家');
  // 主行程是活動、但在別區：不列
  assert.ok(stall.zoneId !== 'honcho');
  assert.ok(!names(swapCandidates({ ...base, plan: anchoredAt('honcho') })).includes('縁日攤位'));
  // 主行程不在序列裡（被擠掉、或現場只剩後半天）：給了 day 就拿 day.anchorPoiId 去 pool 找；沒給 day 認不出來、不列
  const rest = { ...plan, sequence: plan.sequence.filter((s) => !s.isAnchor) };
  const poolWithFestival = [...pool, { poi: festival(stall.zoneId) }];
  const dayOfFestival = { ...DAY_0817, anchorPoiId: 'matsuri' };
  assert.ok(names(swapCandidates({ ...base, plan: rest, pool: poolWithFestival, day: dayOfFestival })).includes('縁日攤位'));
  assert.ok(!names(swapCandidates({ ...base, plan: rest, pool: poolWithFestival, day: undefined, country: undefined, meal: 'dinner' })).includes('縁日攤位'));
  // 只管餐段的換一家：不是哪一餐時照同店型列（這一站自己是活動，就列別的活動）。拿傍晚的バンザイ那一站改成活動來試（攤位 17:00 才開）
  const eventStop = { ...plan, sequence: plan.sequence.map((s) => (s.poi.name_zh === 'バンザイ' ? { ...s, poi: { ...s.poi, id: 'hanabi', name_zh: '花火', category: 'event' } } : s)) };
  const sameType = swapCandidates({ ...base, plan: eventStop, stopId: 'hanabi', meal: null });
  assert.deepEqual(names(sameType), ['縁日攤位']);
  assert.deepEqual(sameType.map((c) => [c.meal, c.mealNote]), [[null, null]]);
});

test('同一處寫成兩筆的不互相推薦（知識庫欄位 samePlace；11-11）：這一站或行程裡別的站指到的、指到它們的另一筆都不列；只有一邊寫也算；沒寫照舊只比 id', () => {
  const plan = plan0817();
  const oyama = POIS['おやま'];
  const twin = (id, over = {}) => ({ ...POIS['たん焼き一隆'], id, name_zh: id, name_local: id, ...over });
  const run = (extra, stopId = oyama.id) => names(swapCandidates({ plan, stopId, pool: poolOf({ ...POIS, ...extra }), legFn, date: DAY_0817.date, settings: wide, day: DAY_0817, country: COUNTRY }));
  assert.deepEqual(run({ a: twin('別館食堂') }).sort(), ['たん焼き一隆', '別館食堂'].sort(), '對照組：沒寫 samePlace 的照列');
  // 候選指到這一站（おやま 的另一筆）：不列
  assert.deepEqual(run({ a: twin('おやま 午餐', { samePlace: oyama.id }) }), ['たん焼き一隆']);
  // 候選指到行程裡別的站（星山珈琲店 那一處的食堂條目）：也不列
  assert.ok(plan.sequence.some((s) => s.poi.id === POIS['星山珈琲店'].id));
  assert.deepEqual(run({ a: twin('星山的午餐', { samePlace: [POIS['星山珈琲店'].id] }) }), ['たん焼き一隆'], '寫成陣列也認');
  // 只有行程裡那一站寫了（指到候選）：一樣不列
  const pointing = { ...plan, sequence: plan.sequence.map((s) => (s.poi.id === oyama.id ? { ...s, poi: { ...s.poi, samePlace: '別館食堂' } } : s)) };
  assert.deepEqual(names(swapCandidates({ plan: pointing, stopId: oyama.id, pool: poolOf({ ...POIS, a: twin('別館食堂') }), legFn, date: DAY_0817.date, settings: wide, day: DAY_0817, country: COUNTRY })), ['たん焼き一隆']);
  // 寫壞的值（不是字串）當沒寫
  assert.deepEqual(run({ a: twin('別館食堂', { samePlace: true }) }).sort(), ['たん焼き一隆', '別館食堂'].sort());
  // 同一處的兩筆都是候選（都不在行程裡）：清單上只留排在前面的那一筆——朝市與朝市商店街不會並排出現
  assert.deepEqual(run({ a: twin('朝市'), b: twin('朝市商店街', { samePlace: '朝市' }) }).sort(), ['たん焼き一隆', '朝市'].sort());
  assert.deepEqual(run({ b: twin('朝市商店街', { samePlace: '朝市' }), a: twin('朝市') }).sort(), ['たん焼き一隆', '朝市商店街'].sort(), '繞路與研究排序都一樣時照 pool 的順序留前面那筆');
  assert.deepEqual(run({ a: twin('朝市', { researchRank: 'backup' }), b: twin('朝市商店街', { samePlace: '朝市' }) }).sort(), ['たん焼き一隆', '朝市商店街'].sort(), '研究排序在前的那筆留下');
  assert.equal(samePlace(oyama, twin('x', { samePlace: oyama.id })), true);
  assert.equal(samePlace(twin('x', { samePlace: oyama.id }), oyama), true, '哪一邊寫都算');
  assert.equal(samePlace(oyama, oyama), true);
  assert.equal(samePlace(oyama, twin('x')), false);
  assert.equal(samePlace(null, oyama), false);
});

test('不是哪一餐的站（下午的咖啡、續攤的酒吧）只列同店型；咖啡廳就算標了能當午餐，這裡也只是咖啡廳、不帶說明', () => {
  const plan = plan0817();
  const hoshiyama = plan.sequence.find((s) => s.poi.name_zh === '星山珈琲店');
  assert.ok(hoshiyama);
  const base = { plan, stopId: hoshiyama.poi.id, pool: poolOf(annotated), legFn, date: DAY_0817.date, settings: wide, day: DAY_0817, country: COUNTRY };
  assert.equal(swapMealOf(base), null);
  const list = swapCandidates(base);
  assert.ok(list.length >= 2 && list.every((c) => c.poi.category === 'cafe'), `下午的咖啡只列咖啡廳：${names(list).join('、')}`);
  assert.ok(names(list).includes('喫茶 Elbe') && names(list).includes('珈巣多夢'), '標 {} 的咖啡專門店照樣是咖啡廳');
  assert.ok(list.every((c) => c.meal === null && c.mealNote === null));
  // 排在傍晚的黑膠 bar 不是晚餐（示範資料沒標、店型推導也不算）：只列酒吧
  const banzai = swapCandidates({ ...base, stopId: POIS['バンザイ'].id, pool: poolOf(POIS) });
  assert.ok(banzai.length > 0 && banzai.every((c) => c.poi.category === 'bar'), names(banzai).join('、'));
});

test('這一站是哪一餐：給了 country 當場算；沒給讀 plan.meals（planTrip 排完掛的）；兩個都沒有就當不是哪一餐', () => {
  const plan = plan0817();
  const id = POIS['おやま'].id;
  assert.equal(plan.meals, undefined, 'planDay 直接排的沒有 meals');
  assert.equal(swapMealOf({ plan, stopId: id }), null);
  const blind = swapCandidates({ plan, stopId: id, pool: poolOf(annotated), legFn, date: DAY_0817.date, settings: wide });
  assert.ok(blind.length > 0 && blind.every((c) => c.poi.category === 'food' && c.meal === null), '不知道是哪一餐：只列同店型，咖啡廳照樣不列');
  assert.equal(swapMealOf({ plan: { ...plan, meals: { breakfast: null, lunch: id, dinner: null } }, stopId: id }), 'lunch');
  // planTrip 排出來的 plan 帶 meals：畫面現在的呼叫（不給 country）就讀得到
  const pois = Object.fromEntries(Object.values(POIS).map((p) => [p.id, p]));
  const d = planTrip({ trip: demoTrip(), pois, rules, settings, country: COUNTRY, kb: KB, legFn }).days[1];
  assert.equal(d.plan.meals.lunch, id);
  const viaPlan = swapCandidates({ plan: d.plan, stopId: id, pool: poolOf(annotated), legFn, date: d.date, settings: wide });
  assert.ok(viaPlan.length > 0 && viaPlan.every((c) => c.meal === 'lunch'));
  assert.ok(names(viaPlan).includes('喫茶 Elbe') && !names(viaPlan).includes('火星の庭'));
});

test('兩種情況都不列：不是一個地點的條目、研究判可略過、還沒解鎖、挖寶型（他自己勾的站不受影響）', () => {
  const extra = (id, over) => ({ ...POIS['たん焼き一隆'], id, name_zh: id, name_local: id, ...over });
  const vint = (id, over) => ({ ...POIS.SQUAT, id, name_zh: id, name_local: id, ...over });
  const gated = {
    '利久 vs 善治郎（站內比較吃）': extra('利久 vs 善治郎（站內比較吃）'),   // 沒欄位、店名寫「A vs B」：退回認店名
    比較條目: extra('比較條目', { notAStop: true }),
    可略過的店: extra('可略過的店', { researchSkip: '查證結果：這趟不用去' }),
    還沒解鎖: extra('還沒解鎖', { unlockWhen: '同品類吃無可吃' }),
    挖寶食堂: extra('挖寶食堂', { curated: false }),
    挖寶古著: vint('挖寶古著', { curated: false }),
    未解鎖古著: vint('未解鎖古著', { unlockWhen: '下次再說' }),
  };
  for (const p of Object.values(gated)) assert.equal(swapGated(p), true, p.name_zh);
  assert.equal(swapGated(POIS['たん焼き一隆']), false);
  assert.equal(swapGated(extra('備案食堂', { researchRank: 'backup' })), false, '研究標備案的照列（只是排後面）');
  const plan = plan0817();
  const pool = poolOf({ ...POIS, ...gated });
  const lunch = swapCandidates({ plan, stopId: POIS['おやま'].id, pool, legFn, date: DAY_0817.date, settings: wide, day: DAY_0817, country: COUNTRY });
  assert.deepEqual(names(lunch), ['たん焼き一隆'], '換午餐：五筆被擋的吃的站都不列');
  const vintage = swapCandidates({ plan, stopId: POIS.me.id, pool, legFn, date: DAY_0817.date, settings: wide });
  assert.ok(vintage.length > 0 && !names(vintage).some((n) => n in gated), `換古著店：挖寶型、未解鎖的不列：${names(vintage).join('、')}`);
});

test('排序：繞路分鐘少的在前；一樣的研究首選在前、備案在後', () => {
  const twin = (id, over = {}) => ({ ...POIS['たん焼き一隆'], id, name_zh: id, name_local: id, ...over });
  const plan = plan0817();
  // 三家都在同一區、同一組營業時間：繞路分鐘相同；放進 pool 的順序故意是 備案 → 沒標 → 首選
  const pool = poolOf({ a: twin('備案食堂', { researchRank: 'backup' }), b: twin('普通食堂'), c: twin('首選食堂', { researchRank: 'first' }) });
  const list = swapCandidates({ plan, stopId: POIS['おやま'].id, pool, legFn, date: DAY_0817.date, settings: wide, day: DAY_0817, country: COUNTRY });
  assert.equal(new Set(list.map((c) => c.detourMin)).size, 1, '三家繞路一樣');
  assert.deepEqual(names(list), ['首選食堂', '普通食堂', '備案食堂']);
  // 繞路少的先於研究首選
  const near = { ...twin('近的備案', { researchRank: 'backup' }), zoneId: POIS['おやま'].zoneId };
  const mixed = swapCandidates({ plan, stopId: POIS['おやま'].id, pool: [...pool, { poi: near }], legFn, date: DAY_0817.date, settings: wide, day: DAY_0817, country: COUNTRY });
  const detourOf = (n) => mixed.find((c) => c.poi.name_zh === n).detourMin;
  assert.ok(detourOf('近的備案') < detourOf('首選食堂'), '夾具裡同區的店繞路比較少');
  assert.equal(names(mixed)[0], '近的備案');
});

test('在場的人不想去的店型（day.adjust，T19）：別的店型進來的候選不列（他勾的食堂不列同行者不去的咖啡廳、酒吧）；跟這一站同 category 的照列（他勾的那一類由他）；沒 adjust 照舊', () => {
  const plan = plan0817();
  const base = { plan, stopId: POIS['おやま'].id, pool: poolOf(annotated), legFn, date: DAY_0817.date, settings: wide, day: DAY_0817, country: COUNTRY };
  const plain = names(swapCandidates(base));
  assert.deepEqual([...plain].sort(), ['たん焼き一隆', '喫茶 Elbe'].sort(), '對照組：食堂與標了午餐的喫茶');
  const avoid = (list) => ({ stamina: 'normal', nightSlot: 'default', avoidCategories: list, avoidBy: {} });
  assert.deepEqual(names(swapCandidates({ ...base, adjust: avoid(['cafe', 'bar']) })), ['たん焼き一隆'], '同行者不去咖啡廳：標了午餐的喫茶也不列，吃的那一家照列');
  assert.deepEqual(names(swapCandidates({ ...base, adjust: avoid(['food']) })), plain, '同行者不去食堂、但這一站就是他勾的食堂：同類照列，候選跟沒 adjust 一樣');
  assert.deepEqual(names(swapCandidates({ ...base, adjust: undefined })), plain);
});
