// T26 需求單的純資料層：空單合法、任何 JSON 都讀得出一份合法的單子（缺欄位補、型別錯丟、舊版草案與手打中文翻得過來）、
// 輸出的文字照 docs/brief-template.md 的五段與每列、記憶（消耗品與要買的）與建議、匯出再匯入不變。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyBrief, normalizeBrief, briefToMarkdown, briefFileName, toList, looksLikeBrief, isBriefEmpty, themeOptions } from '../../src/data/brief.js';
import { emptyMemory, normalizeMemory, rememberFromBrief, suggestionsFor } from '../../src/data/brief-memory.js';

/** 填好的一份（已是 normalize 後的形狀）：仙台七天、有公務、一位同行者、兩筆代購（一筆消耗品）、兩件要辦的事。 */
function filled() {
  return {
    version: 1,
    city: '仙台',
    dates: { from: '2026-08-12', to: '2026-08-18' },
    flights: { arriveHM: '10:30', departHM: '18:00' },
    lodging: '東横INN 仙台東口',
    purpose: 'work',
    workNote: '8/14 09:30–19:30 研討會',
    fixedWindows: [{ date: '2026-08-16', startHM: '18:30', endHM: '20:00', label: '松島花火' }],
    mode: 'transit',
    modeNote: '',
    dayTrips: { count: 1, direction: '松島' },
    themeDays: [{ date: '2026-08-17', category: 'vintage' }],
    departureNote: '第三天睡飽',
    persons: [
      { id: 'me', name: '我', isMe: true, partialDays: '', go: { designated: ['Utah', '神社（求長壽健康的御守給朋友）'], mustEat: ['味太助'], themes: ['hanabi'], themeOther: '' }, buy: { own: ['咖啡豆'], brandExceptions: ['Kapital'] }, adjustments: { stamina: 'normal', nightSlot: 'default', dislikes: '' } },
      { id: 'p-gf', name: '女友', isMe: false, partialDays: '8/14–16', go: { designated: ['Loft'], mustEat: [], themes: [], themeOther: '' }, buy: { own: ['睫毛膏'], brandExceptions: [] }, adjustments: { stamina: 'easy', nightSlot: 'less', dislikes: '不想逛古著' } },
    ],
    errands: [
      { id: 'e1', for: '媽', what: '睫毛膏', qty: '2', note: 'KISSME 黑', consumable: true },
      { id: 'e2', for: '同事', what: 'Red Wing 8875', qty: '1', note: '27cm', consumable: false },
    ],
    tasks: [
      { id: 't1', what: '領 JR Pass', deadline: '2026-08-13T10:00', who: 'me' },
      { id: 't2', what: '換 SIM', deadline: '', who: '' },
    ],
    updatedAt: '2026-10-16T01:02:03.000Z',
  };
}

test('emptyBrief 是合法的單子：normalize 再過一次一模一樣（直接與過 JSON 都是）；只有他一段、isMe、叫「我」', () => {
  const b = emptyBrief();
  assert.deepEqual(normalizeBrief(b), b);
  assert.deepEqual(normalizeBrief(JSON.parse(JSON.stringify(b))), b);
  assert.equal(b.persons.length, 1);
  assert.equal(b.persons[0].isMe, true);
  assert.equal(b.persons[0].name, '我');
  assert.equal(b.purpose, 'play');
  assert.equal(b.mode, 'transit');
  assert.equal(b.dayTrips.count, null);
});

