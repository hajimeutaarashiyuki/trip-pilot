// 對帳：profile.md（給人讀）與 src/rules.json（引擎讀）的數字要一致（決策樹 Q5）；10-16 T20 起另對 kb/country/jp.json（國家層的日本值，總則 7）。
// 用法：node tools/check-rules.mjs [profile.md 路徑] [--country <jp.json 路徑>]；預設找專案根目錄的 ../profile.md 與 ../kb/country/jp.json（私人倉庫）。
// 只比「人話裡寫了數字」的那幾條；新增設定值時在 CHECKS 加一列；國家層的數字在 profile 用通用引用句型（見 COUNTRY_CHECKS 上面的說明）或在 COUNTRY_CHECKS 加一列。
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_PROFILE = path.resolve(here, '../../profile.md');
export const RULES_PATH = path.resolve(here, '../src/rules.json');
export const DEFAULT_COUNTRY = path.resolve(here, '../../kb/country/jp.json');

/** 每列：profile 裡的句型（第一個擷取群是數字）→ rules.json 的設定鍵。 */
export const CHECKS = [
  { label: '步行預算', pattern: /步行預算 (\d+) 分／日/, key: 'walkBudgetMin' },
  { label: '走路連跑上限', pattern: /走路連跑上限 (\d+) 分/, key: 'maxWalkRunMin' },
  { label: '逛店連跑家數', pattern: /逛店連跑上限 (\d+) 家或 \d+ 分/, key: 'maxShopRunCount' },
  { label: '逛店連跑分鐘', pattern: /逛店連跑上限 \d+ 家或 (\d+) 分/, key: 'maxShopRunMin' },
  { label: '小休重置逛店', pattern: /任何恢復 ≥(\d+) 分重置逛店連跑/, key: 'microRestMin' },
  { label: '恢復重置走路', pattern: /≥(\d+) 分重置走路連跑/, key: 'restResetMin' },
  { label: '深挖店算幾家', pattern: /連跑計數算 (\d+) 家/, key: 'deepDigCount' },
  { label: '非主題日同類店上限', pattern: /非主題日同類店每天 ≤(\d+)/, key: 'sameTypeMaxPerDay' },
  { label: '留白', pattern: /每天留 (\d+) 分鐘/, key: 'openSlotMinPerDay' },
  { label: '早起日步行預算', pattern: /步行預算 150→(\d+)/, key: 'earlyDayWalkFactor', transform: (n) => Math.round((n / 150) * 100) / 100 },
  // 一日遊本身的倍率跟早起日同一句（profile §2.4「一日遊／早起日的 0.7 倍留著」，原話 #160）
  { label: '一日遊步行預算倍率', pattern: /一日遊／早起日的 (0\.\d+) 倍留著/, key: 'dayTripWalkFactor' },
  // 日照邊界「日出+30 到日落−30」：兩個數字都要等於 daylightMarginMin（profile 寫的減號是 U+2212，不是連字號）
  { label: '日照邊界（日出側）', pattern: /日出\+(\d+) 到日落−\d+/, key: 'daylightMarginMin' },
  { label: '日照邊界（日落側）', pattern: /日出\+\d+ 到日落−(\d+)/, key: 'daylightMarginMin' },
  // 固定時段的提前量與散場緩衝同一句（profile §2「固定時段前 40 分、後 30 分不排站」，DESIGN §11.1 Q7；10-14 T23）
  { label: '固定時段提前量', pattern: /固定時段前 (\d+) 分、後 \d+ 分不排站/, key: 'fixedBeforeMin' },
  { label: '固定時段散場緩衝', pattern: /固定時段前 \d+ 分、後 (\d+) 分不排站/, key: 'fixedAfterMin' },
  // 走廊清單的半徑與每段上限同一句（profile §8「路線兩側各 100 公尺、一段移動最多 5 家」，DESIGN §4；10-16 T15）
  { label: '走廊清單半徑', pattern: /路線兩側各 (\d+) 公尺、一段移動最多 \d+ 家/, key: 'corridorListRadiusM' },
  { label: '走廊清單每段上限', pattern: /路線兩側各 \d+ 公尺、一段移動最多 (\d+) 家/, key: 'corridorListMaxPerLeg' },
  // 同行者體力的倍率同一句（profile §9「體力「輕鬆一點」→ 步行預算 ×0.85、「可以操」→ ×1.15」；10-16 T19，都是預設）
  { label: '體力輕鬆倍率', pattern: /體力「輕鬆一點」→ 步行預算 ×(0\.\d+)、「可以操」→ ×\d+\.\d+/, key: 'staminaEasyFactor' },
  { label: '體力可以操倍率', pattern: /體力「輕鬆一點」→ 步行預算 ×0\.\d+、「可以操」→ ×(\d+\.\d+)/, key: 'staminaHardFactor' },
];

