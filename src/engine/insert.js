// 升級成站＝安插、釘住順序（11-06 第二批；主控 11-06 定的落地 A）。原話：
// #192「順路站 升級成站時 不應該把原本的行程刪掉 應該是安插進來」
// #194「當然安插進來後 會壓縮到後面的行程 那就再跳一組選項問我 要壓縮哪個行程或是砍掉」
// 他講的是規劃頁每段移動旁的走廊清單（「經過 N 家」點開，每家有「升級成站」）。之前升級＝把那家加進 picks 再整天重跑搜尋（ui/app.js upgradeCorridor），
// 引擎插的站重新決定、他勾的站也會被擠掉——主控 11-06 在七天包上重現：49 次試驗 40 次有原本的站不見、32 次其餘順序變了。
//
// 這一檔三件事，都是純函式（不改傳入的東西）；不 import engine/trip.js（trip.js 與 choices.js 反過來 import 這裡）：
// 1. 安插試算 insertTrial：把那家插進它所在的那一段（走廊清單掛在哪一段就插哪一段），原本畫面上的每一站都留著、先後不變，整條重定時刻、整天重算；
//    收工線用那天的原時窗（留白可以被這一插用掉——留白本來就是留給臨時起意的；主控定，推導）。排得下回 fits: true；排不下回哪一站因為什麼排不下，加一組選項
//    （插的這家少待、後面某一站少待、某一站不去），每個選項都真的試排過、帶套了之後的結果。單一選項解不掉就拿選好的那個當草稿再呼叫一次（畫面最多問 INSERT_MAX_ROUNDS 輪）。
// 2. 旅程檔的動作：applyInsert（picks 加那家、那天釘住順序、選了「不去某站」的照「不去了」記）、unpinDay（讓引擎重排這天）。
// 3. 釘住順序的一天怎麼排 planPinnedDay（engine/trip.js planTrip 遇到 days[].pinned 時呼叫）：不跑搜尋、不插恢復站／填站／順路站／早餐，照記著的順序組序列、重定時刻、重算。
//    試算與它用同一套組法（settle、placeExtras），所以套完重排出來的就是試算的那一條。
//
// 旅程檔多的欄位：days[].pinned = { at, sequence: [{ poiId, dwellMin?, insertedBy?, priority? }…] }——那天「照他調過的順序排」。
// - sequence 是那天畫面上的每一站，照先後；引擎插的站（恢復站、填站、順路站、坐下來的地方、引擎排的早餐）也照原樣記著（insertedBy 'engine'、priority 是哪一種），才還原得出來。
// - dwellMin：釘住當下那一站的停留（坐下來的地方記的是併進等待之前的）。排的時候優先用它——選項裡「少待」調過的、讓位縮短的填站都靠它還原。
// - 為什麼要釘住（主控定，推導）：不釘住的話，他下一個動作（不去了、換一家、早餐的鍵）又會整天重跑搜尋，把剛插好的行程洗掉。
// 釘住之後那天的每個動作都在這條順序上做：
// - 不去了（picks 拿掉、removed 記一筆）：那一筆在順序裡就被跳過，其餘不動（planPinnedDay 自己認，不用改 pinned）。
// - 換一家（engine/swap.js applySwap）、二選一選了 B：原位置換掉（applySwap 會改寫 pinned；沒改寫到的由那天的 swapped 紀錄對回來）。
// - 吃飯店早餐／改天去（engine/breakfast.js setBreakfast）：早餐那一站被跳過（引擎排的早餐在他說這天不排時不留；他勾的那筆被拿出 picks），「改回來」就回到原位。
// - 早餐換一家、按了「或 X」（putBreakfast）：原位置換掉；那天本來沒早餐就排在第一站。
// - 順序以外的勾選站（順延進來的、釘住時就排不進的）：重排時試每個位置，排得下、整天分數有變好（順延進來的不看分數）、不多用留白才插（placeExtras）；
//   排進去之後位置要記回 pinned——順延的由 engine/choices.js defer 記，其餘的由畫面每次重排完呼叫 repinTrip 記（不記的話下一個動作會讓它自己換位置；11-12 審查）。
// - 別天不跟著變（11-12 審查）：釘住的日子記著的引擎站、升級成站加進來的那筆勾選（picks[].via 'corridor'）、選項裡選了不去的引擎站（removed[].via 'insert'），
//   在別天都是「挑好引擎插站的名單之後才拿掉」（engine/trip.js planTrip 的 lateIds）。
// 「讓引擎重排這天」＝unpinDay：pinned 拿掉，那天回到搜尋（「少待」調過的停留跟著順序走，解除就不留——解除是請引擎整天重排，停留回到店自己的）。
import { openIntervals } from './time.js';
import { evaluateSequence, rawWindowDay } from './sequence.js';
import { retimeWithBreakfast, breakfastStop } from './breakfast.js';
import { personAvoidWarnings } from './persons.js';
import { dayTripNightHints, lastTrainHints, lastTrainMisses, lastTrainText, breakfastHints, mealAssignments } from '../rules/_slots.js';

/** 排不下時一組選項解不掉，選了再問一輪，最多問幾輪（主控 11-06 定「最多三輪」）。輪數由畫面管；每次試算的結果帶 round（這是第幾輪）。 */
export const INSERT_MAX_ROUNDS = 3;

/**
 * 安插時引擎填的站讓不讓位：
 * 'fill'（採用）＝填站是拿來填等開門的空檔的，前面多插一站就短一點（最短 settings.fillMinGapMin 15 分、不拿掉；跟引擎排早餐同一個做法）；
 * 'none'＝填站照原本的停留；'strict'＝填站照舊只能落在第一趟搜尋算的那段空檔（硬規則 filler-gap 照擋；只給比做法用，套用之後不會這樣排）。
 * 'fill' 與 'none' 都把填站的「只能落在那段空檔」拿掉：釘住之後它就是這條順序裡的一站。
 * 11-12 實跑（每天每段走廊清單取前兩家各試一次；10-27 的舊包三個、段 K 待套用版知識庫新打的三個；直接排得下的個數／試驗數）：
 * - 'fill'：七天包 38／49、公務版 34／45、試走版 4／16；待套用版 42／58、41／52、5／16。
 * - 'none'：37／49、33／45、4／16；42／58、40／52、5／16。待套用版七天包同樣 42 個排得下，後面的站最多順延的分鐘合計 1205（'fill' 是 1111）。
 * - 'strict'：31／49、27／45、0／16；32／58、29／52、0／16——多出來排不下的都卡在填站超出它的空檔（各 6、6、4、10、11、5 個）。
 * 三種做法排得下的每一個都驗過：原本的站一站不少、先後不變、套進旅程檔重排出來跟試算一模一樣。
 * 取 'fill'：排得下的不比別種少、後面順延得少；填站本來就是照空檔長度裁的，空檔被他自己要去的店用掉，它短一點合理（主控定：順延先用掉站與站之間等開門的空檔）。
 */
export const INSERT_POLICY = Object.freeze({ giveWay: 'fill' });

/** 釘住的日子上引擎站被讓掉時那一句提示的 ruleId（plan.warnings 裡 hint: true、沒有 poiId 的一條；不是規則檔裡的規則，跟 leg-suggest、person-avoid 同一種後處理）。 */
export const PINNED_ORDER_HINT = 'pinned-order';

const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v);
const stamp = (at) => (typeof at === 'string' && at ? at : new Date().toISOString());
const withDay = (trip, date, fn) => ({ ...trip, days: (trip?.days ?? []).map((d) => (d.date === date ? fn(d) : d)) });

/** 安插進來的站至少待幾分（settings.insertMinDwellMin，預設 30；原話 #52「順路看的點至少會待到半小時」）。也是選項裡「少待」的下限之一。 */
export function insertMinDwellOf(settings) {
  const v = Number(settings?.insertMinDwellMin);
  return Number.isFinite(v) && v > 0 ? v : 30;
}

/** 安插進來的那一站停多久：店自己的停留，沒有用 settings.defaultDwellMin，至少 insertMinDwellMin。 */
export function insertDwellMin(poi, settings = {}) {
  const own = Number(poi?.dwellMin);
  const base = Number.isFinite(own) && own > 0 ? own : (settings.defaultDwellMin ?? 60);
  return Math.max(base, insertMinDwellOf(settings));
}

/** 選項裡「少待」最少要留幾分：原停留的一半，而且不少於 insertMinDwellMin（主控 11-06 定，預設）。 */
export function dwellFloorMin(origMin, settings = {}) {
  return Math.max(insertMinDwellOf(settings), Math.ceil((Number(origMin) || 0) / 2));
}

