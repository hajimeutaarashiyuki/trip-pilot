// 示範旅程：仙台 8/13 與 8/17（從 e2e-v4 抽出，營業時間照 v4 查證；站間分鐘是估值）。
// 兩個用途：測試夾具（test/sendai）、App 裡的「載入示範」（他在家試走用，原話 #153）。
import { normalizePoi } from '../data/schema.js';

const H = (...pairs) => pairs;
const everyDay = (list, closed = []) => Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, closed.includes(d) ? [] : list]));

export const RAW_POIS = [
  { name_zh: '宮城縣護國神社', category: 'shrine', zoneId: 'aoba-castle', duration: '35 分鐘', hours: everyDay(H(['09:00', '17:00'])), highlight: '仙台城本丸跡上的神社，御守「健康長寿守」官方頁逐品列名。' },
  { name_zh: '大崎八幡宮', category: 'shrine', zoneId: 'hachiman', duration: '60 分鐘', climb: true, climbMin: 3, hours: everyDay(H(['09:00', '16:00'])), highlight: '1607 年伊達政宗創建，權現造現存最古實例、整棟國寶。' },
  { name_zh: 'たん焼き一隆', category: 'food', zoneId: 'kokubuncho', duration: '65 分鐘', hours: everyDay(H(['11:30', '13:30'], ['17:00', '21:00']), ['sun']), highlight: '1972 年創業、佐野啓四郎直傳的牛舌直系；不接受訂位。' },
  { name_zh: '珈巣多夢', category: 'cafe', zoneId: 'ichibancho', duration: '60 分鐘', hours: everyDay(H(['12:00', '24:00']), ['wed']), highlight: '定禪寺通欅木旁 2F、約 50 年的自家焙煎專門店。' },
  { name_zh: '火星の庭', category: 'cafe', zoneId: 'honcho', duration: '75 分鐘', hours: everyDay(H(['11:00', '18:00']), ['tue', 'wed']), highlight: '本町的二手書咖啡。' },
  { name_zh: '喫茶 Elbe', category: 'cafe', zoneId: 'ichibancho', duration: '60 分鐘', hours: everyDay(H(['11:30', '17:00'], ['17:30', '21:00']), ['sun']), highlight: '一番町地下的昭和純喫茶，名物塩味スパゲッティ。' },
  { name_zh: '汐谷', category: 'bar', zoneId: 'ichibancho', duration: '90 分鐘', hours: everyDay(H(['17:00', '23:00']), ['sun']), highlight: '文化横丁口的日本酒小店，夫婦二人經營。' },
  { name_zh: 'ディスクノート', category: 'record', zoneId: 'honcho', duration: '60 分鐘', hours: everyDay(H(['12:00', '20:00']), ['wed']), highlight: '本町二丁目 3F，1981 年起的爵士專門唱片行。' },
  { name_zh: '阿武隈書房', category: 'bookstore', zoneId: 'honcho', duration: '30 分鐘', hours: everyDay(H(['12:00', '19:00']), ['mon']), highlight: '本町的舊書店，收 LP 買取。' },
  { name_zh: '松本清', category: 'drugstore', zoneId: 'station', duration: '10 分鐘', hours: everyDay(H(['08:00', '22:00'])), highlight: 'クリスロード的藥妝，代購用。' },
  { name_zh: 'おやま', category: 'food', zoneId: 'ichibancho', duration: '60 分鐘', hours: everyDay(H(['11:30', '13:30'], ['17:30', '22:00']), ['sun']), highlight: '一番町三丁目的炭火牛舌，夫婦加兒子的小店。' },
  { name_zh: 'Utah', category: 'vintage', zoneId: 'honcho', duration: '60 分鐘', hours: everyDay(H(['12:00', '20:00'])), highlight: '本町的美式古著，店主定期赴美買付。' },
  { name_zh: 'me', category: 'vintage', zoneId: 'honcho', duration: '60 分鐘', hours: everyDay(H(['12:00', '19:30']), ['tue']), highlight: 'Utah 走兩分鐘的古著店。' },
  { name_zh: 'SQUAT', category: 'vintage', zoneId: 'honcho', duration: '60 分鐘', hours: everyDay(H(['11:00', '20:00'])), highlight: '本町的古著店。' },
  { name_zh: 'SEGA-RU', category: 'vintage', zoneId: 'ichibancho', duration: '60 分鐘', hours: everyDay(H(['12:00', '20:00']), ['wed']), highlight: '一番町北段 3F 的古著店。' },
  { name_zh: 'TRUE VINTAGE', category: 'vintage', zoneId: 'ichibancho', duration: '60 分鐘', deepDig: true, hours: everyDay(H(['11:00', '20:00'])), highlight: '一番町南端，藏量大的古著店。' },
  { name_zh: '星山珈琲店', category: 'cafe', zoneId: 'ichibancho', duration: '60 分鐘', hours: everyDay(H(['10:00', '22:00'])), highlight: '一番町四丁目 3F，松本民藝家具與古董杯的喫茶。' },
  { name_zh: '文化横丁 小酒場', category: 'bar', zoneId: 'ichibancho', duration: '90 分鐘', hours: everyDay(H(['17:00', '24:00'])), highlight: '文化横丁與壱弐参横丁的小酒場巡禮。' },
  { name_zh: 'バンザイ', category: 'bar', zoneId: 'ichibancho', duration: '90 分鐘', hours: everyDay(H(['17:00', '23:00']), ['fri', 'sat', 'sun']), highlight: '一番町三丁目橫巷 3F 的黑膠 bar，客人點播。' },
];

