// 多日分配器（計畫 2 T17）：把一個打包檔丟給 src/engine/allocate.js，候選池分到各天，印分配結果與分配後的 plan-report。
// 用法：node tools/allocate.mjs <packs/xxx.json> [--brief <需求單.json>] [--trips <資料夾>] [--apply]
//   預設 dry-run：只印，不寫任何檔。
//   --apply：把分配出來的 picks 寫回 trips/ 裡 id 對得上的旅程檔（先找 <trip.id>.json，沒有就掃資料夾裡的 *.json 讀 id 比對——試走、公務兩個檔的檔名跟 id 不同）。
//     以旅程檔現況為準：骨架的 pick（主行程、指定站、帶固定時段的）照檔案裡的原樣留著（他打包後手改的停留、固定時段不被打包檔裡的複本蓋掉），其餘換成分配出來的；
//     只改每一天 "picks": [...] 那一段文字、其他 byte 不動（他手寫的排版留著：一行一個 pick 的照一行一個、展開的照展開）；寫之前先備份成 <檔名>.before-allocate.json（已有就另存帶時戳的）。
//   --brief：需求單 JSON（App 需求單頁存成的檔；沒給就用打包檔 trip.brief，再沒有只用骨架）。
//   --trips：旅程檔資料夾（預設專案根目錄的 trips/，由這支檔案的位置推）。
//   設定：引擎的 settings 照打包檔（跟手機一樣，分配後的 plan-report 才對得上）；分配器的 alloc* 讀這台的 src/rules.json 現況（改了不用重打包；打包檔裡的 alloc* 不看）。
import { readFile, writeFile, copyFile } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPack } from '../src/data/pack.js';
import { loadRules } from '../src/rules/index.js';
import { BUILTIN } from '../src/rules/builtin.js';
import { makeLegFn } from '../src/geo/matrix.js';
import { allocateTrip, LEVEL_NAMES } from '../src/engine/allocate.js';
import { minToHm } from '../src/engine/time.js';
import { CATEGORY, PRIORITY } from '../src/ui/text.js';
import { planPack, formatReport } from './plan-report.mjs';
import rulesJson from '../src/rules.json' with { type: 'json' };

// === 需修改 ===
const TRIPS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'trips');   // 專案根目錄的 trips/
// === 以上 ===

export function parseArgs(argv) {
  const args = [...argv];
  const opt = (name) => { const i = args.indexOf(name); if (i < 0) return null; const v = args[i + 1] ?? null; args.splice(i, 2); return v; };
  const brief = opt('--brief'); const trips = opt('--trips');
  const apply = args.includes('--apply');
  const pos = args.filter((a) => !a.startsWith('--'));
  return { file: pos[0] ?? null, brief, trips, apply };
}

/** settings 裡分配器的鍵（alloc* 開頭）。 */
export function allocSettings(settings) {
  return Object.fromEntries(Object.entries(settings ?? {}).filter(([k]) => k.startsWith('alloc')));
}

/** 讀打包檔、分配、分配後整趟排一次；回 { pack, pois, trip（分配後）, result（allocateTrip）, planned（planPack）, legFn, settings }。不寫檔。 */
export async function allocatePackFile(file, { brief = null } = {}) {
  const read = readPack(await readFile(file, 'utf8'));
  const { pack, pois } = read;
  const src = pack.rules ?? rulesJson;
  // 引擎的 settings 照打包檔；分配器的 alloc* 讀 src/rules.json 現況（三個現有打包檔內嵌的 settings 都沒有 alloc*，之前實際跑的是 ALLOC_DEFAULTS、改 rules.json 不會生效；10-16 審查後）
  const settings = { ...src.settings, ...allocSettings(rulesJson.settings) };
  const rules = loadRules(BUILTIN, src.rules);
  const legFn = makeLegFn({ walk: pack.walk?.pairs ?? {}, settings, zoneLinks: pack.zones?.links ?? {} });
  const poiMap = Object.fromEntries(pois.map((p) => [p.id, p]));
  const kb = { zones: pack.zones?.zones ?? {}, links: pack.zones?.links ?? {}, city: pack.city ?? null };
  const result = allocateTrip({ trip: pack.trip, pois: poiMap, kb, country: pack.country, settings, rules, legFn, brief });
  const trip = { ...pack.trip, days: pack.trip.days.map((d, i) => ({ ...d, picks: result.days[i].picks })) };
  const planned = planPack({ ...read, pack: { ...pack, trip } });
  return { pack, pois, trip, result, planned, legFn, settings };
}

