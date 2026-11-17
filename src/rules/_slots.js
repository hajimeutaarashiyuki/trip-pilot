// 餐段、夜間時段、一日遊回程、末班車的共用尺（11-06；原話 #189、#190），加上「這家店能當哪一餐、這一站是哪一餐」（11-06 第二批；原話 #195）
// 與早餐的那幾樣（原話 #196：國家層有沒有早餐段、他說這天不排、這天缺不缺早餐、「今天沒排早餐」的提示）。
// 不是規則、不進 BUILTIN，跟 _helpers.js 一樣只給別人 import：
// 規則 meal-slots、breakfast-slot、night-slot、last-train、day-trip-night，分配器 engine/allocate.js，換一家 engine/swap.js，早餐 engine/breakfast.js，engine/trip.js，畫面的 ui/applied.js 都讀這裡——
// 「這家店能不能當早餐／午餐／晚餐」（servesMeal）「這一站是哪一餐」（mealAssignments）「夜間時段幾點到幾點」「一日遊幾點回到市區」「這一站趕不趕得上末班車」各只有一個算法，不各寫一套。
// 只 import engine/time.js、data/country.js 與推導表 derive/meals.json。
import { hmToMin, minToHm, overlapMin } from '../engine/time.js';
import { nightWalkCapMin } from '../data/country.js';
import mealTable from '../derive/meals.json' with { type: 'json' };

const safeHm = (hm) => { try { return hmToMin(hm); } catch { return null; } };

// ── 餐段（原話 #189）──
/**
 * 餐段前後各放寬幾分鐘（settings.mealGraceMin；缺或寫壞用 60）。
 * 原話 #189：「基本上 只要合理順路 排當天順序時目前不保證落在晚餐時段。這點不強制 像是有主行程要跑 但時間落在晚餐時段 那晚餐提早或延後 都可以」。
 * 60 是預設，11-06 實跑比過才取的：現況、一律放寬 60／90／120、只在主行程或固定時段蓋到餐段時放寬、放寬再跟著那件事延伸、只分上下半天、咖啡廳不放寬，
 * 各跑三個打包檔與它們給分配器重排後的版本。三個打包檔上 60 與 90 結果相同（8/16 流灯会佔住晚餐段的假警報拿掉、平常日的序列不變——
 * 那一句當時是靠「回城後 21:03 那一杯算晚餐」拿掉的；11-06 第二批立飲不再算一餐（原話 #195）之後它又出現，11-12 改由 stallsCover 處理：會場的攤位算那天的晚餐，原話 #172 採的提案）；
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
 * 配站：needs [{ slot, cands: [候選…] }]（候選是同一批物件的參照；每一餐的候選照「最像這一餐的」排在前）→ 跟 needs 等長的陣列，第 i 個是那一餐配到的候選（配不到 null）。
 * 每個候選最多配一餐（午、晚不重複算；主控 11-06 定）。排在前面的餐先配、也不會被後面的擠掉：後面那一餐先拿還沒人配的候選，都被配走了才請前面的改配它別的候選
 * （前面的沒有別的候選，後面那一餐就缺）——兩餐都只有同一站可配時前面那餐留著、後面那餐缺。
 * 兩餐以內直接配（搜尋的每個節點都會問一次，不建 Map）；三餐以上走小型二分配對（augmenting path），兩條路是同一個配法。
 */
function matchMeals(needs) {
  const n = needs.length;
  if (n === 0) return [];
  if (n === 1) return [needs[0].cands[0] ?? null];
  if (n === 2) {
    const a = needs[0].cands; const b = needs[1].cands;
    let first = a[0] ?? null; let second = null;
    for (const c of b) if (c !== first) { second = c; break; }
    if (second == null && b.length) for (const c of a) if (c !== first) { second = first; first = c; break; }
    return [first, second];
  }
  const owner = new Map();   // 候選 → needs 的索引
  const take = (i, seen) => {
    for (const c of needs[i].cands) if (!owner.has(c) && !seen.has(c)) { owner.set(c, i); return true; }
    for (const c of needs[i].cands) {
      if (seen.has(c) || !owner.has(c)) continue;
      seen.add(c);
      if (take(owner.get(c), seen)) { owner.set(c, i); return true; }
    }
    return false;
  };
  for (let i = 0; i < n; i++) take(i, new Set());
  const out = new Array(n).fill(null);
  for (const [c, i] of owner) out[i] = c;
  return out;
}

/**
 * 哪幾餐沒著落：needs [{ slot, cands }]（照優先序）→ 配不到的 slot 陣列。配法見 matchMeals；mealAssignments 用的是同一個。
 */
export function unmetMeals(needs) {
  const got = matchMeals(needs);
  return needs.filter((_, i) => got[i] == null).map((n) => n.slot);
}

