// 資料層：POI 的規範形狀與 normalizePoi。
// 原則（計畫 1b §0）：推導是資料不是程式——店型、係數、恢復站、停留全部查 derive/*.json；
// 不丟未知欄位；缺資料給預設並記警告，絕不丟例外。
import categoryTable from '../derive/category.json' with { type: 'json' };
import walkTable from '../derive/walkFactor.json' with { type: 'json' };
import recoveryTable from '../derive/recovery.json' with { type: 'json' };
import dwellTable from '../derive/dwell.json' with { type: 'json' };
import { parseHoursText } from '../derive/hours.js';

export const DERIVE = { category: categoryTable, walk: walkTable, recovery: recoveryTable, dwell: dwellTable };

export const CATEGORIES = Object.freeze([
  'shrine', 'temple', 'mausoleum', 'museum', 'garden', 'arcade', 'market', 'event', 'experience', 'daytrip',
  'vintage', 'record', 'store', 'bookstore', 'drugstore', 'gift', 'department', 'electronics', 'outlet', 'street',
  'food', 'cafe', 'bar', 'brewery', 'onsen', 'cruise', 'logistics', 'other',
]);

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
 */
export function normalizePoi(raw, { derive = DERIVE } = {}) {
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
  if (rec.prepNeeded[category] && !Array.isArray(raw.prepNeeded)) poi.prepNeeded = [...rec.prepNeeded[category]];
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

  // 座標
  if (!(Number.isFinite(raw.lat) && Number.isFinite(raw.lng))) {
    poi.lat = null; poi.lng = null;
    warnings.push({ code: 'coords-missing', poiId: poi.id, msg: '沒有座標' });
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