const zoneName = (pack, id) => pack.zones?.zones?.[id]?.name_zh ?? id;
const cat = (c) => CATEGORY[c] ?? c ?? '？';

/** 分配結果印成人看的文字（報告與 dry-run 都印這份）。 */
export function formatAllocation({ pack, result }) {
  const r = result.report;
  const lines = [];
  lines.push(`# 分配 ${pack.trip.name ?? pack.trip.id}（${pack.city?.name_zh ?? pack.city?.id}）：打包 ${r.pool.packed} 站、過門 ${r.pool.eligible} 家（② ${r.pool.byLevel[2] ?? 0}、③ ${r.pool.byLevel[3] ?? 0}、④ ${r.pool.byLevel[4] ?? 0}、其餘 ${r.pool.byLevel.rest ?? 0}）、骨架 ${r.pool.skeleton} 站${r.verified ? '' : '　（沒跑單日引擎驗證）'}`);
  for (const d of r.days) {
    lines.push('');
    const zones = d.regionZones.map((z) => zoneName(pack, z)).join('、') || '—';
    const night = Array.isArray(d.nightZones) && d.nightZones.length ? `　夜間站可回：${d.nightZones.map((z) => zoneName(pack, z)).join('、')}` : '';
    // 固定時段釘住的日子印空檔（候選只看空檔有沒有開）
    const free = d.free.length === 1 && d.free[0][0] === d.window.startMin && d.free[0][1] >= d.window.endMin ? '' : `　固定時段以外的空檔 ${d.free.map(([a, b]) => `${minToHm(a)}–${minToHm(b)}`).join('、') || '—'}`;
    lines.push(`## ${d.date}（${d.type}${d.dayTrip ? '，一日遊' : ''}）主行程：${d.anchorName ?? '—'}　時窗 ${minToHm(d.window.startMin)}–${minToHm(d.window.endMin)}${free}　目標 ${d.target}／上限 ${d.max}　當日區域：${zones}${night}`);
    const c = d.counts;
    lines.push(`${c.total} 站：骨架 ${c.skeleton}、② ${c[2] ?? 0}、③ ${c[3] ?? 0}、④ ${c[4] ?? 0}、其餘 ${c.rest ?? 0}`);
    for (const p of d.picks) {
      const tail = [p.slot ? { lunch: '午餐', dinner: '晚餐', night: '夜間站' }[p.slot] : null, p.errand ? '順路購買' : null, p.fixedWindow ? '固定時段' : null, p.why, p.movedFrom ? `從 ${p.movedFrom} 搬來` : null].filter(Boolean).join('，');
      lines.push(`- ${LEVEL_NAMES[p.level] ?? p.level}　${p.name}　[${cat(p.category)}]　${PRIORITY[p.priority] ?? p.priority}${p.travelMin != null ? `　← 離主行程 ${p.travelMin} 分` : ''}${tail ? `　（${tail}）` : ''}`);
    }
  }
  lines.push('');
  if (r.moved.length) lines.push(`驗證後搬天：${r.moved.map((m) => `${m.name} ${m.from}→${m.to}（${m.reason}）`).join('；')}`);
  if (r.swapped.length) lines.push(`驗證後品項換店：${r.swapped.map((s) => `品項「${s.item}」${s.from.date} 的 ${s.from.name} 排不進（${s.reason}）→ ${s.to.date} 的 ${s.to.name}`).join('；')}`);
  if (r.refilled.length) lines.push(`驗證後回填空出的位子：${r.refilled.map((x) => `${x.name}→${x.to}`).join('；')}`);
  if (r.verify.dropped.length) lines.push(`驗證第二趟還是排不進（留候選池）：${r.verify.dropped.map((x) => `${x.date} ${x.name}（${x.reason}）`).join('；')}`);
  if (r.verify.skeletonDropped.length) lines.push(`骨架的站排不進（沒動，給你看）：${r.verify.skeletonDropped.map((x) => `${x.date} ${x.name}（${x.reason}）`).join('；')}`);
  const groups = new Map();
  for (const u of result.unplaced) groups.set(u.reason, [...(groups.get(u.reason) ?? []), u]);
  lines.push(`留在候選池 ${result.unplaced.length} 家：`);
  for (const [reason, list] of [...groups.entries()].sort((a, b) => b[1].length - a[1].length)) lines.push(`- ${reason}（${list.length}）：${list.map((u) => `${u.name}${u.level === 'rest' ? '' : `［${LEVEL_NAMES[u.level]}］`}`).join('、')}`);
  if (r.overlap) lines.push(`重疊率：換掉前的 picks ${r.overlap.original} 家，分配器也選到 ${r.overlap.matched} 家（${Math.round(r.overlap.rate * 100)}%），分到同一天 ${r.overlap.sameDay} 家`);
  else lines.push('重疊率：打包檔只有骨架，沒有換掉前的 picks 可比');
  if (r.briefUnmatched.length) lines.push(`需求單對不上候選池：${r.briefUnmatched.map((b) => `「${b.text}」（${b.reason}）`).join('；')}`);
  if (r.verified) {
    const byDate = new Map();
    for (const w of r.slotWarnings) byDate.set(w.date, [...(byDate.get(w.date) ?? []), w.msg]);
    lines.push(byDate.size
      ? `分配後單日引擎仍警告餐段／夜間站（${byDate.size} 天；分配器標的午餐、晚餐、夜間站只是配額與意圖，引擎不保證排在那個時段）：${[...byDate.entries()].map(([d, m]) => `${d} ${m.join('、')}`).join('；')}`
      : '分配後單日引擎沒有餐段／夜間站的警告');
  }
  if (r.warnings.length) lines.push(`整趟警告：${r.warnings.map((w) => w.msg).join('；')}`);
  return lines.join('\n');
}

