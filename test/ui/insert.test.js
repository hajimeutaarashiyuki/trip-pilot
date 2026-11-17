// 走廊清單「升級成站」＝安插的畫面邏輯（ui/insert.js；原話 #192「順路站 升級成站時 不應該把原本的行程刪掉 應該是安插進來」、#193「還有選項沒有簡介」、
// #194「當然安插進來後 會壓縮到後面的行程 那就再跳一組選項問我 要壓縮哪個行程或是砍掉」）：純函式——按了走哪一步、選項上的字與後果、三輪的流程、復原列那一句。
// 試算本身在 test/engine/insert.test.js；這裡驗畫面怎麼用它。小世界見 _world.js（THU 的順序釘死，時刻跟引擎測試的世界一相同）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trialArgs, startInsert, chooseInsertOption, askRound, askView, optionLabel, optionNote, optionAdds, adjustLabels, insertDoneText, earlyMaxMin } from '../../src/ui/insert.js';
import { applyInsert, INSERT_MAX_ROUNDS } from '../../src/engine/insert.js';
import { TEXT } from '../../src/ui/text.js';
import { stateOf, makeTrip, planWorld, idsOf, pois, THU, A, B, C, lunch, dinner, bar, small, mid, big, ORDER1 } from './_world.js';

const nameOf = (id) => pois[id]?.name_zh ?? id;
const state = stateOf();
const argsOf = (poi, legIndex) => trialArgs(state, THU, poi.id, legIndex);
const pick = (view, label) => [...view.fits, ...view.more].find((r) => r.label === label) ?? assert.fail(`選項裡沒有「${label}」：${[...view.fits, ...view.more].map((r) => r.label).join('｜')}`);

test('trialArgs：那天畫面上的 plan／day、住宿、要插的店、插在第幾段；那天沒排、知識庫沒有這家回 null', () => {
  const a = argsOf(small, 5);
  assert.equal(a.plan, state.plans[THU].plan);
  assert.equal(a.day, state.plans[THU].day);
  assert.deepEqual([a.poi, a.legIndex, a.home.id, a.legFn, a.rules, a.settings, a.country, a.kb], [small, 5, 'home', state.legFn, state.rules, state.settings, state.country, state.kb]);
  assert.equal(trialArgs(state, '2026-01-01', small.id, 0), null);
  assert.equal(trialArgs(state, THU, '沒這家', 0), null);
  assert.equal(trialArgs({}, THU, small.id, 0), null);
});

test('排得下就直接套：startInsert 回 apply；復原列那一句講插在誰跟誰之間、後面順延幾分、用掉幾分留白；插在最前面與最後面的說法不同；店名用短的', () => {
  assert.deepEqual(idsOf(state.plans[THU].plan), ORDER1);
  const step = startInsert(argsOf(small, 5));
  assert.equal(step.kind, 'apply');
  assert.equal(step.result.fits, true);
  assert.equal(insertDoneText(step.result, nameOf), '已把 小店 插在 街區B 和 酒吧 之間，後面順延 15 分（用掉留白 15 分）');
  assert.equal(insertDoneText(startInsert(argsOf(small, 0)).result, nameOf), '已把 小店 排成第一站（街區A 之前），後面順延 35 分');
  assert.equal(insertDoneText({ sequence: [{ poi: bar }, { poi: small }], index: 1, poiId: small.id, between: { prev: bar, next: null }, adjust: [], shiftMaxMin: 0, openSlotUsedMin: 35, openSlotUsedBeforeMin: 0 }, nameOf), '已把 小店 接在 酒吧 之後，其餘各站的時刻不變（用掉留白 35 分）');
  // 套進旅程檔重排：原本的每一站都在、先後不變、那天釘住
  const after = planWorld(applyInsert(makeTrip(), THU, step.result))[THU].plan;
  assert.deepEqual(idsOf(after), [A.id, C.id, lunch.id, dinner.id, B.id, small.id, bar.id]);
  assert.equal(after.pinned, true);
  // 輸入不成立（那家已經在這天的行程裡、沒有參數）：none
  assert.deepEqual(startInsert(argsOf(bar, 0)), { kind: 'none' });
  assert.deepEqual(startInsert(null), { kind: 'none' });
});

