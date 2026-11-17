// 控制器：狀態、路由（hash）、重排、換站、設定。畫面各自一檔只負責畫與回呼。
import { el, clear, todayStr, dateLabel } from './dom.js';
import { TEXT } from './text.js';
import { loadRules } from '../rules/index.js';
import { BUILTIN } from '../rules/builtin.js';
import rulesJson from '../rules.json' with { type: 'json' };
import { planTrip, breakfastLaterDays } from '../engine/trip.js';
import { chooseDay } from '../engine/choices.js';
import { applyInsert, unpinDay as unpinTripDay, repinTrip, INSERT_DROP } from '../engine/insert.js';
import { setBreakfast, clearBreakfast, takeBreakfastOffer, swapBreakfast, keepBreakfasts } from '../engine/breakfast.js';
import { makeLegFn } from '../geo/matrix.js';
import { importPack, loadLatestPack } from '../data/store.js';
import { readPack } from '../data/pack.js';
import * as demo from '../demo/sendai.js';
import { renderPlanner } from './planner.js';
import { renderNow } from './now.js';
import { renderSettings } from './settings.js';
import { renderPool } from './pool.js';
import { renderBrief, briefEnv } from './brief.js';
import { mergeField, pickFieldDate, catchUpFieldDate, planScrollDate } from './ratings.js';
import { restoreApplied, withoutApplied } from './applied.js';
import { snapshotTripEdits, applyTripEdits, overlayTripEdits, diffTripEdits } from './trip-edits.js';
import { visitedPatch, visitedDates, shortName } from './corridor.js';
import { trialArgs, startInsert, chooseInsertOption, insertDoneText } from './insert.js';
import { chooseOptionTrip, deferStopTrip, deferNotice, displacedPicks } from './choices.js';
import { otherDayChanges, otherDaysText } from './other-days.js';
import { planArgsOf } from './plan-args.js';
import { hasLaterDay } from './meals.js';
import { emptyBrief, normalizeBrief, briefToMarkdown, briefFileName, looksLikeBrief, isBriefEmpty, themeOptions, briefMdName, briefSubmitMode, canSubmitBrief, briefEndpointFor } from '../data/brief.js';
import { normalizeMemory, rememberFromBrief } from '../data/brief-memory.js';
import { personsOf, cityNamesOf } from '../engine/persons.js';

const SETTINGS_KEY = 'trip-pilot:settings';
const FIELD_KEY = 'trip-pilot:field';
const BRIEF_KEY = 'trip-pilot:brief';
const BRIEF_MEMORY_KEY = 'trip-pilot:brief-memory';
const TRIP_EDITS_KEY = 'trip-pilot:trip-edits';   // 規劃頁的改動（T16b；ui/trip-edits.js）：整天的 picks／removed／swapped、釘住的順序 pinned、早餐不排的紀錄 breakfast 與整趟的 deferred 快照
const BRIEF_SUBMITTED_KEY = 'trip-pilot:brief-submitted';   // 這份需求單上次交到桌機的哪個檔（{ file }）：檔名跟著城市與起日月份變，變了再交時要提醒舊名那份還在

export const state = {
  trip: null, pois: {}, country: null, kb: null, legFn: null,
  rules: null, settings: null, plans: {}, pool: [],
  packRules: null, packMeta: null, packStatus: '',
  // 最後一次動作的復原資料（一次性；原話 #171、#181）：{ kind, dates, before, text }——before＝動作前整趟改動的快照（trip-edits.js snapshotTripEdits，JSON clone），
  // 按「復原」整份蓋回去重排（undoLast）；text＝復原列上那一句（別天跟著變了也接在後面，alsoChanged）。
  // kind：'remove' 不去了｜'swap' 換一家｜'insert' 升級成站（安插）｜'unpin' 讓引擎重排這天｜'choose' 或 B｜'defer' 排到別天｜'breakfast' 早餐的鍵。
  // 現場頁按的早餐鍵另帶 nowIndex（那一刻走到第幾站）：現場頁只在還停在那一站時畫復原列。按「關閉」只收掉這一列、不復原（dismissUndo）
  undo: null,
  notice: null,   // 不是動作的一句狀態 { text }：「旅程更新過了，上一版的改動已丟掉」「正在重排…」（下一個動作前都在，不搶 undo；二選一／排到別天那句改放 undo.text，原話 #181）
  busy: false,    // 試排與重排正在跑（二選一、排到別天、升級成站的試算、早餐的鍵；同步跑、桌機量到接近 1 秒）：先畫一句再算，算完前再按不理（T16 審查後）
  // 升級成站排不下、正在問他的那組選項（原話 #194）：{ date, legIndex, poiId, trial, chosen }——trial＝這一輪的試算結果（engine/insert.js）、chosen＝前幾輪選過的選項。
  // 只在記憶體；任何重排都清掉（選項是對那一份 plan 算的）。畫在走廊清單那一家底下（planner.js insertAskNode）
  insertAsk: null,
  planScroll: false,   // 打開規劃頁那一刻要捲到當天那一塊（原話 #175）：進頁、載入旅程、隔天切到今天時設 true，render 畫完規劃頁就消耗；按鍵重畫不設；只在記憶體
  replanPending: false,   // 需求單頁改了會影響排程的東西（同行者的在場、體力、夜間站）還沒重排：離開需求單頁那一下補跑（T19 審查後）
  corridorOpen: {},   // 走廊清單哪幾段展開著（鍵 plan:日期:段／now:日期:段；只在記憶體、不存，重排就清；T15）
  tripBase: null,   // 打包那版的 days 三個陣列與 deferred（snapshotTripEdits 的形狀，載入時 clone 的）：設定頁「本機改動：N 天有改」的對照、「還原成打包版」放回去的那份（T16b）
  route: '#/plan',
  device: loadJSON(SETTINGS_KEY, {}),
  field: loadJSON(FIELD_KEY, { date: null, index: 0, simulate: false, simNowMin: null, ratings: {}, progress: {}, visited: {} }),
  // 需求單（T26）：出發前在電腦上填、按「提交」交給 Claude（原話 #186「需求單不是在手機跑 而是在電腦」、#188 輸出成一份 MD 檔到 trip-pilot 資料夾；
  // 10-16 寫的「在手機上填」是推導、已作廢）。填的內容存這台裝置的瀏覽器；記憶是上一份單子的消耗品與要買的（data/brief-memory.js）
  brief: normalizeBrief(loadJSON(BRIEF_KEY, null)),
  briefMemory: normalizeMemory(loadJSON(BRIEF_MEMORY_KEY, null)),
  briefStatus: '',
  briefCopyText: null,   // 剪貼簿不給用時，整份文字放進頁上的框讓他自己複製
  briefUndo: null,       // 載入別份或清空前的那份（一次性「復原上一份」；空單不留）
  // 提交（#188）走哪條路看這兩樣（ui/brief.js briefEnv → data/brief.js briefSubmitMode）；需求單的入口也看它們（兩樣都沒有＝iPhone Safari，入口不出現）
  briefEndpoint: null,   // 同源的提交端點（桌機伺服器的 /brief）：null 還沒探測、true 會收、false 沒有或不收（probeBriefEndpoint）
  briefUnreachable: false,   // briefEndpoint 是 false 的原因是「連不上」（伺服器沒開、逾時），不是它明講不收：下次按「提交」先用短逾時重探一次（submitBrief）
  savePicker: typeof globalThis.showSaveFilePicker === 'function',   // 瀏覽器有另存對話框（File System Access API）
  briefBusy: false,      // 正在提交：再按不理
  briefSubmitted: submittedOf(loadJSON(BRIEF_SUBMITTED_KEY, null)),   // 這份單子上次交到桌機的檔 { file }；載入別份、清空、復原就忘掉（那是另一份單子了）
};

function submittedOf(v) { return v && typeof v.file === 'string' && v.file ? { file: v.file } : null; }

function loadJSON(key, fallback) { try { const v = JSON.parse(localStorage.getItem(key) ?? 'null'); return v ?? fallback; } catch { return fallback; } }
function saveJSON(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* 隱私模式 */ } }
function removeJSON(key) { try { localStorage.removeItem(key); } catch { /* 隱私模式 */ } }

/** 把四個裝置設定套進引擎設定與規則（決策樹 Q17）。 */
function buildSettings() {
  const src = state.packRules ?? rulesJson;
  const base = { ...src.settings };
  const d = state.device;
  if (Number.isFinite(d.walkBudgetMin)) base.walkBudgetMin = d.walkBudgetMin;
  if (Number.isFinite(d.openSlotMinPerDay)) base.openSlotMinPerDay = d.openSlotMinPerDay;
  if (d.departHM) base.dayWindow = [d.departHM, base.dayWindow[1]];
  const config = { ...src.rules };
  if (d.nightSlotOn === false) config['night-slot'] = { ...(config['night-slot'] ?? {}), weight: 0 };
  state.settings = base;
  state.rules = loadRules(BUILTIN, config);
}

