// 營業時間文字解析：拿仙台知識庫裡真的寫法當案例。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHoursText, daysOf, rangesOf } from '../../src/derive/hours.js';

const all = (r) => ({ mon: r, tue: r, wed: r, thu: r, fri: r, sat: r, sun: r });

test('rangesOf：～、–、-、翌、24時間', () => {
  assert.deepEqual(rangesOf('11:30～22:00'), [['11:30', '22:00']]);
  assert.deepEqual(rangesOf('午11:30～14:30／晚17:00～22:30'), [['11:30', '14:30'], ['17:00', '22:30']]);
  assert.deepEqual(rangesOf('8:00～翌2:00'), [['08:00', '26:00']]);
  assert.deepEqual(rangesOf('17:00～24:00'), [['17:00', '24:00']]);
  assert.deepEqual(rangesOf('24時間営業、無休'), [['00:00', '24:00']]);
  assert.deepEqual(rangesOf('9:00 起約每小時一班'), []);
});

test('daysOf：平日、土日祝、範圍跨週日、連寫、單日；「一番町」的一不算', () => {
  assert.deepEqual([...daysOf('平日')], [0, 1, 2, 3, 4]);
  assert.deepEqual([...daysOf('土日祝')], [5, 6]);
  assert.deepEqual([...daysOf('日～木')].sort(), [0, 1, 2, 3, 6]);
  assert.deepEqual([...daysOf('週一～三・五')].sort(), [0, 1, 2, 4]);
  assert.deepEqual([...daysOf('金土')], [4, 5]);
  assert.deepEqual([...daysOf('每週日曜・祝日')], [6]);
  assert.equal(daysOf('一番町店'), null);
  assert.equal(daysOf('本館1F'), null);
});

test('簡單一段＋週一公休', () => {
  const r = parseHoursText('11:30～22:00（視來客與售罄狀況可能提早打烊）；週一・年末年始公休（せんだい）');
  assert.deepEqual(r.hours, { ...all([['11:30', '22:00']]), mon: [] });
  assert.deepEqual(r.closedDays, ['mon']);
  assert.equal(r.partial, false);
});

test('午晚兩段都算全週', () => {
  const r = parseHoursText('午11:30～14:30／晚17:00～22:30（訂位網站查證；LO與公休日未確認）');
  assert.deepEqual(r.hours.thu, [['11:30', '14:30'], ['17:00', '22:30']]);
  assert.match(r.note, /不確定/);
});

test('平日／日曜：週六跟平日走', () => {
  const r = parseHoursText('平日 8:00–22:00（8/17 週一適用）／日曜 9:00–22:00、無休');
  assert.deepEqual(r.hours.mon, [['08:00', '22:00']]);
  assert.deepEqual(r.hours.sat, [['08:00', '22:00']]);
  assert.deepEqual(r.hours.sun, [['09:00', '22:00']]);
  assert.equal(r.partial, false);
});

test('週一～六／週日假日 各自一段', () => {
  const r = parseHoursText('〔修正〕週一～六 12:00–19:30、週日假日 11:00–19:00、不定休');
  assert.deepEqual(r.hours.sat, [['12:00', '19:30']]);
  assert.deepEqual(r.hours.sun, [['11:00', '19:00']]);
  assert.match(r.note, /不定休/);
});

test('只有週日營業的朝市：其他天休、標 partial', () => {
  const r = parseHoursText('每週日曜・祝日 6:00～13:00（官網 yuriageasaichi.jp 確認）');
  assert.deepEqual(r.hours.sun, [['06:00', '13:00']]);
  assert.deepEqual(r.hours.mon, []);
  assert.equal(r.partial, true);
});

test('週三定休寫在後面一段；定休日＝週三', () => {
  assert.deepEqual(parseHoursText('12:00–20:00、週三定休〔皆已確認〕').hours.wed, []);
  assert.deepEqual(parseHoursText('13:00-22:00；定休日＝週三。電話 022').hours.wed, []);
  assert.deepEqual(parseHoursText('15:00～22:00；週日・週三休（官網查證）').closedDays, ['wed', 'sun']);
});

test('日～木／金土 的百貨；跨日的唐吉訶德', () => {
  const r = parseHoursText('日～木 10:00～20:00、金土 10:00～21:00【S-PAL 官方樓層】');
  assert.deepEqual(r.hours.sun, [['10:00', '20:00']]);
  assert.deepEqual(r.hours.fri, [['10:00', '21:00']]);
  assert.deepEqual(parseHoursText('8:00～翌2:00、無休【官方 donki.com】').hours.mon, [['08:00', '26:00']]);
});

test('看不出時段回 null；括號裡的時段不算', () => {
  assert.equal(parseHoursText('—').hours, null);
  assert.equal(parseHoursText('境內自由參拜；授與所受付時間未確認（一般約 9:00-17:00）').hours, null);
  const r = parseHoursText('境內自由參拜；授與所 9:00-17:00、御朱印受付約 9:00-16:00');
  assert.deepEqual(r.hours.mon, [['09:00', '16:00'], ['09:00', '17:00']]);
});
