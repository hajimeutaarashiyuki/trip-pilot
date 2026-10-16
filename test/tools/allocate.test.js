// tools/allocate.mjs：dry-run 只印不寫；--apply 寫回 trips/ 裡 id 對得上的旅程檔（只換 picks 那段文字、骨架 pick 照檔案、排版照舊）並先備份 .before-allocate.json；參數解析；縮排偵測；alloc* 讀 rules.json 現況。
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, detectIndent, applyPicks, allocatePackFile, formatAllocation, findTripFile, mergePicks, replacePicks, picksSpans, allocSettings } from '../../tools/allocate.mjs';
import { buildPack } from '../../src/data/pack.js';
import { POIS, KB, COUNTRY, TRIP } from '../fixtures/alloc-world.js';
import rulesJson from '../../src/rules.json' with { type: 'json' };

const TOOL = fileURLToPath(new URL('../../tools/allocate.mjs', import.meta.url));

// 暫存夾跑完就刪（之前每跑一次留 5 個 tp-alloc-* 在 %TEMP%；10-16 審查後）
const tmpDirs = [];
const tmp = (prefix = 'tp-alloc-') => { const d = mkdtempSync(path.join(tmpdir(), prefix)); tmpDirs.push(d); return d; };
after(() => { for (const d of tmpDirs) rmSync(d, { recursive: true, force: true }); });

function setup({ tripFileName = 'alloc-world.json', tripText = null, rules = rulesJson } = {}) {
  const dir = tmp();
  mkdirSync(path.join(dir, 'packs')); mkdirSync(path.join(dir, 'trips'));
  const pack = buildPack({ city: { id: 'tiny', name_zh: '小鎮' }, country: COUNTRY, zones: KB, pois: Object.values(POIS), walk: { pairs: {} }, trip: TRIP, rulesJson: rules, generatedAt: '2026-10-16T00:00:00.000Z' });
  const packFile = path.join(dir, 'packs', 'alloc-world.json');
  writeFileSync(packFile, JSON.stringify(pack) + '\n', 'utf8');
  const tripFile = path.join(dir, 'trips', tripFileName);
  const text = tripText ?? JSON.stringify({ _說明: '測試用', ...TRIP }, null, 1) + '\n';   // 旅程檔慣用 1 格縮排
  writeFileSync(tripFile, text, 'utf8');
  return { dir, packFile, tripFile, tripText: text, tripsDir: path.join(dir, 'trips') };
}

/** 他手寫風格的旅程檔：天的標頭欄位同一行、一行一個 pick（trips/2026-08-sendai-試走.json 的樣子）；主行程的停留改成 61（跟打包檔裡的 60 不同，看 --apply 有沒有照檔案留） */
const INLINE_TRIP = `{
 "_說明": "手寫排版測試",
 "id": "alloc-world",
 "name": "小世界四天",
 "cityName": "小鎮",
 "party": 1,
 "homeBases": [
  { "poi": { "id": "home", "name_zh": "旅館", "zoneId": "town" } }
 ],
 "days": [
  {
   "date": "2026-08-13", "type": "normal", "earlyDay": false,
   "anchor": { "poiId": "shrinea" },
   "picks": [
    { "poiId": "shrinea", "priority": "must", "dwellMin": 61 },
    { "poiId": "cafe1", "priority": "want" },
    { "poiId": "far1", "priority": "maybe" }
   ]
  },
  {
   "date": "2026-08-14", "type": "normal",
   "anchor": { "poiId": "gardeng" }, "designated": ["templet"],
   "picks": []
  },
  {
   "date": "2026-08-15", "type": "normal", "dayTrip": true,
   "anchor": { "poiId": "templesea" },
   "picks": [
    { "poiId": "templesea", "priority": "must", "dwellMin": 90, "fixedWindow": { "startMin": 600, "endMin": 690 } }
   ]
  },
  {
   "date": "2026-08-16", "type": "departure", "departAirportMin": 960,
   "picks": []
  }
 ]
}
`;

test('parseArgs：位置參數、--brief、--trips、--apply', () => {
  assert.deepEqual(parseArgs(['packs/x.json']), { file: 'packs/x.json', brief: null, trips: null, apply: false });
  assert.deepEqual(parseArgs(['--brief', 'b.json', 'packs/x.json', '--apply', '--trips', 'out']), { file: 'packs/x.json', brief: 'b.json', trips: 'out', apply: true });
});