export function loadDemo() {
  state.trip = demo.demoTrip();
  state.pois = Object.fromEntries(Object.values(demo.POIS).map((p) => [p.id, p]));
  state.country = demo.COUNTRY;
  state.kb = demo.KB;
  state.legFn = demo.legFn;
  state.pool = Object.values(demo.POIS).map((poi) => ({ poi }));
  restoreTripEdits();
  syncFieldDate();
  state.planScroll = true;   // 載入旅程後第一次畫規劃頁捲到當天（原話 #175）；設在 replanAll 之前，它裡面那次 render 就消耗
  replanAll();
}

/** 從打包檔載入（手機「更新」之後），座標與矩陣有就用。 */
export function loadFromPack(packResult) {
  const { pack, pois } = packResult;
  state.trip = pack.trip;
  state.pois = Object.fromEntries(pois.map((p) => [p.id, p]));
  state.country = pack.country;
  state.kb = { zones: pack.zones?.zones ?? {}, city: pack.city ?? null };   // city：需求單的城市也對打包檔的 id 與名字（engine/persons.js cityNamesOf，T19）
  state.packRules = pack.rules ?? null;
  state.packMeta = { ...(pack.meta ?? {}), tripId: pack.trip.id, tripName: pack.trip.name ?? pack.trip.id, city: pack.city ?? null };
  buildSettings();
  state.legFn = makeLegFn({ walk: pack.walk?.pairs ?? {}, settings: state.settings, zoneLinks: pack.zones?.links ?? {} });
  state.pool = pois.map((poi) => ({ poi }));
  restoreTripEdits();   // 規劃頁的改動（T16b）：打包時間與旅程相同才蓋回，重排之前
  syncFieldDate();
  state.planScroll = true;   // 同 loadDemo：載入旅程後捲到當天（原話 #175）
  replanAll();
}

/** 現場頁的日期要是這趟的一天（boot 先填了今天、或換了旅程就不是）：不是就換成今天／第一天，進度照那天的 progress 接（T13）。 */
function syncFieldDate() {
  const date = pickFieldDate(state.field, state.trip.days.map((d) => d.date), todayStr());
  if (date === state.field.date) return;
  state.field = mergeField(state.field, { date });
  saveJSON(FIELD_KEY, state.field);
}

/** 重排並重畫；只重排不重畫的是 replan（二選一／排到別天要在重排後比對擠掉了誰再寫那句，寫完才畫一次）。 */
export function replanAll() {
  replan();
  render();
}

function replan() {
  buildSettings();
  state.replanPending = false;
  if (!state.trip) return;
  // restPool：整個知識庫都給引擎挑恢復站（trip.js 會篩成當日區域內、沒勾、沒拒絕的幾家）；示範資料也一樣
  // 走廊清單按過「我進去了」的（field.visited）：進去那天之後引擎不再插它、走廊也不列（原話 #138）；按的當下只重畫，下次重排才生效
  const visited = visitedDates(state.field.visited);
  // brief：旅程檔沒 persons 時，手機需求單的同行者（city／dates 對得上才算）直接生效（T19，engine/persons.js personsOf）
  const r = planTrip({ trip: state.trip, pois: state.pois, rules: state.rules, settings: state.settings, country: state.country, kb: state.kb, legFn: state.legFn, restPool: Object.values(state.pois), brief: state.brief, options: { visited } });
  // 釘住順序的日子：排出來的那一條記回旅程檔（engine/insert.js repinTrip；11-12 審查）——按了「不去了」之後才排進來的站、被讓掉的引擎站都要記，
  // 不然下一個動作會讓那一站自己換位置。沒有東西要記時回同一個物件；記了再重排結果相同（同一套組法），所以不用再排一次
  // 每天引擎排的早餐也記回旅程檔（engine/breakfast.js keepBreakfasts；11-12 畫面審查）：下一次重排那一家還排得進就沿用——不記的話整趟每次重新分，
  // 他在某一天按「不去了」「換一家」，別天的早餐會跟著換店。這一欄是引擎的備忘、不算他的改動（trip-edits.js diffTripEdits 不比它）；有別的改動時跟著快照存，重開 App 才接得上
  const repinned = keepBreakfasts(repinTrip(state.trip, r.days), r.days);
  if (repinned !== state.trip) { state.trip = repinned; saveTripEdits(); }
  state.plans = Object.fromEntries(r.days.map((d) => [d.date, d]));
  // 現場套過的改案（field.applied）活過重排與重開：打包相同就還原整條序列、整天重算；不同（手機更新了新打包）就丟掉並在那天警告一行
  const restored = restoreApplied({ plans: state.plans, applied: state.field.applied, packAt: state.packMeta?.generatedAt ?? null, pois: state.pois, trip: state.trip, legFn: state.legFn, rules: state.rules, settings: state.settings, country: state.country, kb: state.kb, visited });
  state.plans = restored.plans;
  if (restored.dropped.length) { state.field = mergeField(state.field, { applied: restored.applied }); saveJSON(FIELD_KEY, state.field); }
  state.corridorOpen = {};   // 重排後段的編號會變，展開的走廊清單全收起（「我進去了」只重畫不重排，照舊開著）
  state.insertAsk = null;    // 升級成站還開著的那組選項是對重排前那一份 plan 算的，一起收掉
}

/** 動作前整趟改動的快照（一次性復原用；原話 #171、#181）：每天的 picks／removed／swapped／pinned／breakfast 與整趟的 deferred，JSON clone——之後怎麼改 state.trip 都不會動到它。 */
function editsSnapshot() {
  return JSON.parse(JSON.stringify(snapshotTripEdits(state.trip, packAtNow())));
}

/** 規劃頁的動作改完 state.trip 之後：動到的那幾天現場套過的改案清掉、存改動、整趟重排（不重畫；呼叫端自己畫或交給 afterPaint）。 */
function commitTrip(dates) {
  for (const date of dates) if (date) clearApplied(date);
  saveTripEdits();
  replan();
}

/**
 * 動作前後，動到的那幾天（dates）以外別天的行程有沒有跟著變（ui/other-days.js；11-12 畫面審查）：有就回一句接在復原列後面的話「；別天跟著變了：8/15（六） 引擎排的 A 換成 B」，沒有回空字串。
 * plansBefore＝動作前的 state.plans（重排之前先留著那個物件）。每個會整趟重排的動作都接：他只動了一天、別天卻變了，至少要講，不要就按「復原」。
 */
function alsoChanged(plansBefore, dates) {
  const text = otherDaysText(otherDayChanges({ before: plansBefore, after: state.plans, dates }));
  return text ? `；${text}` : '';
}

/** 他在規劃頁改了那天的勾選（不去了、換一家）：那天現場套過的改案清掉，回到引擎排。 */
function clearApplied(date) {
  const applied = withoutApplied(state.field.applied, date);
  if (applied === state.field.applied) return;
  state.field = mergeField(state.field, { applied });
  saveJSON(FIELD_KEY, state.field);
}

/** 打包時間（meta.generatedAt）：現場改案與規劃頁改動的對照鍵；示範旅程沒有打包是 null。 */
const packAtNow = () => state.packMeta?.generatedAt ?? null;

/**
 * 載入旅程（loadFromPack／loadDemo）之後、重排之前（T16b；原話 #154 手機是操作端、#121 改了要留著）：先留一份打包那版的對照（tripBase），
 * 再把手機上存的規劃頁改動蓋回 state.trip（trip-edits.js applyTripEdits）；打包時間或旅程不同（手機更新了新打包）就丟掉那份、規劃頁頂端一句
 * 「旅程更新過了，上一版的改動已丟掉」（state.notice；順延那句 10-24 起改放復原列 undo.text，原話 #181）。舊旅程的復原列與那句狀態都不再適用，一起清掉。
 */
function restoreTripEdits() {
  state.tripBase = JSON.parse(JSON.stringify(snapshotTripEdits(state.trip, packAtNow())));
  state.undo = null;
  state.notice = null;
  const edits = loadJSON(TRIP_EDITS_KEY, null);
  if (!edits) return;
  const r = applyTripEdits(state.trip, edits, packAtNow());
  if (r.dropped) {
    // 載入示範旅程（沒有打包，packMeta null）時鍵是真旅程的：不刪、也不講——打包檔只是暫時讀不到（IndexedDB 被別的分頁擋住那種），同一包回來時改動還要在（10-16 審查）
    if (!state.packMeta && edits.tripId !== state.trip?.id) return;
    removeJSON(TRIP_EDITS_KEY); state.notice = { text: TEXT.tripEdits.dropped }; return;
  }
  state.trip = r.trip;
}

/**
 * 規劃頁每個動作改完 state.trip 之後存一次（swapStop／removeStop／undoLast／升級成站套用／unpinDay／chooseOption／deferStop／早餐的三個動作，重排之前；多數走 commitTrip）：
 * 整天的 picks／removed／swapped／pinned／breakfast 與整趟的 deferred 快照，不是差分（跟 applied 一樣簡單）。跟打包那版一模一樣（不去了又復原）就把鍵刪掉：
 * 不然下次更新打包會白講一句「上一版的改動已丟掉」。
 */
