// 控制器：狀態、路由（hash）、重排、換站、設定。畫面各自一檔只負責畫與回呼。
import { el, clear, todayStr } from './dom.js';
import { TEXT } from './text.js';
import { loadRules } from '../rules/index.js';
import { BUILTIN } from '../rules/builtin.js';
import rulesJson from '../rules.json' with { type: 'json' };
import { planTrip } from '../engine/trip.js';
import { applySwap } from '../engine/swap.js';
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
import { upgradePick, visitedPatch, visitedDates } from './corridor.js';
import { chooseOptionTrip, deferStopTrip, deferNotice, displacedPicks } from './choices.js';
import { emptyBrief, normalizeBrief, briefToMarkdown, briefFileName, looksLikeBrief, isBriefEmpty, themeOptions, briefMdName, briefSubmitMode, canSubmitBrief, briefEndpointFor } from '../data/brief.js';
import { normalizeMemory, rememberFromBrief } from '../data/brief-memory.js';
import { personsOf, cityNamesOf } from '../engine/persons.js';

const SETTINGS_KEY = 'trip-pilot:settings';
const FIELD_KEY = 'trip-pilot:field';
const BRIEF_KEY = 'trip-pilot:brief';
const BRIEF_MEMORY_KEY = 'trip-pilot:brief-memory';
const TRIP_EDITS_KEY = 'trip-pilot:trip-edits';   // 規劃頁的改動（T16b；ui/trip-edits.js）：整天的 picks／removed／swapped 與 deferred 快照
const BRIEF_SUBMITTED_KEY = 'trip-pilot:brief-submitted';   // 這份需求單上次交到桌機的哪個檔（{ file }）：檔名跟著城市與起日月份變，變了再交時要提醒舊名那份還在