test('detectIndent：照檔案第一個縮排行；沒有縮排當 2', () => {
  assert.equal(detectIndent('{\n "id": 1\n}'), ' ');
  assert.equal(detectIndent('{\n    "id": 1\n}'), '    ');
  assert.equal(detectIndent('{"id":1}'), 2);
});

test('alloc* 讀 rules.json 現況、其餘 settings 照打包檔：打包檔沒有 alloc* 也拿得到', async () => {
  assert.deepEqual(Object.keys(allocSettings({ a: 1, allocTargetStops: 6, allocMaxStops: 8 })), ['allocTargetStops', 'allocMaxStops']);
  const stripped = { ...rulesJson, settings: Object.fromEntries(Object.entries(rulesJson.settings).filter(([k]) => !k.startsWith('alloc'))) };
  const { packFile } = setup({ rules: stripped });
  const r = await allocatePackFile(packFile);
  assert.equal(r.settings.allocTargetStops, rulesJson.settings.allocTargetStops);
  assert.equal(r.settings.maxStopsPerDay, stripped.settings.maxStopsPerDay, '引擎的設定照打包檔');
  assert.deepEqual([r.result.report.days[0].target, r.result.report.days[0].max], [rulesJson.settings.allocTargetStops, rulesJson.settings.allocMaxStops]);
});

test('picksSpans／replacePicks：只換每一天的 picks 那段文字，其他 byte 不動；一行一個 pick 的照一行一個、展開的照展開', () => {
  const { spans, dayCount } = picksSpans(INLINE_TRIP);
  assert.equal(dayCount, 4);
  assert.deepEqual(spans.map((s) => s.dayIndex), [0, 1, 2, 3]);
  for (const s of spans) assert.equal(INLINE_TRIP[s.start], '[');
  const out = replacePicks(INLINE_TRIP, [[{ poiId: 'shrinea', priority: 'must', dwellMin: 61 }, { poiId: 'cafe2', priority: 'maybe', errand: true }], null, [{ poiId: 'templesea', priority: 'must', dwellMin: 90, fixedWindow: { startMin: 600, endMin: 690 } }, { poiId: 'cafesea', priority: 'maybe' }], []]);
  assert.ok(out.includes('    { "poiId": "shrinea", "priority": "must", "dwellMin": 61 },\n    { "poiId": "cafe2", "priority": "maybe", "errand": true }\n   ]'), out);
  assert.ok(out.includes('"fixedWindow": { "startMin": 600, "endMin": 690 } },\n    { "poiId": "cafesea", "priority": "maybe" }'), '巢狀物件也寫一行');
  assert.ok(out.includes('   "date": "2026-08-13", "type": "normal", "earlyDay": false,\n'), '天的標頭那行原樣');
  assert.ok(out.includes('   "picks": []\n  }\n ]\n}\n'), '離境日空的 picks 照舊');
  JSON.parse(out);
  // 把 picks 以外的文字拿掉比：兩邊相同
  const strip = (t) => t.replace(/"picks": \[\]|"picks": \[[\s\S]*?\n {3}\]/g, '"picks": X');   // 空的 [] 先比，不然懶惰比對會把空的 ] 跟下一天吞成一段
  assert.equal(strip(out), strip(INLINE_TRIP));
  // 展開式（JSON.stringify 1 格）照展開
  const expanded = JSON.stringify({ id: 'x', days: [{ date: '2026-08-13', picks: [{ poiId: 'a', priority: 'want' }] }] }, null, 1) + '\n';
  const out2 = replacePicks(expanded, [[{ poiId: 'b', priority: 'maybe' }]]);
  assert.equal(out2, JSON.stringify({ id: 'x', days: [{ date: '2026-08-13', picks: [{ poiId: 'b', priority: 'maybe' }] }] }, null, 1) + '\n');
  assert.throws(() => replacePicks(INLINE_TRIP, [[], []]), /對不上/);
  assert.throws(() => replacePicks('{\n "days": [ { "date": "2026-08-13" } ]\n}', [[{ poiId: 'a' }]]), /沒有 picks 鍵/);
});

test('mergePicks：旅程檔現況的骨架 pick 原樣留、其餘換成分配出來的', () => {
  const day = { anchor: { poiId: 'shrinea' }, designated: ['templet'], picks: [{ poiId: 'shrinea', priority: 'must', dwellMin: 61 }, { poiId: 'templet', priority: 'want', dwellMin: 20 }, { poiId: 'old', priority: 'maybe' }, { poiId: 'fixedx', priority: 'want', fixedWindow: { startMin: 600 } }] };
  const allocated = [{ poiId: 'shrinea', priority: 'must', dwellMin: 60 }, { poiId: 'templet', priority: 'want' }, { poiId: 'cafe1', priority: 'maybe' }];
  assert.deepEqual(mergePicks(day, allocated), [{ poiId: 'shrinea', priority: 'must', dwellMin: 61 }, { poiId: 'templet', priority: 'want', dwellMin: 20 }, { poiId: 'fixedx', priority: 'want', fixedWindow: { startMin: 600 } }, { poiId: 'cafe1', priority: 'maybe' }]);
});

