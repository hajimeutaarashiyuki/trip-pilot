// 資料層：POI 的規範形狀與 normalizePoi。
// 原則（計畫 1b §0）：推導是資料不是程式——店型、係數、恢復站、停留全部查 derive/*.json；
// 不丟未知欄位；缺資料給預設並記警告，絕不丟例外。
import categoryTable from '../derive/category.json' with { type: 'json' };
import walkTable from '../derive/walkFactor.json' with { type: 'json' };
import recoveryTable from '../derive/recovery.json' with { type: 'json' };
import dwellTable from '../derive/dwell.json' with { type: 'json' };
import daylightTable from '../derive/daylight.json' with { type: 'json' };
import { parseHoursText } from '../derive/hours.js';
import { prepNeededOf } from './country.js';   // 要準備的恢復站型的打包待辦從國家層 recoveryTypes 來（T20），不再寫死在 derive/recovery.json

export const DERIVE = { category: categoryTable, walk: walkTable, recovery: recoveryTable, dwell: dwellTable, daylight: daylightTable };

export const CATEGORIES = Object.freeze([
  'shrine', 'temple', 'mausoleum', 'museum', 'garden', 'arcade', 'market', 'event', 'experience', 'daytrip',
  'vintage', 'record', 'store', 'bookstore', 'drugstore', 'gift', 'department', 'electronics', 'outlet', 'street',
  'food', 'cafe', 'bar', 'brewery', 'onsen', 'cruise', 'logistics', 'venue', 'spot', 'other',   // venue＝固定時段的會場（研討會、演唱會），10-14 T23；spot＝沒有店名只有地點的「坐下來」（海邊、公園、展望台），10-16 原話 #172
]);

/**
 * 研究註記與解鎖條件的知識庫欄位（都選填；一般的店一個都不寫）。2026-11-06 從店名括號搬成欄位（原話 #191 其餘照預設）：
 * 研究以前把「首選」「保底備案」「可略過」寫在 name_zh 的括號裡、分配器認店名字樣；現在 name_zh 只留店名與描述店本身的字，判斷寫在這幾欄。
 * normalizePoi 原樣帶進打包檔（不丟未知欄位），只驗形狀：寫了卻不合 ok 的記警告 research-field-bad（null＝明講沒有，合法）。
 * - researchRank：'first'（同品項的幾家落點、或同一餐的幾家店裡研究的首選）｜'backup'（備案、保底、備援）。
 *   誰讀：分配器（engine/allocate.js，經 rules/_helpers.js researchRank）——餐段與夜間站挑店、同品項挑落點時 first 先、backup 後；吃的站標 backup 不主動排當一餐。
 * - researchSkip：一句理由的字串（「查證結果：未見 DKNY，可略過」）或 true——研究查過、這趟不用去。
 *   誰讀：分配器不進池（allocate.js poolEligible）、引擎不主動插（engine/trip.js engineMayInsert）；他自己勾了照排，走廊清單照列。
 * - notAStop：true——這一筆是研究的比較或彙整摘要、不是一個可以排的地點（「利久 vs 善治郎」）。誰讀：同上兩處（不進池、不主動插）。
 * - unlockWhen：解鎖條件的一句話（「同品類吃無可吃」；profile §5.1、§7「下次再說」層）。
 *   誰讀：引擎不主動插（engineMayInsert）、分配器不進池（poolEligible）、走廊清單不列（trip.js corridorEligible）、二選一的 B 不出（engine/choices.js choiceEligible）；他自己勾了照排。
 *   這一欄讀的那幾處只看有沒有值：形狀不對（不是字串）一樣會鎖，所以警告要處理、別放著。
 * - researchNote：研究寫給規劃者的一句短註記，原本寫在店名括號裡的那句逐字搬來（「離飯店最近：出門1分鐘」）。誰讀：規劃者（在對話裡排行程的人或代理）；引擎與畫面不讀。
 * 前三欄的讀法是「有欄位照欄位、整個欄位沒有才退回店名字樣」（rules/_helpers.js；別的城市的知識庫可能還沒欄位化）。
 */
export const RESEARCH_FIELDS = Object.freeze({
  researchRank: { ok: (v) => v === 'first' || v === 'backup', expect: '要寫 first 或 backup' },
  researchSkip: { ok: (v) => typeof v === 'boolean' || typeof v === 'string', expect: '要寫一句理由或 true' },
  notAStop: { ok: (v) => typeof v === 'boolean', expect: '要寫 true' },
  unlockWhen: { ok: (v) => typeof v === 'string' && v.trim() !== '', expect: '要寫解鎖條件的一句話' },
  researchNote: { ok: (v) => typeof v === 'string', expect: '要寫一句話' },
});