test('normalizeBrief 容錯：不是物件→空單；缺欄位補預設；型別錯就丟掉那個值、旁邊對的留著；列裡不是物件的丟掉；主題日類別認不得整列丟、沒寫補古著', () => {
  for (const junk of [null, undefined, 'x', 42, [], true]) assert.deepEqual(normalizeBrief(junk), emptyBrief(), String(junk));
  const b = normalizeBrief({
    city: 123, dates: { from: '8/12', to: '2026-08-18' }, flights: 'x', purpose: 'party', mode: 7, dayTrips: { count: -1, direction: 5 },
    fixedWindows: [{ date: '2026-08-16', startHM: '18:30', endHM: 'late', label: 7 }, 'junk', null],
    themeDays: [{ date: '2026-08-17', category: 'bookstore' }, { date: '2026-08-18', category: '書店' }, { date: '2026-08-19' }, { date: 'bad', category: '' }],
    persons: 'nope',
    errands: [{ for: '媽', what: '睫毛膏', qty: 2, consumable: 'yes' }, 3],
    tasks: ['換 SIM', { what: '領票', deadline: 'tomorrow', who: 'ghost' }],
    updatedAt: 'not a date',
  });
  assert.equal(b.city, '');
  assert.deepEqual(b.dates, { from: '', to: '2026-08-18' });
  assert.deepEqual(b.flights, { arriveHM: '', departHM: '' });
  assert.equal(b.purpose, 'play');
  assert.equal(b.mode, 'transit');
  assert.deepEqual(b.dayTrips, { count: null, direction: '' });
  assert.deepEqual(b.fixedWindows, [{ date: '2026-08-16', startHM: '18:30', endHM: '', label: '' }]);
  assert.deepEqual(b.themeDays, [{ date: '2026-08-19', category: 'vintage' }, { date: '', category: 'vintage' }], '認不得的類別不會變成古著（那是整天的排程指令），整列丟掉；沒寫的補預設');
  assert.equal(b.persons.length, 1);
  assert.equal(b.persons[0].isMe, true);
  assert.equal(b.persons[0].partialDays, '');
  assert.equal(b.errands.length, 1);
  assert.deepEqual({ ...b.errands[0], id: null }, { id: null, for: '媽', what: '睫毛膏', qty: '2', note: '', consumable: false });
  assert.ok(typeof b.errands[0].id === 'string' && b.errands[0].id);
  assert.deepEqual(b.tasks.map((t) => ({ what: t.what, deadline: t.deadline, who: t.who })), [{ what: '換 SIM', deadline: '', who: '' }, { what: '領票', deadline: '', who: '' }]);
  assert.notEqual(b.tasks[0].id, b.tasks[1].id);
  assert.equal(b.updatedAt, '');
  assert.deepEqual(normalizeBrief(b), b, '再 normalize 一次不變');
});

test('persons 的不變量：他永遠在第一段；沒人標 isMe 就第一個是他；標在第二個就搬到前面；沒名字叫「我」；id 撞到重發；只有一個 isMe', () => {
  const a = normalizeBrief({ persons: [{ name: '女友' }, { name: '' }] });
  assert.deepEqual(a.persons.map((p) => [p.name, p.isMe]), [['女友', true], ['', false]]);
  const b = normalizeBrief({ persons: [{ id: 'gf', name: '女友' }, { id: 'me', name: '', isMe: true }, { id: 'gf', name: '同學' }] });
  assert.deepEqual(b.persons.map((p) => [p.name, p.isMe]), [['我', true], ['女友', false], ['同學', false]]);
  assert.equal(b.persons[0].id, 'me');
  assert.equal(new Set(b.persons.map((p) => p.id)).size, 3);
});

