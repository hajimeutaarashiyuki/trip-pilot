// 餐段、夜間時段、一日遊回程的共用尺（11-06；原話 #189、#190）。不是規則、不進 BUILTIN，跟 _helpers.js 一樣只給別人 import：
// 規則 meal-slots、night-slot、last-train、day-trip-night，分配器 engine/allocate.js，engine/trip.js 都讀這裡——「這一站算不算午餐／晚餐」「夜間時段幾點到幾點」
// 「一日遊幾點回到市區」各只有一個算法，不各寫一套。只 import engine/time.js 與 data/country.js。
import { hmToMin, minToHm, overlapMin } from '../engine/time.js';
import { nightWalkCapMin } from '../data/country.js';

const safeHm = (hm) => { try { return hmToMin(hm); } catch { return null; } };

// ── 餐段（原話 #189）──
/**
 * 餐段前後各放寬幾分鐘（settings.mealGraceMin；缺或寫壞用 60）。
 * 原話 #189：「基本上 只要合理順路 排當天順序時目前不保證落在晚餐時段。這點不強制 像是有主行程要跑 但時間落在晚餐時段 那晚餐提早或延後 都可以」。
 * 60 是預設，11-06 實跑比過才取的：現況、一律放寬 60／90／120、只在主行程或固定時段蓋到餐段時放寬、放寬再跟著那件事延伸、只分上下半天、咖啡廳不放寬，
 * 各跑三個打包檔與它們給分配器重排後的版本。三個打包檔上 60 與 90 結果相同（8/16 流灯会佔住晚餐段的假警報拿掉、平常日的序列不變）；
 * 120 會把 09:02 的早餐算成午餐、15:47 的立飲算成晚餐。取 60 的依據：仙台知識庫 11 家分午晚兩段的餐廳有 6 家 17:00 開晚餐（16:30 兩家、17:30 兩家、18:00 一家），
 * 放寬 60 分剛好讓「一開門就進去吃」算晚餐，而且停留一小時的晚餐不會早於 16:00 開始（90 分的話 15:31 開始的也算）。
 * 已知的缺口：主行程散得更晚、回到市區 21:30 以後才吃的晚餐還是不算（三個打包檔沒有這種日子，未量）。舊打包檔內嵌的 rules.json 沒有這個鍵，所以一律走這裡的預設。
 */
export const MEAL_GRACE_DEFAULT_MIN = 60;
export function mealGraceOf(settings) {
  const g = settings?.mealGraceMin;
  return Number.isFinite(g) && g >= 0 ? g : MEAL_GRACE_DEFAULT_MIN;
}

const mealCache = new WeakMap();   // country → { src, g, slots }：整天規則每個搜尋節點都會問一次，餐段字串不重複解析
/**
 * 國家層的餐段（country.mealSlots，日本午 11:30–13:30、晚 18:00–20:30）→ [{ slot, core: [起, 訖], window: [起 − 放寬, 訖 + 放寬] }]，照開始時刻排；缺或寫壞的那一段跳過。
 * core＝原本的餐段：「這天要不要這一餐」（餐段落不落在當天時窗內）與「被固定時段蓋住」（coversMealSlot）看它；
 * window＝放寬後的時窗：「這一站算不算這一餐」「這家店這一餐開不開」看它（規則與分配器同一把尺）。回傳的陣列是共用的，不要改它。
 */
export function mealSlotsOf(country, settings) {
  const g = mealGraceOf(settings);
  const src = country?.mealSlots;
  const hit = country && typeof country === 'object' ? mealCache.get(country) : null;
  if (hit && hit.src === src && hit.g === g) return hit.slots;
  const slots = [];
  for (const [slot, range] of Object.entries(src ?? {})) {
    if (!Array.isArray(range) || range.length !== 2) continue;
    const a = safeHm(range[0]); const b = safeHm(range[1]);
    if (a == null || b == null || b <= a) continue;
    slots.push(Object.freeze({ slot, core: Object.freeze([a, b]), window: Object.freeze([a - g, b + g]) }));
  }
  slots.sort((x, y) => x.core[0] - y.core[0]);
  Object.freeze(slots);
  if (country && typeof country === 'object') mealCache.set(country, { src, g, slots });
  return slots;
}

