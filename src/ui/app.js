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
import { renderBrief } from './brief.js';
import { mergeField, pickFieldDate, catchUpFieldDate } from './ratings.js';
import { restoreApplied, withoutApplied } from './applied.js';
import { upgradePick, visitedPatch, visitedDates } from './corridor.js';
import { chooseOptionTrip, deferStopTrip, deferNotice, displacedPicks } from './choices.js';
import { emptyBrief, normalizeBrief, briefToMarkdown, briefFileName, looksLikeBrief, isBriefEmpty, themeOptions } from '../data/brief.js';
import { normalizeMemory, rememberFromBrief } from '../data/brief-memory.js';
import { personsOf, cityNamesOf } from '../engine/persons.js';

const SETTINGS_KEY = 'trip-pilot:settings';
const FIELD_KEY = 'trip-pilot:field';
const BRIEF_KEY = 'trip-pilot:brief';
const BRIEF_MEMORY_KEY = 'trip-pilot:brief-memory';

export const state = {
  trip: null, pois: {}, country: null, kb: null, legFn: null,
  rules: null, settings: null, plans: {}, pool: [],
  packRules: null, packMeta: null, packStatus: '',
  undo: null,   // 最後一次「不去了」或「升級成站」的復原資料（一次性；kind 'remove'／'upgrade'）
  notice: null,   // 二選一／「排到別天」之後的一句狀態 { text }（T16；下一個動作前都在，不搶 undo）
  busy: false,    // 二選一／「排到別天」正在試排與重排（同步跑、桌機量到接近 1 秒）：先畫一句再算，算完前再按不理（T16 審查後）
  replanPending: false,   // 需求單頁改了會影響排程的東西（同行者的在場、體力、夜間站）還沒重排：離開需求單頁那一下補跑（T19 審查後）
  corridorOpen: {},   // 走廊清單哪幾段展開著（鍵 plan:日期:段／now:日期:段；只在記憶體、不存，重排就清；T15）
  route: '#/plan',
  device: loadJSON(SETTINGS_KEY, {}),
  field: loadJSON(FIELD_KEY, { date: null, index: 0, simulate: false, simNowMin: null, ratings: {}, progress: {}, visited: {} }),
  // 需求單（T26）：出發前在手機上填，存這支手機；記憶是上一份單子的消耗品與要買的（data/brief-memory.js）
  brief: normalizeBrief(loadJSON(BRIEF_KEY, null)),
  briefMemory: normalizeMemory(loadJSON(BRIEF_MEMORY_KEY, null)),
  briefStatus: '',
  briefCopyText: null,   // 剪貼簿不給用時，整份文字放進頁上的框讓他自己複製
  briefUndo: null,       // 載入別份或清空前的那份（一次性「復原上一份」；空單不留）
};

function loadJSON(key, fallback) { try { const v = JSON.parse(localStorage.getItem(key) ?? 'null'); return v ?? fallback; } catch { return fallback; } }
function saveJSON(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* 隱私模式 */ } }

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
  syncFieldDate();
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
  syncFieldDate();
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

export function swapStop(date, fromPoiId, toPoi) {
  const day = state.trip.days.find((d) => d.date === date);
  if (!day) return;
  state.undo = null;   // 換了別家就不再提供上一次「不去了」的復原
  state.notice = null;
  if (!state.pois[toPoi.id]) state.pois[toPoi.id] = toPoi;
  Object.assign(day, applySwap(day, fromPoiId, toPoi));
  clearApplied(date);
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
  replanAll();
}

/** 復原剛才的「不去了」（勾選站放回原位、removed 那筆拿掉）或「升級成站」（那天的 picks 與 removed 放回升級前的那兩個陣列）；只對最後一次有效。 */
export function undoLast() {
  const u = state.undo;
  if (!u) return;
  const day = state.trip.days.find((d) => d.date === u.date);
  state.undo = null;
  state.notice = null;
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
  replanAll();
}

/** planTrip 的其他參數（順延試排用，跟 replanAll 同一份）。 */
function planArgsOf() {
  return { rules: state.rules, settings: state.settings, country: state.country, kb: state.kb, legFn: state.legFn, restPool: Object.values(state.pois), brief: state.brief, options: { visited: visitedDates(state.field.visited) } };
}