/** 自由文字的 category → 規範店型。回傳 { key, matched } ；沒命中 key='other'、matched=null。 */
export function classifyCategory(raw, table = DERIVE.category) {
  const text = String(raw ?? '').toLowerCase();
  if (!text) return { key: 'other', matched: null };
  for (const rule of table.rules) {
    for (const kw of rule.keywords) {
      if (text.includes(String(kw).toLowerCase())) return { key: rule.key, matched: kw };
    }
  }
  return { key: 'other', matched: null };
}

/** 「45-60 分鐘」「1.5 小時」「5–7 小時」「約 1–1.5 小時」→ 分鐘（取區間中點、進位到 5）；解析不出回 null。 */
export function parseDurationMin(text) {
  if (text == null) return null;
  const s = String(text).replace(/[～~]/g, '-').replace(/[–—]/g, '-');
  const m = s.match(/(\d+(?:\.\d+)?)(?:\s*-\s*(\d+(?:\.\d+)?))?\s*(小時|時間|hr|h|分鐘|分|min)/i);
  if (!m) return null;
  const lo = parseFloat(m[1]);
  const hi = m[2] ? parseFloat(m[2]) : lo;
  const unit = /小時|時間|hr|h/i.test(m[3]) ? 60 : 1;
  const mid = ((lo + hi) / 2) * unit;
  return Math.max(5, Math.round(mid / 5) * 5);
}

/** 由名稱做穩定 id：優先 name_local，其次 name_zh；只留字母數字與 CJK，小寫、空白轉連字號。 */
export function slugId(poi) {
  const base = poi.id || poi.name_local || poi.name_zh || poi.name || '';
  return String(base).trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '') || 'poi';
}

/**
 * normalizePoi(raw, options?) → { poi, warnings[] }
 * - raw 可以是知識庫自由文字格式（name_zh／name_local／category／duration…）或已規範化的 POI；都不丟未知欄位。
 * - 明寫的 walkFactor／recovery／cafeLike／dwellMin／walkAround 優先於推導（他現場可改一站，決策樹 Q1／Q13）。
 * - options.country：國家層（打包檔 pack.country；可不給）——要準備的恢復站型（錢湯帶毛巾、換洗衣物）的打包待辦 prepNeeded 從它的 recoveryTypes 來（T20；明寫的 prepNeeded 優先）。
 */