function saveTripEdits() {
  if (!state.trip) return;
  if (!diffTripEdits(state.trip, state.tripBase).any) { removeJSON(TRIP_EDITS_KEY); return; }
  saveJSON(TRIP_EDITS_KEY, snapshotTripEdits(state.trip, packAtNow()));
}

/**
 * 設定頁「還原成打包版」（按兩次確認，settings.js）：鍵刪掉、days 的三個陣列、釘住的順序、早餐不排的紀錄與 deferred 放回打包那版（tripBase）、
 * 改過的那幾天現場套過的改案也清掉（那些改案是對改過的勾選套的，跟「不去了」「換一家」清掉那天的快照同一個理由；待確認）、整趟重排；復原列與狀態列那句都不再適用。
 */
export function resetTripEdits() {
  if (!state.trip || !state.tripBase) return;
  const { dates } = diffTripEdits(state.trip, state.tripBase);
  state.trip = overlayTripEdits(state.trip, JSON.parse(JSON.stringify(state.tripBase)));
  removeJSON(TRIP_EDITS_KEY);
  state.undo = null;
  state.notice = null;
  for (const date of dates) clearApplied(date);
  state.packStatus = TEXT.tripEdits.restored;
  replanAll();
}

/**
 * 換一家。釘住順序的日子原位置換掉、其餘各站先後不動（engine/swap.js applySwap 會改寫那天的 pinned）。
 * 那一天怎麼改走 engine/choices.js chooseDay（11-17）：新的那一家不在當天的勾選裡就是 applySwap（A 的那筆換成 B）；它本來就是當天的勾選（清單會列當天勾了但排不進的店）
 * 就把 A 的那筆拿掉、留它自己那筆——之前一律 applySwap，A 的那筆被改成 B、B 原本那筆還在，同一家店同一天排兩次
 * （公務版 8/13 把珈巣多夢換成當天排不進的喫茶 Elbe：序列裡出現兩個 Elbe；11-17 量的，待套用版三包畫出來的候選裡各有 2、4、6 筆是這種）。
 * breakfast: true＝換的是早餐那一站（清單來自 engine/breakfast.js；planner.js toggleSwap 給）：走 swapBreakfast——新的那家標成他指定的早餐、排成第一站；
 * 引擎先挑的早餐也能換，換了就變成他勾的（原話 #196；主控定的落地 D3）。
 * 11-12 起跟「不去了」一樣留一次性的復原（原話 #171、#181 的同一套；之前換一家沒有，換錯了只能再換一次、原本那一家還不一定在清單上）：動手前先快照，
 * 復原列寫「已把 8/14（五） 的 A 換成 B」，重排之後別天也跟著變了就接在後面（alsoChanged）。
 */
export function swapStop(date, fromPoiId, toPoi, { breakfast = false } = {}) {
  const day = state.trip.days.find((d) => d.date === date);
  if (!day || state.busy) return;
  const before = editsSnapshot();
  const plansBefore = state.plans;
  // 兩家店名都用短的（括號裡的研究註記拿掉；跟安插那一句一樣）：這一句有兩個店名，帶註記的全名在手機上會多兩三行
  const fromName = shortName(state.pois[fromPoiId]?.name_zh ?? fromPoiId);
  state.notice = null;
  if (!state.pois[toPoi.id]) state.pois[toPoi.id] = toPoi;
  if (breakfast) state.trip = swapBreakfast(state.trip, date, toPoi.id, state.plans[date]?.plan);
  else Object.assign(day, chooseDay(day, fromPoiId, toPoi));
  commitTrip([date]);
  // 復原列看重排的結果寫（11-17 畫面審查；之前不看結果一律寫「換成」、只比別天）：
  // - 選的那一家排進去了才寫「已把 A 換成 B」；重排之後它還是排不進（今天沒開、撞到必去或主行程）就寫「已把 A 拿掉，但 B 今天排不進」。
  //   沒釘住的日子換了之後整天重新搜尋，引擎會讓他剛選的那一家先排（engine/core.js chosenPullOf），所以排不進是少數。
  // - 當天別的勾選站因此落到排不進清單（重新搜尋換了一組站）：接「擠掉了 8/13（四） 的 X」，跟二選一同一句（displacedPicks；B 自己不算在裡面）。
  const toName = shortName(toPoi.name_zh ?? toPoi.id);
  const placed = (state.plans[date]?.plan?.sequence ?? []).some((s) => s.poi.id === toPoi.id);
  const lead = placed ? TEXT.undoSwapped(fromName, toName, dateLabel(date)) : TEXT.undoSwapUnplaced(fromName, toName, dateLabel(date));
  const squeezed = displacedPicks({ before: plansBefore, after: state.plans, dates: [date] }).filter((x) => x.poi.id !== toPoi.id);
  const squeezedText = squeezed.length ? `；${TEXT.displacedNote(squeezed.map((x) => TEXT.displacedOne(dateLabel(x.date), shortName(x.poi.name_zh ?? x.poi.id))).join('、'))}` : '';
  state.undo = { kind: 'swap', dates: [date], before, text: `${lead}${squeezedText}${alsoChanged(plansBefore, [date])}` };
  render();
}

/**
 * 不去了：他勾的站從 picks 拿掉；引擎插的站（insertedBy 'engine'）不在 picks，記進 removed 就是拒絕，trip.js 看到那天不再插同一種（priority 'rest' 恢復站／'filler' 填站；原話 #126、profile §2.4）。
 * 釘住順序的日子：那一站從順序裡跳過，其餘各站不動（engine/insert.js planPinnedDay 自己認，不用改 pinned）。
 */
export function removeStop(date, poiId, insertedBy = null, priority = null) {
  const day = state.trip.days.find((d) => d.date === date);
  if (!day || state.busy) return;
  // 一次性的復原（原話 #171「如果我按不去了 也要一次性的恢復按鈕 進行第二次確認或反悔的機會」）：動手前先快照，下一個動作前都能按「復原」
  const before = editsSnapshot();
  const plansBefore = state.plans;
  // via：那筆勾選是走廊清單升級進來的（picks[].via 'corridor'；engine/insert.js）就帶到 removed 那一筆——別天挑引擎插站時它照樣是「挑好名單才拿掉」，不然別天會跟著變（11-12 審查）。
  // 釘住順序的日子上拒絕引擎插的站同理（記 INSERT_DROP，跟安插的選項裡選「不去」那一站同一個記號）：那天之前的日子挑好名單才拿掉、那天起照舊算插過的
  const via = (day.picks ?? []).find((p) => p.poiId === poiId)?.via ?? (insertedBy === 'engine' && day.pinned ? INSERT_DROP : undefined);
  const removedEntry = { poiId, at: new Date().toISOString(), ...(insertedBy ? { insertedBy } : {}), ...(priority ? { priority } : {}), ...(via ? { via } : {}) };
  day.picks = (day.picks ?? []).filter((p) => p.poiId !== poiId);
  day.removed = [...(day.removed ?? []), removedEntry];   // 不算落選（原話 #91）
  state.notice = null;
  commitTrip([date]);
  state.undo = { kind: 'remove', dates: [date], before, text: `${TEXT.undoRemoved(state.pois[poiId]?.name_zh ?? poiId, dateLabel(date))}${alsoChanged(plansBefore, [date])}` };
  render();
}

/** 復原列的「關閉」：把那一列收掉、不復原（之後就不能復原這一個動作了；旅程沒有動）。 */
export function dismissUndo() {
  if (!state.undo) return;
  state.undo = null;
  render();
}

/**
 * 復原剛才那一個動作（不去了、換一家、升級成站、讓引擎重排這天、或 B、排到別天、早餐的鍵；原話 #171、#181）：整趟的改動放回動作前的快照
 * （每天的 picks／removed／swapped／pinned／breakfast、引擎記著的早餐 engineBreakfast 與 deferred，跟設定頁「還原成打包版」同一套），動到的那幾天現場改案清掉、重排；只對最後一次有效。
 * 快照帶著引擎記著的早餐，所以重排出來的就是動作前畫面上那一版：連別天跟著變的也一起回去。
 * 11-06 第二批起每一種都走快照：之前「不去了」「升級成站」只放回那天的 picks 與 removed，帶不回釘住的順序。
 */
export function undoLast() {
  const u = state.undo;
  if (!u || state.busy) return;
  state.undo = null;
  state.notice = null;
  state.trip = overlayTripEdits(state.trip, JSON.parse(JSON.stringify(u.before)));
  commitTrip(u.dates ?? []);
  render();
}

