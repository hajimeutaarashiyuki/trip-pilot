// 知識庫幾個選填欄位的形狀檢查（11-17）：研究寫了、引擎也在讀，但值寫壞了引擎只會靜靜當成沒寫的那幾樣——
//   站（data.json）：meals、closedDates、samePlace、researchRank、closeRisk
//   區與連結（zones.json 的 links）：末班車 last
//   國家層（kb/country/<id>.json）：mealSlots、transportProfile.specialSchedule
// 用法：node tools/kb-shape.mjs <知識庫資料夾> [--country <country.json>]
//   國家層預設照 <城>/city.json 的 countryId 找 <城>/../country/<id>.json（跟 tools/pack.mjs 同一個找法）；沒有就只查前兩樣。
// 唯讀、報告型：永遠 exit 0；最後一行「形狀檢查：沒有要改的」或「形狀檢查：先改這些（N 處）」（三樣都沒查到——資料夾打錯——寫「什麼都沒查到」）。
// tools/kb-check.mjs 也會跑這一份（checkKb 的 shapes），結論併進「可以打包／先補這些」。
// 分級照 kb-check 既有的慣例：值看不懂、指到不存在的東西＝擋打包（block）——這幾欄讀的那邊都是「看不懂就當沒寫」，寫錯了不會有任何一句話，
// 排出來卻是錯的（公休日照排、末班車不判、同一處排兩次、那一餐整段不見）；跟研究註記欄位、meals 值看不懂直接擋是同一個理由。
// 只提醒（note，不擋打包）的只有一種：特殊時刻表那一筆少 name——引擎不讀 name（geo/matrix.js serviceDayOf 只看 from／to），那一段期間照樣生效，「看不懂就當沒寫」不適用（11-17 審查）。
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { slugId, mealsFieldProblems, RESEARCH_FIELDS, MEALS_FIELD } from '../src/data/schema.js';
import { lastHmToMin, SERVICE_DAYS } from '../src/geo/matrix.js';   // 末班時刻合不合法：引擎讀的那一個函式（11-17 起時分要合法）

// === 需修改 ===
// closeRisk 收哪幾個值：DESIGN §4 POI 欄位表「closeRisk: none|irregular|tempHistory」、profile §10 同一行。引擎現在只讀 irregular（engine/breakfast.js closesIrregularly）
export const CLOSE_RISK_VALUES = Object.freeze(['none', 'irregular', 'tempHistory']);
export const LIST_LIMIT = 20;   // 明細只印前幾筆
// === 以上 ===

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const show = (v) => { const s = JSON.stringify(v); return s === undefined ? String(v) : (s.length > 60 ? `${s.slice(0, 57)}…` : s); };

