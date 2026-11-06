// 研究註記與解鎖條件的知識庫欄位（src/data/schema.js RESEARCH_FIELDS；11-06 從店名括號搬成欄位，原話 #191 其餘照預設）：
// normalizePoi 原樣帶過、形狀不對記警告；kb-check 數各欄、擋看不懂的值、提醒註記還寫在店名裡的；仙台包（本機有才跑）已經搬完。
// 讀法（有欄位照欄位、沒欄位退回店名字樣）的測試在 test/engine/allocate.test.js 與 test/engine/rest-pool.test.js。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizePoi, normalizeAll, RESEARCH_FIELDS } from '../../src/data/schema.js';
import { buildPack, readPack } from '../../src/data/pack.js';
import { researchNameHints, researchRank, researchSaysSkip, notAStop } from '../../src/rules/_helpers.js';
import { checkKb, formatReport } from '../../tools/kb-check.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
// 知識庫在私人倉庫（專案根目錄），公開倉庫裡沒有；本機有就跑，沒有就跳過（跟 normalize.test.js 同一個做法）。
const SENDAI = path.resolve(here, '../../../kb/sendai/data.json');
const bad = (warnings) => warnings.filter((w) => w.code === 'research-field-bad');

test('RESEARCH_FIELDS 五欄：researchRank、researchSkip、notAStop、unlockWhen、researchNote', () => {
  assert.deepEqual(Object.keys(RESEARCH_FIELDS), ['researchRank', 'researchSkip', 'notAStop', 'unlockWhen', 'researchNote']);
  assert.ok(RESEARCH_FIELDS.researchRank.ok('first') && RESEARCH_FIELDS.researchRank.ok('backup') && !RESEARCH_FIELDS.researchRank.ok('First'));
  assert.ok(RESEARCH_FIELDS.researchSkip.ok('查證結果：未見 DKNY，可略過') && RESEARCH_FIELDS.researchSkip.ok(true) && !RESEARCH_FIELDS.researchSkip.ok(1));
  assert.ok(RESEARCH_FIELDS.notAStop.ok(true) && !RESEARCH_FIELDS.notAStop.ok('true'));
  assert.ok(RESEARCH_FIELDS.unlockWhen.ok('同品類吃無可吃') && !RESEARCH_FIELDS.unlockWhen.ok('') && !RESEARCH_FIELDS.unlockWhen.ok(true));
  assert.ok(RESEARCH_FIELDS.researchNote.ok('離飯店最近：出門1分鐘') && !RESEARCH_FIELDS.researchNote.ok(['a']));
});

test('normalizePoi 原樣帶過五欄；沒寫不補；null＝明講沒有，合法；「品項｜店名」照拆、id 不受影響', () => {
  const raw = { name_zh: '💄睫毛膏｜松本清 仙台Clis Road店', name_local: 'マツモトキヨシ 仙台クリスロード店', category: '藥妝', researchRank: 'first', researchNote: '首選：大店＋順路＋開到22點', researchSkip: null };
  const r = normalizePoi(raw);
  assert.equal(r.poi.id, 'マツモトキヨシ-仙台クリスロード店');
  assert.equal(r.poi.item, '睫毛膏'); assert.equal(r.poi.name_zh, '松本清 仙台Clis Road店');
  assert.equal(r.poi.researchRank, 'first'); assert.equal(r.poi.researchNote, '首選：大店＋順路＋開到22點'); assert.equal(r.poi.researchSkip, null);
  assert.deepEqual(bad(r.warnings), []);
  const locked = normalizePoi({ name_zh: 'たんや善治郎 仙台站前本店', name_local: 'たんや善治郎 仙台駅前本店', category: '牛舌', researchRank: 'backup', unlockWhen: '同品類吃無可吃', notAStop: false }).poi;
  assert.equal(locked.unlockWhen, '同品類吃無可吃'); assert.equal(locked.researchRank, 'backup'); assert.equal(locked.notAStop, false);
  const plain = normalizePoi({ name_zh: 'Utah', category: '古著店' }).poi;
  for (const f of Object.keys(RESEARCH_FIELDS)) assert.equal(f in plain, false, `${f} 沒寫就不補`);
  // 打包再讀回來（手機端 readPack 會再過一次 normalizePoi）：欄位、店名、品項、id 都還在
  const pack = buildPack({ city: { id: 'x', name_zh: '某城' }, country: null, pois: [r.poi, locked], trip: { id: 't', days: [] } });
  const back = readPack(JSON.stringify(pack));
  assert.deepEqual(back.pois.map((p) => [p.id, p.name_zh, p.item ?? null, p.researchRank, p.researchNote ?? null, p.unlockWhen ?? null]), [
    ['マツモトキヨシ-仙台クリスロード店', '松本清 仙台Clis Road店', '睫毛膏', 'first', '首選：大店＋順路＋開到22點', null],
    ['たんや善治郎-仙台駅前本店', 'たんや善治郎 仙台站前本店', null, 'backup', null, '同品類吃無可吃'],
  ]);
  assert.deepEqual(bad(back.warnings), []);
});

