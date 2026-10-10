// 仙台考題的最小夾具：從 e2e-v4 的 8/13（市區古蹟神社日）與 8/17（古著主題日）抽出來的站，
// 營業時間照 v4 報告與官網查證寫成結構化；站間分鐘是 v4 表上的估值（沒座標，T5 之後換 Valhalla）。
import { normalizePoi } from '../../src/data/schema.js';

const H = (...pairs) => pairs;   // [['11:30','13:30'],['17:00','21:00']]
const everyDay = (list, closed = []) => Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, closed.includes(d) ? [] : list]));

const RAW = [
  // 8/13
  { name_zh: '宮城縣護國神社', category: 'shrine', zoneId: 'aoba-castle', duration: '35 分鐘', hours: everyDay(H(['09:00', '17:00'])) },
  { name_zh: '大崎八幡宮', category: 'shrine', zoneId: 'hachiman', duration: '60 分鐘', climb: true, climbMin: 3, hours: everyDay(H(['09:00', '16:00'])) },
  { name_zh: 'たん焼き一隆', category: 'food', zoneId: 'kokubuncho', duration: '65 分鐘', hours: everyDay(H(['11:30', '13:30'], ['17:00', '21:00']), ['sun']) },
  { name_zh: '珈巣多夢', category: 'cafe', zoneId: 'ichibancho', duration: '60 分鐘', hours: everyDay(H(['12:00', '24:00']), ['wed']) },
  { name_zh: '火星の庭', category: 'cafe', zoneId: 'honcho', duration: '75 分鐘', hours: everyDay(H(['11:00', '18:00']), ['tue', 'wed']) },
  { name_zh: '喫茶 Elbe', category: 'cafe', zoneId: 'ichibancho', duration: '60 分鐘', hours: everyDay(H(['11:30', '17:00'], ['17:30', '21:00']), ['sun']) },
  { name_zh: '汐谷', category: 'bar', zoneId: 'ichibancho', duration: '90 分鐘', hours: everyDay(H(['17:00', '23:00']), ['sun']) },
  { name_zh: 'ディスクノート', category: 'record', zoneId: 'honcho', duration: '60 分鐘', hours: everyDay(H(['12:00', '20:00']), ['wed']) },
  { name_zh: '阿武隈書房', category: 'bookstore', zoneId: 'honcho', duration: '30 分鐘', hours: everyDay(H(['12:00', '19:00']), ['mon']) },
  // 8/17
  { name_zh: '松本清', category: 'drugstore', zoneId: 'station', duration: '10 分鐘', hours: everyDay(H(['08:00', '22:00'])) },
  { name_zh: 'おやま', category: 'food', zoneId: 'ichibancho', duration: '60 分鐘', hours: everyDay(H(['11:30', '13:30'], ['17:30', '22:00']), ['sun']) },
  { name_zh: 'Utah', category: 'vintage', zoneId: 'honcho', duration: '60 分鐘', hours: everyDay(H(['12:00', '20:00'])) },
  { name_zh: 'me', category: 'vintage', zoneId: 'honcho', duration: '60 分鐘', hours: everyDay(H(['12:00', '19:30']), ['tue']) },
  { name_zh: 'SQUAT', category: 'vintage', zoneId: 'honcho', duration: '60 分鐘', hours: everyDay(H(['11:00', '20:00'])) },
  { name_zh: 'SEGA-RU', category: 'vintage', zoneId: 'ichibancho', duration: '60 分鐘', hours: everyDay(H(['12:00', '20:00']), ['wed']) },
  { name_zh: 'TRUE VINTAGE', category: 'vintage', zoneId: 'ichibancho', duration: '60 分鐘', deepDig: true, hours: everyDay(H(['11:00', '20:00'])) },
  { name_zh: '星山珈琲店', category: 'cafe', zoneId: 'ichibancho', duration: '60 分鐘', hours: everyDay(H(['10:00', '22:00'])) },
  { name_zh: '文化横丁 小酒場', category: 'bar', zoneId: 'ichibancho', duration: '90 分鐘', hours: everyDay(H(['17:00', '24:00'])) },
  { name_zh: 'バンザイ', category: 'bar', zoneId: 'ichibancho', duration: '90 分鐘', hours: everyDay(H(['17:00', '23:00']), ['fri', 'sat', 'sun']) },
];

