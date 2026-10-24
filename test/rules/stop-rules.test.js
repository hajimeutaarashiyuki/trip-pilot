// T3：站層級的硬約束與軟約束。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stop, ctx, run, warnOf, rules, settings } from './_fixtures.js';
import { evaluateStop } from '../../src/engine/evaluate.js';
import { budgetMultiplier } from '../../src/rules/_helpers.js';

const HOURS = { thu: [['11:30', '13:30'], ['17:30', '21:00']] };   // 2026-08-13 是週四

test('hours：營業區間內 ok；開門前 no；全部過了 never；當天休 never；hours null 由引擎跳過並警告', () => {
  const s = (startMin, dwellMin = 60) => stop('Elbe', { category: 'cafe', hours: HOURS, startMin, dwellMin });
  assert.equal(run('hours', ctx(s(12 * 60))), 'ok');
  assert.equal(run('hours', ctx(s(11 * 60))), 'no');
  assert.equal(run('hours', ctx(s(16 * 60 + 35))), 'no', '16:35 到會跨到 17:00 關門，但晚上還有一段');
  assert.equal(run('hours', ctx(s(21 * 60 + 30))), 'never');
  assert.equal(run('hours', ctx(stop('X', { hours: { mon: [['09:00', '17:00']] }, startMin: 600 }))), 'never', '週四沒開');
  assert.match(warnOf('hours', ctx(s(11 * 60))), /11:00 到的時候不在營業時間內/);
  // 固定時段的站不看營業時間：研討會會場寫 09:30–19:30，08:50 到場卡位、20:00 散場都 ok（10-14 T23）
  const pinned = { startMin: 9 * 60 + 30, endMin: 19 * 60 + 30, arriveEarlyMin: 40, afterMin: 30 };
  assert.equal(run('hours', ctx({ ...s(8 * 60 + 50, 670), fixedWindow: pinned })), 'ok', '固定時段的站營業時間不擋');
  assert.equal(run('hours', ctx(s(8 * 60 + 50, 670))), 'no', '同一站沒有固定時段就照營業時間判');
  const r = evaluateStop(ctx(stop('巽や', { hours: null })), rules);
  assert.ok(r.warnings.some((w) => w.ruleId === 'hours' && w.code === 'skipped-missing'));
  assert.equal(r.verdict, 'ok');
});

test('ride-cost：每搭車一分鐘罰 0.25、quiet；沒搭車 0（10-13 七天實驗：搭車免費時引擎一天來回鹽竈兩趟）', () => {
  assert.equal(run('ride-cost', ctx(stop('X'), { leg: { walkMin: 5, rideMin: 28, climbMin: 0 } })), 7);
  assert.equal(run('ride-cost', ctx(stop('X'), { leg: { walkMin: 5, rideMin: 0, climbMin: 0 } })), 0);
  assert.equal(rules.byId.get('ride-cost').quiet, true);
});

test('zone-reentry：搭車離開一區再搭車回來罰 60；走路回來不算；第一次到不算（總則 5 同一區來回兩次罰；10-13 七天實驗）', () => {
  const a = stop('浦霞', { zoneId: 'shiogama' }); const b = stop('埃比昂', { zoneId: 'ichibancho' });
  const back = stop('鹽竈神社', { zoneId: 'shiogama' });
  const ride = { walkMin: 17, rideMin: 28, climbMin: 0 };
  assert.equal(run('zone-reentry', ctx(back, { prev: b, sequence: [a, b], leg: ride })), 60);
  assert.equal(run('zone-reentry', ctx(back, { prev: b, sequence: [a, b], leg: { walkMin: 6, rideMin: 0, climbMin: 0 } })), 0, '走路回來的隔壁區不算');
  assert.equal(run('zone-reentry', ctx(b, { prev: a, sequence: [a], leg: ride })), 0, '第一次到一番町');
  assert.match(warnOf('zone-reentry', ctx(back, { prev: b, sequence: [a, b], leg: ride })), /同一區來回兩次/);
  assert.equal(run('zone-reentry', ctx(back, { prev: b, sequence: [a, b], leg: ride, day: { homeZoneId: 'shiogama' } })), 0, '回據點所在的區不算，反正要回去');
});

