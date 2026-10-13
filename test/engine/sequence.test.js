// 整條序列重算（現場套用改案、重開還原用）：對 planDay 排出的序列算，score／penaltyMin／warnings 要跟 planDay 一模一樣；試走包三天也對。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { planDay } from '../../src/engine/core.js';
import { evaluateSequence } from '../../src/engine/sequence.js';
import { resolveHome } from '../../src/engine/trip.js';
import { loadRules } from '../../src/rules/index.js';
import { BUILTIN } from '../../src/rules/builtin.js';
import rulesJson from '../../src/rules.json' with { type: 'json' };
import { HOME, KB, COUNTRY, legFn, DAY_0813, DAY_0817, CANDS_0813, CANDS_0817 } from '../sendai/fixture.js';
import { planPackFile } from '../../tools/plan-report.mjs';

const rules = loadRules(BUILTIN, rulesJson.rules);
const settings = rulesJson.settings;
const PACK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../packs/pack.json');
const key = (w) => `${w.ruleId}|${w.code}|${w.poiId ?? ''}|${w.msg}`;

test('示範 8/13、8/17：planDay 的序列丟回 evaluateSequence，分數、罰分、全排進、警告一模一樣', () => {
  for (const [cands, day] of [[CANDS_0813, DAY_0813], [CANDS_0817, DAY_0817]]) {
    const plan = planDay({ candidates: cands, day, home: HOME, legFn, rules, settings, country: COUNTRY, kb: KB });
    const ev = evaluateSequence({ sequence: plan.sequence, day, home: HOME, legFn, rules, settings, country: COUNTRY, kb: KB });
    assert.equal(ev.score, plan.score, day.date);
    assert.equal(ev.penaltyMin, plan.penaltyMin, day.date);
    assert.equal(ev.complete, plan.complete, day.date);
    assert.deepEqual(ev.warnings.map(key), plan.warnings.map(key), day.date);
    assert.equal(ev.breakdown.stops.length, plan.sequence.length);
    assert.ok(ev.breakdown.stops.every((s) => s.verdict === 'ok'));
  }
});

test('只算序列、不改順序：拿掉主行程的序列分數變低、多一條主行程沒排進的警告；空序列也算得出來', () => {
  const plan = planDay({ candidates: CANDS_0813, day: DAY_0813, home: HOME, legFn, rules, settings, country: COUNTRY, kb: KB });
  const without = plan.sequence.filter((s) => s.poi.id !== DAY_0813.anchorPoiId);
  const ev = evaluateSequence({ sequence: without, day: DAY_0813, home: HOME, legFn, rules, settings, country: COUNTRY, kb: KB });
  assert.ok(ev.score < plan.score);
  assert.equal(ev.complete, false);
  assert.ok(ev.warnings.some((w) => w.ruleId === 'anchor'));
  const empty = evaluateSequence({ sequence: [], day: DAY_0813, home: HOME, legFn, rules, settings, country: COUNTRY, kb: KB });
  assert.ok(empty.penaltyMin > 0 && empty.score === -empty.penaltyMin);
});

test('試走包三天：planTrip 排出的序列（含引擎插的填站）重算，分數與罰分跟 planTrip 一樣', { skip: !existsSync(PACK) && '本機沒有 packs/pack.json' }, async () => {
  const r = await planPackFile(PACK);
  assert.equal(r.result.days.length, 3);
  for (const d of r.result.days) {
    const ev = evaluateSequence({ sequence: d.plan.sequence, day: d.day, home: resolveHome(r.pack.trip, d.date), legFn: r.legFn, rules: r.rules, settings: r.settings, country: r.pack.country, kb: r.kb });
    assert.equal(ev.score, d.plan.score, d.date);
    assert.equal(ev.penaltyMin, d.plan.penaltyMin, d.date);
    assert.deepEqual(ev.warnings.map(key), d.plan.warnings.filter((w) => !w.hint).map(key), d.date);
  }
});
