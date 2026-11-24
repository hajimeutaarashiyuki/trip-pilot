// 對帳腳本：profile.md 與 rules.json 的數字一致（決策樹 Q5）。本機有 profile.md 就對真的，沒有就只測合成案例。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { checkRules, checkCountry, formatCountryValue, CHECKS, COUNTRY_CHECKS, DEFAULT_PROFILE, DEFAULT_COUNTRY, RULES_PATH } from '../../tools/check-rules.mjs';

test('國家層對帳（T20）：通用引用「kb/country/jp.json：路徑＝值」逐筆比（jp.json 沒有的鍵也算不一致）、COUNTRY_CHECKS 的既有句型沒搬走時也比、兩種都沒有算沒找到；值的標準寫法', () => {
  const jp = { taxRefund: { bufferMin: 45 }, nightSlot: ['20:00', '24:00'], climate: { summerMonths: [6, 7, 8, 9] }, mealSlots: { lunch: ['11:30', '13:30'] } };
  assert.equal(formatCountryValue(45), '45');
  assert.equal(formatCountryValue(['20:00', '24:00']), '20:00–24:00');
  assert.equal(formatCountryValue([6, 7, 8, 9]), '6–9');
  assert.equal(formatCountryValue([12, 1, 2]), '12/1/2');
  assert.equal(formatCountryValue(undefined), null);
  const legacy = '離境日在報到之前多留 45 分；夜間站的時段仍看 20:00–24:00；夏季（6–9 月）11:30–14:30';
  const r1 = checkCountry(legacy, jp);
  assert.deepEqual([r1.mismatches, r1.notFound, r1.cites], [[], [], 0]);
  const moved = '離境日依國家層留緩衝（日本值見 `kb/country/jp.json`：taxRefund.bufferMin＝45）；夜間站時段（kb/country/jp.json：nightSlot＝20:00–24:00、mealSlots.lunch＝11:30–13:30）；夏季月份（kb/country/jp.json: climate.summerMonths=6-9）';
  const r2 = checkCountry(moved, jp);
  assert.deepEqual([r2.mismatches, r2.notFound, r2.cites], [[], [], 4], '反引號、半形冒號與等號、連字號都認');
  const wrong = checkCountry('（kb/country/jp.json：taxRefund.bufferMin＝30、nightSlot＝20:00–23:00、climate.summerMonths＝6–9、knifeLaw.bladeCm＝6）', jp);
  assert.deepEqual(wrong.mismatches.map((m) => [m.key, m.profile, m.rules]), [['taxRefund.bufferMin', '30', '45'], ['nightSlot', '20:00–23:00', '20:00–24:00'], ['knifeLaw.bladeCm', '6', '（jp.json 沒有這個鍵）']]);
  assert.deepEqual(wrong.notFound, []);
  const none = checkCountry('沒有任何引用，也沒有舊句型', jp);
  assert.equal(none.notFound.length, COUNTRY_CHECKS.length);
  assert.ok(none.notFound.every((n) => n.startsWith('國家層') && n.includes('kb/country/jp.json：')), '沒找到的句子要告訴人怎麼寫');
  // checkRules 第三個參數帶國家層才算；不帶就跟以前一樣
  const rules = { settings: {} };
  assert.equal(checkRules(legacy, rules).notFound.length, CHECKS.length);
  assert.equal(checkRules(legacy, rules, jp).notFound.length, CHECKS.length);
  assert.equal(checkRules(legacy, rules, jp).countryCites, 0);
  assert.equal(checkRules('x', rules, jp).notFound.length, CHECKS.length + COUNTRY_CHECKS.length);
});

test('真的 profile.md 與 kb/country/jp.json 對得上（國家層對帳）', { skip: !(existsSync(DEFAULT_PROFILE) && existsSync(DEFAULT_COUNTRY)) && '本機沒有 profile.md 或 kb/country/jp.json' }, async () => {
  const [profile, rules, jp] = await Promise.all([readFile(DEFAULT_PROFILE, 'utf8'), readFile(RULES_PATH, 'utf8'), readFile(DEFAULT_COUNTRY, 'utf8')]);
  const r = checkRules(profile, JSON.parse(rules), JSON.parse(jp));
  assert.deepEqual(r.notFound, [], '國家層的句型找不到：profile 改了寫法就用「kb/country/jp.json：路徑＝值」的引用');
  assert.deepEqual(r.mismatches, []);
});

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

test('一日遊倍率：profile 的「一日遊／早起日的 0.7 倍留著」對 dayTripWalkFactor（原話 #160）', () => {
  const rules = { settings: { dayTripWalkFactor: 0.7 } };
  const r1 = checkRules('一日遊／早起日的 0.7 倍留著（原話 #160）', rules);
  assert.ok(!r1.mismatches.some((m) => m.key === 'dayTripWalkFactor'));
  assert.ok(!r1.notFound.includes('一日遊步行預算倍率'));
  const r2 = checkRules('一日遊／早起日的 0.8 倍留著', rules);
  assert.deepEqual(r2.mismatches.map((m) => [m.key, m.profile, m.rules]), [['dayTripWalkFactor', 0.8, 0.7]]);
});

test('安插與早餐的數字（11-24；原話 #192、#194、#196、#197 的預設與 #184 的繞路 8 分）：設定值照 settings 對，規則參數（沒排早餐罰幾分）照 rules[規則 id] 對', () => {
  const rules = { settings: { insertMinDwellMin: 30, breakfastWalkMaxMin: 12, breakfastDefaultDwellMin: 40, breakfastScoreSlackMin: 30, breakfastOfferShiftMaxMin: 10, onTheWayDetourMin: 8 }, rules: { 'breakfast-slot': { weight: 1, missMin: 10 } } };
  const good = '安插進來的站至少待 30 分；離住宿走路 12 分以內；早餐預設待 40 分；比當天最好的那家差超過 30 分；其餘各站最多晚 10 分；多繞不超過 8 分；沒排早餐罰 10 分';
  const labels = ['安插的站至少待', '早餐離住宿走路上限', '早餐預設停留', '早餐不合這天的門檻', '沒去到的早餐再推薦的順延上限', '順路的繞路上限', '沒排早餐的罰'];
  const r1 = checkRules(good, rules);
  assert.deepEqual(r1.mismatches, []);
  for (const l of labels) assert.ok(CHECKS.some((c) => c.label === l) && !r1.notFound.includes(l), l);
  const r2 = checkRules(good.replace('沒排早餐罰 10 分', '沒排早餐罰 20 分').replace('走路 12 分以內', '走路 15 分以內'), rules);
  assert.deepEqual(r2.mismatches.map((m) => [m.key, m.profile, m.rules]), [['breakfastWalkMaxMin', 15, 12], ['breakfast-slot.missMin', 20, 10]]);
  assert.deepEqual(checkRules(good, { settings: rules.settings }).mismatches.map((m) => [m.key, m.rules]), [['breakfast-slot.missMin', undefined]], 'rules.json 沒有那條規則也算不一致');
});
