// 多日分配器 v1（計畫 2 T17）：候選池 → 每一天的 picks。
// 規則本體是 docs/superpowers/plans/2026-10-16-trip-pilot-t17-allocator-draft.md（主控 10-16 寫給他看的分配規則草案，第一、二節；第四節是沒把握的預設）。
// 他 10-09 說整趟要先排好、他只改不順眼的（原話 #121：「整趟已經排好、你只改不順眼的。但也是說，雖然你已經幫我排好了，我也還保持一定程度的調整空間，而不是一切都鎖死的」）。
// 現在的引擎只排一天之內的順序與時間（core.js planDay、trip.js planTrip），哪些候選分到哪一天還是人手寫進旅程檔；這一層補的就是「候選池到各天」（DESIGN §1.6）。
// 純函式：不改傳入的 trip。App 畫面不 import（桌機工具 tools/allocate.mjs 用），所以不進 dist；之後規劃頁要「這天重新分配」再接。
//
// 做法（草案第一、二節；數字全是預設或推導，出處寫在各處）：
// 1. 骨架照旅程檔：日型、主行程（days[].anchor）、指定站（days[].designated）、固定時段的站（picks[].fixedWindow）、購物日（trip.js shoppingDaysOf）、同行者（engine/persons.js）。
//    v1 不自己挑主行程（決策樹 Q7「他在規劃頁點每天的主行程」；草案第一節第 3、5 條的自動挑法還沒做）。骨架以外的 picks 整個換掉，換掉前的 picks 只拿來算重疊率。
// 2. 候選池＝打包檔這城全部 POI 過門（poolEligible）：curated !== false、my.rating 不 ≤2、poolLosses < 2、沒 unlockWhen（跟 trip.js engineMayInsert 同四條，但不扣 item——品項落點是④層）；
//    不是交通／會場（會場由骨架給）、不是一日遊複合條目（研究摘要不是一個地點，trip.js NO_FILL_CATEGORIES 同理）、不是坐下來的地方（引擎每天自己當 optional 候選，分了會重複）；
//    研究判可略過的不拿（知識庫還沒有欄位，目前寫在店名括號裡：「可略過」「不可指望」；researchSaysSkip，待確認）；店名寫「A vs B」的比較條目不拿（兩家比較的摘要、不是一個地點；comparisonEntry，待確認）；
//    任何一天按過「不去了」的不拿。
//    活動（event）綁日期、哪天去是骨架的事（草案第一節：有時限的優先當主行程），只在主行程也是活動的那天分（縁日攤位跟著花火；推導——知識庫的活動營業時間常解析成七天都開，自由分會把 8/16 的流灯会放到 8/15）。
// 3. 層級（profile §2.2）：② 需求單點名（每個人的 go.designated、mustEat 對得上店名；寫的是店型「神社」「古著店」不算，店型對照表裡的品牌字「Yodobashi」「三越」算點名）
//    → ③ 六星（my.rating 6）與有憑據的意義類（significance 且 significanceSource；只有店家自述的不拿豁免，DESIGN §4）
//    → ④ 品項落點（item 有值、或需求單要買的對得上 item／items[]）→ 其餘。骨架的主行程與指定站不是候選、不分配。
// 4. 逐層分配（②→③→④→其餘）：每個候選對每一天算適合度、分到最合適的那天（草案第二節）——
//    硬條件：那天有開（營業時間落在時窗內、而且落在固定時段釘住以外的空檔；沒營業時間資料視為有開，規則 hours 自己跳過）→ 在當日區域（regionZonesFor）→ 同行者不去的店型不拿（T19）→ 購物類只在購物日（代購品項順路買不受限）；
//    配額：非主題日 SAME_TYPE_CATEGORIES 各 ≤ settings.sameTypeMaxPerDay、每天午餐／晚餐各一家吃的（country.mealSlots）、夜間站一家（country.nightSlot）、同一家整趟一次、同一品項整趟一個落點、一天最多 allocItemMaxPerDay 個品項落點；
//    研究註記（researchRank；店名括號裡的「首選」「備案／保底」，知識庫沒欄位，待確認）：吃的站標備案／保底的不主動排當一餐（原話 #6、#13 沒興趣的善治郎正是研究標「保底備案」的那家；
//    profile §5.1 要知識庫標 unlockWhen 擋它，仙台包還沒標——出處 trip.js engineMayInsert 的註記）；品項落點與餐段挑店「首選」先、「備案」後；
//    順路：離主行程（沒有主行程的日子＝據點）移動分鐘最近（legFn 的走路＋搭車分鐘，推導）；
//    站數：目標 allocTargetStops（一日遊 allocDayTripTargetStops）、上限 allocMaxStops（一日遊 allocDayTripMaxStops），時窗短的日子（抵達、離境、固定時段日）照「一點一小時」（DESIGN §1.3）縮；到目標之後那天的適合度加 allocOverTargetPenaltyMin。
//    其餘層的餐段與夜間站是「每天各一」的配額，改成每天挑最順路的一家（全部日子的（天, 店）對裡，研究註記 → 星等 → 最近的先定；吃的站停留離 60 分越遠越不像一餐，當小小的扣分；
//    甜點攤（店型對照表 food 的「甜點」對到的）可以當一站、不算一餐）——候選挑天的話，站前小吃攤離據點最近、會先把每一天的餐段佔掉（10-16 第一版實測）；其餘候選照候選挑天。推導。
//    餐段與夜間站在④之前佔位：每晚夜間站是他明講的規則（原話 #18）、品項落點是填充（DESIGN §1.5 一個 ≤30 分的站），固定時段日只剩兩三站時不該讓順路購買把夜間站擠掉（10-16 審查後；推導，待確認）。
//    分不進任何一天的留在候選池、帶理由（不算落選、不加 poolLosses；草案第四節）。
// 5. 每天跑單日引擎驗證（planTrip，規則全部）：被丟的分配站那天不再試，然後把還沒分到的候選再分一輪（被丟的試別天、同品項的換另一家、空出來的位子回填），再驗證一次；
//    還有被丟的就再來一輪，最多驗證 MAX_VERIFY_RUNS 趟（三趟；第一版只搬一次，公務版的 On 鞋首選店 8/12 被丟、搬到 8/14 又被丟，同品項另外六家連試都沒試到），最後一趟丟的留候選池。
//    骨架的站不動（丟了只記在 report.verify）。留池理由全部在最後重算（分配當下記的理由，驗證搬動之後會失真）。
// 6. priority：②③ 'want'、④ 與其餘 'maybe'；骨架照旅程檔；品項落點帶 errand: true（順路購買，rules/shopping-day.js 不罰；T22 的欄位）、停留裁到 30 分（DESIGN §1.5「當一個 ≤30 分的站」）。
import { planTrip, dayWindow, airportTransitMin, resolveHome, shoppingDaysOf, themeCategoryOf, fixedWindowOf, fixedSpanMin } from './trip.js';
import { openIntervals, hmToMin } from './time.js';
import { SAME_TYPE_CATEGORIES, SAME_TYPE_NAMES, SHOPPING_CATEGORIES } from '../rules/_helpers.js';
import { personsOf, presentOn, mergeAdjustments, personAvoids, cityNamesOf } from './persons.js';
import { nightWalkCapMin } from '../data/country.js';
import { classifyCategory } from '../data/schema.js';
import { toList } from '../data/brief.js';
import categoryTable from '../derive/category.json' with { type: 'json' };

