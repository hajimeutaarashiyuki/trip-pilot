// T3：六條累積量規則。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stop, ctx, run, settings } from './_fixtures.js';

test('腳的負荷：瑞鳳殿 40 分＝石段 6×1.5＋境內 34×0.5，加走路 10', () => {
  const s = stop('瑞鳳殿', { category: 'mausoleum', walkFactor: 0.5, dwellMin: 40, climbMin: 6 });
  const v = run('dim-walk', ctx(s, { leg: { walkMin: 10, rideMin: 0, climbMin: 0 } }));
  assert.equal(v, 10 + 34 * 0.5 + 6 * settings.climbFactor);
  const shop = stop('Utah', { category: 'vintage', walkFactor: 0, dwellMin: 60 });
  assert.equal(run('dim-walk', ctx(shop, { leg: { walkMin: 12 } })), 12, '古著店不算腳，只有走過去的 12 分');
  const climbLeg = run('dim-walk', ctx(shop, { leg: { walkMin: 10, climbMin: 4 } }));
  assert.equal(climbLeg, 10 + 4 * (settings.climbFactor - 1), '移動段的爬坡分鐘只加成一次');
});

test('走路連跑：累加；坐 30 分以上歸零；坐著搭車 30 分歸零；逛古著店不加也不歸零', () => {
  const walk = stop('商店街', { category: 'arcade', walkFactor: 0.5, dwellMin: 60 });
  let c = ctx(walk, { leg: { walkMin: 20 } });
  let v = run('dim-walk-run', c); assert.equal(v, 50);
  const shop = stop('Utah', { category: 'vintage', walkFactor: 0, dwellMin: 60 });
  v = run('dim-walk-run', ctx(shop, { leg: { walkMin: 10 }, acc: { 'dim-walk-run': v } })); assert.equal(v, 60, '店不加負荷，走過去的 10 分照加');
  const lunch = stop('一隆', { category: 'food', walkFactor: 0, recovery: true, dwellMin: 65 });
  v = run('dim-walk-run', ctx(lunch, { leg: { walkMin: 5 }, acc: { 'dim-walk-run': v } })); assert.equal(v, 0, '吃飯 65 分歸零');
  const snack = stop('小吃', { category: 'food', walkFactor: 0, recovery: true, dwellMin: 15 });
  v = run('dim-walk-run', ctx(snack, { leg: { walkMin: 10 }, acc: { 'dim-walk-run': 100 } })); assert.equal(v, 110, '15 分小吃不夠重置走路');
  v = run('dim-walk-run', ctx(walk, { leg: { walkMin: 5, rideMin: 40 }, acc: { 'dim-walk-run': 100 } })); assert.equal(v, 30, '搭車 40 分後從這站的負荷重新累');
});

test('逛店連跑：古著店 +1 家、深挖店 +2、吃喝 ≥10 分歸零、藥妝不算', () => {
  let v = run('dim-shop-run', ctx(stop('Utah', { category: 'vintage', walkFactor: 0, dwellMin: 60 })));
  assert.deepEqual(v, { count: 1, min: 60 });
  v = run('dim-shop-run', ctx(stop('TRUE VINTAGE', { category: 'vintage', walkFactor: 0, dwellMin: 60, deepDig: true }), { acc: { 'dim-shop-run': v } }));
  assert.deepEqual(v, { count: 3, min: 120 });
  v = run('dim-shop-run', ctx(stop('松本清', { category: 'drugstore', walkFactor: 0, dwellMin: 10 }), { acc: { 'dim-shop-run': v } }));
  assert.deepEqual(v, { count: 3, min: 120 }, '代購型不計也不歸零');
  v = run('dim-shop-run', ctx(stop('長椅', { category: 'food', walkFactor: 0, recovery: true, dwellMin: 10 }), { acc: { 'dim-shop-run': v } }));
  assert.deepEqual(v, { count: 0, min: 0 }, '10 分就算小休（#116）');
});

test('店型計數、恢復站連排、早起日下午計數', () => {
  const cafe = stop('珈巣多夢', { category: 'cafe', walkFactor: 0, recovery: true, cafeLike: true });
  assert.deepEqual(run('dim-cat-count', ctx(cafe, { acc: { 'dim-cat-count': { cafe: 1 } } })), { cafe: 2 });
  assert.equal(run('dim-rec-run', ctx(cafe, { acc: { 'dim-rec-run': 2 } })), 3);
  assert.equal(run('dim-rec-run', ctx(stop('神社'), { acc: { 'dim-rec-run': 2 } })), 0);
  assert.equal(run('dim-afternoon', ctx(stop('神社', { startMin: 14 * 60 }), { acc: { 'dim-afternoon': 1 } })), 2);
  assert.equal(run('dim-afternoon', ctx(stop('神社', { startMin: 10 * 60 }), { acc: { 'dim-afternoon': 1 } })), 1, '上午不算');
  assert.equal(run('dim-afternoon', ctx(cafe, { acc: { 'dim-afternoon': 1 } })), 1, '恢復站不算');
});