/** 必去、指定、主行程、固定時段的站：選項裡不列「不去」，釘住的日子撞硬規則時也最後才動它。 */
export function isLockedStop(s) {
  return Boolean(s) && (s.priority === 'must' || Boolean(s.designated) || Boolean(s.isAnchor) || Boolean(s.fixedWindow));
}

// ── 釘住的順序（旅程檔 days[].pinned）──

/**
 * 旅程檔那天的 pinned：形狀對才回 { at, sequence: [{ poiId, dwellMin?, insertedBy?, priority?, slotOpenMin?, off? }] }，沒有或寫壞回 null（那天照常搜尋）。
 * sequence 裡看不懂的筆跳過、同一家店只留第一筆；空陣列也算釘住（他把站都拿掉了，那天照樣不搜尋）。
 * slotOpenMin：那一站記的時候排在當天第二段以後的營業時間，那一段的開門時刻（slotOpenOf）。off: true（只有引擎站有）：記著但不排——撞到別站被讓掉的引擎站，
 * 留這一筆是為了別天照樣不拿它（repinnedSequence）。
 */
export function pinnedOf(tripDay) {
  const p = tripDay?.pinned;
  if (!isObj(p) || !Array.isArray(p.sequence)) return null;
  const seen = new Set(); const sequence = [];
  for (const e of p.sequence) {
    if (!isObj(e) || typeof e.poiId !== 'string' || !e.poiId || seen.has(e.poiId)) continue;
    seen.add(e.poiId);
    const dwell = Number(e.dwellMin);
    sequence.push({
      poiId: e.poiId,
      ...(Number.isFinite(dwell) && dwell > 0 ? { dwellMin: dwell } : {}),
      ...(e.insertedBy === 'engine' ? { insertedBy: 'engine', priority: typeof e.priority === 'string' && e.priority ? e.priority : 'rest' } : {}),
      ...(Number.isFinite(e.slotOpenMin) ? { slotOpenMin: e.slotOpenMin } : {}),
      ...(e.insertedBy === 'engine' && e.off === true ? { off: true } : {}),
    });
  }
  return { at: typeof p.at === 'string' ? p.at : null, sequence };
}

/**
 * 這一站排在哪一段營業時間：那一段的開門時刻（分鐘）。沒有營業時間資料、固定時段的站、時刻對不上任何一段回 null；幾段重疊時取最晚開的那一段。
 * 釘住順序的日子靠它記「這一站原本在哪一段」（pinned.sequence[].slotOpenMin）：之後整條提早、它落在前一段待不完時，等到這一段開門（engine/schedule.js placeStop），不是整站排不進。
 */
export function slotOpenOf(stop, date) {
  if (!stop?.poi || stop.fixedWindow || !Number.isFinite(stop.startMin) || !date) return null;
  const iv = openIntervals(stop.poi, date);
  if (!Array.isArray(iv) || !iv.length) return null;
  let open = null;
  for (const [o, c] of iv) if (stop.startMin >= o && stop.endMin <= c && (open == null || o > open)) open = o;
  return open;
}

/** 站上要不要帶「原本在哪一段」：只有不是當天最早開門的那一段才帶（在第一段的站沒有「等到原本那一段」這回事）。回新的 stop（或原物件）。 */
function withSlotOpen(stop, timed, date) {
  const open = slotOpenOf(timed, date);
  if (open == null) return stop;
  const first = Math.min(...openIntervals(timed.poi, date).map(([o]) => o));
  return open > first ? { ...stop, slotOpenMin: open } : stop;
}

/**
 * 排好的序列 → pinned.sequence 的那幾筆：每站記 poiId 與停留（坐下來的地方扣掉併進去的等待）；引擎插的另記 insertedBy 與 priority。
 * 給了 date 再多記 slotOpenMin：這一站排在當天第二段以後的營業時間時，那一段的開門時刻（見 slotOpenOf；排在第一段的不記）。
 */
export function pinEntriesOf(sequence = [], date = null) {
  return sequence.filter((s) => s?.poi?.id).map((s) => {
    const slot = date ? withSlotOpen({}, s, date).slotOpenMin : undefined;
    return {
      poiId: s.poi.id,
      dwellMin: s.dwellMin - (s.flexedMin ?? 0),
      ...(s.insertedBy ? { insertedBy: s.insertedBy, priority: s.priority } : {}),
      ...(Number.isFinite(slot) ? { slotOpenMin: slot } : {}),
    };
  });
}

/** 整趟每個釘住的日子裡記著的引擎站 id：engine/trip.js 拿它擋「別天又把同一家當恢復站／填站／順路站插一次」。 */
export function pinnedEngineIds(trip) {
  const out = new Set();
  for (const d of trip?.days ?? []) for (const e of pinnedOf(d)?.sequence ?? []) if (e.insertedBy === 'engine') out.add(e.poiId);
  return out;
}

/**
 * 走廊清單升級成站加進來的那筆勾選的記號（picks[].via；applyInsert 寫的）與「釘住的日子上不去的引擎站」的記號（removed[].via：安插的選項裡選了「不去」的由 applyInsert 記，
 * 釘住之後在畫面按「不去了」的由 ui/app.js removeStop 記）。
 * engine/trip.js 靠它們知道哪幾家是「因為安插才變成別天不能拿」的——那幾家在別天改成挑好引擎插站的名單之後才拿掉，別天的行程才不會跟著變（原話 #192；11-12 審查）。
 * 記號跟著那筆勾選走：換一家（engine/swap.js applySwap）換進來的店沿用它（同一個道理：那家也是後來才變成別天不能拿的）；解除釘住之後也留著；
 * 之後對那一站按「不去了」，removed 那一筆也沿用（ui/app.js removeStop 帶過去；選項裡選了不去的由 applyInsert 帶）——不沿用的話它從「挑好才拿掉」變成「一開始就扣掉」，
 * 別天的名單又會遞補一家。
 */
export const CORRIDOR_PICK = 'corridor';
export const INSERT_DROP = 'insert';

/** 整趟帶 via 'corridor' 的店 id（Set）：升級進來的勾選，與之後對它按了「不去了」留在 removed 的那一筆。 */
export function corridorPickIds(trip) {
  const out = new Set();
  for (const d of trip?.days ?? []) for (const p of [...(d.picks ?? []), ...(d.removed ?? [])]) if (p?.via === CORRIDOR_PICK && typeof p.poiId === 'string' && p.poiId) out.add(p.poiId);
  return out;
}

/** 安插的選項裡選了「不去」的引擎站：Map<日期, [poi id]>（removed 帶 insertedBy 'engine'、via 'insert' 的那幾筆）。 */
export function insertDroppedEngine(trip) {
  const out = new Map();
  for (const d of trip?.days ?? []) {
    const ids = (d.removed ?? []).filter((r) => r?.via === INSERT_DROP && r.insertedBy === 'engine' && typeof r.poiId === 'string' && r.poiId).map((r) => r.poiId);
    if (ids.length) out.set(d.date, ids);
  }
  return out;
}

/**
 * 重寫 pinned.sequence 時要留住的那一筆：他說這天早餐不排（旅程檔 days[].breakfast：吃飯店早餐／改天去）而暫時不在序列裡的早餐——
 * 引擎排的那一家（紀錄裡有 poiId、沒有 pick）或他勾的那一筆（breakfast.pick）。之後按「改回來」（engine/breakfast.js clearBreakfast）它要回得來：
 * - 那天本來就釘住：照它在舊順序裡的相對位置放回去（接在它前面最近、新順序裡也有的那一筆後面；沒有就放最前面）。
 * - 那天這次才釘住、原定那家是引擎排的：在最前面補一筆（引擎排的早餐本來就是第一站）。
 * 這幾筆在他說不排的期間排的時候會被跳過（planPinnedDay），不影響試算；改回來之後排不排得進照釘住的日子的規矩（撞到別站就自己讓掉）。
 */
function keepSkippedBreakfast(tripDay, entries) {
  const b = tripDay?.breakfast;
  if (!isObj(b)) return entries;
  const has = (list, id) => list.some((e) => e.poiId === id);
  const pickId = typeof b.pick?.poiId === 'string' ? b.pick.poiId : null;
  const old = pinnedOf(tripDay)?.sequence ?? null;
  if (!old) {
    const id = !pickId && !b.movedTo && typeof b.poiId === 'string' && b.poiId ? b.poiId : null;
    return id && !has(entries, id) ? [{ poiId: id, insertedBy: 'engine', priority: 'breakfast' }, ...entries] : entries;
  }
  const out = [...entries]; let anchor = -1;
  for (const e of old) {
    const k = out.findIndex((x) => x.poiId === e.poiId);
    if (k >= 0) { anchor = k; continue; }
    if (!((e.insertedBy === 'engine' && e.priority === 'breakfast') || (pickId && e.poiId === pickId))) continue;
    out.splice(anchor + 1, 0, e); anchor += 1;
  }
  return out;
}