// ── 這家店能當哪一餐、這一站是哪一餐（11-06 第二批；原話 #195）──
// 原話 #195：「早中晚餐的換一間 應該要推薦對應餐廳吧 怎麼會爐端燒的換一間 推薦我咖啡廳 這可以當晚餐嗎 如果可以那也應該在簡介裡提及」。
// 之前「吃的站」＝food／bar／cafe 的恢復站一律算午餐也算晚餐（規則 meal-slots 的 eats、換一家的「餐段的站放寬到所有吃的類」），所以晚餐的爐端燒按「換一家」會列出咖啡廳。
// 現在分兩件事，全引擎各只有這裡一個算法：
// (1) 這家店能當哪一餐（servesMeal）：知識庫欄位 meals（研究標的；data/schema.js MEALS_FIELD）優先，整個欄位沒有才照店型推導（derive/meals.json）。咖啡廳不再自動算一餐。
// (2) 這一站是這天的哪一餐（mealAssignments）：落在那一餐放寬後的時窗裡、那家店能當那一餐、每站最多算一餐。
// 讀 (1) 的：規則 meal-slots（經 (2)）、分配器 engine/allocate.js（這家能不能分成午餐／晚餐）、換一家 engine/swap.js（候選能不能當那一餐、那一餐的說明）、tools/kb-check.mjs（統計）。
// 讀 (2) 的：規則 meal-slots（缺哪一餐）、engine/trip.js（每天的 plan.meals）、換一家（這一站是哪一餐）、tools/plan-report.mjs；現場套過改案的那天由 ui/applied.js 重算。

/** 認得的三餐（知識庫 meals 欄位的鍵、servesMeal 的 slot；derive/meals.json 的 slots）。國家層 mealSlots 有哪一段，那一餐才存在。 */
export const MEAL_KEYS = Object.freeze([...(Array.isArray(mealTable.slots) ? mealTable.slots : ['breakfast', 'lunch', 'dinner'])]);
/** 三餐的人話名字（規則 meal-slots 的警告、報告、畫面）。 */
export const MEAL_NAMES = Object.freeze({ breakfast: '早餐', lunch: '午餐', dinner: '晚餐' });
/** 規則 meal-slots 管的兩餐（缺了罰、黃字）。配站時也先配這兩餐，早餐配剩下的——國家層多了早餐段，午餐晚餐缺不缺的結果不會因此改變。 */
export const MAIN_MEALS = Object.freeze(['lunch', 'dinner']);

/** 推導表裡有規則的店型（food、bar）；其他店型沒有 meals 欄位就一定不算一餐。 */
const DERIVED_CATEGORIES = new Set(Object.keys(mealTable.byCategory ?? {}));
const includesAny = (text, list) => Array.isArray(list) && list.some((k) => text.includes(String(k).toLowerCase()));
/**
 * 推導（知識庫那一筆沒有 meals 欄位時；預設）：舊旗標 meal: true ∪ 店型那一條規則。回 { [slot]: false｜true｜說明 }。規則是資料、放在 derive/meals.json（改表不用改程式）：
 * - slots：認得的三餐（MEAL_KEYS；data/schema.js 驗 meals 欄位的鍵也讀它）。
 * - legacyMealFlag：舊旗標 meal: true（祭典的縁日攤位，原話 #172；10-16）照舊算哪幾餐，不看店型與恢復站。
 * - byCategory[店型]：沒列的店型＝三餐都不算——咖啡廳（cafe）不再自動算一餐，要當一餐由研究在知識庫標 meals。推導只給午餐與晚餐，早餐只認知識庫的 meals.breakfast。
 *   一條規則的讀法：店型對得上、而且是恢復站（坐下來吃喝的；recovery 不是 false）才往下看；
 *   exceptMatched＝店型對照表命中的那個關鍵字（poi.categoryMatched，derive/category.json）在這裡面的不算——甜點攤可以當一站、不算一餐（10-16 分配器的判法搬來共用）；
 *   textAny＝店型原文（poi.categoryRaw，研究寫的那句）要含其中一個字才算，沒有店型原文的（示範資料、手寫的站直接給店型鍵）判不出來、不算；textNone＝含其中一個字就不算；
 *   note＝推導出來時給他看的一句（接在「可以當晚餐：」後面讀得通）；沒寫 note 的回 true（吃的類本來就是正餐，不用另外說明）。
 * - 酒吧類（bar）只有「酒場型、坐下來吃喝的店」算晚餐（profile §2 餐段「晚餐可由酒場型的店充當（日本例：居酒屋）」；原話 #18「居酒屋理應兩者皆可」；國家層 barTypes.note
 *   「居酒屋可當晚餐、也可當夜間站」）：店型原文寫居酒屋、酒場、爐端燒、めし（飯）的算；立飲（站著喝）不算；日本酒吧台、黑膠 bar 這種喝酒為主的不算。
 *   拿仙台知識庫 40 筆研究標註（對抗審查過的那一版，11-11 重跑）當對照比過六種推導（午晚各一格共 80 格）：現況 food／bar／cafe 都算 43 格相符、酒吧一律算晚餐 65、
 *   看命中的關鍵字 67（立飲酒場命中「酒場」被算進去）、看店型原文不含「めし」68、這一版 69（酒吧 16 格全對）、反過來排除 バー／bar／立飲 68。
 *   「めし」只靠汐谷一筆撐著：拿掉的話七天包 8/13 會多一句「今天沒排晚餐」。剩下對不上的 11 格：咖啡廳 6 格少給（標註說能當午餐／晚餐的洋食喫茶，推導一律不算——寧可少給，
 *   原話 #195 嫌的正是把咖啡廳推薦成晚餐）、吃的類 5 格多給（車站商場被店型認成吃的、只開到傍晚的朝市與松島的丼——後者由營業時間擋）。
 */
