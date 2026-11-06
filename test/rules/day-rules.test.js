// T3：整天層級的規則（主行程必排、指定行程缺席罰、主題日不連兩天、餐段、夜間站）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stop, ctx, run, warnOf, rules, country, settings } from './_fixtures.js';
import { evaluateDay } from '../../src/engine/evaluate.js';
import { mealSlotsOf, mealGraceOf, unmetMeals, nightWindowOf, returnToTownMin, dayTripReturnByMin, dayTripNightHints, MEAL_GRACE_DEFAULT_MIN } from '../../src/rules/_slots.js';
import rulesJson from '../../src/rules.json' with { type: 'json' };

const lunch = stop('一隆', { category: 'food', walkFactor: 0, recovery: true, startMin: 12 * 60 + 15, dwellMin: 65 });
const dinner = stop('Elbe', { category: 'cafe', walkFactor: 0, recovery: true, cafeLike: true, startMin: 17 * 60 + 30, dwellMin: 60 });
const night = stop('汐谷', { category: 'bar', walkFactor: 0, recovery: true, startMin: 18 * 60 + 45, dwellMin: 90 });
const late = stop('バンザイ', { category: 'bar', walkFactor: 0, recovery: true, startMin: 20 * 60 + 30, dwellMin: 90 });
const shrine = stop('大崎八幡宮', { id: 'osaki' });

test('anchor：主行程沒排進去整天 no', () => {
  const dayCtx = (seq) => ({ ...ctx(null, { sequence: seq, day: { anchorPoiId: 'osaki', anchorName: '大崎八幡宮' } }) });
  assert.equal(run('anchor', dayCtx([lunch])), 'no');
  assert.equal(run('anchor', dayCtx([shrine, lunch])), 'ok');
  assert.match(warnOf('anchor', dayCtx([lunch])), /主行程沒排進去（大崎八幡宮）/);
});

test('designated：每個沒排進的指定站罰 120 分，只警告不擋', () => {
  const c = ctx(null, { sequence: [shrine], day: { designated: ['osaki', 'utah', 'banzai'] } });
  assert.equal(run('designated', c), 240);
  assert.match(warnOf('designated', c), /指定的 2 站今天排不進：utah、banzai/);
});

test('item-gap：昨天整天古著、今天又整天古著 no；單一站不觸發', () => {
  assert.equal(run('item-gap', ctx(null, { day: { themeCategory: 'vintage', prevThemeCategory: 'vintage' } })), 'no');
  assert.equal(run('item-gap', ctx(null, { day: { themeCategory: null, prevThemeCategory: 'vintage' } })), 'ok');
  assert.equal(run('item-gap', ctx(null, { day: { themeCategory: 'vintage', prevThemeCategory: 'record' } })), 'ok');
  // warn 是畫面文字：寫「古著店」不露店型鍵 vintage（10-14 T25 審查後改）
  const w = warnOf('item-gap', ctx(null, { day: { themeCategory: 'vintage', prevThemeCategory: 'vintage' } }));
  assert.equal(w, '昨天已經整天逛古著店，今天又是，會膩');
  assert.ok(!w.includes('vintage'));
});