/**
 * 釘住的日子重排之後，畫面上那一條順序該怎麼記（repinFromPlan、repinTrip 共用）→ 新的 pinned.sequence。
 * - 排進去的每一站照先後各一筆。已經記著的站沿用原本那一筆（停留、slotOpenMin 都是當初記的：之後整條提早或延後，它還是認當初那一段營業時間）；
 *   這次才排進來的（原本排不進、按了別站「不去了」之後排進來的；順延來的）記現在的停留與所在的那一段。
 * - 他說這天早餐不排而暫時不在序列裡的那一筆早餐留著（keepSkippedBreakfast）。
 * - 記著、這次卻沒排進去的引擎站（撞到別站被讓掉的、別天已經勾走的）留一筆 off: true：之後不再排它，但別天照樣不拿它（engine/trip.js 認 pinnedEngineIds）——
 *   放掉的話，別天的引擎會把它撿回去，他只動這一天、別天卻跟著變。
 * - 其餘記著而不在序列裡的（他按過「不去了」的、落到排不進清單的勾選站）不留：排不進的勾選站之後每次重排都當「順序以外的站」再試（placeExtras），排進去那一次才記位置。
 */
function repinnedSequence(tripDay, plan, date) {
  const old = pinnedOf(tripDay)?.sequence ?? [];
  const oldBy = new Map(old.map((e) => [e.poiId, e]));
  const entries = pinEntriesOf(plan.sequence, date).map((e) => { const o = oldBy.get(e.poiId); return o && !o.off && Boolean(o.insertedBy) === Boolean(e.insertedBy) ? o : e; });
  return withParked(tripDay, keepSkippedBreakfast(tripDay, entries));
}

/** 舊順序裡記著、新順序裡沒有的引擎站：接在最後各留一筆 off: true（不排，但別天照樣不拿它）。applyInsert 重寫順序時也走這裡——不然之前被讓掉的引擎站會從紀錄裡消失、別天又能拿它。 */
function withParked(tripDay, entries) {
  const old = pinnedOf(tripDay)?.sequence ?? [];
  const have = new Set(entries.map((e) => e.poiId));
  const parked = old.filter((e) => e.insertedBy === 'engine' && !have.has(e.poiId)).map((e) => ({ poiId: e.poiId, insertedBy: 'engine', priority: e.priority, off: true }));
  return parked.length ? [...entries, ...parked] : entries;
}

/**
 * 釘住的日子重排之後，把排出來的先後記回 pinned（那天沒釘住、或 plan 不是照釘住的順序排的、或記的跟現在一樣，就回原 trip——同一個物件）。
 * 順延進來的站（engine/choices.js defer）排定之後呼叫：它在哪個位置是試出來的，記下來之後重排才不會換位置。整趟每個釘住的日子一起做用 repinTrip。
 */
export function repinFromPlan(trip, date, plan) {
  const day = (trip?.days ?? []).find((d) => d.date === date);
  const pin = day ? pinnedOf(day) : null;
  if (!pin || !plan?.pinned || !Array.isArray(plan.sequence)) return trip;
  const sequence = repinnedSequence(day, plan, date);
  if (JSON.stringify(sequence) === JSON.stringify(pin.sequence)) return trip;
  return withDay(trip, date, (d) => ({ ...d, pinned: { ...d.pinned, sequence } }));
}

/**
 * 整趟重排之後（ui/app.js 每次 planTrip 完呼叫），每個釘住的日子把畫面上那一條記回 pinned：repinTrip(trip, days) → 新 trip；沒有東西要記就回原 trip（同一個物件，呼叫端拿它判要不要存檔）。
 * days＝planTrip 回的 days（[{ date, plan }]；沒排的日子 plan 是 null，跳過）。
 * 為什麼要記（11-12 審查；主控定的落地 A2「在這條順序上做，不再把整天翻掉」）：釘住的日子上，順序以外的勾選站（原本排不進、他按了別站「不去了」之後才排得進來的）
 * 每次重排都重新挑位置——不記的話，下一個動作會讓它自己換位置（七天包 8/17：SQUAT 排進 おやま 與 Utah 之間，再按一次不去了它跑到 Utah 後面）。
 * 記回去之後那天的順序就是畫面上那一條，再重排一次結果相同（同一套組法）。
 */
export function repinTrip(trip, days = []) {
  let next = trip;
  for (const x of days ?? []) if (x?.plan?.pinned) next = repinFromPlan(next, x.date, x.plan);
  return next;
}

/** 「讓引擎重排這天」：pinned 拿掉，那天回到搜尋。沒釘住回原 trip（同一個物件）。 */
export function unpinDay(trip, date) {
  const day = (trip?.days ?? []).find((d) => d.date === date);
  if (!day || day.pinned == null) return trip;
  return withDay(trip, date, (d) => { const { pinned: _gone, ...rest } = d; return rest; });
}

// ── 共用：一條固定的順序重定時刻、重算；順序以外的勾選站怎麼插 ──

/** 停留回到併進等待之前、空檔限制拿掉（釘住之後填站不再綁在第一趟搜尋算的空檔上；keepGap 只給比做法用）。 */
const plainStop = (s, keepGap = false) => ({ ...s, dwellMin: s.dwellMin - (s.flexedMin ?? 0), flexedMin: 0, gap: keepGap ? (s.gap ?? null) : null });

/** 重算用的上下文：day 換成原時窗當收工線的那一份（rawWindowDay），baseDay 留原本那一份（算用掉幾分留白要看扣過留白的收工）。 */
const contextOf = ({ day, home, legFn, rules, settings, country, kb }, patch = null) => ({ day: patch ? { ...rawWindowDay(day), ...patch } : rawWindowDay(day), baseDay: day, home, legFn, rules, settings, country, kb });

/** 整條重定時刻（早餐排第一站時照舊對齊）＋整天重算。 */
function settle(stops, ctx) {
  const { day, home, legFn, rules, settings, country, kb } = ctx;
  const sequence = retimeWithBreakfast({ sequence: stops, day, home, legFn, settings, country, kb });
  return { sequence, ev: evaluateSequence({ sequence, day, home, legFn, rules, settings, country, kb }) };
}

const badStopsOf = (ev) => ev.breakdown.stops.map((s, i) => (s.verdict !== 'ok' ? i : -1)).filter((i) => i >= 0);
const hardMsgOf = (ev, poiId) => ev.warnings.find((w) => w.code === 'hard' && w.poiId === poiId) ?? null;
const dayHardMsgOf = (ev) => ev.warnings.find((w) => w.code === 'hard' && !w.poiId)?.msg ?? null;
const missCountOf = (sequence, ctx) => lastTrainMisses({ sequence, day: ctx.day, home: ctx.home, legFn: ctx.legFn }).length;

/** 排完才掛的提示（engine/trip.js planTrip 的後處理同一批）：試算要跟重排之後看到的一樣，才比得出「多了哪些黃字」。 */
function hintsOf(sequence, ctx) {
  const { day, home, legFn, settings, country, kb } = ctx;
  return [
    ...personAvoidWarnings(sequence, day.adjust),
    ...dayTripNightHints({ sequence, day, settings, country }),
    ...lastTrainHints({ sequence, day, home, legFn, kb }),
    ...breakfastHints({ sequence, day, settings, country }),
  ];
}

/** 這條序列用掉幾分留白：最後收工（固定時段的站不算，它本來就對原時窗）超過「扣過留白的收工」幾分，最多就是那天的留白。day 要是沒換過收工線的那一份。 */
function openSlotUsedOf(sequence, day) {
  const slot = Number(day?.openSlotMin) || 0;
  const close = day?.window?.endMin;
  if (!(slot > 0) || !Number.isFinite(close)) return 0;
  const last = sequence.reduce((m, s) => (s.fixedWindow ? m : Math.max(m, s.endMin)), -Infinity);
  return Math.max(0, Math.min(slot, Math.round(last - close)));
}