/** 分配器用的數字（rules.json settings 同名鍵；缺就用這裡的預設）。 */
export const ALLOC_DEFAULTS = Object.freeze({
  allocTargetStops: 6,          // 一天目標站數（草案第四節：原話 #121 只說整趟排好、沒給站數；預設）
  allocMaxStops: 8,             // 一天上限（跟 maxStopsPerDay 同值；他只說九站太滿，原話 #123）
  allocDayTripTargetStops: 5,   // 一日遊目標（草案第二節「一日遊目標 4–5」，取 5；預設）
  allocDayTripMaxStops: 6,      // 一日遊上限（預設）
  allocOverTargetPenaltyMin: 60,   // 到目標之後那天的適合度加這麼多分鐘：別天還有位子就先去別天（推導）
  allocWalkCircleMin: 20,       // 「走路相鄰」的區：沿 walk 連結累計走路 ≤ 20 分的區都算（推導：仙台站→一番町 12→國分町 6，國分町從車站走得到）
  allocLinkMaxMin: 15,          // 錨點圈的「直達 ≤15 分」（DESIGN §1.2、CONTEXT 錨點圈；搭車＋走路合計）
  allocCorridorSlackMin: 10,    // 走廊：經由某區轉一次比直達多不到 10 分的那個區算在路上（推導）
  allocItemMaxPerDay: 2,        // 一天最多幾個品項落點（推導：品項是填充，不該佔掉半天）
});

/** 分配器不拿的店型：交通與會場（骨架給）、一日遊複合條目、坐下來的地方（推導，見檔頭 2）。 */
export const NO_ALLOC_CATEGORIES = new Set(['logistics', 'venue', 'daytrip', 'spot']);
/** 層級的人話名字（報告用）。 */
export const LEVEL_NAMES = Object.freeze({ skeleton: '骨架', 2: '②', 3: '③', 4: '④', rest: '其餘' });
/** 吃的站（餐段配額看的店型；規則 rules/meal-slots.js 算 food／bar／cafe 都算一餐，分配器只拿 food 當「吃的」——咖啡廳走同類配額、酒吧走夜間站；推導） */
const MEAL_CATEGORY = 'food';
const NIGHT_CATEGORY = 'bar';
const EVENT_CATEGORY = 'event';
/**
 * 晚上沒有夜間站的日型：離境日與城際移動日（那晚人在飛機或車上）。抵達日有：原話 #18「每晚都要安排」是通則、v4 8/12 抵達晚上就排了 かけはし；
 * rules/night-slot.js 對抵達日只是不要求（缺了不罰）、沒有禁。10-16 審查後把 arrival 拿掉（之前三種飛機日都不給），待確認。
 */
const NO_NIGHT_TYPES = new Set(['departure', 'transfer']);
const SLOT_ORDER = ['lunch', 'dinner', 'night'];
/** 單日引擎驗證最多跑幾趟（每趟之間把丟掉的、空出來的再分一輪）；三趟是預設——七天包一趟約一秒 */
const MAX_VERIFY_RUNS = 3;
/** 吃的站裡不算一餐的：店型對照表（derive/category.json food 的關鍵字）裡「甜點」對到的（ずんだ茶寮那種甜點攤——可以當一站、不佔餐段；推導，待確認） */
const NOT_A_MEAL_MATCHED = new Set(['甜點']);
const isMeal = (p) => p.category === MEAL_CATEGORY && p.recovery !== false && !NOT_A_MEAL_MATCHED.has(p.categoryMatched);
/** 留在候選池的理由分幾關（數字越大越接近排進去；報告記它走到最遠的那一關）：沒開／沒空檔 → 區域 → 活動／同行者／購物日 → 配額 → 站數 */
const STAGE = Object.freeze({ open: 0, region: 1, limit: 2, quota: 3, stops: 4 });

const num = (v, d) => (Number.isFinite(v) ? v : d);
const setting = (settings, key) => num(settings?.[key], ALLOC_DEFAULTS[key]);
const cmpNum = (a, b) => (a === b ? 0 : a < b ? -1 : 1);   // Infinity − Infinity 是 NaN，不能用減法比
/** 陣列鍵逐項比（數字或字串），全同回 0 */
const cmpKey = (a, b) => { for (let i = 0; i < a.length; i++) { const c = typeof a[i] === 'string' ? a[i].localeCompare(b[i]) : cmpNum(a[i], b[i]); if (c) return c; } return 0; };
const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, '');

/** 研究判可略過的站：知識庫還沒有欄位，先認店名括號裡的「可略過」「不可指望」（代購研究的查證結果寫在店名裡；待確認）；明寫 skip: true 也算。 */
export function researchSaysSkip(p) {
  if (p?.skip === true) return true;
  return /可略過|不可指望/.test(String(p?.name_zh ?? ''));
}

/**
 * 研究寫在店名括號裡的註記（跟 researchSaysSkip 同一個來源；知識庫沒欄位，待確認）：「首選」→ 0 先挑、沒寫 → 1、「備案」「保底」「備援」→ 2 後挑。
 * 仙台包：伊達的牛舌本舖（推薦首選）、Art Sports（首選）、松本清 Clis Road（首選：…）、たんや善治郎 仙台站前本店（保底備案）、大國藥妝（…保底站）、XEBIO（徒步圈外備案）、Yodobashi 仙台（深夜備援）。
 */
export function researchRank(p) {
  const name = String(p?.name_zh ?? '');
  if (/首選/.test(name)) return 0;
  if (/備案|保底|備援/.test(name)) return 2;
  return 1;
}

/** 比較條目：店名寫「A vs B」的是研究拿兩家比較的摘要、不是一個地點（仙台包「利久 vs 善治郎（站內牛舌通比較吃）」；跟一日遊複合條目同理，推導，待確認）。 */
export function comparisonEntry(p) {
  return /\svs\.?\s/i.test(String(p?.name_zh ?? ''));
}

/**
 * 候選池的門：知識庫裡本來就不主動排的不拿（跟 trip.js engineMayInsert 同四條，item 不扣）、分配器不拿的店型不拿、研究判可略過的不拿、比較條目不拿。
 */
export function poolEligible(p) {
  if (!p || !p.id) return false;
  if (NO_ALLOC_CATEGORIES.has(p.category)) return false;
  if (p.curated === false) return false;
  if (Number.isFinite(p.my?.rating) && p.my.rating <= 2) return false;
  if ((p.poolLosses ?? 0) >= 2) return false;
  if (p.unlockWhen) return false;
  if (researchSaysSkip(p)) return false;
  if (comparisonEntry(p)) return false;
  return true;
}

/**
 * 需求單的一條文字對不對得上這家店：店名（name_zh、name_local、id）或品項（item、items[]）一邊包含另一邊；短的那邊至少 2 個字、被包含的店名至少 3 個字（「me」不能對上「memento」）。
 * 寫的是店型（「古著店」「神社」——classifyCategory 整句都是關鍵字）不算對上：那是類別請求，研究來分（brief-template 原則三），記進 report.briefUnmatched。
 */
