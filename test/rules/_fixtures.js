// 規則測試共用：設定、國家層、造站、造 ctx、直接呼叫某條規則。
import { loadRules } from '../../src/rules/index.js';
import { BUILTIN } from '../../src/rules/builtin.js';
import { emptyAcc } from '../../src/engine/dims.js';
import rulesJson from '../../src/rules.json' with { type: 'json' };

export const settings = { ...rulesJson.settings };
export const country = {
  mealSlots: { lunch: ['11:30', '13:30'], dinner: ['18:00', '20:30'] },
  nightSlot: ['20:00', '24:00'],
  climate: { summerMonths: [6, 7, 8, 9] },
};
export const kb = { zones: { ichibancho: { environment: 'urban' }, matsushima: { environment: 'town' } } };
export const rules = loadRules(BUILTIN, rulesJson.rules);

/**
 * 造一站：poi 欄位用店型預設，可覆寫。
 * meals（知識庫「能當哪一餐」的欄位）、categoryRaw／categoryMatched（店型原文與命中的關鍵字，推導能當哪一餐時看）給了才放進 poi——沒給就是「沒有這個欄位」，走店型推導。
 */
export function stop(name, { category = 'shrine', walkFactor = 0.5, recovery = false, cafeLike = false, dwellMin = 60, startMin = 600, climbMin = 0, deepDig = false, zoneId = 'ichibancho', hours = null, id, meals, categoryRaw, categoryMatched, ...rest } = {}) {
  const poi = { id: id ?? name, name_zh: name, category, walkFactor, recovery, cafeLike, climbMin, deepDig, zoneId, hours };
  if (meals !== undefined) poi.meals = meals;
  if (categoryRaw !== undefined) poi.categoryRaw = categoryRaw;
  if (categoryMatched !== undefined) poi.categoryMatched = categoryMatched;
  return { poi, dwellMin, startMin, endMin: startMin + dwellMin, ...rest };
}

/** 造 ctx：預設 8/13 normal 日、區域 ichibancho、acc 從空開始。 */
export function ctx(current, { prev = null, leg = { walkMin: 0, rideMin: 0, climbMin: 0 }, sequence = [], acc, day = {}, ...rest } = {}) {
  return {
    day: { date: '2026-08-13', type: 'normal', earlyDay: false, party: 1, dayTripNext: false, themeCategory: null, prevThemeCategory: null, anchorPoiId: null, designated: [], regionZones: ['ichibancho'], window: { startMin: 540, endMin: 1440 }, ...day },
    stop: current, prev, leg, sequence, acc: acc ?? emptyAcc(rules.dims), settings, country, kb, ...rest,
  };
}

/** 直接跑一條規則（帶它的 params）。 */
export function run(id, c) {
  const r = rules.byId.get(id);
  if (!r) throw new Error(`沒有這條規則：${id}`);
  return r.apply({ ...c, params: r.params, ruleId: id });
}
export function warnOf(id, c) {
  const r = rules.byId.get(id);
  return r.warn({ ...c, params: r.params, ruleId: id });
}