test('舊版草案（DESIGN §4：go／buy／party／adjustments 在頂層）翻成以人為單位：night、areas、recommended 併進 designated 並去重，party.designated 成一位同行者，party.errands 成代購，dayTrips／departureNote／routeIdea 搬上來', () => {
  const b = normalizeBrief({
    holiday: '中秋',
    go: { designated: ['Utah', '清酒吧'], night: ['清酒吧'], areas: ['下北澤'], recommended: ['朋友推薦的 XX'], mustEat: ['味太助'], themes: ['sakura', '花火', 'bogus', '雪祭', 'Momiji '] },
    buy: { own: ['咖啡豆'], brandExceptions: ['Kapital'] },
    party: { designated: ['Loft'], errands: [{ for: '媽', what: '睫毛膏', consumable: true }] },
    adjustments: { dayTrips: 2, stamina: 'easy', departureNote: '睡飽', nightSlot: 'less', dislikes: '神社' },
    routeIdea: '順時針',
  });
  assert.deepEqual(b.persons[0].go.designated, ['Utah', '清酒吧', '下北澤', '朋友推薦的 XX']);
  assert.deepEqual(b.persons[0].go.mustEat, ['味太助']);
  assert.deepEqual(b.persons[0].go.themes, ['sakura', 'hanabi', 'bogus', 'momiji'], '英數的 id 照留（主題清單是國家層的，手機讀入那一刻不一定知道是哪國；T20）、中文翻回 id、不像 id 的中文丟掉、大小寫與空白整理');
  assert.deepEqual(b.persons[0].buy, { own: ['咖啡豆'], brandExceptions: ['Kapital'] });
  assert.deepEqual(b.persons[0].adjustments, { stamina: 'easy', nightSlot: 'less', dislikes: '神社' });
  assert.equal(b.persons.length, 2);
  assert.equal(b.persons[1].isMe, false);
  assert.deepEqual(b.persons[1].go.designated, ['Loft']);
  assert.equal(b.dayTrips.count, 2);
  assert.equal(b.departureNote, '睡飽');
  assert.equal(b.modeNote, '順時針');
  assert.equal(b.errands.length, 1);
  assert.equal(b.errands[0].consumable, true);
});

test('手打的 JSON：中文寫的目的、移動、主題日類別、體力、夜間站翻回鍵值；清單寫成一段文字拆成一行一項；要辦的事的「誰」寫名字對回 id、對不到就空', () => {
  const b = normalizeBrief({
    purpose: '有公務', mode: '租車', themeDays: [{ date: '2026-08-17', category: '古著' }, { date: '2026-08-18', category: '咖啡廳' }],
    persons: [
      { name: '我', isMe: true, go: { designated: 'Utah\n唱片行\n\n  ', themes: '櫻花\n雪' }, adjustments: { stamina: '輕鬆一點', nightSlot: '不排' } },
      { id: 'gf', name: '女友' },
    ],
    tasks: ['換 SIM', { what: '改褲長', deadline: '2026-08-14T08:00', who: '女友' }, { what: '寄明信片', deadline: '2026-08-15', who: '阿貓' }],
  });
  assert.equal(b.purpose, 'work');
  assert.equal(b.mode, 'car');
  assert.deepEqual(b.themeDays.map((t) => t.category), ['vintage', 'cafe']);
  assert.deepEqual(b.persons[0].go.designated, ['Utah', '唱片行']);
  assert.deepEqual(b.persons[0].go.themes, ['sakura', 'snow']);
  assert.deepEqual(b.persons[0].adjustments, { stamina: 'easy', nightSlot: 'none', dislikes: '' });
  assert.deepEqual(b.tasks.map((t) => [t.what, t.deadline, t.who]), [['換 SIM', '', ''], ['改褲長', '2026-08-14T08:00', 'gf'], ['寄明信片', '2026-08-15', '']]);
  assert.deepEqual(toList(' a \n\nb\n'), ['a', 'b']);
  assert.deepEqual(toList(['a', 1, null, ' b ']), ['a', 'b']);
  assert.deepEqual(toList(42), []);
});