export function briefTextMatches(poi, text) {
  const t = norm(text);
  if (t.length < 2) return false;
  // 三個字以內的英數字（me、jam）要整個詞對上，不能只是店名裡的一段（memento）；中日文兩個字（三越）照包含算
  const shortLatin = /^[a-z0-9]+$/.test(t) && t.length <= 3;
  const contains = (n) => (shortLatin ? new RegExp(`(^|[^a-z0-9])${t}([^a-z0-9]|$)`).test(n) : n.includes(t));
  const fields = [poi?.id, poi?.name_zh, poi?.name_local, poi?.item, ...(Array.isArray(poi?.items) ? poi.items : [])];
  return fields.some((f) => {
    const n = norm(f);
    if (!n) return false;
    return contains(n) || (n.length >= 3 && t.includes(n));
  });
}

/** 店型字樣後面接的量詞（古著＋店、唱片＋行、咖啡＋廳）：整句＝關鍵字＋這一個字也算店型請求。 */
const CATEGORY_SUFFIX = new Set(['店', '行', '廳', '屋', '館']);
/**
 * 店型對照表（derive/category.json）裡拿來認店型的品牌與品名字（Yodobashi、三越、藤崎、松本清、ツルハ、PARCO…；表的 brandKeywords）：
 * 需求單寫這些是點名一家店，不是店型請求——不然「Yodobashi」會被當成「電器行」丟進 briefUnmatched、② 靜靜失效（10-16 審查後）。
 */
const BRAND_KEYWORDS = new Set((Array.isArray(categoryTable.brandKeywords) ? categoryTable.brandKeywords : []).map((k) => norm(k)));
/** 這條需求單文字是不是只寫了店型（「古著店」「唱片行」「神社」）：classifyCategory 命中的關鍵字就是整句、或整句只比關鍵字多一個量詞；命中的是品牌字不算。 */
export function isCategoryRequest(text) {
  const t = norm(text);
  if (!t) return false;
  const { key, matched } = classifyCategory(t);
  if (key === 'other' || matched == null) return false;
  const m = norm(matched);
  if (BRAND_KEYWORDS.has(m)) return false;
  return t === m || (t.startsWith(m) && t.length === m.length + 1 && CATEGORY_SUFFIX.has(t.slice(-1)));
}

/** 需求單（trip.brief 或 --brief 讀進來的 JSON；data/brief.js 的形狀）→ { go: [文字], buy: [文字] }；沒有需求單回空。 */
export function briefTargets(brief) {
  const persons = Array.isArray(brief?.persons) ? brief.persons : [];
  const go = []; const buy = [];
  for (const p of persons) {
    go.push(...toList(p?.go?.designated), ...toList(p?.go?.mustEat));
    buy.push(...toList(p?.buy?.own));
  }
  for (const e of Array.isArray(brief?.errands) ? brief.errands : []) buy.push(...toList(e?.what));
  return { go: [...new Set(go)], buy: [...new Set(buy)] };
}

/**
 * 層級（profile §2.2）：2 需求單點名、3 六星或有憑據的意義類、4 品項落點、'rest' 其餘。
 * 回 { level, why }：why 是人話（報告用；② 寫對上了需求單哪一條）。
 */
export function levelOf(poi, targets = { go: [], buy: [] }) {
  const go = (targets.go ?? []).find((t) => !isCategoryRequest(t) && briefTextMatches(poi, t));
  if (go) return { level: 2, why: `需求單點名「${go}」` };
  if (poi.my?.rating === 6) return { level: 3, why: '六星' };
  if (poi.significance && poi.significanceSource) return { level: 3, why: `意義類（${poi.significance}）` };
  if (poi.item) return { level: 4, why: `品項「${poi.item}」` };
  const buy = (targets.buy ?? []).find((t) => briefTextMatches(poi, t));
  if (buy) return { level: 4, why: `需求單要買「${buy}」` };
  return { level: 'rest', why: null };
}

/**
 * 區與區之間的連結圖：kb.links（打包檔 pack.zones.links，"a|b" → { mode, rideMin, walkMin }）有就讀它；沒有就拿 legFn 探（兩個沒座標的假站，legFn 回 source 'link' 的就是直達連結）。
 * 回 { walk: Map<zone, [{ to, min }]>（mode walk 的連結，走路分鐘）, direct: Map<zone, [{ to, min, mode }]>（所有直達連結，搭車＋走路合計） }。
 */
export function zoneGraph({ kb = null, legFn = null, zoneIds = [] } = {}) {
  const walk = new Map(); const direct = new Map();
  const add = (map, a, b, entry) => { map.set(a, [...(map.get(a) ?? []), { to: b, ...entry }]); map.set(b, [...(map.get(b) ?? []), { to: a, ...entry }]); };
  const take = (a, b, link) => {
    if (!a || !b || a === b || !link) return;
    const ride = num(link.rideMin, 0); const w = num(link.walkMin, 0);
    if ((link.mode === 'walk' || ride === 0)) add(walk, a, b, { min: w });
    add(direct, a, b, { min: ride + w, mode: link.mode ?? (ride > 0 ? 'ride' : 'walk') });
  };
  const links = kb?.links;
  if (links && typeof links === 'object' && Object.keys(links).length) {
    for (const [key, link] of Object.entries(links)) { const [a, b] = String(key).split('|'); take(a, b, link); }
    return { walk, direct };
  }
  if (typeof legFn !== 'function') return { walk, direct };
  const ids = [...new Set(zoneIds.filter(Boolean))];
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    const leg = legFn({ id: `__zone:${ids[i]}`, zoneId: ids[i] }, { id: `__zone:${ids[j]}`, zoneId: ids[j] });
    if (!leg || leg.source !== 'link' || leg.via) continue;
    take(ids[i], ids[j], { mode: leg.mode === 'walk' ? 'walk' : (leg.mode ?? 'ride'), rideMin: leg.rideMin, walkMin: leg.walkMin });
  }
  return { walk, direct };
}

/** 從 zone 沿 walk 連結走得到的區（累計走路 ≤ maxMin），含自己。 */
export function walkCircle(graph, zone, maxMin) {
  const out = new Map([[zone, 0]]);
  const queue = [zone];
  while (queue.length) {
    const z = queue.shift();
    for (const e of graph.walk.get(z) ?? []) {
      const total = out.get(z) + e.min;
      if (total > maxMin || (out.has(e.to) && out.get(e.to) <= total)) continue;
      out.set(e.to, total); queue.push(e.to);
    }
  }
  return new Set(out.keys());
}

/**
 * 當日區域（草案第二節第 1 條；CONTEXT「當日區域」＝據點步行圈 ∪ 錨點圈 ∪ 走廊）：
 * - 普通日、固定時段日：據點步行圈（據點的區＋走路相鄰，allocWalkCircleMin）∪ 錨點圈（主行程的區＋走路相鄰＋直達 ≤ allocLinkMaxMin 分的區）∪ 走廊（據點→主行程經由某區轉一次、比直達多不到 allocCorridorSlackMin 分的那些區）
 * - 一日遊：只拿主行程那一區與路上（錨點圈 ∪ 走廊，不含據點圈；原話 #11 一日遊是出城；草案「一日遊當天只放那個方向的站」）；晚上回城的夜間站另給 nightZones＝據點步行圈（推導：原話 #18「每晚都要安排」、v4 8/16 回城後排了站前的立飲；待確認）
 * - 離境日：只拿據點那一區（站前步行圈；原話 #36 購物壓最後，離境日照關門時間排）
 * - 抵達日：據點步行圈（晚上能去的由營業時間過濾）
 * 沒有主行程的普通日＝據點步行圈。回 { zones: [...], nightZones: [...] | null }。
 */