test('fixed-window、window、max-stops', () => {
  const fw = stop('花火', { category: 'event', walkFactor: 0, startMin: 19 * 60 + 40, dwellMin: 20, fixedWindow: { startMin: 19 * 60 + 30, arriveEarlyMin: 30 } });
  assert.equal(run('fixed-window', ctx(fw)), 'never');
  assert.equal(run('fixed-window', ctx({ ...fw, startMin: 19 * 60 })), 'ok');
  // 現場改案（day.resumed）中途：釘起訖的站還沒散就 ok（人在會場裡、或遲到還趕得上後半）；散了才 never；只釘開始的花火遲到照樣錯過；出門前的排程遲到照樣 never（10-14 T23 審查後）
  const venue = stop('會場', { category: 'venue', walkFactor: 0, startMin: 12 * 60, dwellMin: 480, fixedWindow: { startMin: 9 * 60 + 30, endMin: 19 * 60 + 30, arriveEarlyMin: 40, afterMin: 30 } });
  assert.equal(run('fixed-window', ctx(venue, { day: { resumed: true } })), 'ok', '12:00 改案、研討會 19:30 才散');
  assert.equal(run('fixed-window', ctx({ ...venue, startMin: 19 * 60 + 40 }, { day: { resumed: true } })), 'never', '19:40 才到、已經散了');
  assert.match(warnOf('fixed-window', ctx({ ...venue, startMin: 19 * 60 + 40 }, { day: { resumed: true } })), /19:30 就散了/);
  assert.equal(run('fixed-window', ctx(venue)), 'never', '出門前排到 12:00 才到＝遲到，不排');
  assert.equal(run('fixed-window', ctx(fw, { day: { resumed: true } })), 'never', '花火只釘開始，改案中途遲到還是錯過');
  assert.equal(run('window', ctx(stop('夜', { startMin: 23 * 60 + 30, dwellMin: 60 }))), 'never');
  assert.equal(run('window', ctx(stop('夜', { startMin: 22 * 60, dwellMin: 60 }))), 'ok');
  // 固定時段的站對原時窗比、散場緩衝不算：留白扣掉後收工 22:30，演唱會 19:00–22:15 加緩衝到 22:45 照樣排得進（10-14 T23 審查：之前整天空的）
  const slack = { window: { startMin: 540, endMin: 22 * 60 + 30 }, windowRaw: { startMin: 540, endMin: 1440 } };
  const concert = stop('演唱會', { category: 'venue', walkFactor: 0, startMin: 18 * 60 + 20, dwellMin: 265, fixedWindow: { startMin: 19 * 60, endMin: 22 * 60 + 15, arriveEarlyMin: 40, afterMin: 30 } });
  assert.equal(concert.endMin, 22 * 60 + 45);
  assert.equal(run('window', ctx(concert, { day: slack })), 'ok', '散場 22:15 在原時窗 24:00 內');
  assert.equal(run('window', ctx(stop('bar', { startMin: 22 * 60, dwellMin: 45 }), { day: slack })), 'never', '一般的站照扣過留白的收工比');
  const lateShow = { ...concert, endMin: 24 * 60 + 20, fixedWindow: { ...concert.fixedWindow, endMin: 23 * 60 + 50 } };
  assert.equal(run('window', ctx(lateShow, { day: slack })), 'ok', '散場 23:50 加緩衝到 00:20：緩衝是不排站的時間，不是人要待到的時刻');
  assert.equal(run('window', ctx({ ...lateShow, endMin: 24 * 60 + 40, fixedWindow: { ...concert.fixedWindow, endMin: 24 * 60 + 10 } }, { day: slack })), 'never', '散場 00:10 超過原時窗');
  assert.match(warnOf('window', ctx({ ...lateShow, endMin: 24 * 60 + 40, fixedWindow: { ...concert.fixedWindow, endMin: 24 * 60 + 10 } }, { day: slack })), /會到 24:10，超過今天收工時間 24:00/);
  const fireworksLate = stop('晚花火', { category: 'event', walkFactor: 0, startMin: 22 * 60, dwellMin: 60, fixedWindow: { startMin: 22 * 60, arriveEarlyMin: 0 } });
  assert.equal(run('window', ctx(fireworksLate, { day: slack })), 'ok', '只釘開始的固定時段也對原時窗比（22:00–23:00）');
  const eight = Array.from({ length: 8 }, (_, i) => stop(`s${i}`));
  assert.equal(run('max-stops', ctx(stop('第九站'), { sequence: eight })), 'never');
  assert.equal(run('max-stops', ctx(stop('第八站'), { sequence: eight.slice(0, 7) })), 'ok');
});