/** 'YYYY-MM-DD' 而且真的有這一天。 */
export function isDateString(v) {
  const m = typeof v === 'string' ? v.match(/^(\d{4})-(\d{2})-(\d{2})$/) : null;
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

/** 'MM-DD' 而且是一年裡有的一天（02-29 算有）。國家層特殊時刻表期間的寫法（geo/matrix.js serviceDayOf）。 */
export function isMonthDay(v) {
  const m = typeof v === 'string' ? v.match(/^(\d{2})-(\d{2})$/) : null;
  if (!m) return false;
  const d = new Date(Date.UTC(2024, Number(m[1]) - 1, Number(m[2])));   // 2024 是閏年
  return d.getUTCMonth() === Number(m[1]) - 1 && d.getUTCDate() === Number(m[2]);
}

/** 餐段的時刻 'HH:MM'：00:00–24:00、分鐘 00–59 → 分鐘數；不是回 null。（引擎的 hmToMin 只看格式，"13:75" 會被算成 14:15。） */
export function clockMin(v) {
  const m = typeof v === 'string' ? v.match(/^(\d{1,2}):(\d{2})$/) : null;
  if (!m) return null;
  const h = Number(m[1]); const mm = Number(m[2]);
  if (mm > 59 || h > 24 || (h === 24 && mm > 0)) return null;
  return h * 60 + mm;
}

/** 一條連結的 last 哪裡看不懂：回每個問題一句人話的陣列。zoneA、zoneB＝連結兩端的區 id。 */
export function lastProblems(last, zoneA, zoneB) {
  if (last === undefined || last === null) return [];
  if (!isObj(last)) return [`last 要寫成 { "<出發的區 id>": "HH:MM" }：${show(last)}`];
  const out = [];
  for (const [zone, v] of Object.entries(last)) {
    if (zone !== zoneA && zone !== zoneB) { out.push(`last 的鍵 ${show(zone)} 不是這條連結兩端的區（${zoneA}、${zoneB}）`); continue; }
    if (typeof v === 'string') { if (lastHmToMin(v) == null) out.push(`last.${zone} 的時刻看不懂：${show(v)}（要寫 HH:MM，分鐘 00–59；過了午夜寫 00:12 或 24:12 都行，最晚到 27:59）`); continue; }
    if (!isObj(v)) { out.push(`last.${zone} 要寫 "HH:MM" 或 { weekday, saturday, holiday }：${show(v)}`); continue; }
    const keys = Object.keys(v);
    if (!keys.length) out.push(`last.${zone} 是空的物件（分日別至少寫一種：${SERVICE_DAYS.join('／')}）`);
    for (const k of keys) {
      if (!SERVICE_DAYS.includes(k)) out.push(`last.${zone} 有看不懂的鍵 ${show(k)}（只收 ${SERVICE_DAYS.join('／')}）`);
      else if (lastHmToMin(v[k]) == null) out.push(`last.${zone}.${k} 的時刻看不懂：${show(v[k])}（要寫 HH:MM，分鐘 00–59）`);
    }
  }
  return out;
}

/**
 * checkShapes({ data, links, country }) → { problems: [{ level: 'block'｜'note', field, where, msg }], counts: { [field]: 寫了這一欄的筆數 }, checked: { data, links, country } }
 * - level：'block' 擋打包（值看不懂、指到不存在的東西、同一處沒有兩兩互指）；'note' 只提醒（特殊時刻表少 name——引擎不讀它）。
 * - data：data.json（categories.<類>.items[]）；links：zones.json 的 links（"a|b" → 連結）；country：國家層物件。三樣都選填，沒給的那一段不查（checked 記有沒有查）。
 * - 每一個問題：field＝哪一欄（meals／closedDates／samePlace／researchRank／closeRisk／last／mealSlots／specialSchedule）、where＝哪一筆（店名、連結的鍵、「國家層」）、msg＝一句人話。
 * 純函式（印表交給 formatShapes）。meals 與 researchRank 的判法就是 src/data/schema.js 那一份（normalizePoi 記警告用的同一個）。
 */
export function checkShapes({ data = null, links = null, country = null } = {}) {
  const problems = [];
  const counts = { meals: 0, closedDates: 0, samePlace: 0, researchRank: 0, closeRisk: 0, last: 0, mealSlots: 0, specialSchedule: 0 };
  const bad = (field, where, msg) => problems.push({ level: 'block', field, where, msg });
  const remind = (field, where, msg) => problems.push({ level: 'note', field, where, msg });   // 只提醒：寫漏了，但引擎照樣讀得到該讀的
  const given = (v) => v !== undefined && v !== null;

  // ── 站 ──
  if (data) {
    const rows = Object.values(data?.categories ?? {}).flatMap((v) => (Array.isArray(v) ? v : v?.items ?? [])).filter(isObj);
    const ids = new Set(rows.map((r) => slugId(r)));
    for (const raw of rows) {
      const id = slugId(raw);
      const label = raw.name_zh || raw.name_local || id;
      if (given(raw.meals)) { counts.meals++; for (const msg of mealsFieldProblems(raw.meals)) bad('meals', label, msg); }
      if (given(raw.researchRank)) { counts.researchRank++; if (!RESEARCH_FIELDS.researchRank.ok(raw.researchRank)) bad('researchRank', label, `researchRank 的值看不懂：${show(raw.researchRank)}（${RESEARCH_FIELDS.researchRank.expect}）`); }
      if (given(raw.closedDates)) {
        counts.closedDates++;
        if (!Array.isArray(raw.closedDates)) bad('closedDates', label, `closedDates 要寫成日期的陣列（["2026-08-14", …]）：${show(raw.closedDates)}`);
        else for (const d of raw.closedDates) if (!isDateString(d)) bad('closedDates', label, `closedDates 有看不懂的日期 ${show(d)}（要寫 YYYY-MM-DD，而且是真的有的一天）`);
      }
      if (given(raw.samePlace)) {
        counts.samePlace++;
        const refs = typeof raw.samePlace === 'string' ? [raw.samePlace] : Array.isArray(raw.samePlace) ? raw.samePlace : null;
        if (!refs) bad('samePlace', label, `samePlace 要寫另一筆的 id（一筆指好幾筆時寫陣列）：${show(raw.samePlace)}`);
        else for (const ref of refs) {
          if (typeof ref !== 'string' || !ref) bad('samePlace', label, `samePlace 裡有不是 id 的值：${show(ref)}`);
          else if (ref === id) bad('samePlace', label, `samePlace 指到自己（${ref}）`);
          else if (!ids.has(ref)) bad('samePlace', label, `samePlace 指到的 ${show(ref)} 不在這份知識庫裡（id 是 name_local 轉的：小寫、非字母數字換成 -）`);
        }
      }
      if (given(raw.closeRisk)) { counts.closeRisk++; if (!CLOSE_RISK_VALUES.includes(raw.closeRisk)) bad('closeRisk', label, `closeRisk 的值看不懂：${show(raw.closeRisk)}（只收 ${CLOSE_RISK_VALUES.join('／')}）`); }
    }
    // samePlace 連成的每一組要兩兩互指（11-17 審查）：引擎只認「一邊直接指到另一邊」（engine/swap.js samePlace）——丙寫 [甲, 乙] 的話丙與甲、丙與乙是同一處，
    // 甲與乙彼此卻不算，分配器會把甲、乙各分一次（同一個地方排兩次）。兩筆一組的不會有這個問題；三筆以上才查，缺的每一對報一處（掛在這一組裡寫了 samePlace 的那一筆上）。
    const labelOf = new Map(rows.map((r) => [slugId(r), r.name_zh || r.name_local || slugId(r)]));
    const linked = new Map();   // id → Set<直接互指的 id>（只收指得到的）
    const link = (a, b) => { if (!linked.has(a)) linked.set(a, new Set()); if (!linked.has(b)) linked.set(b, new Set()); linked.get(a).add(b); linked.get(b).add(a); };
    for (const raw of rows) {
      const id = slugId(raw);
      const refs = typeof raw.samePlace === 'string' ? [raw.samePlace] : Array.isArray(raw.samePlace) ? raw.samePlace : [];
      for (const ref of refs) if (typeof ref === 'string' && ref && ref !== id && ids.has(ref)) link(id, ref);
    }
    const seen = new Set();
    for (const raw of rows) {
      const start = slugId(raw);
      if (seen.has(start) || !linked.has(start) || !given(raw.samePlace)) continue;
      const group = [start]; seen.add(start);
      for (let i = 0; i < group.length; i++) for (const next of linked.get(group[i])) if (!seen.has(next)) { seen.add(next); group.push(next); }
      if (group.length < 3) continue;
      const names = group.map((x) => labelOf.get(x)).join('、');
      for (let i = 0; i < group.length; i++) for (let j = i + 1; j < group.length; j++) {
        if (!linked.get(group[i]).has(group[j])) bad('samePlace', labelOf.get(start), `samePlace 把 ${names} 連成同一處，但 ${labelOf.get(group[i])} 與 ${labelOf.get(group[j])} 之間沒有互指（引擎只認直接指到的兩筆）：在其中一筆補上另一筆的 id`);
      }
    }
  }

  // ── 連結的末班車 ──
  if (links) {
    if (!isObj(links)) bad('last', 'zones.json', `links 要是物件（"<區 a>|<區 b>" → 連結）：${show(links)}`);
    else for (const [key, link] of Object.entries(links)) {
      if (!isObj(link) || !given(link.last)) continue;
      counts.last++;
      const [a, b] = String(key).split('|');
      for (const msg of lastProblems(link.last, a, b)) bad('last', key, msg);
    }
  }

  // ── 國家層 ──
  if (country) {
    const slots = country.mealSlots;
    if (given(slots)) {
      if (!isObj(slots)) bad('mealSlots', '國家層', `mealSlots 要寫成 { lunch: ["HH:MM", "HH:MM"], … }：${show(slots)}`);
      else for (const [k, range] of Object.entries(slots)) {
        counts.mealSlots++;
        if (!MEALS_FIELD.keys.includes(k)) { bad('mealSlots', '國家層', `mealSlots 有看不懂的鍵 ${show(k)}（只收 ${MEALS_FIELD.keys.join('／')}）`); continue; }
        const ok = Array.isArray(range) && range.length === 2;
        const from = ok ? clockMin(range[0]) : null; const to = ok ? clockMin(range[1]) : null;
        if (!ok || from == null || to == null) bad('mealSlots', '國家層', `mealSlots.${k} 要是兩個時刻 ["HH:MM", "HH:MM"]（00:00–24:00、分鐘 00–59）：${show(range)}`);
        else if (!(to > from)) bad('mealSlots', '國家層', `mealSlots.${k} 的結束要晚於開始：${show(range)}`);
      }
    }
    const special = country.transportProfile?.specialSchedule;
    if (given(special)) {
      if (!Array.isArray(special)) bad('specialSchedule', '國家層', `transportProfile.specialSchedule 要是陣列（[{ name, from: "MM-DD", to: "MM-DD" }, …]）：${show(special)}`);
      else special.forEach((s, i) => {
        counts.specialSchedule++;
        const at = `transportProfile.specialSchedule 第 ${i + 1} 筆`;
        if (!isObj(s)) { bad('specialSchedule', '國家層', `${at} 要是 { name, from, to }：${show(s)}`); return; }
        // 少 name 只提醒：引擎不讀 name，這一筆的期間照樣生效（上面檔頭的分級）
        if (typeof s.name !== 'string' || !s.name.trim()) remind('specialSchedule', '國家層', `${at} 沒有 name（這段期間叫什麼）：${show(s)}`);
        for (const k of ['from', 'to']) if (!isMonthDay(s[k])) bad('specialSchedule', '國家層', `${at}（${typeof s.name === 'string' && s.name.trim() ? s.name : '沒名字'}）的 ${k} 看不懂：${show(s[k])}（要寫 MM-DD，而且是一年裡有的一天）`);
      });
    }
  }
  return { problems, counts, checked: { data: Boolean(data), links: Boolean(links), country: Boolean(country) } };
}

const FIELD_LABEL = Object.freeze({ meals: 'meals', closedDates: 'closedDates', samePlace: 'samePlace', researchRank: 'researchRank', closeRisk: 'closeRisk', last: '末班 last', mealSlots: '餐段 mealSlots', specialSchedule: '特殊時刻表 specialSchedule' });

/** formatShapes(result, label) → 人看的幾行；最後一行是結論。 */
export function formatShapes(r, label = '') {
  const lines = [];
  const c = r.counts;
  lines.push(`形狀檢查${label ? ` ${label}` : ''}：站 ${r.checked.data ? `meals ${c.meals}、closedDates ${c.closedDates}、samePlace ${c.samePlace}、researchRank ${c.researchRank}、closeRisk ${c.closeRisk} 筆有寫` : '沒查（沒有 data.json）'}`
    + `；連結 ${r.checked.links ? `末班 last ${c.last} 條有寫` : '沒查（沒有 zones.json 的 links）'}`
    + `；國家層 ${r.checked.country ? `餐段 ${c.mealSlots} 段、特殊時刻表 ${c.specialSchedule} 筆` : '沒查（找不到國家層檔）'}`);
  const blocks = r.problems.filter((p) => p.level === 'block');
  const notes = r.problems.filter((p) => p.level === 'note');
  for (const p of blocks.slice(0, LIST_LIMIT)) lines.push(`　［${FIELD_LABEL[p.field] ?? p.field}］${p.where}：${p.msg}`);
  if (blocks.length > LIST_LIMIT) lines.push(`　…（共 ${blocks.length} 處）`);
  for (const p of notes.slice(0, LIST_LIMIT)) lines.push(`　（提醒）［${FIELD_LABEL[p.field] ?? p.field}］${p.where}：${p.msg}`);
  // 三樣都沒查到（單獨跑時資料夾打錯字）：不能寫「沒有要改的」——那是什麼都沒看（11-17 審查）
  if (!r.checked.data && !r.checked.links && !r.checked.country) lines.push('形狀檢查：什麼都沒查到（這個資料夾裡沒有 data.json、zones.json 的 links，也找不到國家層檔；資料夾打對了嗎）');
  else if (blocks.length) lines.push(`形狀檢查：先改這些（${blocks.length} 處；寫壞的值引擎會靜靜當成沒寫）${notes.length ? `；另有 ${notes.length} 處提醒` : ''}`);
  else lines.push(notes.length ? `形狀檢查：沒有要改的（另有 ${notes.length} 處提醒，不擋打包）` : '形狀檢查：沒有要改的');
  return lines.join('\n');
}

async function readJson(file) { return existsSync(file) ? JSON.parse(await readFile(file, 'utf8')) : null; }

/** 讀一個知識庫資料夾要查的三樣：data.json、zones.json 的 links、國家層（--country 指的檔，或照 city.json 的 countryId 找 ../country/<id>.json）。kb-check 也用。 */
export async function loadShapeInputs(dir, { countryFile = null } = {}) {
  const data = await readJson(path.join(dir, 'data.json'));
  const links = (await readJson(path.join(dir, 'zones.json')))?.links ?? null;
  let file = countryFile;
  if (!file) { const city = await readJson(path.join(dir, 'city.json')); if (city?.countryId) file = path.join(dir, '..', 'country', `${city.countryId}.json`); }
  const country = file ? await readJson(file) : null;
  return { data, links, country, countryFile: file };
}

async function main() {
  const args = process.argv.slice(2);
  const i = args.indexOf('--country');
  const countryFile = i >= 0 ? args[i + 1] : null;
  const dir = args.find((a, k) => !a.startsWith('--') && !(k > 0 && args[k - 1] === '--country'));
  if (!dir) { console.error('用法：node tools/kb-shape.mjs <知識庫資料夾> [--country <country.json>]'); process.exit(2); }
  const input = await loadShapeInputs(dir, { countryFile });
  console.log(formatShapes(checkShapes(input), path.resolve(dir)));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((err) => { console.error(err.message); process.exit(0); });