test('briefToMarkdown 照模板：五個段落標題照順序、骨架表每列都在、每人一段（2.1／2.2／2.3、同行者 3.x）、代購表、要辦的事帶期限與誰', () => {
  const md = briefToMarkdown(filled());
  const heads = ['## 1. 這趟的骨架', '## 2. 我', '## 3. 同行者：女友', '## 4. 別人的（代購）', '## 5. 要辦的事'];
  const at = heads.map((h) => md.indexOf(`\n${h}\n`));
  assert.ok(at.every((i, k) => i >= 0 && (k === 0 || i > at[k - 1])), `標題與順序：${at}`);
  for (const k of ['城市', '天數／日期', '航班', '住宿', '同行者', '主要目的', '固定時段', '這趟怎麼移動', '一日遊', '主題日', '出門時間']) assert.match(md, new RegExp(`^\\| ${k}`, 'm'), k);
  assert.ok(md.includes('| 城市（主據點第一個） | 仙台 |'));
  assert.ok(md.includes('| 天數／日期 | 2026-08-12–2026-08-18 |'));
  assert.ok(md.includes('| 航班：落地時間、回程起飛時間 | 落地時間 10:30、回程起飛時間 18:00 |'));
  assert.ok(md.includes('| 同行者 | 女友（8/14–16） |'), '只同行部分天數寫在名字後面（模板 §1 同行者列）');
  assert.ok(md.includes('| 主要目的 | 有公務：8/14 09:30–19:30 研討會 |'));
  assert.ok(md.includes('| 固定時段 | 2026-08-16 18:30–20:00 松島花火 |'));
  assert.ok(md.includes('| 這趟怎麼移動 | 大眾運輸 |'));
  assert.ok(md.includes('| 一日遊 | 想去 1 天，方向：松島 |'));
  assert.ok(md.includes('| 主題日 | 2026-08-17 古著 |'));
  assert.ok(md.includes('| 出門時間 | 第三天睡飽 |'));
  assert.ok(md.includes('### 2.1 要去的（指定行程：點名就排）') && md.includes('  - Utah\n  - 神社（求長壽健康的御守給朋友）') && md.includes('- 一定要吃到的：\n  - 味太助'));
  assert.ok(md.includes('☐ 櫻花') && md.includes('☑ 花火') && md.includes('☐ 其他：＿＿'));
  assert.ok(md.includes('### 2.2 要買的（品項）') && md.includes('  - 咖啡豆') && md.includes('- 這趟臨時加的例外品牌：\n  - Kapital'));
  assert.ok(md.includes('### 2.3 這趟的調整（只影響這趟）') && md.includes('| 體力 | 正常 |') && md.includes('| 夜間站 | 照預設每晚 |'));
  assert.ok(md.includes('### 3.1 要去的') && md.includes('  - Loft') && md.includes('| 體力 | 輕鬆一點 |') && md.includes('| 夜間站 | 少排 |') && md.includes('| 這趟不想要的 | 不想逛古著 |'));
  assert.ok(md.includes('| 給誰 | 什麼 | 數量 | 備註 | 消耗品 |'));
  assert.ok(md.includes('| 媽 | 睫毛膏 | 2 | KISSME 黑 | 是 |') && md.includes('| 同事 | Red Wing 8875 | 1 | 27cm |  |'));
  assert.ok(md.includes('- 領 JR Pass（期限 2026-08-13T10:00；誰：我）') && md.includes('- 換 SIM\n'));
  assert.ok(md.includes('更新：2026-10-16T01:02:03.000Z'));
  assert.doesNotMatch(md, /undefined|\[object Object\]|null|NaN/);
});

test('空單的文字：五個標題仍在、骨架表每列留空而不是省略、沒同行者寫一句、代購表一列空、要辦的事一個空點；格子裡的直欄線換成全形', () => {
  const md = briefToMarkdown(emptyBrief());
  for (const h of ['## 1. 這趟的骨架', '## 2. 我', '## 3. 同行者', '## 4. 別人的（代購）', '## 5. 要辦的事']) assert.ok(md.includes(`\n${h}\n`), h);
  assert.ok(md.includes('| 城市（主據點第一個） |  |') && md.includes('| 住宿 |  |') && md.includes('| 出門時間 |  |') && md.includes('| 固定時段 |  |'));
  assert.ok(md.includes('| 主要目的 | 純玩 |') && md.includes('| 這趟怎麼移動 | 大眾運輸 |'));
  assert.ok(md.includes('## 3. 同行者\n\n（這趟沒有同行者）'));
  assert.ok(md.includes('- 要去的：\n  -\n- 一定要吃到的：\n  -\n'));
  assert.ok(md.includes('| | | | | |'));
  assert.ok(md.includes('## 5. 要辦的事\n\n-\n'));
  assert.doesNotMatch(md, /undefined|\[object Object\]|null|NaN|更新：/);
  const tricky = briefToMarkdown({ ...filled(), lodging: 'A | B\nC' });
  assert.ok(tricky.includes('| 住宿 | A ｜ B C |'));
});

