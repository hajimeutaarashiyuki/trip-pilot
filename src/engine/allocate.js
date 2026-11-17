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
//    研究判可略過的不拿（知識庫欄位 researchSkip；researchSaysSkip）；不是一個地點的條目不拿（知識庫欄位 notAStop，研究拿兩家比較的摘要那種；comparisonEntry）——
//    這兩條與下面的研究註記 11-06 從店名括號搬成知識庫欄位（原話 #191 其餘照預設；欄位規格在 data/schema.js RESEARCH_FIELDS），讀法在 rules/_helpers.js：
//    有欄位照欄位，整個欄位沒有才退回店名字樣（「可略過」「不可指望」、店名寫「A vs B」、「首選」「備案／保底／備援」）——別的城市的知識庫可能還沒欄位化；
//    任何一天按過「不去了」的不拿。
//    活動（event）綁日期、哪天去是骨架的事（草案第一節：有時限的優先當主行程），只在主行程也是活動的那天分（縁日攤位跟著花火；推導——知識庫的活動營業時間常解析成七天都開，自由分會把 8/16 的流灯会放到 8/15）。
// 3. 層級（profile §2.2）：② 需求單點名（每個人的 go.designated、mustEat 對得上店名；寫的是店型「神社」「古著店」不算，店型對照表裡的品牌字「Yodobashi」「三越」算點名）
//    → ③ 六星（my.rating 6）與有憑據的意義類（significance 且 significanceSource；只有店家自述的不拿豁免，DESIGN §4）
//    → ④ 品項落點（item 有值、或需求單要買的對得上 item／items[]）→ 其餘。骨架的主行程與指定站不是候選、不分配。
// 4. 逐層分配（②→③→④→其餘）：每個候選對每一天算適合度、分到最合適的那天（草案第二節）——
//    硬條件：那天有開（營業時間落在時窗內、而且落在固定時段釘住以外的空檔；沒營業時間資料視為有開，規則 hours 自己跳過）→ 在當日區域（regionZonesFor）→ 同行者不去的店型不拿（T19）→ 購物類只在購物日（代購品項順路買不受限）；
//    配額：非主題日 SAME_TYPE_CATEGORIES 各 ≤ settings.sameTypeMaxPerDay、每天午餐／晚餐各一家吃的（country.mealSlots）、夜間站一家（country.nightSlot）、同一家整趟一次、同一品項整趟一個落點、一天最多 allocItemMaxPerDay 個品項落點；
//    研究註記（researchRank；知識庫欄位 researchRank 'first'｜'backup'）：吃的站標備案的不主動排當一餐（原話 #6、#13 沒興趣的善治郎正是研究標「保底備案」的那家；
//    profile §5.1 要知識庫標 unlockWhen 擋它，仙台包 11-06 標了——善治郎站前本店與「利久 vs 善治郎」兩筆，連池都不進）；品項落點與餐段挑店首選先、備案後；
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
// 7. 11-06 他的兩句話落地（原話 #189、#190；規則那邊同一天改，算法共用 rules/_slots.js）：
//    餐段放寬（#189「晚餐提早或延後 都可以」）：「這家店能不能當午餐／晚餐」＝它是那一餐有開的店（原本的餐段裡開著），而且餐段前後各放寬 settings.mealGraceMin 之後的時窗裡、
//    固定時段釘住以外有它開著的空檔（mealSlotFor；slotsOf 的 win 就是規則 meal-slots 算一餐用的同一個時窗）——主行程佔住餐段那天，開演前、散場後吃得到的店也能當那一餐；
//    「這天有沒有這一餐」與「被固定時段蓋住」照舊看原本的餐段。草案待確認第 6 條的「分配器標了晚餐就要落在晚餐時段」的軟罰不做（#189「這點不強制」）。
//    一日遊的夜間站（#190「可以是在當地進行 只要趕的上末班車都可以 或是回程不算晚(9:00)也可以排進來」；草案待確認第 5 條收掉）：
//    當地的（在當日區域、照引擎的判斷回住宿要搭車）要查得到回程的末班車、而且夜間時段到末班車之前開得夠久才排（judge 的 localNight）；
//    市區的（據點圈）只在估計回到市區不晚於 settings.dayTripNightReturnByHM 時給（每天狀態的 backMin／nightHome；估計只算骨架、是下界），
//    排出來其實晚回城的由驗證收回（takeDrops 看單日引擎掛的提示 day-trip-night）。兩個都不成立那晚沒有夜間站，規則 night-slot 也不罰。
// 8. 11-06 第二批（上一批審查留下的四件）：
//    點名的不看偏好的門（總則 3，原話 #21「雖然意願很低但也不應該硬排除」：沒有硬排除清單、需求單點名的一律排）：需求單點名（②）對到的店就算是挖寶型（curated:false）、
//    還沒解鎖（unlockWhen）、研究判可略過（researchSkip）、他評過 ≤2 星、落選兩次，照點名那一層排（NAMED_BYPASS；後兩道是推導——同樣是「不主動排」的門，仙台包還沒有這兩種資料），研究標備案的吃的站被點名也照排當一餐；
//    理由欄寫明是哪一道門被點名蓋過。之前這種店靜靜不排、報告的三個清單都看不到（JAM、Second Street、善治郎）。
//    真的排不了的（不是一個地點的條目 notAStop、交通／會場／一日遊摘要、他自己按過「不去了」）不排，列進 report.briefUnmatched 並講原因（坐下來的地方原本也在這裡，11-11 改成點名照排，見 10）。
//    一日遊的晚餐（#189 後半「晚餐地點在主行程去程回程順路或是周邊的地點都可以」）：據點步行圈的吃的店也可以當那天的晚餐（回程的終點）——比照市區夜間站，
//    估計回到市區不晚於 settings.dayTripNightReturnByHM，而且回到之後、放寬後的晚餐時窗裡它還開著才給（judge 的 townDinner）；只當晚餐、不當午餐。
//    主行程那一區與路上的店照舊，而且先挑（回市區的店離主行程的分鐘＝回程的車＋從住宿走過去）。
//    末班車：單日引擎不再丟他勾的站（規則 last-train 只擋引擎插的），改成照排、那一站掛提示 last-train——分配器自己分進去的看到這條就收回、那天不再試（留池理由就是那一句）；
//    需求單點名的與旅程檔原本就有的（骨架）不收。末班分日別（zones.json 的 last 寫 { weekday, saturday, holiday }）：當地夜間站查末班時帶那天的日別（geo/matrix.js serviceDayOf）。
// 9. 11-06 第二批（原話 #195「早中晚餐的換一間 應該要推薦對應餐廳吧…」）：「這家店能不能當午餐／晚餐」接到全引擎共用的 rules/_slots.js servesMeal——
//    知識庫欄位 meals（研究標的，哪一餐、怎麼個能法）優先，沒有欄位才照店型推導（derive/meals.json：food 甜點除外＝午餐晚餐）。改的只有三處：isMeal（這家店算不算一餐的候選）、
//    mealSlotFor（能佔哪一餐：只標午餐的不會被分成晚餐、只供早餐的不會被分成午餐）、骨架裡吃的站佔哪一餐。沒有 meals 欄位的知識庫，分配結果跟之前一樣（推導出來的就是原本的判法）。
//    店型那一條沒動：分配器還是只把 food 當「一餐」分，咖啡廳走同類配額、酒吧走夜間站。早餐不在這裡分（每天預設的早餐是另一段的事）。
// 10. 11-11（主控對上一批待確認的裁定；總則 3 點名的一律排）：需求單點名「坐下來的地方」（spot：海邊、公園、展望台）照點名那一層（②）排，不再列進對不上——
//    NAMED_CATEGORY_BYPASS。沒被點名的照舊不進池（引擎每天自己當 optional 候選）；交通、會場、一日遊摘要點名也不排、照舊進 report.briefUnmatched。
import { planTrip, dayWindow, airportTransitMin, resolveHome, shoppingDaysOf, themeCategoryOf, fixedWindowOf, fixedSpanMin } from './trip.js';
import { openIntervals, minToHm } from './time.js';
import { serviceDayOf } from '../geo/matrix.js';   // 那天跑哪一種時刻表（末班分日別）
import { SAME_TYPE_CATEGORIES, SAME_TYPE_NAMES, SHOPPING_CATEGORIES, researchSaysSkip, researchRank, notAStop } from '../rules/_helpers.js';   // 後三個＝研究註記的讀法（知識庫欄位優先、沒欄位退回店名字樣）
import { mealSlotsOf, coversMealSlot, nightWindowOf, dayTripReturnByMin, servesMeal } from '../rules/_slots.js';   // 餐段（含放寬，原話 #189）、夜間時段、一日遊回程（原話 #190）、這家店能當哪一餐（原話 #195）：跟規則同一把尺
import { personsOf, presentOn, mergeAdjustments, personAvoids, cityNamesOf } from './persons.js';
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
/** 吃的站（餐段配額看的店型）：分配器只拿 food 當「吃的」——咖啡廳走同類配額、酒吧走夜間站（推導）。規則 rules/meal-slots.js 不分店型、看那家店能不能當那一餐（rules/_slots.js servesMeal）；下面的 isMeal 用同一把尺、再加店型這一條 */
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
/**
 * 分配器當「一餐」分的店：吃的類（food），而且那家店能當午餐或晚餐——能不能當哪一餐問 rules/_slots.js servesMeal（11-06 第二批；原話 #195），跟規則 meal-slots、換一家同一把尺：
 * 知識庫欄位 meals 優先（只標早餐的店、標 {} 的車站商場與甜點攤都不是一餐）；沒有欄位才照店型推導（derive/meals.json：恢復站、店型對照表「甜點」對到的除外——
 * ずんだ茶寮那種甜點攤可以當一站、不佔餐段。10-16 這條判法原本寫在這裡，搬去推導表共用）。
 * 店型還是只拿 food：咖啡廳走同類配額、酒吧走夜間站（推導；知識庫標了能當午餐的咖啡廳、酒場型的居酒屋不會被分配器分成一餐——分了的話它們就得佔一個餐段才排得進）。
 * 哪一餐由 mealSlotFor 逐餐問（只供午餐的朝市不會被分成晚餐）。
 */