test('findTripFile：先找 <id>.json，沒有就掃資料夾讀 id（檔名跟 id 不同的試走、公務）；備份檔不算；多個同 id 報錯', async () => {
  const dir = tmp();
  writeFileSync(path.join(dir, '仙台試走.json'), JSON.stringify({ id: 'sendai-trial', days: [] }), 'utf8');
  writeFileSync(path.join(dir, '仙台試走.before-allocate.json'), JSON.stringify({ id: 'sendai-trial', days: [] }), 'utf8');
  writeFileSync(path.join(dir, 'notes.json'), JSON.stringify({ id: 'sendai-trial' }), 'utf8');   // 沒有 days 不是旅程檔
  writeFileSync(path.join(dir, 'sendai-main.json'), JSON.stringify({ id: 'sendai-main', days: [] }), 'utf8');
  assert.equal(path.basename(await findTripFile(dir, 'sendai-trial')), '仙台試走.json');
  assert.equal(path.basename(await findTripFile(dir, 'sendai-main')), 'sendai-main.json');
  await assert.rejects(findTripFile(dir, 'nobody'), /找不到旅程檔/);
  writeFileSync(path.join(dir, 'dup.json'), JSON.stringify({ id: 'sendai-trial', days: [] }), 'utf8');
  await assert.rejects(findTripFile(dir, 'sendai-trial'), /2 個旅程檔的 id 都是/);
});

