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
  assert.deepEqual([v.round, v.last, v.dead, v.chosen, v.moreHead], [1, false, false, [], null]);
  assert.equal(v.why, '插進 中店 之後排不下：酒吧 待到 24:15，超過 24:00 關門；酒吧 會到 24:15，超過今天收工時間 24:00（差 15 分）');
  assert.equal(v.prompt, '選一個讓它排得下，或算了不插：');
  assert.deepEqual(v.fits.map((r) => [r.label, r.note, r.intro]), [
    ['中店 只待 105 分（原本 120 分）', '排得下，後面最多順延 90 分，用掉留白 90 分', null],
    ['酒吧 少待 15 分（150→135）', '排得下，後面最多順延 105 分，用掉留白 90 分', '酒吧的簡介'],
    ['不去 酒吧', '排得下，其餘各站的時刻不變', '酒吧的簡介'],
  ]);
  assert.deepEqual(v.more, []);
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
  const v1 = askView(first.ask, nameOf);
  assert.equal(v1.why, '插進 大店 之後排不下：午餐店 15:20 到的時候不在營業時間內（11:30–14:30）（差 110 分）');
  assert.ok(v1.fits.length >= 1 && v1.more.length >= 1, '第一輪：有排得下的、也有選了還不夠的');
  assert.equal(v1.moreHead, '下面這幾個選了還不夠，要再調一項：');
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
  assert.equal(v3.moreHead, null);
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
  assert.equal(optionNote({ ...option, result: { ...result, shiftMaxMin: 10 } }, plan), '排得下，後面最多順延 10 分', '有站變晚：寫順延');
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

test('第一輪沒有任何一個選了就排得下的選項：提示寫「單選一項不夠…」，不寫「選一個讓它排得下」（每顆鍵都寫還差幾分）；有排得下的照舊', () => {
  const o = (fits) => ({ kind: 'drop', poiId: C.id, poi: C, fromMin: 60, toMin: 0, fits, shortMin: fits ? 0 : 12, result: { shiftMaxMin: 0, openSlotUsedMin: 0, openSlotUsedBeforeMin: 0 } });
  const trial = (options) => ({ round: 1, sequence: [{ poi: mid }], index: 0, conflicts: [{ msg: 'x' }], blocked: { shortMin: 30 }, options });
  assert.equal(askView({ trial: trial([o(false), o(false)]), chosen: [] }).prompt, '單選一項不夠：先選一項，下一輪再調，或算了不插：');
  assert.equal(askView({ trial: trial([o(true), o(false)]), chosen: [] }).prompt, '選一個讓它排得下，或算了不插：');
  assert.equal(askView({ trial: trial([o(false)]), chosen: [{}] }).prompt, '再選一項（第 2 輪，最多 3 輪）：', '第二輪起照舊');
});