/** 偵測 JSON 檔的縮排（第一個縮排行的空白數；沒有就 2）。 */
export function detectIndent(text) {
  const m = String(text).match(/\n([ \t]+)"/);
  return m ? m[1] : 2;
}

/**
 * trips/ 裡 id 對得上的旅程檔：先找 <id>.json；沒有就掃資料夾裡的 *.json（備份檔 *.before-allocate.*.json 不算）讀 id 比對。
 * 檔名常跟 id 不同：trips/2026-08-sendai-試走.json 的 id 是 2026-08-sendai-trial、-公務.json 是 -business（10-16 審查後）。
 */
export async function findTripFile(tripsDir, tripId) {
  const direct = path.join(tripsDir, `${tripId}.json`);
  if (existsSync(direct)) return direct;
  const hits = [];
  for (const f of existsSync(tripsDir) ? readdirSync(tripsDir) : []) {
    if (!f.endsWith('.json') || /\.before-allocate\./.test(f)) continue;
    try {
      const t = JSON.parse(await readFile(path.join(tripsDir, f), 'utf8'));
      if (t?.id === tripId && Array.isArray(t.days)) hits.push(path.join(tripsDir, f));
    } catch { /* 不是 JSON 的跳過 */ }
  }
  if (hits.length === 1) return hits[0];
  if (hits.length > 1) throw new Error(`${tripsDir} 裡有 ${hits.length} 個旅程檔的 id 都是 ${tripId}（${hits.map((h) => path.basename(h)).join('、')}），留一個再 --apply`);
  throw new Error(`找不到旅程檔：${tripsDir} 裡沒有 ${tripId}.json、也沒有 id 是 ${tripId} 的 *.json（--apply 只寫回既有的旅程檔；先確認 trips/ 的路徑，或用 --trips 指定）`);
}

/**
 * 這一天要寫回的 picks：旅程檔現況的骨架 pick（主行程、指定站、帶固定時段的）原樣留著，其餘換成分配出來的（分配結果裡同一家的骨架複本不重複）。
 */
export function mergePicks(day, allocated) {
  const skeletonIds = new Set([day.anchor?.poiId, ...(day.anchor?.poiIds ?? []), ...(day.designated ?? [])].filter(Boolean));
  const keep = (day.picks ?? []).filter((p) => p?.poiId && (skeletonIds.has(p.poiId) || p.fixedWindow));
  const kept = new Set(keep.map((p) => p.poiId));
  return [...keep, ...allocated.filter((p) => p?.poiId && !kept.has(p.poiId))];
}

/**
 * 掃旅程檔的 JSON 文字，找根物件 days[] 裡每一天的 "picks": [...] 在文字裡的位置：[{ dayIndex, start（[ 的位置）, end（] 之後） }]；沒有 picks 鍵的天不在清單裡。
 * 只認字串、括號與鍵名，不做完整解析（檔案先 JSON.parse 過才會到這裡）。
 */
export function picksSpans(text) {
  const spans = []; let dayCount = 0;
  let i = 0; const n = text.length;
  const ws = () => { while (i < n && /\s/.test(text[i])) i++; };
  const str = () => {   // 停在開頭的 "，回字串內容（跳脫只為了不被騙過結尾，鍵名比對用）
    i++; let s = '';
    while (i < n && text[i] !== '"') { if (text[i] === '\\') { s += text[i + 1] ?? ''; i += 2; continue; } s += text[i]; i++; }
    i++; return s;
  };
  const value = (ctx) => {
    ws();
    const c = text[i];
    if (c === '{') return object(ctx);
    if (c === '[') return array(ctx);
    if (c === '"') { str(); return; }
    while (i < n && !/[,\]}\s]/.test(text[i])) i++;   // 數字、true、false、null
  };
  const object = (ctx) => {
    i++;   // {
    for (;;) {
      ws();
      if (i >= n) return;
      if (text[i] === '}') { i++; return; }
      if (text[i] === ',') { i++; continue; }
      const key = str(); ws(); i++; ws();   // 鍵、冒號
      if (ctx.where === 'root' && key === 'days' && text[i] === '[') { array({ where: 'days' }); continue; }
      if (ctx.where === 'day' && key === 'picks' && text[i] === '[') { const start = i; array({ where: 'other' }); spans.push({ dayIndex: ctx.dayIndex, start, end: i }); continue; }
      value({ where: 'other' });
    }
  };
  const array = (ctx) => {
    i++;   // [
    for (;;) {
      ws();
      if (i >= n) return;
      if (text[i] === ']') { i++; return; }
      if (text[i] === ',') { i++; continue; }
      if (ctx.where === 'days' && text[i] === '{') { object({ where: 'day', dayIndex: dayCount++ }); continue; }
      value({ where: 'other' });
    }
  };
  ws();
  if (text[i] === '{') object({ where: 'root' });
  return { spans, dayCount };
}

