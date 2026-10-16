// T3：整天層級的規則（主行程必排、指定行程缺席罰、主題日不連兩天、餐段、夜間站）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stop, ctx, run, warnOf, rules } from './_fixtures.js';
import { evaluateDay } from '../../src/engine/evaluate.js';

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

test('evaluateDay 把 day scope 的規則一起算', () => {
  const r = evaluateDay(ctx(null, { sequence: [shrine], day: { anchorPoiId: 'osaki', designated: ['utah'] } }), rules);
  assert.equal(r.verdict, 'ok');
  assert.equal(r.penaltyMin, 120 + 40 + 10);
  assert.deepEqual(r.breakdown.map((b) => b.ruleId).sort(), ['designated', 'meal-slots', 'night-slot']);
});
