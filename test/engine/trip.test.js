// 整趟：兩天的旅程，每天各自排；晚出門日從第 3 天起；主題日的前一天主題傳下去；早起日前一晚夜間站取消。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planTrip, dayWindow, airportTransitMin, shoppingDaysOf, themeCategoryOf, fixedWindowOf, fixedSpanMin } from '../../src/engine/trip.js';
import { loadRules } from '../../src/rules/index.js';
import { BUILTIN } from '../../src/rules/builtin.js';
import rulesJson from '../../src/rules.json' with { type: 'json' };
import { POIS, HOME, KB, COUNTRY, legFn, demoTrip, DAY_0813, DAY_0817 } from '../sendai/fixture.js';

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

test('dayWindow 國家層（T20）：離境日免稅緩衝 taxRefund.bufferMin 只在旅程日期 ≥ effectiveFrom 才扣（仙台 2026-08 不扣）；夜間步行風險 mid／high 時窗尾端 23:00／22:00、low 與缺照舊', () => {
  const jp = { taxRefund: { mode: 'departure-refund', effectiveFrom: '2026-11-01', bufferMin: 45 }, transportProfile: { nightWalk: { risk: 'low', maxMinNoLastTrain: 15 } } };
  const dep = (date, country) => dayWindow({ type: 'departure', date, departAirportMin: 16 * 60 }, 6, settings, 30, country);
  assert.equal(dep('2026-08-18', jp).endMin, 12 * 60 + 30, '仙台 2026-08-18：新制 2026-11-01 才生效，跟以前一樣 16:00−180−30');
  assert.equal(dep('2026-08-18', jp).taxRefundBufferMin, 0);
  assert.equal(dep('2026-11-01', jp).endMin, 12 * 60 + 30 - 45, '生效日當天起多扣 45');
  assert.equal(dep('2026-11-01', jp).taxRefundBufferMin, 45);
  assert.deepEqual(dep('2027-02-13', jp).raw, { startMin: 540, endMin: 12 * 60 + 30 - 45 }, '原時窗也是扣過的（畫面與夜間站看的收工）');
  assert.equal(dep('2027-02-13', jp).openSlotMin, 0, '離境日照舊不扣留白');
  assert.equal(dep('2027-02-13', null).endMin, 12 * 60 + 30, '沒國家層不扣');
  assert.equal(dep('2027-02-13', { taxRefund: { mode: 'none', bufferMin: 45 } }).endMin, 12 * 60 + 30, '沒有免稅制度（mode none）不扣');
  assert.equal(dep('2027-02-13', { taxRefund: { bufferMin: 30 } }).endMin, 12 * 60, '沒寫生效日＝已生效');
  assert.equal(dep(undefined, jp).endMin, 12 * 60 + 30, '有生效日、旅程日期不明：不扣');
  assert.equal(dayWindow({ type: 'normal', date: '2027-02-13' }, 0, settings, 0, jp).endMin, 22 * 60 + 30, '普通日不扣免稅緩衝');
  assert.equal(dayWindow({ type: 'normal', date: '2027-02-13' }, 0, settings, 0, jp).taxRefundBufferMin, 0);
  // 夜間步行風險（原話 #145；mid 23:00、high 22:00 是預設、推導）
  const risk = (r) => dayWindow({ type: 'normal' }, 0, settings, 0, { transportProfile: { nightWalk: { risk: r } } });
  assert.deepEqual(risk('low').raw, { startMin: 540, endMin: 1440 });
  assert.deepEqual(risk('mid').raw, { startMin: 540, endMin: 23 * 60 });
  assert.equal(risk('mid').endMin, 23 * 60 - 90, '留白照樣從提前後的尾端扣');
  assert.deepEqual(risk('high').raw, { startMin: 540, endMin: 22 * 60 });
  assert.deepEqual(risk('weird').raw, { startMin: 540, endMin: 1440 }, '看不懂的等級當 low');
  assert.equal(dayWindow({ type: 'normal' }, 0, { ...settings, dayWindow: ['09:00', '21:00'] }, 0, { transportProfile: { nightWalk: { risk: 'high' } } }).raw.endMin, 21 * 60, '時窗本來就比上限早就不動');
  assert.equal(dep('2027-02-13', { ...jp, transportProfile: { nightWalk: { risk: 'high' } } }).endMin, 12 * 60 + 30 - 45, '離境日早就收工，夜間上限不影響');
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

test('planTrip 國家層（T20）：離境日在免稅新制生效後收工再扣 bufferMin、day.taxRefundBufferMin 記下來，生效前跟以前一樣；夜間步行風險 mid 時窗尾端 23:00', () => {
  const shop = mk('街區');
  const depTrip = (date) => ({ id: 't', party: 1, homeBases: [{ poi: nightHome }], days: [{ date, type: 'departure', departAirportMin: 16 * 60, picks: [{ poiId: shop.id, priority: 'must' }] }] });
  const dep = (date, country) => planTrip({ trip: depTrip(date), pois: { [shop.id]: shop }, rules, settings, country, kb: NIGHT_KB, legFn: flatLeg }).days[0];
  const jp = { ...NIGHT_COUNTRY, taxRefund: { mode: 'departure-refund', effectiveFrom: '2026-11-01', bufferMin: 45 } };
  const before = dep('2026-08-13', jp);   // 週四（小世界的營業時間只寫 thu）
  assert.equal(before.day.taxRefundBufferMin, 0);
  assert.equal(before.day.window.endMin, 13 * 60, '16:00 起飛−180；沒有機場連結車程 0；新制沒生效不扣');
  const after = dep('2026-11-05', jp);
  assert.equal(after.day.taxRefundBufferMin, 45);
  assert.equal(after.day.window.endMin, 13 * 60 - 45);
  assert.deepEqual(after.day.windowRaw, { startMin: 540, endMin: 13 * 60 - 45 });
  assert.equal(after.day.openSlotMin, 0, '離境日照舊不扣留白');
  assert.ok(after.plan.sequence.length && after.plan.sequence.every((s) => s.endMin <= 13 * 60 - 45), '沒有站待過扣了免稅緩衝的收工');
  assert.equal(dep('2026-11-05', NIGHT_COUNTRY).day.window.endMin, 13 * 60, '國家層沒有 taxRefund 就不扣');
  const mid = planTrip({ trip: { id: 't', party: 1, homeBases: [{ poi: nightHome }], days: [{ date: '2026-08-13', type: 'normal', picks: [{ poiId: shop.id, priority: 'must' }] }] }, pois: { [shop.id]: shop }, rules, settings, country: { ...NIGHT_COUNTRY, transportProfile: { nightWalk: { risk: 'mid' } } }, kb: NIGHT_KB, legFn: flatLeg }).days[0];
  assert.deepEqual(mid.day.windowRaw, { startMin: 540, endMin: 23 * 60 }, '夜間步行風險 mid：時窗尾端 23:00');
  assert.equal(mid.day.window.endMin, 23 * 60 - 90);
  assert.equal(mid.day.taxRefundBufferMin, 0);
});

// 固定時段日（研討會；DESIGN §11.1 Q7、08-19 計畫 1 夾具、10-14 T23）：會場是帶固定時段的站，fixed 日跟 normal 走同一條時窗邏輯
const FRI_VENUE = { fri: [['09:30', '19:30']] };   // 2026-08-14 是週五
const venue = mk('會場', { category: 'venue', walkFactor: 0, hours: FRI_VENUE, dwellMin: 60 });
const nightBar = mk('賓', { category: 'bar', walkFactor: 0, recovery: true, hours: { fri: [['13:00', '24:00']] }, dwellMin: 90 });
const fixedTrip = (dayOver = {}, picks = null) => planTrip({
  trip: { id: 't', party: 1, homeBases: [{ poi: nightHome }], days: [
    { date: '2026-08-12', type: 'normal', picks: [] }, { date: '2026-08-13', type: 'normal', picks: [] },
    { date: '2026-08-14', type: 'fixed', earlyDay: true, departHM: '08:20', anchor: { poiId: venue.id }, picks: picks ?? [{ poiId: venue.id, priority: 'must', fixedWindow: { startMin: 9 * 60 + 30, endMin: 19 * 60 + 30 } }, { poiId: nightBar.id, priority: 'want', dwellMin: 90 }], ...dayOver },
  ] },
  pois: { [venue.id]: venue, [nightBar.id]: nightBar }, rules, settings, country: NIGHT_COUNTRY, kb: NIGHT_KB, legFn: flatLeg,
});

test('planTrip：固定時段日——fixedWindow 補預設（前 40 後 30）、會場 08:50–20:00 一站、營業時間不擋、停留＝釘住的整段、太晚出門不罰、散場後的 bar 算夜間站與晚餐、被蓋住的午餐不警告', () => {
  const r = fixedTrip();
  const d = r.days[2];
  assert.equal(d.day.type, 'fixed');
  assert.deepEqual(d.day.window, { startMin: 8 * 60 + 20, endMin: 22 * 60 + 30 }, '早起日手標 08:20 出門（原話 #17）；留白照扣');
  const shown = d.plan.sequence.map((s) => `${s.poi.id} ${s.startMin}–${s.endMin}`).join('→');
  const v = d.plan.sequence.find((s) => s.poi.id === venue.id);
  assert.ok(v, `會場要排進去：${shown}；落選 ${JSON.stringify(d.plan.dropped.map((x) => x.reason))}`);
  assert.deepEqual(v.fixedWindow, { startMin: 570, endMin: 1170, arriveEarlyMin: 40, afterMin: 30 }, '旅程檔只寫起訖：arriveEarlyMin 補 settings.fixedBeforeMin 40、afterMin 補 fixedAfterMin 30');
  assert.deepEqual([v.startMin, v.endMin, v.waitMin, v.dwellMin], [8 * 60 + 50, 20 * 60, 0, 670], '08:50 到場卡位、19:30 散場再留 30 到 20:00；沒寫停留就是釘住的整段 670');
  const b = d.plan.sequence.find((s) => s.poi.id === nightBar.id);
  assert.ok(b && b.startMin === 20 * 60 + 5 && b.endMin === 21 * 60 + 35, `賓 接在會場後面 20:05–21:35：${shown}`);
  const of = (ruleId) => d.plan.warnings.filter((w) => w.ruleId === ruleId).map((w) => w.msg);
  assert.deepEqual(of('hours'), [], '會場 09:30 才開、08:50 卡位：固定時段的站不看營業時間');
  assert.deepEqual(of('late-departure'), [], '固定時段的站當第一站不算太晚出門');
  assert.deepEqual(of('wait-at-door'), [], '第一站對齊卡位時刻＝晚點出門，不是空等');
  assert.deepEqual(of('night-slot'), [], 'fixed 日的夜間站：賓 20:05 起算有');
  assert.deepEqual(of('meal-slots'), [], '午餐整段在會場裡（大會供餐）、晚餐由賓 20:05–20:30 的重疊算有');
  assert.ok(d.plan.complete);
  assert.deepEqual(r.warnings, []);
  // 晚上沒排 bar：fixed 日照罰夜間站（原話 #18「每晚都要安排」是通則，不是只有 normal 日）；晚宴在研討會裡（會場到 20:00 才出來，過了晚餐段中點），晚餐不算缺
  const alone = fixedTrip({}, [{ poiId: venue.id, priority: 'must', fixedWindow: { startMin: 570, endMin: 1170 } }]).days[2];
  assert.deepEqual(alone.plan.warnings.filter((w) => w.ruleId === 'night-slot').map((w) => w.msg), ['今晚沒排夜間站']);
  assert.deepEqual(alone.plan.warnings.filter((w) => w.ruleId === 'meal-slots'), [], '只勾會場：午餐、晚餐都在會場裡（10-14 T23 審查後；之前「整段蓋住」會警告沒排晚餐）');
  // 晚場固定時段（演唱會 19:00–22:15、散場緩衝到 22:45）：對原時窗 24:00 比、留白扣掉的 22:30 不擋它；它本身跨進夜間時窗，不再要 bar（10-14 T23 審查：之前 never、整天空的）
  const concert = fixedTrip({ earlyDay: false, departHM: undefined }, [{ poiId: venue.id, priority: 'must', fixedWindow: { startMin: 19 * 60, endMin: 22 * 60 + 15 } }]).days[2];
  const c = concert.plan.sequence.find((s) => s.poi.id === venue.id);
  assert.ok(c && c.startMin === 18 * 60 + 20 && c.endMin === 22 * 60 + 45, `演唱會 18:20–22:45 要排進去：${concert.plan.sequence.map((s) => `${s.poi.id} ${s.startMin}–${s.endMin}`).join('→')}；落選 ${JSON.stringify(concert.plan.dropped.map((x) => x.reason))}`);
  assert.equal(concert.day.window.endMin, 22 * 60 + 30, '留白照扣，只是固定時段的站不對它比');
  assert.deepEqual(concert.plan.warnings.filter((w) => w.ruleId === 'window' || w.ruleId === 'night-slot' || w.ruleId === 'anchor'), []);
  // fixed 日卻沒有一站帶固定時段：整趟警告 fixed-day-no-window，會場照營業時間排
  const noWindow = fixedTrip({}, [{ poiId: venue.id, priority: 'must' }, { poiId: nightBar.id, priority: 'want', dwellMin: 90 }]);
  assert.deepEqual(noWindow.warnings.map((w) => [w.code, w.date]), [['fixed-day-no-window', '2026-08-14']]);
  assert.match(noWindow.warnings[0].msg, /沒有一站帶固定時段/);
  assert.ok(noWindow.days[2].plan.sequence.some((s) => s.poi.id === venue.id && s.fixedWindow === null));
  // 第 3 天、沒標早起日：fixed 日時窗照 normal 的 09:00、不套 11:00 晚出門；09:00 出門到不了 08:50 的卡位時刻 → 會場排不進、理由寫幾點前到（自動標早起日是待做）
  const plain = fixedTrip({ earlyDay: false, departHM: undefined }).days[2];
  assert.equal(plain.day.window.startMin, 540, 'fixed 日不套晚出門');
  assert.ok(!plain.plan.sequence.some((s) => s.poi.id === venue.id));
  assert.match(plain.plan.dropped.find((x) => x.poi.id === venue.id)?.reason ?? '', /要在 08:50 前到/);
});

test('fixedWindowOf／fixedSpanMin：只釘開始的（花火）補 arriveEarlyMin、不補 afterMin，寫了的照用；有起訖的補 afterMin；壞輸入當沒有固定時段、記整趟警告 fixed-window-bad（總則 0）；planTrip 照排不出 NaN', () => {
  assert.deepEqual(fixedWindowOf({ startMin: 1140, arriveEarlyMin: 30 }, settings), { startMin: 1140, arriveEarlyMin: 30 }, '海の盆那種：寫了 30 就是 30，沒有 endMin 不補 afterMin');
  assert.deepEqual(fixedWindowOf({ startMin: 1140 }, settings), { startMin: 1140, arriveEarlyMin: 40 }, 'arriveEarlyMin 缺補 fixedBeforeMin');
  assert.deepEqual(fixedWindowOf({ startMin: 570, endMin: 1170 }, settings), { startMin: 570, endMin: 1170, arriveEarlyMin: 40, afterMin: 30 });
  assert.deepEqual(fixedWindowOf({ startMin: 570, endMin: 1170, arriveEarlyMin: 0, afterMin: 0 }, settings), { startMin: 570, endMin: 1170, arriveEarlyMin: 0, afterMin: 0 }, '明寫 0 就是 0，不是缺值');
  assert.deepEqual(fixedWindowOf({ startMin: 570, endMin: 1170 }, { fixedBeforeMin: 10, fixedAfterMin: 5 }), { startMin: 570, endMin: 1170, arriveEarlyMin: 10, afterMin: 5 }, '預設讀 settings');
  assert.equal(fixedWindowOf(null, settings), null);
  assert.equal(fixedWindowOf(undefined, settings), null);
  assert.equal(fixedSpanMin({ startMin: 570, endMin: 1170, arriveEarlyMin: 40, afterMin: 30 }), 670);
  assert.equal(fixedSpanMin({ startMin: 1140, arriveEarlyMin: 30 }), undefined, '只釘開始的停留照 picks 或知識庫');
  assert.equal(fixedSpanMin(null), undefined);
  const warnings = [];
  assert.equal(fixedWindowOf({ startMin: '09:30' }, settings, warnings, '2026-08-14', venue), null);
  assert.equal(fixedWindowOf({ startMin: 570, endMin: 500 }, settings, warnings, '2026-08-14', venue), null, '結束比開始早');
  assert.equal(fixedWindowOf({ startMin: 570, endMin: 1170, arriveEarlyMin: -30 }, settings, warnings, '2026-08-14', venue), null, '提前量負數：卡位時刻會跑到開始之後（10-14 T23 審查）');
  assert.equal(fixedWindowOf({ startMin: 570, endMin: 1170, afterMin: -100 }, settings, warnings, '2026-08-14', venue), null, '散場緩衝負數：結束會早於散場');
  assert.equal(fixedWindowOf({ startMin: 1140, arriveEarlyMin: '30' }, settings, warnings, '2026-08-14', venue), null, '提前量不是數字');
  assert.deepEqual(warnings.map((w) => [w.code, w.date, w.poiId]), Array(5).fill(['fixed-window-bad', '2026-08-14', venue.id]));
  assert.match(warnings[2].msg, /提前量或散場緩衝不是 0 以上的分鐘數/);
  assert.match(warnings[0].msg, /^2026-08-14 的 會場 的固定時段看不懂/);
  assert.doesNotThrow(() => fixedWindowOf({ startMin: 'x' }), '不給 warnings 也不丟錯');
  // planTrip：fixedWindow 寫壞 → 整趟警告、那站當普通站照營業時間排（09:30 開門 → 晚點出門 09:30 起、待 60）
  const r = fixedTrip({}, [{ poiId: venue.id, priority: 'must', fixedWindow: { startMin: '09:30' } }]);
  assert.deepEqual(r.warnings.map((w) => w.code), ['fixed-window-bad', 'fixed-day-no-window'], '固定時段被拿掉後這個 fixed 日就沒有一站帶固定時段，再記一條 fixed-day-no-window（10-14 T23 審查後）');
  const v = r.days[2].plan.sequence.find((s) => s.poi.id === venue.id);
  assert.ok(v && v.fixedWindow === null && v.startMin === 9 * 60 + 30 && v.endMin === 10 * 60 + 30 && Number.isFinite(v.arriveMin), JSON.stringify(v && { startMin: v.startMin, endMin: v.endMin, fixedWindow: v.fixedWindow }));
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

test('shoppingDaysOf（原話 #36；DESIGN §1.5）：完整天 ≤2 只有離境日、3 加前一天從 shoppingAfternoonHM 起、≥4 含離境日的最後兩天；trip.shoppingDays 覆寫；沒 departure 日拿最後一天', () => {
  const mk = (types) => ({ days: types.map((type, i) => ({ date: `2026-08-${String(12 + i).padStart(2, '0')}`, type })) });
  const of = (trip, s = settings) => Object.fromEntries([...shoppingDaysOf(trip, s)].map(([date, v]) => [date, v.fromMin]));
  assert.deepEqual(of(mk(['arrival', 'departure'])), { '2026-08-13': null }, '0 完整天：只有離境日');
  assert.deepEqual(of(mk(['arrival', 'normal', 'departure'])), { '2026-08-14': null }, '1 完整天');
  assert.deepEqual(of(mk(['arrival', 'normal', 'normal', 'departure'])), { '2026-08-15': null }, '2 完整天');
  assert.deepEqual(of(mk(['arrival', 'normal', 'normal', 'normal', 'departure'])), { '2026-08-15': 13 * 60, '2026-08-16': null }, '3 完整天：離境日＋前一天 13:00 起');
  assert.deepEqual(of(mk(['arrival', 'normal', 'normal', 'normal', 'departure']), { ...settings, shoppingAfternoonHM: '14:30' }), { '2026-08-15': 14 * 60 + 30, '2026-08-16': null }, 'settings.shoppingAfternoonHM');
  assert.deepEqual(of(mk(['arrival', 'normal', 'normal', 'normal', 'normal', 'departure'])), { '2026-08-16': null, '2026-08-17': null }, '4 完整天：最後兩天整天');
  assert.deepEqual(of(mk(['arrival', 'normal', 'normal', 'normal', 'normal', 'normal', 'departure'])), { '2026-08-17': null, '2026-08-18': null }, '5 完整天（仙台七天）：8/17 全天＋8/18');
  assert.deepEqual(of({ ...mk(['arrival', 'normal', 'normal', 'normal', 'normal', 'normal', 'departure']), shoppingDays: ['2026-08-14', { date: '2026-08-16', fromHM: '15:00' }] }), { '2026-08-14': null, '2026-08-16': 15 * 60 }, 'trip.shoppingDays 覆寫：字串整天、物件帶 fromHM');
  assert.deepEqual(of({ ...mk(['normal', 'normal']), shoppingDays: [] }), {}, '空陣列＝這趟沒有購物日');
  assert.deepEqual(of(mk(['normal', 'normal'])), { '2026-08-13': null }, '沒 departure 日：最後一天當離境日');
  assert.deepEqual(of(mk(['normal', 'normal', 'normal', 'normal', 'normal'])), { '2026-08-15': null, '2026-08-16': null }, '沒 departure 日、5 完整天');
  assert.deepEqual(of(mk(['normal'])), { '2026-08-12': null }, '一天的旅程：那天就是購物日');
  assert.deepEqual(of({ days: [] }), {});
  assert.deepEqual(of({}), {});
});

test('planTrip：day 上下文帶 shoppingDay／shoppingFromMin；picks[].errand 進 stop；購物類勾在非購物日罰 80 並出警告，待辦站（errand）與購物日不罰', () => {
  const drug = pois[POIS['松本清'].id];
  const shrine = POIS['大崎八幡宮'].id;
  // 三個完整天、沒離境日 → 8/15 整天購物日、8/14 從 13:00 起（shoppingDaysOf）
  const trip = {
    id: 't', party: 1, homeBases: [{ poi: HOME }],
    days: [
      { date: '2026-08-13', type: 'normal', picks: [{ poiId: shrine, priority: 'must' }, { poiId: drug.id, priority: 'must' }] },
      { date: '2026-08-14', type: 'normal', picks: [{ poiId: shrine, priority: 'must' }, { poiId: drug.id, priority: 'must', errand: true }] },
      { date: '2026-08-15', type: 'normal', picks: [{ poiId: shrine, priority: 'must' }, { poiId: drug.id, priority: 'must' }] },
    ],
  };
  const r = planTrip({ trip, pois, rules, settings, country: COUNTRY, kb: KB, legFn, options: { explain: true } });
  const [d1, d2, d3] = r.days;
  assert.deepEqual([d1.day.shoppingDay, d1.day.shoppingFromMin], [false, null]);
  assert.deepEqual([d2.day.shoppingDay, d2.day.shoppingFromMin], [true, 13 * 60]);
  assert.deepEqual([d3.day.shoppingDay, d3.day.shoppingFromMin], [true, null]);
  const warned = (d) => d.plan.warnings.filter((w) => w.ruleId === 'shopping-day' && w.poiId === drug.id);
  const placed = (d) => d.plan.sequence.find((s) => s.poi.id === drug.id);
  assert.ok(placed(d1), 'must 的站還是排進去');
  assert.equal(warned(d1).length, 1, `非購物日勾藥妝要有一條警告：${d1.plan.warnings.map((w) => w.msg).join('；')}`);
  assert.equal(warned(d1)[0].msg, '松本清 是購物類的店，今天不是購物日');
  assert.equal(placed(d2).errand, true, 'picks[].errand 進 stop');
  assert.deepEqual(warned(d2), [], '待辦站（errand）＝順路購買，不罰');
  assert.ok(d1.plan.sequence.every((s) => s.errand === false), '沒勾 errand 的 stop 是 false，不是 undefined');
  assert.deepEqual(warned(d3), [], '購物日不罰');
  // 罰分落在那一站的拆解上：非購物日 80、待辦站與購物日沒有這一項（三天的時窗不同，整天罰分不能直接比）
  const shopItem = (d) => d.plan.breakdown.stops.find((s) => s.poiId === drug.id).items.find((i) => i.ruleId === 'shopping-day');
  assert.equal(shopItem(d1)?.minutes, 80);
  assert.equal(shopItem(d2), undefined);
  assert.equal(shopItem(d3), undefined);
});

test('shoppingDaysOf 壞輸入不丟錯（總則 0；跟 pick-unknown 同一種處理）：fromHM 不是 HH:MM 當整天購物日並記警告；settings.shoppingAfternoonHM 壞了也是；trip.shoppingDays 不是陣列記警告、照天數推；planTrip 整趟照排', () => {
  const mk = (types) => ({ days: types.map((type, i) => ({ date: `2026-08-${String(12 + i).padStart(2, '0')}`, type })) });
  const seven = mk(['arrival', 'normal', 'normal', 'normal', 'normal', 'normal', 'departure']);
  const list = (m) => [...m].map(([date, v]) => [date, v.fromMin]);
  let warnings = [];
  assert.deepEqual(list(shoppingDaysOf({ ...seven, shoppingDays: [{ date: '2026-08-14', fromHM: '13' }, '2026-08-16'] }, settings, warnings)), [['2026-08-14', null], ['2026-08-16', null]], 'fromHM 壞了：那天當整天購物日，別天不受影響');
  assert.deepEqual(warnings, [{ code: 'shopping-from-bad', date: '2026-08-14', msg: '2026-08-14 的購物時段起點「13」看不懂（要寫成 HH:MM），那天當整天購物日' }]);
  warnings = [];
  assert.deepEqual(list(shoppingDaysOf(mk(['arrival', 'normal', 'normal', 'normal', 'departure']), { ...settings, shoppingAfternoonHM: '1300' }, warnings)), [['2026-08-16', null], ['2026-08-15', null]], '設定壞了：三天旅程的前一天整天');
  assert.deepEqual(warnings.map((w) => [w.code, w.date]), [['shopping-from-bad', '2026-08-15']]);
  assert.ok(warnings[0].msg.includes('「1300」'), warnings[0].msg);
  warnings = [];
  assert.deepEqual([...shoppingDaysOf({ ...seven, shoppingDays: '2026-08-14' }, settings, warnings).keys()].sort(), ['2026-08-17', '2026-08-18'], '不是陣列：不靜默吃掉，照天數推');
  assert.deepEqual(warnings.map((w) => w.code), ['shopping-days-bad']);
  warnings = [];
  assert.deepEqual(list(shoppingDaysOf({ ...seven, shoppingDays: [{ fromHM: '13:00' }, '2026-08-15'] }, settings, warnings)), [['2026-08-15', null]], '沒日期的那筆跳過、記警告');
  assert.deepEqual(warnings.map((w) => w.code), ['shopping-days-bad']);
  assert.doesNotThrow(() => shoppingDaysOf({ ...seven, shoppingDays: [{ date: '2026-08-14', fromHM: '13' }] }), '不給 warnings 也不丟錯');
  assert.deepEqual(list(shoppingDaysOf({ ...seven, shoppingDays: null }, settings, warnings = [])), [['2026-08-18', null], ['2026-08-17', null]], 'null＝缺：照天數推、不警告');
  assert.deepEqual(warnings, []);
  // planTrip：整趟照排、警告進整趟 warnings（跟 pick-unknown 同一個陣列），那天當整天購物日所以藥妝不罰
  const trip = { id: 't', party: 1, homeBases: [{ poi: HOME }], shoppingDays: [{ date: '2026-08-13', fromHM: '13' }], days: [{ date: '2026-08-13', type: 'normal', picks: [{ poiId: POIS['松本清'].id, priority: 'must' }] }] };
  const r = planTrip({ trip, pois, rules, settings, country: COUNTRY, kb: KB, legFn });
  assert.equal(r.days.length, 1);
  assert.deepEqual([r.days[0].day.shoppingDay, r.days[0].day.shoppingFromMin], [true, null]);
  assert.deepEqual(r.warnings.filter((w) => w.code === 'shopping-from-bad').map((w) => w.date), ['2026-08-13']);
  assert.ok(!r.days[0].plan.warnings.some((w) => w.ruleId === 'shopping-day'), '當整天購物日，藥妝不罰');
});

test('示範夾具 DAY_0813／DAY_0817 手填的 shoppingDay／shoppingFromMin 要跟 planTrip 對 demoTrip() 推出來的一致（夾具與 App 的示範旅程不能分岔；10-14 審查後補）', () => {
  const r = planTrip({ trip: demoTrip(), pois, rules, settings, country: COUNTRY, kb: KB, legFn });
  const byDate = Object.fromEntries(r.days.map((d) => [d.date, [d.day.shoppingDay, d.day.shoppingFromMin]]));
  assert.deepEqual(byDate[DAY_0813.date], [DAY_0813.shoppingDay, DAY_0813.shoppingFromMin], '8/13');
  assert.deepEqual(byDate[DAY_0817.date], [DAY_0817.shoppingDay, DAY_0817.shoppingFromMin], '8/17');
  assert.deepEqual(byDate, { '2026-08-13': [false, null], '2026-08-17': [true, null] }, '兩個完整天、沒離境日 → 最後一天 8/17 整天購物日');
  assert.deepEqual(r.warnings, [], '示範旅程不該有整趟警告');
});

test('themeCategoryOf／planTrip：主題日的店型要對得上知識庫的店型——店型鍵照用；需求單上的中文（古著、唱片行、咖啡廳）照店型對照表翻；翻不出來記整趟警告 theme-unknown、那天當普通日排（10-14 T25 審查）', () => {
  assert.equal(themeCategoryOf({ date: '2026-08-17', anchor: { theme: 'vintage' } }), 'vintage');
  assert.equal(themeCategoryOf({ date: '2026-08-17', anchor: { theme: '古著' } }), 'vintage');
  assert.equal(themeCategoryOf({ date: '2026-08-17', anchor: { theme: '唱片行' } }), 'record');
  assert.equal(themeCategoryOf({ date: '2026-08-17', anchor: { theme: '咖啡廳' } }), 'cafe');
  assert.equal(themeCategoryOf({ date: '2026-08-17', anchor: { poiId: 'x' } }), null, '單站型主行程沒有主題');
  assert.equal(themeCategoryOf({ date: '2026-08-17' }), null);
  const warnings = [];
  assert.equal(themeCategoryOf({ date: '2026-08-17', anchor: { theme: '鄉間探索' } }, warnings), null);
  assert.deepEqual(warnings, [{ code: 'theme-unknown', date: '2026-08-17', msg: '2026-08-17 的主題「鄉間探索」看不出是哪一類店（寫古著、唱片行、咖啡廳這種類別），那天當普通日排' }]);
  assert.doesNotThrow(() => themeCategoryOf({ date: '2026-08-17', anchor: { theme: '鄉間探索' } }), '不給 warnings 也不丟錯');
  // planTrip：示範旅程 8/17 的 theme 寫成中文「古著」→ 仍是古著主題日（古著 ≥3 家、沒有整趟警告）
  const zh = demoTrip(); zh.days[1].anchor.theme = '古著';
  const r1 = planTrip({ trip: zh, pois, rules, settings, country: COUNTRY, kb: KB, legFn });
  assert.deepEqual(r1.warnings, []);
  assert.equal(r1.days[1].day.themeCategory, 'vintage');
  assert.ok(r1.days[1].plan.sequence.filter((s) => s.poi.category === 'vintage').length >= 3);
  // 寫成「鄉間探索」→ 整趟警告、那天當普通日（古著 ≤2、落選理由寫同類上限，畫面也不會寫成主題日）
  const bad = demoTrip(); bad.days[1].anchor.theme = '鄉間探索';
  const r2 = planTrip({ trip: bad, pois, rules, settings, country: COUNTRY, kb: KB, legFn });
  assert.deepEqual(r2.warnings.map((w) => [w.code, w.date]), [['theme-unknown', '2026-08-17']]);
  assert.equal(r2.days[1].day.themeCategory, null);
  assert.equal(r2.days[1].plan.sequence.filter((s) => s.poi.category === 'vintage').length, 2);
  assert.ok(r2.days[1].plan.dropped.some((d) => d.poi.category === 'vintage' && d.reason.includes('同類的店一天最多 2 家')));
});

test('planTrip（T16）：每天都回 plan.choices（沒有候選就空陣列）；順延過來的 pick（deferredFrom）排不進 → 整趟警告 deferred-dropped 帶日期與 poiId、不罰、trip.deferred 不自動改；排得進就帶在 stop 上；options.onlyDates 跳過的日子 plan 為 null', () => {
  const shop = mk('街區');
  const closedThu = mk('週四休的店', { hours: { fri: [['09:00', '23:00']] } });
  const trip = { id: 't', party: 1, homeBases: [{ poi: nightHome }], deferred: [{ poiId: closedThu.id, chosenPoiId: null, fromDate: '2026-08-12', toDate: '2026-08-13', status: 'placed', at: 'T0' }], days: [
    { date: '2026-08-12', type: 'normal', picks: [{ poiId: shop.id, priority: 'must' }] },
    { date: '2026-08-13', type: 'normal', picks: [{ poiId: shop.id, priority: 'must' }, { poiId: closedThu.id, priority: 'want', deferredFrom: '2026-08-12' }] },
  ] };
  const r = planTrip({ trip, pois: { [shop.id]: shop, [closedThu.id]: closedThu }, rules, settings, country: NIGHT_COUNTRY, kb: NIGHT_KB, legFn: flatLeg });
  assert.deepEqual(r.days.map((d) => d.plan.choices), [[], []], '沒有同類候選：空陣列，不是 undefined');
  assert.ok(r.days[1].plan.dropped.some((x) => x.poi.id === closedThu.id), '週四休的店 8/13 排不進');
  assert.equal(r.days[1].plan.dropped.find((x) => x.poi.id === closedThu.id).deferredFrom, '2026-08-12', '排不進清單那筆帶 deferredFrom（規劃頁寫「從 8/12 順延來的」）');
  assert.deepEqual(r.warnings.map((w) => [w.code, w.date, w.poiId]), [['deferred-dropped', '2026-08-13', closedThu.id]]);
  assert.equal(r.warnings[0].msg, '週四休的店 從 8/12 順延到這天，但這天排不進了');
  assert.deepEqual(trip.deferred[0].status, 'placed', '只出警告，不自動改 deferred');
  const bare = planTrip({ trip: { ...trip, deferred: undefined, days: [trip.days[0], { ...trip.days[1], picks: [trip.days[1].picks[0], { poiId: closedThu.id, priority: 'want' }] }] }, pois: { [shop.id]: shop, [closedThu.id]: closedThu }, rules, settings, country: NIGHT_COUNTRY, kb: NIGHT_KB, legFn: flatLeg });
  assert.deepEqual(bare.warnings, [], '不是順延來的就沒有這條');
  assert.equal(bare.days[1].plan.penaltyMin, r.days[1].plan.penaltyMin, '不罰');
  // 排得進：stop 帶 deferredFrom（畫面寫「從 8/12 順延」），別的站是 null
  const ok = planTrip({ trip: { ...trip, days: [trip.days[0], { ...trip.days[1], picks: [trip.days[1].picks[0], { poiId: '街區B', priority: 'want', deferredFrom: '2026-08-12' }] }] }, pois: { [shop.id]: shop, 街區B: mk('街區B') }, rules, settings, country: NIGHT_COUNTRY, kb: NIGHT_KB, legFn: flatLeg });
  assert.deepEqual(ok.warnings, []);
  assert.deepEqual(ok.days[1].plan.sequence.map((s) => [s.poi.id, s.deferredFrom]).sort(), [['街區', null], ['街區B', '2026-08-12']]);
  // onlyDates：8/12 不排
  const only = planTrip({ trip, pois: { [shop.id]: shop, [closedThu.id]: closedThu }, rules, settings, country: NIGHT_COUNTRY, kb: NIGHT_KB, legFn: flatLeg, options: { onlyDates: ['2026-08-13'] } });
  assert.deepEqual(only.days.map((d) => [d.date, d.plan === null, Boolean(d.day)]), [['2026-08-12', true, true], ['2026-08-13', false, true]]);
  assert.deepEqual(only.warnings.map((w) => w.code), ['deferred-dropped'], '跳過的日子不出警告，試排的那天照出');
});
