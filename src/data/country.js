// 國家層（kb/country/<id>.json，打包時當 pack.country 帶進手機）的讀法集中在這一檔：引擎與畫面讀哪個鍵、缺了怎麼辦都在這裡，
// 換國家只動資料不動程式（總則 7、原話 #135；10-16 T20）。規則檔自己讀的（meal-slots、night-slot、noon-urban、daylight）在各規則的 reads 宣告，缺就跳過並警告。
// 誰讀哪個鍵：
// - taxRefund.bufferMin、taxRefund.effectiveFrom、taxRefund.mode → engine/trip.js dayWindow（離境日收工再扣緩衝，只在旅程日期 ≥ 生效日）
// - transportProfile.nightWalk.risk → engine/trip.js dayWindow（時窗尾端）與 rules/night-slot.js（夜間時段尾端）：low 照舊、mid 23:00、high 22:00（預設、推導）
// - themes → ui/brief.js 主題勾選框與 data/brief.js 複製出來的文字（themeOptions）
// - commonErrands → ui/brief.js「要辦的事」的例子
// - drivingPermit.summary → ui/brief.js 選租車／重機時的提示
// - recoveryTypes[].prepNeeded → data/schema.js normalizePoi（打包與手機讀入時把打包待辦帶到 POI.prepNeeded）
// - mealSlots、nightSlot、climate.summerMonths、utcOffsetMin → 規則 meal-slots、night-slot、noon-urban、daylight（utcOffsetMin 另有 engine/core.js、ui/daylight.js）
// 其餘鍵（knifeLaw、language、itemLandscape、holidays…）是研究與桌機工具讀的，引擎不讀。

/** 夜間步行風險 → 夜裡最晚幾點（分鐘）：mid 23:00、high 22:00；low、缺、看不懂都回 null（不設限）。數字是預設、推導（待確認）。 */
const NIGHT_WALK_CAP_MIN = Object.freeze({ mid: 23 * 60, high: 22 * 60 });
export function nightWalkCapMin(country) {
  const risk = country?.transportProfile?.nightWalk?.risk;
  return NIGHT_WALK_CAP_MIN[risk] ?? null;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/**
 * 離境日報到之前要多留的免稅緩衝分鐘：taxRefund.bufferMin，只在旅程日期 ≥ taxRefund.effectiveFrom 才算
 * （日本 2026-11-01 起的出境退款制；仙台 2026-08 不扣）。沒寫生效日＝已生效；有生效日但日期不明（沒給、格式不對）就不扣；mode none 或沒有免稅制度回 0。
 */
export function taxRefundBufferMin(country, date) {
  const t = country?.taxRefund;
  if (!t || t.mode === 'none') return 0;
  const min = Number(t.bufferMin);
  if (!(min > 0)) return 0;
  if (t.effectiveFrom) {
    if (typeof date !== 'string' || !DATE_RE.test(date)) return 0;
    if (date < t.effectiveFrom) return 0;
  }
  return min;
}

const THEME_ID_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/i;
/** 需求單主題勾選框的選項：country.themes [{ id, name_zh }] → [{ id, label }]；缺、空、整個都壞就回 null（呼叫端用預設的五個）。壞的那幾筆跳過。 */
export function themeOptionsOf(country) {
  const raw = country?.themes;
  if (!Array.isArray(raw)) return null;
  const out = [];
  const seen = new Set();
  for (const t of raw) {
    const id = typeof t === 'string' ? t : t?.id;
    if (typeof id !== 'string' || !THEME_ID_RE.test(id) || seen.has(id)) continue;
    const label = typeof t === 'object' && t && typeof t.name_zh === 'string' && t.name_zh.trim() ? t.name_zh.trim() : id;
    seen.add(id);
    out.push({ id, label });
  }
  return out.length ? out : null;
}

/** 需求單「要辦的事」的例子：country.commonErrands（字串陣列）；缺或空回 null（呼叫端用預設）。 */
export function errandExamplesOf(country) {
  const list = Array.isArray(country?.commonErrands) ? country.commonErrands.filter((s) => typeof s === 'string' && s.trim()).map((s) => s.trim()) : [];
  return list.length ? list : null;
}

/** 租車／重機時的駕照提示：country.drivingPermit.summary；缺回 null。 */
export function drivingPermitSummaryOf(country) {
  const s = country?.drivingPermit?.summary;
  return typeof s === 'string' && s.trim() ? s.trim() : null;
}

/** 這個店型是不是「要準備的恢復站型」：country.recoveryTypes 裡 category 相同且有 prepNeeded 的那筆 → 打包待辦的複本；沒有回 null。 */
export function prepNeededOf(country, category) {
  const list = Array.isArray(country?.recoveryTypes) ? country.recoveryTypes : [];
  const hit = list.find((r) => r && r.category === category && Array.isArray(r.prepNeeded) && r.prepNeeded.length);
  const prep = hit ? hit.prepNeeded.filter((s) => typeof s === 'string' && s.trim()).map((s) => s.trim()) : [];
  return prep.length ? prep : null;
}