export const POIS = Object.fromEntries(RAW_POIS.map((r) => { const { poi } = normalizePoi(r); return [poi.name_zh, poi]; }));
export const HOME = { id: 'home', name_zh: 'Comfort Hotel 仙台西口', zoneId: 'station' };
export const KB = { zones: { station: { environment: 'urban' }, ichibancho: { environment: 'urban' }, honcho: { environment: 'urban' }, kokubuncho: { environment: 'urban' }, 'aoba-castle': { environment: 'urban' }, hachiman: { environment: 'urban' } } };
export const COUNTRY = { mealSlots: { lunch: ['11:30', '13:30'], dinner: ['18:00', '20:30'] }, nightSlot: ['20:00', '24:00'], climate: { summerMonths: [6, 7, 8, 9] }, utcOffsetMin: 540 };

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

// shoppingDay／shoppingFromMin 照 planTrip 對 demoTrip() 推出來的（trip.js shoppingDaysOf：兩個完整天、沒有離境日 → 最後一天 8/17 是購物日），規則 shopping-day 讀；8/17 勾的松本清（藥妝）才不會被當成非購物日的購物站
// 示範的 8/17 標成古著主題日（themeCategory 'vintage'、demoTrip 的 anchor.theme）是刻意的：給「載入示範」與夾具測試看主題日的排法（那一類無上限，只由逛店連跑與一天 8 站管；sendai.test 斷言古著 ≥3）。
// 這不是他那趟 8/17 的實況——他 10-13 說「那天又不是主題日」（原話 #169），試走旅程檔 trips/2026-08-sendai.json 的 8/17 已改成普通日（10-14 T25 審查後註記）。
export const DAY_0813 = { date: '2026-08-13', type: 'normal', earlyDay: false, party: 1, dayTripNext: false, themeCategory: null, prevThemeCategory: null, anchorPoiId: POIS['大崎八幡宮'].id, anchorName: '大崎八幡宮', designated: [POIS['宮城縣護國神社'].id], regionZones: ['station', 'ichibancho', 'honcho', 'kokubuncho', 'aoba-castle', 'hachiman'], window: { startMin: 9 * 60, endMin: 24 * 60 }, shoppingDay: false, shoppingFromMin: null };
export const DAY_0817 = { date: '2026-08-17', type: 'normal', earlyDay: false, party: 1, dayTripNext: true, themeCategory: 'vintage', prevThemeCategory: null, anchorPoiId: POIS.Utah.id, anchorName: 'Utah', designated: [POIS['おやま'].id, POIS['バンザイ'].id], regionZones: ['station', 'ichibancho', 'honcho', 'kokubuncho'], window: { startMin: 11 * 60, endMin: 24 * 60 }, shoppingDay: true, shoppingFromMin: null };

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

/** App 裡「載入示範」用的旅程物件（planTrip 的形狀）。 */
export function demoTrip() {
  const pick = (c) => ({ poiId: c.poi.id, priority: c.priority });
  return {
    id: 'demo-sendai-2026-08', cityId: 'sendai', cityName: '仙台', name: '仙台示範（8/13、8/17）', party: 1,
    homeBases: [{ poi: HOME }],
    days: [
      { date: '2026-08-13', type: 'normal', anchor: { poiId: POIS['大崎八幡宮'].id }, designated: [POIS['宮城縣護國神社'].id], picks: CANDS_0813.map(pick) },
      { date: '2026-08-17', type: 'normal', anchor: { theme: 'vintage', poiIds: [POIS.Utah.id] }, designated: [POIS['おやま'].id, POIS['バンザイ'].id], picks: CANDS_0817.map(pick) },
    ],
  };
}