export const state = {
  trip: null, pois: {}, country: null, kb: null, legFn: null,
  rules: null, settings: null, plans: {}, pool: [],
  packRules: null, packMeta: null, packStatus: '',
  undo: null,   // 最後一次「不去了」「升級成站」「或 B」「排到別天」的復原資料（一次性；kind 'remove'／'upgrade'／'choose'／'defer'；原話 #171、#181）
  notice: null,   // 不是動作的一句狀態 { text }：「旅程更新過了，上一版的改動已丟掉」「正在重排…」（下一個動作前都在，不搶 undo；二選一／排到別天那句改放 undo.text，原話 #181）
  busy: false,    // 二選一／「排到別天」正在試排與重排（同步跑、桌機量到接近 1 秒）：先畫一句再算，算完前再按不理（T16 審查後）
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
  state.plans = Object.fromEntries(r.days.map((d) => [d.date, d]));
  // 現場套過的改案（field.applied）活過重排與重開：打包相同就還原整條序列、整天重算；不同（手機更新了新打包）就丟掉並在那天警告一行
  const restored = restoreApplied({ plans: state.plans, applied: state.field.applied, packAt: state.packMeta?.generatedAt ?? null, pois: state.pois, trip: state.trip, legFn: state.legFn, rules: state.rules, settings: state.settings, country: state.country, kb: state.kb, visited });
  state.plans = restored.plans;
  if (restored.dropped.length) { state.field = mergeField(state.field, { applied: restored.applied }); saveJSON(FIELD_KEY, state.field); }
  state.corridorOpen = {};   // 重排後段的編號會變，展開的走廊清單全收起（「我進去了」只重畫不重排，照舊開著）
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
 * 規劃頁每個動作改完 state.trip 之後存一次（swapStop／removeStop／undoLast／upgradeCorridor／chooseOption／deferStop，重排之前）：
 * 整天的 picks／removed／swapped 與整趟的 deferred 快照，不是差分（跟 applied 一樣簡單）。跟打包那版一模一樣（不去了又復原）就把鍵刪掉：
 * 不然下次更新打包會白講一句「上一版的改動已丟掉」。
 */
function saveTripEdits() {
  if (!state.trip) return;
  if (!diffTripEdits(state.trip, state.tripBase).any) { removeJSON(TRIP_EDITS_KEY); return; }
  saveJSON(TRIP_EDITS_KEY, snapshotTripEdits(state.trip, packAtNow()));
}

/**
 * 設定頁「還原成打包版」（按兩次確認，settings.js）：鍵刪掉、days 的三個陣列與 deferred 放回打包那版（tripBase）、
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

export function swapStop(date, fromPoiId, toPoi) {
  const day = state.trip.days.find((d) => d.date === date);
  if (!day) return;
  state.undo = null;   // 換了別家就不再提供上一次「不去了」的復原
  state.notice = null;
  if (!state.pois[toPoi.id]) state.pois[toPoi.id] = toPoi;
  Object.assign(day, applySwap(day, fromPoiId, toPoi));
  clearApplied(date);
  saveTripEdits();
  replanAll();
}

/** 不去了：他勾的站從 picks 拿掉；引擎插的站（insertedBy 'engine'）不在 picks，記進 removed 就是拒絕，trip.js 看到那天不再插同一種（priority 'rest' 恢復站／'filler' 填站；原話 #126、profile §2.4）。 */
export function removeStop(date, poiId, insertedBy = null, priority = null) {
  const day = state.trip.days.find((d) => d.date === date);
  if (!day) return;
  const pickIndex = (day.picks ?? []).findIndex((p) => p.poiId === poiId);
  const pick = pickIndex >= 0 ? day.picks[pickIndex] : null;
  const removedEntry = { poiId, at: new Date().toISOString(), ...(insertedBy ? { insertedBy } : {}), ...(priority ? { priority } : {}) };
  day.picks = (day.picks ?? []).filter((p) => p.poiId !== poiId);
  day.removed = [...(day.removed ?? []), removedEntry];   // 不算落選（原話 #91）
  // 一次性的復原（原話 #171「如果我按不去了 也要一次性的恢復按鈕 進行第二次確認或反悔的機會」）：記住剛拿掉的，下一個動作前都能按「復原」
  state.undo = { kind: 'remove', date, poiId, name: state.pois[poiId]?.name_zh ?? poiId, pick, pickIndex, removedEntry };
  state.notice = null;
  clearApplied(date);
  saveTripEdits();
  replanAll();
}

/**
 * 復原剛才的「不去了」（勾選站放回原位、removed 那筆拿掉）、「升級成站」（那天的 picks 與 removed 放回升級前的那兩個陣列）、
 * 或「或 B」「排到別天」（原話 #181：整趟的 picks／removed／swapped 與 deferred 放回動作前的快照，跟設定頁「還原成打包版」同一套；動到的那兩天現場改案清掉）；只對最後一次有效。
 */
export function undoLast() {
  const u = state.undo;
  if (!u) return;
  state.undo = null;
  state.notice = null;
  if (u.kind === 'choose' || u.kind === 'defer') {
    state.trip = overlayTripEdits(state.trip, JSON.parse(JSON.stringify(u.before)));
    for (const date of u.dates) clearApplied(date);
    saveTripEdits();
    replanAll();
    return;
  }
  const day = state.trip.days.find((d) => d.date === u.date);
  if (!day) return;
  if (u.kind === 'upgrade') Object.assign(day, u.before);
  else {
    day.removed = (day.removed ?? []).filter((r) => r !== u.removedEntry);
    if (u.pick && !(day.picks ?? []).some((p) => p.poiId === u.poiId)) {
      const picks = [...(day.picks ?? [])];
      picks.splice(Math.min(u.pickIndex, picks.length), 0, u.pick);
      day.picks = picks;
    }
  }
  clearApplied(u.date);
  saveTripEdits();
  replanAll();
}

/**
 * 走廊清單升級成站（原話 #124；T15）：加進那天的 picks（priority want）、那天現場套過的改案清掉、重排；它就不再是走廊清單、變成他勾的站（「不去了」照一般站走）。
 * 重排會動整天（10-16 審查：8/13 升級 Room-9 後指定站換位、他勾的珈巣多夢落到排不進），所以跟「不去了」一樣留一次性的復原（原話 #171）：
 * 升級前那天的 picks 與 removed 原封記著（upgradePick 回新陣列、不改舊的），按「復原」放回去重排。
 */
export function upgradeCorridor(date, poiId) {
  const day = state.trip.days.find((d) => d.date === date);
  if (!day || !state.pois[poiId]) return;
  state.undo = { kind: 'upgrade', date, poiId, name: state.pois[poiId]?.name_zh ?? poiId, before: { picks: day.picks ?? [], removed: day.removed ?? [] } };
  state.notice = null;
  Object.assign(day, upgradePick(day, poiId));
  clearApplied(date);
  saveTripEdits();
  replanAll();
}

/** planTrip 的其他參數（順延試排用，跟 replanAll 同一份）。 */
function planArgsOf() {
  return { rules: state.rules, settings: state.settings, country: state.country, kb: state.kb, legFn: state.legFn, restPool: Object.values(state.pois), brief: state.brief, options: { visited: visitedDates(state.field.visited) } };
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
    const r = chooseOptionTrip({ trip: state.trip, pois: state.pois, date, fromPoiId, toPoi, baseline: { days: Object.values(plansBefore) }, planArgs: planArgsOf() });
    state.trip = r.trip;
    clearApplied(date);
    if (r.toDate) clearApplied(r.toDate);
    saveTripEdits();
    replan();
    state.undo = { kind: 'choose', dates: [date, r.toDate].filter(Boolean), before, name, text: deferNotice(r.entry, name, displacedPicks({ before: plansBefore, after: state.plans, dates: [date, r.toDate] })) };
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
    const r = deferStopTrip({ trip: state.trip, pois: state.pois, date, poiId, baseline: { days: Object.values(plansBefore) }, planArgs: planArgsOf() });
    state.trip = r.trip;
    clearApplied(date);
    if (r.toDate) clearApplied(r.toDate);
    saveTripEdits();
    replan();
    state.undo = { kind: 'defer', dates: [date, r.toDate].filter(Boolean), before, name, text: deferNotice(r.entry, name, displacedPicks({ before: plansBefore, after: state.plans, dates: [date, r.toDate] })) };
    state.notice = null;
  });
}