test('文字的邊角照模板的空格「＿＿」：沒名字的同行者、只填一邊的日期、要辦的事沒寫「什麼」只有期限；不印成「同行者：同行者」', () => {
  const md = briefToMarkdown({ dates: { from: '2026-08-12' }, persons: [{ id: 'me', isMe: true }, { id: 'p2', name: '' }], tasks: [{ what: '', deadline: '2026-08-13T10:00', who: 'p2' }] });
  assert.ok(md.includes('| 天數／日期 | 2026-08-12–＿＿ |'), md);
  assert.ok(md.includes('| 同行者 | ＿＿ |'));
  assert.ok(md.includes('\n## 3. 同行者：＿＿\n'));
  assert.ok(md.includes('- ＿＿（期限 2026-08-13T10:00；誰：＿＿）'));
  assert.ok(!md.includes('同行者：同行者'));
  assert.ok(briefToMarkdown({ dates: { to: '2026-08-18' } }).includes('| 天數／日期 | ＿＿–2026-08-18 |'));
});

test('looksLikeBrief：「從檔案載入」只收需求單形狀的 JSON——旅程檔（days、homeBases）、打包檔（meta／pois／trip）、{}、陣列都拒收；空單、填好的、舊版草案都收', () => {
  assert.equal(looksLikeBrief({ _說明: '', id: '2026-08-sendai', name: '仙台', cityName: '仙台', countryId: 'jp', party: 1, homeBases: [], days: [] }), false, '旅程檔');
  assert.equal(looksLikeBrief({ meta: { format: 'trip-pilot-pack' }, city: { id: 'sendai' }, country: {}, zones: {}, pois: [], walk: {}, trip: { id: 'x' }, rules: {} }), false, '打包檔（有 city 也不算）');
  for (const junk of [{}, [], null, 'x', 42, { foo: 1 }]) assert.equal(looksLikeBrief(junk), false, JSON.stringify(junk));
  assert.equal(looksLikeBrief(emptyBrief()), true);
  assert.equal(looksLikeBrief(JSON.parse(JSON.stringify(filled()))), true);
  assert.equal(looksLikeBrief({ city: '仙台' }), true, '手打的最小單');
  assert.equal(looksLikeBrief({ go: { designated: ['Utah'] }, buy: {} }), true, 'DESIGN §4 草案');
});

test('isBriefEmpty：空單、normalize 出來的空單、只有 updatedAt 的都算空；改了任何欄位就不算', () => {
  assert.equal(isBriefEmpty(emptyBrief()), true);
  assert.equal(isBriefEmpty(normalizeBrief({})), true);
  assert.equal(isBriefEmpty({ ...emptyBrief(), updatedAt: '2026-10-16T00:00:00.000Z' }), true);
  assert.equal(isBriefEmpty({ ...emptyBrief(), purpose: 'work' }), false);
  assert.equal(isBriefEmpty({ ...emptyBrief(), city: '仙台' }), false);
  assert.equal(isBriefEmpty(filled()), false);
});