test('排不下：startInsert 回 ask；askView 講為什麼排不下（卡住的每一句、重複的只印一次、差幾分）、列排得下的選項——鍵上寫做什麼與後果，附那一站的簡介（插的這家不重複附）', () => {
  const step = startInsert(argsOf(mid, 5));
  assert.equal(step.kind, 'ask');
  assert.deepEqual([step.ask.chosen, askRound(step.ask)], [[], 1]);
  const v = askView(step.ask, nameOf);
  assert.deepEqual([v.round, v.last, v.dead, v.chosen], [1, false, false, []]);
  assert.equal(v.why, '插進 中店 之後排不下：酒吧 待到 24:15，超過 24:00 關門；酒吧 會到 24:15，超過今天收工時間 24:00（差 15 分）');
  assert.equal(v.prompt, '選一個讓它排得下，或算了不插：');
  assert.deepEqual(v.fits.map((r) => [r.label, r.note, r.intro]), [
    ['中店 只待 105 分（原本 120 分）', '排得下，後面最多順延 90 分，用掉留白 90 分', null],
    ['酒吧 少待 15 分（150→135）', '排得下，後面最多順延 105 分，用掉留白 90 分', '酒吧的簡介'],
    ['不去 酒吧', '排得下，其餘各站的時刻不變', '酒吧的簡介'],
  ]);
  assert.deepEqual(v.more, []);
  // 畫面照兩組畫（11-17）：「少待一點」（要插的這家排第一個、名字後面標「要插的這家」）與「這站不去」；每一列：店名、右邊的重點（少待寫幾分變幾分、不去寫店型）、後果、簡介
  assert.deepEqual(v.groups.map((g) => [g.key, g.head, g.rows.map((r) => [r.name, r.mine, r.side, r.cat, r.engine])]), [
    ['shorten', '少待一點', [['中店', true, '120 → 105 分', null, false], ['酒吧', false, '150 → 135 分', null, false]]],
    ['drop', '這站不去', [['酒吧', false, null, '酒吧', false]]],
  ]);
  assert.deepEqual(v.groups.flatMap((g) => g.rows), v.fits, '兩組合起來就是要畫的那幾列（同一批物件）');
  assert.equal('moreHead' in v, false, '「下面這幾個選了還不夠」那一句不畫了：每一列的後果自己寫還差幾分');
  assert.equal(v.fits[0].option, step.ask.trial.options[0], '列帶著引擎給的那個選項物件（按了交回 app.js）');
  // 不去酒吧的後果：今晚沒有夜間站了——寫在鍵上
  assert.equal(v.fits[2].adds, '會多一句：今晚沒排夜間站');
  assert.equal(v.fits[0].adds, null);
  // 選了排得下的：apply，復原列那一句帶著選的調整
  const done = chooseInsertOption(argsOf(mid, 5), step.ask, v.fits[1].option);
  assert.equal(done.kind, 'apply');
  assert.equal(insertDoneText(done.result, nameOf), '已把 中店 插在 街區B 和 酒吧 之間，後面順延 105 分（用掉留白 90 分）；酒吧 少待 15 分（150→135）');
  assert.equal(insertDoneText(chooseInsertOption(argsOf(mid, 5), step.ask, v.fits[2].option).result, nameOf), '已把 中店 接在 街區B 之後，其餘各站的時刻不變；不去 酒吧');
  const after = planWorld(applyInsert(makeTrip(), THU, done.result))[THU].plan;
  assert.deepEqual(after.sequence.slice(-2).map((s) => [s.poi.id, s.dwellMin]), [[mid.id, 120], [bar.id, 135]]);
});