function deriveMeals(poi) {
  const out = Object.fromEntries(MEAL_KEYS.map((k) => [k, false]));
  if (poi.meal === true) for (const k of mealTable.legacyMealFlag ?? []) if (k in out) out[k] = true;
  const rule = mealTable.byCategory?.[poi.category];
  if (!rule || poi.recovery === false) return out;   // 不是恢復站＝不是坐下來吃喝的（外帶、邊走邊吃的攤）
  if (Array.isArray(rule.exceptMatched) && rule.exceptMatched.includes(poi.categoryMatched)) return out;
  if (rule.textAny || rule.textNone) {
    const text = String(poi.categoryRaw ?? '').toLowerCase();
    if (rule.textAny && !includesAny(text, rule.textAny)) return out;
    if (rule.textNone && includesAny(text, rule.textNone)) return out;
  }
  const note = typeof rule.note === 'string' && rule.note.trim() ? rule.note.trim() : true;
  for (const k of rule.meals ?? []) if (out[k] === false) out[k] = note;
  return out;
}

/** 知識庫的 meals 欄位寫了沒有：要是一個物件（{}＝明講不是吃正餐的地方）。null、沒寫、形狀不對（陣列、字串、true）都當沒寫、走推導（形狀不對的 normalizePoi 會記警告）。 */
export function hasMealsField(poi) {
  const m = poi?.meals;
  return m !== null && typeof m === 'object' && !Array.isArray(m);
}

const servedCache = new WeakMap();   // poi → { 六個來源值, out }：搜尋的每個節點都會問，同一家店不重算；來源值變了（測試會事後改 poi.meal）就重算
function mealsServed(poi) {
  const hit = servedCache.get(poi);
  if (hit && hit.meals === poi.meals && hit.flag === poi.meal && hit.category === poi.category && hit.matched === poi.categoryMatched && hit.raw === poi.categoryRaw && hit.recovery === poi.recovery) return hit.out;
  let out;
  if (hasMealsField(poi)) {
    out = {};
    for (const k of MEAL_KEYS) { const v = poi.meals[k]; out[k] = v === true ? true : (typeof v === 'string' && v.trim() !== '' ? v.trim() : false); }
  } else out = deriveMeals(poi);
  Object.freeze(out);
  servedCache.set(poi, { meals: poi.meals, flag: poi.meal, category: poi.category, matched: poi.categoryMatched, raw: poi.categoryRaw, recovery: poi.recovery, out });
  return out;
}

/**
 * 這家店能不能當這一餐（slot：'breakfast'｜'lunch'｜'dinner'）：回 false（不能）、true（能，吃的類本來就是正餐、不用另外說明）、或一句給他看的說明（能，而且要講是怎麼個能法——
 * 接在「可以當晚餐：」後面讀得通，例「拿坡里義大利麵、牛肉燴飯，點餐到 20:30」）。只講店的性質，不看那天幾點、有沒有開（那是呼叫端的事）。
 * - 知識庫有 meals 欄位（物件）就照欄位：鍵是 breakfast／lunch／dinner，值 true 或一句說明；沒列的那一餐＝不能；{}＝明講不是吃正餐的地方。舊旗標 meal 與店型都不再看。
 * - 整個欄位沒有才推導（derive/meals.json；預設）：food（甜點類除外）＝午餐、晚餐（回 true）；bar 裡酒場型、坐下來吃喝的（店型原文寫居酒屋、酒場、爐端、めし；立飲不算）＝晚餐
 *   （回表裡的那句說明）；cafe 與其他店型＝都不算；舊旗標 meal: true 照舊算午餐、晚餐。推導不給早餐。
 */
export function servesMeal(poi, slot) {
  if (!poi || typeof poi !== 'object') return false;
  // 快路（搜尋的每個節點都會問到每一站）：沒有 meals 欄位、沒有舊旗標、店型也不在推導表裡的站（神社、古著店、藥妝…）一定不能，不用查快取
  if (poi.meals == null && poi.meal !== true && !DERIVED_CATEGORIES.has(poi.category)) return false;
  return mealsServed(poi)[slot] ?? false;
}