test('meal-slots：午晚餐各缺一個罰 20；night-slot：normal 日 20:00 後沒 bar 罰 10，抵達日不管', () => {
  assert.equal(run('meal-slots', ctx(null, { sequence: [shrine] })), 40);
  assert.equal(run('meal-slots', ctx(null, { sequence: [lunch] })), 20);
  assert.match(warnOf('meal-slots', ctx(null, { sequence: [lunch] })), /沒排晚餐/);
  assert.equal(run('meal-slots', ctx(null, { sequence: [lunch, dinner] })), 0, '喫茶吃晚餐也算晚餐');
  assert.equal(run('meal-slots', ctx(null, { sequence: [night], day: { type: 'arrival', windowRaw: { startMin: 17 * 60, endMin: 1440 } } })), 0, '抵達日 17:00 才開始：午餐不在時窗內不罰，bar 18:45 起算晚餐');
  assert.equal(run('meal-slots', ctx(null, { sequence: [lunch], day: { type: 'departure', windowRaw: { startMin: 540, endMin: 13 * 60 } } })), 0, '離境日 13:00 收工：晚餐不在時窗內不罰');
  assert.equal(run('meal-slots', ctx(null, { sequence: [], day: { windowRaw: { startMin: 540, endMin: 1440 } } })), 40, '整天都在時窗內、兩餐都沒排罰 40');
  const ennichi = stop('縁日廣場', { category: 'event', walkFactor: 0.5, recovery: false, startMin: 17 * 60, dwellMin: 90, meal: true });
  ennichi.poi.meal = true;
  assert.equal(run('meal-slots', ctx(null, { sequence: [lunch, ennichi] })), 0, '知識庫標 meal 的縁日攤位算晚餐（原話 #172）');
  assert.equal(run('night-slot', ctx(null, { sequence: [lunch, night] })), 0, '18:45–20:15 跨到 20:00 算有');
  assert.equal(run('night-slot', ctx(null, { sequence: [lunch, dinner] })), 10);
  assert.equal(run('night-slot', ctx(null, { sequence: [lunch, late] })), 0);
  assert.equal(run('night-slot', ctx(null, { sequence: [lunch, late], day: { window: { startMin: 540, endMin: 22 * 60 + 30 }, windowRaw: { startMin: 540, endMin: 1440 } } })), 0, '留白扣掉後收工 22:30，20:30–22:00 的 bar 仍算夜間站（讀 country.nightSlot，不讀 day.window）');
  assert.equal(run('night-slot', ctx(null, { sequence: [lunch], day: { type: 'arrival' } })), 0);
  assert.equal(run('night-slot', ctx(null, { sequence: [lunch], day: { nightSlotOff: true } })), 0, '早起日前一晚取消');
  // 同行者（T19，engine/persons.js）：在場有人「不排」走 nightSlotOff；「少排」（nightSlotLess）罰分減半；排了就不罰
  assert.equal(run('night-slot', ctx(null, { sequence: [lunch, dinner], day: { nightSlotLess: true } })), 5, '少排：缺席罰一半');
  assert.equal(run('night-slot', ctx(null, { sequence: [lunch, late], day: { nightSlotLess: true } })), 0, '少排但有排就不罰');
  assert.equal(run('night-slot', ctx(null, { sequence: [lunch, dinner], day: { nightSlotLess: true, nightSlotOff: true } })), 0, '不排蓋過少排');
  assert.equal(warnOf('night-slot', ctx(null, { sequence: [lunch, dinner], day: { nightSlotLess: true } })), '今晚沒排夜間站');
});