test('same-type-day：非主題日第三家古著 no、主題日第三家與第四家都 ok（原話 #20 無上限）；咖啡廳同樣；early-day 下午第二個非恢復站 no', () => {
  const v = stop('me', { category: 'vintage', walkFactor: 0 });
  assert.equal(run('same-type-day', ctx(v, { acc: { 'dim-cat-count': { vintage: 3 } } })), 'no');
  assert.equal(run('same-type-day', ctx(v, { acc: { 'dim-cat-count': { vintage: 2 } } })), 'ok');
  assert.equal(run('same-type-day', ctx(v, { acc: { 'dim-cat-count': { vintage: 3 } }, day: { themeCategory: 'vintage' } })), 'ok', '主題日那一類無上限（原話 #20）');
  assert.equal(run('same-type-day', ctx(v, { acc: { 'dim-cat-count': { vintage: 4 } }, day: { themeCategory: 'vintage' } })), 'ok', '主題日第四家也 ok：家數只由逛店連跑與一天站數管');
  const c = stop('Elbe', { category: 'cafe', cafeLike: true, recovery: true, walkFactor: 0 });
  assert.equal(run('same-type-day', ctx(c, { acc: { 'dim-cat-count': { cafe: 3 } } })), 'no');
  assert.match(warnOf('same-type-day', ctx(c, { acc: { 'dim-cat-count': { cafe: 3 } } })), /咖啡廳已經 2 家/);
  // 順路站先於同類上限（原話 #170 先於 #123，他 10-24 定）：引擎插的順路站不受擋、也不數進那 2 家
  const onway = stop('SEGA-RU', { category: 'vintage', walkFactor: 0, priority: 'onway', insertedBy: 'engine' });
  assert.equal(run('same-type-day', ctx(onway, { acc: { 'dim-cat-count': { vintage: 3 } } })), 'ok', '非主題日已 3 家，順路站照排');
  assert.deepEqual(run('dim-cat-count', ctx(onway, { acc: { 'dim-cat-count': { vintage: 2 } } })), { vintage: 2 }, '順路站不數');
  assert.deepEqual(run('dim-cat-count', ctx(v, { acc: { 'dim-cat-count': { vintage: 2 } } })), { vintage: 3 }, '他勾的照數');
  const pm = stop('神社', { startMin: 14 * 60 });
  assert.equal(run('early-day', ctx(pm, { day: { earlyDay: true }, acc: { 'dim-afternoon': 2 } })), 'no');
  assert.equal(run('early-day', ctx(pm, { day: { earlyDay: true }, acc: { 'dim-afternoon': 1 } })), 'ok');
  assert.equal(run('early-day', ctx(pm, { day: { earlyDay: false }, acc: { 'dim-afternoon': 5 } })), 'ok');
});