/**
 * 走廊清單「升級成站」＝安插（11-06 第二批；原話 #192「順路站 升級成站時 不應該把原本的行程刪掉 應該是安插進來」、#194）：
 * 把那家插進它所在的那一段（legIndex＝走廊清單掛在第幾段），原本那天畫面上的每一站都留著、先後不變，只是後面的時刻順延——不再整天重排
 * （之前加進 picks 重跑搜尋：主控 11-06 在七天包試 49 次，40 次有原本的站不見、32 次其餘順序變了）。
 * 先試算（engine/insert.js insertTrial，同步、跳選項時桌機量到最多 28.5 ms）：
 * - 排得下 → 套（applyInsert：picks 加那家、那天釘住順序）、重排，頂端復原列講插在誰跟誰之間、後面順延幾分（一次性復原，原話 #171）；
 * - 排不下 → 不動旅程，在那一家底下展開一組選項問他（state.insertAsk；pickInsertOption、cancelInsert）。
 * 比照 chooseOption 先畫一句「正在試排…」再算。
 */
export function upgradeCorridor(date, poiId, legIndex = 0) {
  if (state.busy) return;
  const args = trialArgs(state, date, poiId, legIndex);
  if (!args) return;
  afterPaint(() => settleInsert(date, args, startInsert(args)), TEXT.trying);
}

/** 選項裡選了一個（那顆鍵帶著 engine 給的選項物件）：排得下就套；還排不下就換成下一輪的選項（最多三輪，ui/insert.js chooseInsertOption）。 */
export function pickInsertOption(option) {
  const ask = state.insertAsk;
  if (state.busy || !ask) return;
  const args = trialArgs(state, ask.date, ask.poiId, ask.legIndex);
  if (!args) { state.insertAsk = null; render(); return; }
  afterPaint(() => settleInsert(ask.date, args, chooseInsertOption(args, ask, option)), TEXT.trying);
}

/** 「算了，不插」：把那組選項收掉，旅程沒動過。 */
export function cancelInsert() {
  if (!state.insertAsk) return;
  state.insertAsk = null;
  render();
}

/** 試算之後走哪一步（step＝ui/insert.js startInsert／chooseInsertOption 的結果）：套進旅程檔重排，或把選項記進 state.insertAsk 等他選。 */
function settleInsert(date, args, step) {
  if (step.kind === 'ask') { state.insertAsk = { date, legIndex: args.legIndex, poiId: args.poi.id, ...step.ask }; return; }
  state.insertAsk = null;
  if (step.kind !== 'apply') return;
  const before = editsSnapshot();
  const plansBefore = state.plans;
  const next = applyInsert(state.trip, date, step.result);
  if (next === state.trip) return;   // 排不下的結果不套（不會發生；保險）
  const text = insertDoneText(step.result, (id) => state.pois[id]?.name_zh ?? id, args.plan);   // args.plan＝試算用的那一份：後面是提早還是順延拿它比
  state.trip = next;
  commitTrip([date]);
  state.undo = { kind: 'insert', dates: [date], before, text: `${text}${alsoChanged(plansBefore, [date])}` };   // 安插不動別天（engine/trip.js lateIds）；真的動到了照樣講
  state.notice = null;
}

/** 「讓引擎重排這天」（釘住順序的日子日期下面那顆小鍵）：解除釘住、那天交回引擎整天重排；選項裡調過的「少待」跟著順序走、解除就不留。一次性復原。 */
export function unpinDay(date) {
  if (state.busy || !state.trip) return;
  const next = unpinTripDay(state.trip, date);
  if (next === state.trip) return;
  afterPaint(() => {
    const before = editsSnapshot();
    const plansBefore = state.plans;
    state.trip = next;
    commitTrip([date]);
    state.undo = { kind: 'unpin', dates: [date], before, text: `${TEXT.undoUnpinned(dateLabel(date))}${alsoChanged(plansBefore, [date])}` };
    state.notice = null;
  });
}

/**
 * 早餐那一站的「吃飯店早餐」（mode 'hotel'）／「改天去」（mode 'later'）（原話 #196；主控定的落地 D4、D5）：那天不排早餐、也不提示；原定那家（那天的 plan.meals.breakfast）
 * 記在旅程檔那天的 breakfast 上，後面的日子由引擎掛推薦（吃飯店早餐只推一次、改天去每天都推，原話 #197）。那天沒排到早餐時也能按「吃飯店早餐」（原定那家是 null）。
 * 一次性復原；之後隨時可以按日期下面的「改回來」（breakfastBack）。nowIndex：從現場頁按的話帶那一刻走到第幾站（現場頁只在還停在那一站時畫復原列）。
 */
export function breakfastOff(date, mode, nowIndex = null) {
  if (state.busy || !state.trip?.days.some((d) => d.date === date)) return;
  const poiId = state.plans[date]?.plan?.meals?.breakfast ?? null;
  const next = setBreakfast(state.trip, date, mode, poiId);
  if (next === state.trip) return;
  const L = TEXT.breakfast;
  const name = poiId ? (state.pois[poiId]?.name_zh ?? null) : null;
  // 原定那家是他自己勾的站（按了就從這天的勾選拿掉、記在 breakfast.pick）：吃飯店早餐那一句也把店名寫出來——之前只寫「早餐改成在飯店吃」，那一站無聲不見（11-12 畫面審查）
  const picked = Boolean(poiId) && (state.trip.days.find((d) => d.date === date)?.picks ?? []).some((p) => p?.poiId === poiId);
  const named = Boolean(name) && (mode === 'later' || picked);   // 那一句裡有沒有寫出店名
  const text = mode === 'later' && name ? L.undoLater(name, dateLabel(date)) : name && picked ? L.undoHotelPicked(name, dateLabel(date)) : L.undoHotel(dateLabel(date));
  afterPaint(() => {
    const before = editsSnapshot();
    const plansBefore = state.plans;
    state.trip = next;
    commitTrip([date]);
    state.undo = { kind: 'breakfast', dates: [date], before, text: `${text}${noLaterDayText(date, name, named)}${alsoChanged(plansBefore, [date])}`, nowIndex };
    state.notice = null;
  });
}

/**
 * 按了「改天去」「吃飯店早餐」、重排之後：原定那家在後面目前沒有排得進的日子（engine/trip.js breakfastLaterDays 回空陣列）就回接在復原列後面的半句
 * 「；目前後面沒有排得進這家的日子」（那一句裡沒寫店名時用「；原定的 X 目前後面沒有排得進的日子」），不然回空字串（原話 #196、#197；11-17）。
 * 之前這種時候畫面一句話都沒有：他按了「改天去」，以為後面會再推薦，其實哪一天都排不進（11-12 審查：試走版 8/15 的松島星鰻丼）。
 * 那天本來就沒排到早餐（沒有哪一家可問）、國家層沒有早餐段都是 null，不多話。要在重排之後問：答案看的是這一版每天掛了哪些「或 X」。
 * 旅程最後一天也不多話（11-17 畫面審查）：後面本來就沒有日子，「目前後面沒有排得進…」是廢話，「目前」還讀得像之後可能會有。
 */
function noLaterDayText(date, name, named) {
  if (!hasLaterDay(state.trip, date)) return '';
  const days = breakfastLaterDays({ trip: state.trip, days: state.plans, date, pois: state.pois, restPool: Object.values(state.pois), legFn: state.legFn, rules: state.rules, settings: state.settings, country: state.country, kb: state.kb, visited: visitedDates(state.field.visited) });
  if (!Array.isArray(days) || days.length) return '';
  return named || !name ? TEXT.breakfast.noLaterDay : TEXT.breakfast.noLaterDayNamed(name);
}

/** 日期下面的「改回來」：那天回到照常排早餐（engine/breakfast.js clearBreakfast：當初拿掉的勾選放回原位，除非那家已經排到別天）。 */
export function breakfastBack(date) {
  if (state.busy || !state.trip) return;
  const next = clearBreakfast(state.trip, date);
  if (next === state.trip) return;
  afterPaint(() => {
    const plansBefore = state.plans;
    state.undo = null;
    state.trip = next;
    commitTrip([date]);
    // 這個動作沒有復原列（再按一次早餐的鍵就回去了）；別天跟著變了的話用狀態列講一句
    const also = otherDaysText(otherDayChanges({ before: plansBefore, after: state.plans, dates: [date] }));
    if (also) state.notice = { text: also };
  });
}

/**
 * 按了早餐卡上的「或 X（8/13 沒去的）」、或沒有早餐站那天的「排進這天」（原話 #197）：X 變成那天的早餐（他指定的、排成第一站），原本記著它的那天標成已排走、不再推薦
 * （engine/breakfast.js takeBreakfastOffer）。推薦掛出來之前引擎就驗過：其餘各站先後不變、沒有站因此排不進。跟二選一一樣留一次性復原（原話 #181）。
 */