test('三輪的流程：選了還排不下就換成下一輪的選項（講還差多少、列已經套著的調整）；最後一輪只列選了就排得下的；選完套用，復原列把每個調整都寫出來', () => {
  const args = argsOf(big, 0);
  const first = startInsert(args);
  assert.equal(first.kind, 'ask');
  const step1Order = first.ask.trial.options;
  const v1 = askView(first.ask, nameOf);
  assert.equal(v1.why, '插進 大店 之後排不下：午餐店 15:20 到的時候不在營業時間內（11:30–14:30）（差 110 分）');
  assert.ok(v1.fits.length >= 1 && v1.more.length >= 1, '第一輪：有排得下的、也有選了還不夠的');
  // 兩組裡排得下的與還不夠的混著列（照引擎給的先後：排得下的在前），哪一種看每一列的後果
  assert.deepEqual(v1.groups.map((g) => g.head), ['少待一點', '這站不去']);
  assert.deepEqual(v1.groups.flatMap((g) => g.rows).map((r) => r.label).sort(), [...v1.fits, ...v1.more].map((r) => r.label).sort(), '每一個要列的選項都在其中一組');
  for (const g of v1.groups) {
    assert.ok(g.rows.every((r) => (g.key === 'drop') === (r.option.kind === 'drop')), `${g.head} 裡只有這一類`);
    const order = g.rows.filter((r) => !r.mine).map((r) => step1Order.indexOf(r.option));
    assert.deepEqual(order, [...order].sort((a, b) => a - b), `${g.head}：組內照引擎給的先後`);
  }
  assert.equal(v1.groups[0].rows[0].mine, true, '要插的這家排在「少待一點」的第一個');
  const a1 = pick(v1, '街區A 少待 30 分（60→30）');
  assert.equal(a1.note, '還差 80 分，要再調一項');
  assert.equal(a1.intro, '街區A的簡介');
  assert.equal(a1.adds, null, '還排不下的不寫後果');

  const second = chooseInsertOption(args, first.ask, a1.option);
  assert.equal(second.kind, 'ask');
  assert.deepEqual([askRound(second.ask), second.ask.chosen.length], [2, 1]);
  const v2 = askView(second.ask, nameOf);
  assert.deepEqual([v2.round, v2.last, v2.chosen], [2, false, ['街區A 少待 30 分（60→30）']]);
  assert.match(v2.why, /^還是排不下：午餐店 \d\d:\d\d 到的時候不在營業時間內（11:30–14:30）（還差 80 分）$/);
  assert.equal(v2.prompt, '再選一項（第 2 輪，最多 3 輪）：');
  const a2 = pick(v2, '街區C 少待 30 分（60→30）');
  assert.equal(a2.note, '還差 50 分，要再調一項');

  const third = chooseInsertOption(args, second.ask, a2.option);
  assert.equal(third.kind, 'ask');
  assert.equal(askRound(third.ask), INSERT_MAX_ROUNDS);
  const v3 = askView(third.ask, nameOf);
  assert.deepEqual([v3.round, v3.last, v3.chosen], [3, true, ['街區A 少待 30 分（60→30）', '街區C 少待 30 分（60→30）']]);
  assert.equal(v3.prompt, '最後一輪，只列選了就排得下的：');
  assert.ok(third.ask.trial.options.some((o) => !o.fits), '引擎這一輪還有選了也排不下的');
  assert.deepEqual(v3.more, [], '……最後一輪不列（不能再問了）');
  assert.ok(v3.fits.length >= 1 && v3.fits.every((r) => r.option.fits));
  assert.ok(v3.groups.flatMap((g) => g.rows).every((r) => r.option.fits), '兩組裡也只有排得下的');
  // 最後一輪硬選一個排不下的：不再問第四輪，原樣回
  const stuck = chooseInsertOption(args, third.ask, third.ask.trial.options.find((o) => !o.fits));
  assert.deepEqual([stuck.kind, stuck.ask], ['ask', third.ask]);

  const a3 = pick(v3, '大店 只待 190 分（原本 240 分）');
  const done = chooseInsertOption(args, third.ask, a3.option);
  assert.equal(done.kind, 'apply');
  assert.match(insertDoneText(done.result, nameOf), /^已把 大店 排成第一站（街區A 之前），後面順延 \d+ 分(?:（用掉留白 \d+ 分）)?；街區A 少待 30 分（60→30）；街區C 少待 30 分（60→30）；大店 只待 190 分（原本 240 分）$/);
  const after = planWorld(applyInsert(makeTrip(), THU, done.result))[THU].plan;
  assert.deepEqual(idsOf(after), [big.id, ...ORDER1], '套完：大店在最前面，原本六站一站不少、先後不變');
  assert.deepEqual(after.sequence.slice(0, 3).map((s) => s.dwellMin), [190, 30, 30]);
});