test('walk-budget：超過才罰、倍率取最嚴；walk-run、shop-run 超過的分鐘', () => {
  assert.equal(run('walk-budget', ctx(stop('x'), { acc: { 'dim-walk': 140 } })), 0);
  assert.equal(run('walk-budget', ctx(stop('x'), { acc: { 'dim-walk': 170 } })), 20);
  assert.equal(run('walk-budget', ctx(stop('x'), { acc: { 'dim-walk': 170 }, accBefore: { 'dim-walk': 160 } })), 10, '只罰這一站新增的超出（10-13：原本每站重罰整個超出量）');
  assert.equal(run('walk-budget', ctx(stop('x'), { acc: { 'dim-walk': 170 }, accBefore: { 'dim-walk': 175 } })), 0, '這站沒再多走就不罰');
  assert.equal(run('walk-run', ctx(stop('x'), { acc: { 'dim-walk-run': 180 }, accBefore: { 'dim-walk-run': 160 } })), 20, '走路連跑同樣只罰新增的');
  const strict = ctx(stop('x'), { acc: { 'dim-walk': 120 }, day: { earlyDay: true, party: 2, dayTripNext: true } });
  assert.equal(run('walk-budget', strict), 120 - 150 * settings.earlyDayWalkFactor, '三個倍率同時中取最嚴的 0.7');
  assert.match(warnOf('walk-budget', strict), /超過上限 105/);
  assert.equal(run('walk-run', ctx(stop('x'), { acc: { 'dim-walk-run': 170 } })), 20);
  assert.equal(run('shop-run', ctx(stop('x'), { acc: { 'dim-shop-run': { count: 5, min: 300 } } })), 60 + 60);
  assert.equal(run('shop-run', ctx(stop('x'), { acc: { 'dim-shop-run': { count: 4, min: 240 } } })), 0);
});

test('cafe-adjacent、recovery-run、backtrack、zone-exit、noon-urban', () => {
  const cafe = (n) => stop(n, { category: 'cafe', walkFactor: 0, recovery: true, cafeLike: true });
  const food = stop('一隆', { category: 'food', walkFactor: 0, recovery: true });
  const bar = (n) => stop(n, { category: 'bar', walkFactor: 0, recovery: true });
  assert.equal(run('cafe-adjacent', ctx(cafe('火星の庭'), { prev: cafe('珈巣多夢') })), 40);
  assert.equal(run('cafe-adjacent', ctx(cafe('珈巣多夢'), { prev: food })), 0);
  assert.equal(run('recovery-run', ctx(cafe('珈巣多夢'), { prev: food, acc: { 'dim-rec-run': 2 } })), 10, '餐→咖啡 +10');
  assert.equal(run('recovery-run', ctx(bar('賓'), { prev: bar('汐谷'), acc: { 'dim-rec-run': 2 } })), 0, '續攤不罰');
  assert.equal(run('recovery-run', ctx(bar('汐谷'), { prev: food, acc: { 'dim-rec-run': 2 } })), 0, '晚餐接夜間站不罰');
  assert.equal(run('recovery-run', ctx(cafe('Elbe'), { prev: cafe('火星の庭'), acc: { 'dim-rec-run': 3 } })), 50, '第三個恢復站連排再 +40');
  assert.equal(run('backtrack', ctx(stop('x'), { leg: { walkMin: 10, backtrackMin: 5 } })), 10);
  assert.equal(run('zone-exit', ctx(stop('瑞鳳殿', { zoneId: 'kyogamine' }))), 60);
  assert.equal(run('zone-exit', ctx(stop('Utah'))), 0);
  const noon = stop('商店街', { category: 'arcade', walkFactor: 0.5, startMin: 12 * 60, dwellMin: 60 });
  assert.equal(run('noon-urban', ctx(noon)), 20);
  assert.equal(run('noon-urban', ctx({ ...noon, poi: { ...noon.poi, zoneId: 'matsushima' } })), 0, '松島不是都市');
  assert.equal(run('noon-urban', ctx(noon, { day: { date: '2026-11-13' } })), 0, '十一月不罰');
  assert.equal(run('noon-urban', ctx(stop('Utah', { category: 'vintage', walkFactor: 0, startMin: 12 * 60 }))), 0, '站著逛的店不罰');
});