/** 那一餐給他看的說明：servesMeal 回字串時就是它；回 true（吃的類、沒有另外的說明）或 false 都是 null。畫面與換一家清單顯示「可以當晚餐：…」用。 */
export function mealNoteOf(poi, slot) {
  const v = servesMeal(poi, slot);
  return typeof v === 'string' ? v : null;
}

/**
 * 這一站能不能算這天的這一餐（不看時刻）：那家店能當這一餐，而且是他勾的站——引擎插的站（stop.insertedBy：恢復站、填站、順路站）照舊不算
 * （不然引擎會為了補餐段自己從知識庫塞一家餐廳進來；DESIGN §11.1 R2-Q1「缺席只警告」）。
 * 唯一的例外是引擎替他排的早餐（insertedBy 'engine'、priority 'breakfast'；engine/breakfast.js，原話 #196）：它就是那天的早餐，只算早餐、不算午餐晚餐。
 * 他指定的早餐（stop.breakfast）是他勾的站，照一般的站算。
 */
function countsForMeal(stop, slot) {
  if (stop.insertedBy && !(slot === 'breakfast' && stop.priority === 'breakfast')) return false;
  return servesMeal(stop.poi, slot) !== false;
}

/**
 * 這一天每一餐配到哪一站。mealAssignments({ sequence, day, settings, country }, only?) →
 * { meals: { [餐]: 站的 poi id｜null }, stops: { [餐]: 配到的那一站（序列裡的 stop 物件） }, missing: [這天要、卻沒有站可配的餐…], notNeeded: { [餐]: 'window'｜'covered' } }
 * - 餐＝國家層 country.mealSlots 有的那幾段（日本現在是 lunch、dinner；多了 breakfast 就多一餐）；only 給了只看那幾餐（規則 meal-slots 傳 MAIN_MEALS）。
 * - 這天要不要這一餐（notNeeded）：原本的餐段不在當天原時窗（day.windowRaw）內＝'window'（抵達日傍晚才開始不要午餐）；被固定時段的站蓋住＝'covered'（大會供餐，coversMealSlot；
 *   降速釘的「現在就去坐」不算固定時段）；沒有站可配、而祭典會場的攤位把這一餐包了＝'stalls'（主行程是活動、佔著這一餐的餐段，他又勾了同一區能當這一餐的攤位；
 *   原話 #172 採的提案，stallsCover）。都看原本的餐段，不看放寬後的。不需要的那一餐 meals 是 null、也不在 missing 裡。
 *   早餐另有一種：他說這天不排（day.breakfast.mode：'hotel' 吃飯店早餐／'later' 原定那家改天去；原話 #196，engine/breakfast.js setBreakfast 寫進旅程檔）＝notNeeded.breakfast 就是那個 mode，
 *   那天不配早餐、不算缺（規則 breakfast-slot 不罰、也沒有「今天沒排早餐」的提示）。
 * - 候選：countsForMeal（他勾的站、那家店能當這一餐）而且起訖落進放寬後的時窗（mealSlotsOf 的 window；原話 #189）。照「跟原本的餐段重疊多少」排（多的在前，一樣多照序列先後）——
 *   10:40 的朝市與 11:30 的牛舌都落在午餐時窗時，午餐是牛舌那一站。
 * - 每一站最多算一餐（matchMeals）：先配午餐、晚餐（照時間），再配其餘的餐（早餐）。
 * missing 照時間排。這是「這一站算不算那一餐」的唯一算法：規則 meal-slots 罰的、plan.meals 寫的、換一家認的都是它。
 */
export function mealAssignments({ sequence, day = null, settings = null, country = null } = {}, only = null) {
  const slots = mealSlotsOf(country, settings);
  const meals = {}; const stops = {}; const notNeeded = {};
  for (const m of slots) if (!only || only.includes(m.slot)) meals[m.slot] = null;
  const needs = collectNeeds(Array.isArray(sequence) ? sequence : NO_STOPS, day?.windowRaw ?? day?.window ?? null, slots, only, notNeeded, true, breakfastOffOf(day));
  const got = matchMeals(needs);
  for (let i = 0; i < needs.length; i++) if (got[i]) { meals[needs[i].slot] = got[i].poi.id; stops[needs[i].slot] = got[i]; }
  const missing = [];
  for (const m of slots) if (m.slot in meals && meals[m.slot] == null && !(m.slot in notNeeded)) missing.push(m.slot);
  return { meals, stops, missing, notNeeded };
}

/**
 * 這天缺哪幾餐（照時間排）：就是 mealAssignments(...).missing，同一套收候選、同一個配法，只是不組那幾張對照表——規則 meal-slots 在搜尋的每個節點都會問一次，只要這個答案。
 */