export function takeBreakfast(date, poiId) {
  if (state.busy || !state.trip) return;
  const next = takeBreakfastOffer(state.trip, date, poiId, state.plans[date]?.plan);
  if (next === state.trip) return;
  afterPaint(() => {
    const before = editsSnapshot();
    const plansBefore = state.plans;
    state.trip = next;
    commitTrip([date]);
    state.undo = { kind: 'breakfast', dates: [date], before, text: `${TEXT.breakfast.undoTaken(state.pois[poiId]?.name_zh ?? poiId, dateLabel(date))}${alsoChanged(plansBefore, [date])}` };
    state.notice = null;
  });
}

/**
 * 二選一選了 B（原話 #119「我選一間，到了 17 號就會自動排進另一間」；T16）：那天的 picks 把 A 換成 B（換這一站的邏輯，換掉的不算落選）、A 順延到別天
 * （engine/choices.js defer：主題日優先、再其餘 normal 日由早到晚，每天用引擎試排，排得進就定案；全排不進就先留在候選池），兩天現場套過的改案清掉、整趟重排；
 * 頂端一句「A 已排到 8/17」或「A 先留在候選池（別天排不進）」，重排擠掉了別的勾選站就接「擠掉了 8/13 的 X」（displacedPicks）——這句放在復原列上（state.undo.text）。
 * 跟「不去了」一樣有一次性復原（原話 #181）：試排前整趟的 picks／removed／swapped 與 deferred 先快照（snapshotTripEdits，JSON clone），按「復原」整份蓋回去重排（undoLast）。
 * 試排的 baseline 用重排前的 state.plans（當日區域、主題日、購物日那幾樣換站前後一樣，fromDate 自己不在候選日裡）。
 * 試排好幾天再整趟重排是同步的（桌機量到接近 1 秒，10-16 審查）：先畫「正在重排…」再算（afterPaint）。
 */
export function chooseOption(date, fromPoiId, toPoi) {
  if (state.busy || !state.trip?.days.some((d) => d.date === date) || !toPoi || !state.pois[fromPoiId]) return;
  state.undo = null;
  if (!state.pois[toPoi.id]) state.pois[toPoi.id] = toPoi;
  const name = state.pois[fromPoiId].name_zh ?? fromPoiId;
  afterPaint(() => {
    const plansBefore = state.plans;
    const before = JSON.parse(JSON.stringify(snapshotTripEdits(state.trip, packAtNow())));
    const r = chooseOptionTrip({ trip: state.trip, pois: state.pois, date, fromPoiId, toPoi, baseline: { days: Object.values(plansBefore) }, planArgs: planArgsOf(state) });
    state.trip = r.trip;
    clearApplied(date);
    if (r.toDate) clearApplied(r.toDate);
    saveTripEdits();
    replan();
    // 選的那一家（B）重排之後自己排不進：另外講「B 今天排不進」，不寫成「擠掉了 B」（11-17；引擎會讓他剛選的那一家先排，排不進是今天沒開、撞到必去或主行程）
    const placed = (state.plans[date]?.plan?.sequence ?? []).some((s) => s.poi.id === toPoi.id);
    const squeezed = displacedPicks({ before: plansBefore, after: state.plans, dates: [date, r.toDate] }).filter((x) => !(x.date === date && x.poi.id === toPoi.id));
    state.undo = { kind: 'choose', dates: [date, r.toDate].filter(Boolean), before, name, text: `${deferNotice(r.entry, name, squeezed, placed ? null : shortName(toPoi.name_zh ?? toPoi.id))}${alsoChanged(plansBefore, [date, r.toDate])}` };
    state.notice = null;   // 那句改由復原列顯示；afterPaint 看到不是「正在重排…」就不放回本來那句（跟之前被 deferNotice 取代一樣）
  });
}

/** 排不進清單的「排到別天」（T16）：那站直接順延（沒有選的那家）；排到了就從這天的 picks 搬過去，排不進就留在原處、候選頁標「順延中」。擠掉了誰、一次性復原（原話 #181）同 chooseOption。 */
export function deferStop(date, poiId) {
  if (state.busy || !state.trip?.days.some((d) => d.date === date) || !state.pois[poiId]) return;
  state.undo = null;
  const name = state.pois[poiId].name_zh ?? poiId;
  afterPaint(() => {
    const plansBefore = state.plans;
    const before = JSON.parse(JSON.stringify(snapshotTripEdits(state.trip, packAtNow())));
    const r = deferStopTrip({ trip: state.trip, pois: state.pois, date, poiId, baseline: { days: Object.values(plansBefore) }, planArgs: planArgsOf(state) });
    state.trip = r.trip;
    clearApplied(date);
    if (r.toDate) clearApplied(r.toDate);
    saveTripEdits();
    replan();
    state.undo = { kind: 'defer', dates: [date, r.toDate].filter(Boolean), before, name, text: `${deferNotice(r.entry, name, displacedPicks({ before: plansBefore, after: state.plans, dates: [date, r.toDate] }))}${alsoChanged(plansBefore, [date, r.toDate])}` };
    state.notice = null;
  });
}

/**
 * 先畫一句「正在重排…」（state.busy、state.notice；升級成站的試算給 text「正在試排…」）讓他知道按到了，下一個畫格再跑 work（同步的試排與重排），跑完重畫。
 * requestAnimationFrame 之後再 setTimeout 0 才保證那句已經畫出來；沒有 rAF 的環境直接 setTimeout。work 丟錯那句也會清掉、busy 放開。
 */
function afterPaint(work, text = TEXT.working) {
  state.busy = true;
  const before = state.notice;   // 本來就在的那句（例如「旅程更新過了，上一版的改動已丟掉」）work 沒換掉就放回去，不被「正在重排…」吃掉（10-16 審查）
  state.notice = { text };
  render();
  const run = () => {
    try { work(); } finally {
      state.busy = false;
      if (state.notice?.text === text) state.notice = before ?? null;
      render();
    }
  };
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => setTimeout(run, 0));
  else setTimeout(run, 0);
}

export function dismissNotice() {
  state.notice = null;
  render();
}

/** 走廊清單「我進去了」（原話 #57）：只記在這支手機 field.visited[poiId] = { date, at }（DESIGN §4 live），不重排；回國回灌進 KB 還沒接。 */
export function markVisited(date, poiId) {
  setField(visitedPatch(state.field, date, poiId, new Date().toISOString()));
}

/** 收一份打包檔 JSON：格式不對在 readPack 丟；先寫進 IndexedDB（手機是真相）再載入畫面。 */
export async function applyPackJson(json, { persist = true } = {}) {
  const result = readPack(json);
  if (persist) await importPack(json);
  loadFromPack(result);
  state.packStatus = TEXT.updated(result.pack.trip.name ?? result.pack.trip.id, result.pack.meta?.generatedAt);
  render();
}

/**
 * 設定頁「更新」：抓桌機的打包檔。失敗時那一句分三種（11-17）——
 * (1) 連不上：fetch 自己丟錯＝請求沒拿到任何回應（桌機沒開、不在同一個網路、這台裝置沒有網路），或回應的標頭到了、本文傳到一半斷線（讀本文時丟錯；
 *     打包檔 2 MB 多，手機經 Tailscale 抓到一半斷是會發生的）。瀏覽器給的字都是英文（Chrome「Failed to fetch」、Safari「Load failed」）：用白話講連不上。
 *     本文要在這裡讀完（res.text()）：之前讀本文與解析包在 res.json() 裡、落在下面那一段，斷線時那一句還是帶英文（畫面審查在真瀏覽器量到的）。
 * (2) 回來的不是 JSON（網址打成網頁、打成 App 自己的 /app/）：白話講不是打包檔、檢查網址——解析錯誤的原文（「Unexpected token '<'…」）他看不懂。
 * (3) 其餘（伺服器回了錯誤狀態、這不是 Trip Pilot 的打包檔、打包檔比 App 新、存不進這台裝置）照舊把原文帶出來（那幾句本來就是白話）。
 * 哪一種都不動現有的旅程：readPack 丟錯在寫入與換畫面之前。
 */
export async function updateFromUrl() {
  const url = state.device.packUrl;
  if (!url) { state.packStatus = TEXT.needUrl; render(); return; }
  state.packStatus = TEXT.updating; render();
  let res; let body = null;
  try {
    res = await fetch(url, { cache: 'no-store' });
    if (res.ok) body = await res.text();
  } catch { state.packStatus = TEXT.updateOffline(Boolean(state.trip)); render(); return; }
  try {
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await applyPackJson(parsePackText(body, TEXT.updateNotJson));
  } catch (err) {
    state.packStatus = TEXT.updateFailed(err.message, Boolean(state.trip)); render();
  }
}

/** 打包檔的文字 → 物件；不是 JSON 就丟一句白話（notJson），不讓解析錯誤的英文原文跑到畫面上。 */
function parsePackText(text, notJson) {
  try { return JSON.parse(text); } catch { throw new Error(notJson); }
}

export async function importFile(file) {
  try { await applyPackJson(parsePackText(await file.text(), TEXT.importNotJson)); } catch (err) { state.packStatus = TEXT.updateFailed(err.message, Boolean(state.trip)); render(); }
}