test('形狀不對記警告 research-field-bad（每欄一條、講是哪一欄與該寫什麼）；值不改，讀的那邊當沒標', () => {
  const r = normalizePoi({ name_zh: '寫壞的店', category: '古著店', researchRank: 'frist', researchSkip: 3, notAStop: 'yes', unlockWhen: '', researchNote: ['a'] });
  assert.deepEqual(bad(r.warnings).map((w) => w.field).sort(), ['notAStop', 'researchNote', 'researchRank', 'researchSkip', 'unlockWhen']);
  const w = bad(r.warnings).find((x) => x.field === 'researchRank');
  assert.equal(w.poiId, '寫壞的店');
  assert.equal(w.msg, 'researchRank 的值看不懂："frist"（要寫 first 或 backup）');
  assert.doesNotMatch(bad(r.warnings).map((x) => x.msg).join('\n'), /undefined|\[object Object\]/);
  assert.equal(r.poi.researchRank, 'frist', '不丟、不改');
  assert.equal(researchRank(r.poi), 1); assert.equal(researchSaysSkip(r.poi), false); assert.equal(notAStop(r.poi), false);
});

test('kb-check：數各欄有值的筆數；值看不懂的擋下來；註記還寫在店名裡、沒有對應欄位的只提醒', () => {
  const base = { area: '北町（北町1-1）', hours: '9:00-17:00' };
  const row = (name_zh, name_local, category, over = {}) => ({ name_zh, name_local, category, maps_query: name_local, ...base, ...over });
  const clean = [
    row('甲食堂', '甲食堂', '定食', { researchRank: 'first', researchNote: '推薦首選' }),
    row('乙食堂', '乙食堂', '定食', { researchRank: 'backup', researchNote: '保底備案', unlockWhen: '同品類吃無可吃' }),
    row('🍏香水｜丙百貨 香氛區', '丙百貨 1F', '百貨', { researchSkip: '查證結果：未見，可略過' }),
    row('丁 vs 戊（站內比較吃）', '丁／戊', '定食', { notAStop: true }),
    row('己神社', '己神社', '神社'),
  ];
  const s = checkKb({ data: { categories: { x: { items: clean } } } });
  assert.deepEqual(s.research, { byField: { researchRank: 2, researchNote: 2, unlockWhen: 1, researchSkip: 1, notAStop: 1 }, bad: [], nameOnly: [] }, '「丁 vs 戊」有 notAStop 欄位，不算還寫在店名裡');
  assert.equal(s.verdict.ok, true, s.verdict.blocking.join(' / '));
  const report = formatReport(s);
  assert.match(report, /^研究註記欄位：researchRank 2、researchSkip 1、notAStop 1、unlockWhen 1、researchNote 2$/m);
  assert.equal(report.split('\n').at(-1), '結論：可以打包');
  // 還沒欄位化的寫法（註記在店名括號裡）＋一筆寫錯字
  const old = [
    row('甲食堂（推薦首選）', '甲食堂', '定食'),
    row('乙食堂（保底備案）', '乙食堂', '定食'),
    row('🍏香水｜丙百貨 香氛區（查證結果：未見，可略過）', '丙百貨 1F', '百貨'),
    row('丁 vs 戊（站內比較吃）', '丁／戊', '定食'),
    row('庚食堂', '庚食堂', '定食', { researchRank: 'frist' }),
    row('辛食堂（可略過）', '辛食堂', '定食', { skip: true }),
  ];
  const t = checkKb({ data: { categories: { x: { items: old } } } });
  assert.deepEqual(t.research.nameOnly, ['甲食堂（推薦首選）［該寫 researchRank］', '乙食堂（保底備案）［該寫 researchRank］', '🍏香水｜丙百貨 香氛區（查證結果：未見，可略過）［該寫 researchSkip］', '丁 vs 戊（站內比較吃）［該寫 notAStop］'], '舊寫法 skip: true 的那筆不列');
  assert.deepEqual(t.research.bad, ['庚食堂［researchRank："frist"］']);
  assert.equal(t.verdict.ok, false);
  assert.deepEqual(t.verdict.blocking, ['研究註記欄位的值看不懂 1 處（照 src/data/schema.js RESEARCH_FIELDS 改）']);
  assert.ok(t.verdict.notes.some((n) => /^4 筆的研究註記還寫在店名裡/.test(n)), t.verdict.notes.join(' / '));
  const report2 = formatReport(t);
  assert.match(report2, /研究註記欄位：researchRank 1；值看不懂 1：庚食堂［researchRank："frist"］；註記還寫在店名裡 4：甲食堂（推薦首選）［該寫 researchRank］/);
  assert.match(report2.split('\n').at(-1), /^結論：先補這些：研究註記欄位的值看不懂 1 處/);
  // 沒有一筆用到欄位、店名也乾淨
  const none = checkKb({ data: { categories: { x: { items: [row('己神社', '己神社', '神社')] } } } });
  assert.match(formatReport(none), /^研究註記欄位：沒有一筆用到$/m);
});

