// 規劃頁的改動存在手機（T16b；原話 #154「我的桌機就是我的小型伺服器，手機是我實際操作的地方」、#121「整趟已經排好、你只改不順眼的」——改了的要留著、#171 不去了要一次性復原）：
// 換一家、不去了、復原、升級成站、二選一、排到別天都只改記憶體裡的 state.trip，重開 App 或換頁重載就回到打包檔；現場頁的改案（field.applied）早就存手機、
// 打包時間相同才還原（applied.js restoreApplied），規劃頁的改動比照：快照存整天的 picks／removed／swapped 與整趟的 deferred（不是差分，跟 applied 一樣簡單），
// packAt（打包時間 meta.generatedAt）與 tripId 都相同才蓋回；不同（手機更新了新打包、換了旅程）就丟掉、規劃頁頂端講一句。
// 這裡只有純邏輯（可測）；localStorage 鍵 trip-pilot:trip-edits 的讀寫與打包那版的對照（state.tripBase）在 app.js，設定頁那行在 settings.js。

/** 陣列才收、裡面只留物件（手改或別版本寫壞的鍵：picks: 5、[null] 那種，蓋回去 planTrip 會直接丟錯、App 停在空白頁；10-16 審查）。 */
const arr = (v) => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : []);

/** 一天會被規劃頁動到的三個陣列（沒有就空陣列）；anchor、designated、persons 那些來自打包檔，不存。 */
function dayEdits(d) {
  return { picks: arr(d?.picks), removed: arr(d?.removed), swapped: arr(d?.swapped) };
}

/** 鍵的形狀對不對：days 要是物件（每天的值也要是物件）、deferred 有的話要是陣列；不對的當壞掉（呼叫端刪鍵、不蓋回）。 */
export function validTripEdits(edits) {
  if (!edits || typeof edits !== 'object' || Array.isArray(edits)) return false;
  const badDay = (e) => e != null && (typeof e !== 'object' || Array.isArray(e) || ['picks', 'removed', 'swapped'].some((k) => e[k] != null && !Array.isArray(e[k])));
  if (edits.days != null && (typeof edits.days !== 'object' || Array.isArray(edits.days) || Object.values(edits.days).some(badDay))) return false;
  if (edits.deferred != null && !Array.isArray(edits.deferred)) return false;
  return true;
}

/** 快照：{ packAt, tripId, days: { [date]: { picks, removed, swapped } }, deferred }。陣列照引用、不 clone（呼叫端存成 JSON；要留在記憶體裡當對照的自己 clone）。 */
export function snapshotTripEdits(trip, packAt = null) {
  return {
    packAt: packAt ?? null,
    tripId: trip?.id ?? null,
    days: Object.fromEntries((trip?.days ?? []).map((d) => [d.date, dayEdits(d)])),
    deferred: trip?.deferred ?? [],
  };
}

/** 把快照蓋回 trip：days[date] 的三個陣列與 deferred 蓋回；快照沒有的那幾天不動（原物件）、日期不在這趟的那幾筆跳過。回新 trip，不改傳入的；不看 packAt（載入要對照用 applyTripEdits）。 */
export function overlayTripEdits(trip, edits) {
  const days = (trip?.days ?? []).map((d) => { const e = edits?.days?.[d.date]; return e && typeof e === 'object' ? { ...d, ...dayEdits(e) } : d; });
  return { ...trip, days, deferred: arr(edits?.deferred) };
}

/**
 * 載入旅程之後、重排之前：快照的 packAt 與 tripId 都跟現在的相同才蓋回 → { trip: 新 trip, dropped: false }；
 * 不同（手機更新了新打包、或換了旅程）→ 原 trip、dropped: true（呼叫端刪鍵、規劃頁頂端一句）；沒有快照 → 原 trip、dropped: false。
 * 示範旅程沒有打包（packAt null）：null 對 null 算相同，跟 restoreApplied 一樣。
 */
export function applyTripEdits(trip, edits, packAt = null) {
  if (edits == null) return { trip, dropped: false };
  if (!validTripEdits(edits)) return { trip, dropped: true };   // 形狀壞掉的當丟掉（呼叫端刪鍵），不讓它把 App 弄到開不起來
  if ((edits.packAt ?? null) !== (packAt ?? null) || (edits.tripId ?? null) !== (trip?.id ?? null)) return { trip, dropped: true };
  return { trip: overlayTripEdits(trip, edits), dropped: false };
}

/** 鍵排序過的 JSON（比對用）：物件鍵的先後與值是 undefined 的鍵都不算差異，跟過了 JSON 的那份比才公平。 */
function canon(v) {
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`;
  return JSON.stringify(v) ?? 'null';
}

/**
 * 跟打包那版比（base＝載入時對打包檔的 trip 做的 snapshotTripEdits）：哪幾天的三個陣列不一樣（dates，照 trip.days 的順序）、deferred 一不一樣；any＝有任何一樣。
 * 設定頁「本機改動：N 天有改」與存鍵前「跟打包一樣就刪鍵」都用這個。沒給 base 就跟空的比。
 */
export function diffTripEdits(trip, base = null) {
  const now = snapshotTripEdits(trip);
  const dates = Object.keys(now.days).filter((date) => canon(now.days[date]) !== canon(base?.days?.[date] ?? dayEdits(null)));
  const deferredChanged = canon(now.deferred) !== canon(base?.deferred ?? []);
  return { dates, deferredChanged, any: dates.length > 0 || deferredChanged };
}