export function saveDevice(partial) {
  state.device = { ...state.device, ...partial };
  saveJSON(SETTINGS_KEY, state.device);
  replanAll();
}

/** 現場狀態：index 是選的那天走到第幾站，progress[date] 按日期記著（換日期接那天的進度，不歸零；T13）；applied[date] 是現場套過的改案快照；visited[poiId] 是走廊清單按過「我進去了」的（T15）。 */
export function setField(partial) {
  state.field = mergeField(state.field, partial);
  saveJSON(FIELD_KEY, state.field);
  render();
}

/**
 * 隔天早上真的打開 App（boot、回前景）：真實模式、今天是旅程的一天、現場頁還停在前一天 → 換到今天，進度接那天的，補評卡（T13）才會自己出現（原話 #134）。
 * 只在這兩個時刻做，使用中不做；試走模式不動；日期沒變就不重畫（評分的 sheet 不會被收掉）。
 */
export function catchUpToday() {
  if (!state.trip) return;
  const date = catchUpFieldDate(state.field, state.trip.days.map((d) => d.date), todayStr());
  if (!date || date === state.field.date) return;
  state.planScroll = true;   // 真的換了日期：規劃頁捲到今天（原話 #175）；setField 會重畫
  setField({ date });
}

// ---- 需求單（T26） ----
/** 改需求單：updater 收現況、回新單；每改一個欄位就存（打字的欄位傳 rerender:false，重畫會把焦點踢掉）。 */
export function setBrief(updater, { rerender = true } = {}) {
  const prev = state.brief;
  const next = typeof updater === 'function' ? updater(state.brief) : updater;
  state.brief = { ...next, updatedAt: new Date().toISOString() };
  saveJSON(BRIEF_KEY, state.brief);
  replanIfPersonsChanged(prev);
  if (rerender) render();
}

/** 需求單的同行者會影響排程的那幾樣（engine/persons.js 覆蓋層：在場（dates，含「只同行哪幾天」讀出來的）、體力、夜間站、不去的店型；名字、要去的不算）。 */
function personsKey(brief) {
  return JSON.stringify(personsOf(state.trip, brief, null, cityNamesOf(state.kb)).map((p) => [p.source, p.dates, p.adjustments.stamina, p.adjustments.nightSlot, p.adjustments.avoidCategories]));
}

/**
 * 需求單改了（T19）：旅程檔沒 persons、而需求單的 city／dates 對得上時，同行者的在場、體力與夜間站直接生效在排程上，所以那幾樣變了就要重排；
 * 打名字、要去的那些不重排（跟排程無關）。在需求單頁上不當場排：重排一次接近 1 秒（T16 量的，仙台包 8/13 常撞 800 ms 預算），select 一改就凍住、
 * 「只同行哪幾天」與城市欄每打一個字都可能對上、重畫又會踢掉焦點——所以只記著（replanPending），離開需求單頁那一下再排（flushPendingReplan，先畫「正在重排…」）；
 * 不在需求單頁改的（沒有這種入口，保險）走 afterPaint 當場排。重開 App 時 loadFromPack 本來就整趟重排，記著的不會漏。
 */
function replanIfPersonsChanged(prevBrief) {
  if (!state.trip) return;
  if (personsKey(prevBrief) === personsKey(state.brief)) return;
  if (state.route === '#/brief') { state.replanPending = true; return; }
  afterPaint(replan);
}

/** 換頁時補跑需求單頁欠下的重排（有排就回 true，afterPaint 自己會畫兩次：先「正在重排…」、排完再畫）。 */
function flushPendingReplan() {
  if (!state.replanPending || state.route === '#/brief' || !state.trip) return false;
  afterPaint(replan);
  return true;
}

/** 把這份單子的消耗品與他要買的記進記憶（存檔、複製、換掉這份之前都做；原話 #87）。 */
export function rememberBrief() {
  state.briefMemory = rememberFromBrief(state.briefMemory, state.brief);
  saveJSON(BRIEF_MEMORY_KEY, state.briefMemory);
}

/** 整份換掉（載入、清空）：先記憶（畫面承諾「勾了消耗品，下次會帶出來問」，不能因為沒存檔就漏掉），非空的舊單留一份給「復原上一份」。 */
function replaceBrief(next) {
  rememberBrief();
  const prev = state.brief;
  state.briefUndo = isBriefEmpty(state.brief) ? null : state.brief;
  state.brief = next;
  saveJSON(BRIEF_KEY, state.brief);
  forgetSubmitted();
  replanIfPersonsChanged(prev);
}

/** 換了一份單子（載入、清空、復原）：上次交到哪個檔就不再算數——那是另一份單子的事，不拿來提醒「檔名變了」。 */
function forgetSubmitted() {
  state.briefSubmitted = null;
  removeJSON(BRIEF_SUBMITTED_KEY);
}

/** 復原上一份（只對最後一次載入／清空有效）。 */
export function undoBrief() {
  if (!state.briefUndo) return;
  const prev = state.brief;
  state.brief = state.briefUndo;
  state.briefUndo = null;
  saveJSON(BRIEF_KEY, state.brief);
  forgetSubmitted();
  replanIfPersonsChanged(prev);
  state.briefStatus = TEXT.brief.undone;
  state.briefCopyText = null;
  render();
}

/** 存成檔案：JSON 下載，檔名 brief-<城市>-<起日>.json。 */
export function exportBrief() {
  rememberBrief();
  const name = briefFileName(state.brief);
  downloadText(name, JSON.stringify(state.brief, null, 2), 'application/json');
  state.briefStatus = TEXT.brief.exported(name);
  state.briefCopyText = null;
  render();
}

/** 複製需求單文字（brief-template 格式）；剪貼簿不給用（非 https、瀏覽器不支援）就把文字放進頁上的框讓他自己複製。 */
export async function copyBrief() {
  rememberBrief();
  // 主題勾選框照這趟國家層的清單印（T20；沒旅程就預設五個）
  const text = briefToMarkdown(state.brief, { themes: themeOptions(state.country) });
  try {
    await navigator.clipboard.writeText(text);
    state.briefStatus = TEXT.brief.copied;
    state.briefCopyText = null;
  } catch {
    state.briefStatus = TEXT.brief.copyFailed;
    state.briefCopyText = text;
  }
  render();
  return text;
}

/**
 * 從檔案載入：只收需求單形狀的 JSON（looksLikeBrief）——旅程檔、打包檔、{} 經 normalizeBrief 都會變成空單，之前會把填好的整份蓋掉還顯示「已載入」。
 * 不是 JSON 也用中文講，不露瀏覽器的英文錯誤。載入成功才換掉現有的（先記憶、留一次復原）。
 */
export async function importBrief(file) {
  let raw;
  try { raw = JSON.parse(await file.text()); } catch { raw = undefined; }
  if (raw === undefined) state.briefStatus = TEXT.brief.importFailed(TEXT.brief.notJson);
  else if (!looksLikeBrief(raw)) state.briefStatus = TEXT.brief.importFailed(TEXT.brief.notBriefFile);
  // 手打的中文主題照這趟國家層的清單翻回 id（T20 審查後；沒旅程就只認預設五個）——開機那次 normalizeBrief 沒帶：存著的已經是 id，而且那時還不知道國家
  else { replaceBrief(normalizeBrief(raw, { themes: themeOptions(state.country) })); state.briefStatus = TEXT.brief.imported; }
  state.briefCopyText = null;
  render();
}

export function clearBrief() {
  replaceBrief(emptyBrief());
  state.briefStatus = TEXT.brief.cleared;
  state.briefCopyText = null;
  render();
}

// ---- 需求單「提交」（原話 #186、#188） ----
/**
 * 三個時限（毫秒；物件是為了測試調得短，平常不改）：
 * probeMs＝探測端點最多等多久（桌機本機幾毫秒就回；經 tailscale 而桌機沒開時會掛著）；
 * reprobeMs＝上次連不上、再按「提交」時重探一次最多等多久——要短，另存對話框只在按鍵那一下手勢後的幾秒內開得起來；
 * postMs＝送出最多等多久，含讀完回應的本文；超過當作沒交到，改走存檔。
 */
export const BRIEF_TIMING = { probeMs: 4000, reprobeMs: 1500, postMs: 8000 };

/**
 * 有時限的 fetch（AbortSignal.timeout 在 Safari 15 還沒有，自己接計時器）。read(res) 給了就在同一個時限內把本文也讀完、回 { res, body }——
 * 之前計時器在標頭到的那一刻就停，標頭到了本文卻卡住時（經 tailscale 中途斷線）讀本文會一直等、提交卡在「提交中…」（上一批審查的第 2 條）。
 */
async function fetchWithin(ms, url, init, read = null) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetch(url, { ...init, signal: ctl.signal });
    return read ? { res, body: await read(res) } : res;
  } finally { clearTimeout(timer); }
}