test('記憶：代購裡勾消耗品的（給誰、什麼、備註）與他自己要買的記進去，沒勾的不記、同行者要買的不記（模板 §3：不進你的偏好檔）；同人同品項只留最新（備註與時間蓋掉、筆數不變）；大小寫與空白不算差異；不動傳進來的', () => {
  const m1 = rememberFromBrief(emptyMemory(), filled(), '2026-10-01T00:00:00.000Z');
  assert.deepEqual(m1.consumables, [{ for: '媽', what: '睫毛膏', note: 'KISSME 黑', lastAt: '2026-10-01T00:00:00.000Z' }]);
  assert.deepEqual(m1.ownItems, [{ what: '咖啡豆', lastAt: '2026-10-01T00:00:00.000Z' }], '女友要買的睫毛膏不進他的記憶');
  const again = filled();
  again.errands[0].note = 'KISSME 棕';
  again.errands.push({ id: 'e3', for: '媽', what: '藥膏', qty: '1', note: '', consumable: true });
  const m2 = rememberFromBrief(m1, again, '2026-10-16T00:00:00.000Z');
  assert.deepEqual(m2.consumables, [
    { for: '媽', what: '睫毛膏', note: 'KISSME 棕', lastAt: '2026-10-16T00:00:00.000Z' },
    { for: '媽', what: '藥膏', note: '', lastAt: '2026-10-16T00:00:00.000Z' },
  ]);
  assert.equal(m1.consumables[0].note, 'KISSME 黑', '不動傳進來的');
  const m3 = rememberFromBrief(m2, { errands: [{ for: ' 媽', what: 'kissme 睫毛膏', consumable: true }, { for: '媽 ', what: '睫毛膏 ', consumable: true }], persons: [{ buy: { own: ['咖啡豆 ', '馬皮 riders'] } }, { buy: { own: ['睫毛膏'] } }] }, '2026-10-17T00:00:00.000Z');
  assert.equal(m3.consumables.length, 3);
  assert.equal(m3.consumables.find((c) => c.what === '睫毛膏').lastAt, '2026-10-17T00:00:00.000Z');
  assert.deepEqual(m3.ownItems, [{ what: '咖啡豆', lastAt: '2026-10-17T00:00:00.000Z' }, { what: '馬皮 riders', lastAt: '2026-10-17T00:00:00.000Z' }], '沒人標 isMe 就第一段是他；第二段的不記');
  assert.deepEqual(rememberFromBrief(null, null, '2026-10-17T00:00:00.000Z'), emptyMemory());
});

test('建議：排掉已在這份需求單裡的（代購看給誰＋什麼、要買的看他自己的要買的，同行者寫了不算），最近的排前面；全都在單子裡就空；記憶壞掉也不炸', () => {
  const memory = {
    consumables: [
      { for: '媽', what: '睫毛膏', note: '', lastAt: '2026-01-01T00:00:00.000Z' },
      { for: '媽', what: '藥膏', note: '', lastAt: '2026-06-01T00:00:00.000Z' },
      { for: '姊', what: '睫毛膏', note: '', lastAt: '2026-03-01T00:00:00.000Z' },
    ],
    ownItems: [{ what: '咖啡豆', lastAt: '2026-01-01T00:00:00.000Z' }, { what: '馬皮 riders', lastAt: '2026-05-01T00:00:00.000Z' }],
  };
  const s = suggestionsFor(memory, filled());
  assert.deepEqual(s.consumables.map((c) => `${c.for}:${c.what}`), ['媽:藥膏', '姊:睫毛膏']);
  assert.deepEqual(s.ownItems.map((o) => o.what), ['馬皮 riders']);
  const b = filled();
  b.errands.push({ id: 'x', for: '媽', what: '藥膏', qty: '', note: '', consumable: false }, { id: 'y', for: '姊', what: '睫毛膏', qty: '', note: '', consumable: true });
  b.persons[1].buy.own.push('馬皮 riders');
  assert.deepEqual(suggestionsFor(memory, b).ownItems.map((o) => o.what), ['馬皮 riders'], '女友寫了不算他寫了，建議還在');
  b.persons[0].buy.own.push('馬皮 riders');
  assert.deepEqual(suggestionsFor(memory, b), { consumables: [], ownItems: [] });
  assert.deepEqual(suggestionsFor(null, emptyBrief()), { consumables: [], ownItems: [] });
  assert.deepEqual(normalizeMemory({ consumables: [{ what: '' }, 'x', { for: '媽', what: '藥膏', lastAt: 'bad' }], ownItems: 'no' }), { version: 1, consumables: [{ for: '媽', what: '藥膏', note: '', lastAt: '' }], ownItems: [] });
});

