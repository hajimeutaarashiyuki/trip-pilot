// 驗一城的研究產出（data.json）能不能進管線：必填欄位、店型認不認得、營業時間解析得出幾成、歸區率、座標覆蓋、重複 id、研究註記欄位（值看不懂的、註記還寫在店名裡的）、
// 能當哪一餐的欄位 meals（吃的類標了幾站、各餐幾家、值看不懂的、咖啡廳酒吧只寫 true 沒有說明的、還沒標的照店型推導會算成什麼）、
// 幾個選填欄位的形狀（closedDates、samePlace、closeRisk、zones.json 連結的末班 last、國家層的餐段與特殊時刻表；11-17，判法在 tools/kb-shape.mjs，也可以單獨跑）。
// 用法：node tools/kb-check.mjs <知識庫資料夾> [--country <country.json>]
//   國家層預設照 <城>/city.json 的 countryId 找 <城>/../country/<id>.json（跟 tools/pack.mjs 同一個找法）；找不到就不查國家層那兩樣、報告裡寫明。
// 唯讀、報告型：永遠 exit 0；最後一行「可以打包」或「先補這些」。有 zones.json／coords.json 才算歸區率與座標覆蓋。
// 統計以「站」為單位（同店多類別算一站，打包時會合併）；交通類（logistics）不算營業時間與座標覆蓋，跟 geocode 一樣不查。
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizePoi, RESEARCH_FIELDS, MEALS_FIELD } from '../src/data/schema.js';
import { researchNameHints } from '../src/rules/_helpers.js';
import { servesMeal, hasMealsField, MEAL_NAMES } from '../src/rules/_slots.js';   // 這家店能當哪一餐：引擎的讀法（欄位優先、沒欄位照店型推導），統計用同一個
import { zoneOfPoi } from '../src/geo/zones.js';
import { SKIP_CATEGORIES } from './geocode.mjs';
import { checkShapes, loadShapeInputs } from './kb-shape.mjs';   // 選填欄位的形狀（11-17）：獨立模組，這裡把結果併進結論

// === 需修改 ===
export const REQUIRED_FIELDS = ['name_zh', 'name_local', 'category', 'area', 'hours', 'maps_query'];
// 「可以打包」的門檻：比例低於這些就列進「先補這些」（歸區與座標只在有該檔時算；比例都是對「要算的站」）
export const THRESHOLDS = { zonedRate: 0.9, coordsRate: 0.9, hoursRate: 0.8 };
export const LIST_LIMIT = 20;   // 有問題的站名清單只印前幾個
// 「吃的類」＝該標能當哪一餐（meals）的店型；帶舊旗標 meal: true 的站（祭典攤位）與已經寫了 meals 的站不分店型也算進來
export const EATING_CATEGORIES = ['food', 'bar', 'cafe'];
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

// 形狀檢查裡 kb-check 本來就有自己那一行在報的兩欄（經 normalizePoi 的警告：research-field-bad、meals-bad），結論不重複算
const SHAPE_ALREADY_REPORTED = Object.freeze(['meals', 'researchRank']);

/**
 * checkKb({ data, zones?, coords?, links?, country? }) → 統計物件（純函式；印表交給 formatReport）。
 * links＝zones.json 的 links、country＝國家層物件：給了才查末班 last 與國家層餐段、特殊時刻表的形狀（s.shapes；tools/kb-shape.mjs checkShapes）。
 */