/** 他勾的一站（planTrip 從 picks 翻好的候選 → planDay 排出的 stop 形狀，還沒定時刻）。dwellMin 給了（pinned 記著的）就用它。engine/trip.js 也拿它做 plan.unplaced。 */
export function pickStopOf(c, dwellMin, settings = {}) {
  const fixed = Number.isFinite(dwellMin) && dwellMin > 0;
  // 他指定當早餐的那一筆（picks[].breakfast；engine/breakfast.js）：形狀跟沒釘住時安插的一樣（optional、breakfast: true）
  if (c.breakfastPick) { const s = breakfastStop(c.poi, settings, c.breakfastPick); return fixed ? { ...s, dwellMin } : s; }
  return {
    poi: c.poi, dwellMin: fixed ? dwellMin : (c.dwellMin ?? c.poi.dwellMin ?? settings.defaultDwellMin ?? 60),
    isAnchor: Boolean(c.isAnchor), designated: Boolean(c.designated), priority: c.priority ?? 'want', fixedWindow: c.fixedWindow ?? null,
    optional: false, insertedBy: null, gap: null, errand: Boolean(c.errand), deferredFrom: c.deferredFrom ?? null,
  };
}

/** 記在 pinned 裡的引擎站 → stop 形狀（還沒定時刻）。空檔限制不留。 */
function engineStopOf(poi, entry, settings) {
  const fixed = Number.isFinite(entry.dwellMin) && entry.dwellMin > 0;
  if (entry.priority === 'breakfast') { const s = breakfastStop(poi, settings); return fixed ? { ...s, dwellMin: entry.dwellMin } : s; }
  return {
    poi, dwellMin: fixed ? entry.dwellMin : (poi.dwellMin ?? 30), isAnchor: false, designated: false, priority: entry.priority ?? 'rest', fixedWindow: null,
    optional: true, insertedBy: 'engine', gap: null, errand: false, deferredFrom: null,
  };
}

/**
 * 順序以外的勾選站（順延進來的、釘住時就排不進的）一家一家試：每個位置都插插看，下面每一條都過才收，收分數最高的那個位置；都不行就進排不進清單並講原因。
 * - 沒有站撞硬規則、原本成立的一天沒變成不成立、趕不上末班車的站沒變多。
 * - 整天的分數有變好（跟搜尋「排進去分數反而低就不排」同一個取捨；順路站的貪婪插入也是這一條）。順延進來的站（stop.deferredFrom）不看這一條：他明講要排到別天，排得下就插。
 * - 不多用留白：留白是留給他自己臨時起意的（安插），引擎自己把站排回來不動它。
 * 他指定當早餐的那一筆（stop.breakfast）只試第一站，而且這天已經有早餐就不試。
 * extras：還沒定時刻的 stop（照 picks 的先後）。回 { list, cur, dropped: [{ poi, priority, reason, deferredFrom }], placed: [poi id] }。
 * 釘住的日子每次重排（planPinnedDay）與安插試算（insertTrial）都走這裡：試算算出來的才會跟套完重排的一樣。
 */
function placeExtras(list0, cur0, extras, ctx) {
  let list = list0; let cur = cur0;
  const dropped = []; const placed = [];
  for (const stop of extras) {
    const out = (reason) => dropped.push({ poi: stop.poi, priority: stop.priority ?? 'want', reason, deferredFrom: stop.deferredFrom ?? null });
    const asBreakfast = stop.breakfast === true;
    if (asBreakfast && mealAssignments({ sequence: cur.sequence, day: ctx.day, settings: ctx.settings, country: ctx.country }).meals.breakfast) { out('這天照你調過的順序排，早餐已經有別家了'); continue; }
    const slots = asBreakfast ? [0] : [...list.keys(), list.length];
    const missBase = missCountOf(cur.sequence, ctx); const usedBase = openSlotUsedOf(cur.sequence, ctx.baseDay);
    let best = null; let hard = null; let broken = null; let late = false; let slot = false; let worse = false;
    for (const k of slots) {
      const trial = [...list.slice(0, k), stop, ...list.slice(k)];
      const t = settle(trial, ctx);
      const bad = badStopsOf(t.ev);
      if (bad.length) { if (!hard || bad.length < hard.bad.length || (bad.length === hard.bad.length && t.ev.score > hard.t.ev.score)) hard = { t, bad }; continue; }
      if (cur.ev.complete && !t.ev.complete) { broken ??= dayHardMsgOf(t.ev) ?? ''; continue; }
      if (missCountOf(t.sequence, ctx) > missBase) { late = true; continue; }
      if (openSlotUsedOf(t.sequence, ctx.baseDay) > usedBase) { slot = true; continue; }
      // 順延進來的站（他按了「排到別天」）不看分數：排得下就插、挑分數最高的位置（主控 11-06 定的原句「挑排得下而且罰分最少的插」）。
      // 11-12 審查實跑：分數那道門會把排得下的擋掉——七天包 8/15 釘住之後，8/13 的火星之庭按「排到別天」變成哪天都排不進（沒釘住時排得進 8/15）
      if (!stop.deferredFrom && !(t.ev.score > cur.ev.score)) { worse = true; continue; }
      if (!best || t.ev.score > best.t.ev.score) best = { trial, t };
    }
    if (best) { list = best.trial; cur = best.t; placed.push(stop.poi.id); continue; }
    if (worse) out('排得進，但排進去整天的分數反而低');
    else if (slot) out('照你調過的順序，要用到今天的留白才排得進，先不排');
    else if (late) out('照你調過的順序排不進：排進去的話，後面有站會趕不上末班車');
    else if (broken != null) out(`照你調過的順序排不進：${broken || '排進去的話，今天的行程不成立'}`);
    else {
      const v = hard ? hard.t.sequence[hard.bad[0]] : null;
      const msg = v ? hardMsgOf(hard.t.ev, v.poi.id)?.msg : null;
      out(!msg ? '照你調過的順序排不進' : v.poi.id === stop.poi.id ? msg : `照你調過的順序排不進：${msg}`);
    }
  }
  return { list, cur, dropped, placed };
}

// ── 1. 安插試算 ──