export function missingMeals({ sequence, day = null, settings = null, country = null } = {}, only = null) {
  const slots = mealSlotsOf(country, settings);
  const needs = collectNeeds(Array.isArray(sequence) ? sequence : NO_STOPS, day?.windowRaw ?? day?.window ?? null, slots, only, null, false, breakfastOffOf(day));
  if (!needs.length) return NO_STOPS;
  const got = matchMeals(needs);
  let out = null;
  for (let i = 0; i < needs.length; i++) if (got[i] == null) (out ??= []).push(needs[i].slot);
  if (!out) return NO_STOPS;
  // needs 是「午餐晚餐在前、其餘在後」，兩邊都有缺時排回時間先後
  if (out.length > 1) { const at = (k) => slots.findIndex((m) => m.slot === k); out.sort((a, b) => at(a) - at(b)); }
  return out;
}

const NO_STOPS = Object.freeze([]);
/** 他說這天不排早餐的兩種（旅程檔 days[].breakfast.mode；原話 #196「我也有可能在飯店吃早餐 所以早餐的按鈕會不太一樣 不是不去了可能是改天去或是我吃飯店早餐」）。 */
export const BREAKFAST_OFF_MODES = Object.freeze(['hotel', 'later']);
/** 這天的早餐他說不排了嗎：回 'hotel'｜'later'，沒有（或寫壞）回 null。讀 day.breakfast.mode——engine/trip.js 把旅程檔那天的 breakfast 帶到 day 上下文。 */
export function breakfastOffOf(day) {
  const mode = day?.breakfast?.mode;
  return mode === 'hotel' || mode === 'later' ? mode : null;   // 就是 BREAKFAST_OFF_MODES 那兩個；搜尋的每個節點都會問一次，直接比
}
/**
 * 收每一餐的候選：回 needs [{ slot, cands }]——這天要的餐才有一筆，午餐晚餐（MAIN_MEALS）在前、其餘的餐在後，各自照時間；不需要的餐把原因寫進 notNeeded（給了才寫）。
 * ordered：候選要不要照「最像這一餐的在前」排（配到哪一站看它；只問缺哪幾餐時不用排，缺不缺跟順序無關）。mealAssignments 與 missingMeals 共用。
 * breakfastOff：他說這天不排早餐的那個 mode（breakfastOffOf；沒有是 null）——早餐那一段直接當不需要。
 */
function collectNeeds(seq, win, slots, only, notNeeded, ordered, breakfastOff = null) {
  const main = []; let rest = null;
  for (const m of slots) {
    if (only && !only.includes(m.slot)) continue;
    if (breakfastOff && m.slot === 'breakfast') { if (notNeeded) notNeeded[m.slot] = breakfastOff; continue; }
    if (win && overlapMin(win.startMin, win.endMin, m.core[0], m.core[1]) <= 0) { if (notNeeded) notNeeded[m.slot] = 'window'; continue; }
    let cands = NO_STOPS; let weights = null; let covered = false;
    for (const s of seq) {
      if (s.fixedWindow && !s.fixedWindow.pinned && coversMealSlot(s.startMin, s.endMin, m.core)) { covered = true; break; }
      // 落進放寬後的時窗（就是 inWindow：重疊超過 0 分；這裡直接算，每個節點每一站都會過一次），而且算得了這一餐
      if (!(Math.min(s.endMin, m.window[1]) - Math.max(s.startMin, m.window[0]) > 0) || !countsForMeal(s, m.slot)) continue;
      if (cands === NO_STOPS) { cands = [s]; if (ordered) weights = [overlapMin(s.startMin, s.endMin, m.core[0], m.core[1])]; continue; }
      if (!ordered) { cands.push(s); continue; }
      const w = overlapMin(s.startMin, s.endMin, m.core[0], m.core[1]);
      let i = cands.length;
      while (i > 0 && weights[i - 1] < w) i--;
      cands.splice(i, 0, s); weights.splice(i, 0, w);
    }
    if (covered) { if (notNeeded) notNeeded[m.slot] = 'covered'; continue; }
    // 沒有一站可配、而祭典會場的攤位把這一餐包了（stallsCover）：不算缺
    if (cands === NO_STOPS && stallsCover(seq, m)) { if (notNeeded) notNeeded[m.slot] = 'stalls'; continue; }
    if (MAIN_MEALS.includes(m.slot)) main.push({ slot: m.slot, cands }); else (rest ??= []).push({ slot: m.slot, cands });
  }
  return rest ? main.concat(rest) : main;
}