export function checkKb({ data, zones = null, coords = null, links = null, country = null }) {
  const rows = Object.values(data?.categories ?? {}).flatMap((v) => (Array.isArray(v) ? v : v.items ?? []));
  const s = {
    rows: rows.length, stations: 0, notPlaces: 0,
    missing: {},                                     // 欄位 → [站名]
    category: { recognized: 0, unknown: [], byKey: {} },
    hours: { applicable: 0, parsed: 0, partial: 0, unparsed: [] },
    zones: zones ? { total: Object.keys(zones).length, zoned: 0, unzoned: [] } : null,
    coords: coords ? { needed: 0, covered: 0, byConfidence: {}, lowConfidence: 0, nulls: [], absent: [] } : null,
    duplicates: [],                                  // { id, names, sameStore }
    // 研究註記與解鎖條件的欄位（src/data/schema.js RESEARCH_FIELDS；11-06）：各欄幾筆有值、值看不懂的、註記還寫在店名裡卻沒有對應欄位的（引擎會退回認店名字樣）。逐筆數，不看是不是同店多類別
    research: { byField: {}, bad: [], nameOnly: [] },
    // 能當哪一餐（知識庫欄位 meals；src/data/schema.js MEALS_FIELD；11-06 第二批，原話 #195）。以站為單位：eating＝吃的類幾站（EATING_CATEGORIES、帶舊旗標 meal: true、或已經寫了 meals 的）、
    // annotated＝其中寫了欄位的、byMeal＝標了能當那一餐的站數、none＝標 {}（三餐都不算）的；derived＝沒標、引擎照店型推導的那幾站會被當成什麼（讀法就是引擎的 servesMeal），unmarked 是它們的站名。
    // bad（值看不懂）與 bareTrue（不是吃的類卻只寫 true、沒有說明）逐筆數，跟研究註記欄位一樣不看是不是同店多類別。
    meals: {
      eating: 0, annotated: 0, byMeal: Object.fromEntries(MEALS_FIELD.keys.map((k) => [k, 0])), none: 0,
      derived: { count: 0, byMeal: Object.fromEntries(MEALS_FIELD.keys.map((k) => [k, 0])), none: 0 }, unmarked: [], bad: [], bareTrue: [],
    },
  };
  const seen = new Map();
  for (const raw of rows) {
    const { poi, warnings } = normalizePoi(raw);
    const label = raw.name_zh || raw.name_local || poi.id;
    for (const f of REQUIRED_FIELDS) if (!String(raw[f] ?? '').trim()) (s.missing[f] ??= []).push(label);
    for (const f of Object.keys(RESEARCH_FIELDS)) if (raw[f] !== undefined && raw[f] !== null) s.research.byField[f] = (s.research.byField[f] ?? 0) + 1;
    for (const w of warnings) if (w.code === 'research-field-bad') s.research.bad.push(`${label}［${w.field}：${JSON.stringify(raw[w.field])}］`);
    const hints = researchNameHints(poi);
    const nameOnly = [hints.rank && raw.researchRank === undefined ? 'researchRank' : null, hints.skip && raw.researchSkip === undefined && raw.skip !== true ? 'researchSkip' : null, hints.notAStop && raw.notAStop === undefined ? 'notAStop' : null].filter(Boolean);
    if (nameOnly.length) s.research.nameOnly.push(`${label}［該寫 ${nameOnly.join('、')}］`);
    for (const w of warnings) if (w.code === 'meals-bad') s.meals.bad.push(`${label}［${w.msg}］`);
    // 不是吃的類（咖啡廳、酒吧、祭典攤位）能當一餐要寫一句說明、不能只寫 true：畫面要顯示「可以當晚餐：…」（原話 #195「如果可以那也應該在簡介裡提及」）
    if (hasMealsField(raw) && poi.category !== 'food') {
      const bare = MEALS_FIELD.keys.filter((k) => raw.meals[k] === true).map((k) => MEAL_NAMES[k] ?? k);
      if (bare.length) s.meals.bareTrue.push(`${label}［${bare.join('、')}只寫 true］`);
    }
    if (seen.has(poi.id)) { const d = seen.get(poi.id); d.names.push(label); d.keys.add(storeKey(raw)); continue; }
    seen.set(poi.id, { names: [label], keys: new Set([storeKey(raw)]) });
    s.stations++;
    s.category.byKey[poi.category] = (s.category.byKey[poi.category] ?? 0) + 1;
    if (poi.category === 'other') s.category.unknown.push(`${label}［${raw.category ?? '（空）'}］`); else s.category.recognized++;
    if (EATING_CATEGORIES.includes(poi.category) || raw.meal === true || hasMealsField(poi)) {
      s.meals.eating++;
      const served = MEALS_FIELD.keys.filter((k) => servesMeal(poi, k) !== false);
      if (hasMealsField(poi)) {
        s.meals.annotated++;
        for (const k of served) s.meals.byMeal[k]++;
        if (!served.length) s.meals.none++;
      } else {
        s.meals.derived.count++;
        for (const k of served) s.meals.derived.byMeal[k]++;
        if (!served.length) s.meals.derived.none++;
        s.meals.unmarked.push(`${label}［${served.length ? served.map((k) => MEAL_NAMES[k] ?? k).join('、') : '都不算'}］`);
      }
    }
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
  // 選填欄位的形狀（tools/kb-shape.mjs）：closedDates、samePlace、closeRisk、連結的末班 last、國家層的餐段與特殊時刻表；meals 與 researchRank 也在裡面，上面已經各有一行在報
  s.shapes = checkShapes({ data, links, country });
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
  // 研究註記欄位：值看不懂直接擋（寫錯字的 researchRank 會靜靜變成沒標、形狀不對的 unlockWhen 照樣會鎖）；註記還寫在店名裡的只提醒（引擎會退回認店名字樣，排得出來）
  if (s.research.bad.length) blocking.push(`研究註記欄位的值看不懂 ${s.research.bad.length} 處（照 src/data/schema.js RESEARCH_FIELDS 改）`);
  if (s.research.nameOnly.length) notes.push(`${s.research.nameOnly.length} 筆的研究註記還寫在店名裡（首選／備案／保底／備援／可略過／不可指望／A vs B），引擎會退回認店名；搬成欄位、店名清掉那些字`);
  // 能當哪一餐（meals）：值看不懂直接擋（寫錯字的鍵、看不懂的值，引擎會靜靜當成不能當那一餐）；不是吃的類卻只寫 true 也擋（換一家要顯示它怎麼個能當法，原話 #195）；
  // 還沒標的只提醒（引擎照店型推導，排得出來）
  if (s.meals.bad.length) blocking.push(`能當哪一餐（meals）的值看不懂 ${s.meals.bad.length} 處（照 src/data/schema.js MEALS_FIELD 改）`);
  if (s.meals.bareTrue.length) blocking.push(`${s.meals.bareTrue.length} 筆不是吃的類卻只寫 true、沒有說明（咖啡廳、酒吧、攤位能當一餐要寫一句是怎麼個能法，畫面會顯示）`);
  if (s.meals.unmarked.length) notes.push(`${s.meals.unmarked.length} 站吃的類還沒標能當哪一餐（meals），引擎照店型推導：咖啡廳不算一餐、酒吧只有酒場型的算晚餐、早餐一律不算`);
  // 選填欄位的形狀（11-17）：值看不懂、指到不存在的東西直接擋——跟上面兩種「值看不懂」同一個理由：讀的那邊看不懂就當沒寫，不會有任何一句話，
  // 排出來卻是錯的（closedDates 寫錯格式＝公休日照排；末班寫壞＝那條路不判末班；samePlace 指錯＝同一處排兩次；國家層餐段寫壞＝那一餐整段不見）
  const shapeBad = shapeProblemsOf(s);
  if (shapeBad.length) blocking.push(`欄位形狀看不懂 ${shapeBad.length} 處（${[...new Set(shapeBad.map((p) => p.field))].join('、')}；寫壞的值引擎會靜靜當成沒寫，明細看「欄位形狀」那一行或跑 node tools/kb-shape.mjs）`);
  // 形狀檢查裡只提醒的（特殊時刻表少 name：引擎不讀它，那一段期間照樣生效）：進「要注意」、不擋打包
  for (const p of (s.shapes?.problems ?? []).filter((x) => x.level === 'note')) notes.push(`${p.where}：${p.msg}`);
  return { ok: blocking.length === 0, blocking, notes };
}

/** 形狀檢查裡要擋打包、而且上面還沒報過的那幾處。 */
function shapeProblemsOf(s) {
  return (s.shapes?.problems ?? []).filter((p) => p.level === 'block' && !SHAPE_ALREADY_REPORTED.includes(p.field));
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
  const fields = Object.keys(RESEARCH_FIELDS).filter((f) => s.research.byField[f]).map((f) => `${f} ${s.research.byField[f]}`).join('、');
  lines.push(`研究註記欄位：${fields || '沒有一筆用到'}${s.research.bad.length ? `；值看不懂 ${s.research.bad.length}${list(s.research.bad)}` : ''}${s.research.nameOnly.length ? `；註記還寫在店名裡 ${s.research.nameOnly.length}${list(s.research.nameOnly)}` : ''}`);
  const m = s.meals;
  const perMeal = (by) => MEALS_FIELD.keys.map((k) => `${MEAL_NAMES[k] ?? k} ${by[k]}`).join('、');
  lines.push(`能當哪一餐（meals）：${m.eating ? `吃的類 ${m.eating} 站，標了 ${m.annotated}${m.annotated ? `（${perMeal(m.byMeal)}、三餐都不算 ${m.none}）` : ''}` : '沒有吃的類的站'}`
    + `${m.derived.count ? `；沒標 ${m.derived.count} 站照店型推導（${perMeal(m.derived.byMeal)}、都不算 ${m.derived.none}）${list(m.unmarked)}` : ''}`
    + `${m.bad.length ? `；值看不懂 ${m.bad.length}${list(m.bad)}` : ''}${m.bareTrue.length ? `；不是吃的類卻只寫 true ${m.bareTrue.length}${list(m.bareTrue)}` : ''}`);
  if (s.shapes) {
    const c = s.shapes.counts; const k = s.shapes.checked;
    const bad = shapeProblemsOf(s);
    lines.push(`欄位形狀：closedDates ${c.closedDates}、samePlace ${c.samePlace}、closeRisk ${c.closeRisk} 筆有寫`
      + `；${k.links ? `連結的末班 last ${c.last} 條` : '連結的末班沒查（沒有 zones.json 的 links）'}`
      + `；${k.country ? `國家層餐段 ${c.mealSlots} 段、特殊時刻表 ${c.specialSchedule} 筆` : '國家層的餐段與特殊時刻表沒查（找不到國家層檔）'}`
      + `${bad.length ? `；看不懂 ${bad.length}${list(bad.map((p) => `${p.where}［${p.msg}］`))}` : '；都看得懂'}`);
  }
  if (s.verdict.notes.length) lines.push(`要注意：${s.verdict.notes.join('；')}`);
  lines.push(s.verdict.ok ? '結論：可以打包' : `結論：先補這些：${s.verdict.blocking.join('；')}`);
  return lines.join('\n');
}

async function readJson(file) { return existsSync(file) ? JSON.parse(await readFile(file, 'utf8')) : null; }

async function main() {
  const args = process.argv.slice(2);
  const ci = args.indexOf('--country');
  const dir = args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1] === '--country'));
  if (!dir) { console.error('用法：node tools/kb-check.mjs <知識庫資料夾> [--country <country.json>]'); process.exit(2); }
  const data = await readJson(path.join(dir, 'data.json'));
  if (!data) { console.log(`${path.join(dir, 'data.json')} 不存在\n結論：先補這些：data.json`); return; }
  const zones = (await readJson(path.join(dir, 'zones.json')))?.zones ?? null;
  const coords = await readJson(path.join(dir, 'coords.json'));
  if (!existsSync(path.join(dir, 'city.json'))) console.log(`沒有 ${path.join(dir, 'city.json')}：geocode／walk-matrix／pack 都會停，先照 kb/sendai/city.json 建一份`);
  // 形狀檢查另外要的兩樣：zones.json 的 links（末班）、國家層（餐段、特殊時刻表）
  const { links, country } = await loadShapeInputs(dir, { countryFile: ci >= 0 ? args[ci + 1] : null });
  console.log(formatReport(checkKb({ data, zones, coords, links, country }), path.resolve(dir)));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((err) => { console.error(err.message); process.exit(0); });