test('wait-at-door：等開門超過 15 分的部分每分鐘罰 1、封頂 60；15 分內當留白；固定時段的站卡位提前量之外的空等照罰；第一站的等待已在排程改成晚出門（waitMin 0）', () => {
  assert.equal(run('wait-at-door', ctx({ ...stop('Elbe'), waitMin: 45 })), 30);
  assert.equal(run('wait-at-door', ctx({ ...stop('Elbe'), waitMin: 10 })), 0);
  assert.equal(run('wait-at-door', ctx({ ...stop('Elbe'), waitMin: 0 })), 0);
  assert.equal(run('wait-at-door', ctx({ ...stop('Elbe'), waitMin: 200 })), 60, '等 200 分罰到 capMin 60 封頂（10-14 試過 180：引擎為了少等會丟掉他勾的站，改回）');
  assert.equal(run('wait-at-door', ctx({ ...stop('Elbe'), waitMin: 75 })), 60, '剛好到頂');
  const fireworks = stop('花火', { category: 'event', walkFactor: 0, startMin: 19 * 60, dwellMin: 60, fixedWindow: { startMin: 19 * 60 + 30, arriveEarlyMin: 30 } });
  assert.equal(run('wait-at-door', ctx({ ...fireworks, waitMin: 200 })), 60, '固定時段（花火）：卡位提前量已在排程裡，比它更早到的空等照罰（10-13 七天實驗 8/16 空等 137 分）');
  assert.match(warnOf('wait-at-door', ctx({ ...fireworks, waitMin: 40 })), /比卡位時刻還早 40 分，空等/);
  assert.match(warnOf('wait-at-door', ctx({ ...stop('Elbe'), waitMin: 45 })), /^到 Elbe 要在門口等 45 分$/);
});

test('late-departure：只罰當天第一站、比時窗起點晚超過 60 分的部分每分鐘 1、封頂 60；第二站不算；現場接著排（day.resumed）不算；晚出門日起點 11:00', () => {
  const first = (startMin) => ctx(stop('第一站', { startMin }), { prev: null, sequence: [] });
  assert.equal(run('late-departure', first(11 * 60 + 30)), 60, '11:30 才開始：超過 90 分，封頂 60');
  assert.equal(run('late-departure', first(10 * 60 + 30)), 30);
  assert.equal(run('late-departure', first(9 * 60 + 50)), 0);
  assert.equal(run('late-departure', ctx(stop('第二站', { startMin: 11 * 60 + 30 }), { prev: stop('第一站'), sequence: [stop('第一站')] })), 0, '第二站不算');
  assert.equal(run('late-departure', ctx(stop('第一站', { startMin: 11 * 60 + 30 }), { day: { resumed: true } })), 0, '現場改案從當下接著排，不是出門');
  assert.equal(run('late-departure', ctx(stop('第一站', { startMin: 12 * 60 }), { day: { window: { startMin: 11 * 60, endMin: 1440 } } })), 0, '晚出門日時窗起點 11:00，12:00 到第一站不罰');
  assert.match(warnOf('late-departure', first(11 * 60 + 30)), /^今天 11:30 才出門，比預設晚 150 分$/);
  assert.match(warnOf('late-departure', ctx({ ...stop('第一站', { startMin: 11 * 60 + 30 }), arriveMin: 11 * 60 + 30 }, { leg: { walkMin: 5, rideMin: 20, climbMin: 0 } })), /^今天 11:05 才出門，比預設晚 125 分$/, '出門時刻＝到第一站減移動');
  // 罰的是出門時刻：第一段車 60＋走 10、09:00 出門 10:10 到，不罰（10-12 對抗審查：原本罰的是第一站開始時刻）
  assert.equal(run('late-departure', ctx({ ...stop('第一站', { startMin: 10 * 60 + 10 }), arriveMin: 10 * 60 + 10 }, { prev: null, sequence: [], leg: { walkMin: 10, rideMin: 60, climbMin: 0 } })), 0, '準時出門、第一段 70 分不罰');
  assert.equal(run('late-departure', ctx(stop('第一站', { startMin: 11 * 60 + 30 }), { prev: null, sequence: [], day: { type: 'departure' } })), 60, '飛機日也算：他說飛機日不算晚出門日（原話 #162）');
  assert.equal(run('late-departure', ctx({ ...stop('花火', { startMin: 19 * 60, category: 'event', walkFactor: 0 }), fixedWindow: { startMin: 19 * 60 + 30, arriveEarlyMin: 30 } }, { prev: null, sequence: [] })), 0, '固定時段的站當第一站不算');
});

