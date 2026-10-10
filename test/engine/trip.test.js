// 整趟：兩天的旅程，每天各自排；晚出門日從第 3 天起；主題日的前一天主題傳下去；早起日前一晚夜間站取消。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planTrip, dayWindow } from '../../src/engine/trip.js';
import { loadRules } from '../../src/rules/index.js';
import { BUILTIN } from '../../src/rules/builtin.js';
import rulesJson from '../../src/rules.json' with { type: 'json' };
import { POIS, HOME, KB, COUNTRY, legFn } from '../sendai/fixture.js';

const rules = loadRules(BUILTIN, rulesJson.rules);
const settings = rulesJson.settings;
const pois = Object.fromEntries(Object.values(POIS).map((p) => [p.id, p]));

test('dayWindow：預設 9–24；第 3 天起 11 點出門；早起日照出門時刻；抵達與離境日套緩衝', () => {
  assert.deepEqual(dayWindow({ type: 'normal' }, 0, settings), { startMin: 540, endMin: 1440 });
  assert.equal(dayWindow({ type: 'normal' }, 2, settings).startMin, 660);
  assert.equal(dayWindow({ type: 'normal', earlyDay: true, departHM: '07:30' }, 2, settings).startMin, 450);
  assert.equal(dayWindow({ type: 'arrival', arriveMin: 16 * 60 }, 0, settings).startMin, 17 * 60);
  assert.equal(dayWindow({ type: 'departure', departAirportMin: 15 * 60 }, 6, settings).endMin, 12 * 60);
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
  assert.ok(d2.plan.sequence.filter((s) => s.poi.category === 'vintage').length >= 3);
  assert.ok(d1.plan.sequence.some((s) => s.poi.id === POIS['汐谷'].id));
});
