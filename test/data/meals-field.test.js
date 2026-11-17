// 知識庫欄位 meals（能當哪一餐；src/data/schema.js MEALS_FIELD；11-06 第二批，原話 #195）：
// normalizePoi 原樣帶過、形狀不對記警告 meals-bad；打包再讀回來還在；kb-check 多一行統計、擋看不懂的值與「不是吃的類卻只寫 true」、還沒標的只提醒。
// 讀法（欄位優先、沒欄位照店型推導）的測試在 test/rules/meals.test.js。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizePoi, normalizeAll, MEALS_FIELD, mealsFieldProblems } from '../../src/data/schema.js';
import { buildPack, readPack } from '../../src/data/pack.js';
import { servesMeal, MEAL_KEYS } from '../../src/rules/_slots.js';
import { checkKb, formatReport, EATING_CATEGORIES } from '../../tools/kb-check.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const SENDAI = path.resolve(here, '../../../kb/sendai/data.json');   // 知識庫在私人倉庫，公開倉庫裡沒有；本機有才跑
const bad = (warnings) => warnings.filter((w) => w.code === 'meals-bad');

test('MEALS_FIELD：鍵只有 breakfast／lunch／dinner（跟引擎的 MEAL_KEYS 同一份）；mealsFieldProblems 逐項講哪裡看不懂', () => {
  assert.deepEqual([...MEALS_FIELD.keys], ['breakfast', 'lunch', 'dinner']);
  assert.deepEqual([...MEALS_FIELD.keys], [...MEAL_KEYS]);
  for (const ok of [undefined, null, {}, { lunch: true }, { breakfast: 'モーニング 7:30–11:00，厚片吐司套餐', lunch: true }, { dinner: '爐端燒與鄉土料理' }]) assert.deepEqual(mealsFieldProblems(ok), [], JSON.stringify(ok));
  for (const whole of [true, 'dinner', ['lunch'], 3]) {
    const p = mealsFieldProblems(whole);
    assert.equal(p.length, 1, JSON.stringify(whole));
    assert.match(p[0], /^meals 的值看不懂：/);
    assert.match(p[0], /鍵是 breakfast／lunch／dinner/);
  }
  assert.deepEqual(mealsFieldProblems({ diner: true, lunch: true }), ['meals 有看不懂的鍵 "diner"（只收 breakfast／lunch／dinner）']);
  assert.deepEqual(mealsFieldProblems({ lunch: false, dinner: '', breakfast: 1 }), [
    'meals.lunch 的值看不懂：false（要寫 true 或一句說明；不能當這一餐就不要列這個鍵）',
    'meals.dinner 的值看不懂：""（要寫 true 或一句說明；不能當這一餐就不要列這個鍵）',
    'meals.breakfast 的值看不懂：1（要寫 true 或一句說明；不能當這一餐就不要列這個鍵）',
  ]);
  assert.deepEqual(mealsFieldProblems({ dinner: '   ' }).length, 1, '全是空白的說明也算沒寫');
});

