// 換這一站（DESIGN §6.3.1，原話 #90、#91）：點某一站，列出可以頂替它的候選——順路、那個時段有開；換掉的站不算落選。
// 規劃頁與現場都用；候選來源＝候選池 ∪ 走廊清單 ∪ 當日區域內的知識庫（這裡統一收成 pool）。
// 11-06 第二批（原話 #195「早中晚餐的換一間 應該要推薦對應餐廳吧 怎麼會爐端燒的換一間 推薦我咖啡廳 這可以當晚餐嗎 如果可以那也應該在簡介裡提及」）：
// 之前「餐段的站放寬到所有吃的類（food／bar／cafe）」，晚餐的爐端燒會列出咖啡廳。現在看這一站是不是這天的某一餐（rules/_slots.js mealAssignments，跟規則 meal-slots 同一把尺）：
// 是早／午／晚餐 → 只列能當那一餐的店（servesMeal：知識庫欄位 meals 優先、沒有才照店型推導），店型不限，每個候選帶那一餐的說明（mealNote）給畫面寫「可以當晚餐：…」；
// 不是哪一餐（下午的咖啡、晚上續攤的酒吧、甜點）→ 只列同店型。
// 11-11 補兩條（主控定）：餐段的換一家不列活動類的站（祭典、縁日攤位這種只有那幾天有的），除非那天的主行程也是活動、而且在同一區（mealEventZones）；
// 那一餐的說明不分店型——知識庫 meals 寫的是一句話就帶出來，吃的店寫的常是限制（「只有六、日、假日有午餐」「晚場只開 18:00–20:00」），畫面要顯示。
import { openIntervals } from './time.js';
import { personAvoids } from './persons.js';
import { servesMeal, mealAssignments, mealOfStop, MEAL_KEYS } from '../rules/_slots.js';
import { researchRank, researchSaysSkip, notAStop } from '../rules/_helpers.js';   // 研究註記的讀法（知識庫欄位優先、沒欄位退回店名字樣），跟分配器、引擎插站同一套

/**
 * 換一家不列的店（兩種情況都套；主控 11-06 定）：不是一個地點的條目（notAStop，「利久 vs 善治郎」那種比較摘要）、研究判這趟可略過的（researchSkip）、
 * 還沒解鎖的（unlockWhen，「下次再說」層）、挖寶型（curated:false）。都是知識庫裡本來就不主動給他的店；他自己勾的站不受影響（這裡管的是「推薦什麼」）。
 * 回 true＝不列。
 */
export function swapGated(poi) {
  return !poi || notAStop(poi) || researchSaysSkip(poi) || Boolean(poi.unlockWhen) || poi.curated === false;
}

/**
 * 同一個地點在知識庫寫成兩筆（仙台朝市／仙台朝市商店街，座標相同）：選填欄位 samePlace＝另一筆的 id（主控 11-11 定「同一處當同一家」；一筆指好幾筆時可以寫陣列）。
 * 只有一邊寫也算（知識庫只在其中一筆加）：甲指到乙、乙指到甲、或就是同一筆，都是同一處。換一家拿它擋「把朝市換成同一個朝市的另一筆」（推導：主控定的是
 * 「判這家別天用過沒」要當同一家，換一家列出同一處同理）。欄位沒寫、寫壞（不是字串）就只比 id，跟以前一樣。
 */
const placeRefs = (poi) => { const v = poi?.samePlace; return typeof v === 'string' ? (v ? [v] : []) : Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x) : []; };
export function samePlace(a, b) {
  return Boolean(a?.id) && Boolean(b?.id) && (a.id === b.id || placeRefs(a).includes(b.id) || placeRefs(b).includes(a.id));
}

/**
 * 一批 POI 的「同一處」對照表：placeTwins(pois) → Map<id, [同一處的另外幾筆的 id]>。判法跟 samePlace(a, b) 一樣（哪一邊寫都算、陣列也收、只認直接互指）；
 * 整批沒有任何一筆寫 samePlace 時是空的 Map——呼叫端看 size 就知道不用多做事（舊打包檔走這條路，行為與耗時都跟以前一樣）。
 * 引擎自己插站的幾個池與走廊清單用它（engine/trip.js；11-17）：一個一個拿 samePlace 兩兩比的話，每天每個池都要比上萬次。
 */
export function placeTwins(pois = []) {
  const out = new Map();
  const link = (a, b) => { if (a === b) return; const list = out.get(a); if (!list) out.set(a, [b]); else if (!list.includes(b)) list.push(b); };
  for (const p of pois ?? []) {
    if (!p?.id) continue;
    for (const ref of placeRefs(p)) { link(p.id, ref); link(ref, p.id); }
  }
  return out;
}

/** 活動類的站（祭典、花火、縁日攤位：只有那幾天有的）。分配器 engine/allocate.js 的 EVENT_CATEGORY 是同一個店型鍵。 */
const EVENT_CATEGORY = 'event';