/** 活動類的站（祭典、花火、縁日攤位：只有那幾天有的）。engine/swap.js、engine/allocate.js 的 EVENT_CATEGORY 是同一個店型鍵。 */
const EVENT_CATEGORY = 'event';
/**
 * 祭典會場的攤位把這一餐包了（原話 #172 採的提案，profile §2.3 寫的是：祭典的縁日攤位算那天的晚餐）：這天的主行程是活動、它佔著這一餐原本的餐段（core），
 * 而他又勾了同一區、能當這一餐的活動攤位（知識庫 meals 或舊旗標 meal: true）——人整段都在會場，餐就在攤位解決，不管攤位那一站本身被排在幾點。
 * 只在這一餐沒有任何一站可配時才問（collectNeeds）；成立就當這一餐不需要（notNeeded 'stalls'），跟大會供餐（'covered'）同一種處理：不配站、不算缺、不罰。
 * 為什麼要有這一條（11-12 審查）：攤位那一站的時刻是引擎定的。七天包與公務版 8/16 引擎把縁日廣場排在一到松島的 13:25（落在午餐時窗，午餐又已經是牛舌），
 * 主行程流灯会 18:30–20:20 佔住晚餐段、回城那一杯是立飲（知識庫標了不算正餐，原話 #195），晚餐就沒有站可配，黃字「今天沒排晚餐」——他那晚人就在攤位旁邊。
 * 咖啡廳與立飲還算一餐的時候（842e9fa）這一句被回城那一杯蓋掉，所以沒人發現攤位其實沒被算成晚餐。
 * 「同一區、主行程也是活動」比照分配器（活動只跟著主行程也是活動的那天）與換一家（engine/swap.js mealEventZones）。引擎自己插的站不算（countsForMeal）。
 */
function stallsCover(seq, m) {
  for (const a of seq) {
    if (!a.isAnchor || a.poi?.category !== EVENT_CATEGORY || !a.poi.zoneId) continue;
    if (!(Math.min(a.endMin, m.core[1]) - Math.max(a.startMin, m.core[0]) > 0)) continue;
    for (const s of seq) if (s !== a && s.poi?.category === EVENT_CATEGORY && s.poi.zoneId === a.poi.zoneId && countsForMeal(s, m.slot)) return true;
  }
  return false;
}

/**
 * 每天 plan.meals 的形狀：{ breakfast, lunch, dinner } 各是那一餐配到的站的 poi id 或 null（國家層沒有那一段、這天不需要、缺，都是 null；要分辨就直接呼叫 mealAssignments）。
 * engine/trip.js planTrip 每天排完掛上去；現場套過改案的序列（ui/applied.js appliedPlan）要拿新的序列再算一次，不能沿用引擎那一版。
 */
export function planMealsOf(args) {
  return { ...Object.fromEntries(MEAL_KEYS.map((k) => [k, null])), ...mealAssignments(args).meals };
}

/** 這一站是哪一餐：plan.meals（或 mealAssignments(...).meals）裡 id 對得上的那一餐，都不是回 null。 */
export function mealOfStop(meals, poiId) {
  if (!meals || poiId == null) return null;
  for (const k of Object.keys(meals)) if (meals[k] === poiId) return k;
  return null;
}

// ── 早餐（11-06 第二批；原話 #196「還有預設上每天都要有早餐的安排 但我也有可能在飯店吃早餐」、#197）──
// 國家層 country.mealSlots 有 breakfast 這一段才有早餐這回事（日本值 07:00–10:00 寫在 kb/country/jp.json）；沒有這個鍵時下面每一個函式都回「沒有」，
// 引擎不排早餐、不罰、不提示，舊打包檔的結果不變。怎麼替他挑店、排在哪、推薦哪一天在 engine/breakfast.js；這裡只有「這天要不要早餐、缺不缺」的尺。

/** 國家層的早餐段：{ slot: 'breakfast', core: [起, 訖], window: [起 − 放寬, 訖 + 放寬] }（mealSlotsOf 的那一筆）；沒有回 null。 */
export function breakfastSlotOf(country, settings) {
  if (!country?.mealSlots?.breakfast) return null;
  return mealSlotsOf(country, settings).find((m) => m.slot === 'breakfast') ?? null;
}

const BREAKFAST_ONLY = Object.freeze(['breakfast']);
/**
 * 這天要早餐、卻沒有一站配到早餐嗎（規則 breakfast-slot 罰的、「今天沒排早餐」的提示問這一個）。答案跟 mealAssignments(...).missing 有沒有 'breakfast' 相同——
 * plan.meals.breakfast 是 null 而這天要早餐的日子，就是這裡回 true 的日子（engine/trip.js 決定要不要替他排早餐看的也是 mealAssignments）。
 * 不要早餐的日子（國家層沒有早餐段、早餐段不在當天原時窗內、被固定時段蓋住、他說這天不排）回 false。
 * 搜尋的每個節點都會問一次，所以分兩步：先只收早餐的候選——這天不要早餐、或沒有一站能當早餐，到這裡就有答案（絕大多數的節點）；
 * 有站能當早餐時才整套配一次：一站最多算一餐，那一站可能被午餐配走（10:40 的朝市丼是這天唯一能當午餐的站），那樣早餐還是缺。
 */