/** 一個 pick 寫成一行（他手寫的樣子：`{ "poiId": "x", "priority": "must", "dwellMin": 60 }`）。 */
function inlineJson(v) {
  if (Array.isArray(v)) return `[${v.map(inlineJson).join(', ')}]`;
  if (v && typeof v === 'object') { const e = Object.entries(v).filter(([, x]) => x !== undefined); return e.length ? `{ ${e.map(([k, x]) => `${JSON.stringify(k)}: ${inlineJson(x)}`).join(', ')} }` : '{}'; }
  return JSON.stringify(v);
}

/**
 * 只換旅程檔文字裡每一天的 "picks": [...] 那一段，其他 byte 不動。newPicks[dayIndex] 是那天的新 picks（null＝不動）。
 * 排版照原本那一段：一行一個 pick（`{ "poiId": …`）的照一行一個，展開的照檔案縮排展開；原本是空的 [] 就看檔案裡別處的寫法。
 */
export function replacePicks(text, newPicks) {
  const { spans, dayCount } = picksSpans(text);
  if (dayCount !== newPicks.length) throw new Error(`旅程檔裡有 ${dayCount} 天、分配結果 ${newPicks.length} 天，對不上`);
  const missingKey = newPicks.map((p, i) => (p != null && !spans.some((s) => s.dayIndex === i) ? i + 1 : null)).filter((x) => x != null);
  if (missingKey.length) throw new Error(`旅程檔第 ${missingKey.join('、')} 天沒有 picks 鍵，先手加 "picks": [] 再 --apply`);
  const ind = detectIndent(text); const unit = typeof ind === 'number' ? ' '.repeat(ind) : ind;
  const fileInline = /\{ "poiId"/.test(text);
  let out = ''; let cursor = 0;
  for (const span of spans.sort((a, b) => a.start - b.start)) {
    const picks = newPicks[span.dayIndex];
    out += text.slice(cursor, span.start);
    cursor = span.end;
    const original = text.slice(span.start, span.end);
    if (picks == null) { out += original; continue; }
    if (!picks.length) { out += '[]'; continue; }
    const lineStart = text.lastIndexOf('\n', span.start) + 1;
    const keyIndent = text.slice(lineStart).match(/^[ \t]*/)[0];
    const inline = /\{ "poiId"/.test(original) || (!/\{\n/.test(original) && fileInline);
    if (inline) out += `[\n${picks.map((p) => `${keyIndent}${unit}${inlineJson(p)}`).join(',\n')}\n${keyIndent}]`;
    else out += JSON.stringify(picks, null, unit).split('\n').map((l, k) => (k === 0 ? l : keyIndent + l)).join('\n');
  }
  return out + text.slice(cursor);
}

/**
 * --apply：trips/ 裡 id 對得上的旅程檔現況為準（他會手改），只換每一天的 picks（日期對得上的那幾天；骨架的 pick 照檔案原樣留）；先備份成 <檔名>.before-allocate.json（已有備份不覆蓋、另存帶時戳的）。
 * 回 { file, backup, missing }。
 */
export async function applyPicks({ tripsDir, tripId, days }) {
  const file = await findTripFile(tripsDir, tripId);
  const text = await readFile(file, 'utf8');
  const trip = JSON.parse(text);
  if (!Array.isArray(trip.days)) throw new Error(`${file} 不是旅程檔（沒有 days）`);
  const base = path.basename(file, '.json');
  let backup = path.join(tripsDir, `${base}.before-allocate.json`);
  if (existsSync(backup)) backup = path.join(tripsDir, `${base}.before-allocate.${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  await copyFile(file, backup);
  const byDate = new Map(days.map((d) => [d.date, d.picks]));
  const missing = [];
  const newPicks = trip.days.map((d) => {
    if (!byDate.has(d.date)) { missing.push(d.date); return null; }
    return mergePicks(d, byDate.get(d.date));
  });
  await writeFile(file, replacePicks(text, newPicks), 'utf8');
  return { file, backup, missing };
}

async function main() {
  const { file, brief: briefFile, trips, apply } = parseArgs(process.argv.slice(2));
  if (!file) { console.error('用法：node tools/allocate.mjs <packs/xxx.json> [--brief <需求單.json>] [--trips <資料夾>] [--apply]'); process.exit(2); }
  const brief = briefFile ? JSON.parse(await readFile(briefFile, 'utf8')) : null;
  const r = await allocatePackFile(file, { brief });
  console.log(formatAllocation(r));
  console.log('');
  console.log('=== 分配後的 plan-report ===');
  console.log(formatReport(r.planned));
  console.log('');
  if (!apply) { console.log('（dry-run：沒寫任何檔；要寫回旅程檔加 --apply）'); return; }
  const out = await applyPicks({ tripsDir: trips ? path.resolve(trips) : TRIPS_DIR, tripId: r.pack.trip.id, days: r.result.days });
  console.log(`已寫回 ${out.file}（備份 ${out.backup}）${out.missing.length ? `；旅程檔裡這幾天打包檔沒有、沒動：${out.missing.join('、')}` : ''}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((err) => { console.error(err.message); process.exit(1); });
