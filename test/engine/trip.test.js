// 整趟：兩天的旅程，每天各自排；晚出門日從第 3 天起；主題日的前一天主題傳下去；早起日前一晚夜間站取消。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planTrip, dayWindow, airportTransitMin } from '../../src/engine/trip.js';
import { loadRules } from '../../src/rules/index.js';
import { BUILTIN } from '../../src/rules/builtin.js';
import rulesJson from '../../src/rules.json' with { type: 'json' };
import { POIS, HOME, KB, COUNTRY, legFn } from '../sendai/fixture.js';

const rules = loadRules(BUILTIN, rulesJson.rules);
const settings = rulesJson.settings;
const pois = Object.fromEntries(Object.values(POIS).map((p) => [p.id, p]));

test('dayWindow：預設 9–24、留白 90 從尾端扣 → 收工 22:30；第 3 天起 11 點出門；早起日照出門時刻；抵達與離境日套緩衝', () => {
  const w = dayWindow({ type: 'normal' }, 0, settings);
  assert.equal(w.startMin, 540);
  assert.equal(w.endMin, 22 * 60 + 30, '24:00 扣 90 分留白');
  assert.deepEqual(w.raw, { startMin: 540, endMin: 1440 }, '原時窗留著給畫面與夜間站');
  assert.equal(w.openSlotMin, 90);
  assert.deepEqual(w.warnings, []);
  assert.equal(dayWindow({ type: 'normal' }, 2, settings).startMin, 660);
  assert.equal(dayWindow({ type: 'normal', earlyDay: true, departHM: '07:30' }, 2, settings).startMin, 450);
  assert.equal(dayWindow({ type: 'arrival', arriveMin: 16 * 60 }, 0, settings).startMin, 17 * 60);
  const dep = dayWindow({ type: 'departure', departAirportMin: 15 * 60 }, 6, settings);
  assert.equal(dep.endMin, 12 * 60, '離境日：起飛前 180 分，不扣留白');
  assert.equal(dep.openSlotMin, 0);
  assert.deepEqual(dep.warnings, []);
  assert.equal(dayWindow({ type: 'arrival', arriveMin: 16 * 60 }, 0, settings, 30).startMin, 17 * 60 + 30, '機場到據點的車程也要算（10-13 七天實驗 F1）');
  assert.equal(dayWindow({ type: 'departure', departAirportMin: 16 * 60 }, 6, settings, 30).endMin, 12 * 60 + 30);
  const toHome = (a, b) => (a.zoneId === 'airport' ? { walkMin: 5, rideMin: 25, climbMin: 0, mode: 'ride', source: 'link' } : { walkMin: 5, rideMin: 0, climbMin: 0, mode: 'walk', source: 'zone-default' });
  assert.equal(airportTransitMin({ legFn: toHome, home: { zoneId: 'sendai-station' }, settings }), 30, 'zones.json 的 airport|據點區 連結：車 25＋走 5');
  assert.equal(airportTransitMin({ legFn: () => ({ walkMin: 20, rideMin: 0, climbMin: 0, mode: 'walk', source: 'zone-default' }), home: { zoneId: 'sendai-station' }, settings }), 0, '沒有連結就 0，不亂估');
  assert.equal(airportTransitMin({ legFn: toHome, home: { zoneId: 'airport' }, settings }), 0, '據點就在機場區');
});

test('dayWindow 留白：days[].openSlotMin 覆寫（0 也算）、settings.openSlotMinPerDay 是預設；departure 日一律 0；扣完整天只剩 60 分或更少就不扣、記 open-slot-skipped', () => {
  assert.equal(dayWindow({ type: 'normal', openSlotMin: 30 }, 0, settings).endMin, 23 * 60 + 30);
  const zero = dayWindow({ type: 'normal', openSlotMin: 0 }, 0, settings);
  assert.deepEqual({ endMin: zero.endMin, openSlotMin: zero.openSlotMin, warnings: zero.warnings }, { endMin: 1440, openSlotMin: 0, warnings: [] }, '明寫 0 就是沒留白，不是缺值');
  assert.equal(dayWindow({ type: 'normal' }, 0, { ...settings, openSlotMinPerDay: 120 }).endMin, 22 * 60);
  const dep = dayWindow({ type: 'departure', openSlotMin: 30, departAirportMin: 15 * 60 }, 6, settings);
  assert.deepEqual({ endMin: dep.endMin, openSlotMin: dep.openSlotMin }, { endMin: 12 * 60, openSlotMin: 0 }, 'departure 日連覆寫都不扣');
  // 抵達日 22:00 落地：23:00 才開始、原時窗到 24:00 只有 60 分，扣了就沒得排 → 不扣、記警告
  const short = dayWindow({ type: 'arrival', arriveMin: 22 * 60 }, 0, settings);
  assert.deepEqual({ startMin: short.startMin, endMin: short.endMin, openSlotMin: short.openSlotMin }, { startMin: 23 * 60, endMin: 24 * 60, openSlotMin: 0 });
  assert.equal(short.warnings.length, 1);
  assert.equal(short.warnings[0].code, 'open-slot-skipped');
  assert.match(short.warnings[0].msg, /60 分鐘.*90 分/);
  // 20:00 落地：21:00 起、扣完 22:30 還剩 90 分（超過 60）→ 照扣
  const ok = dayWindow({ type: 'arrival', arriveMin: 20 * 60 }, 0, settings);
  assert.deepEqual({ endMin: ok.endMin, openSlotMin: ok.openSlotMin, warnings: ok.warnings }, { endMin: 22 * 60 + 30, openSlotMin: 90, warnings: [] });
  // 20:30 落地：21:30 起、扣完剛好剩 60 → 不扣（門檻含等於）
  assert.equal(dayWindow({ type: 'arrival', arriveMin: 20 * 60 + 30 }, 0, settings).openSlotMin, 0);
});