/** 需求單的入口（設定頁那顆、空白頁「先填需求單」）此刻出不出現：交得出去的環境才出現。 */
const briefEntryShown = () => canSubmitBrief(briefEnv(state));
let briefProbing = null;   // 還沒回來的那次探測：submitBrief 在結果未知（briefEndpoint null）或上次連不上時先等它（等完不另外重探），不然剛開頁面就按「提交」會白跳一次另存對話框

/**
 * 探測同源的提交端點（進 App 一次、每次進需求單頁一次），結果記在 state.briefEndpoint。頁面是桌機伺服器供應的（網址在 …/app/ 底下）才問，
 * 問相對網址 ../brief（data/brief.js briefEndpointFor）；GitHub Pages 上的頁面不問、直接算沒有。
 * 用 HEAD 不用 GET：service worker 對同源 GET 一律 cache-first、還把 200 存進快取（sw.js），GET 探測第一次成功之後伺服器關了它照樣回「收」；非 GET 的請求 SW 不攔。
 * 認 X-Trip-Pilot-Brief 標頭，不是只看 200（有的主機對什麼路徑都回 200）。拿到標頭後把本文讀完（HEAD 沒有本文、立刻回）：不讀的話 Chrome 的網路紀錄會把這筆記成「收到 200 之後被取消」。
 * 連不上（沒有回應、逾時）另外記 state.briefUnreachable：那不是伺服器說不收，下次按「提交」會先重探一次（submitBrief）。
 * 入口因此從沒有變有（或反過來）、而且現在畫著入口的那頁（設定頁、沒旅程的空白頁）才重畫；需求單頁的畫面不看這個結果，重畫只會把打字中的焦點踢掉。
 */
export function probeBriefEndpoint(ms = BRIEF_TIMING.probeMs) {
  const run = (async () => {
    const url = briefEndpointFor(globalThis.location?.pathname);
    let ok = false;
    let unreachable = false;
    if (url) {
      try {
        const { res } = await fetchWithin(ms, url, { method: 'HEAD', cache: 'no-store' }, (r) => r.text());
        ok = res.ok && res.headers.get('x-trip-pilot-brief') === 'accepts';
      } catch { ok = false; unreachable = true; }
    }
    const shown = briefEntryShown();
    state.briefEndpoint = ok;
    state.briefUnreachable = unreachable;
    if (briefEntryShown() !== shown && (state.route === '#/settings' || (!state.trip && state.route !== '#/brief'))) render();
    return ok;
  })();
  briefProbing = run;
  const done = () => { if (briefProbing === run) briefProbing = null; };
  run.then(done, done);
  return run;
}

/**
 * 送到同源端點：POST ../brief?name=<名字>，本文是需求單文字。回 { ok: true, file, history }（file＝伺服器實際寫的「trips/<名字>.brief.md」；
 * history＝這次換下來的舊檔搬去哪，沒換掉東西是 null）或 { ok: false, reason, gone }——
 * reason 是 text.js 的中文（伺服器回的代碼在 submitErrors 找得到就用那句，不然講狀態碼）；gone＝這個端點不能用了（連不上、逾時、404／405、不收、不認這個來源），之後當它不在；
 * lost＝其中「連不上或逾時」那一種（含標頭到了、本文在時限內沒來）——不是伺服器明講不收，下次按「提交」先重探一次。
 */
async function postBrief(name, text) {
  const E = TEXT.brief.submitErrors;
  const url = briefEndpointFor(globalThis.location?.pathname);
  if (!url) return { ok: false, gone: true, reason: E.offline };
  let res;
  let raw;
  try {
    ({ res, body: raw } = await fetchWithin(BRIEF_TIMING.postMs, `${url}?name=${encodeURIComponent(name)}`, { method: 'POST', headers: { 'Content-Type': 'text/markdown; charset=utf-8' }, body: text, cache: 'no-store' }, (r) => r.text()));
  } catch { return { ok: false, gone: true, lost: true, reason: E.offline }; }
  let data = null;
  try { data = JSON.parse(raw); } catch { data = null; }
  if (res.ok && data?.ok === true && typeof data.file === 'string' && data.file) return { ok: true, file: data.file, history: typeof data.history === 'string' && data.history ? data.history : null };
  if (res.ok) return { ok: false, gone: true, reason: E.offline };   // 回 200 卻不是這支伺服器的答案（別的東西接了這個網址）：當它不在
  const code = typeof data?.error === 'string' ? data.error : '';
  const known = Object.prototype.hasOwnProperty.call(E, code) && typeof E[code] === 'string' ? E[code] : null;
  return { ok: false, gone: res.status === 404 || res.status === 405 || code === 'disabled' || code === 'cross-origin', reason: known ?? E.http(res.status) };
}

/**
 * 另存對話框（File System Access API）：建議檔名 <名字>.brief.md；id 讓瀏覽器記住上次存的資料夾——第一次選 trip-pilot 的 trips，之後都開在那。
 * 回 { via: 'picker', file }（存好了）、{ via: 'cancelled' }（他按取消，不算錯）、{ via: 'failed', opened }（對話框開不起來 opened false——沒有使用者手勢、被政策擋；
 * 或開了但寫不進去 opened true）——failed 由呼叫端改成下載。
 */
async function saveBriefWithPicker(fileName, text) {
  let handle;
  try {
    handle = await globalThis.showSaveFilePicker({ suggestedName: fileName, id: 'trip-pilot-brief', types: [{ description: TEXT.brief.mdFileType, accept: { 'text/markdown': ['.md'] } }] });
  } catch (err) {
    return err?.name === 'AbortError' ? { via: 'cancelled' } : { via: 'failed', opened: false };
  }
  try {
    const writable = await handle.createWritable();
    await writable.write(text);
    await writable.close();
    return { via: 'picker', file: handle.name || fileName };
  } catch {
    return { via: 'failed', opened: true };
  }
}

/**
 * 提交完那一行狀態：交到桌機了講檔案在哪——這次有換掉同名舊檔的話接一句舊的搬去哪（他提交後手改過的那份就是這樣留下來的，要讓他知道去哪找）；
 * 檔名跟上次交的不一樣（改了城市或起日月份）的話接一句舊名那份還在；
 * 存成檔案（另存或下載）請他放進 trips；前一條路沒成功的原因放最前面；他按取消而且沒有別的事要講就不留字。
 */
function briefSubmitText(result, failed) {
  const L = TEXT.brief;
  if (result.via === 'server') return `${L.submitted(result.file)}${result.history ? L.submittedReplaced(result.history) : ''}${result.renamedFrom ? L.submittedRenamed(result.renamedFrom) : ''}`;
  if (result.via === 'cancelled') return failed ? L.submitFailed(failed) : '';
  const lead = failed ? L.submitFellBack(failed) : result.pickerFailed ? L.pickerFailed : '';
  return `${lead}${L.savedForClaude(result.file)}`;
}

/**
 * 提交（原話 #188「需求單在網頁輸出成一份MD檔到 trip-pilot 資料夾 你跟妳說一聲 你再依內容去規劃 也保留了我提交後修改的空間」）：
 * 文字＝briefToMarkdown，跟「複製需求單文字」同一份；檔名 <名字>.brief.md（data/brief.js briefMdName：2026-08-仙台）。依序三條路（briefSubmitMode）：
 * (a) 同源端點會收 → POST 過去，桌機伺服器（tools/serve-packs.mjs）寫成 trips/<名字>.brief.md；同名舊檔內容不同它會先搬到 trips/_brief-history/，
 *     所以他提交後手改、改完再提交都不會丟東西；
 * (b) 沒有端點、瀏覽器有另存對話框 → showSaveFilePicker；
 * (c) 都沒有 → 下載。
 * (a) 沒成功（伺服器沒回應、不收、寫檔失敗）就接著走 (b)／(c)，狀態句最前面講原因：按一次「提交」一定有一份東西出來，除非他自己在對話框按取消。
 * 絕不從頁面去打 http://127.0.0.1 或 Tailscale 的絕對網址：11-06 主控實測 Chrome 156 會卡在「允許連線區域網路」的權限提示、請求送不出去。
 * (b) 的對話框要在按鍵那一下的手勢裡開（瀏覽器只在手勢後幾秒內放行）：沒有端點的頁面走到它之前沒有 await；
 * (a) 失敗後才走到、或等探測等太久的話手勢可能已過期，開不起來就退到下載。
 */