/**
 * insertTrial({ plan, day, home, poi, legIndex, legFn, rules, settings, country, kb, draft? }) → 試算結果（下面的形狀）；輸入不成立（沒有 plan、那家已經在這天的行程裡）回 null。
 * - plan、day：那天現在畫面上的 plan 與 day 上下文（planTrip 回的 days[i]；釘住的日子也一樣）。home：那天的住宿（engine/trip.js resolveHome）。
 * - poi：要插的店。legIndex：插在第幾段——0＝住宿→第一站，i＝第 i 站之前（走廊清單 plan.corridor[].legIndex 就是它）；超過站數就接在最後。
 * - 新的一站是他勾的（priority 'want'、不是引擎插的），停留 insertDwellMin：店自己的、沒有用 settings.defaultDwellMin，至少 settings.insertMinDwellMin（30；原話 #52）。
 * - 排法：插進去、整條重定時刻（engine/sequence.js retimeSequence；早餐排第一站時照舊對齊）、整天重算。收工線用原時窗（day.windowRaw）：先用掉站與站之間等開門的空檔，
 *   再用那天的留白。坐下來的地方照舊把下一站的等待坐掉。引擎填的站照 INSERT_POLICY 讓位（縮短的列在 shrunk）。
 * - 排得下＝每一站都沒撞硬規則（超過關門、趕不上固定時段、超過收工、天黑、同類家數、一天站數…規則自己判），原本成立的一天沒有變成不成立，趕不上末班車的站沒有變多
 *   （他勾的站不受末班車規則擋，所以另外數）。
 * - 排得下之後，那天原本排不進的勾選站（plan.dropped）照釘住的日子同一套再試一次（placeExtras）；真的排得進來的列在 revived——套完重排就會是這樣，所以試算先講。
 * - draft：上一輪選的那個選項（選項物件、或它的 result）——拿它已經調過的（少待、不去）當底再算一輪。plan 要給同一份（調整是對 plan 重新套的，不是接著草稿的時刻改）。
 *
 * 回的形狀（每個選項的 result 也是這個形狀，只是 options 是空的）：
 * { fits, poiId, pick, legIndex, index, sequence, adjust, round, between: { prev, next }, dwellMin, shiftMaxMin, openSlotUsedMin, openSlotUsedBeforeMin,
 *   newWarnings, shrunk, revived, score, penaltyMin, complete, blocked, conflicts, options }
 * - fits：排不排得下。sequence：這一版的序列（每站是 planDay 的 stop 形狀，帶時刻）。index：新的那一站在 sequence 的第幾個。
 * - pick：套用時要加進那天 picks 的那一筆 { poiId, priority: 'want', dwellMin? }——店自己寫的停留不到 insertMinDwellMin 時才帶 dwellMin（至少待 30 分記在勾選上，解除釘住也不會縮回去）。
 * - adjust：這一版已經套了哪些調整 [{ kind: 'shorten', poiId, fromMin, toMin } | { kind: 'drop', poiId, insertedBy, priority }]；round＝這是第幾輪（1 起；
 *   沒有草稿是 1，拿選項當草稿再算就是那個選項記的輪數）。選項的 result.round＝選了它之後的那一輪（這一輪＋1），不是調整的個數。
 * - between：插在誰跟誰之間（POI；prev null＝住宿，next null＝後面沒有站）。dwellMin：新的那一站這一版停多久。
 * - shiftMaxMin：原本的站開始時刻最多比現在晚幾分。openSlotUsedMin：這一版用掉幾分留白（openSlotUsedBeforeMin＝插之前）。
 * - newWarnings：比插之前多出來的黃字與提示 [{ ruleId, code, poiId, msg, hint? }]（同一條規則對同一站只算一次，不比字）。
 * - shrunk：讓位縮短的填站 [{ poiId, fromMin, toMin }]。revived：原本排不進、這一版排得進來的勾選站 [poi id]（很少見；例：選了「不去」一家咖啡廳，原本因為同類上限排不進的那家就進來了）。
 * - blocked：排不下時卡在哪 { poiId, name, ruleId, msg, shortMin }——照序列先後第一個卡住的；msg 是那條硬規則自己的句子；shortMin＝還差幾分（卡住的每一站「自己要早幾分才過」
 *   取最大的；有一站不是早幾分鐘過得了的——同類家數、一天站數、今天沒開——回 null）；整天層級的（不掛在哪一站）poiId 是 null。
 *   conflicts：全部卡住的 [{ poiId, name, ruleId, msg }]，一站同時撞兩條（超過關門＋一天站數滿了）就列兩筆——畫面把每一句都印出來（去掉重複的句子），
 *   不要只印 blocked：決定要不要少去一站的常常是後面那一句。排得下時 blocked null、conflicts []。
 * - options（排不下才有，排得下是 []）：[{ kind, poiId, poi, fromMin, toMin, fits, shortMin, result }]
 *   · kind 'shorten-new'＝插的這家少待；'shorten'＝後面某一站少待；'drop'＝某一站不去。poiId／poi＝對象（畫面拿 poi 寫店名與簡介，原話 #193）。
 *   · fromMin → toMin：停留幾分變幾分（'drop' 的 toMin 是 0）。少待取「最少要減幾分才排得下」，5 分一階，最少留 dwellFloorMin（原停留的一半、不少於 insertMinDwellMin）；
 *     減到底還排不下就給減到底的那一版（fits false）。固定時段的站不列「少待」；必去、指定、主行程、固定時段的站不列「不去」（isLockedStop）。
 *   · 「不去」平常只列後面的站（原話 #194 講的是被壓縮到的後面的行程）；卡住的原因不是差幾分鐘（blocked.shortMin 是 null：同類的店超過上限、一天站數滿了）時，
 *     前面的站也試——那種情況少去後面哪一站都沒用，要少去的是同類的另一家（推導）。
 *   · fits、shortMin＝套了之後排不排得下、還差幾分；result＝套了之後的整份試算結果（applyInsert 吃它；排不下就拿它當 draft 再問一輪）。
 *   · 套了也沒有比較接近排得下的選項不列（卡住的站沒少、還差的分鐘也沒少）。先後：排得下的在前（插的這家少待 → 少待 → 不去；同一種裡犧牲少的在前）；排不下的照還差幾分由少到多。
 *   · 一個都不剩（options 是 []、fits false）＝這一段插不進這家，畫面只剩「算了不插」。「算了不插」不是選項物件——畫面丟掉這份試算就是。
 * giveWay：填站讓不讓位，不給就用 INSERT_POLICY（比做法才另外給）。
 */