export function breakfastMissing({ sequence, day = null, settings = null, country = null } = {}) {
  if (!country?.mealSlots?.breakfast) return false;
  const seq = Array.isArray(sequence) ? sequence : NO_STOPS;
  const needs = collectNeeds(seq, day?.windowRaw ?? day?.window ?? null, mealSlotsOf(country, settings), BREAKFAST_ONLY, null, false, breakfastOffOf(day));
  if (!needs.length) return false;
  if (!needs[0].cands.length) return true;
  return missingMeals({ sequence, day, settings, country }).includes('breakfast');
}

/**
 * 「今天沒排早餐」是提示、不是黃字（原話 #196「我也有可能在飯店吃早餐」；主控 11-06 定）：規則 breakfast-slot 是 quiet 的（只進罰分、不出警告），這一句由這裡出——
 * 回 [{ ruleId: 'breakfast-slot', code: 'hint', hint: true, msg }]，不缺就是空陣列。沒有 poiId（整天的提示，不掛在哪一站上）。
 * 跟 dayTripNightHints、lastTrainHints 同一種後處理：engine/trip.js planTrip 每天排完掛；現場套過改案的那天（ui/applied.js appliedPlan）重算後要再掛一次。
 */
export function breakfastHints({ sequence, day = null, settings = null, country = null } = {}) {
  return breakfastMissing({ sequence, day, settings, country }) ? [{ ruleId: 'breakfast-slot', code: 'hint', hint: true, msg: `今天沒排${MEAL_NAMES.breakfast}` }] : [];
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
 * 字只講事實、不勸退（11-06 第二批；上一版結尾是「太晚就別去了」）：這一站常常就是那天的晚餐——餐段放寬後回城那一杯算晚餐（原話 #189），一邊算晚餐一邊叫他別去是自己打架；
 * 回城時刻是估的（最後一個外地站結束＋回程分鐘），所以寫「約」。門檻的時刻讀設定（dayTripNightReturnByHM）。
 * 跟 person-avoid、leg-suggest 同一種後處理：engine/trip.js planTrip 每天排完掛上去，不進分數；現場套過改案的那天 ui/applied.js 重算後再掛一次；
 * 分配器（engine/allocate.js）看到自己分的站被掛這條就收回。
 */
export function dayTripNightHints({ sequence, day, settings, country }) {
  return lateTownNightStops({ sequence, day, settings, country })
    .filter((x) => !x.stop.insertedBy)
    .map((x) => ({ ruleId: 'day-trip-night', code: 'hint', hint: true, poiId: x.stop.poi.id, backMin: x.backMin, msg: `一日遊回到市區約 ${minToHm(x.backMin)}（晚於 ${minToHm(x.byMin)}），${x.stop.poi.name_zh ?? '這一站'} 是你勾的，照排` }));
}

// ── 末班車（原話 #190「只要趕的上末班車都可以」）──
/**
 * 這一站卡在哪一班末班車：回 { kind: 'leg'（去這一站的那段搭車趕不上）｜'home'（待到太晚回不了住宿）, last: { leaveByMin, departMin, fromZoneId } }；都趕得上、或沒有資料可判回 null。
 * 兩張表在 day 上（engine/trip.js lastLegsOf、awayOf 每天整理的，都選填）：
 * (1) leg：從上一站（第一站＝住宿 day.homeZoneId）到這一站要搭車（leg.rideMin > 0）、那條路有末班資料（day.lastLegs["<起區>|<訖區>"]），
 *     而離開上一站的時刻（到站時刻 − 這一段的移動分鐘；等開門的不算晚出發）晚於最晚要離開的時刻 leaveByMin（末班發車 − 走去搭車的分鐘）。
 *     現場改案（day.resumed）的第一段不判：起點是他現在的位置、不是住宿，看不到是哪一區。
 * (2) home：這一站在外地（day.away：從那一區回住宿要搭車）、回程那條路有末班資料，而這一站的結束晚於 leaveByMin。引擎不排「回住宿」那一段，所以外地的站自己要看。
 * 不分這一站是誰排的——誰擋、誰只提示由呼叫端決定（規則 last-train、下面的 lastTrainHints）。
 */
export function missedLastTrain({ day, stop, prev = null, leg = null }) {
  const zone = stop?.poi?.zoneId;
  if (!day || !zone) return null;
  if (day.lastLegs && (leg?.rideMin ?? 0) > 0) {
    const from = prev ? prev.poi?.zoneId : (day.resumed ? null : day.homeZoneId);
    const last = from ? day.lastLegs[`${from}|${zone}`] : null;
    if (last) {
      const leaveMin = (stop.arriveMin ?? stop.startMin) - ((leg.walkMin ?? 0) + (leg.rideMin ?? 0) + (leg.waitMin ?? 0));
      if (leaveMin > last.leaveByMin) return { kind: 'leg', last };
    }
  }
  const home = day.away?.[zone]?.last;
  if (home && stop.endMin > home.leaveByMin) return { kind: 'home', last: home };
  return null;
}

/** 趕不上末班車的那句人話（規則 last-train 的排不進理由與他勾的站的提示同一句）：「去 X 趕不上 HH:MM 的末班車，○○發車」「X 待到 HH:MM，回住宿趕不上 HH:MM 的末班車，○○發車」。 */
export function lastTrainText(stop, missed, kb = null) {
  const name = stop?.poi?.name_zh ?? '這一站';
  if (!missed) return `${name} 趕不上末班車`;
  const from = kb?.zones?.[missed.last.fromZoneId]?.name_zh;
  const tail = `趕不上 ${minToHm(missed.last.departMin)} 的末班車${from ? `，${from}發車` : ''}`;
  return missed.kind === 'leg' ? `去 ${name} ${tail}` : `${name} 待到 ${minToHm(stop.endMin)}，回住宿${tail}`;
}

/**
 * 整條排好的序列裡哪幾站趕不上末班車（不分誰排的）：回 [{ index, stop, kind, last }]。每一段移動拿 legFn 重查（上一站→這一站；第一站從 home 出發），
 * 判法就是 missedLastTrain——跟搜尋時規則看到的同一個。day 上沒有末班的表就是空陣列；沒給 legFn 只判得了「待到太晚回不了住宿」。
 */
export function lastTrainMisses({ sequence, day, home = null, legFn = null }) {
  if (!day || (!day.lastLegs && !day.away) || !Array.isArray(sequence)) return [];
  const out = [];
  for (let i = 0; i < sequence.length; i++) {
    const stop = sequence[i];
    if (!stop?.poi) continue;
    const prev = i > 0 ? sequence[i - 1] : null;
    const from = prev ? prev.poi : home;
    const leg = typeof legFn === 'function' && from ? legFn(from, stop.poi) : null;
    const m = missedLastTrain({ day, stop, prev, leg });
    if (m) out.push({ index: i, stop, ...m });
  }
  return out;
}

/**
 * 他勾的站趕不上末班車：照排，那一站掛一條提示（不罰、不是牆）——總則 0「一定都要保持彈性，不能說一個地方沒去到我所有行程都卡死」、總則 3 點名就排；
 * 而且知識庫的末班是查來的一個時刻（改點、星期對不上、特殊期間取最早的保守值），拿它把他勾的站丟掉會丟錯（11-06 審查實測：週六的秋保被日祝的 19:18 丟掉）。
 * 引擎自己插的站不會出現在這裡（規則 last-train 擋掉）。回 [{ ruleId: 'last-train', code: 'hint', hint: true, poiId, kind, msg }]，字就是 lastTrainText 那兩句。
 * 跟 dayTripNightHints 同一種後處理：engine/trip.js planTrip 每天排完掛、ui/applied.js 現場套過改案的那天重掛；
 * 分配器（engine/allocate.js）看到自己分的站被掛這條就收回（需求單點名的、旅程檔原本就有的不收）。
 * 「待到太晚回不了住宿」（kind 'home'）同一個外地的區只講一次，掛在他勾的站裡最晚離開的那一站（11-17）：判定照舊是每一站各自判（missedLastTrain、lastTrainMisses 不變——
 * 引擎插的站照樣一站一站擋、算「趕不上的站有沒有變多」的地方也照舊數每一站），只是提示不重複。之前主行程本身晚於末班時，同一區排在它前面、也待過末班的站各掛一句，
 * 人其實整晚都在那一區，回不回得去看的只有最後離開的那一站；分配器還會把前面那幾站當成趕不上收回（11-12 審查，合成情境：瑞巌寺 14:59–16:29 與流灯会各一句）。
 * 所以這一種的提示不是「哪幾站回不了住宿」的清單：分配器收回自己分的站時不讀它，自己拿 lastTrainMisses 逐站判（engine/allocate.js takeDrops；照提示收的話同一區一趟只收得到一家）。
 * 「去這一站的那段搭車趕不上」（kind 'leg'）是一段一段的事，不併。
 */
export function lastTrainHints({ sequence, day, home = null, legFn = null, kb = null }) {
  const misses = lastTrainMisses({ sequence, day, home, legFn }).filter((x) => !x.stop.insertedBy);
  const latest = new Map();   // 外地的區 → 那一區 kind 'home' 裡最晚離開的那一筆（一樣晚取排在後面的）
  for (const x of misses) {
    if (x.kind !== 'home') continue;
    const zone = x.stop.poi.zoneId;
    const cur = latest.get(zone);
    if (!cur || x.stop.endMin >= cur.stop.endMin) latest.set(zone, x);
  }
  return misses
    .filter((x) => x.kind !== 'home' || latest.get(x.stop.poi.zoneId) === x)
    .map((x) => ({ ruleId: 'last-train', code: 'hint', hint: true, poiId: x.stop.poi.id, kind: x.kind, msg: lastTrainText(x.stop, x, kb) }));
}