test('filler-gap：填站的起訖要在它的空檔內，超出＝never；不是填站、沒有 gap 都 ok', () => {
  const gap = { startMin: 600, endMin: 720 };
  const filler = (startMin, dwellMin = 30) => ({ ...stop('藥妝店', { startMin, dwellMin, category: 'drugstore', walkFactor: 0 }), priority: 'filler', optional: true, insertedBy: 'engine', gap });
  assert.equal(run('filler-gap', ctx(filler(600))), 'ok');
  assert.equal(run('filler-gap', ctx(filler(690))), 'ok', '剛好貼齊空檔結束');
  assert.equal(run('filler-gap', ctx(filler(700))), 'never', '11:40–12:10 超出 12:00');
  assert.equal(run('filler-gap', ctx(filler(590))), 'never', '比空檔早開始');
  assert.equal(run('filler-gap', ctx({ ...filler(700), priority: 'rest' })), 'ok', '恢復站不綁空檔');
  assert.equal(run('filler-gap', ctx({ ...filler(700), gap: null })), 'ok');
  assert.equal(run('filler-gap', ctx(stop('他勾的', { startMin: 700 }))), 'ok');
  assert.match(warnOf('filler-gap', ctx(filler(700))), /^藥妝店 不在空檔內（10:00–12:00）$/);
});

test('max-stops：只數他勾的站，引擎插的（optional）不佔名額', () => {
  const eight = Array.from({ length: 8 }, (_, i) => stop(`s${i}`));
  const opt = { ...stop('咖啡廳', { category: 'cafe', walkFactor: 0, recovery: true }), optional: true, insertedBy: 'engine', priority: 'rest' };
  assert.equal(run('max-stops', ctx(opt, { sequence: eight })), 'ok', '已經 8 站還能插引擎的站');
  assert.equal(run('max-stops', ctx(stop('第八站'), { sequence: [...eight.slice(0, 7), opt] })), 'ok', '7 站＋1 個引擎插的，第 8 個他勾的站排得進');
  assert.equal(run('max-stops', ctx(stop('第九站'), { sequence: [...eight, opt] })), 'never');
  assert.match(warnOf('max-stops', ctx(stop('第九站'), { sequence: [...eight, opt] })), /^今天已經 8 站，上限 8$/);
});

test('walk-budget：一日遊本身 ×0.7（原話 #160，跟早起日同值）；倍率同時中取最嚴', () => {
  assert.equal(settings.dayTripWalkFactor, 0.7);
  assert.equal(budgetMultiplier({ dayTrip: true }, settings), 0.7);
  assert.equal(budgetMultiplier({ dayTrip: true, earlyDay: true, party: 2, dayTripNext: true }, settings), 0.7, '四個倍率同時中取最嚴');
  assert.equal(budgetMultiplier({ party: 2 }, settings), 0.85);
  assert.equal(budgetMultiplier({}, settings), 1);
  const dt = ctx(stop('x'), { acc: { 'dim-walk': 120 }, day: { dayTrip: true } });
  assert.equal(run('walk-budget', dt), 120 - 150 * 0.7, '一日遊非早起日的預算是 150×0.7');
  assert.match(warnOf('walk-budget', dt), /超過上限 105/);
});