/**
 * 國家層對帳（T20）：profile 引用日本值的地方要跟 kb/country/jp.json 一致。兩種句型：
 * (1) 通用引用「kb/country/jp.json：<路徑>＝<值>」（例「日本值見 kb/country/jp.json：taxRefund.bufferMin＝45」；同一處可用「、」接第二個「路徑＝值」，
 *     到「）」「；」或行尾為止）——profile 任何地方寫了都比，寫了 jp.json 沒有的鍵也算不一致。
 * (2) COUNTRY_CHECKS 列的既有句型（數字還沒搬走之前的寫法，legacy）。每列至少要用其中一種出現一次，不然算「沒找到」。
 * 值的標準寫法（formatCountryValue）：數字照寫；時段 [開始, 結束] 寫「11:30–13:30」；整數陣列連號寫「6–9」、不連號用「/」接（南半球夏天 [12, 1, 2] 寫「12/1/2」）；
 * 字串照原文；減號用「–」「-」都行。
 */
export const COUNTRY_CHECKS = [
  { label: '免稅緩衝', path: 'taxRefund.bufferMin', legacy: /離境日在報到之前多留 (\d+) 分/ },
  { label: '夜間站時段', path: 'nightSlot', legacy: /夜間站的時段仍看 (\d{1,2}:\d{2}[–-]\d{1,2}:\d{2})/ },
  { label: '夏季月份', path: 'climate.summerMonths', legacy: /夏季（(\d{1,2}[–-]\d{1,2}) 月）/ },
];
const CITE_CHUNK_RE = /kb\/country\/jp\.json`?[：:]\s*([^）)；;\n]+)/g;
const CITE_PAIR_RE = /`?([A-Za-z][\w.]*)`?\s*[＝=]\s*([^、）)；;\n]+)/g;
const norm = (s) => String(s ?? '').trim().replace(/[-−—]/g, '–').replace(/\s+/g, ' ');

/** 'taxRefund.bufferMin' 這種路徑取值；中途遇到 null 回 undefined。 */
export function getPath(obj, p) {
  let cur = obj;
  for (const k of String(p).split('.')) { if (cur == null) return undefined; cur = cur[k]; }
  return cur;
}

/** 國家層的值 → profile 裡該怎麼寫（對帳用的標準寫法）；null／缺回 null。 */
export function formatCountryValue(v) {
  if (v == null) return null;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) {
    if (v.length === 2 && v.every((x) => typeof x === 'string' && /^\d{1,2}:\d{2}$/.test(x))) return `${v[0]}–${v[1]}`;
    if (v.length > 1 && v.every((x) => Number.isInteger(x)) && v.every((x, i) => i === 0 || x === v[i - 1] + 1)) return `${v[0]}–${v[v.length - 1]}`;
    return v.map((x) => formatCountryValue(x) ?? '').join('/');
  }
  return JSON.stringify(v);
}

/** 國家層對帳：回 { mismatches[], notFound[], cites }（cites＝profile 裡通用引用的筆數）。 */
export function checkCountry(profileText, countryJson) {
  const mismatches = []; const notFound = []; const cited = new Set(); let cites = 0;
  for (const chunk of profileText.matchAll(CITE_CHUNK_RE)) {
    for (const m of chunk[1].matchAll(CITE_PAIR_RE)) {
      const [, key, val] = m;
      cites++; cited.add(key);
      const actual = formatCountryValue(getPath(countryJson, key));
      if (actual == null) mismatches.push({ label: `國家層引用 ${key}`, key, profile: norm(val), rules: '（jp.json 沒有這個鍵）', source: 'country' });
      else if (norm(val) !== norm(actual)) mismatches.push({ label: `國家層引用 ${key}`, key, profile: norm(val), rules: actual, source: 'country' });
    }
  }
  for (const c of COUNTRY_CHECKS) {
    if (cited.has(c.path)) continue;
    const m = c.legacy ? profileText.match(c.legacy) : null;
    if (!m) { notFound.push(`國家層 ${c.label}（${c.path}）：profile 要寫成「kb/country/jp.json：${c.path}＝值」`); continue; }
    const actual = formatCountryValue(getPath(countryJson, c.path));
    if (norm(m[1]) !== norm(actual)) mismatches.push({ label: c.label, key: c.path, profile: norm(m[1]), rules: actual, source: 'country' });
  }
  return { mismatches, notFound, cites };
}

/** 純函式：回 { ok, mismatches[], notFound[], countryCites }，給測試與 CLI 共用；countryJson 不給就只對 rules.json。 */
export function checkRules(profileText, rulesJson, countryJson = null) {
  const settings = rulesJson.settings ?? {};
  const mismatches = []; const notFound = [];
  for (const c of CHECKS) {
    const m = profileText.match(c.pattern);
    if (!m) { notFound.push(c.label); continue; }
    const fromProfile = c.transform ? c.transform(Number(m[1])) : Number(m[1]);
    const fromRules = settings[c.key];
    if (fromProfile !== fromRules) mismatches.push({ label: c.label, key: c.key, profile: fromProfile, rules: fromRules });
  }
  let countryCites = 0;
  if (countryJson) {
    const c = checkCountry(profileText, countryJson);
    mismatches.push(...c.mismatches); notFound.push(...c.notFound); countryCites = c.cites;
  }
  return { ok: mismatches.length === 0 && notFound.length === 0, mismatches, notFound, countryCites };
}

async function main() {
  const args = process.argv.slice(2);
  const ci = args.indexOf('--country');
  const countryPath = ci >= 0 ? args[ci + 1] : DEFAULT_COUNTRY;
  const profilePath = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')))[0] ?? DEFAULT_PROFILE;
  if (!existsSync(profilePath)) { console.error(`找不到 profile.md：${profilePath}`); process.exit(2); }
  const [profileText, rulesText] = await Promise.all([readFile(profilePath, 'utf8'), readFile(RULES_PATH, 'utf8')]);
  const country = existsSync(countryPath) ? JSON.parse(await readFile(countryPath, 'utf8')) : null;
  if (!country) console.log(`沒有國家層檔 ${countryPath}，國家層對帳跳過`);
  const r = checkRules(profileText, JSON.parse(rulesText), country);
  for (const m of r.mismatches) console.log(`不一致  ${m.label}：profile ${m.profile}，${m.source === 'country' ? 'jp.json' : 'rules.json'} ${m.rules}（${m.key}）`);
  for (const n of r.notFound) console.log(`沒找到  ${n}${n.startsWith('國家層') ? '' : '（profile 的句型變了，更新 CHECKS）'}`);
  const countryLine = country ? `＋國家層 ${COUNTRY_CHECKS.length} 條、引用 ${r.countryCites} 處（kb/country/jp.json）` : '';
  console.log(r.ok ? `對帳一致：${CHECKS.length} 條（rules.json）${countryLine}` : `對帳失敗：${r.mismatches.length} 條不一致、${r.notFound.length} 條沒找到`);
  process.exit(r.ok ? 0 : 1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
