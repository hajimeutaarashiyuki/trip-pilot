// 規劃頁的改動存在手機（T16b；原話 #154「我的桌機就是我的小型伺服器，手機是我實際操作的地方」、#121「整趟已經排好、你只改不順眼的」——改了的要留著、#171 不去了要一次性復原）：
// 換一家、不去了、復原、升級成站、二選一、排到別天都只改記憶體裡的 state.trip，重開 App 或換頁重載就回到打包檔；現場頁的改案（field.applied）早就存手機、
// 打包時間相同才還原（applied.js restoreApplied），規劃頁的改動比照：快照存整天的 picks／removed／swapped 與整趟的 deferred（不是差分，跟 applied 一樣簡單），
// packAt（打包時間 meta.generatedAt）與 tripId 都相同才蓋回；不同（手機更新了新打包、換了旅程）就丟掉、規劃頁頂端講一句。
// 11-06 第二批：每天多帶兩樣——pinned（升級成站安插之後那天釘住的順序，engine/insert.js；原話 #192、#194）與 breakfast（吃飯店早餐／改天去的紀錄，engine/breakfast.js；原話 #196、#197）。
// 不帶的話重開 App 就忘了他調過的順序與早餐的決定，一次性復原與「還原成打包版」也帶不回去。舊版存的鍵沒有這兩欄，照舊讀得進來。
// 這裡只有純邏輯（可測）；localStorage 鍵 trip-pilot:trip-edits 的讀寫與打包那版的對照（state.tripBase）在 app.js，設定頁那行在 settings.js。

/** 陣列才收、裡面只留物件（手改或別版本寫壞的鍵：picks: 5、[null] 那種，蓋回去 planTrip 會直接丟錯、App 停在空白頁；10-16 審查）。 */
const arr = (v) => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : []);
const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v);

/**
 * 那天釘住的順序（旅程檔 days[].pinned；engine/insert.js，原話 #192「順路站 升級成站時 不應該把原本的行程刪掉 應該是安插進來」）：
 * 形狀對（物件、sequence 是陣列）才收，sequence 裡只留物件；沒有或寫壞是 null（那天照常搜尋）。每一筆的細部由引擎自己再驗（pinnedOf）。
 */
const pinnedEdit = (v) => (isObj(v) && Array.isArray(v.sequence) ? { ...v, sequence: arr(v.sequence) } : null);
/** 那天的早餐他說不排（旅程檔 days[].breakfast：吃飯店早餐／改天去；engine/breakfast.js，原話 #196）：是物件才收，沒有是 null。細部由引擎再驗（breakfastChoiceOf）。 */
const breakfastEdit = (v) => (isObj(v) ? v : null);
/**
 * 上一版引擎替那天挑的早餐（旅程檔 days[].engineBreakfast：店的 id；engine/breakfast.js keepBreakfasts 每次重排完記的）：非空字串才收，沒有是 null。
 * 這不是他的改動，是引擎的備忘——跟著快照存，重開 App 之後重排才會沿用同一家（不存的話，他動過某一天之後重開，別天的早餐會無聲換店）；
 * 算「跟打包那版有沒有不一樣」時不看它（diffTripEdits）。
 */
const keptBreakfastEdit = (v) => (typeof v === 'string' && v ? v : null);

/**
 * 一天會被規劃頁動到的東西：三個陣列（沒有就空陣列）、釘住的順序 pinned、早餐不排的紀錄 breakfast（後兩樣沒有是 null；11-06 第二批加的），
 * 外加引擎的備忘 engineBreakfast（上一版引擎替這天挑的早餐，沒有是 null；11-12 加的）。anchor、designated、persons 那些來自打包檔，不存。
 */
function dayEdits(d) {
  return { picks: arr(d?.picks), removed: arr(d?.removed), swapped: arr(d?.swapped), pinned: pinnedEdit(d?.pinned), breakfast: breakfastEdit(d?.breakfast), engineBreakfast: keptBreakfastEdit(d?.engineBreakfast) };
}
/** 一天裡他自己的改動（dayEdits 扣掉引擎的備忘）：跟打包那版比對用。 */
function userEdits(d) {
  const { engineBreakfast: _memo, ...mine } = dayEdits(d);
  return mine;
}