test('仙台包已經搬完（11-06）：欄位值都看得懂、沒有一筆的註記還寫在店名裡沒欄位、善治郎的兩筆有 unlockWhen（profile §5.1，原話 #6、#13）', { skip: !existsSync(SENDAI) && '本機沒有 kb/sendai/data.json' }, async () => {
  const kb = JSON.parse(await readFile(SENDAI, 'utf8'));
  const list = Object.values(kb.categories).flatMap((v) => (Array.isArray(v) ? v : v.items ?? []));
  const { pois, warnings } = normalizeAll(list);
  assert.deepEqual(bad(warnings), []);
  const nameOnly = pois.filter((p) => { const h = researchNameHints(p); return (h.rank && p.researchRank === undefined) || (h.skip && p.researchSkip === undefined) || (h.notAStop && p.notAStop === undefined); }).map((p) => p.name_zh);
  assert.deepEqual(nameOnly, [], '新加的站別把首選／備案／可略過寫在店名括號裡，寫欄位（src/data/schema.js RESEARCH_FIELDS）');
  const zenjiro = pois.filter((p) => String(p.name_local).includes('善治郎'));
  assert.ok(zenjiro.length >= 2, `善治郎的條目：${zenjiro.map((p) => p.name_zh).join('、')}`);
  for (const p of zenjiro) assert.equal(p.unlockWhen, '同品類吃無可吃', p.name_zh);
  // 他沒興趣的那家靠 unlockWhen 擋，不再靠店名的「保底備案」；比較條目靠 notAStop
  const honten = pois.find((p) => p.id === 'たんや善治郎-仙台駅前本店');
  assert.deepEqual([honten.name_zh, honten.researchRank, researchNameHints(honten).rank], ['たんや善治郎 仙台站前本店', 'backup', null]);
  assert.equal(pois.find((p) => p.id === '牛たん炭焼-利久-たんや善治郎-牛たん通り店').notAStop, true);
});