// 留白扣時窗的整合情境（自己造的小世界，跟 rest-pool.test 同款）：全天開的走動站 ＋ 20:00 才開的 bar ＋ 21:30 才開的 bar
const NIGHT_COUNTRY = { mealSlots: { lunch: ['11:30', '13:30'], dinner: ['18:00', '20:30'] }, nightSlot: ['20:00', '24:00'], climate: { summerMonths: [6, 7, 8, 9] }, utcOffsetMin: 540 };
const NIGHT_KB = { zones: { town: { environment: 'town', lat: 38.26, lng: 140.87 } } };
const mk = (id, over = {}) => ({ id, name_zh: id, category: 'street', walkFactor: 1, recovery: false, cafeLike: false, climbMin: 0, zoneId: 'town', hours: { thu: [['09:00', '23:00']] }, dwellMin: 60, daylightOnly: false, lat: 38.26, lng: 140.87, ...over });
const bar = (id, open) => mk(id, { category: 'bar', walkFactor: 0, recovery: true, hours: { thu: [[open, '24:00']] }, dwellMin: 90 });
const nightHome = { id: 'home', name_zh: '飯店', zoneId: 'town', lat: 38.26, lng: 140.87 };
const flatLeg = () => ({ walkMin: 5, rideMin: 0, climbMin: 0 });
const oneDay = (dayOver, poiList) => planTrip({ trip: { id: 't', party: 1, homeBases: [{ poi: nightHome }], days: [{ date: '2026-08-13', type: 'normal', ...dayOver }] }, pois: Object.fromEntries(poiList.map((p) => [p.id, p])), rules, settings, country: NIGHT_COUNTRY, kb: NIGHT_KB, legFn: flatLeg }).days[0];

test('planTrip：留白扣在時窗尾端——day.window 收工 22:30、windowRaw 仍 24:00；20:00 開的 bar 照排、算夜間站；會待過 22:30 的 bar 排不進，那天 openSlotMin 0 就排得進', () => {
  const shop = mk('街區'); const eight = bar('八點的bar', '20:00'); const half = bar('九點半的bar', '21:30');
  const a = oneDay({ designated: [eight.id], picks: [{ poiId: shop.id, priority: 'must' }, { poiId: eight.id, priority: 'must' }] }, [shop, eight]);
  assert.equal(a.day.window.endMin, 22 * 60 + 30);
  assert.deepEqual(a.day.windowRaw, { startMin: 540, endMin: 1440 });
  assert.equal(a.day.openSlotMin, 90);
  assert.equal(a.day.openSlotSkipped, false);
  const placed = a.plan.sequence.find((s) => s.poi.id === eight.id);
  const shown = a.plan.sequence.map((s) => `${s.poi.id} ${s.startMin}–${s.endMin}`).join('→');
  assert.ok(placed && placed.startMin === 20 * 60 && placed.endMin === 21 * 60 + 30, `20:00 的 bar 要排在 20:00–21:30：${shown}`);
  assert.ok(!a.plan.warnings.some((w) => w.ruleId === 'night-slot'), '夜間站不因扣留白消失');
  assert.ok(a.plan.sequence.every((s) => s.endMin <= 22 * 60 + 30), `沒有站待過收工：${shown}`);
  // 21:30 才開、待 90 → 23:00 結束，超過扣完留白的收工 22:30：排不進，理由寫收工時間
  const b = oneDay({ designated: [half.id], picks: [{ poiId: shop.id, priority: 'must' }, { poiId: half.id, priority: 'must' }] }, [shop, half]);
  assert.ok(!b.plan.sequence.some((s) => s.poi.id === half.id), '會待過 22:30 的 bar 排不進');
  assert.match(b.plan.dropped.find((x) => x.poi.id === half.id)?.reason ?? '', /收工時間 22:30/);
  // 那天留白設 0：收工回到 24:00，排得進
  const c = oneDay({ openSlotMin: 0, designated: [half.id], picks: [{ poiId: shop.id, priority: 'must' }, { poiId: half.id, priority: 'must' }] }, [shop, half]);
  assert.equal(c.day.window.endMin, 1440);
  assert.equal(c.day.openSlotMin, 0);
  assert.ok(c.plan.sequence.some((s) => s.poi.id === half.id && s.endMin === 23 * 60), '留白 0 的那天 21:30–23:00 排得進');
});

