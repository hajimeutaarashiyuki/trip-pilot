// 控制器：狀態、路由（hash）、重排、換站、設定。畫面各自一檔只負責畫與回呼。
import { el, clear, todayStr } from './dom.js';
import { TEXT } from './text.js';
import { loadRules } from '../rules/index.js';
import { BUILTIN } from '../rules/builtin.js';
import rulesJson from '../rules.json' with { type: 'json' };
import { planTrip } from '../engine/trip.js';
import { applySwap } from '../engine/swap.js';
import { makeLegFn } from '../geo/matrix.js';
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
  route: '#/plan',
  device: loadJSON(SETTINGS_KEY, {}),
  field: loadJSON(FIELD_KEY, { date: null, index: 0, simulate: false, simNowMin: null, ratings: {} }),
};

function loadJSON(key, fallback) { try { const v = JSON.parse(localStorage.getItem(key) ?? 'null'); return v ?? fallback; } catch { return fallback; } }
function saveJSON(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* 隱私模式 */ } }

/** 把四個裝置設定套進引擎設定與規則（決策樹 Q17）。 */
function buildSettings() {
  const base = { ...rulesJson.settings };
  const d = state.device;
  if (Number.isFinite(d.walkBudgetMin)) base.walkBudgetMin = d.walkBudgetMin;
  if (Number.isFinite(d.openSlotMinPerDay)) base.openSlotMinPerDay = d.openSlotMinPerDay;
  if (d.departHM) base.dayWindow = [d.departHM, base.dayWindow[1]];
  const config = { ...rulesJson.rules };
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
  state.kb = { zones: pack.zones ?? {} };
  state.legFn = makeLegFn({ walk: pack.walk?.pairs ?? {}, settings: state.settings ?? rulesJson.settings, zoneLinks: pack.zones?.links ?? {} });
  state.pool = pois.map((poi) => ({ poi }));
  if (!state.field.date) state.field.date = state.trip.days[0].date;
  replanAll();
}

export function replanAll() {
  buildSettings();
  if (!state.trip) return;
  const r = planTrip({ trip: state.trip, pois: state.pois, rules: state.rules, settings: state.settings, country: state.country, kb: state.kb, legFn: state.legFn });
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

export function removeStop(date, poiId) {
  const day = state.trip.days.find((d) => d.date === date);
  if (!day) return;
  day.picks = (day.picks ?? []).filter((p) => p.poiId !== poiId);
  day.removed = [...(day.removed ?? []), { poiId, at: new Date().toISOString() }];   // 不算落選（原話 #91）
  replanAll();
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
  if (!state.trip) {
    root.append(
      el('h1', { text: TEXT.appName }),
      el('p', { class: 'muted', text: TEXT.shellHint }),
      el('button', { class: 'btn primary', type: 'button', onclick: loadDemo }, TEXT.loadDemo),
    );
    return;
  }
  const view = VIEWS[state.route] ?? renderPlanner;
  root.append(el('main', { class: 'view' }, view({ state, actions: { swapStop, removeStop, saveDevice, setField, replanAll } })));
  root.append(tabBar());
}

function tabBar() {
  return el('nav', { class: 'tabs', 'aria-label': '主選單' }, Object.entries(TEXT.tabs).map(([key, label]) => {
    const href = `#/${key}`;
    return el('a', { href, class: `tab${state.route === href ? ' active' : ''}` }, label);
  }));
}

export function boot() {
  buildSettings();
  const apply = () => { state.route = location.hash && VIEWS[location.hash] ? location.hash : '#/plan'; render(); };
  window.addEventListener('hashchange', apply);
  if (!state.field.date) state.field.date = todayStr();
  apply();
}