test('固定時段日（type fixed，研討會；10-14 T23）：night-slot 照罰（原話 #18「每晚都要安排」是通則）、arrival／departure／transfer 不管；meal-slots 被固定時段的站蓋住的餐段不算缺（餐段開始前就在進行、到餐段過半還沒散）、餐段中途才開始或早上就散的照算、沒有固定時段的長站不算', () => {
  assert.equal(run('night-slot', ctx(null, { sequence: [lunch, dinner], day: { type: 'fixed' } })), 10, 'fixed 日 20:00 後沒 bar 罰 10');
  assert.equal(run('night-slot', ctx(null, { sequence: [lunch, late], day: { type: 'fixed' } })), 0);
  assert.equal(run('night-slot', ctx(null, { sequence: [lunch], day: { type: 'departure' } })), 0, '離境日不管');
  assert.equal(run('night-slot', ctx(null, { sequence: [lunch], day: { type: 'transfer' } })), 0, '城際移動日不管');
  assert.equal(run('night-slot', ctx(null, { sequence: [lunch], day: { type: 'fixed', nightSlotOff: true } })), 0, '隔天早起照樣取消');
  // 會場 08:50–20:00（09:30–19:30 的研討會＋晚宴，前 40 後 30 掛在窗上）；散場後 20:10 去 bar
  const venue = stop('會場', { category: 'venue', walkFactor: 0, startMin: 8 * 60 + 50, dwellMin: 670, fixedWindow: { startMin: 9 * 60 + 30, endMin: 19 * 60 + 30, arriveEarlyMin: 40, afterMin: 30 } });
  const after = stop('賓', { category: 'bar', walkFactor: 0, recovery: true, startMin: 20 * 60 + 10, dwellMin: 90 });
  const day = { type: 'fixed', windowRaw: { startMin: 8 * 60 + 20, endMin: 1440 } };
  assert.equal(run('meal-slots', ctx(null, { sequence: [venue], day })), 0, '午餐 11:30–13:30 整段在會場裡、晚餐 18:00–20:30 到 20:00 還在裡面（過了中點 19:15；晚宴）：兩餐都不算缺（10-14 T23 審查後：之前「整段蓋住」對晚宴永遠不成立）');
  assert.equal(run('meal-slots', ctx(null, { sequence: [venue, after], day })), 0, '散場後的 bar 跨到晚餐段 20:30 前，本來就算晚餐');
  assert.equal(run('night-slot', ctx(null, { sequence: [venue], day })), 10, '研討會 19:30 散、沒跨進夜間時窗：晚上還是要夜間站');
  assert.equal(run('night-slot', ctx(null, { sequence: [venue, after], day })), 0, '賓 是夜間站');
  const half = stop('半天會', { category: 'venue', walkFactor: 0, startMin: 9 * 60 + 30, dwellMin: 210, fixedWindow: { startMin: 10 * 60, endMin: 13 * 60, arriveEarlyMin: 30, afterMin: 0 } });
  assert.equal(run('meal-slots', ctx(null, { sequence: [half], day })), 20, '13:00 才散的半天會：午餐過半（12:30）還在裡面，午餐算蓋住；晚餐缺');
  assert.equal(warnOf('meal-slots', ctx(null, { sequence: [half], day })), '今天沒排晚餐');
  const morning = stop('早上會', { category: 'venue', walkFactor: 0, startMin: 8 * 60 + 30, dwellMin: 210, fixedWindow: { startMin: 9 * 60, endMin: 12 * 60, arriveEarlyMin: 30, afterMin: 0 } });
  assert.equal(run('meal-slots', ctx(null, { sequence: [morning], day })), 40, '12:00 就散的早上會：午餐中點 12:30 前已經出來，午餐照算缺');
  // 19:00 開演的演唱會（18:20 卡位、22:00 散場、22:30 散場緩衝）：餐段中途才開始，開演前要先吃 → 晚餐照算缺；它本身跨進夜間時窗 → 算夜間站
  const concert = stop('演唱會', { category: 'venue', walkFactor: 0, startMin: 18 * 60 + 20, dwellMin: 250, fixedWindow: { startMin: 19 * 60, endMin: 22 * 60, arriveEarlyMin: 40, afterMin: 30 } });
  assert.equal(run('meal-slots', ctx(null, { sequence: [lunch, concert], day })), 20, '演唱會 18:20 才開始、沒蓋住晚餐的開頭：晚餐照算缺');
  assert.equal(run('night-slot', ctx(null, { sequence: [lunch, concert], day })), 0, '19:00–22:00 的演唱會跨進夜間時窗，那晚就是它，不再要 bar（推導，10-14 T23 審查後）');
  const fireworks = stop('花火', { category: 'event', walkFactor: 0, startMin: 19 * 60, dwellMin: 90, fixedWindow: { startMin: 19 * 60 + 30, arriveEarlyMin: 30 } });
  assert.equal(run('night-slot', ctx(null, { sequence: [lunch, fireworks], day: { type: 'normal' } })), 0, '只釘開始的花火：看站的結束 20:30，跨進 20:00 後也算');
  const pinnedCafe = stop('釘的咖啡廳', { category: 'cafe', walkFactor: 0, recovery: true, startMin: 20 * 60 + 10, dwellMin: 40, fixedWindow: { startMin: 20 * 60 + 10, pinned: true } });
  assert.equal(run('night-slot', ctx(null, { sequence: [lunch, pinnedCafe], day: { type: 'normal' } })), 10, '降速釘的「現在就去坐」不是固定時段，咖啡廳不算夜間站');
  const longShrine = stop('長站', { startMin: 8 * 60 + 50, dwellMin: 670 });
  assert.equal(run('meal-slots', ctx(null, { sequence: [longShrine], day })), 40, '沒有固定時段的長站不算蓋住（只有固定時段的站才當大會供餐）');
});