export async function submitBrief() {
  if (state.briefBusy) return null;
  state.briefBusy = true;
  const L = TEXT.brief;
  let result = null;
  let failed = '';   // (a) 沒成功的原因
  try {
    rememberBrief();
    const text = briefToMarkdown(state.brief, { themes: themeOptions(state.country) });
    const name = briefMdName(state.brief, todayStr());
    const fileName = `${name}.brief.md`;
    state.briefCopyText = null;
    // 端點在不在還不知道（剛開頁面就按）、或上次是連不上（伺服器沒開、逾時；不是它明講不收）：先要一個新的答案再決定走哪條路。
    // 有一次探測還在跑就等那一次（最多 probeMs），沒有才用短逾時重探一次（reprobeMs）——之前連不上一次之後這次開頁就不再試，伺服器恢復了再按仍直接跳另存、也不講為什麼（上一批審查的第 1 條）。
    // 等完那一次就是答案，不緊接著再探一次（11-17）：之前剛開頁面就按會先等完開頁那次探測（4 秒）再重探（1.5 秒），最壞 5.5 秒，
    // 超過瀏覽器留著那一下手勢的時間（Chrome 約 5 秒），另存對話框開不起來、退成下載；現在最壞就是一個 probeMs
    // （11-17 真瀏覽器量：探測掛著、一開頁就按，另存對話框從按後 5.5 秒被叫、手勢已過期，變成 4.0 秒、手勢還在）。
    // 上次已經是連不上、這次還在跑的那一次也只等到 reprobeMs：跟另外重探一次等得一樣久，只是不多發一筆（不設上限的話這種情況會從 1.5 秒變成最多 4 秒）。
    // 還是連不上就把原因帶進狀態句。伺服器明講不收的（404／405、不收、不認這個來源）照舊不再問；只有桌機伺服器供應的頁面會等——別處的探測不發請求、當下就有答案，(b) 的對話框前面仍然沒有 await
    if (state.briefEndpoint === null || (state.briefEndpoint === false && state.briefUnreachable)) {
      if (briefProbing) await (state.briefEndpoint === null ? briefProbing : Promise.race([briefProbing, new Promise((resolve) => { setTimeout(resolve, BRIEF_TIMING.reprobeMs); })]));
      else if (state.briefEndpoint === false) await probeBriefEndpoint(BRIEF_TIMING.reprobeMs);
      if (state.briefEndpoint !== true && state.briefUnreachable) failed = L.submitErrors.offline;
    }
    if (briefSubmitMode(briefEnv(state)) === 'server') {
      state.briefStatus = L.submitting;
      render();
      const r = await postBrief(name, text);
      if (r.ok) {
        // 檔名跟著城市與起日月份變：同一份單子改了那兩樣再交會寫成另一個檔，舊名那份伺服器不會動（它不知道是同一趟）——記下上次交到哪，變了就在狀態句提醒
        const before = state.briefSubmitted?.file ?? null;
        result = { via: 'server', file: r.file, history: r.history, renamedFrom: before && before !== r.file ? before : null };
        state.briefSubmitted = { file: r.file };
        saveJSON(BRIEF_SUBMITTED_KEY, state.briefSubmitted);
      } else { failed = r.reason; if (r.gone) { state.briefEndpoint = false; state.briefUnreachable = r.lost === true; } }
    }
    let pickerFailed = false;
    if (!result && state.savePicker) {
      const r = await saveBriefWithPicker(fileName, text);
      if (r.via === 'failed') pickerFailed = r.opened; else result = r;
    }
    if (!result) { downloadText(fileName, text, 'text/markdown'); result = { via: 'download', file: fileName, pickerFailed }; }
    state.briefStatus = briefSubmitText(result, failed);
  } catch (err) {
    console.warn('需求單提交失敗', err);
    state.briefStatus = L.submitFailed(failed || L.submitErrors.unknown);
    result = null;
  } finally {
    state.briefBusy = false;
  }
  render();
  return result;
}

function downloadText(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = el('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const VIEWS = { '#/plan': renderPlanner, '#/now': renderNow, '#/pool': renderPool, '#/settings': renderSettings, '#/brief': renderBrief };
// 沒有旅程也開得了的頁：設定（去更新）、需求單（出發前填）
const WITHOUT_TRIP = new Set(['#/settings', '#/brief']);

export function render() {
  const root = document.getElementById('app');
  if (!root) return;
  clear(root);
  const actions = { swapStop, removeStop, undoLast, dismissUndo, upgradeCorridor, pickInsertOption, cancelInsert, unpinDay, breakfastOff, breakfastBack, takeBreakfast, markVisited, chooseOption, deferStop, dismissNotice, resetTripEdits, saveDevice, setField, replanAll, updateFromUrl, importFile, setBrief, submitBrief, exportBrief, copyBrief, importBrief, clearBrief, undoBrief };
  const view = !state.trip && !WITHOUT_TRIP.has(state.route) ? renderEmpty : (VIEWS[state.route] ?? renderPlanner);
  root.append(el('main', { class: 'view' }, view({ state, actions })));
  root.append(tabBar());
  // 旗標只在畫了規劃頁（有旅程）時消耗：沒旅程那次畫的是空白頁，留到旅程載入後那次；「正在重排…」那次（busy）也先留著，排完那次版面才是最後的
  if (view === renderPlanner && state.trip && state.planScroll && !state.busy) scrollToPlanDay(root);
}

/**
 * 打開規劃頁那一刻捲到當天那一塊（原話 #175「頁面會自動跳到當前日期的位置 不要我每次都下滑到當天位置」）：目標日照 ratings.js planScrollDate（試走模式開著就是試走那天、否則今天），
 * 旅程裡沒有那天就不捲。旗標（state.planScroll）在進頁（boot 的 apply、hashchange）、載入旅程、隔天切到今天時設，畫完就消耗；按鍵重畫（換一家、不去了、復原…）不捲。
 * 頂端貼著的復原列會蓋住日期：量它的高度交給 CSS 的 scroll-margin-top（--bar-h）。scrollIntoView 測試環境沒有，先判。
 */
function scrollToPlanDay(root) {
  state.planScroll = false;
  const date = planScrollDate(state.field, state.trip.days.map((d) => d.date), todayStr());
  if (!date) return;
  const target = [...root.querySelectorAll('section.day')].find((n) => n.dataset.date === date);
  if (!target || typeof target.scrollIntoView !== 'function') return;
  // 復原列與狀態列都是 sticky 在同一個 top，兩條都在時疊在一起，蓋住的高度是較高的那條
  const barH = Math.max(0, ...[...root.querySelectorAll('.undo-bar')].map((b) => b.offsetHeight));
  target.style.setProperty('--bar-h', `${barH}px`);
  target.scrollIntoView({ block: 'start' });
}

function renderEmpty() {
  return [
    el('h1', { text: TEXT.appName }),
    el('p', { class: 'muted', text: TEXT.shellHint }),
    el('div', { class: 'actions' }, [
      el('a', { class: 'btn primary', href: '#/settings' }, TEXT.goUpdate),
      // 「先填需求單」只在交得出去的環境出現（桌機；原話 #186 需求單不在手機跑——iPhone Safari 沒有另存對話框、頁面也不是桌機伺服器供應的）
      briefEntryShown() ? el('a', { class: 'btn', href: '#/brief' }, TEXT.brief.fillFirst) : null,
      el('button', { class: 'btn', type: 'button', onclick: loadDemo }, TEXT.loadDemo),
    ]),
  ];
}

function tabBar() {
  return el('nav', { class: 'tabs', 'aria-label': '主選單' }, Object.entries(TEXT.tabs).map(([key, label]) => {
    const href = `#/${key}`;
    return el('a', { href, class: `tab${state.route === href ? ' active' : ''}` }, label);
  }));
}

export async function boot() {
  buildSettings();
  // 進規劃頁（開 App 落在它、或從別頁切過來）就捲到當天（原話 #175）；沒旅程時那次畫的是空白頁，旗標留到旅程載入後
  // 進需求單頁就問一次同源的提交端點還在不在（probeBriefEndpoint；不等它，結果只影響按「提交」走哪條路與入口出不出現）
  const apply = () => { state.route = location.hash && VIEWS[location.hash] ? location.hash : '#/plan'; if (state.route === '#/plan') state.planScroll = true; if (state.route === '#/brief') void probeBriefEndpoint(); if (!flushPendingReplan()) render(); };
  window.addEventListener('hashchange', apply);
  if (!state.field.date) state.field.date = todayStr();
  readPackParam();
  apply();
  if (state.route !== '#/brief') void probeBriefEndpoint();   // 進 App 也問一次：設定頁與空白頁的需求單入口要不要出現看它（開在需求單頁的話 apply 剛問過）
  try {
    const stored = await loadLatestPack();
    if (stored) { loadFromPack(stored); catchUpToday(); }   // loadFromPack 自己會重排；隔天打開就切到今天
  } catch (err) {
    console.warn('讀不到手機裡的旅程', err);
  }
  // iOS 常殺背景分頁、也常只是切回前景：回前景那一刻再看一次要不要切到今天
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') catchUpToday(); });
}

/** #/settings?pack=<網址>：我給他的連結，點了網址就寫進裝置設定，不用在手機上打字。 */
function readPackParam() {
  const m = location.hash.match(/[?&]pack=([^&]+)/);
  if (!m) return;
  state.device = { ...state.device, packUrl: decodeURIComponent(m[1]) };
  saveJSON(SETTINGS_KEY, state.device);
  location.hash = '#/settings';
}
