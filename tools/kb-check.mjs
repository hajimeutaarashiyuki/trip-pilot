// 驗一城的研究產出（data.json）能不能進管線：必填欄位、店型認不認得、營業時間解析得出幾成、歸區率、座標覆蓋、重複 id。
// 用法：node tools/kb-check.mjs <知識庫資料夾>
// 唯讀、報告型：永遠 exit 0；最後一行「可以打包」或「先補這些」。有 zones.json／coords.json 才算歸區率與座標覆蓋。
// 統計以「站」為單位（同店多類別算一站，打包時會合併）；交通類（logistics）不算營業時間與座標覆蓋，跟 geocode 一樣不查。
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizePoi } from '../src/data/schema.js';
import { zoneOfPoi } from '../src/geo/zones.js';
import { SKIP_CATEGORIES } from './geocode.mjs';

// === 需修改 ===
export const REQUIRED_FIELDS = ['name_zh', 'name_local', 'category', 'area', 'hours', 'maps_query'];
// 「可以打包」的門檻：比例低於這些就列進「先補這些」（歸區與座標只在有該檔時算；比例都是對「要算的站」）
export const THRESHOLDS = { zonedRate: 0.9, coordsRate: 0.9, hoursRate: 0.8 };
export const LIST_LIMIT = 20;   // 有問題的站名清單只印前幾個
// === 以上 ===

const LOW_CONFIDENCE = new Set(['zone', 'fuzzy', 'unzoned']);
// 同一個 id 是不是同一家店：id 由 name_local 轉來，同一連鎖的兩家分店 name_local 會一樣，所以要比 name_zh——
// 去掉代購的「品項｜」前綴、括號、開頭符號、空白與大小寫後相同才算同店（仙台 Loft／🧴ツブ・ナイトK｜仙台 LOFT 是同店；松本清 一番町店／站前店不是）
const storeKey = (raw) => {
  let s = String(raw.name_zh || raw.name_local || '');
  const m = s.match(/^([^｜|]{1,24})[｜|]\s*(.+)$/u);
  if (m) s = m[2];
  return s.replace(/[（(].*?[)）]/g, '').replace(/^[^\p{L}\p{N}]+/u, '').replace(/\s+/g, '').toLowerCase();
};

/** checkKb({ data, zones?, coords? }) → 統計物件（純函式；印表交給 formatReport）。 */
export function checkKb({ data, zones = null, coords = null }) {
  const rows = Object.values(data?.categories ?? {}).flatMap((v) => (Array.isArray(v) ? v : v.items ?? []));
  const s = {
    rows: rows.length, stations: 0, notPlaces: 0,
    missing: {},                                     // 欄位 → [站名]
    category: { recognized: 0, unknown: [], byKey: {} },
    hours: { applicable: 0, parsed: 0, partial: 0, unparsed: [] },
    zones: zones ? { total: Object.keys(zones).length, zoned: 0, unzoned: [] } : null,
    coords: coords ? { needed: 0, covered: 0, byConfidence: {}, lowConfidence: 0, nulls: [], absent: [] } : null,
    duplicates: [],                                  // { id, names, sameStore }
  };
  const seen = new Map();
  for (const raw of rows) {
    const { poi, warnings } = normalizePoi(raw);
    const label = raw.name_zh || raw.name_local || poi.id;
    for (const f of REQUIRED_FIELDS) if (!String(raw[f] ?? '').trim()) (s.missing[f] ??= []).push(label);
    if (seen.has(poi.id)) { const d = seen.get(poi.id); d.names.push(label); d.keys.add(storeKey(raw)); continue; }
    seen.set(poi.id, { names: [label], keys: new Set([storeKey(raw)]) });
    s.stations++;
    s.category.byKey[poi.category] = (s.category.byKey[poi.category] ?? 0) + 1;
    if (poi.category === 'other') s.category.unknown.push(`${label}［${raw.category ?? '（空）'}］`); else s.category.recognized++;
    const place = !SKIP_CATEGORIES.has(poi.category);
    if (!place) { s.notPlaces++; continue; }
    s.hours.applicable++;
    if (poi.hours) { s.hours.parsed++; if (warnings.some((w) => w.code === 'hours-partial')) s.hours.partial++; } else s.hours.unparsed.push(label);
    if (s.zones) { if (zoneOfPoi(poi, zones)) s.zones.zoned++; else s.zones.unzoned.push(label); }
    if (s.coords) {
      s.coords.needed++;
      const c = coords[poi.id];
      if (c === undefined) s.coords.absent.push(label);
      else if (c === null) s.coords.nulls.push(label);
      else { s.coords.covered++; const k = c.confidence ?? 'unknown'; s.coords.byConfidence[k] = (s.coords.byConfidence[k] ?? 0) + 1; if (LOW_CONFIDENCE.has(k)) s.coords.lowConfidence++; }
    }
  }
  for (const [id, { names, keys }] of seen) if (names.length > 1) s.duplicates.push({ id, names, sameStore: keys.size === 1 });
  s.verdict = verdictOf(s);
  return s;
}