const isMeal = (p) => p.category === MEAL_CATEGORY && (servesMeal(p, 'lunch') !== false || servesMeal(p, 'dinner') !== false);
/** 留在候選池的理由分幾關（數字越大越接近排進去；報告記它走到最遠的那一關）：沒開／沒空檔 → 區域 → 活動／同行者／購物日 → 配額 → 站數 */
const STAGE = Object.freeze({ open: 0, region: 1, limit: 2, quota: 3, stops: 4 });

const num = (v, d) => (Number.isFinite(v) ? v : d);
const setting = (settings, key) => num(settings?.[key], ALLOC_DEFAULTS[key]);
const cmpNum = (a, b) => (a === b ? 0 : a < b ? -1 : 1);   // Infinity − Infinity 是 NaN，不能用減法比
/** 陣列鍵逐項比（數字或字串），全同回 0 */
const cmpKey = (a, b) => { for (let i = 0; i < a.length; i++) { const c = typeof a[i] === 'string' ? a[i].localeCompare(b[i]) : cmpNum(a[i], b[i]); if (c) return c; } return 0; };
const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, '');

// 研究註記三個讀法（先讀知識庫欄位 researchSkip／researchRank／notAStop，整個欄位沒有才退回店名字樣）搬到 rules/_helpers.js：引擎插站的門（trip.js engineMayInsert）也讀同一套。
// 這裡照舊的名字轉出（測試與報告用）：
// - researchSaysSkip：研究判可略過（「查證結果：未見 DKNY，可略過」那種）——不進池；
// - researchRank：0 首選先挑、1 沒標、2 備案後挑。仙台包 11-06 標的：first＝伊達的牛舌本舖 本店、松本清 Clis Road、唐吉訶德 西口本店（DKNY）、Art Sports；
//   backup＝たんや善治郎 仙台站前本店、大國藥妝 Clis Road、Yodobashi 仙台（東口，DKNY）、仙台機場免稅店 VEGA、XEBIO 泉中央；
// - comparisonEntry：不是一個地點的條目（notAStop；仙台包「利久 vs 善治郎（站內牛舌通比較吃）」那種研究拿兩家比較的摘要，跟一日遊複合條目同理，推導）——不進池。
export { researchSaysSkip, researchRank, notAStop as comparisonEntry };