test('主題勾選框讀國家層（T20）：themeOptions 沒國家層＝預設五個、有 country.themes 照它（壞的那筆跳過、沒 name_zh 就印 id、整個都壞就預設）；normalize 把該國的中文翻回 id；複製出來的文字照該國清單印，別國留下來的 id 接在後面', () => {
  const five = [['sakura', '櫻花'], ['momiji', '楓葉'], ['snow', '雪'], ['matsuri', '祭典'], ['hanabi', '花火']].map(([id, label]) => ({ id, label }));
  assert.deepEqual(themeOptions(null), five);
  assert.deepEqual(themeOptions({ themes: [] }), five);
  assert.deepEqual(themeOptions({ themes: [null, { id: 'bad id', name_zh: 'x' }, 7] }), five, '整個都壞就預設');
  const th = { themes: [{ id: 'songkran', name_zh: '潑水節' }, { id: 'loykrathong', name_zh: '水燈節' }, { id: 'songkran', name_zh: '重複' }, 'sakura'] };
  const opts = themeOptions(th);
  assert.deepEqual(opts, [{ id: 'songkran', label: '潑水節' }, { id: 'loykrathong', label: '水燈節' }, { id: 'sakura', label: 'sakura' }]);
  const b = normalizeBrief({ persons: [{ isMe: true, go: { themes: ['潑水節', 'sakura', '花火', '雪祭', 'LoyKrathong'] } }] }, { themes: opts });
  assert.deepEqual(b.persons[0].go.themes, ['songkran', 'sakura', 'hanabi', 'loykrathong'], '該國的中文翻回 id、預設五個的中文也翻、不像 id 的中文丟掉、大小寫壓成小寫');
  const md = briefToMarkdown(b, { themes: opts });
  assert.ok(md.includes('- 主題：☑ 潑水節 ☑ 水燈節 ☑ sakura ☑ hanabi ☐ 其他：＿＿'), md);
  assert.ok(briefToMarkdown(b).includes('- 主題：☑ 櫻花 ☐ 楓葉 ☐ 雪 ☐ 祭典 ☑ 花火 ☑ songkran ☑ loykrathong ☐ 其他：＿＿'), '沒帶清單就預設五個，別國的 id 接在後面');
  assert.deepEqual(normalizeBrief(b, { themes: opts }), b, '再 normalize 一次不變');
});

test('JSON 匯出再匯入（normalize）等於原本；normalize 對已合法的單子是恆等', () => {
  const b = filled();
  assert.deepEqual(normalizeBrief(b), b);
  assert.deepEqual(normalizeBrief(JSON.parse(JSON.stringify(b, null, 2))), b);
});

test('檔名 brief-<城市>-<起日>.json：多城市取第一個、多字的城市名不被空白截斷、沒填寫未填、檔名不能用的字換掉', () => {
  assert.equal(briefFileName(filled()), 'brief-仙台-2026-08-12.json');
  assert.equal(briefFileName({ city: '東京、鎌倉', dates: { from: '2026-03-01' } }), 'brief-東京-2026-03-01.json');
  assert.equal(briefFileName({ city: 'Tokyo Osaka' }), 'brief-Tokyo-Osaka-未填.json');
  assert.equal(briefFileName({ city: ' New  York , Boston', dates: { from: '2026-03-01' } }), 'brief-New-York-2026-03-01.json');
  assert.equal(briefFileName(emptyBrief()), 'brief-未填-未填.json');
  assert.equal(briefFileName({ city: 'a:b' }), 'brief-a-b-未填.json');
  assert.equal(briefFileName(null), 'brief-未填-未填.json');
});