/**
 * 鍵的形狀對不對：days 要是物件（每天的值也要是物件）、deferred 有的話要是陣列；pinned 有的話要是帶 sequence 陣列的物件、breakfast 有的話要是物件、
 * engineBreakfast 有的話要是字串；不對的當壞掉（呼叫端刪鍵、不蓋回）。舊版存的鍵沒有 pinned、breakfast、engineBreakfast 這幾欄，照樣合法。
 */
export function validTripEdits(edits) {
  if (!edits || typeof edits !== 'object' || Array.isArray(edits)) return false;
  const badDay = (e) => e != null && (typeof e !== 'object' || Array.isArray(e)
    || ['picks', 'removed', 'swapped'].some((k) => e[k] != null && !Array.isArray(e[k]))
    || (e.pinned != null && !(isObj(e.pinned) && Array.isArray(e.pinned.sequence)))
    || (e.breakfast != null && !isObj(e.breakfast))
    || (e.engineBreakfast != null && typeof e.engineBreakfast !== 'string'));
  if (edits.days != null && (typeof edits.days !== 'object' || Array.isArray(edits.days) || Object.values(edits.days).some(badDay))) return false;
  if (edits.deferred != null && !Array.isArray(edits.deferred)) return false;
  return true;
}

/**
 * 快照：{ packAt, tripId, days: { [date]: { picks, removed, swapped, pinned, breakfast, engineBreakfast } }, deferred }。陣列與物件照引用、不 clone（呼叫端存成 JSON；要留在記憶體裡當對照的自己 clone）。
 * 一次性復原（原話 #171、#181）就是動作前先拿一份這個（JSON clone），按「復原」用 overlayTripEdits 整份蓋回去：安插（釘住順序）、早餐的鍵都帶得回來。
 */
export function snapshotTripEdits(trip, packAt = null) {
  return {
    packAt: packAt ?? null,
    tripId: trip?.id ?? null,
    days: Object.fromEntries((trip?.days ?? []).map((d) => [d.date, dayEdits(d)])),
    deferred: trip?.deferred ?? [],
  };
}

/**
 * 把快照蓋回 trip：days[date] 的三個陣列、pinned、breakfast 與 deferred 蓋回；快照沒有的那幾天不動（原物件）、日期不在這趟的那幾筆跳過。回新 trip，不改傳入的；不看 packAt（載入要對照用 applyTripEdits）。
 * pinned、breakfast、engineBreakfast：快照那天有這個鍵就照它（是 null＝那天沒釘住／早餐照常排／沒有記著引擎挑的早餐，旅程檔那天的這一欄拿掉）；整個鍵都沒有（舊版存的快照）就不動旅程檔那天的。
 */
export function overlayTripEdits(trip, edits) {
  const days = (trip?.days ?? []).map((d) => { const e = edits?.days?.[d.date]; return e && typeof e === 'object' ? overlayDay(d, e) : d; });
  return { ...trip, days, deferred: arr(edits?.deferred) };
}

function overlayDay(d, e) {
  const next = { ...d, picks: arr(e.picks), removed: arr(e.removed), swapped: arr(e.swapped) };
  for (const [key, read] of [['pinned', pinnedEdit], ['breakfast', breakfastEdit], ['engineBreakfast', keptBreakfastEdit]]) {
    if (!(key in e)) continue;
    const v = read(e[key]);
    if (v) next[key] = v; else delete next[key];
  }
  return next;
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
 * 跟打包那版比（base＝載入時對打包檔的 trip 做的 snapshotTripEdits）：哪幾天的三個陣列、釘住的順序、早餐不排的紀錄不一樣（dates，照 trip.days 的順序）、deferred 一不一樣；any＝有任何一樣。
 * 設定頁「本機改動：N 天有改」與存鍵前「跟打包一樣就刪鍵」都用這個。沒給 base 就跟空的比。base 那天少了 pinned、breakfast 兩欄（舊版做的對照）當作沒有。
 * 引擎的備忘（engineBreakfast）不算他的改動、不比：只有它不一樣時是「沒有改」，鍵照刪——他沒動過的旅程重開後整趟重新分，分出來的就是記著的那一份。
 */
export function diffTripEdits(trip, base = null) {
  const now = snapshotTripEdits(trip);
  const dates = Object.keys(now.days).filter((date) => canon(userEdits(now.days[date])) !== canon(userEdits(base?.days?.[date] ?? null)));
  const deferredChanged = canon(now.deferred) !== canon(base?.deferred ?? []);
  return { dates, deferredChanged, any: dates.length > 0 || deferredChanged };
}