test('walk-budget 同行者體力（T19，day.adjust.stamina；人之間取最鬆是 engine/persons.js 的事）：easy 0.85 進 min、hard 最後乘 1.15；跟早起日同時中先取最嚴再乘 hard；normal 與沒 adjust 不動', () => {
  assert.equal(settings.staminaEasyFactor, 0.85);
  assert.equal(settings.staminaHardFactor, 1.15);
  assert.equal(budgetMultiplier({ adjust: { stamina: 'easy' } }, settings), 0.85);
  assert.equal(budgetMultiplier({ adjust: { stamina: 'hard' } }, settings), 1.15);
  assert.equal(budgetMultiplier({ adjust: { stamina: 'normal' } }, settings), 1);
  assert.equal(budgetMultiplier({ party: 2, adjust: { stamina: 'easy' } }, settings), 0.85, '同行 0.85 跟 easy 0.85 取最嚴還是 0.85，不相乘');
  assert.equal(budgetMultiplier({ earlyDay: true, adjust: { stamina: 'easy' } }, settings), 0.7, '早起日 0.7 比 easy 嚴');
  assert.equal(budgetMultiplier({ earlyDay: true, adjust: { stamina: 'hard' } }, settings), 0.7 * 1.15, '早起日取最嚴 0.7 之後再乘 hard');
  assert.equal(budgetMultiplier({ earlyDay: true, party: 2, dayTripNext: true, adjust: { stamina: 'hard' } }, settings), 0.7 * 1.15);
  assert.equal(budgetMultiplier({ adjust: { stamina: 'easy' } }, { ...settings, staminaEasyFactor: 0.9 }), 0.9, '讀 settings');
  assert.equal(budgetMultiplier({ adjust: { stamina: 'hard' } }, { ...settings, staminaHardFactor: 1.2 }), 1.2);
  const easy = ctx(stop('x'), { acc: { 'dim-walk': 140 }, day: { adjust: { stamina: 'easy' } } });
  assert.equal(run('walk-budget', easy), 140 - 150 * 0.85, 'easy 的預算是 150×0.85');
  assert.match(warnOf('walk-budget', easy), /超過上限 128/);
  const hard = ctx(stop('x'), { acc: { 'dim-walk': 170 }, day: { adjust: { stamina: 'hard' } } });
  assert.equal(run('walk-budget', hard), 0, 'hard 的預算 172.5，170 沒超');
});

test('filler-gap：填站自己還要等開門就 never（原話 #164「禁」）', () => {
  const gap = { startMin: 600, endMin: 720 };
  const base = { ...stop('藥妝店', { startMin: 610, dwellMin: 30, category: 'drugstore', walkFactor: 0 }), priority: 'filler', optional: true, insertedBy: 'engine', gap };
  assert.equal(run('filler-gap', ctx({ ...base, waitMin: 0 })), 'ok');
  assert.equal(run('filler-gap', ctx({ ...base, waitMin: 10 })), 'never');
  assert.match(warnOf('filler-gap', ctx({ ...base, waitMin: 10 })), /再等開門 10 分/);
});

test('walk-cost：每走一分鐘 0.25、不出警告；same-type-day 主題日那一類無上限（原話 #20）、主題日的其他類仍 ≤2', () => {
  assert.equal(run('walk-cost', ctx(stop('A'), { leg: { walkMin: 10, rideMin: 0, climbMin: 0 } })), 2.5);
  assert.equal(run('walk-cost', ctx(stop('A'), { leg: { walkMin: 0, rideMin: 20, climbMin: 0 } })), 0);
  const r = evaluateStop(ctx(stop('A'), { leg: { walkMin: 10, rideMin: 0, climbMin: 0 } }), rules);
  assert.ok(r.penaltyMin >= 2.5 && !r.warnings.some((w) => w.ruleId === 'walk-cost'), '有罰分但不出黃字');
  const theme = { themeCategory: 'vintage' };
  assert.equal(run('same-type-day', ctx(stop('第三家', { category: 'vintage' }), { day: theme, acc: { 'dim-cat-count': { vintage: 3 } } })), 'ok');
  assert.equal(run('same-type-day', ctx(stop('第四家', { category: 'vintage' }), { day: theme, acc: { 'dim-cat-count': { vintage: 4 } } })), 'ok', '第四家也 ok：家數只由逛店連跑 4 家／240 分與一天 8 站管');
  assert.equal(run('same-type-day', ctx(stop('第八家', { category: 'vintage' }), { day: theme, acc: { 'dim-cat-count': { vintage: 8 } } })), 'ok');
  const cafe3 = ctx(stop('第三家咖啡', { category: 'cafe' }), { day: theme, acc: { 'dim-cat-count': { cafe: 3 } } });
  assert.equal(run('same-type-day', cafe3), 'no', '古著主題日的咖啡廳仍 ≤2');
  assert.match(warnOf('same-type-day', cafe3), /咖啡廳已經 2 家，不是咖啡廳主題日不再排/);
});