const pct = (a, b) => (b ? Math.round((a / b) * 100) : 100);

function verdictOf(s) {
  const blocking = []; const notes = [];
  const missingN = Object.values(s.missing).reduce((n, l) => n + l.length, 0);
  if (missingN) blocking.push(`缺必填欄位 ${missingN} 處（${Object.keys(s.missing).join('、')}）`);
  if (s.category.unknown.length) blocking.push(`店型認不出 ${s.category.unknown.length} 站（補 derive/category.json 的關鍵字或改 category 文字）`);
  const clash = s.duplicates.filter((d) => !d.sameStore);
  if (clash.length) blocking.push(`id 撞名 ${clash.length} 組（不同店算出同一個 id，改 name_local）`);
  if (s.hours.applicable && s.hours.parsed / s.hours.applicable < THRESHOLDS.hoursRate) blocking.push(`營業時間只解析出 ${pct(s.hours.parsed, s.hours.applicable)}%（門檻 ${THRESHOLDS.hoursRate * 100}%）`);
  else if (s.hours.unparsed.length) notes.push(`${s.hours.unparsed.length} 站營業時間看不出時段（規則會跳過並警告）`);
  if (s.zones) {
    const zoned = s.zones.zoned; const need = s.zones.zoned + s.zones.unzoned.length;
    if (need && zoned / need < THRESHOLDS.zonedRate) blocking.push(`歸區率只有 ${pct(zoned, need)}%（門檻 ${THRESHOLDS.zonedRate * 100}%）：補 zones.json 的 keywords`);
    else if (s.zones.unzoned.length) notes.push(`${s.zones.unzoned.length} 站沒歸到區（站間會用區域預設分鐘）`);
  }
  if (s.coords) {
    if (s.coords.needed && s.coords.covered / s.coords.needed < THRESHOLDS.coordsRate) blocking.push(`座標覆蓋只有 ${pct(s.coords.covered, s.coords.needed)}%（門檻 ${THRESHOLDS.coordsRate * 100}%）：跑 geocode --retry 或補 coords.manual.json`);
    else if (s.coords.nulls.length || s.coords.absent.length) notes.push(`${s.coords.nulls.length + s.coords.absent.length} 站沒座標`);
    if (s.coords.lowConfidence) notes.push(`${s.coords.lowConfidence} 站座標是區心頂替或模糊命中，抽查`);
  }
  if (s.duplicates.some((d) => d.sameStore)) notes.push(`${s.duplicates.filter((d) => d.sameStore).length} 家店列在多個類別（打包會合併成一筆）`);
  return { ok: blocking.length === 0, blocking, notes };
}

const list = (names) => (names.length ? `：${names.slice(0, LIST_LIMIT).join('、')}${names.length > LIST_LIMIT ? `…（共 ${names.length}）` : ''}` : '');