test('night-slot 夜間步行風險（T20，country.transportProfile.nightWalk.risk，原話 #145）：low／缺照 nightSlot 到 24:00；mid 尾端提前到 23:00、high 到 22:00（預設、推導）', () => {
  const c = (seq, risk) => ctx(null, { sequence: seq, country: risk ? { ...country, transportProfile: { nightWalk: { risk } } } : country });
  const lateNight = stop('深夜bar', { category: 'bar', walkFactor: 0, recovery: true, startMin: 23 * 60 + 10, dwellMin: 50 });   // 23:10–24:00
  const evening = stop('十點半bar', { category: 'bar', walkFactor: 0, recovery: true, startMin: 22 * 60 + 30, dwellMin: 60 });   // 22:30–23:30
  assert.equal(run('night-slot', c([lunch, lateNight])), 0, '缺 transportProfile＝low：23:10 的 bar 在 20:00–24:00 內');
  assert.equal(run('night-slot', c([lunch, lateNight], 'low')), 0);
  assert.equal(run('night-slot', c([lunch, lateNight], 'mid')), 10, 'mid：尾端 23:00，23:10 才開始的不算');
  assert.equal(run('night-slot', c([lunch, evening], 'mid')), 0, 'mid：22:30 開始、跨 23:00 前算有');
  assert.equal(run('night-slot', c([lunch, evening], 'high')), 10, 'high：尾端 22:00，22:30 才開始的不算');
  assert.equal(run('night-slot', c([lunch, late], 'high')), 0, 'high：20:30–22:00 的 bar 算有');
  assert.equal(run('night-slot', c([lunch, late], 'weird')), 0, '看不懂的等級當 low');
  assert.equal(run('night-slot', c([lunch, evening], 'high')), 10, '規則沒因為少了選填鍵被跳過（transportProfile 不在 reads）');
});

test('evaluateDay 把 day scope 的規則一起算', () => {
  const r = evaluateDay(ctx(null, { sequence: [shrine], day: { anchorPoiId: 'osaki', designated: ['utah'] } }), rules);
  assert.equal(r.verdict, 'ok');
  assert.equal(r.penaltyMin, 120 + 40 + 10);
  assert.deepEqual(r.breakdown.map((b) => b.ruleId).sort(), ['designated', 'meal-slots', 'night-slot']);
});

// ── 11-06：餐段放寬（原話 #189）、一日遊的夜間站（原話 #190）──
const grace = (min) => ({ settings: { ...settings, mealGraceMin: min } });
const food = (name, startMin, dwellMin = 60, over = {}) => stop(name, { category: 'food', walkFactor: 0, recovery: true, startMin, dwellMin, ...over });

