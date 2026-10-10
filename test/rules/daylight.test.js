// 白天站（原話 #159「這類型的限制在白天就好了 晚上黑漆漆的 要怎麼參觀」）：daylightOnly 的站只能排在日出+30 到日落−30；
// 位置取站座標 → 區中心 → 區平均，都沒有不擋；國家層沒時區（country.utcOffsetMin）就由框架跳過並警告，不猜。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stop, ctx, run, warnOf, rules, country } from './_fixtures.js';
import { evaluateStop } from '../../src/engine/evaluate.js';

const SENDAI = { lat: 38.2688, lng: 140.8721 };
const jp = { ...country, utcOffsetMin: 540 };
/** 沒營業時段的神社：daylightOnly 推成 true；over 覆寫 poi 欄位（座標、daylightOnly）。 */
const shrine = (startMin, dwellMin = 60, over = {}) => { const s = stop('青葉神社', { startMin, dwellMin, hours: null }); return { ...s, poi: { ...s.poi, daylightOnly: true, ...over } }; };

test('8 月：20:00 到 never；16:00 到待 60 ok；18:00 到待 60 會待到天黑 no；05:00 到天還沒亮 no', () => {
  assert.equal(run('daylight', ctx(shrine(20 * 60, 60, SENDAI), { country: jp })), 'never');
  assert.equal(run('daylight', ctx(shrine(16 * 60, 60, SENDAI), { country: jp })), 'ok');
  assert.equal(run('daylight', ctx(shrine(18 * 60, 60, SENDAI), { country: jp })), 'no');
  assert.equal(run('daylight', ctx(shrine(5 * 60, 60, SENDAI), { country: jp })), 'no');
  assert.match(warnOf('daylight', ctx(shrine(18 * 60, 60, SENDAI), { country: jp })), /^青葉神社 只能白天去，日落 18:3\d，這樣待會待到天黑$/);
  assert.match(warnOf('daylight', ctx(shrine(20 * 60, 60, SENDAI), { country: jp })), /20:00 到的時候天已經黑了/);
  assert.match(warnOf('daylight', ctx(shrine(5 * 60, 60, SENDAI), { country: jp })), /日出 04:\d\d，05:00 到的時候天還沒亮/);
});

test('12 月天黑得早：16:30 到就 never；不是白天站 ok；位置不明不擋；區中心、區平均也能當位置', () => {
  assert.equal(run('daylight', ctx(shrine(16 * 60 + 30, 30, SENDAI), { country: jp, day: { date: '2026-12-21' } })), 'never');
  assert.equal(run('daylight', ctx(shrine(20 * 60, 60, { ...SENDAI, daylightOnly: false }), { country: jp })), 'ok');
  assert.equal(run('daylight', ctx(shrine(20 * 60, 60), { country: jp, kb: { zones: { ichibancho: { environment: 'urban' } } } })), 'ok', '站、區都沒座標 → 不擋');
  assert.equal(run('daylight', ctx(shrine(20 * 60, 60), { country: jp, kb: { zones: { ichibancho: { lat: 38.262, lng: 140.873 } } } })), 'never', '區中心');
  assert.equal(run('daylight', ctx(shrine(20 * 60, 60), { country: jp, kb: { zones: { ichibancho: {}, matsushima: { lat: 38.369, lng: 141.061 }, akiu: { lat: 38.24, lng: 140.72 } } } })), 'never', '區平均');
});

test('國家層沒寫時區：經引擎跑時整條跳過並警告（缺 country.utcOffsetMin），不當日本；daylightOnly 缺的站也跳過並警告、其他規則照跑', () => {
  // _fixtures 的 country 沒有 utcOffsetMin：20:00 的神社有時區是 never，缺時區就不擋
  const r0 = evaluateStop(ctx(shrine(20 * 60, 60, SENDAI)), rules);
  assert.equal(r0.verdict, 'ok');
  assert.ok(r0.warnings.some((w) => w.ruleId === 'daylight' && w.code === 'skipped-missing' && w.msg.includes('country.utcOffsetMin')));
  assert.equal(evaluateStop(ctx(shrine(20 * 60, 60, SENDAI), { country: jp }), rules).verdict, 'never', '有時區就擋');
  const r = evaluateStop(ctx(stop('X', { hours: null }), { country: jp }), rules);
  assert.equal(r.verdict, 'ok');
  assert.ok(r.warnings.some((w) => w.ruleId === 'daylight' && w.code === 'skipped-missing' && w.msg.includes('daylightOnly')));
});