/**
 * 候選池的門，一家店卡在哪幾道（鍵的陣列；空陣列＝過門）：
 * 'category' 分配器不拿的店型（NO_ALLOC_CATEGORIES）、'notAStop' 不是一個地點的條目——這兩道是「排不了」；
 * 'curated' 挖寶型（curated:false）、'rating' 他評過 ≤2 星、'losses' 落選兩次、'unlock' 還沒解鎖（unlockWhen）、'skip' 研究判可略過——這五道是「不主動排」（跟 trip.js engineMayInsert 同一批，item 不扣）。
 */
export function poolGatesOf(p) {
  const out = [];
  if (!p) return out;
  if (NO_ALLOC_CATEGORIES.has(p.category)) out.push('category');
  if (p.curated === false) out.push('curated');
  if (Number.isFinite(p.my?.rating) && p.my.rating <= 2) out.push('rating');
  if ((p.poolLosses ?? 0) >= 2) out.push('losses');
  if (p.unlockWhen) out.push('unlock');
  if (researchSaysSkip(p)) out.push('skip');
  if (notAStop(p)) out.push('notAStop');
  return out;
}

/**
 * 候選池的門：知識庫裡本來就不主動排的不拿（跟 trip.js engineMayInsert 同四條，item 不扣）、分配器不拿的店型不拿、研究判可略過的不拿、不是一個地點的條目不拿。
 * 需求單點名的店另有放行（NAMED_BYPASS，allocateTrip 裡判）；這裡是沒被點名的店的門。
 */
export function poolEligible(p) {
  return Boolean(p?.id) && poolGatesOf(p).length === 0;
}

/**
 * 需求單點名的店不看的門：「不主動排」的那五道（總則 3：沒有硬排除清單、點名的一律排）。主控 11-06 定的是挖寶型、未解鎖、研究判可略過三道（上一批實測靜靜不排的 JAM、Second Street、善治郎）；
 * ≤2 星與落選兩次同屬「不主動排」（profile §7 星等表、原話 #89），一併放行——推導，仙台包還沒有這兩種資料。'category' 與 'notAStop' 是排不了，點名也不排、進 report.briefUnmatched——
 * 'category' 裡只有坐下來的地方例外（NAMED_CATEGORY_BYPASS）。
 */
export const NAMED_BYPASS = new Set(['curated', 'unlock', 'skip', 'rating', 'losses']);
/**
 * 分配器不拿的店型（NO_ALLOC_CATEGORIES）裡，需求單點名就照點名那一層排的：坐下來的地方（spot：海邊、公園、展望台）。主控 11-11 定（總則 3：點名的一律排）。
 * 它不進池的理由只是「引擎每天自己當 optional 候選，分了會重複」，是一個真的地點、排得了：點名排進 picks 之後它就是他勾的站，單日引擎不會再把同一家當坐下來的候選加一次
 * （engine/trip.js 的 exclude 含任何一天勾過的站）。交通、會場、一日遊摘要不是可以這樣排的一站，點名也不排、照舊進 report.briefUnmatched。
 */