test('餐段的共用尺（rules/_slots.js）：放寬量讀 settings.mealGraceMin、缺或寫壞用預設；餐段照開始時刻排、帶原本的餐段與放寬後的時窗；rules.json 的值跟預設同值', () => {
  assert.equal(rulesJson.settings.mealGraceMin, MEAL_GRACE_DEFAULT_MIN, '舊打包檔沒有這個鍵時走程式裡的預設，兩邊要同值');
  assert.equal(mealGraceOf({}), MEAL_GRACE_DEFAULT_MIN);
  assert.equal(mealGraceOf({ mealGraceMin: 90 }), 90);
  assert.equal(mealGraceOf({ mealGraceMin: 0 }), 0, '0＝不放寬');
  for (const bad of [-30, '60', null, NaN]) assert.equal(mealGraceOf({ mealGraceMin: bad }), MEAL_GRACE_DEFAULT_MIN, String(bad));
  assert.deepEqual(mealSlotsOf(country, { mealGraceMin: 60 }).map((m) => [m.slot, [...m.core], [...m.window]]), [['lunch', [690, 810], [630, 870]], ['dinner', [1080, 1230], [1020, 1290]]], '午 10:30–14:30、晚 17:00–21:30');
  assert.deepEqual(mealSlotsOf({ mealSlots: { dinner: ['18:00', '20:30'], lunch: ['11:30', '13:30'], bad: ['x', 'y'], flip: ['13:00', '12:00'] } }, { mealGraceMin: 0 }).map((m) => m.slot), ['lunch', 'dinner'], '照時間排；寫壞的那段跳過');
  assert.deepEqual(mealSlotsOf(null, {}), []);
  // 每個候選最多配一餐：兩餐都只有同一個候選時後面那餐缺；三餐以上走配對
  const a = { id: 'a' }; const b = { id: 'b' }; const c = { id: 'c' };
  assert.deepEqual(unmetMeals([{ slot: 'lunch', cands: [a] }, { slot: 'dinner', cands: [a] }]), ['dinner']);
  assert.deepEqual(unmetMeals([{ slot: 'lunch', cands: [a, b] }, { slot: 'dinner', cands: [a] }]), [], '午餐讓出 a 改配 b');
  assert.deepEqual(unmetMeals([{ slot: 'lunch', cands: [] }, { slot: 'dinner', cands: [] }]), ['lunch', 'dinner']);
  assert.deepEqual(unmetMeals([{ slot: 'breakfast', cands: [a] }, { slot: 'lunch', cands: [a, b] }, { slot: 'dinner', cands: [b] }]), ['dinner'], '三餐兩個候選：配得到兩餐');
  assert.deepEqual(unmetMeals([{ slot: 'breakfast', cands: [a] }, { slot: 'lunch', cands: [a, b] }, { slot: 'dinner', cands: [b, c] }]), []);
});