export function insertTrial({ plan, day, home, poi, legIndex = 0, legFn, rules, settings = {}, country = null, kb = null, draft = null, giveWay = INSERT_POLICY.giveWay }) {
  if (!Array.isArray(plan?.sequence) || !poi?.id || !day || typeof legFn !== 'function' || !rules) return null;
  if (plan.sequence.some((s) => s.poi.id === poi.id)) return null;
  // 現場套過改案的那天 day 帶 resumed；安插之後那天回到規劃（改案的快照由畫面清掉），所以照早上出門算
  const ctx = contextOf({ day, home, legFn, rules, settings, country, kb }, { resumed: false });
  const keepGap = giveWay === 'strict';
  // 原本的每一站帶著「現在排在哪一段營業時間」（slotOpenMin）：選項裡少待、不去會讓後面提早，營業分兩段的店落到前一段待不完時等到它現在這一段開門（engine/schedule.js placeStop）；
  // 被這一插往後推到待不完的站不會自己跳到更晚的那一段（那是把午餐變成晚餐，要問他）。照現在的時刻算、不沿用釘住時記的：這一次試算比的是畫面上這一版
  const base = plan.sequence.map((s) => { const { slotOpenMin: _was, ...plain } = plainStop(s, keepGap); return withSlotOpen(plain, s, day.date); });
  const at = Math.max(0, Math.min(Number.isInteger(legIndex) ? legIndex : 0, base.length));
  const fresh = { poi, dwellMin: insertDwellMin(poi, settings), priority: 'want', optional: false, insertedBy: null, isAnchor: false, designated: false, fixedWindow: null, gap: null, errand: false, deferredFrom: null };
  // 要加進 picks 的那一筆：店自己寫的停留不到 insertMinDwellMin 時，把「至少待這麼久」記在勾選上——之後解除釘住、引擎重排這天，它還是至少待 30 分（原話 #52），不會縮回店寫的 20 分
  const ownDwell = Number(poi.dwellMin);
  const pick = { poiId: poi.id, priority: 'want', via: CORRIDOR_PICK, ...(Number.isFinite(ownDwell) && ownDwell > 0 && ownDwell < fresh.dwellMin ? { dwellMin: fresh.dwellMin } : {}) };
  const orig = new Map([...base.map((s) => [s.poi.id, s.dwellMin]), [poi.id, fresh.dwellMin]]);
  const was = new Map(plan.sequence.map((s) => [s.poi.id, s.startMin]));
  const gaps = new Map(plan.sequence.filter((s) => s.insertedBy && s.priority === 'filler' && s.gap).map((s) => [s.poi.id, s.gap]));
  const minFill = settings.fillMinGapMin ?? 15;
  // 那天原本排不進的勾選站：planTrip 掛的 plan.unplaced（照 picks 的先後、帶他寫的停留）；沒有那一筆的（現場改案少掉的站）用店自己的停留估
  const known = Array.isArray(plan.unplaced) ? plan.unplaced.filter((u) => u?.poi?.id && u.poi.id !== poi.id) : [];
  const leftovers = [
    ...known,
    ...(plan.dropped ?? []).filter((x) => x?.poi?.id && x.poi.id !== poi.id && !known.some((u) => u.poi.id === x.poi.id))
      .map((x) => pickStopOf({ poi: x.poi, priority: x.priority, designated: (day.designated ?? []).includes(x.poi.id), isAnchor: day.anchorPoiId === x.poi.id, deferredFrom: x.deferredFrom ?? null }, undefined, settings)),
  ];
  // 插之前（畫面上那一版，時刻照存的）：拿來比多了哪些黃字、哪幾站本來就卡著
  const beforeEv = evaluateSequence({ sequence: plan.sequence, day: ctx.day, home, legFn, rules, settings, country, kb });
  const baseBad = new Set(badStopsOf(beforeEv).map((i) => plan.sequence[i].poi.id));
  const beforeMiss = new Set(lastTrainMisses({ sequence: plan.sequence, day: ctx.day, home, legFn }).map((m) => m.stop.poi.id));
  const warnKey = (w) => `${w.ruleId ?? ''}|${w.poiId ?? ''}`;
  const beforeKeys = new Set([...beforeEv.warnings, ...hintsOf(plan.sequence, ctx)].map(warnKey));
  const usedBefore = openSlotUsedOf(plan.sequence, day);
  const nameOf = (p) => p?.name_zh ?? p?.id ?? null;

  /** 套上調整之後的那條順序（還沒定時刻）。同一站後面的調整蓋前面的。 */
  const compose = (adjust) => {
    const dropped = new Set(adjust.filter((a) => a.kind === 'drop').map((a) => a.poiId));
    const dwell = new Map(adjust.filter((a) => a.kind === 'shorten').map((a) => [a.poiId, a.toMin]));
    return [...base.slice(0, at), fresh, ...base.slice(at)].filter((s) => !dropped.has(s.poi.id)).map((s) => (dwell.has(s.poi.id) ? { ...s, dwellMin: dwell.get(s.poi.id) } : s));
  };
  const internals = new WeakMap();   // 試算結果 → { bad, misses, dayMsg }（量「還差幾分」用，不放在回傳的物件上）

  const trialOf = (adjust, round) => {
    let stops = compose(adjust);
    const fixedDwell = new Set(adjust.filter((a) => a.kind === 'shorten').map((a) => a.poiId));
    const shrunk = new Map();
    let cur = settle(stops, ctx);
    // 填站讓位：它不能超出原本那段空檔，也不能把它在等的那一站拖過開門時刻；最短 minFill 分、不拿掉（engine/breakfast.js tryBreakfastFirst 同一套）。他在選項裡調過停留的填站不再動
    for (let guard = 0; giveWay === 'fill' && guard < 8; guard++) {
      let hit = null;
      for (let k = 0; k < cur.sequence.length && !hit; k++) {
        const f = cur.sequence[k]; const gap = gaps.get(f.poi.id);
        if (!gap || fixedDwell.has(f.poi.id)) continue;
        const next = cur.sequence.slice(k + 1).find((s) => s.poi.id !== poi.id);   // 它在等的那一站（新插的那家夾在中間也算）
        const outside = f.endMin - gap.endMin;
        const dragging = next && (was.get(next.poi.id) ?? Infinity) <= gap.endMin ? next.startMin - gap.endMin : 0;
        const left = Math.max(minFill, f.dwellMin - Math.max(outside, dragging));
        if (left < f.dwellMin) hit = { id: f.poi.id, left };
      }
      if (!hit) break;
      stops = stops.map((s) => (s.poi.id === hit.id ? { ...s, dwellMin: hit.left } : s));
      shrunk.set(hit.id, hit.left);
      cur = settle(stops, ctx);
    }
    const bad = badStopsOf(cur.ev).filter((i) => !baseBad.has(cur.sequence[i].poi.id));
    const misses = lastTrainMisses({ sequence: cur.sequence, day: ctx.day, home, legFn }).filter((m) => !beforeMiss.has(m.stop.poi.id));
    const dayMsg = beforeEv.complete && !cur.ev.complete ? (dayHardMsgOf(cur.ev) ?? '這樣排，今天的行程不成立') : null;
    const conflicts = [
      // 一站可能同時撞兩條（關門＋一天站數）：每一條都列，畫面才看得到「不是少待幾分鐘解得掉」的那一句
      ...bad.flatMap((i) => {
        const s = cur.sequence[i];
        const hits = cur.ev.warnings.filter((w) => w.code === 'hard' && w.poiId === s.poi.id);
        return (hits.length ? hits : [{ ruleId: null, msg: `${nameOf(s.poi)} 排不進` }]).map((w) => ({ poiId: s.poi.id, name: nameOf(s.poi), ruleId: w.ruleId ?? null, msg: w.msg }));
      }),
      ...misses.filter((m) => !bad.includes(m.index)).map((m) => ({ poiId: m.stop.poi.id, name: nameOf(m.stop.poi), ruleId: 'last-train', msg: lastTrainText(m.stop, m, kb) })),
      ...(dayMsg ? [{ poiId: null, name: null, ruleId: null, msg: dayMsg }] : []),
    ];
    // 排得下：原本排不進的勾選站照釘住的日子同一套再試一次（套完重排就會這樣）
    let revived = [];
    if (!conflicts.length && leftovers.length) {
      const extra = placeExtras(stops, cur, leftovers, ctx);
      if (extra.placed.length) { cur = extra.cur; revived = extra.placed; }
    }
    const { sequence, ev } = cur;
    const index = sequence.findIndex((s) => s.poi.id === poi.id);
    const shiftMaxMin = Math.max(0, ...sequence.filter((s) => was.has(s.poi.id)).map((s) => Math.round(s.startMin - was.get(s.poi.id))));
    const seenNew = new Set();
    const newWarnings = [...ev.warnings, ...hintsOf(sequence, ctx)].filter((w) => {
      if (w.code === 'hard' || w.code === 'skipped-missing' || w.code === 'rule-error') return false;
      const k = warnKey(w);
      if (beforeKeys.has(k) || seenNew.has(k)) return false;
      seenNew.add(k); return true;
    });
    const out = {
      fits: conflicts.length === 0,
      poiId: poi.id, pick, legIndex: at, index, sequence, adjust, round,
      between: { prev: index > 0 ? sequence[index - 1].poi : null, next: sequence[index + 1]?.poi ?? null },
      dwellMin: sequence[index].dwellMin - (sequence[index].flexedMin ?? 0),
      shiftMaxMin, openSlotUsedMin: openSlotUsedOf(sequence, day), openSlotUsedBeforeMin: usedBefore,
      newWarnings,
      shrunk: [...shrunk].map(([poiId, toMin]) => ({ poiId, fromMin: orig.get(poiId), toMin })),
      revived,
      score: ev.score, penaltyMin: ev.penaltyMin, complete: ev.complete,
      blocked: conflicts.length ? { ...conflicts[0], shortMin: null } : null,
      conflicts,
      options: [],
    };
    internals.set(out, { bad, misses, dayMsg });
    return out;
  };

  /** 還差幾分：卡住的每一站「自己要早幾分才過」取最大的；有一站不是早幾分鐘過得了的（同類家數、站數、今天沒開）就是 null。 */
  const measure = (trial) => {
    if (trial.fits || !trial.blocked) return trial;
    const { bad, misses, dayMsg } = internals.get(trial);
    const seq = trial.sequence;
    // 這一站往前挪 shift 分（最早挪到它那個營業區間開門、也不早於出門）還撞不撞硬規則
    const passes = (i, shift) => {
      const s = seq[i];
      const iv = openIntervals(s.poi, ctx.day.date);
      const opens = Array.isArray(iv) ? iv.filter(([o]) => o <= s.startMin).map(([o]) => o) : [];
      const floor = Math.max(ctx.day.window.startMin, opens.length ? Math.max(...opens) : -Infinity);
      const by = Math.min(shift, Math.max(0, s.startMin - floor));
      const moved = seq.map((x, j) => (j === i ? { ...x, arriveMin: (x.arriveMin ?? x.startMin) - by, startMin: x.startMin - by, endMin: x.endMin - by } : x));
      return evaluateSequence({ sequence: moved, day: ctx.day, home, legFn, rules, settings, country, kb }).breakdown.stops[i].verdict === 'ok';
    };
    const overrun = (i) => {
      let lo = 0; let hi = null;
      for (let p = 5; p <= 1280 && hi == null; p *= 2) { if (passes(i, p)) hi = p; else lo = p; }
      if (hi == null) return null;
      while (hi - lo > 1) { const mid = Math.floor((lo + hi) / 2); if (passes(i, mid)) hi = mid; else lo = mid; }
      return hi;
    };
    const lateFor = (m) => {
      if (m.kind === 'home') return m.stop.endMin - m.last.leaveByMin;
      const leg = legFn(m.index > 0 ? seq[m.index - 1].poi : home, m.stop.poi);
      return (m.stop.arriveMin ?? m.stop.startMin) - ((leg?.walkMin ?? 0) + (leg?.rideMin ?? 0) + (leg?.waitMin ?? 0)) - m.last.leaveByMin;
    };
    const parts = [...bad.map(overrun), ...misses.filter((m) => !bad.includes(m.index)).map((m) => Math.max(1, Math.ceil(lateFor(m)))), ...(dayMsg ? [null] : [])];
    trial.blocked = { ...trial.blocked, shortMin: parts.length && parts.every((x) => x != null) ? Math.max(...parts) : null };
    return trial;
  };

  /** 這一版排不下時的選項：都真的試排過；沒有比較接近排得下的不列。 */
  const optionsOf = (cur) => {
    const out = [];
    const without = (id) => cur.adjust.filter((a) => !(a.kind === 'shorten' && a.poiId === id));
    const shorten = (kind, s, order) => {
      const id = s.poi.id;
      const from = s.dwellMin - (s.flexedMin ?? 0);
      const floor = dwellFloorMin(orig.get(id) ?? from, settings);
      const steps = [];
      for (let to = from - 5; to >= floor; to -= 5) steps.push(to);
      if (from > floor && steps[steps.length - 1] !== floor) steps.push(floor);
      if (!steps.length) return;
      let last = null;
      for (const to of steps) { last = trialOf([...without(id), { kind: 'shorten', poiId: id, fromMin: from, toMin: to }], cur.round + 1); if (last.fits) break; }
      measure(last);
      out.push({ kind, poiId: id, poi: s.poi, fromMin: from, toMin: last.adjust[last.adjust.length - 1].toMin, fits: last.fits, shortMin: last.fits ? 0 : last.blocked.shortMin, result: last, order });
    };
    const drop = (s, order) => {
      const r = measure(trialOf([...without(s.poi.id), { kind: 'drop', poiId: s.poi.id, insertedBy: s.insertedBy ?? null, priority: s.priority ?? null }], cur.round + 1));
      out.push({ kind: 'drop', poiId: s.poi.id, poi: s.poi, fromMin: s.dwellMin - (s.flexedMin ?? 0), toMin: 0, fits: r.fits, shortMin: r.fits ? 0 : r.blocked.shortMin, result: r, order });
    };
    shorten('shorten-new', cur.sequence[cur.index], cur.index);
    cur.sequence.forEach((s, k) => { if (k > cur.index && !s.fixedWindow) shorten('shorten', s, k); });
    // 不去：後面的站；卡住的原因不是差幾分鐘（同類家數、站數）時前面的站也試
    const anyStop = cur.blocked.shortMin == null;
    cur.sequence.forEach((s, k) => { if (k !== cur.index && (k > cur.index || anyStop) && !isLockedStop(s)) drop(s, k); });
    const short = (x) => (x == null ? Infinity : x);
    const closer = (o) => o.fits || o.result.conflicts.length < cur.conflicts.length || short(o.shortMin) < short(cur.blocked.shortMin);
    const rank = { 'shorten-new': 0, shorten: 1, drop: 2 };
    const cut = (o) => o.fromMin - o.toMin;
    return out.filter(closer)
      .sort((a, b) => Number(b.fits) - Number(a.fits)
        || (a.fits ? rank[a.kind] - rank[b.kind] || cut(a) - cut(b) : (short(a.shortMin) === short(b.shortMin) ? 0 : short(a.shortMin) - short(b.shortMin)) || rank[a.kind] - rank[b.kind])
        || a.order - b.order)
      .map(({ order: _order, ...o }) => o);
  };

  const ids = new Set(orig.keys());
  const src = draft?.result ?? draft;
  const given = Array.isArray(src?.adjust) ? src.adjust : [];
  const adjust = given.filter((a) => isObj(a) && ids.has(a.poiId) && ((a.kind === 'shorten' && Number.isFinite(a.toMin) && a.toMin > 0) || (a.kind === 'drop' && a.poiId !== poi.id)));
  // 這是第幾輪：沒有草稿是第 1 輪；有草稿就照草稿記的（選項的 result 記的是「選了它之後的那一輪」）。不拿調整的個數算——
  // 先選某站少待、下一輪改選不去同一站時調整還是一筆，照個數算會停在第 2 輪（11-12 審查）。草稿沒記輪數（舊形狀）才退回個數＋1
  const round = draft == null ? 1 : (Number.isInteger(src?.round) && src.round >= 1 ? src.round : adjust.length + 1);
  const cur = measure(trialOf(adjust, round));
  if (!cur.fits) cur.options = optionsOf(cur);
  return cur;
}