export function normalizePoi(raw, { derive = DERIVE, country = null } = {}) {
  const warnings = [];
  const poi = { ...raw };
  poi.id = slugId(raw);
  poi.name_zh = raw.name_zh ?? raw.name ?? raw.name_local ?? poi.id;
  poi.name_local = raw.name_local ?? raw.name_zh ?? poi.id;
  // 代購研究把品項寫在店名前面：「🍏DKNY香水｜PLAZA S-PAL 仙台店」→ item=DKNY香水、name_zh=PLAZA S-PAL 仙台店（畫面不露研究標記）
  const m = String(poi.name_zh ?? '').match(/^([^｜|]{1,24})[｜|]\s*(.+)$/u);
  if (m && !raw.item) {
    poi.item = m[1].replace(/^[^\p{L}\p{N}]+/u, '').trim();
    poi.name_zh = m[2].trim();
  }

  // 店型
  let category = raw.category;
  if (!CATEGORIES.includes(category)) {
    const { key, matched } = classifyCategory(raw.category, derive.category);
    poi.categoryRaw = raw.category ?? null;
    category = key;
    if (key === 'other') warnings.push({ code: 'category-unknown', poiId: poi.id, msg: `店型看不出來：${raw.category ?? '（空）'}` });
    else poi.categoryMatched = matched;
  }
  poi.category = category;

  // 腳的負荷係數與大店
  const walk = derive.walk;
  poi.walkAround = typeof raw.walkAround === 'boolean' ? raw.walkAround : walk.walkAround.includes(category);
  if (typeof raw.walkFactor === 'number') poi.walkFactor = raw.walkFactor;
  else if (poi.walkAround) poi.walkFactor = 1;
  else if (category === 'bookstore') poi.walkFactor = walk.bookstoreFactor;
  else poi.walkFactor = walk.byCategory[category] ?? walk.byCategory.other;

  // 爬坡：只有研究或他手標；沒有就沒有加成
  poi.climb = raw.climb === true;
  poi.climbMin = Number.isFinite(raw.climbMin) ? raw.climbMin : 0;
  if (poi.climb && poi.climbMin === 0) warnings.push({ code: 'climb-no-minutes', poiId: poi.id, msg: '標了爬坡但沒寫爬坡分鐘，加成不生效' });

  // 恢復站與咖啡廳類
  const rec = derive.recovery;
  poi.recovery = typeof raw.recovery === 'boolean' ? raw.recovery : rec.recovery.includes(category) || raw.role === 'rest';
  poi.cafeLike = typeof raw.cafeLike === 'boolean' ? raw.cafeLike : rec.cafeLike.includes(category);
  // 要準備的恢復站型（profile §5.9 錢湯帶毛巾、換洗衣物）：打包待辦讀國家層 country.recoveryTypes（T20；之前寫死在 derive/recovery.json，是日本值）；沒給國家層就不帶
  if (!Array.isArray(raw.prepNeeded)) { const prep = prepNeededOf(country, category); if (prep) poi.prepNeeded = prep; }
  poi.deepDig = raw.deepDig === true;
  poi.seated = typeof raw.seated === 'boolean' ? raw.seated : null;

  // 停留
  if (Number.isFinite(raw.dwellMin)) poi.dwellMin = raw.dwellMin;
  else {
    const parsed = parseDurationMin(raw.duration);
    poi.dwellMin = parsed ?? derive.dwell.byCategory[category] ?? derive.dwell.default;
    if (parsed == null && raw.duration) warnings.push({ code: 'duration-unparsed', poiId: poi.id, msg: `停留時間看不懂：${raw.duration}` });
  }

  // 營業時間：結構化的照收；自由文字先解析成結構（derive/hours.js），看不出時段才 hours=null（規則跳過並警告，§5.12 要附備案）
  if (raw.hours && typeof raw.hours === 'object') poi.hours = raw.hours;
  else if (typeof (raw.hours ?? raw.hoursRaw) === 'string' && String(raw.hours ?? raw.hoursRaw).trim()) {
    // 打包檔裡已經規範化過的站 hours 是 null、原文在 hoursRaw：一樣再解析一次（舊打包檔也能用新解析器）
    const hoursText = typeof raw.hours === 'string' ? raw.hours : raw.hoursRaw;
    const parsed = parseHoursText(hoursText);
    poi.hoursRaw = hoursText; poi.hoursNote = parsed.note;
    if (parsed.hours) {
      poi.hours = parsed.hours; poi.hoursSource = 'text';
      if (parsed.partial) warnings.push({ code: 'hours-partial', poiId: poi.id, msg: `營業時間從文字解析：${parsed.note}` });
    } else {
      poi.hours = null;
      warnings.push({ code: 'hours-missing', poiId: poi.id, msg: '營業時間文字看不出時段' });
    }
  } else {
    poi.hours = null;
    warnings.push({ code: 'hours-missing', poiId: poi.id, msg: '沒有營業時間' });
  }

  // 白天站：沒有時段又是戶外參拜型的店型（derive/daylight.json）→ 只能白天去，rules/daylight.js 擋（原話 #159）；明寫的 daylightOnly 優先，含明寫 false
  poi.daylightOnly = typeof raw.daylightOnly === 'boolean' ? raw.daylightOnly : (poi.hours === null && (derive.daylight?.categories ?? []).includes(category));

  // 座標
  if (!(Number.isFinite(raw.lat) && Number.isFinite(raw.lng))) {
    poi.lat = null; poi.lng = null;
    warnings.push({ code: 'coords-missing', poiId: poi.id, msg: '沒有座標' });
  }

  // 研究註記與解鎖條件（RESEARCH_FIELDS）：值原樣帶過（poi 是 raw 的淺拷貝），這裡只驗形狀——寫錯字的 researchRank 會靜靜變成「沒標」，要讓打包與 kb-check 看得到
  for (const [field, spec] of Object.entries(RESEARCH_FIELDS)) {
    const v = raw[field];
    if (v !== undefined && v !== null && !spec.ok(v)) warnings.push({ code: 'research-field-bad', poiId: poi.id, field, msg: `${field} 的值看不懂：${JSON.stringify(v)}（${spec.expect}）` });
  }

  poi.my = raw.my && typeof raw.my === 'object' ? raw.my : {};
  poi.source = raw.source ?? null;
  return { poi, warnings };
}

/** 整批：回傳 pois 與全部警告，另附店型與係數分佈（驗收用）。 */
export function normalizeAll(list, options) {
  const pois = []; const warnings = [];
  for (const raw of list) {
    const r = normalizePoi(raw, options);
    pois.push(r.poi); warnings.push(...r.warnings);
  }
  const count = (key) => pois.reduce((m, p) => ((m[p[key]] = (m[p[key]] ?? 0) + 1), m), {});
  return { pois, warnings, stats: { byCategory: count('category'), byWalkFactor: count('walkFactor'), recovery: pois.filter((p) => p.recovery).length, cafeLike: pois.filter((p) => p.cafeLike).length } };
}