/**
 * 二選一選了 B（原話 #119「我選一間，到了 17 號就會自動排進另一間」；T16）：那天的 picks 把 A 換成 B（換這一站的邏輯，換掉的不算落選）、A 順延到別天
 * （engine/choices.js defer：主題日優先、再其餘 normal 日由早到晚，每天用引擎試排，排得進就定案；全排不進就先留在候選池），兩天現場套過的改案清掉、整趟重排；
 * 頂端一句「A 已排到 8/17」或「A 先留在候選池（別天排不進）」，重排擠掉了別的勾選站就接「擠掉了 8/13 的 X」（displacedPicks；state.notice，跟 undo 列同樣式、不搶 undo）。
 * 跟「不去了」不同，沒有一次性復原（待確認）。試排的 baseline 用重排前的 state.plans（當日區域、主題日、購物日那幾樣換站前後一樣，fromDate 自己不在候選日裡）。
 * 試排好幾天再整趟重排是同步的（桌機量到接近 1 秒，10-16 審查）：先畫「正在重排…」再算（afterPaint）。
 */
export function chooseOption(date, fromPoiId, toPoi) {
  if (state.busy || !state.trip?.days.some((d) => d.date === date) || !toPoi || !state.pois[fromPoiId]) return;
  state.undo = null;
  if (!state.pois[toPoi.id]) state.pois[toPoi.id] = toPoi;
  const name = state.pois[fromPoiId].name_zh ?? fromPoiId;
  afterPaint(() => {
    const before = state.plans;
    const r = chooseOptionTrip({ trip: state.trip, pois: state.pois, date, fromPoiId, toPoi, baseline: { days: Object.values(before) }, planArgs: planArgsOf() });
    state.trip = r.trip;
    clearApplied(date);
    if (r.toDate) clearApplied(r.toDate);
    replan();
    state.notice = { text: deferNotice(r.entry, name, displacedPicks({ before, after: state.plans, dates: [date, r.toDate] })) };
  });
}

/** 排不進清單的「排到別天」（T16）：那站直接順延（沒有選的那家）；排到了就從這天的 picks 搬過去，排不進就留在原處、候選頁標「順延中」。擠掉了誰同 chooseOption。 */
export function deferStop(date, poiId) {
  if (state.busy || !state.trip?.days.some((d) => d.date === date) || !state.pois[poiId]) return;
  state.undo = null;
  const name = state.pois[poiId].name_zh ?? poiId;
  afterPaint(() => {
    const before = state.plans;
    const r = deferStopTrip({ trip: state.trip, pois: state.pois, date, poiId, baseline: { days: Object.values(before) }, planArgs: planArgsOf() });
    state.trip = r.trip;
    clearApplied(date);
    if (r.toDate) clearApplied(r.toDate);
    replan();
    state.notice = { text: deferNotice(r.entry, name, displacedPicks({ before, after: state.plans, dates: [date, r.toDate] })) };
  });
}

/**
 * 先畫一句「正在重排…」（state.busy、state.notice）讓他知道按到了，下一個畫格再跑 work（同步的試排與重排），跑完重畫。
 * requestAnimationFrame 之後再 setTimeout 0 才保證那句已經畫出來；沒有 rAF 的環境直接 setTimeout。work 丟錯那句也會清掉、busy 放開。
 */
function afterPaint(work) {
  state.busy = true;
  state.notice = { text: TEXT.working };
  render();
  const run = () => {
    try { work(); } finally {
      state.busy = false;
      if (state.notice?.text === TEXT.working) state.notice = null;
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
  replanIfPersonsChanged(prev);
}

/** 復原上一份（只對最後一次載入／清空有效）。 */
export function undoBrief() {
  if (!state.briefUndo) return;
  const prev = state.brief;
  state.brief = state.briefUndo;
  state.briefUndo = null;
  saveJSON(BRIEF_KEY, state.brief);
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
  const actions = { swapStop, removeStop, undoLast, upgradeCorridor, markVisited, chooseOption, deferStop, dismissNotice, saveDevice, setField, replanAll, updateFromUrl, importFile, setBrief, exportBrief, copyBrief, importBrief, clearBrief, undoBrief };
  const view = !state.trip && !WITHOUT_TRIP.has(state.route) ? renderEmpty : (VIEWS[state.route] ?? renderPlanner);
  root.append(el('main', { class: 'view' }, view({ state, actions })));
  root.append(tabBar());
}

function renderEmpty() {
  return [
    el('h1', { text: TEXT.appName }),
    el('p', { class: 'muted', text: TEXT.shellHint }),
    el('div', { class: 'actions' }, [
      el('a', { class: 'btn primary', href: '#/settings' }, TEXT.goUpdate),
      el('a', { class: 'btn', href: '#/brief' }, TEXT.brief.fillFirst),
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
  const apply = () => { state.route = location.hash && VIEWS[location.hash] ? location.hash : '#/plan'; if (!flushPendingReplan()) render(); };
  window.addEventListener('hashchange', apply);
  if (!state.field.date) state.field.date = todayStr();
  readPackParam();
  apply();
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