// ── 2. 旅程檔的動作（回新的 trip，不改傳入的）──

/**
 * 把試算結果套進旅程檔：applyInsert(trip, date, result, at?) → 新 trip。result＝排得下的試算結果，或選好的那個選項（選項物件或它的 result 都收）。
 * - 那天的 picks 加一筆（result.pick：{ poiId, priority: 'want' }，店自己寫的停留不到 30 分時另帶 dwellMin；已經在就不重複）；
 *   之前對它按過「不去了」的那筆從 removed 拿掉（跟舊的升級同一個保險）。
 * - 那天釘住順序：pinned = { at, sequence }（pinEntriesOf：試算排出來的每一站、先後、停留；引擎插的站照原樣記著）。他說這天早餐不排而暫時不在序列裡的那一家也留一筆
 *   （keepSkippedBreakfast：之後按「改回來」它回得來）。
 * - 選了「不去某站」的那幾站照一般的「不去了」（主控定的落地 A5）：他勾的從 picks 拿掉、removed 記一筆 { poiId, at, priority }；引擎插的記 { poiId, at, insertedBy: 'engine', priority }（＝拒絕）。不算落選。
 * - 「少待」調過的停留只記在 pinned 的那幾筆上，不改 picks。
 * 排不下的結果、沒有那一天回原 trip（同一個物件）：排不下就不套，畫面拿它當草稿再問一輪或讓他取消。
 * 套完整趟重排（ui/app.js）：那天照 pinned 排出來的序列就是試算的那一條（同一套重定時刻與重算）。
 */
export function applyInsert(trip, date, result, at = null) {
  const r = result?.result ?? result;
  if (!r || r.fits !== true || typeof r.poiId !== 'string' || !Array.isArray(r.sequence) || !(trip?.days ?? []).some((d) => d.date === date)) return trip;
  const when = stamp(at);
  const drops = (Array.isArray(r.adjust) ? r.adjust : []).filter((a) => a?.kind === 'drop' && typeof a.poiId === 'string');
  return withDay(trip, date, (d) => {
    const gone = new Set(drops.map((a) => a.poiId));
    const upgraded = new Set((d.picks ?? []).filter((p) => p?.via === CORRIDOR_PICK).map((p) => p.poiId));   // 之前升級進來、這次在選項裡被選了不去的：removed 那一筆沿用記號（別天照樣是挑好名單才拿掉）
    let picks = (d.picks ?? []).filter((p) => !gone.has(p?.poiId));
    if (!picks.some((p) => p?.poiId === r.poiId)) picks = [...picks, isObj(r.pick) && r.pick.poiId === r.poiId ? { ...r.pick, via: CORRIDOR_PICK } : { poiId: r.poiId, priority: 'want', via: CORRIDOR_PICK }];
    const removed = [
      ...(d.removed ?? []).filter((x) => x?.poiId !== r.poiId),
      // 引擎插的站在選項裡被選了「不去」：多記 via 'insert'——那天之前的日子挑引擎插站時，它改成挑好名單才拿掉（engine/trip.js planTrip 的 lateIds）
      ...drops.map((a) => ({ poiId: a.poiId, at: when, ...(a.insertedBy ? { insertedBy: a.insertedBy } : {}), ...(a.priority ? { priority: a.priority } : {}), ...(a.insertedBy === 'engine' ? { via: INSERT_DROP } : upgraded.has(a.poiId) ? { via: CORRIDOR_PICK } : {}) })),
    ];
    // 之前就記著、這次不在序列裡的引擎站（先前撞到別站被讓掉的）照舊留一筆 off；這次在選項裡選了不去的不留（它記在 removed）
    const sequence = withParked(d, keepSkippedBreakfast(d, pinEntriesOf(r.sequence, date))).filter((e) => !(e.off && gone.has(e.poiId)));
    return { ...d, picks, removed, pinned: { at: when, sequence } };
  });
}

// ── 3. 釘住順序的一天怎麼排 ──

/**
 * 釘住順序的一天（engine/trip.js planTrip 遇到 days[].pinned 時呼叫，取代那天的搜尋）。回的 plan 形狀跟搜尋的一樣
 * （sequence、score、penaltyMin、warnings、dropped、complete、breakdown、stats），多 pinned: true 與 openSlotUsedMin（這條順序用掉幾分留白）。
 * - pinned：pinnedOf(旅程檔那天)。candidates：planTrip 從那天的 picks 翻好的候選（poi、priority、dwellMin、fixedWindow、designated、isAnchor、errand、deferredFrom；
 *   他指定當早餐的那一筆另帶 breakfastPick＝那筆勾選）。swapped：旅程檔那天的 swapped 紀錄。
 * - enginePoi(id) → 引擎站的 POI（知識庫沒有回 null）；engineGone(id) → 這家引擎站不留了（任何一天勾過或按過「不去了」、那天之前按過「我進去了」、前面釘住的日子已經排過）；
 *   allowEngineBreakfast：這天還要不要引擎排的早餐（他說這天不排、早餐段不在時窗裡就是 false）。
 * 怎麼組：
 * 1. 照 pinned 的順序一筆一筆對——在 picks 裡的是他勾的站；不在 picks、但那天的 swapped 記著它被換成誰（一路追到還在 picks 裡的那家）就在原位置放接手的那一家；
 *    再不然是記著的引擎站（還留得住的）就照原樣放；其餘跳過（他按過不去了的、順延走的）。停留優先用那一筆記的（換了店的不沿用）。
 * 2. 整條重定時刻、重算（收工線用原時窗）。有站撞硬規則（照先後一站一站處理，每拿掉一站就重算）——永遠給得出剩下的行程（總則 0）：
 *    · 排在它前面的引擎站裡，有一站拿掉它就過的：拿掉那個引擎站（靠近它的先）。引擎插的站先讓，不動他勾的。
 *    · 不然，撞的那一站自己移到排不進清單，理由是那條規則的句子。
 *    · 撞的是必去／指定／主行程／固定時段的站時不拿它：改拿掉排在它前面、不是這幾種的站——他勾的站裡拿掉就讓它過的那一站（靠近它的先）；沒有這種站就先拿引擎站、再拿他勾的。
 *      被拿掉的他勾的站理由寫「排在它後面的 X 會排不進（…）」。前面沒有站可拿才拿掉它自己。
 *    · 拿掉引擎站之前先試縮短：排在它前面的填站縮到剛好讓它過（最短 settings.fillMinGapMin、5 分一階；跟安插試算、引擎排早餐同一個做法）。縮短只在這次重排有效，記著的停留不改。
 *    引擎插的站被拿掉不進排不進清單（跟搜尋一樣，不算落選），但各出一句提示（plan.warnings 多一條 { ruleId: 'pinned-order', code: 'hint', hint: true, msg }，沒有 poiId；
 *    plan.yielded 列它們的 id）。每一站都過了、這一天卻不成立（整天層級的硬規則）而拿掉某一個引擎站就成立的，拿掉它（一樣出提示）。
 *    營業分兩段的店：記的時候排在後面那一段（pinned.sequence[].slotOpenMin）、現在提早到了而前一段待不完的，等到後面那一段開門再進去（engine/schedule.js placeStop），不算撞硬規則。
 * 3. picks 裡有、順序裡沒有的（順延進來的、釘住時就排不進的）：placeExtras——試每個位置，排得下、整天分數有變好（順延進來的不看分數）、不多用留白才插；不然進排不進清單並講原因。
 * 排完之後畫面上那一條要記回旅程檔（repinTrip；ui/app.js 每次重排完呼叫）：第 3 步排進來的站才不會下一次重排又換位置，被讓掉的引擎站也才不會下一次又冒出同一句提示。
 */
