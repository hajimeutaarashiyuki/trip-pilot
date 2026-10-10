// 對帳腳本：profile.md 與 rules.json 的數字一致（決策樹 Q5）。本機有 profile.md 就對真的，沒有就只測合成案例。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { checkRules, CHECKS, DEFAULT_PROFILE, RULES_PATH } from '../../tools/check-rules.mjs';

test('合成案例：一致、不一致、找不到句型三種結果', () => {
  const rules = { settings: { walkBudgetMin: 150, maxWalkRunMin: 150, maxShopRunCount: 4, maxShopRunMin: 240 } };
  const good = '步行預算 150 分／日；走路連跑上限 150 分；逛店連跑上限 4 家或 240 分';
  const r1 = checkRules(good, rules);
  assert.deepEqual(r1.mismatches, []);
  assert.ok(r1.notFound.length === CHECKS.length - 4, '其他句型找不到要列出來');
  const r2 = checkRules(good.replace('240 分', '180 分'), rules);
  assert.deepEqual(r2.mismatches.map((m) => [m.key, m.profile, m.rules]), [['maxShopRunMin', 180, 240]]);
});

test('真的 profile.md 與 rules.json 對得上', { skip: !existsSync(DEFAULT_PROFILE) && '本機沒有 profile.md' }, async () => {
  const [profile, rules] = await Promise.all([readFile(DEFAULT_PROFILE, 'utf8'), readFile(RULES_PATH, 'utf8')]);
  const r = checkRules(profile, JSON.parse(rules));
  assert.deepEqual(r.notFound, [], '句型找不到：profile 改了寫法就更新 CHECKS');
  assert.deepEqual(r.mismatches, []);
});

test('日照邊界：profile 的「日出+30 到日落−30」兩個數字都要等於 daylightMarginMin', () => {
  const rules = { settings: { daylightMarginMin: 30 } };
  const r1 = checkRules('騎乘／駕駛只在日照內（日出+30 到日落−30，查表不接 API）', rules);
  assert.deepEqual(r1.mismatches, []);
  const r2 = checkRules('日出+30 到日落−45', rules);
  assert.deepEqual(r2.mismatches.map((m) => [m.key, m.profile, m.rules]), [['daylightMarginMin', 45, 30]]);
});