/** 一段時間 [startMin, endMin] 有沒有落進某個時窗 [from, to]（重疊超過 0 分就算，跟放寬前的判法一樣）。 */
export function inWindow(startMin, endMin, window) {
  return Array.isArray(window) && overlapMin(startMin, endMin, window[0], window[1]) > 0;
}

/**
 * 固定時段的站蓋住餐段（大會供餐：研討會、晚宴）：從餐段開始前就在進行、到餐段過半還沒散（10-14 T23）。看原本的餐段（core），不看放寬後的——
 * 放寬是給「吃的站可以早一點晚一點」用的，不是讓 16:30 就開始的活動變成供餐。
 */
export function coversMealSlot(startMin, endMin, core) {
  return Array.isArray(core) && startMin <= core[0] && endMin >= (core[0] + core[1]) / 2;
}

/**
 * 哪幾餐沒著落：每個餐段配一個候選、每個候選最多配一餐（午、晚不重複算；主控 11-06 定）。
 * needs：[{ slot, cands: [候選…] }]（照時間先後；候選是同一批物件的參照）→ 配不到的 slot 陣列。
 * 兩餐以內直接判（只有「兩餐的候選都只有同一個」才會互搶，前面的餐段留著、後面的缺）；三餐以上走小型二分配對（augmenting path）。
 */
export function unmetMeals(needs) {
  if (needs.length <= 2) {
    const out = needs.filter((n) => n.cands.length === 0).map((n) => n.slot);
    if (needs.length === 2 && needs[0].cands.length === 1 && needs[1].cands.length === 1 && needs[0].cands[0] === needs[1].cands[0]) out.push(needs[1].slot);
    return out;
  }
  const owner = new Map();   // 候選 → needs 的索引
  const take = (i, seen) => {
    for (const c of needs[i].cands) {
      if (seen.has(c)) continue;
      seen.add(c);
      if (!owner.has(c) || take(owner.get(c), seen)) { owner.set(c, i); return true; }
    }
    return false;
  };
  needs.forEach((_, i) => take(i, new Set()));
  const matched = new Set(owner.values());
  return needs.filter((_, i) => !matched.has(i)).map((n) => n.slot);
}

// ── 夜間時段 ──
/** 算夜間站的店型（居酒屋、酒吧、吃的；規則 night-slot 原本的那一組）。 */
export const NIGHT_CATEGORIES = Object.freeze(['bar', 'food']);

const nightCache = new WeakMap();   // country → { src, cap, window }
/**
 * 夜間時段 [起, 訖]（分鐘）：country.nightSlot（日本 20:00–24:00），尾端再受夜間步行風險管（data/country.js nightWalkCapMin：mid 23:00、high 22:00）。
 * 缺、寫壞、或收掉之後沒有長度回 null。規則 night-slot、day-trip-night 與分配器的夜間站配額讀同一個。回傳的陣列是共用的，不要改它。
 */
export function nightWindowOf(country) {
  const src = country?.nightSlot;
  const cap = nightWalkCapMin(country);
  const hit = country && typeof country === 'object' ? nightCache.get(country) : null;
  if (hit && hit.src === src && hit.cap === cap) return hit.window;
  let window = null;
  if (Array.isArray(src) && src.length === 2) {
    const from = safeHm(src[0]); let to = safeHm(src[1]);
    if (from != null && to != null) {
      if (cap != null) to = Math.min(to, cap);
      if (to > from) window = Object.freeze([from, to]);
    }
  }
  if (country && typeof country === 'object') nightCache.set(country, { src, cap, window });
  return window;
}

/** 這一站是不是夜間站：店型是 bar／food、而且落在夜間時段裡。（引擎插的算不算由呼叫端管。） */
export function isNightStop(stop, nightWindow) {
  return NIGHT_CATEGORIES.includes(stop?.poi?.category) && inWindow(stop.startMin, stop.endMin, nightWindow);
}

// ── 一日遊的回程（原話 #190）──
/**
 * 一日遊回到市區「不算晚」的時刻（分鐘）：settings.dayTripNightReturnByHM，缺或寫壞用 21:00。
 * 原話 #190：「一日遊的夜間站 可以是在當地進行 只要趕的上末班車都可以 或是回程不算晚(9:00)也可以排進來」——(9:00) 是晚上九點。
 */