test('normalizePoi 原樣帶過 meals；沒寫不補；形狀不對記警告 meals-bad、值不改；打包再讀回來欄位還在', () => {
  const raw = { name_zh: 'Cafe de 埃比昂', name_local: 'Cafe de エビアン', category: '喫茶店文化', meals: { breakfast: 'モーニング 7:30–11:00，厚片吐司套餐', lunch: true } };
  const r = normalizePoi(raw);
  assert.deepEqual(r.poi.meals, raw.meals);
  assert.deepEqual(bad(r.warnings), []);
  assert.equal(servesMeal(r.poi, 'breakfast'), 'モーニング 7:30–11:00，厚片吐司套餐');
  const none = normalizePoi({ name_zh: '珈巣多夢', category: '自家焙煎老舖喫茶', meals: {} });
  assert.deepEqual(none.poi.meals, {}, '{}＝明講不是吃正餐的地方，照帶');
  assert.deepEqual(bad(none.warnings), []);
  const plain = normalizePoi({ name_zh: 'Utah', category: '古著店' }).poi;
  assert.equal('meals' in plain, false, '沒寫就不補');
  assert.deepEqual(bad(normalizePoi({ name_zh: '寫 null 的店', category: '定食', meals: null }).warnings), [], 'null＝沒寫');
  const broken = normalizePoi({ name_zh: '寫壞的店', category: '定食', meals: { lunch: 'ok', diner: true, dinner: false } });
  assert.deepEqual(bad(broken.warnings).map((w) => [w.poiId, w.field]), [['寫壞的店', 'meals'], ['寫壞的店', 'meals']]);
  assert.match(bad(broken.warnings)[0].msg, /看不懂的鍵 "diner"/);
  assert.doesNotMatch(bad(broken.warnings).map((w) => w.msg).join('\n'), /undefined|\[object Object\]/);
  assert.deepEqual(broken.poi.meals, { lunch: 'ok', diner: true, dinner: false }, '不丟、不改');
  assert.deepEqual([servesMeal(broken.poi, 'lunch'), servesMeal(broken.poi, 'dinner')], ['ok', false], '讀的那邊把看不懂的值當不能');
  const whole = normalizePoi({ name_zh: '整個寫壞', category: '定食', meals: 'dinner' });
  assert.equal(bad(whole.warnings).length, 1);
  assert.equal(whole.poi.meals, 'dinner');
  assert.notEqual(servesMeal(whole.poi, 'dinner'), false, '整個欄位不是物件當沒寫、走店型推導（食堂算晚餐）');
  // 打包再讀回來（手機端 readPack 會再過一次 normalizePoi）
  const pack = buildPack({ city: { id: 'x', name_zh: '某城' }, country: null, pois: [r.poi, none.poi, plain], trip: { id: 't', days: [] } });
  const back = readPack(JSON.stringify(pack));
  assert.deepEqual(back.pois.map((p) => p.meals), [raw.meals, {}, undefined]);
  assert.deepEqual(bad(back.warnings), []);
});