export function regionZonesFor({ day, home, anchorPoi, graph, settings = {} }) {
  const walkMin = setting(settings, 'allocWalkCircleMin');
  const linkMax = setting(settings, 'allocLinkMaxMin');
  const slack = setting(settings, 'allocCorridorSlackMin');
  const homeZone = home?.zoneId ?? null;
  const anchorZone = anchorPoi?.zoneId ?? null;
  const type = day?.type ?? 'normal';
  if (type === 'departure') return { zones: homeZone ? [homeZone] : [], nightZones: null };
  const homeCircle = homeZone ? walkCircle(graph, homeZone, walkMin) : new Set();
  if (type === 'arrival' || !anchorZone) return { zones: [...homeCircle], nightZones: null };
  const anchorCircle = walkCircle(graph, anchorZone, walkMin);
  for (const e of graph.direct.get(anchorZone) ?? []) if (e.min <= linkMax) anchorCircle.add(e.to);
  const corridor = new Set();
  if (homeZone && homeZone !== anchorZone) {
    const directMin = (graph.direct.get(homeZone) ?? []).find((e) => e.to === anchorZone)?.min ?? null;
    if (directMin != null) {
      for (const e1 of graph.direct.get(homeZone) ?? []) {
        if (e1.to === anchorZone) continue;
        const e2 = (graph.direct.get(e1.to) ?? []).find((e) => e.to === anchorZone);
        if (e2 && e1.min + e2.min <= directMin + slack) corridor.add(e1.to);
      }
    }
  }
  if (day?.dayTrip) return { zones: [...new Set([...anchorCircle, ...corridor])], nightZones: [...homeCircle] };
  return { zones: [...new Set([...homeCircle, ...anchorCircle, ...corridor])], nightZones: null };
}

/** 這家店在 [startMin, endMin] 內開得夠久（至少 needMin 分）嗎：true／false；沒有結構化營業時間回 null（當有開，規則 hours 自己跳過並警告）。 */
export function openWithin(poi, date, startMin, endMin, needMin = 30) {
  const iv = openIntervals(poi, date);
  if (iv === null) return null;
  return iv.some(([o, c]) => Math.min(c, endMin) - Math.max(o, startMin) >= needMin);
}

/**
 * 時窗 [startMin, endMin] 扣掉固定時段釘住的那幾段（spans：[[卡位時刻, 散場時刻], …]）之後剩下的空檔 [[a, b], …]；沒有固定時段就是整個時窗。
 * 固定時段日（研討會 08:50–20:00 釘死）的候選要看空檔、不能看整天：12:00–19:30 開的古著店整天看是有開，空檔裡一分鐘都沒有（10-16 審查後；公務版 8/14 elie 之前就是這樣分進去又被驗證丟掉）。
 */
export function freeIntervals(startMin, endMin, spans = []) {
  let out = [[startMin, endMin]];
  for (const [s, e] of spans) {
    const next = [];
    for (const [a, b] of out) {
      if (e <= a || s >= b) { next.push([a, b]); continue; }
      if (s > a) next.push([a, s]);
      if (e < b) next.push([e, b]);
    }
    out = next;
  }
  return out.filter(([a, b]) => b > a);
}

const safeHm = (hm) => { try { return hmToMin(hm); } catch { return null; } };
/** 國家層的餐段與夜間時段（分鐘）；缺或壞回 null（那一條配額就不算時段、只數家數）。 */
function slotsOf(country) {
  const out = { lunch: null, dinner: null, night: null };
  for (const k of ['lunch', 'dinner']) {
    const s = country?.mealSlots?.[k];
    if (Array.isArray(s) && s.length === 2) { const a = safeHm(s[0]); const b = safeHm(s[1]); if (a != null && b != null && b > a) out[k] = [a, b]; }
  }
  const n = country?.nightSlot;
  if (Array.isArray(n) && n.length === 2) {
    const a = safeHm(n[0]); let b = safeHm(n[1]);
    const cap = nightWalkCapMin(country);
    if (a != null && b != null) { if (cap != null) b = Math.min(b, cap); if (b > a) out.night = [a, b]; }
  }
  return out;
}

/** 骨架的 pick 蓋住了這個餐段嗎（跟 rules/meal-slots.js 同一條：固定時段的站從餐段開始前就在進行、到餐段過半還沒散＝大會供餐）。 */
function coveredByFixed(fw, slot, dwellMin) {
  if (!fw || !slot) return false;
  const start = fw.startMin - (fw.arriveEarlyMin ?? 0);
  const end = Number.isFinite(fw.endMin) ? fw.endMin + (fw.afterMin ?? 0) : fw.startMin + (dwellMin ?? 0);
  return start <= slot[0] && end >= (slot[0] + slot[1]) / 2;
}

/** 移動分鐘（走路＋搭車）：離主行程（或據點）有多近。legFn 壞掉或回不出東西當很遠。 */
function travelMin(legFn, from, to) {
  if (!from || !to) return 999;
  const leg = legFn(from, to);
  if (!leg) return 999;
  return num(leg.walkMin, 0) + num(leg.rideMin, 0);
}

/** 星等分層（profile §2.2 同層內先留誰：去過評好的（5／6）與沒去過的並列優先、4 星其次、去過普通的最後；序是推導）。 */
function ratingTier(p) {
  const r = p.my?.rating;
  if (!Number.isFinite(r)) return 0;
  if (r >= 5) return 0;
  if (r === 4) return 1;
  return 2;
}

/** 吃的站像不像一餐：停留離 60 分越遠越不像（站前小吃攤 30、車站大樓 135），每 10 分算 1 分鐘的扣分（推導，只在餐段挑店時當小小的扣分）。 */
const mealFit = (p) => Math.abs((p.dwellMin ?? 60) - 60) / 10;

/**
 * allocateTrip({ trip, pois, kb, country, settings, rules, legFn, brief = null, options = {} })
 * - pois：{ [poiId]: poi } 或陣列（已 normalize；打包檔的全部 POI＝候選池的來源）
 * - kb：{ zones, links? }（links 是打包檔 pack.zones.links；沒有就拿 legFn 探區與區的連結）
 * - brief：需求單 JSON（data/brief.js 的形狀）；沒給就用 trip.brief；都沒有只用骨架
 * - options.verify（預設 true）：分完每天跑 planTrip 驗證、被丟的那天不再試、再分一輪、再驗一次；false 只分配（測試用）
 * 回 { days: [{ date, picks: [{ poiId, priority, dwellMin?, errand?, fixedWindow?… }] }], unplaced: [{ poiId, name, category, level, reason }], report }；不改傳入的 trip。
 */