export function planPinnedDay({ pinned, candidates = [], swapped = [], enginePoi = () => null, engineGone = () => false, allowEngineBreakfast = false, day, home, legFn, rules, settings = {}, country = null, kb = null, options = {} }) {
  const started = Date.now();
  const ctx = contextOf({ day, home, legFn, rules, settings, country, kb });
  const byId = new Map(candidates.map((c) => [c.poi.id, c]));
  const swapTo = new Map();
  for (const x of Array.isArray(swapped) ? swapped : []) if (typeof x?.from === 'string' && typeof x?.to === 'string') swapTo.set(x.from, x.to);
  const heir = (id) => { let cur = id; const seen = new Set(); while (!byId.has(cur) && swapTo.has(cur) && !seen.has(cur)) { seen.add(cur); cur = swapTo.get(cur); } return cur; };
  const used = new Set();
  const recorded = new Set((pinned?.sequence ?? []).map((e) => e.poiId));
  const slotted = (s, e) => (Number.isFinite(e.slotOpenMin) ? { ...s, slotOpenMin: e.slotOpenMin } : s);   // 記的時候排在第二段以後的營業時間：提早到了等那一段開門（engine/schedule.js placeStop）
  let list = [];
  for (const e of pinned?.sequence ?? []) {
    if (e.off) continue;   // 記著但不排的引擎站（之前撞到別站被讓掉；留著只是為了別天不拿它）
    const id = heir(e.poiId);
    if (used.has(id)) continue;
    // 接手的那一家自己在順序裡有一筆：照它自己那一筆的位置排，不搬到這裡（11-12 審查：S 換成 T 之後又把 S 升級回同一天，再對 S 按不去了，T 被搬到 S 的位置）
    if (id !== e.poiId && recorded.has(id)) continue;
    const c = byId.get(id);
    if (c) { used.add(id); list.push(id === e.poiId ? slotted(pickStopOf(c, e.dwellMin, settings), e) : pickStopOf(c, undefined, settings)); continue; }
    if (id !== e.poiId || e.insertedBy !== 'engine') continue;
    const p = enginePoi(e.poiId);
    if (!p || engineGone(e.poiId) || (e.priority === 'breakfast' && !allowEngineBreakfast)) continue;
    used.add(e.poiId);
    list.push(slotted(engineStopOf(p, e, settings), e));
  }
  const dropped = [];
  const yielded = [];   // 讓掉的引擎站（不進排不進清單；下面各出一句提示）
  const name = (s) => s.poi.name_zh ?? s.poi.id;
  const without = (k) => list.filter((_, j) => j !== k);
  const minFill = settings.fillMinGapMin ?? 15;
  let cur = settle(list, ctx);
  for (let guard = list.length * 2; guard > 0; guard--) {
    const bad = badStopsOf(cur.ev);
    if (!bad.length) break;
    const i = bad[0]; const v = cur.sequence[i];
    const msg = hardMsgOf(cur.ev, v.poi.id)?.msg ?? `${name(v)} 今天排不進`;
    let out = i; let reason = msg;
    const passesIn = (trial) => settle(trial, ctx).ev.breakdown.stops.find((x) => x.poiId === v.poi.id)?.verdict === 'ok';
    const passesWithout = (k) => passesIn(without(k));
    const before = cur.sequence.slice(0, i).map((s, k) => ({ s, k })).filter(({ s }) => !isLockedStop(s)).reverse();   // 靠近它的在前
    const engines = before.filter(({ s }) => s.insertedBy); const mine = before.filter(({ s }) => !s.insertedBy);
    // 排在它前面的填站先縮短再說拿掉（最短 fillMinGapMin、5 分一階，縮到剛好讓它過）：填站是拿來填空檔的，空檔被別的站用掉它就短一點——
    // 安插試算與引擎排早餐都是這個做法（縮短、不拿掉），釘住的重排之前沒有這一步，按早餐的「改回來」時填站整站不見、也沒有一句話（11-12 審查）
    let eased = null;
    for (const { s, k } of engines) {
      if (s.priority !== 'filler') continue;
      const from = list[k].dwellMin;
      for (let to = from - 5; to > minFill - 5 && !eased; to -= 5) {
        const trial = list.map((x, j) => (j === k ? { ...x, dwellMin: Math.max(minFill, to) } : x));
        if (passesIn(trial)) eased = trial;
      }
      if (eased) break;
    }
    if (eased) { list = eased; cur = settle(list, ctx); continue; }
    const saver = engines.find(({ k }) => passesWithout(k));
    if (saver) out = saver.k;   // 引擎插的站先讓：拿掉它就過的話，不動他勾的站
    else if (isLockedStop(v)) {
      const give = mine.find(({ k }) => passesWithout(k)) ?? engines[0] ?? mine[0];
      if (give) { out = give.k; reason = `排在它後面的 ${name(v)} 會排不進（${msg}）`; }
    }
    const gone = cur.sequence[out];
    if (!gone.insertedBy) dropped.push({ poi: gone.poi, priority: gone.priority, reason, deferredFrom: gone.deferredFrom ?? null });
    else yielded.push(gone);
    list = without(out);
    cur = settle(list, ctx);
  }
  for (let guard = list.length; guard > 0 && !cur.ev.complete; guard--) {
    const k = list.map((s, j) => (s.insertedBy ? j : -1)).filter((j) => j >= 0).reverse().find((j) => { const t = settle(without(j), ctx); return t.ev.complete && !badStopsOf(t.ev).length; });
    if (k == null) break;
    yielded.push(cur.sequence[k]);
    list = without(k);
    cur = settle(list, ctx);
  }
  const rest = [];
  for (const c of candidates) { if (used.has(c.poi.id)) continue; used.add(c.poi.id); rest.push(pickStopOf(c, undefined, settings)); }
  const extra = placeExtras(list, cur, rest, ctx);
  const { sequence, ev } = extra.cur;
  // 讓掉的引擎站要讓他知道（11-12 審查：之前無聲拿掉）：每家一句提示，不是黃字、不掛在哪一站上（那一站已經不在序列裡）；畫面印在日期下面
  const hints = yielded.map((s) => ({ ruleId: PINNED_ORDER_HINT, code: 'hint', hint: true, msg: `照你調過的順序排不下，引擎排的 ${name(s)} 這天先拿掉` }));
  return {
    sequence, score: ev.score, complete: ev.complete, penaltyMin: ev.penaltyMin, warnings: hints.length ? [...ev.warnings, ...hints] : ev.warnings, dropped: [...dropped, ...extra.dropped],
    breakdown: options.explain ? { stops: ev.breakdown.stops.map((s) => ({ poiId: s.poiId, penaltyMin: s.penaltyMin, items: s.items })), day: ev.breakdown.day } : null,
    stats: { nodes: 0, truncated: false, ms: Date.now() - started },
    pinned: true, openSlotUsedMin: openSlotUsedOf(sequence, day),
    yielded: yielded.map((s) => s.poi.id),
  };
}