test('輪數由畫面數：先選某站少待、下一輪改成不去同一站，引擎只算一個調整，畫面照樣算問了兩次；已經套著的調整只列現在有效的那一個', () => {
  const args = argsOf(big, 0);
  const first = startInsert(args);
  const second = chooseInsertOption(args, first.ask, pick(askView(first.ask, nameOf), '街區A 少待 30 分（60→30）').option);
  const dropA = second.ask.trial.options.find((o) => o.kind === 'drop' && o.poiId === A.id);
  assert.ok(dropA && !dropA.fits, '第二輪有「不去 街區A」而且還排不下');
  const third = chooseInsertOption(args, second.ask, dropA);
  assert.equal(third.kind, 'ask');
  assert.equal(third.ask.trial.adjust.length, 1, '引擎：調整只有一個（不去 A 蓋掉 A 少待）');
  assert.equal(third.ask.trial.round, 3, '引擎的輪數 11-12 起照草稿記的走、不拿調整的個數算（之前這裡是 2）；畫面照舊自己數');
  assert.equal(askRound(third.ask), 3, '畫面：這是第三次問他');
  const v = askView(third.ask, nameOf);
  assert.deepEqual([v.last, v.chosen], [true, ['不去 街區A']]);
  assert.deepEqual(v.more, []);
});

