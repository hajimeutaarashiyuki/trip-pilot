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

const SETTINGS_KEY = 'trip-pilot:settings';
const FIELD_KEY = 'trip-pilot:field';

export const state = {
  trip: null, pois: {}, country: null, kb: null, legFn: null,
  rules: null, settings: null, plans: {}, pool: [],
  packRules: null, packMeta: null, packStatus: '',
  route: '#/plan',
  device: loadJSON(SETTINGS_KEY, {}),
  field: loadJSON(FIELD_KEY, { date: null, index: 0, simulate: false, simNowMin: null, ratings: {} }),
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
  if (!state.field.date) state.field.date = state.trip.days[0].date;
  replanAll();
}

/** 從打包檔載入（手機「更新」之後），座標與矩陣有就用。 */
export function loadFromPack(packResult) {
  const { pack, pois } = packResult;
  state.trip = pack.trip;
  state.pois = Object.fromEntries(pois.map((p) => [p.id, p]));
  state.country = pack.country;
  state.kb = { zones: pack.zones?.zones ?? {} };
  state.packRules = pack.rules ?? null;
  state.packMeta = { ...(pack.meta ?? {}), tripId: pack.trip.id, tripName: pack.trip.name ?? pack.trip.id, city: pack.city ?? null };
  buildSettings();
  state.legFn = makeLegFn({ walk: pack.walk?.pairs ?? {}, settings: state.settings, zoneLinks: pack.zones?.links ?? {} });
  state.pool = pois.map((poi) => ({ poi }));
  if (!state.field.date) state.field.date = state.trip.days[0].date;
  replanAll();
}

export function replanAll() {
  buildSettings();
  if (!state.trip) return;
  // restPool：整個知識庫都給引擎挑恢復站（trip.js 會篩成當日區域內、沒勾、沒拒絕的幾家）；示範資料也一樣
  const r = planTrip({ trip: state.trip, pois: state.pois, rules: state.rules, settings: state.settings, country: state.country, kb: state.kb, legFn: state.legFn, restPool: Object.values(state.pois) });
  state.plans = Object.fromEntries(r.days.map((d) => [d.date, d]));
  render();
}

export function swapStop(date, fromPoiId, toPoi) {
  const day = state.trip.days.find((d) => d.date === date);
  if (!day) return;
  if (!state.pois[toPoi.id]) state.pois[toPoi.id] = toPoi;
  Object.assign(day, applySwap(day, fromPoiId, toPoi));
  replanAll();
}

/** 不去了：他勾的站從 picks 拿掉；引擎插的站（insertedBy 'engine'）不在 picks，記進 removed 就是拒絕，trip.js 看到那天不再插（原話 #126、profile §2.4）。 */
export function removeStop(date, poiId, insertedBy = null) {
  const day = state.trip.days.find((d) => d.date === date);
  if (!day) return;
  day.picks = (day.picks ?? []).filter((p) => p.poiId !== poiId);
  day.removed = [...(day.removed ?? []), { poiId, at: new Date().toISOString(), ...(insertedBy ? { insertedBy } : {}) }];   // 不算落選（原話 #91）
  replanAll();
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

export function setField(partial) {
  state.field = { ...state.field, ...partial };
  saveJSON(FIELD_KEY, state.field);
  render();
}

const VIEWS = { '#/plan': renderPlanner, '#/now': renderNow, '#/pool': renderPool, '#/settings': renderSettings };

export function render() {
  const root = document.getElementById('app');
  if (!root) return;
  clear(root);
  const actions = { swapStop, removeStop, saveDevice, setField, replanAll, updateFromUrl, importFile };
  const view = !state.trip && state.route !== '#/settings' ? renderEmpty : (VIEWS[state.route] ?? renderPlanner);
  root.append(el('main', { class: 'view' }, view({ state, actions })));
  root.append(tabBar());
}

function renderEmpty() {
  return [
    el('h1', { text: TEXT.appName }),
    el('p', { class: 'muted', text: TEXT.shellHint }),
    el('div', { class: 'actions' }, [
      el('a', { class: 'btn primary', href: '#/settings' }, TEXT.goUpdate),
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
  const apply = () => { state.route = location.hash && VIEWS[location.hash] ? location.hash : '#/plan'; render(); };
  window.addEventListener('hashchange', apply);
  if (!state.field.date) state.field.date = todayStr();
  readPackParam();
  apply();
  try {
    const stored = await loadLatestPack();
    if (stored) { loadFromPack(stored); replanAll(); }
  } catch (err) {
    console.warn('讀不到手機裡的旅程', err);
  }
}

/** #/settings?pack=<網址>：我給他的連結，點了網址就寫進裝置設定，不用在手機上打字。 */
function readPackParam() {
  const m = location.hash.match(/[?&]pack=([^&]+)/);
  if (!m) return;
  state.device = { ...state.device, packUrl: decodeURIComponent(m[1]) };
  saveJSON(SETTINGS_KEY, state.device);
  location.hash = '#/settings';
}