export const DAY_TRIP_RETURN_BY_DEFAULT_HM = '21:00';
export function dayTripReturnByMin(settings) {
  return safeHm(settings?.dayTripNightReturnByHM ?? DAY_TRIP_RETURN_BY_DEFAULT_HM) ?? hmToMin(DAY_TRIP_RETURN_BY_DEFAULT_HM);
}

/**
 * 這天從外地回到據點所在區的時刻（分鐘）：序列裡最後一個「外地」的站結束（照引擎的時間軸：固定時段的含散場緩衝）＋從那一區回據點的搭車與走路分鐘。
 * away＝day.away（engine/trip.js awayOf）：{ [區 id]: { homeMin, last? } }，只列「從那裡回住宿要搭車」的區；站的區不在表裡＝在市區（走得回住宿）。
 * 沒去外地、或沒有這張表回 null（＝沒有回程這件事）。只看最後一個外地站：中午先回市區吃飯、下午又出去的，算最後那一趟。
 * upTo：只看序列的前 upTo 站（判某一站「之前」回來了沒有；不給就是整條）。
 */
export function returnToTownMin(sequence, away, upTo = null) {
  if (!away || !Array.isArray(sequence)) return null;
  for (let i = (upTo == null ? sequence.length : Math.min(upTo, sequence.length)) - 1; i >= 0; i--) {
    const w = away[sequence[i]?.poi?.zoneId];
    if (w) return sequence[i].endMin + (Number.isFinite(w.homeMin) ? w.homeMin : 0);
  }
  return null;
}

/**
 * 序列裡「一日遊回到市區已經晚於 dayTripNightReturnByHM、之後才排的市區夜間站」：回 [{ index, stop, backMin, byMin }]。
 * 市區＝站的區不在 day.away 裡；夜間站＝bar／food 且落在夜間時段（isNightStop）。不是一日遊、沒去外地、回得不晚都回空陣列。
 * 規則 day-trip-night（引擎自己插的不准）與 dayTripNightHints（他勾的只提示）共用。
 */
export function lateTownNightStops({ sequence, day, settings, country }) {
  if (!day?.dayTrip || !day.away || !Array.isArray(sequence) || !sequence.length) return [];
  const night = nightWindowOf(country);
  if (!night) return [];
  const byMin = dayTripReturnByMin(settings);
  const out = [];
  for (let i = 1; i < sequence.length; i++) {
    const s = sequence[i];
    if (!s?.poi || day.away[s.poi.zoneId] || !isNightStop(s, night)) continue;
    const backMin = returnToTownMin(sequence, day.away, i);
    if (backMin != null && backMin > byMin) out.push({ index: i, stop: s, backMin, byMin });
  }
  return out;
}

/**
 * 一日遊回到市區已經晚於 dayTripNightReturnByHM、後面還排了市區的夜間站：他勾的照排（總則 3），那站多一條提示（不罰、不是牆；原話 #190 只說「回程不算晚也可以排進來」，
 * 晚了還要不要去是他的事）。引擎自己插的不會出現在這裡（規則 day-trip-night 擋掉）。
 * 回 [{ ruleId: 'day-trip-night', code: 'hint', hint: true, poiId, backMin, msg }]。
 * 跟 person-avoid、leg-suggest 同一種後處理：engine/trip.js planTrip 每天排完掛上去，不進分數；分配器（engine/allocate.js）看到自己分的站被掛這條就收回。
 */
export function dayTripNightHints({ sequence, day, settings, country }) {
  return lateTownNightStops({ sequence, day, settings, country })
    .filter((x) => !x.stop.insertedBy)
    .map((x) => ({ ruleId: 'day-trip-night', code: 'hint', hint: true, poiId: x.stop.poi.id, backMin: x.backMin, msg: `一日遊回到市區已經 ${minToHm(x.backMin)}（晚於 ${minToHm(x.byMin)}），${x.stop.poi.name_zh ?? '這一站'} 照你勾的排；太晚就別去了` }));
}