test('一個能選的都沒有＝這一段插不進這家：只剩「算了，不插」；選項與復原列的字都不露鍵值', () => {
  const dead = askView({ trial: { round: 1, sequence: [{ poi: mid }], index: 0, conflicts: [{ msg: '中店 18:34 到的時候不在營業時間內（10:00–19:00）' }], blocked: { shortMin: 4 }, options: [] }, chosen: [] });
  assert.deepEqual([dead.dead, dead.prompt, dead.fits, dead.more], [true, '這一段插不進這家', [], []]);
  assert.equal(dead.why, '插進 中店 之後排不下：中店 18:34 到的時候不在營業時間內（10:00–19:00）（差 4 分）');
  const later = askView({ trial: { round: 2, sequence: [{ poi: mid }], index: 0, conflicts: [{ msg: '今天古著店已經 2 家，不是古著店主題日不再排' }, { msg: '今天古著店已經 2 家，不是古著店主題日不再排' }], blocked: { shortMin: null }, options: [] }, chosen: [{}] });
  assert.equal(later.prompt, '調到這裡還是排不下，這一段插不進這家');
  assert.equal(later.why, '還是排不下：今天古著店已經 2 家，不是古著店主題日不再排', '重複的句子只印一次；不是差幾分鐘的事不寫分鐘');
  // 選項的字
  const o = (kind, poi, fromMin, toMin, extra = {}) => ({ kind, poiId: poi.id, poi, fromMin, toMin, fits: false, shortMin: null, ...extra });
  assert.equal(optionLabel(o('shorten-new', big, 240, 120)), '大店 只待 120 分（原本 240 分）', '店名括號裡的註記拿掉');
  assert.equal(optionLabel(o('shorten', dinner, 60, 40)), '晚餐店 少待 20 分（60→40）');
  assert.equal(optionLabel(o('drop', C, 60, 0)), '不去 街區C');
  assert.equal(optionNote(o('drop', C, 60, 0)), '還排不下，要再調一項');
  assert.equal(optionNote(o('drop', C, 60, 0, { shortMin: 12 })), '還差 12 分，要再調一項');
  const fit = o('drop', C, 60, 0, { fits: true, shortMin: 0, result: { shiftMaxMin: 0, openSlotUsedMin: 20, openSlotUsedBeforeMin: 20, newWarnings: [{ msg: '今天沒排晚餐' }, { msg: '今晚沒排夜間站' }, { msg: '今天沒排午餐' }, { poiId: 'x', msg: '掛在某一站上的不列' }], revived: [B.id] } });
  assert.equal(optionNote(fit), '排得下，其餘各站的時刻不變');
  assert.equal(optionAdds(fit, nameOf), '會多一句：今天沒排晚餐、今晚沒排夜間站；原本排不進的 街區B 會排進來', '整天的黃字最多寫兩句');
  assert.deepEqual(adjustLabels({ poiId: big.id, adjust: [{ kind: 'shorten', poiId: big.id, fromMin: 240, toMin: 190 }, { kind: 'drop', poiId: bar.id }, { kind: 'shorten', poiId: lunch.id, fromMin: 60, toMin: 50 }] }, nameOf), ['大店 只待 190 分（原本 240 分）', '不去 酒吧', '午餐店 少待 10 分（60→50）']);
  // 讓位縮短的填站、跟著排進來的站也寫進復原列
  const text = insertDoneText({ sequence: [{ poi: small }], index: 0, poiId: small.id, between: { prev: null, next: null }, adjust: [], shiftMaxMin: 0, openSlotUsedMin: 0, openSlotUsedBeforeMin: 0, shrunk: [{ poiId: mid.id, fromMin: 44, toMin: 15 }], revived: [C.id] }, nameOf);
  assert.equal(text, '已把 小店 排進這天，其餘各站的時刻不變；中店 縮短成 15 分；原本排不進的 街區C 也排進來了');
  for (const s of [text, dead.why, later.why, ...Object.values(TEXT.insert).filter((x) => typeof x === 'string')]) assert.doesNotMatch(s, /undefined|\[object|NaN|null|shorten|drop|pinned/, s);
});

test('時刻那一句（11-12 畫面審查）：沒有站變晚、卻有站提早時（選了「不去某站」）寫「後面最多提早 N 分」，不寫「其餘各站的時刻不變」；有站變晚照舊寫順延；沒給 plan 就只看有沒有變晚', () => {
  // 畫面上那一版：A 09:05、C 10:10、B 11:40；試算的那一版：C 不去、小店插在 A 後面，B 提早 25 分，沒有站變晚
  const plan = { sequence: [{ poi: A, startMin: 545 }, { poi: C, startMin: 610 }, { poi: B, startMin: 700 }] };
  const result = { sequence: [{ poi: A, startMin: 545 }, { poi: small, startMin: 610 }, { poi: B, startMin: 675 }], index: 1, poiId: small.id, between: { prev: A, next: B }, adjust: [{ kind: 'drop', poiId: C.id }], shiftMaxMin: 0, openSlotUsedMin: 0, openSlotUsedBeforeMin: 0 };
  assert.equal(earlyMaxMin(result, plan), 25);
  assert.equal(earlyMaxMin({ result }, plan), 25, '選項物件（帶 result）也收');
  assert.deepEqual([earlyMaxMin(result), earlyMaxMin(result, null), earlyMaxMin(null, plan), earlyMaxMin({ sequence: plan.sequence }, plan)], [0, 0, 0, 0]);
  const option = { kind: 'drop', poiId: C.id, poi: C, fromMin: 60, toMin: 0, fits: true, shortMin: 0, result };
  assert.equal(optionNote(option, plan), '排得下，後面最多提早 25 分');
  assert.equal(optionNote(option), '排得下，其餘各站的時刻不變', '沒給 plan：照舊');
  assert.equal(optionNote({ ...option, result: { ...result, shiftMaxMin: 10 } }, plan), '排得下，後面最多順延 10 分、提早 25 分', '有站變晚、也有站提早：兩個都寫（11-17；之前只寫順延）');
  assert.equal(optionNote({ ...option, result: { ...result, shiftMaxMin: 10 } }), '排得下，後面最多順延 10 分', '只有站變晚（沒給 plan 就看不出提早）：照舊');
  assert.equal(optionNote({ ...option, result: { ...result, shiftMaxMin: 10, openSlotUsedMin: 42 } }, plan), '排得下，後面最多順延 10 分、提早 25 分，用掉留白 42 分');
  assert.equal(insertDoneText(result, nameOf, plan), '已把 小店 插在 街區A 和 街區B 之間，後面最多提早 25 分；不去 街區C');
  assert.equal(insertDoneText(result, nameOf), '已把 小店 插在 街區A 和 街區B 之間，其餘各站的時刻不變；不去 街區C');
  // askView 把 plan 交給每一列的後果
  const view = askView({ trial: { round: 1, sequence: result.sequence, index: 1, conflicts: [{ msg: 'x' }], blocked: { shortMin: 5 }, options: [option] }, chosen: [] }, nameOf, plan);
  assert.equal(view.fits[0].note, '排得下，後面最多提早 25 分');
  // 真的試算一次：THU 把中店插在酒吧前面、選「不去 酒吧」——酒吧是最後一站，其餘各站真的不動，照舊寫「時刻不變」
  const step = startInsert(argsOf(mid, 5));
  const real = askView(step.ask, nameOf, state.plans[THU].plan);
  assert.equal(pick(real, '不去 酒吧').note, '排得下，其餘各站的時刻不變');
});

test('選項分兩組怎麼排（11-17；原話 #194、#193）：要插的這家少待放「少待一點」的第一個（就算引擎把它排在後面）；某一組沒有選項就沒有那一組；引擎排的站標出來；短店名撞名（一樣、或一個是另一個的開頭）時兩家都用全名', () => {
  const stop = (poi, extra = {}) => ({ poi, dwellMin: 60, startMin: 600, insertedBy: null, ...extra });
  const res = { shiftMaxMin: 0, openSlotUsedMin: 0, openSlotUsedBeforeMin: 0 };
  const opt = (kind, poi, fromMin, toMin, fits = true) => ({ kind, poiId: poi.id, poi, fromMin, toMin, fits, shortMin: fits ? 0 : 7, result: res });
  // 兩家短店名一樣的（括號裡的註記不同）、一家是另一家的開頭（「瑞鳳殿」與「瑞鳳殿 盂蘭盆特別御開帳」那一種）
  const tomb = { id: 'tomb', name_zh: '靈廟（政宗公長眠之地）', category: 'mausoleum', highlight: '靈廟的簡介' };
  const fest = { id: 'fest', name_zh: '靈廟 夏季特別開帳', category: 'event', highlight: '開帳的簡介' };
  const drugA = { id: 'drugA', name_zh: '藥妝 拱廊店', category: 'drugstore', highlight: '藥妝A' };
  const drugB = { id: 'drugB', name_zh: '藥妝 拱廊店（實驗型態店）', category: 'drugstore', highlight: '藥妝B' };
  const sequence = [stop(big), stop(tomb, { insertedBy: 'engine', priority: 'onway' }), stop(fest), stop(drugA), stop(drugB), stop(A, { insertedBy: 'engine', priority: 'filler' })];
  const options = [
    opt('shorten', tomb, 60, 30), opt('shorten', fest, 240, 190), opt('drop', tomb, 60, 0), opt('drop', drugA, 30, 0), opt('drop', A, 60, 0),
    opt('shorten-new', big, 240, 120, false), opt('drop', drugB, 30, 0, false),
  ];
  const v = askView({ trial: { round: 1, sequence, index: 0, conflicts: [{ msg: 'x' }], blocked: { shortMin: 20 }, options }, chosen: [] }, nameOf);
  assert.deepEqual(v.groups.map((g) => [g.head, g.rows.map((r) => [r.name, r.mine, r.side, r.cat, r.engine, r.note])]), [
    ['少待一點', [
      ['大店', true, '240 → 120 分', null, false, '還差 7 分，要再調一項'],
      ['靈廟（政宗公長眠之地）', false, '60 → 30 分', null, true, '排得下，其餘各站的時刻不變'],
      ['靈廟 夏季特別開帳', false, '240 → 190 分', null, false, '排得下，其餘各站的時刻不變'],
    ]],
    ['這站不去', [
      ['靈廟（政宗公長眠之地）', false, null, '靈廟', true, '排得下，其餘各站的時刻不變'],
      ['藥妝 拱廊店', false, null, '藥妝', false, '排得下，其餘各站的時刻不變'],
      ['街區A', false, null, '街區', true, '排得下，其餘各站的時刻不變'],
      ['藥妝 拱廊店（實驗型態店）', false, null, '藥妝', false, '還差 7 分，要再調一項'],
    ]],
  ]);
  assert.deepEqual(v.groups[0].rows.map((r) => r.intro), [null, '靈廟的簡介', '開帳的簡介'], '要插的這家不重複附簡介');
  // 沒撞名的照舊用短名（括號裡的註記拿掉）：這天的站裡沒有另一個「靈廟…」
  const alone = sequence.filter((s) => s.poi !== fest);
  const plain = askView({ trial: { round: 1, sequence: alone, index: 0, conflicts: [{ msg: 'x' }], blocked: { shortMin: 20 }, options: [opt('shorten-new', big, 240, 120), opt('drop', tomb, 60, 0)] }, chosen: [] }, nameOf);
  assert.deepEqual(plain.groups.map((g) => [g.key, g.rows.map((r) => r.name)]), [['shorten', ['大店']], ['drop', ['靈廟']]]);
  // 同一家店的兩個選項（少待與不去）不算撞名
  const same = askView({ trial: { round: 1, sequence: alone, index: 0, conflicts: [{ msg: 'x' }], blocked: { shortMin: 20 }, options: [opt('shorten', tomb, 60, 30), opt('drop', tomb, 60, 0)] }, chosen: [] }, nameOf);
  assert.deepEqual(same.groups.flatMap((g) => g.rows.map((r) => r.name)), ['靈廟', '靈廟']);
  // 撞名看的是這天的每一站，不只這一塊列出來的選項（11-17 畫面審查）：另一個「靈廟…」不在選項裡、但在這天的行程裡，照樣寫全名——不然分不出是哪一個
  const oneOfPair = askView({ trial: { round: 1, sequence, index: 0, conflicts: [{ msg: 'x' }], blocked: { shortMin: 20 }, options: [opt('shorten-new', big, 240, 120), opt('drop', tomb, 60, 0)] }, chosen: [] }, nameOf);
  assert.deepEqual(oneOfPair.groups.map((g) => [g.key, g.rows.map((r) => r.name)]), [['shorten', ['大店']], ['drop', ['靈廟（政宗公長眠之地）']]]);
  // 只有一種選項：只出那一組
  const onlyDrop = askView({ trial: { round: 1, sequence, index: 0, conflicts: [{ msg: 'x' }], blocked: { shortMin: null }, options: [opt('drop', drugA, 30, 0)] }, chosen: [] }, nameOf);
  assert.deepEqual(onlyDrop.groups.map((g) => g.head), ['這站不去']);
  const onlyShorten = askView({ trial: { round: 1, sequence, index: 0, conflicts: [{ msg: 'x' }], blocked: { shortMin: 5 }, options: [opt('shorten', fest, 240, 190)] }, chosen: [] }, nameOf);
  assert.deepEqual(onlyShorten.groups.map((g) => g.head), ['少待一點']);
  assert.deepEqual(askView({ trial: { round: 1, sequence, index: 0, conflicts: [{ msg: 'x' }], blocked: { shortMin: 5 }, options: [] }, chosen: [] }, nameOf).groups, [], '一個選項都沒有：沒有任何一組');
  // 最後一輪：選了還不夠的不列，兩組裡也沒有
  const lastRound = askView({ trial: { round: 3, sequence, index: 0, conflicts: [{ msg: 'x' }], blocked: { shortMin: 20 }, options }, chosen: [{}, {}] }, nameOf);
  assert.deepEqual(lastRound.groups.map((g) => [g.head, g.rows.length]), [['少待一點', 2], ['這站不去', 3]]);
  for (const s of [TEXT.insert.groupShorten, TEXT.insert.groupDrop, TEXT.insert.mine, TEXT.insert.engineTag, TEXT.insert.dwellChange(90, 80)]) assert.doesNotMatch(s, /undefined|shorten|drop|engine|NaN/, s);
  assert.equal(TEXT.insert.dwellChange(90, 80), '90 → 80 分');
});

test('撞名的店在「已選：…」那一行與套用後的復原列也寫全名（11-17 畫面審查：之前只修了選項那一列，同一天有兩個「靈廟…」時分不出是哪一個）；復原列有站變晚也有站提早時兩個都寫', () => {
  const tomb = { id: 'tomb', name_zh: '靈廟（政宗公長眠之地）', category: 'mausoleum' };
  const fest = { id: 'fest', name_zh: '靈廟 夏季特別開帳', category: 'event' };
  const all = { ...pois, tomb, fest };
  const name = (id) => all[id]?.name_zh ?? id;
  const at = (poi, startMin, extra = {}) => ({ poi, startMin, dwellMin: 60, insertedBy: null, ...extra });
  // 畫面上那一版：A 09:05、靈廟（引擎排的）10:10、開帳 11:40、B 13:00
  const plan = { sequence: [at(A, 545), at(tomb, 610, { insertedBy: 'engine', priority: 'onway' }), at(fest, 700), at(B, 780)] };
  // 試算：小店插在 A 後面、不去靈廟——開帳提早 25 分、B 晚 10 分
  const dropped = { sequence: [at(A, 545), at(small, 610), at(fest, 675), at(B, 790)], index: 1, poiId: small.id, between: { prev: A, next: fest }, adjust: [{ kind: 'drop', poiId: tomb.id }], shiftMaxMin: 10, openSlotUsedMin: 0, openSlotUsedBeforeMin: 0 };
  assert.deepEqual(adjustLabels(dropped, name, plan), ['不去 靈廟（政宗公長眠之地）'], '不去的那一站已經不在試算的序列裡：拿畫面上那一版比');
  assert.equal(insertDoneText(dropped, name, plan), '已把 小店 插在 街區A 和 靈廟 夏季特別開帳 之間，後面最多順延 10 分、提早 25 分；不去 靈廟（政宗公長眠之地）');
  // 少待：兩個「靈廟…」都還在序列裡
  const shortened = { sequence: [at(A, 545), at(small, 610), at(tomb, 640), at(fest, 705), at(B, 785)], index: 1, poiId: small.id, between: { prev: A, next: tomb }, adjust: [{ kind: 'shorten', poiId: tomb.id, fromMin: 60, toMin: 30 }, { kind: 'shorten', poiId: fest.id, fromMin: 240, toMin: 190 }], shiftMaxMin: 30, openSlotUsedMin: 0, openSlotUsedBeforeMin: 0 };
  assert.deepEqual(adjustLabels(shortened, name, plan), ['靈廟（政宗公長眠之地） 少待 30 分（60→30）', '靈廟 夏季特別開帳 少待 50 分（240→190）']);
  assert.deepEqual(adjustLabels(shortened, name), ['靈廟（政宗公長眠之地） 少待 30 分（60→30）', '靈廟 夏季特別開帳 少待 50 分（240→190）'], '沒給畫面上那一版：拿試算的序列比');
  assert.equal(insertDoneText(shortened, name, plan), '已把 小店 插在 街區A 和 靈廟（政宗公長眠之地） 之間，後面順延 30 分；靈廟（政宗公長眠之地） 少待 30 分（60→30）；靈廟 夏季特別開帳 少待 50 分（240→190）');
  // 第二輪的「已選」那一行（askView().chosen）同一套
  const round2 = askView({ trial: { ...dropped, round: 2, conflicts: [{ msg: 'x' }], blocked: { shortMin: 5 }, options: [] }, chosen: [{}] }, name, plan);
  assert.deepEqual(round2.chosen, ['不去 靈廟（政宗公長眠之地）']);
  // 沒撞名的照舊用短名
  const lone = { sequence: [at(A, 545), at(small, 610), at(B, 790)], index: 1, poiId: small.id, between: { prev: A, next: B }, adjust: [{ kind: 'drop', poiId: tomb.id }], shiftMaxMin: 10, openSlotUsedMin: 0, openSlotUsedBeforeMin: 0 };
  assert.equal(insertDoneText(lone, name, { sequence: [at(A, 545), at(tomb, 610), at(B, 780)] }), '已把 小店 插在 街區A 和 街區B 之間，後面順延 10 分；不去 靈廟');
  // 那一句的三種寫法
  assert.deepEqual([TEXT.insert.shift(30, 0), TEXT.insert.shift(0, 13), TEXT.insert.shift(30, 13), TEXT.insert.shift(0, 0)], ['後面順延 30 分', '後面最多提早 13 分', '後面最多順延 30 分、提早 13 分', '其餘各站的時刻不變']);
});

test('第一輪沒有任何一個選了就排得下的選項：提示寫「單選一項不夠…」，不寫「選一個讓它排得下」（每顆鍵都寫還差幾分）；有排得下的照舊', () => {
  const o = (fits) => ({ kind: 'drop', poiId: C.id, poi: C, fromMin: 60, toMin: 0, fits, shortMin: fits ? 0 : 12, result: { shiftMaxMin: 0, openSlotUsedMin: 0, openSlotUsedBeforeMin: 0 } });
  const trial = (options) => ({ round: 1, sequence: [{ poi: mid }], index: 0, conflicts: [{ msg: 'x' }], blocked: { shortMin: 30 }, options });
  assert.equal(askView({ trial: trial([o(false), o(false)]), chosen: [] }).prompt, '單選一項不夠：先選一項，下一輪再調，或算了不插：');
  assert.equal(askView({ trial: trial([o(true), o(false)]), chosen: [] }).prompt, '選一個讓它排得下，或算了不插：');
  assert.equal(askView({ trial: trial([o(false)]), chosen: [{}] }).prompt, '再選一項（第 2 輪，最多 3 輪）：', '第二輪起照舊');
});