export function allocateTrip({ trip, pois, kb = null, country = null, settings = {}, rules = null, legFn, brief = null, options = {} }) {
  if (!trip || !Array.isArray(trip.days)) throw new Error('旅程檔要有 days');
  if (typeof legFn !== 'function') throw new Error('要給 legFn');
  const poiList = Array.isArray(pois) ? pois.filter(Boolean) : Object.values(pois ?? {}).filter(Boolean);
  const poiMap = Array.isArray(pois) ? Object.fromEntries(poiList.map((p) => [p.id, p])) : (pois ?? {});
  const theBrief = brief ?? trip.brief ?? null;
  const targets = briefTargets(theBrief);
  const warnings = [];
  const persons = personsOf(trip, theBrief, warnings, cityNamesOf(kb));
  const shopping = shoppingDaysOf(trip, settings, warnings);
  const slots = slotsOf(country);
  const removed = new Set(trip.days.flatMap((d) => (d.removed ?? []).map((r) => r?.poiId)).filter(Boolean));
  const zoneIds = [...new Set([...Object.keys(kb?.zones ?? {}), ...poiList.map((p) => p.zoneId), ...(trip.homeBases ?? []).map((b) => b?.poi?.zoneId)].filter(Boolean))];
  const graph = zoneGraph({ kb, legFn, zoneIds });
  const usedIds = new Set();   // 同一家整趟一次（骨架＋分配到的）
  const usedItems = new Set();   // 同一品項整趟一個落點
  const placedAt = new Map();   // 分配到的 poiId → 那一天的 state
  const dropped = new Map();   // poiId → [{ date, reason }]：單日引擎驗證時丟過它的日子（那天不再試）

  // ── 每一天的骨架與狀態 ──
  const days = trip.days.map((d, index) => {
    const home = resolveHome(trip, d.date);
    const anchorPoi = d.anchor?.poiId ? poiMap[d.anchor.poiId] ?? null : (d.anchor?.poiIds?.length ? poiMap[d.anchor.poiIds[0]] ?? null : null);
    const skeletonIds = new Set([d.anchor?.poiId, ...(d.anchor?.poiIds ?? []), ...(d.designated ?? [])].filter(Boolean));
    const original = [];   // 換掉前的 picks（骨架以外；算重疊率）
    const skeleton = [];   // 留下的 picks（主行程、指定站、固定時段）
    for (const p of d.picks ?? []) {
      if (!p?.poiId) continue;
      if (skeletonIds.has(p.poiId) || p.fixedWindow) skeleton.push({ ...p });
      else original.push(p.poiId);
    }
    // 骨架有主行程／指定站、picks 卻沒寫的補上（主行程 must、指定站 want；推導）
    for (const id of skeletonIds) if (!skeleton.some((p) => p.poiId === id)) skeleton.push({ poiId: id, priority: id === d.anchor?.poiId || d.anchor?.poiIds?.includes(id) ? 'must' : 'want' });
    const type = d.type ?? 'normal';
    const win = dayWindow(d, index, settings, type === 'arrival' || type === 'departure' ? airportTransitMin({ legFn, home, settings }) : 0, country);
    const present = presentOn(persons, d.date);
    const adjust = mergeAdjustments(present);
    const themeCategory = themeCategoryOf(d, warnings);
    const region = regionZonesFor({ day: { type, dayTrip: Boolean(d.dayTrip) }, home, anchorPoi, graph, settings });
    // 固定時段釘住的那幾段（卡位時刻到散場；只釘開始的照停留）：站數目標扣掉它、候選的「有開」只看它以外的空檔
    const spans = [];
    for (const p of skeleton) {
      const fw = fixedWindowOf(p.fixedWindow, settings);
      if (!fw) continue;
      const poi = poiMap[p.poiId];
      const dwell = p.dwellMin ?? fixedSpanMin(fw) ?? poi?.dwellMin ?? 60;
      spans.push([fw.startMin - (fw.arriveEarlyMin ?? 0), Number.isFinite(fw.endMin) ? fw.endMin + (fw.afterMin ?? 0) : fw.startMin + dwell]);
    }
    const free = freeIntervals(win.startMin, win.raw?.endMin ?? win.endMin, spans);
    // 站數目標與上限：時窗扣掉固定時段釘住的整段後照「一點一小時」縮（DESIGN §1.3；推導）
    const fixedMin = spans.reduce((s, [a, b]) => s + Math.max(0, Math.min(b, win.endMin) - Math.max(a, win.startMin)), 0);
    const hours = Math.max(0, win.endMin - win.startMin - fixedMin) / 60;
    const baseTarget = d.dayTrip ? setting(settings, 'allocDayTripTargetStops') : setting(settings, 'allocTargetStops');
    const baseMax = d.dayTrip ? setting(settings, 'allocDayTripMaxStops') : setting(settings, 'allocMaxStops');
    const target = Math.max(1, Math.min(baseTarget, Math.floor(hours)));
    const max = Math.max(target, Math.min(baseMax, Math.floor(hours * 1.25)));
    const state = {
      date: d.date, index, type, dayTrip: Boolean(d.dayTrip), home, anchorPoi, ref: anchorPoi ?? home, win, free, region: region.zones, nightZones: region.nightZones,
      eventDay: anchorPoi?.category === EVENT_CATEGORY,
      themeCategory, adjust, shoppingDay: shopping.has(d.date), shoppingFromMin: shopping.get(d.date)?.fromMin ?? null,
      nightOff: NO_NIGHT_TYPES.has(type) || Boolean(d.nightSlotOff) || Boolean(trip.days[index + 1]?.earlyDay) || adjust.nightSlot === 'none',
      target, max, stops: 0, cat: {}, lunch: false, dinner: false, night: false, items: 0,
      skeleton, original, picks: [],   // picks＝分配到的 [{ poiId, priority, errand?, dwellMin?, level, slot, travelMin, movedFrom }]
    };
    for (const p of skeleton) {
      const poi = poiMap[p.poiId];
      usedIds.add(p.poiId);
      state.stops += 1;
      if (!poi) continue;
      state.cat[poi.category] = (state.cat[poi.category] ?? 0) + 1;
      if (poi.item) { state.items += 1; usedItems.add(poi.item); }
      const fw = fixedWindowOf(p.fixedWindow, settings);
      const dwell = p.dwellMin ?? (fw ? fixedSpanMin(fw) : null) ?? poi.dwellMin ?? 60;
      // 骨架裡吃的站先佔餐段（午餐優先；沒有國家層餐段時只數家數，judge 用 cat 看）
      if (isMeal(poi)) {
        if (slots.lunch && !state.lunch && openWithin(poi, d.date, slots.lunch[0], slots.lunch[1], 20) !== false) state.lunch = true;
        else if (slots.dinner && !state.dinner && openWithin(poi, d.date, slots.dinner[0], slots.dinner[1], 20) !== false) state.dinner = true;
      }
      if (poi.category === NIGHT_CATEGORY) state.night = true;
      if (fw) {
        if (coveredByFixed(fw, slots.lunch, dwell)) state.lunch = true;
        if (coveredByFixed(fw, slots.dinner, dwell)) state.dinner = true;
        if (slots.night && fw.startMin < slots.night[1] && (Number.isFinite(fw.endMin) ? fw.endMin : fw.startMin + dwell) > slots.night[0]) state.night = true;
      }
    }
    return state;
  });

  // ── 候選池與層級 ──
  const briefUnmatched = targets.go.filter((t) => isCategoryRequest(t) || !poiList.some((p) => briefTextMatches(p, t)))
    .map((t) => ({ text: t, reason: isCategoryRequest(t) ? '寫的是店型，研究來分' : '候選池裡沒有這家' }));
  // 需求單點名的店名也對到品項研究站（「Yodobashi 仙台（深夜備援・東口）」那種「在 X 買 Y」的條目）時：同一個名字有不是品項站的店對得上，就只算那家是點名、品項站照④——
  // 不然「Yodobashi」一句會把 Yodobashi Camera、Art Sports Yodobashi 店、Yodobashi 深夜備援三條都升成②（10-16 審查後實測）；只有品項站對得上的（點名「Art Sports」）照②
  const placeMatched = new Set(targets.go.filter((t) => !isCategoryRequest(t) && poiList.some((p) => !p.item && briefTextMatches(p, t))));
  const targetsFor = (p) => (p.item && placeMatched.size ? { ...targets, go: targets.go.filter((t) => !placeMatched.has(t)) } : targets);
  const pool = poiList.filter((p) => poolEligible(p) && !usedIds.has(p.id) && !removed.has(p.id)).map((p) => ({ poi: p, ...levelOf(p, targetsFor(p)) }));
  const placeReason = new Map();   // poiId → { stage, counts }（每次重算前清掉）

  /** 這家店在 [lo, hi] 裡、固定時段以外的空檔有沒有一段開著而且夠長：true／false；沒營業時間資料而空檔夠長回 null（當有開）。 */
  const openInFree = (p, day, lo, hi, needMin) => {
    let unknown = false;
    for (const [a, b] of day.free) {
      const s = Math.max(a, lo); const e = Math.min(b, hi);
      if (e - s < needMin) continue;
      const r = openWithin(p, day.date, s, e, needMin);
      if (r === true) return true;
      if (r === null) unknown = true;
    }
    return unknown ? null : false;
  };

  /** 吃的站這一天能佔哪個餐段：want 給了只看那一段；沒給午餐優先。回 'lunch'／'dinner'／null。 */
  const mealSlotFor = (p, day, want = null) => {
    const can = (k) => Boolean(slots[k]) && !day[k] && slots[k][0] < day.win.endMin && slots[k][1] > day.win.startMin && openInFree(p, day, slots[k][0], Math.min(slots[k][1], day.win.endMin), 20) !== false;
    if (want) return can(want) ? want : null;
    return can('lunch') ? 'lunch' : can('dinner') ? 'dinner' : null;
  };

  /** 這個候選對這一天：過了硬條件與配額回 { ok: true, slot, travel, score }；不行回 { ok: false, stage, reason }。want 是餐段挑店時指定的那一段。 */
  const judge = (cand, day, want = null) => {
    const p = cand.poi;
    const need = Math.min(p.dwellMin ?? 60, 30);
    if (openWithin(p, day.date, day.win.startMin, day.win.endMin, need) === false) return { ok: false, stage: STAGE.open, reason: '那天沒開' };
    if (openInFree(p, day, day.win.startMin, day.win.endMin, need) === false) return { ok: false, stage: STAGE.open, reason: '固定時段以外沒有它開著的空檔' };
    const isNightCand = p.category === NIGHT_CATEGORY;
    const inRegion = day.region.includes(p.zoneId) || (isNightCand && Array.isArray(day.nightZones) && day.nightZones.includes(p.zoneId));
    if (!inRegion) return { ok: false, stage: STAGE.region, reason: '不在當日區域' };
    if (p.category === EVENT_CATEGORY && !day.eventDay) return { ok: false, stage: STAGE.limit, reason: '活動只跟著主行程也是活動的那天' };
    if (personAvoids(day.adjust, p)) return { ok: false, stage: STAGE.limit, reason: '同行者不想去的店型' };
    const isItem = cand.level === 4;
    if (SHOPPING_CATEGORIES.includes(p.category) && !isItem) {
      if (!day.shoppingDay) return { ok: false, stage: STAGE.limit, reason: '購物類只在購物日' };
      if (day.shoppingFromMin != null && openInFree(p, day, day.shoppingFromMin, day.win.endMin, need) === false) return { ok: false, stage: STAGE.limit, reason: '購物時段沒開' };
    }
    let slot = null;
    if (SAME_TYPE_CATEGORIES.includes(p.category) && day.themeCategory !== p.category && (day.cat[p.category] ?? 0) >= (settings.sameTypeMaxPerDay ?? 2)) {
      return { ok: false, stage: STAGE.quota, reason: `${SAME_TYPE_NAMES[p.category] ?? '同類'}一天 ${settings.sameTypeMaxPerDay ?? 2} 家滿了` };
    }
    if (isMeal(p)) {
      if (researchRank(p) === 2) return { ok: false, stage: STAGE.quota, reason: '研究標備案／保底的吃的站不主動排當一餐' };
      if (slots.lunch || slots.dinner) {
        slot = mealSlotFor(p, day, want);
        if (!slot) return { ok: false, stage: STAGE.quota, reason: day.lunch && day.dinner ? '午餐、晚餐都有了' : '餐段對不上（已有的那餐佔了、另一餐它沒開或時窗外）' };
      } else if ((day.cat[MEAL_CATEGORY] ?? 0) >= 2) return { ok: false, stage: STAGE.quota, reason: '吃的一天 2 家滿了（沒有國家層餐段）' };
    } else if (want && want !== 'night') return { ok: false, stage: STAGE.quota, reason: '不是吃的站' };
    if (isNightCand) {
      if (day.nightOff) return { ok: false, stage: STAGE.quota, reason: NO_NIGHT_TYPES.has(day.type) ? '離境日、城際移動日晚上沒有夜間站' : '那晚不排夜間站（早起日前一晚、或同行者不要）' };
      if (day.night) return { ok: false, stage: STAGE.quota, reason: '夜間站有了' };
      if (slots.night && openInFree(p, day, slots.night[0], Math.min(slots.night[1], day.win.raw?.endMin ?? day.win.endMin), 30) === false) return { ok: false, stage: STAGE.quota, reason: '夜間時段沒開（或被固定時段釘住）' };
      slot = 'night';
    } else if (want === 'night') return { ok: false, stage: STAGE.quota, reason: '不是夜間站' };
    if (isItem) {
      if (p.item && usedItems.has(p.item)) return { ok: false, stage: STAGE.quota, reason: `品項「${p.item}」已有落點` };
      if (day.items >= setting(settings, 'allocItemMaxPerDay')) return { ok: false, stage: STAGE.quota, reason: `品項落點一天 ${setting(settings, 'allocItemMaxPerDay')} 個滿了` };
    }
    if (day.stops >= day.max) return { ok: false, stage: STAGE.stops, reason: `站數滿（上限 ${day.max}）` };
    const travel = travelMin(legFn, day.ref, p);
    const score = travel + (day.stops >= day.target ? setting(settings, 'allocOverTargetPenaltyMin') : 0) + day.stops * 0.5;
    return { ok: true, slot, travel, score };
  };

  // 留在候選池的理由：記它走到最遠的那一關（站數滿 > 配額 > 活動／同行者／購物日 > 區域外 > 沒開），同一關有幾種理由就報最多天都是的那一種（夜間站「有了」五天、離境日一天 → 報有了）
  const note = (cand, r) => {
    const prev = placeReason.get(cand.poi.id);
    if (!prev || r.stage > prev.stage) { placeReason.set(cand.poi.id, { stage: r.stage, counts: new Map([[r.reason, 1]]) }); return; }
    if (r.stage === prev.stage) prev.counts.set(r.reason, (prev.counts.get(r.reason) ?? 0) + 1);
  };

  const place = (cand, day, r) => {
    const p = cand.poi;
    const pick = { poiId: p.id, priority: cand.level === 2 || cand.level === 3 ? 'want' : 'maybe' };
    if (cand.level === 4) {
      pick.errand = true;
      if ((p.dwellMin ?? 60) > 30) pick.dwellMin = 30;
    }
    day.picks.push({ ...pick, level: cand.level, why: cand.why, slot: r.slot, travelMin: r.travel, movedFrom: dropped.get(p.id)?.at(-1)?.date ?? null });
    day.stops += 1;
    day.cat[p.category] = (day.cat[p.category] ?? 0) + 1;
    if (r.slot === 'lunch') day.lunch = true;
    if (r.slot === 'dinner') day.dinner = true;
    if (r.slot === 'night') day.night = true;
    if (cand.level === 4) { day.items += 1; if (p.item) usedItems.add(p.item); }
    usedIds.add(p.id);
    placedAt.set(p.id, day);
  };

  const unplace = (day, poiId) => {
    const i = day.picks.findIndex((x) => x.poiId === poiId);
    if (i < 0) return null;
    const [pick] = day.picks.splice(i, 1);
    const p = poiMap[poiId];
    day.stops -= 1;
    if (p) day.cat[p.category] = Math.max(0, (day.cat[p.category] ?? 1) - 1);
    if (pick.slot === 'lunch') day.lunch = false;
    if (pick.slot === 'dinner') day.dinner = false;
    if (pick.slot === 'night') day.night = false;
    if (pick.level === 4) { day.items -= 1; if (p?.item) usedItems.delete(p.item); }
    usedIds.delete(poiId);
    placedAt.delete(poiId);
    return pick;
  };

  /** 最合適的那天：依序試每一天（驗證丟過它的那天不試），過了的取 score 最小；全部不過回 null（理由記在 placeReason）。 */
  const bestDay = (cand) => {
    const skip = new Set((dropped.get(cand.poi.id) ?? []).map((x) => x.date));
    let best = null;
    for (const day of days) {
      if (skip.has(day.date)) continue;
      const r = judge(cand, day);
      if (!r.ok) { note(cand, r); continue; }
      if (!best || r.score < best.r.score) best = { day, r };
    }
    return best;
  };

  // 同層內的順序：星等分層 → 離最合適的那天的主行程有多近（硬條件先過、配額還沒算）→ id；都是推導
  const nearest = (cand) => {
    let best = Infinity;
    for (const day of days) {
      const p = cand.poi;
      if (openInFree(p, day, day.win.startMin, day.win.endMin, Math.min(p.dwellMin ?? 60, 30)) === false) continue;
      if (!day.region.includes(p.zoneId) && !(p.category === NIGHT_CATEGORY && day.nightZones?.includes(p.zoneId))) continue;
      best = Math.min(best, travelMin(legFn, day.ref, p));
    }
    return best;
  };
  const order = (list) => list.map((c) => ({ c, tier: ratingTier(c.poi), near: nearest(c) })).sort((a, b) => cmpNum(a.tier, b.tier) || cmpNum(a.near, b.near) || String(a.c.poi.id).localeCompare(String(b.c.poi.id))).map((x) => x.c);

  /**
   * 分一輪：還沒分到的候選逐層分（②③ → 其餘層的餐段與夜間站 → ④ → 其餘）。第一輪分全部；驗證丟過站之後再分一輪（丟掉的試別天、同品項換另一家、空出來的位子回填）。
   */
  const round = () => {
    const pending = () => pool.filter((c) => !placedAt.has(c.poi.id));
    for (const level of [2, 3]) for (const cand of order(pending().filter((c) => c.level === level))) {
      const hit = bestDay(cand);
      if (hit) place(cand, hit.day, hit.r);
    }
    // 其餘層的餐段與夜間站先佔位（每天各一的配額：全部日子的（天, 店）對裡，研究註記 → 星等 → 最近的先定；在④之前，見檔頭 4）
    const slotFree = (day, slot) => (slot === 'night' ? !day.night && !day.nightOff : Boolean(slots[slot]) && !day[slot]);
    for (const slot of SLOT_ORDER) {
      const cands = pending().filter((c) => c.level === 'rest' && (slot === 'night' ? c.poi.category === NIGHT_CATEGORY : isMeal(c.poi)));
      for (;;) {
        let best = null;
        for (const day of days) {
          if (!slotFree(day, slot)) continue;
          for (const cand of cands) {
            if (placedAt.has(cand.poi.id) || dropped.get(cand.poi.id)?.some((x) => x.date === day.date)) continue;
            const r = judge(cand, day, slot);
            if (!r.ok) { note(cand, r); continue; }
            const key = [researchRank(cand.poi), ratingTier(cand.poi), r.score + (slot === 'night' ? 0 : mealFit(cand.poi)), day.index, String(cand.poi.id)];
            if (!best || cmpKey(key, best.key) < 0) best = { cand, day, r, key };
          }
        }
        if (!best) break;
        place(best.cand, best.day, best.r);
      }
    }
    // ④ 品項落點：同一品項的幾家店只落一家（研究註記「首選」先、「備案」後 → 最順路的那家、最合適的那天）
    const groups = new Map();
    for (const c of order(pending().filter((c) => c.level === 4))) { const key = c.poi.item ?? `__${c.poi.id}`; groups.set(key, [...(groups.get(key) ?? []), c]); }
    for (const [, group] of groups) {
      let chosen = null;
      for (const cand of group) {
        const hit = bestDay(cand);
        if (!hit) continue;
        const key = [researchRank(cand.poi), hit.r.score];
        if (!chosen || cmpKey(key, chosen.key) < 0) chosen = { cand, hit, key };
      }
      if (chosen) place(chosen.cand, chosen.hit.day, chosen.hit.r);
    }
    // 其餘：剩下的候選挑天
    for (const cand of order(pending().filter((c) => c.level === 'rest'))) {
      const hit = bestDay(cand);
      if (hit) place(cand, hit.day, hit.r);
    }
  };
  round();

  // ── 驗證：每天跑單日引擎（草案第三節：有警告只標出來、不自動砍；被引擎丟的才動）──
  // 丟的分配站那天不再試，再分一輪（丟掉的試別天、同品項換另一家、空出來的位子回填），再驗；最多 MAX_VERIFY_RUNS 趟，最後一趟丟的留候選池。骨架的站不動（只記 verify.skeletonDropped）。
  const moved = []; const swapped = []; const refilled = []; const verify = { dropped: [], skeletonDropped: [], runs: 0 };
  const pickList = (day) => [...day.skeleton, ...day.picks.map(({ level, why, slot, travelMin: t, movedFrom, ...pick }) => pick)];
  const buildTrip = () => ({ ...trip, days: trip.days.map((d, i) => ({ ...d, picks: pickList(days[i]) })) });
  const canVerify = options.verify !== false && rules != null;
  const nameOf = (id) => poiMap[id]?.name_zh ?? id;
  let finalResult = null;
  if (canVerify) {
    const byId = new Map(pool.map((c) => [c.poi.id, c]));
    const run = () => planTrip({ trip: buildTrip(), pois: poiMap, rules, settings, country, kb, legFn, restPool: [], brief: theBrief });
    /** 收一趟驗證結果：分配站被丟的拿掉、記在 dropped，回被丟的候選；骨架的站被丟只記 */
    const takeDrops = (result) => {
      const out = [];
      for (const x of result.days) {
        const day = days.find((d) => d.date === x.date);
        if (!day || !x.plan) continue;
        for (const dr of x.plan.dropped ?? []) {
          const cand = byId.get(dr.poi.id);
          const pick = day.picks.find((p) => p.poiId === dr.poi.id);
          if (!cand || !pick) {
            if (!verify.skeletonDropped.some((s) => s.date === x.date && s.poiId === dr.poi.id)) verify.skeletonDropped.push({ date: x.date, poiId: dr.poi.id, name: nameOf(dr.poi.id), reason: dr.reason });
            continue;
          }
          unplace(day, dr.poi.id);
          dropped.set(dr.poi.id, [...(dropped.get(dr.poi.id) ?? []), { date: x.date, reason: dr.reason }]);
          out.push({ cand, pick, date: x.date, reason: dr.reason });
        }
      }
      return out;
    };
    let result = run(); verify.runs = 1;
    for (;;) {
      const drops = takeDrops(result);
      if (!drops.length) break;
      if (verify.runs >= MAX_VERIFY_RUNS) {   // 最後一趟丟的留候選池
        for (const d of drops) verify.dropped.push({ date: d.date, poiId: d.cand.poi.id, name: nameOf(d.cand.poi.id), reason: d.reason, movedFrom: d.pick.movedFrom ?? null });
        break;
      }
      const before = new Set(placedAt.keys());
      const droppedItems = new Map();   // 品項 → 這趟被丟的那家（下一輪換成同品項另一家的記 swapped）
      for (const d of drops) if (d.cand.level === 4 && d.cand.poi.item) droppedItems.set(d.cand.poi.item, d);
      round();
      for (const [id, day] of placedAt) {
        if (before.has(id)) continue;
        const cand = byId.get(id);
        const last = dropped.get(id)?.at(-1);
        if (last) moved.push({ poiId: id, name: nameOf(id), from: last.date, to: day.date, reason: last.reason });
        else if (cand?.level === 4 && cand.poi.item && droppedItems.has(cand.poi.item)) {
          const d = droppedItems.get(cand.poi.item);
          swapped.push({ item: cand.poi.item, from: { poiId: d.cand.poi.id, name: nameOf(d.cand.poi.id), date: d.date }, to: { poiId: id, name: nameOf(id), date: day.date }, reason: d.reason });
        } else refilled.push({ poiId: id, name: nameOf(id), to: day.date });
      }
      result = run(); verify.runs += 1;
    }
    finalResult = result;
  }

  // ── 留在候選池的：理由在最後重算（分配當下記的，驗證搬動之後會失真——站數滿的那天後來空了、同品項的落點換了家）──
  placeReason.clear();
  const itemWhere = new Map();   // 品項 → 落在哪一天的哪家（骨架或分配到的）
  for (const d of days) for (const p of [...d.skeleton, ...d.picks]) { const poi = poiMap[p.poiId]; if (poi?.item && !itemWhere.has(poi.item)) itemWhere.set(poi.item, { date: d.date, name: nameOf(p.poiId) }); }
  const reasonFor = (cand) => {
    const drops = dropped.get(cand.poi.id) ?? [];
    const rec = placeReason.get(cand.poi.id);
    let other = null;
    if (rec) { let best = null; for (const [reason, n] of rec.counts) if (!best || n > best.n) best = { reason, n }; other = best.reason; }
    if (drops.length) return `${drops.map((d) => `${d.date} 排不進（${d.reason}）`).join('、')}${other ? `，別天也不合適（${other}）` : ''}`;
    return other ?? '沒有一天合適';
  };
  const unplaced = [];
  for (const cand of pool) {
    const p = cand.poi;
    if (placedAt.has(p.id)) continue;
    let reason;
    if (cand.level === 4 && p.item && itemWhere.has(p.item)) { const w = itemWhere.get(p.item); reason = `品項「${p.item}」落在 ${w.date} 的 ${w.name}`; }
    else {
      const hit = bestDay(cand);   // 只看不放：最後一趟驗證丟站空出的位子不再回填（驗證最多 MAX_VERIFY_RUNS 趟）
      reason = hit ? `驗證第 ${verify.runs} 趟後 ${hit.day.date} 空出位子（最多驗 ${MAX_VERIFY_RUNS} 趟，沒再分）` : reasonFor(cand);
    }
    unplaced.push({ poiId: p.id, name: p.name_zh ?? p.id, category: p.category, level: cand.level, reason });
  }

  // ── 重疊率（跟換掉前的 picks 比）──
  const originalAll = days.flatMap((d) => d.original.map((id) => ({ id, date: d.date })));
  const matched = originalAll.filter((o) => placedAt.has(o.id));
  const overlap = originalAll.length ? { original: originalAll.length, matched: matched.length, sameDay: matched.filter((o) => placedAt.get(o.id).date === o.date).length, rate: Math.round((matched.length / originalAll.length) * 100) / 100 } : null;

  // 分配後單日引擎還在警告的餐段／夜間站（分配器標的餐段、夜間站只是配額與意圖，引擎不保證排在那個時段；待確認要不要給引擎軟罰）
  const slotWarnings = (finalResult?.days ?? []).flatMap((x) => (x.plan?.warnings ?? []).filter((w) => (w.ruleId === 'meal-slots' || w.ruleId === 'night-slot') && !w.hint).map((w) => ({ date: x.date, msg: w.msg })));

  const count = (list) => list.reduce((m, x) => ((m[x] = (m[x] ?? 0) + 1), m), {});
  const report = {
    pool: { packed: poiList.length, eligible: pool.length, skeleton: days.reduce((n, d) => n + d.skeleton.length, 0), byLevel: count(pool.map((c) => c.level)) },
    days: days.map((d) => ({
      date: d.date, type: d.type, dayTrip: d.dayTrip, anchorName: d.anchorPoi?.name_zh ?? null, regionZones: d.region, nightZones: d.nightZones, target: d.target, max: d.max,
      window: { startMin: d.win.startMin, endMin: d.win.endMin }, free: d.free,
      counts: { skeleton: d.skeleton.length, ...count(d.picks.map((p) => p.level)), total: d.stops },
      picks: [
        ...d.skeleton.map((p) => ({ poiId: p.poiId, name: nameOf(p.poiId), category: poiMap[p.poiId]?.category ?? null, level: 'skeleton', priority: p.priority ?? 'want', errand: Boolean(p.errand), fixedWindow: Boolean(p.fixedWindow), travelMin: null, slot: null, why: null, movedFrom: null })),
        ...d.picks.map((p) => ({ poiId: p.poiId, name: nameOf(p.poiId), category: poiMap[p.poiId]?.category ?? null, level: p.level, priority: p.priority, errand: Boolean(p.errand), fixedWindow: false, travelMin: p.travelMin ?? null, slot: p.slot ?? null, why: p.why ?? null, movedFrom: p.movedFrom ?? null })),
      ],
    })),
    unplaced, moved, swapped, refilled, verify, slotWarnings, overlap, briefUnmatched, warnings: [...warnings, ...(finalResult?.warnings ?? [])],
    verified: Boolean(canVerify),
  };
  return { days: days.map((d) => ({ date: d.date, picks: pickList(d) })), unplaced, report };
}