/**
 * 餐段的換一家可以列活動類候選的那幾區（Set；空的＝這天一家活動類都不列）：這天的主行程也是活動，就是它所在的區——
 * 比照分配器「活動只跟著主行程也是活動的那天」（engine/allocate.js judge；縁日攤位跟著花火）。主控 11-11 定。
 * 為什麼要擋：知識庫的活動營業時間常解析成天天有開、縁日攤位又標了能當午餐晚餐（meals），不擋的話平常日的晚餐按「換一家」會列出只有祭典那幾天才有的攤位。
 * 主行程怎麼認：序列裡帶 isAnchor 的站（單站型一站、主題型可以好幾站）；主行程被擠出序列時，給了 day 就拿 day.anchorPoiId 去 pool 找。
 * 主行程或候選沒有歸區（zoneId 空）就判不出「同一區」，不列。
 */
export function mealEventZones({ plan, pool = [], day = null }) {
  const zones = new Set();
  const add = (poi) => { if (poi?.category === EVENT_CATEGORY && poi.zoneId) zones.add(poi.zoneId); };
  let inSeq = false;
  for (const s of plan?.sequence ?? []) if (s?.isAnchor) { inSeq = true; add(s.poi); }
  if (!inSeq && day?.anchorPoiId) for (const c of pool) { const poi = c?.poi ?? c; if (poi?.id === day.anchorPoiId) { add(poi); break; } }
  return zones;
}

/**
 * 這一站是這天的哪一餐（'breakfast'｜'lunch'｜'dinner'）；不是哪一餐回 null。
 * 有給 country 就拿這條序列當場算（mealAssignments；day 是那天的 day 上下文，要它的時窗）——現場套過改案的序列用這條路最準；
 * 沒給就讀 plan.meals（engine/trip.js planTrip 每天排完掛的）；兩個都沒有回 null（當作不是哪一餐、只列同店型）。
 */
export function swapMealOf({ plan, stopId, day = null, country = null, settings = {} }) {
  const meals = country ? mealAssignments({ sequence: plan?.sequence, day, settings, country }).meals : plan?.meals;
  return mealOfStop(meals, stopId);
}

/**
 * swapCandidates({ plan, stopId, pool, legFn, date, settings, adjust, day?, country?, meal? }) → [{ poi, detourMin, open, meal, mealNote }]
 * - 這一站是哪一餐：swapMealOf（給 country／day 當場算，沒給讀 plan.meals）；呼叫端也可以直接給 meal（'breakfast'｜'lunch'｜'dinner'；給 null＝當作不是哪一餐、只列同店型——
 *   二選一 engine/choices.js 這樣用，咖啡廳只配咖啡廳）。
 * - 是某一餐：候選要能當那一餐（servesMeal 不是 false），店型不限；mealNote＝那一餐的說明字串，不分店型——知識庫 meals 那一餐寫的是一句話就原樣帶出來
 *   （咖啡廳、酒吧寫的是供應什麼：「拿坡里義大利麵、牛肉燴飯，點餐到 20:30」；吃的店寫的常是限制：「只有六、日、假日有午餐（11:30–14:00）」「晚場只開 18:00–20:00」），
 *   沒有欄位的酒場型用推導表那一句；知識庫只寫 true、或推導出來的吃的類（本來就是正餐、沒有要另外交代的）是 null。畫面有 mealNote 就顯示「可以當晚餐：…」，不看店型。
 *   不是 food 的候選（咖啡廳、酒吧、攤位）照理都有說明：知識庫只寫 true 的 tools/kb-check.mjs 會列進「先補這些」；真的沒有（舊旗標 meal: true 的攤位）時 mealNote 是 null，畫面自己決定怎麼寫。
 *   活動類的候選（祭典、縁日攤位）只在這天的主行程也是活動、而且跟它同一區時才列（mealEventZones；比照分配器「活動只跟著主行程也是活動的那天」）。
 * - 不是哪一餐：只列同 category；mealNote null。（活動類那一條只管餐段的換一家；這一站自己就是活動、又不是哪一餐時，照同店型列。）
 * - 兩種都不列 swapGated 的店（不是一個地點、研究判可略過、還沒解鎖、挖寶型），也不列已經在這天行程裡的站與它們「同一處的另一筆」（知識庫欄位 samePlace；見 samePlace）；
 *   同一處的兩筆都是候選時只留排在前面的那一筆。
 * - 順路：以前後站算 detourMin ＝ (前→候選＋候選→後) − (前→後)，≤ settings.swapDetourMaxMin（預設 10）
 * - 那個時段有開（hours 查得到的才判；查不到的列出來但標 open: null）
 * - adjust（那天的 day.adjust，T19）：在場的人不想去的店型不列——除了跟這一站同 category 的（他勾的那一類照排、換同類也由他；別的店型進來的才擋：
 *   他勾的食堂按「換一家」不列同行者不去的居酒屋、咖啡廳；10-16 審查）
 * - 排序：繞路分鐘少的在前；一樣的研究首選在前、備案在後（researchRank）；再一樣照 pool 的順序。
 * - check（選填）：(poi) → 要不要列。畫面傳 engine/choices.js pinnedSwapCheck 做的那個函式（11-12 起釘住順序的日子、11-24 起每一天都傳）——每一家真的換過去排一次，
 *   其餘各站都還在、先後不變、沒有站多掉進排不進才列（11-12 審查：釘住的日子換一家沒有試算，817 次裡 24 次有站因此不在）。上面幾道門都過了才問它（它比較貴）。
 * 每個候選的 meal＝這次是在換哪一餐（或 null），整份清單同一個值。
 */