/**
 * 先畫一句「正在重排…」（state.busy、state.notice）讓他知道按到了，下一個畫格再跑 work（同步的試排與重排），跑完重畫。
 * requestAnimationFrame 之後再 setTimeout 0 才保證那句已經畫出來；沒有 rAF 的環境直接 setTimeout。work 丟錯那句也會清掉、busy 放開。
 */
function afterPaint(work) {
  state.busy = true;
  const before = state.notice;   // 本來就在的那句（例如「旅程更新過了，上一版的改動已丟掉」）work 沒換掉就放回去，不被「正在重排…」吃掉（10-16 審查）
  state.notice = { text: TEXT.working };
  render();
  const run = () => {
    try { work(); } finally {
      state.busy = false;
      if (state.notice?.text === TEXT.working) state.notice = before ?? null;
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

export async function updateFromUrl() {
  const url = state.device.packUrl;
  if (!url) { state.packStatus = TEXT.needUrl; render(); return; }
  state.packStatus = TEXT.updating; render();
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await applyPackJson(await res.json());
  } catch (err) {
    state.packStatus = TEXT.updateFailed(err.message); render();
  }
}

export async function importFile(file) {
  try { await applyPackJson(JSON.parse(await file.text())); } catch (err) { state.packStatus = TEXT.updateFailed(err.message); render(); }
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
const BRIEF_PROBE_MS = 4000;   // 探測端點最多等多久（桌機本機幾毫秒就回；經 tailscale 而桌機沒開時會掛著）
const BRIEF_POST_MS = 8000;    // 送出最多等多久；超過當作沒交到，改走存檔

/** 有時限的 fetch（AbortSignal.timeout 在 Safari 15 還沒有，自己接計時器）。 */
async function fetchWithin(ms, url, init) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try { return await fetch(url, { ...init, signal: ctl.signal }); } finally { clearTimeout(timer); }
}

/** 需求單的入口（設定頁那顆、空白頁「先填需求單」）此刻出不出現：交得出去的環境才出現。 */
const briefEntryShown = () => canSubmitBrief(briefEnv(state));
let briefProbing = null;   // 還沒回來的那次探測：submitBrief 在結果未知（briefEndpoint null）時先等它，不然剛開頁面就按「提交」會白跳一次另存對話框

/**
 * 探測同源的提交端點（進 App 一次、每次進需求單頁一次），結果記在 state.briefEndpoint。頁面是桌機伺服器供應的（網址在 …/app/ 底下）才問，
 * 問相對網址 ../brief（data/brief.js briefEndpointFor）；GitHub Pages 上的頁面不問、直接算沒有。
 * 用 HEAD 不用 GET：service worker 對同源 GET 一律 cache-first、還把 200 存進快取（sw.js），GET 探測第一次成功之後伺服器關了它照樣回「收」；非 GET 的請求 SW 不攔。
 * 認 X-Trip-Pilot-Brief 標頭，不是只看 200（有的主機對什麼路徑都回 200）。
 * 入口因此從沒有變有（或反過來）、而且現在畫著入口的那頁（設定頁、沒旅程的空白頁）才重畫；需求單頁的畫面不看這個結果，重畫只會把打字中的焦點踢掉。
 */
export function probeBriefEndpoint() {
  const run = (async () => {
    const url = briefEndpointFor(globalThis.location?.pathname);
    let ok = false;
    if (url) {
      try {
        const res = await fetchWithin(BRIEF_PROBE_MS, url, { method: 'HEAD', cache: 'no-store' });
        ok = res.ok && res.headers.get('x-trip-pilot-brief') === 'accepts';
      } catch { ok = false; }
    }
    const shown = briefEntryShown();
    state.briefEndpoint = ok;
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
 * reason 是 text.js 的中文（伺服器回的代碼在 submitErrors 找得到就用那句，不然講狀態碼）；gone＝這個端點不能用了（連不上、逾時、404／405、不收、不認這個來源），之後當它不在。
 */
async function postBrief(name, text) {
  const E = TEXT.brief.submitErrors;
  const url = briefEndpointFor(globalThis.location?.pathname);
  if (!url) return { ok: false, gone: true, reason: E.offline };
  let res;
  try {
    res = await fetchWithin(BRIEF_POST_MS, `${url}?name=${encodeURIComponent(name)}`, { method: 'POST', headers: { 'Content-Type': 'text/markdown; charset=utf-8' }, body: text, cache: 'no-store' });
  } catch { return { ok: false, gone: true, reason: E.offline }; }
  let data = null;
  try { data = await res.json(); } catch { data = null; }
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
    // 探測還沒回來（剛開頁面就按）：等它，最多 BRIEF_PROBE_MS。只有桌機伺服器供應的頁面會等——別處的探測不發請求、當下就有答案，(b) 的對話框前面仍然沒有 await
    if (state.briefEndpoint === null && briefProbing) await briefProbing;
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
      } else { failed = r.reason; if (r.gone) state.briefEndpoint = false; }
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
  const actions = { swapStop, removeStop, undoLast, upgradeCorridor, markVisited, chooseOption, deferStop, dismissNotice, resetTripEdits, saveDevice, setField, replanAll, updateFromUrl, importFile, setBrief, submitBrief, exportBrief, copyBrief, importBrief, clearBrief, undoBrief };
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