export const NAMED_CATEGORY_BYPASS = new Set(['spot']);
/** 這道門，點名蓋不蓋得過：「不主動排」的五道蓋得過；店型那一道只有坐下來的地方蓋得過。 */
const namedBypasses = (gate, p) => NAMED_BYPASS.has(gate) || (gate === 'category' && NAMED_CATEGORY_BYPASS.has(p?.category));

/** 每道門的人話（報告用：點名蓋過的門寫在那一站的理由欄、點名卻排不了的寫在「對不上」清單）。 */
const GATE_TEXT = Object.freeze({
  curated: '挖寶型的店', rating: '你評過 2 星以下', losses: '落選過兩次', unlock: '還沒到解鎖條件', skip: '研究判這趟可略過',
  notAStop: '是比較或彙整的條目，不是一個可以排的地點',
  removed: '你按過「不去了」',
});
const CATEGORY_GATE_TEXT = Object.freeze({ logistics: '是交通或資訊的條目，不是一站', venue: '是會場，那天有固定時段才排', daytrip: '是一日遊的摘要條目，不是一個地點', spot: '是坐下來的地方，引擎每天視情況自己排' });
/** 點名蓋過店型那一道門時寫在理由欄的字（「需求單點名「X」（坐下來的地方，點名照排）」）；上面那張表是排不了時寫在「對不上」的字。 */
const CATEGORY_BYPASS_TEXT = Object.freeze({ spot: '坐下來的地方' });
const gateText = (gate, p) => (gate === 'category' ? CATEGORY_GATE_TEXT[p?.category] ?? '是分配器不分的站型' : GATE_TEXT[gate] ?? gate);
const bypassText = (gate, p) => (gate === 'category' ? CATEGORY_BYPASS_TEXT[p?.category] ?? gateText(gate, p) : gateText(gate, p));

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
 * - 一日遊：只拿主行程那一區與路上（錨點圈 ∪ 走廊，不含據點圈；原話 #11 一日遊是出城；草案「一日遊當天只放那個方向的站」）；晚上回城的夜間站另給 nightZones＝據點步行圈
 *   （原話 #190「回程不算晚(9:00)也可以排進來」；這裡只回據點圈是哪幾區，要不要給由 allocateTrip 看估計的回城時刻決定——每天狀態的 nightHome）；
 *   回城後的晚餐也從同一圈拿（原話 #189 後半；allocateTrip 的 judge，檔頭 8）
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

/**
 * 國家層的餐段與夜間時段（分鐘；算法在 rules/_slots.js，跟規則 meal-slots、night-slot 同一把尺）；缺或壞回 null（那一條配額就不算時段、只數家數）。
 * lunch／dinner＝原本的餐段：這天要不要這一餐（餐段落不落在當天時窗內）、被固定時段蓋住看它；
 * win.lunch／win.dinner＝前後各放寬 settings.mealGraceMin 之後的時窗：「這家店這一餐開不開」看它（原話 #189 晚餐提早或延後都可以；11-06）。
 */
function slotsOf(country, settings) {
  const out = { lunch: null, dinner: null, night: nightWindowOf(country), win: { lunch: null, dinner: null } };
  for (const m of mealSlotsOf(country, settings)) {
    if (m.slot !== 'lunch' && m.slot !== 'dinner') continue;
    out[m.slot] = m.core; out.win[m.slot] = m.window;
  }
  return out;
}