export function swapCandidates({ plan, stopId, pool, legFn, date, settings = {}, adjust = null, day = null, country = null, meal, check = null }) {
  const seq = plan.sequence;
  const i = seq.findIndex((s) => s.poi.id === stopId);
  if (i < 0) return [];
  const cur = seq[i];
  const maxDetour = settings.swapDetourMaxMin ?? 10;
  const slot = meal !== undefined ? (MEAL_KEYS.includes(meal) ? meal : null) : swapMealOf({ plan, stopId, day, country, settings });
  // 已經在行程裡的不列；同一處的另一筆（知識庫欄位 samePlace）也算在行程裡——這一站自己與序列裡每一站指到的 id 都收進來，候選指到其中任何一個也擋
  const inPlan = new Set(seq.map((s) => s.poi.id));
  for (const s of seq) for (const id of placeRefs(s.poi)) inPlan.add(id);
  const eventZones = slot ? mealEventZones({ plan, pool, day }) : null;   // 餐段的換一家：活動類只在主行程也是活動的那一區列
  const out = [];
  for (const c of pool) {
    const poi = c.poi ?? c;
    if (poi.id === cur.poi.id || inPlan.has(poi.id) || placeRefs(poi).some((id) => inPlan.has(id)) || swapGated(poi)) continue;
    const serves = slot ? servesMeal(poi, slot) : false;
    if (slot ? serves === false : poi.category !== cur.poi.category) continue;
    if (slot && poi.category === EVENT_CATEGORY && !eventZones.has(poi.zoneId)) continue;
    if (poi.category !== cur.poi.category && personAvoids(adjust, poi)) continue;
    const detourMin = swapDetourMin(seq, i, poi, legFn);
    if (detourMin > maxDetour) continue;
    const iv = openIntervals(poi, date);
    const open = iv === null ? null : iv.some(([o, cl]) => cur.startMin >= o && cur.startMin + (poi.dwellMin ?? cur.dwellMin) <= cl);
    if (open === false) continue;
    out.push({ poi, detourMin, open, meal: slot, mealNote: typeof serves === 'string' ? serves : null });
  }
  out.sort((x, y) => x.detourMin - y.detourMin || researchRank(x.poi) - researchRank(y.poi));
  // 同一處的兩筆都過了上面的門時只留排在前面的那一筆（清單上不要同一個地點出現兩次；畫面只顯示前幾家，不該被重複的佔掉一格）
  const kept = [];
  const list = out.filter((c) => (kept.some((p) => samePlace(p, c.poi)) ? false : (kept.push(c.poi), true)));
  return typeof check === 'function' ? list.filter((c) => check(c.poi)) : list;
}

/** 把序列第 index 站換成 poi 會多繞幾分：(前→候選＋候選→後) − (前→後)，第一站沒有前站、最後一站沒有後站就只算有的那段；換這一站與二選一（choices.js）共用同一個算法。 */
export function swapDetourMin(seq, index, poi, legFn) {
  const prev = seq[index - 1] ?? null; const next = seq[index + 1] ?? null;
  const a = prev ? legMin(legFn(prev.poi, poi)) : 0;
  const b = next ? legMin(legFn(poi, next.poi)) : 0;
  const base = prev && next ? legMin(legFn(prev.poi, next.poi)) : 0;
  return Math.max(0, a + b - base);
}

/**
 * 把旅程某天的 picks 裡的一站換成另一站（換掉的不算落選：記在 day.swapped[]），回新的 day 物件；重排由呼叫端做。
 * 釘住順序的日子（day.pinned；engine/insert.js，原話 #192）：順序裡那一筆原位置換成新的那一家——其餘各站先後不動；那一筆記的停留是舊那家的，不沿用。
 * 新的那一家在順序裡殘留的舊筆（之前拿掉過）先清掉，才不會同一家出現兩次。那天沒釘住就不多這個鍵。
 */
export function applySwap(day, fromPoiId, toPoi, priority = 'want') {
  const picks = (day.picks ?? []).map((p) => (p.poiId === fromPoiId ? { ...p, poiId: toPoi.id, priority: p.priority ?? priority } : p));
  const swapped = [...(day.swapped ?? []), { from: fromPoiId, to: toPoi.id, at: new Date().toISOString() }];
  const pin = day.pinned && typeof day.pinned === 'object' && Array.isArray(day.pinned.sequence) ? day.pinned : null;
  if (!pin || !pin.sequence.some((e) => e?.poiId === fromPoiId)) return { ...day, picks, swapped };
  const sequence = pin.sequence.filter((e) => e?.poiId !== toPoi.id).map((e) => (e?.poiId === fromPoiId ? { poiId: toPoi.id } : e));
  return { ...day, picks, swapped, pinned: { ...pin, sequence } };
}

const legMin = (l) => (l?.walkMin ?? 0) + (l?.rideMin ?? 0);