export const POIS = Object.fromEntries(RAW.map((r) => { const { poi } = normalizePoi(r); return [poi.name_zh, poi]; }));
export const HOME = { id: 'home', name_zh: 'Comfort Hotel 仙台西口', zoneId: 'station' };
export const KB = { zones: { station: { environment: 'urban' }, ichibancho: { environment: 'urban' }, honcho: { environment: 'urban' }, kokubuncho: { environment: 'urban' }, 'aoba-castle': { environment: 'urban' }, hachiman: { environment: 'urban' } } };
export const COUNTRY = { mealSlots: { lunch: ['11:30', '13:30'], dinner: ['18:00', '20:30'] }, nightSlot: ['20:00', '24:00'], climate: { summerMonths: [6, 7, 8, 9] } };

// 站間：同區 5 分（一番町大，8 分）；跨區照 v4 表；るーぷる／市營巴士段是 ride。
const WALK = { station: { ichibancho: 12, honcho: 15, kokubuncho: 15 }, ichibancho: { honcho: 8, kokubuncho: 6 }, honcho: { kokubuncho: 10 } };
const RIDE = { station: { 'aoba-castle': { ride: 25, walk: 8 }, hachiman: { ride: 30, walk: 5 } }, 'aoba-castle': { hachiman: { ride: 15, walk: 5 }, ichibancho: { ride: 20, walk: 5 } }, hachiman: { ichibancho: { ride: 20, walk: 5 }, kokubuncho: { ride: 20, walk: 5 } } };
export function legFn(from, to) {
  const a = from.zoneId; const b = to.zoneId;
  if (a === b) return { walkMin: a === 'ichibancho' ? 8 : 5, rideMin: 0, climbMin: 0 };
  const r = RIDE[a]?.[b] ?? RIDE[b]?.[a];
  if (r) return { walkMin: r.walk, rideMin: r.ride, climbMin: 0 };
  const w = WALK[a]?.[b] ?? WALK[b]?.[a];
  if (w != null) return { walkMin: w, rideMin: 0, climbMin: 0 };
  return { walkMin: 20, rideMin: 0, climbMin: 0 };
}

export const DAY_0813 = { date: '2026-08-13', type: 'normal', earlyDay: false, party: 1, dayTripNext: false, themeCategory: null, prevThemeCategory: null, anchorPoiId: POIS['大崎八幡宮'].id, anchorName: '大崎八幡宮', designated: [POIS['宮城縣護國神社'].id], regionZones: ['station', 'ichibancho', 'honcho', 'kokubuncho', 'aoba-castle', 'hachiman'], window: { startMin: 9 * 60, endMin: 24 * 60 } };
export const DAY_0817 = { date: '2026-08-17', type: 'normal', earlyDay: false, party: 1, dayTripNext: true, themeCategory: 'vintage', prevThemeCategory: null, anchorPoiId: POIS.Utah.id, anchorName: 'Utah', designated: [POIS['おやま'].id, POIS['バンザイ'].id], regionZones: ['station', 'ichibancho', 'honcho', 'kokubuncho'], window: { startMin: 11 * 60, endMin: 24 * 60 } };

export const CANDS_0813 = [
  { poi: POIS['大崎八幡宮'], priority: 'must', isAnchor: true },
  { poi: POIS['宮城縣護國神社'], priority: 'must', designated: true },
  { poi: POIS['たん焼き一隆'], priority: 'want' },
  { poi: POIS['珈巣多夢'], priority: 'want' },
  { poi: POIS['火星の庭'], priority: 'maybe' },
  { poi: POIS['喫茶 Elbe'], priority: 'want' },
  { poi: POIS['汐谷'], priority: 'want' },
  { poi: POIS['ディスクノート'], priority: 'maybe' },
  { poi: POIS['阿武隈書房'], priority: 'maybe' },
];
export const CANDS_0817 = [
  { poi: POIS['松本清'], priority: 'want' },
  { poi: POIS['おやま'], priority: 'must', designated: true },
  { poi: POIS.Utah, priority: 'must', isAnchor: true },
  { poi: POIS.me, priority: 'want' },
  { poi: POIS.SQUAT, priority: 'maybe' },
  { poi: POIS['SEGA-RU'], priority: 'want' },
  { poi: POIS['TRUE VINTAGE'], priority: 'maybe' },
  { poi: POIS['星山珈琲店'], priority: 'want' },
  { poi: POIS['文化横丁 小酒場'], priority: 'want' },
  { poi: POIS['バンザイ'], priority: 'must', designated: true },
];