test('meal-slots 餐段放寬（原話 #189「晚餐提早或延後 都可以」；11-06）：吃的站落在餐段前後各 60 分以內就算那一餐；每一站最多算一餐；這天要不要這一餐、被固定時段蓋住照舊看原本的餐段', () => {
  // 晚餐延後：主行程 18:30–20:20 佔住晚餐段，回城後 21:03–21:33 才喝的那一杯（七天包 8/16 的樣子）
  const event = stop('流灯会', { category: 'event', walkFactor: 0.5, startMin: 18 * 60 + 30, dwellMin: 110, fixedWindow: { startMin: 19 * 60, arriveEarlyMin: 30 }, isAnchor: true });
  const lateBar = stop('てん', { category: 'bar', walkFactor: 0, recovery: true, startMin: 21 * 60 + 3, dwellMin: 30 });
  assert.equal(run('meal-slots', ctx(null, { sequence: [lunch, event, lateBar] })), 0, '21:03 的那一杯落在 21:30 以前，算晚餐');
  assert.equal(run('meal-slots', ctx(null, { sequence: [lunch, event, lateBar], ...grace(0) })), 20, '放寬量 0＝放寬前：要跟 18:00–20:30 重疊才算');
  assert.equal(warnOf('meal-slots', ctx(null, { sequence: [lunch, event, lateBar], ...grace(0) })), '今天沒排晚餐');
  const tooLate = stop('太晚', { category: 'bar', walkFactor: 0, recovery: true, startMin: 21 * 60 + 35, dwellMin: 30 });
  assert.equal(run('meal-slots', ctx(null, { sequence: [lunch, event, tooLate] })), 20, '21:35 才開始，過了 21:30 不算');
  assert.equal(run('meal-slots', ctx(null, { sequence: [lunch, event, tooLate], ...grace(90) })), 0, '放寬量是設定：90 分就到 22:00');
  // 晚餐提早：17:00 一開門就進去吃
  assert.equal(run('meal-slots', ctx(null, { sequence: [lunch, food('一開門就吃', 17 * 60)] })), 0, '17:00–18:00 算晚餐');
  assert.equal(run('meal-slots', ctx(null, { sequence: [lunch, food('一開門就吃', 17 * 60)], ...grace(0) })), 20, '放寬前 17:00–18:00 沒碰到 18:00，不算');
  assert.equal(run('meal-slots', ctx(null, { sequence: [lunch, food('下午', 15 * 60 + 55)] })), 20, '15:55–16:55 沒碰到 17:00，不算晚餐');
  // 午餐比照（推導）：10:30–14:30
  assert.equal(run('meal-slots', ctx(null, { sequence: [food('晚一點的午餐', 13 * 60 + 52), dinner] })), 0, '13:52–14:52 算午餐');
  assert.equal(run('meal-slots', ctx(null, { sequence: [food('早餐', 9 * 60 + 2, 40), dinner] })), 20, '09:02–09:42 的早餐不算午餐');
  assert.equal(warnOf('meal-slots', ctx(null, { sequence: [food('早餐', 9 * 60 + 2, 40), dinner] })), '今天沒排午餐');
  // 每一站最多算一餐（午、晚不重複算）
  const long = food('吃很久', 14 * 60, 200);   // 14:00–17:20：午餐、晚餐的時窗都碰到
  assert.equal(run('meal-slots', ctx(null, { sequence: [long] })), 20, '一站只算一餐');
  assert.equal(warnOf('meal-slots', ctx(null, { sequence: [long] })), '今天沒排晚餐', '前面的餐段留著、後面的缺');
  assert.equal(run('meal-slots', ctx(null, { sequence: [long, food('另一家', 14 * 60 + 10, 200)] })), 0, '兩站各算一餐');
  // 引擎插的站照舊不算；知識庫標 meal 的攤位照舊算、也吃得到放寬
  assert.equal(run('meal-slots', ctx(null, { sequence: [lunch, food('引擎插的', 17 * 60, 60, { insertedBy: 'engine' })] })), 20);
  const stall = stop('縁日攤位', { category: 'event', walkFactor: 0.5, startMin: 16 * 60 + 20, dwellMin: 60 }); stall.poi.meal = true;
  assert.equal(run('meal-slots', ctx(null, { sequence: [lunch, stall] })), 0, '16:20–17:20 的攤位碰到 17:00，算晚餐');
  // 「這天要不要這一餐」看原本的餐段：17:30 收工的日子，原本的晚餐段 18:00 起不在時窗內，不要求晚餐（放寬後的 17:00 起不拿來判這件事）
  assert.equal(run('meal-slots', ctx(null, { sequence: [lunch], day: { windowRaw: { startMin: 540, endMin: 17 * 60 + 30 } } })), 0);
  // 「被固定時段蓋住」看原本的餐段：17:30–19:30 的固定時段從 18:00 以前就在進行、過了 19:15 才散＝蓋住；要是拿放寬後的 17:00 來比就不算了
  const banquet = stop('晚宴', { category: 'venue', walkFactor: 0, startMin: 17 * 60 + 30, dwellMin: 120, fixedWindow: { startMin: 17 * 60 + 30, endMin: 19 * 60 + 30, arriveEarlyMin: 0, afterMin: 0 } });
  assert.equal(run('meal-slots', ctx(null, { sequence: [lunch, banquet] })), 0);
});