test('kb-check：多一行「能當哪一餐」——吃的類幾站、標了幾站、各餐幾家、沒標的照推導會算成什麼；值看不懂與不是吃的類只寫 true 的擋下來，沒標的只提醒', () => {
  assert.deepEqual(EATING_CATEGORIES, ['food', 'bar', 'cafe']);
  const base = { area: '北町（北町1-1）', hours: '9:00-22:00' };
  const row = (name_zh, category, over = {}) => ({ name_zh, name_local: name_zh, category, maps_query: name_zh, ...base, ...over });
  const marked = [
    row('甲食堂', '定食', { meals: { lunch: true, dinner: true } }),
    row('乙喫茶', '喫茶', { meals: { breakfast: '到 11:00 的早餐套餐', lunch: '拿坡里義大利麵套餐' } }),
    row('丙喫茶', '喫茶', { meals: {} }),
    row('丁居酒屋', '居酒屋', { meals: { dinner: '爐端燒與鄉土料理' } }),
    row('戊神社', '神社'),
  ];
  const s = checkKb({ data: { categories: { x: { items: marked } } } });
  assert.deepEqual(s.meals, { eating: 4, annotated: 4, byMeal: { breakfast: 1, lunch: 2, dinner: 2 }, none: 1, derived: { count: 0, byMeal: { breakfast: 0, lunch: 0, dinner: 0 }, none: 0 }, unmarked: [], bad: [], bareTrue: [] });
  assert.equal(s.verdict.ok, true, s.verdict.blocking.join(' / '));
  const report = formatReport(s);
  assert.match(report, /^能當哪一餐（meals）：吃的類 4 站，標了 4（早餐 1、午餐 2、晚餐 2、三餐都不算 1）$/m);
  assert.equal(report.split('\n').at(-1), '結論：可以打包');
  // 還沒標的：照店型推導會算成什麼列出來，只提醒不擋
  const unmarked = [row('甲食堂', '定食'), row('乙喫茶', '喫茶'), row('丙居酒屋', '居酒屋'), row('丁吧台', '日本酒バー'), row('己甜點', '甜點'), row('庚祭典', '祭典', { meal: true })];
  const u = checkKb({ data: { categories: { x: { items: unmarked } } } });
  assert.deepEqual([u.meals.eating, u.meals.annotated, u.meals.derived], [6, 0, { count: 6, byMeal: { breakfast: 0, lunch: 2, dinner: 3 }, none: 3 }]);
  assert.deepEqual(u.meals.unmarked, ['甲食堂［午餐、晚餐］', '乙喫茶［都不算］', '丙居酒屋［晚餐］', '丁吧台［都不算］', '己甜點［都不算］', '庚祭典［午餐、晚餐］']);
  assert.equal(u.verdict.ok, true, '沒標不擋打包');
  assert.ok(u.verdict.notes.some((n) => /^6 站吃的類還沒標能當哪一餐（meals），引擎照店型推導/.test(n)), u.verdict.notes.join(' / '));
  assert.match(formatReport(u), /^能當哪一餐（meals）：吃的類 6 站，標了 0；沒標 6 站照店型推導（早餐 0、午餐 2、晚餐 3、都不算 3）：甲食堂［午餐、晚餐］、乙喫茶［都不算］/m);
  // 寫壞的與只寫 true 的咖啡廳、酒吧：擋
  const broken = [
    row('甲食堂', '定食', { meals: { lunch: true, diner: true } }),
    row('乙喫茶', '喫茶', { meals: { lunch: true } }),
    row('丙居酒屋', '居酒屋', { meals: { dinner: true, lunch: '午間定食' } }),
    row('丁食堂', '定食', { meals: 'dinner' }),
  ];
  const b = checkKb({ data: { categories: { x: { items: broken } } } });
  assert.deepEqual(b.meals.bad, ['甲食堂［meals 有看不懂的鍵 "diner"（只收 breakfast／lunch／dinner）］', `丁食堂［meals 的值看不懂："dinner"（${MEALS_FIELD.expect}）］`]);
  assert.deepEqual(b.meals.bareTrue, ['乙喫茶［午餐只寫 true］', '丙居酒屋［晚餐只寫 true］'], '吃的類寫 true 沒問題；咖啡廳、酒吧要寫一句說明（原話 #195「如果可以那也應該在簡介裡提及」）');
  assert.equal(b.verdict.ok, false);
  assert.deepEqual(b.verdict.blocking, ['能當哪一餐（meals）的值看不懂 2 處（照 src/data/schema.js MEALS_FIELD 改）', '2 筆不是吃的類卻只寫 true、沒有說明（咖啡廳、酒吧、攤位能當一餐要寫一句是怎麼個能法，畫面會顯示）']);
  assert.match(formatReport(b), /；值看不懂 2：甲食堂［.*；不是吃的類卻只寫 true 2：乙喫茶［午餐只寫 true］、丙居酒屋［晚餐只寫 true］$/m);
  assert.match(formatReport(b).split('\n').at(-1), /^結論：先補這些：能當哪一餐（meals）的值看不懂 2 處/);
  // 沒有吃的類的知識庫
  const none = checkKb({ data: { categories: { x: { items: [row('戊神社', '神社')] } } } });
  assert.match(formatReport(none), /^能當哪一餐（meals）：沒有吃的類的站$/m);
  assert.equal(none.verdict.ok, true);
});

test('仙台知識庫（本機有才跑）：meals 欄位寫了的都看得懂、不是吃的類的都有說明（標了沒標都過——標註由文件段另外寫進去）', { skip: !existsSync(SENDAI) && '本機沒有 kb/sendai/data.json' }, async () => {
  const kb = JSON.parse(await readFile(SENDAI, 'utf8'));
  const list = Object.values(kb.categories).flatMap((v) => (Array.isArray(v) ? v : v.items ?? []));
  assert.deepEqual(bad(normalizeAll(list).warnings), []);
  const s = checkKb({ data: kb });
  assert.deepEqual(s.meals.bad, []);
  assert.deepEqual(s.meals.bareTrue, []);
  assert.ok(s.meals.eating >= 39, `吃的類 ${s.meals.eating} 站`);
  assert.equal(s.meals.annotated + s.meals.derived.count, s.meals.eating);
});