/** 骨架的 pick 蓋住了這個餐段嗎（rules/_slots.js coversMealSlot，跟 rules/meal-slots.js 同一條：固定時段的站從餐段開始前就在進行、到餐段過半還沒散＝大會供餐）。 */
function coveredByFixed(fw, slot, dwellMin) {
  if (!fw || !slot) return false;
  const start = fw.startMin - (fw.arriveEarlyMin ?? 0);
  const end = Number.isFinite(fw.endMin) ? fw.endMin + (fw.afterMin ?? 0) : fw.startMin + (dwellMin ?? 0);
  return coversMealSlot(start, end, slot);
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
  const slots = slotsOf(country, settings);
  const returnBy = dayTripReturnByMin(settings);   // 一日遊回到市區不晚於這個時刻才主動排市區的夜間站（原話 #190；settings.dayTripNightReturnByHM，21:00）
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
    // 一日遊的夜間站（原話 #190；11-06）：回城的據點圈只在「估計回到市區不晚於 returnBy」時給。
    // 估計＝骨架裡外地的站（不在據點圈）最早走得完的時刻＋回程的分鐘（離主行程的移動分鐘，去回同值）：固定時段的看它在引擎時間軸上的結束
    // （只釘開始＝卡位時刻＋停留；釘起訖＝散場＋散場緩衝），其餘的從時窗起點＋去程＋停留往後疊，兩者取晚的。只算骨架，所以是下界：
    // 它都晚於 returnBy 就確定不給；估得太早、排出來其實晚回城的，由單日引擎驗證收（takeDrops 看引擎掛的提示 day-trip-night）。骨架沒有外地站＝不知道，當回得來。
    const homeCircle = region.nightZones;   // 一日遊才有（regionZonesFor）；其他日型 null
    let backMin = null;
    if (homeCircle) {
      const there = travelMin(legFn, home, anchorPoi);
      let walked = win.startMin + there; let fixedEnd = -Infinity; let any = false;
      for (const p of skeleton) {
        const poi = poiMap[p.poiId];
        if (!poi || homeCircle.includes(poi.zoneId)) continue;
        any = true;
        const fw = fixedWindowOf(p.fixedWindow, settings);
        const dwell = p.dwellMin ?? poi.dwellMin ?? 60;
        if (fw) fixedEnd = Math.max(fixedEnd, Number.isFinite(fw.endMin) ? fw.endMin + (fw.afterMin ?? 0) : fw.startMin - (fw.arriveEarlyMin ?? 0) + dwell);
        else walked += dwell;
      }
      if (any) backMin = Math.max(walked, fixedEnd) + there;
    }
    const nightHome = backMin == null || backMin <= returnBy;
    const state = {
      date: d.date, index, type, dayTrip: Boolean(d.dayTrip), home, anchorPoi, ref: anchorPoi ?? home, win, free, region: region.zones,
      nightZones: homeCircle ? (nightHome ? homeCircle : []) : null, homeCircle, backMin, nightHome,
      serviceDay: serviceDayOf(d.date, country),   // 那天跑哪一種時刻表（末班分日別時查哪一班；localNight）
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
      // 骨架裡吃的站先佔餐段（午餐優先；沒有國家層餐段時只數家數，judge 用 cat 看）；它是哪一餐的店：那家店能當那一餐（servesMeal）、而且原本的餐段裡有開
      if (isMeal(poi)) {
        const takes = (k) => Boolean(slots[k]) && !state[k] && servesMeal(poi, k) !== false && openWithin(poi, d.date, slots[k][0], slots[k][1], 20) !== false;
        if (takes('lunch')) state.lunch = true;
        else if (takes('dinner')) state.dinner = true;
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
  // 需求單點名的店名也對到品項研究站（「Yodobashi 仙台（東口）」那種「在 X 買 Y」的條目）時：同一個名字有不是品項站的店對得上，就只算那家是點名、品項站照④——
  // 不然「Yodobashi」一句會把 Yodobashi Camera、Art Sports Yodobashi 店、Yodobashi 仙台（東口，DKNY 的備案落點）三條都升成②（10-16 審查後實測）；只有品項站對得上的（點名「Art Sports」）照②
  const placeMatched = new Set(targets.go.filter((t) => !isCategoryRequest(t) && poiList.some((p) => !p.item && briefTextMatches(p, t))));
  const targetsFor = (p) => (p.item && placeMatched.size ? { ...targets, go: targets.go.filter((t) => !placeMatched.has(t)) } : targets);
  // 過門：沒被點名的照 poolEligible；需求單點名的（②）不看「不主動排」的那幾道門（NAMED_BYPASS；檔頭 8），坐下來的地方被點名也照排（NAMED_CATEGORY_BYPASS；檔頭 10），
  // 理由欄寫明哪一道被點名蓋過。點名卻排不了的（不是一個地點、交通／會場／一日遊摘要、他按過「不去了」）記在 blocked，下面進 briefUnmatched。
  const pool = []; const blocked = new Map();   // blocked：poiId → 真的擋住它的那幾道門（含 'removed'；被點名的店不列點名蓋得過的那幾道）
  for (const p of poiList) {
    if (!p.id || usedIds.has(p.id)) continue;
    const lv = levelOf(p, targetsFor(p));
    const gates = [...(removed.has(p.id) ? ['removed'] : []), ...poolGatesOf(p)];
    if (!gates.length) { pool.push({ poi: p, ...lv }); continue; }
    const named = lv.level === 2;
    if (named && gates.every((g) => namedBypasses(g, p))) { pool.push({ poi: p, ...lv, why: `${lv.why}（${gates.map((g) => bypassText(g, p)).join('、')}，點名照排）`, bypassed: gates }); continue; }
    blocked.set(p.id, named ? gates.filter((g) => !namedBypasses(g, p)) : gates);
  }
  // 需求單對不上的：寫的是店型（研究來分）、知識庫裡沒有這家、或對到的每一筆都排不了（講是哪一筆、為什麼）。
  // 對到的店只要有一筆在骨架或候選池裡就算有著落（排進去的在各天、沒排進去的在「留在候選池」帶理由），不列。
  const inPool = new Set(pool.map((c) => c.poi.id));
  const briefUnmatched = [];
  for (const t of targets.go) {
    if (isCategoryRequest(t)) { briefUnmatched.push({ text: t, reason: '寫的是店型，研究來分' }); continue; }
    const hits = poiList.filter((p) => briefTextMatches(p, t));
    if (!hits.length) { briefUnmatched.push({ text: t, reason: '候選池裡沒有這家' }); continue; }
    if (hits.some((p) => usedIds.has(p.id) || inPool.has(p.id))) continue;
    const why = hits.filter((p) => blocked.has(p.id)).map((p) => `對到「${p.name_zh ?? p.id}」，${blocked.get(p.id).map((g) => gateText(g, p)).join('、')}`);
    briefUnmatched.push({ text: t, reason: why.length ? `${why.join('；')}，沒排` : '候選池裡沒有這家', poiIds: hits.map((p) => p.id) });
  }
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

  /**
   * 吃的站這一天能佔哪個餐段：want 給了只看那一段；沒給午餐優先。回 'lunch'／'dinner'／null。四個條件（餐段的數字與「能當哪一餐」都來自 rules/_slots.js，跟規則 meal-slots 同一把尺）：
   * 那家店能當這一餐（servesMeal：知識庫欄位 meals 優先、沒有才照店型推導——只標了午餐的店不會被分成晚餐、只供早餐的不會被分成午餐；原話 #195，11-06 第二批）；
   * 這天有這一餐（原本的餐段落在當天時窗內）；它是這一餐有開的店（原本的餐段裡開著 ≥20 分——只開到 17:00 的朝市不是晚餐的店）；
   * 放寬後的時窗裡、固定時段釘住以外的空檔有它開著的 ≥20 分（slots.win；原話 #189「有主行程要跑 但時間落在晚餐時段 那晚餐提早或延後 都可以」——
   * 主行程佔住餐段那天，開演前或散場後吃得到的店也算）。沒被釘住的日子後兩條合起來就是「餐段裡有開」，跟放寬前一樣。
   */
  const mealSlotFor = (p, day, want = null, notBefore = null) => {
    // notBefore：這家店最早幾分才吃得到（一日遊回到市區才吃的店＝估計回城的時刻）；放寬後的時窗從它之後算
    const can = (k) => Boolean(slots[k]) && !day[k] && servesMeal(p, k) !== false && slots[k][0] < day.win.endMin && slots[k][1] > day.win.startMin
      && openWithin(p, day.date, slots[k][0], Math.min(slots[k][1], day.win.endMin), 20) !== false
      && openInFree(p, day, Math.max(slots.win[k][0], notBefore ?? -Infinity), Math.min(slots.win[k][1], day.win.endMin), 20) !== false;
    if (want) return can(want) ? want : null;
    return can('lunch') ? 'lunch' : can('dinner') ? 'dinner' : null;
  };

  /** 留池理由：一日遊估計回到市區已晚、或排出來真的晚回城（單日引擎掛了提示 day-trip-night），市區的夜間站不主動排（原話 #190）；回市區才吃的晚餐同一條（吃的站落在夜間時段也是夜間站）。 */
  const lateReturnReason = `一日遊回到市區已經晚於 ${minToHm(returnBy)}，不主動排市區的夜間站`;
  const lateReturnReasonFor = (p) => (p?.category === NIGHT_CATEGORY ? lateReturnReason : `一日遊回到市區已經晚於 ${minToHm(returnBy)}，不主動排回市區才吃的晚餐`);
  /**
   * 一日遊當地的夜間站趕不趕得上末班車（原話 #190；11-06）：照引擎的判斷從這家店回住宿要搭車（geo/matrix.js legFn.rideLink）才算當地；
   * 回程那條路查得到末班（知識庫 zones.json 連結的 last）才排——查不到的不主動排（規則 last-train 對他自己勾的站是「沒資料不判」，分配器比較保守）。
   * 回 { ok, leaveByMin?（最晚幾分要離開）, reason? }；走得回住宿的店不算外地（leaveByMin null，不設限）。
   */
  const localNight = (p, day) => {
    const link = typeof legFn.rideLink === 'function' ? legFn.rideLink(p, day.home, day.serviceDay) : undefined;
    if (link === null) return { ok: true, leaveByMin: null };
    if (!link?.last) return { ok: false, reason: '當地的夜間站要查得到回程的末班車才排' };
    return { ok: true, leaveByMin: link.last.leaveByMin };
  };

  /** 這個候選對這一天：過了硬條件與配額回 { ok: true, slot, travel, score }；不行回 { ok: false, stage, reason }。want 是餐段挑店時指定的那一段。 */
  const judge = (cand, day, want = null) => {
    const p = cand.poi;
    const need = Math.min(p.dwellMin ?? 60, 30);
    if (openWithin(p, day.date, day.win.startMin, day.win.endMin, need) === false) return { ok: false, stage: STAGE.open, reason: '那天沒開' };
    if (openInFree(p, day, day.win.startMin, day.win.endMin, need) === false) return { ok: false, stage: STAGE.open, reason: '固定時段以外沒有它開著的空檔' };
    const isNightCand = p.category === NIGHT_CATEGORY;
    // 一日遊那天、據點步行圈裡（不在當日區域）的店：酒吧可以當回城後的夜間站（原話 #190）；吃的可以當回城後的晚餐（原話 #189 後半
    // 「晚餐地點在主行程去程回程順路或是周邊的地點都可以」——回程的終點也是回程順路；要有國家層的晚餐段才有「晚餐」可言）。兩種都要估計回得不晚（day.nightHome）才給。
    // 晚餐的門檻跟夜間站用同一個（dayTripNightReturnByHM 21:00），不用晚餐放寬後的時窗尾端（21:30）：11-06 兩種都跑過——用時窗尾端的話七天包 8/16（估計 21:03 回到市區）
    // 會多一家 21:15 的晚餐，但它先佔掉一日遊上限 6 站的一格，國寶瑞巌寺被擠到別天、流灯会之前空等 314 分，跟他手排那版同一天的重疊從 12 家掉到 10 家；
    // 而且回城晚於 21:00 才吃的那一站本來就會被單日引擎掛晚回城的提示、驗證時收回（下面 takeDrops）。
    const homeOnly = Boolean(day.homeCircle?.includes(p.zoneId)) && !day.region.includes(p.zoneId);
    const townDinner = homeOnly && Boolean(slots.dinner) && isMeal(p) && servesMeal(p, 'dinner') !== false;   // 回到市區才吃的只當晚餐：那家店要能當晚餐（只供午餐的不算）
    const inRegion = day.region.includes(p.zoneId) || (isNightCand && Array.isArray(day.nightZones) && day.nightZones.includes(p.zoneId)) || (townDinner && day.nightHome);
    // 一日遊估計回到市區已經晚於 returnBy：市區（據點圈）的夜間站、回市區才吃的晚餐不主動排（原話 #190）
    if (!inRegion && (isNightCand || townDinner) && homeOnly && !day.nightHome) return { ok: false, stage: STAGE.quota, reason: lateReturnReasonFor(p) };
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
    let note = null;   // 這一站排進去時補在理由欄的一句（回市區才吃的晚餐）
    if (isMeal(p)) {
      // 研究標備案的吃的站不主動排當一餐；需求單點名的照排（總則 3：點名不是「主動」）
      if (researchRank(p) === 2 && cand.level !== 2) return { ok: false, stage: STAGE.quota, reason: '研究標備案／保底的吃的站不主動排當一餐' };
      if (townDinner) {
        // 回到市區才吃：只當晚餐（午餐人還在外地），而且估計回到市區之後、放寬後的晚餐時窗裡它還開著 ≥20 分（估計只算骨架、是下界；排出來其實晚回城的由驗證收，takeDrops）
        if (want === 'lunch') return { ok: false, stage: STAGE.quota, reason: '一日遊那天據點附近的店只當晚餐（回到市區才吃）' };
        slot = mealSlotFor(p, day, 'dinner', day.backMin);
        if (!slot) return { ok: false, stage: STAGE.quota, reason: day.dinner ? '晚餐有了（一日遊那天據點附近的店只當晚餐）' : `一日遊回到市區才吃的晚餐：${day.backMin != null ? `估計 ${minToHm(day.backMin)} 回到市區，` : ''}晚餐時段它沒開或來不及` };
        note = `一日遊回到市區才吃，離住宿 ${travelMin(legFn, day.home, p)} 分`;
      } else if (slots.lunch || slots.dinner) {
        slot = mealSlotFor(p, day, want);
        if (!slot) return { ok: false, stage: STAGE.quota, reason: day.lunch && day.dinner ? '午餐、晚餐都有了' : '餐段對不上（已有的那餐佔了、另一餐它沒開或時窗外）' };
      } else if ((day.cat[MEAL_CATEGORY] ?? 0) >= 2) return { ok: false, stage: STAGE.quota, reason: '吃的一天 2 家滿了（沒有國家層餐段）' };
    } else if (want && want !== 'night') return { ok: false, stage: STAGE.quota, reason: '不是吃的站' };
    if (isNightCand) {
      if (day.nightOff) return { ok: false, stage: STAGE.quota, reason: NO_NIGHT_TYPES.has(day.type) ? '離境日、城際移動日晚上沒有夜間站' : '那晚不排夜間站（早起日前一晚、或同行者不要）' };
      let nightEnd = slots.night ? Math.min(slots.night[1], day.win.raw?.endMin ?? day.win.endMin) : null;
      // 一日遊當地的夜間站（原話 #190「可以是在當地進行 只要趕的上末班車都可以」）：回程查得到末班車、而且夜間時段到末班車之前它開得夠久才排。
      // 這兩條先判（在「夜間站有了」之前）：那一天再怎麼樣都排不進的理由先講。當地＝在當日區域、不在據點圈（沒寫主行程的一日遊退回據點圈，沒有當地可言）
      const local = day.homeCircle && day.region.includes(p.zoneId) && !day.homeCircle.includes(p.zoneId) ? localNight(p, day) : null;
      if (local && !local.ok) return { ok: false, stage: STAGE.quota, reason: local.reason };
      if (local?.leaveByMin != null && nightEnd != null) {
        nightEnd = Math.min(nightEnd, local.leaveByMin);
        if (openInFree(p, day, slots.night[0], nightEnd, 30) === false) return { ok: false, stage: STAGE.quota, reason: `當地的夜間站：夜間時段到末班車之前（最晚 ${minToHm(local.leaveByMin)} 要走）它開不夠久` };
      }
      if (day.night) return { ok: false, stage: STAGE.quota, reason: '夜間站有了' };
      if (slots.night && openInFree(p, day, slots.night[0], nightEnd, 30) === false) return { ok: false, stage: STAGE.quota, reason: '夜間時段沒開（或被固定時段釘住）' };
      slot = 'night';
    } else if (want === 'night') return { ok: false, stage: STAGE.quota, reason: '不是夜間站' };
    if (isItem) {
      if (p.item && usedItems.has(p.item)) return { ok: false, stage: STAGE.quota, reason: `品項「${p.item}」已有落點` };
      if (day.items >= setting(settings, 'allocItemMaxPerDay')) return { ok: false, stage: STAGE.quota, reason: `品項落點一天 ${setting(settings, 'allocItemMaxPerDay')} 個滿了` };
    }
    if (day.stops >= day.max) return { ok: false, stage: STAGE.stops, reason: `站數滿（上限 ${day.max}）` };
    // 離主行程多遠：回市區才吃的店＝回程的車（主行程→住宿）＋從住宿走過去。這樣算，主行程那一區與路上的店自然先挑（照舊），回市區的幾家再照離住宿的遠近排。
    // 11-06 三種算法在三個打包檔（新舊各三包）實跑比過：直接查「主行程→那家店」的話同一區的店同分，七天包 8/14 挑到車站大樓的美食街、單日引擎把它排在出發前的早上；
    // 只算離住宿多遠的話回市區的店跟當地的店搶，試走包 8/15 原本回程路上的鹽竈壽司被換掉、別天跟著洗牌（跟他手排的重疊率 50%→40%）；
    // 這個算法只動到七天包 8/14——挑到牛たん炭焼 髙也，正是他手排的那一版 8/14 的晚餐。
    const travel = townDinner ? travelMin(legFn, day.ref, day.home) + travelMin(legFn, day.home, p) : travelMin(legFn, day.ref, p);
    const score = travel + (day.stops >= day.target ? setting(settings, 'allocOverTargetPenaltyMin') : 0) + day.stops * 0.5;
    return { ok: true, slot, travel, score, note };
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
    day.picks.push({ ...pick, level: cand.level, why: [cand.why, r.note].filter(Boolean).join('；') || null, slot: r.slot, travelMin: r.travel, movedFrom: dropped.get(p.id)?.at(-1)?.date ?? null });
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
        // 單日引擎照排、只掛提示的兩種（他勾的站不擋；分配器分的站在引擎眼裡也是他勾的）——分配器自己分的那家收回、那天不再試；骨架的站是旅程檔原本就有的，不動：
        // - day-trip-night：一日遊排出來其實晚回城、市區的夜間站（回市區才吃的晚餐落在夜間時段也算）被掛提示（rules/_slots.js dayTripNightHints；原話 #190）；
        //   分配前的估計只算骨架，會估得太早。
        // - last-train：這一站趕不上末班車（rules/_slots.js lastTrainHints；單日引擎已經試過換順序，還是趕不上才有這條）。留池理由就是提示那一句。
        //   需求單點名的（②）不收：點名就排（總則 3），提示留在那一站給他看。
        for (const w of x.plan.warnings ?? []) {
          if (!w.hint || !w.poiId || (w.ruleId !== 'day-trip-night' && w.ruleId !== 'last-train')) continue;
          const cand = byId.get(w.poiId);
          const pick = day.picks.find((p) => p.poiId === w.poiId);
          if (!cand || !pick) continue;
          if (w.ruleId === 'last-train' && cand.level === 2) continue;
          const reason = w.ruleId === 'last-train' ? w.msg : lateReturnReasonFor(cand.poi);
          unplace(day, w.poiId);
          dropped.set(w.poiId, [...(dropped.get(w.poiId) ?? []), { date: x.date, reason }]);
          out.push({ cand, pick, date: x.date, reason });
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

  // 分配後單日引擎還在警告的餐段／夜間站（分配器標的餐段、夜間站只是配額與意圖，引擎不保證排在那個時段；他 11-06 說「這點不強制」，原話 #189，不給引擎軟罰）
  const slotWarnings = (finalResult?.days ?? []).flatMap((x) => (x.plan?.warnings ?? []).filter((w) => (w.ruleId === 'meal-slots' || w.ruleId === 'night-slot') && !w.hint).map((w) => ({ date: x.date, msg: w.msg })));

  const count = (list) => list.reduce((m, x) => ((m[x] = (m[x] ?? 0) + 1), m), {});
  const report = {
    pool: { packed: poiList.length, eligible: pool.length, skeleton: days.reduce((n, d) => n + d.skeleton.length, 0), byLevel: count(pool.map((c) => c.level)) },
    days: days.map((d) => ({
      date: d.date, type: d.type, dayTrip: d.dayTrip, anchorName: d.anchorPoi?.name_zh ?? null, regionZones: d.region, nightZones: d.nightZones, dayTripBackMin: d.backMin, target: d.target, max: d.max,
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