test('night-slot 一日遊（原話 #190；11-06）：當地的夜間站算有；沒有夜間站而回到市區已晚於 21:00 不罰、回得早照罰；不是一日遊、沒有外地表照平常日罰', () => {
  const away = { matsushima: { homeMin: 43 } };   // 松島海岸回據點：車 38＋走 5
  const day = { dayTrip: true, away, homeZoneId: 'sendai-station' };
  const there = (endMin, over = {}) => stop('松島的站', { zoneId: 'matsushima', startMin: endMin - 60, dwellMin: 60, ...over });
  const c = (seq, d = day, rest = {}) => ctx(null, { sequence: seq, day: d, ...rest });
  assert.equal(returnToTownMin([lunch, there(20 * 60 + 20)], away), 21 * 60 + 3, '20:20 離開＋43 分＝21:03 回到市區');
  assert.equal(returnToTownMin([lunch], away), null, '沒去外地');
  assert.equal(returnToTownMin([lunch, there(20 * 60 + 20)], null), null, '沒有外地表');
  assert.equal(dayTripReturnByMin(settings), 21 * 60, 'rules.json dayTripNightReturnByHM 21:00（原話 #190）');
  assert.equal(dayTripReturnByMin({}), 21 * 60, '缺就用 21:00');
  assert.equal(dayTripReturnByMin({ dayTripNightReturnByHM: '九點' }), 21 * 60, '寫壞也用 21:00');
  assert.equal(run('night-slot', c([lunch, there(20 * 60 + 20)])), 0, '21:03 才回到市區、又沒有當地夜間站：那晚不要求夜間站');
  assert.equal(run('night-slot', c([lunch, there(20 * 60 + 10)])), 10, '20:53 回到市區卻沒排：照罰');
  assert.equal(run('night-slot', c([lunch, there(15 * 60)])), 10, '下午就回來了：照罰');
  assert.equal(run('night-slot', c([lunch, there(20 * 60 + 20)], { away, homeZoneId: 'sendai-station' })), 10, '不是一日遊：照平常日');
  assert.equal(run('night-slot', c([lunch, there(20 * 60 + 20)], { dayTrip: true })), 10, 'day 上沒有外地表（舊呼叫端）：照平常日');
  assert.equal(run('night-slot', c([lunch, there(20 * 60 + 20)], day, { settings: { ...settings, dayTripNightReturnByHM: '21:30' } })), 10, '門檻是設定：21:30 的話 21:03 不算晚');
  // 當地的夜間站：在松島吃到 20:30 的食堂算夜間站（這條本來就不分區）；回到市區後他勾的酒吧也算
  const localDinner = stop('松島的食堂', { category: 'food', walkFactor: 0, recovery: true, zoneId: 'matsushima', startMin: 19 * 60 + 30, dwellMin: 60 });
  assert.equal(run('night-slot', c([lunch, localDinner])), 0);
  const townBar = stop('てん', { category: 'bar', walkFactor: 0, recovery: true, zoneId: 'sendai-station', startMin: 21 * 60 + 3, dwellMin: 30 });
  assert.equal(run('night-slot', c([lunch, there(20 * 60 + 20), townBar])), 0);
  // 回到市區後還有不是夜間站的站：回城時刻照最後一個外地站算
  const townCafe = stop('喫茶', { category: 'cafe', walkFactor: 0, recovery: true, zoneId: 'sendai-station', startMin: 21 * 60 + 20, dwellMin: 40 });
  assert.equal(run('night-slot', c([lunch, there(20 * 60 + 30), townCafe])), 0, '21:13 回到市區，之後只喝了咖啡：不罰');
  assert.equal(run('night-slot', c([lunch, there(20 * 60 + 10)], { ...day, nightSlotLess: true })), 5, '少排照舊減半');
  assert.deepEqual([...nightWindowOf(country)], [20 * 60, 24 * 60]);
  assert.equal(nightWindowOf({ nightSlot: ['20:00'] }), null);
});

