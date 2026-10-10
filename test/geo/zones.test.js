// 歸區：最早出現的關鍵字優先、同位置取較長；area 沒有就看名字；都沒有回 null。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zoneOf, zoneOfPoi } from '../../src/geo/zones.js';

const zones = {
  'sendai-station': { keywords: ['仙台站', '中央2'] },
  east: { keywords: ['仙台站東口', '榴岡'] },
  ichibancho: { keywords: ['一番町', '本町', '晩翠通'] },
  kokubuncho: { keywords: ['國分町', '定禪寺'] },
  yamadera: { keywords: ['山寺'] },
};

test('zoneOf：同位置取較長、最早出現優先', () => {
  assert.equal(zoneOf('仙台站東口即到（宮城野区榴岡1-3-1）', zones), 'east');
  assert.equal(zoneOf('國分町／晩翠通（青葉区立町15-17）', zones), 'kokubuncho');
  assert.equal(zoneOf('本町（菊田屋ビル 3F，SQUAT 樓上）', zones), 'ichibancho');
  assert.equal(zoneOf('仙台市青葉区中央2-2-24（クリスロード）', zones), 'sendai-station');
  assert.equal(zoneOf('山形市 霞城公園', zones), null);
  assert.equal(zoneOf('', zones), null);
});

test('zoneOfPoi：明寫 zoneId 優先，area 沒有就看名字', () => {
  assert.equal(zoneOfPoi({ zoneId: 'east', area: '一番町' }, zones), 'east');
  assert.equal(zoneOfPoi({ area: '山形縣山形市（仙山線沿線）', name_zh: '山寺（寶珠山立石寺）' }, zones), 'yamadera');
  assert.equal(zoneOfPoi({ area: '', name_local: 'Utah', name_zh: 'Utah' }, zones), null);
});