/** formatReport(stats, label) → 人看的表（一行一項）。 */
export function formatReport(s, label = 'data.json') {
  const lines = [];
  lines.push(`知識庫 ${label}：${s.rows} 筆、${s.stations} 站、交通類 ${s.notPlaces}（不算營業時間與座標）`);
  const missingN = Object.values(s.missing).reduce((n, l) => n + l.length, 0);
  lines.push(missingN ? `必填欄位：缺 ${missingN} 處` + Object.entries(s.missing).map(([f, names]) => `　${f} ${names.length}${list(names)}`).join('') : `必填欄位（${REQUIRED_FIELDS.join('、')}）：全齊`);
  const byKey = Object.entries(s.category.byKey).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join('、');
  lines.push(`店型：認得 ${s.category.recognized}/${s.stations}（${pct(s.category.recognized, s.stations)}%）；分佈 ${byKey}${s.category.unknown.length ? `；認不出${list(s.category.unknown)}` : ''}`);
  lines.push(`營業時間：解析出 ${s.hours.parsed}/${s.hours.applicable}（${pct(s.hours.parsed, s.hours.applicable)}%${s.hours.partial ? `，其中 ${s.hours.partial} 站只寫到部分星期` : ''}）${s.hours.unparsed.length ? `；看不出時段 ${s.hours.unparsed.length}${list(s.hours.unparsed)}` : ''}`);
  if (s.zones) {
    const need = s.zones.zoned + s.zones.unzoned.length;
    lines.push(`歸區（zones.json ${s.zones.total} 區）：${s.zones.zoned}/${need}（${pct(s.zones.zoned, need)}%）${s.zones.unzoned.length ? `；沒歸到${list(s.zones.unzoned)}` : ''}`);
  } else lines.push('歸區：沒有 zones.json，跳過（有座標後 node tools/zones-init.mjs 產草案）');
  if (s.coords) {
    const conf = Object.entries(s.coords.byConfidence).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join('、');
    lines.push(`座標（coords.json）：${s.coords.covered}/${s.coords.needed}（${pct(s.coords.covered, s.coords.needed)}%）：${conf || '—'}${s.coords.nulls.length ? `；沒查到 ${s.coords.nulls.length}${list(s.coords.nulls)}` : ''}${s.coords.absent.length ? `；還沒查 ${s.coords.absent.length}${list(s.coords.absent)}` : ''}`);
  } else lines.push('座標：沒有 coords.json，跳過（node tools/geocode.mjs 查）');
  lines.push(s.duplicates.length ? `重複 id：${s.duplicates.map((d) => `${d.id} ×${d.names.length}（${d.sameStore ? '同店多類別' : `撞名：${[...new Set(d.names)].join('／')}`}）`).join('、')}` : '重複 id：無');
  if (s.verdict.notes.length) lines.push(`要注意：${s.verdict.notes.join('；')}`);
  lines.push(s.verdict.ok ? '結論：可以打包' : `結論：先補這些：${s.verdict.blocking.join('；')}`);
  return lines.join('\n');
}

async function readJson(file) { return existsSync(file) ? JSON.parse(await readFile(file, 'utf8')) : null; }

async function main() {
  const dir = process.argv[2];
  if (!dir) { console.error('用法：node tools/kb-check.mjs <知識庫資料夾>'); process.exit(2); }
  const data = await readJson(path.join(dir, 'data.json'));
  if (!data) { console.log(`${path.join(dir, 'data.json')} 不存在\n結論：先補這些：data.json`); return; }
  const zones = (await readJson(path.join(dir, 'zones.json')))?.zones ?? null;
  const coords = await readJson(path.join(dir, 'coords.json'));
  if (!existsSync(path.join(dir, 'city.json'))) console.log(`沒有 ${path.join(dir, 'city.json')}：geocode／walk-matrix／pack 都會停，先照 kb/sendai/city.json 建一份`);
  console.log(formatReport(checkKb({ data, zones, coords }), path.resolve(dir)));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((err) => { console.error(err.message); process.exit(0); });
