// 時間都用「當天 00:00 起算的分鐘數」；可以超過 1440（"26:00" ＝ 1560，DESIGN §11.1 Q2）。
export function hmToMin(hm) {
  if (typeof hm === 'number') return hm;
  const m = String(hm).match(/^(\d{1,2}):(\d{2})$/);
  if (!m) throw new Error(`時間格式要是 HH:MM：${hm}`);
  return Number(m[1]) * 60 + Number(m[2]);
}

export function minToHm(min) {
  const h = Math.floor(min / 60); const m = Math.round(min % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** 兩段 [a1,a2) 與 [b1,b2) 的重疊分鐘。 */
export function overlapMin(a1, a2, b1, b2) {
  return Math.max(0, Math.min(a2, b2) - Math.max(a1, b1));
}

const DOW = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
/** 'YYYY-MM-DD' → 'mon'…'sun'。 */
export function dowOf(dateStr) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  return DOW[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

/** POI 當天的營業區間（分鐘），沒有結構化資料回 null；當天休息回 []。 */
export function openIntervals(poi, dateStr) {
  if (!poi?.hours || typeof poi.hours !== 'object') return null;
  if (Array.isArray(poi.closedDates) && poi.closedDates.includes(dateStr)) return [];
  const list = poi.hours[dowOf(dateStr)];
  if (!Array.isArray(list)) return [];
  return list.map(([open, close]) => [hmToMin(open), hmToMin(close)]);
}