test('day-trip-night（原話 #190；11-06）：一日遊回到市區已晚於 21:00，引擎自己插的市區夜間站整天 no；他勾的不擋、掛一條提示；當地的、回得早的、現場改案、不是一日遊都不管', () => {
  const day = { dayTrip: true, away: { matsushima: { homeMin: 43 } }, homeZoneId: 'sendai-station' };
  const event = (endMin) => stop('流灯会', { category: 'event', zoneId: 'matsushima', startMin: endMin - 110, dwellMin: 110 });
  const bar = (over = {}) => stop('てん', { category: 'bar', walkFactor: 0, recovery: true, zoneId: 'sendai-station', startMin: 21 * 60 + 3, dwellMin: 30, ...over });
  const c = (seq, d = day) => ctx(null, { sequence: seq, day: d });
  const late = event(20 * 60 + 20);   // 20:20 散 → 21:03 回到市區
  assert.equal(run('day-trip-night', c([late, bar()])), 'ok', '他勾的照排');
  assert.equal(run('day-trip-night', c([late, bar({ insertedBy: 'engine' })])), 'no', '引擎插的不准');
  assert.equal(warnOf('day-trip-night', c([late, bar({ insertedBy: 'engine' })])), '一日遊回到市區已經 21:03（晚於 21:00），不再多排夜間站（てん）');
  assert.equal(run('day-trip-night', c([event(20 * 60 + 10), bar({ insertedBy: 'engine', startMin: 20 * 60 + 53 })])), 'ok', '20:53 回到市區，不晚');
  assert.equal(run('day-trip-night', c([late, bar({ insertedBy: 'engine', zoneId: 'matsushima' })])), 'ok', '當地的夜間站歸末班車管');
  assert.equal(run('day-trip-night', c([late, bar({ insertedBy: 'engine' })], { ...day, resumed: true })), 'ok', '現場改案不管');
  assert.equal(run('day-trip-night', c([late, bar({ insertedBy: 'engine', fixedWindow: { startMin: 21 * 60 + 3, pinned: true } })])), 'ok', '按「累了」釘的那家不算引擎主動排');
  assert.equal(run('day-trip-night', c([late, bar({ insertedBy: 'engine' })], { ...day, dayTrip: false })), 'ok', '不是一日遊');
  assert.equal(run('day-trip-night', c([late, bar({ insertedBy: 'engine' })], { dayTrip: true })), 'ok', '沒有外地表');
  const cafe = stop('喫茶', { category: 'cafe', walkFactor: 0, recovery: true, zoneId: 'sendai-station', startMin: 21 * 60 + 10, dwellMin: 30, insertedBy: 'engine' });
  assert.equal(run('day-trip-night', c([late, cafe])), 'ok', '咖啡廳不是夜間站');
  const morning = stop('早餐', { category: 'food', walkFactor: 0, recovery: true, zoneId: 'sendai-station', startMin: 9 * 60 + 49, dwellMin: 75, insertedBy: 'engine' });
  assert.equal(run('day-trip-night', c([morning, late])), 'ok', '出發前引擎插的早餐不在夜間時段、也不在回城之後');
  // 整天層級的硬規則：有這種站，這一天不成立
  assert.equal(evaluateDay(c([lunch, late, bar({ insertedBy: 'engine' })]), rules).verdict, 'no');
  assert.equal(evaluateDay(c([lunch, late, bar()]), rules).verdict, 'ok');
  // 他勾的那站的提示（engine/trip.js 排完掛；不罰）
  const hints = dayTripNightHints({ sequence: [lunch, late, bar()], day, settings, country });
  assert.deepEqual(hints, [{ ruleId: 'day-trip-night', code: 'hint', hint: true, poiId: 'てん', backMin: 21 * 60 + 3, msg: '一日遊回到市區已經 21:03（晚於 21:00），てん 照你勾的排；太晚就別去了' }]);
  assert.deepEqual(dayTripNightHints({ sequence: [lunch, late, bar({ insertedBy: 'engine' })], day, settings, country }), [], '引擎插的不出提示（規則擋掉）');
  assert.deepEqual(dayTripNightHints({ sequence: [lunch, event(20 * 60 + 10), bar({ startMin: 20 * 60 + 53 })], day, settings, country }), [], '回得不晚沒有提示');
  assert.deepEqual(dayTripNightHints({ sequence: [lunch, late, bar()], day: { ...day, dayTrip: false }, settings, country }), []);
  assert.deepEqual(dayTripNightHints({ sequence: [lunch, late, bar()], day, settings: { ...settings, dayTripNightReturnByHM: '21:30' }, country }), [], '門檻改 21:30 就不提示');
});