test('allocatePackFile＋formatAllocation：讀打包檔、分配、印人話；每天都有站、沒有程式鍵值露出', async () => {
  const { packFile } = setup();
  const r = await allocatePackFile(packFile);
  assert.equal(r.trip.days.length, 4);
  for (const d of r.trip.days) assert.ok(d.picks.length >= 2, d.date);
  assert.equal(r.planned.result.days.length, 4, '分配後也排了整趟');
  const text = formatAllocation(r);
  assert.match(text, /^# 分配 小世界四天（小鎮）/);
  assert.match(text, /## 2026-08-15（normal，一日遊）主行程：海邊寺/);
  assert.match(text, /留在候選池 \d+ 家：/);
  assert.match(text, /重疊率：換掉前的 picks 2 家/);
  assert.doesNotMatch(text, /undefined|\[object Object\]|NaN/);
  assert.doesNotMatch(text, /\[cafe\]|\[food\]|\[bar\]/, '店型要印中文');
});

test('dry-run：子程序跑真的 CLI，exit 0、印分配與 plan-report、不寫任何檔', () => {
  const { dir, packFile, tripsDir, tripText } = setup();
  const before = readdirSync(tripsDir).sort();
  const r = spawnSync(process.execPath, [TOOL, packFile, '--trips', tripsDir], { encoding: 'utf8', timeout: 120000 });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /# 分配 小世界四天/);
  assert.match(r.stdout, /=== 分配後的 plan-report ===/);
  assert.match(r.stdout, /dry-run：沒寫任何檔/);
  assert.deepEqual(readdirSync(tripsDir).sort(), before, 'trips/ 沒多檔');
  assert.equal(readFileSync(path.join(tripsDir, 'alloc-world.json'), 'utf8'), tripText, '旅程檔沒動');
  assert.deepEqual(readdirSync(path.join(dir, 'packs')), ['alloc-world.json'], 'packs/ 沒動');
});

test('--apply：寫回 trips/<id>.json（只換 picks、骨架與主行程不動、縮排照舊）、先備份 .before-allocate.json；找不到旅程檔就報錯', () => {
  const { packFile, tripsDir, tripFile, tripText } = setup();
  const r = spawnSync(process.execPath, [TOOL, packFile, '--trips', tripsDir, '--apply'], { encoding: 'utf8', timeout: 120000 });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /已寫回 .*alloc-world\.json（備份 .*alloc-world\.before-allocate\.json）/);
  const backup = path.join(tripsDir, 'alloc-world.before-allocate.json');
  assert.ok(existsSync(backup));
  assert.equal(readFileSync(backup, 'utf8'), tripText, '備份是原檔的 byte 複本');
  const after = readFileSync(tripFile, 'utf8');
  assert.ok(after.startsWith('{\n "id"') || after.startsWith('{\n "_說明"'), '縮排照原檔的 1 格');
  const trip = JSON.parse(after);
  assert.equal(trip._說明, '測試用', '其他欄位不動');
  assert.deepEqual(trip.days.map((d) => d.date), TRIP.days.map((d) => d.date));
  assert.deepEqual(trip.days[0].anchor, { poiId: 'shrinea' });
  assert.deepEqual(trip.days[0].picks[0], { poiId: 'shrinea', priority: 'must', dwellMin: 60 }, '主行程的 pick 原樣');
  assert.ok(!trip.days[0].picks.some((p) => p.poiId === 'far1'), '原本的 picks 整個換掉');
  for (const d of trip.days) assert.ok(d.picks.length >= 2, d.date);
  // 再 apply 一次：舊備份不覆蓋，另存帶時戳的
  const r2 = spawnSync(process.execPath, [TOOL, packFile, '--trips', tripsDir, '--apply'], { encoding: 'utf8', timeout: 120000 });
  assert.equal(r2.status, 0, r2.stderr);
  assert.equal(readFileSync(backup, 'utf8'), tripText, '第一份備份還是原檔');
  assert.ok(readdirSync(tripsDir).some((f) => /^alloc-world\.before-allocate\.\d{4}-.*\.json$/.test(f)), '第二次備份帶時戳');
  // 沒有旅程檔
  const empty = tmp('tp-alloc-empty-');
  const r3 = spawnSync(process.execPath, [TOOL, packFile, '--trips', empty, '--apply'], { encoding: 'utf8', timeout: 120000 });
  assert.equal(r3.status, 1);
  assert.match(r3.stderr, /找不到旅程檔/);
});

test('--apply 手寫排版的旅程檔（檔名跟 id 不同）：找得到、骨架 pick 照檔案（停留 61）、picks 以外一個 byte 不動、一行一個 pick', () => {
  const { packFile, tripsDir, tripFile } = setup({ tripFileName: '小世界.json', tripText: INLINE_TRIP });
  const r = spawnSync(process.execPath, [TOOL, packFile, '--trips', tripsDir, '--apply'], { encoding: 'utf8', timeout: 120000 });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /已寫回 .*小世界\.json（備份 .*小世界\.before-allocate\.json）/);
  assert.equal(readFileSync(path.join(tripsDir, '小世界.before-allocate.json'), 'utf8'), INLINE_TRIP);
  const after = readFileSync(tripFile, 'utf8');
  const trip = JSON.parse(after);
  assert.deepEqual(trip.days[0].picks[0], { poiId: 'shrinea', priority: 'must', dwellMin: 61 }, '骨架照旅程檔現況、不是打包檔裡的 60');
  assert.deepEqual(trip.days[2].picks[0], { poiId: 'templesea', priority: 'must', dwellMin: 90, fixedWindow: { startMin: 600, endMin: 690 } }, '帶固定時段的 pick 原樣');
  assert.ok(!trip.days[0].picks.some((p) => p.poiId === 'far1'), '原本的其餘 picks 換掉');
  for (const d of trip.days) assert.ok(d.picks.length >= 2, d.date);
  assert.ok(after.includes('   "date": "2026-08-13", "type": "normal", "earlyDay": false,\n'), '天的標頭那行原樣');
  assert.ok(after.includes('    { "poiId": "shrinea", "priority": "must", "dwellMin": 61 },\n    { "poiId": '), '一行一個 pick');
  const strip = (t) => t.replace(/"picks": \[\]|"picks": \[[\s\S]*?\n {3}\]/g, '"picks": X');
  assert.equal(strip(after), strip(INLINE_TRIP), 'picks 以外的文字相同');
});

test('applyPicks：日期對不上的天不動、回報 missing', async () => {
  const { tripsDir } = setup();
  const out = await applyPicks({ tripsDir, tripId: 'alloc-world', days: [{ date: '2026-08-13', picks: [{ poiId: 'shrinea', priority: 'must' }] }, { date: '2099-01-01', picks: [] }] });
  const trip = JSON.parse(readFileSync(out.file, 'utf8'));
  assert.deepEqual(trip.days[0].picks, [{ poiId: 'shrinea', priority: 'must', dwellMin: 60 }], '主行程的 pick 照旅程檔現況（停留 60），不拿傳進來的那份');
  assert.deepEqual(trip.days[1].picks, [], '打包檔沒有的天照舊');
  assert.deepEqual(out.missing, ['2026-08-14', '2026-08-15', '2026-08-16']);
});