test('planTrip：抵達日很晚落地、時窗太短：留白不扣、day.openSlotSkipped、整趟警告 open-slot-skipped 帶日期', () => {
  const shop = mk('街區');
  const r = planTrip({ trip: { id: 't', party: 1, homeBases: [{ poi: nightHome }], days: [{ date: '2026-08-13', type: 'arrival', arriveMin: 22 * 60, picks: [{ poiId: shop.id, priority: 'want' }] }] }, pois: { [shop.id]: shop }, rules, settings, country: NIGHT_COUNTRY, kb: NIGHT_KB, legFn: flatLeg });
  assert.deepEqual(r.days[0].day.window, { startMin: 23 * 60, endMin: 24 * 60 });
  assert.equal(r.days[0].day.openSlotMin, 0);
  assert.equal(r.days[0].day.openSlotSkipped, true);
  const w = r.warnings.find((x) => x.code === 'open-slot-skipped');
  assert.ok(w && w.date === '2026-08-13' && w.msg.startsWith('2026-08-13'), JSON.stringify(r.warnings));
});

test('planTrip：兩天各自排好；第二天是古著主題日、第一天不是；早起日前一晚夜間站不罰', () => {
  const trip = {
    id: 't', party: 1,
    homeBases: [{ poi: HOME }],
    days: [
      { date: '2026-08-13', type: 'normal', anchor: { poiId: POIS['大崎八幡宮'].id }, designated: [POIS['宮城縣護國神社'].id],
        picks: [{ poiId: POIS['大崎八幡宮'].id, priority: 'must' }, { poiId: POIS['宮城縣護國神社'].id, priority: 'must' }, { poiId: POIS['たん焼き一隆'].id }, { poiId: POIS['珈巣多夢'].id }, { poiId: POIS['汐谷'].id }] },
      { date: '2026-08-17', type: 'normal', anchor: { theme: 'vintage', poiIds: [POIS.Utah.id] }, designated: [POIS['おやま'].id],
        picks: [{ poiId: POIS.Utah.id, priority: 'must' }, { poiId: POIS.me.id }, { poiId: POIS['SEGA-RU'].id }, { poiId: POIS['おやま'].id, priority: 'must' }, { poiId: POIS['バンザイ'].id }, { poiId: 'ghost' }] },
    ],
  };
  const r = planTrip({ trip, pois, rules, settings, country: COUNTRY, kb: KB, legFn });
  assert.equal(r.days.length, 2);
  assert.ok(r.warnings.some((w) => w.code === 'pick-unknown' && w.msg.includes('ghost')));
  const d1 = r.days[0]; const d2 = r.days[1];
  assert.ok(d1.plan.complete && d2.plan.complete);
  assert.equal(d1.day.themeCategory, null);
  assert.equal(d2.day.themeCategory, 'vintage');
  assert.equal(d2.day.prevThemeCategory, null);
  assert.equal(d2.day.window.startMin, 540, '第 2 天還不是晚出門日');
  assert.equal(d1.day.window.endMin, 22 * 60 + 30, '留白 90 從收工扣');
  assert.equal(d1.day.windowRaw.endMin, 24 * 60);
  assert.equal(d1.day.openSlotMin, 90);
  assert.equal(d1.day.openSlotSkipped, false);
  assert.ok(d2.plan.sequence.filter((s) => s.poi.category === 'vintage').length >= 3);
  assert.ok(d1.plan.sequence.some((s) => s.poi.id === POIS['汐谷'].id));
});

test('planTrip：一日遊那天 day.dayTrip 帶給規則（步行預算 ×0.7，原話 #160）；不是一日遊是 false；翌日 dayTripNext', () => {
  const trip = {
    id: 't', party: 1, homeBases: [{ poi: HOME }],
    days: [
      { date: '2026-08-13', type: 'normal', picks: [{ poiId: POIS['大崎八幡宮'].id, priority: 'must' }] },
      { date: '2026-08-14', type: 'normal', earlyDay: true, departHM: '07:30', dayTrip: true, picks: [{ poiId: POIS['大崎八幡宮'].id, priority: 'must' }] },
      { date: '2026-08-15', type: 'normal', picks: [{ poiId: POIS['大崎八幡宮'].id, priority: 'must' }] },
    ],
  };
  const r = planTrip({ trip, pois, rules, settings, country: COUNTRY, kb: KB, legFn });
  assert.equal(r.days[0].day.dayTrip, false);
  assert.equal(r.days[1].day.dayTrip, true);
  assert.equal(r.days[2].day.dayTrip, false);
  assert.equal(r.days[2].day.dayTripNext, true);
});