test('shopping-day（原話 #36、#55；DESIGN §5.2 舊表 +80）：購物類排在非購物日罰 80；購物日 0；前一天下午（shoppingFromMin）之前 80、之後 0；有品項或他勾的待辦（errand）0；非購物類 0；warn 是人話', () => {
  const drug = (over = {}) => stop('松本清', { category: 'drugstore', walkFactor: 0, dwellMin: 15, startMin: 12 * 60, ...over });
  assert.equal(run('shopping-day', ctx(drug())), 80, 'day 沒有 shoppingDay 就是非購物日');
  assert.equal(run('shopping-day', ctx(drug(), { day: { shoppingDay: false, shoppingFromMin: null } })), 80);
  assert.equal(run('shopping-day', ctx(drug(), { day: { shoppingDay: true, shoppingFromMin: null } })), 0, '購物日整天');
  assert.equal(run('shopping-day', ctx(drug({ startMin: 12 * 60 + 59 }), { day: { shoppingDay: true, shoppingFromMin: 13 * 60 } })), 80, '13:00 起才是購物時段，12:59 開始還是罰');
  assert.equal(run('shopping-day', ctx(drug({ startMin: 13 * 60 }), { day: { shoppingDay: true, shoppingFromMin: 13 * 60 } })), 0);
  for (const category of ['department', 'arcade', 'electronics', 'outlet']) assert.equal(run('shopping-day', ctx(stop('X', { category }))), 80, category);
  const research = stop('藤崎 香氛區', { category: 'department' }); research.poi.item = 'DKNY香水';
  assert.equal(run('shopping-day', ctx(research)), 0, '代購研究的站（有品項）＝順路購買，不罰（#29）');
  assert.equal(run('shopping-day', ctx({ ...drug(), errand: true })), 0, '他勾的待辦站（errand）＝順路購買，不罰');
  for (const category of ['vintage', 'record', 'store', 'bookstore', 'gift', 'market', 'cafe', 'food', 'shrine']) assert.equal(run('shopping-day', ctx(stop('Y', { category }))), 0, `${category} 不是購物類`);
  assert.equal(rules.byId.get('shopping-day').params.penaltyMin, 80, 'rules.json 的數字');
  assert.equal(rules.byId.get('shopping-day').scope, 'stop');
  assert.equal(warnOf('shopping-day', ctx(drug())), '松本清 是購物類的店，今天不是購物日');
  assert.equal(warnOf('shopping-day', ctx(drug(), { day: { shoppingDay: true, shoppingFromMin: 13 * 60 } })), '松本清 是購物類的店，今天 13:00 起才是購物時段');
  // 走整個 evaluateStop：罰分進 breakdown、警告帶 poiId；購物日不出任何 shopping-day 警告
  const r = evaluateStop(ctx(drug()), rules);
  assert.ok(r.breakdown.some((b) => b.ruleId === 'shopping-day' && b.minutes === 80));
  assert.ok(r.warnings.some((w) => w.ruleId === 'shopping-day' && w.code === 'soft' && w.poiId === '松本清'));
  assert.ok(!evaluateStop(ctx(drug(), { day: { shoppingDay: true, shoppingFromMin: null } }), rules).warnings.some((w) => w.ruleId === 'shopping-day'));
});
