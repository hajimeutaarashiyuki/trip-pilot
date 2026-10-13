// 對帳：profile.md（給人讀）與 src/rules.json（引擎讀）的數字要一致（決策樹 Q5）。
// 用法：node tools/check-rules.mjs [profile.md 路徑]；預設找專案根目錄的 ../profile.md（私人倉庫）。
// 只比「人話裡寫了數字」的那幾條；新增設定值時在 CHECKS 加一列。
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_PROFILE = path.resolve(here, '../../profile.md');
export const RULES_PATH = path.resolve(here, '../src/rules.json');

/** 每列：profile 裡的句型（第一個擷取群是數字）→ rules.json 的設定鍵。 */
export const CHECKS = [
  { key: 'themeDaySameTypeMax', pattern: /主題日那一類最多 (\d+) 家/, label: '主題日同類上限' },
  { label: '步行預算', pattern: /步行預算 (\d+) 分／日/, key: 'walkBudgetMin' },
  { label: '走路連跑上限', pattern: /走路連跑上限 (\d+) 分/, key: 'maxWalkRunMin' },
  { label: '逛店連跑家數', pattern: /逛店連跑上限 (\d+) 家或 \d+ 分/, key: 'maxShopRunCount' },
  { label: '逛店連跑分鐘', pattern: /逛店連跑上限 \d+ 家或 (\d+) 分/, key: 'maxShopRunMin' },
  { label: '小休重置逛店', pattern: /任何恢復 ≥(\d+) 分重置逛店連跑/, key: 'microRestMin' },
  { label: '恢復重置走路', pattern: /≥(\d+) 分重置走路連跑/, key: 'restResetMin' },
  { label: '深挖店算幾家', pattern: /連跑計數算 (\d+) 家/, key: 'deepDigCount' },
  { label: '非主題日同類店上限', pattern: /非主題日同類店每天 ≤(\d+)/, key: 'sameTypeMaxPerDay' },
  { label: '留白', pattern: /每天留 (\d+) 分鐘/, key: 'openSlotMinPerDay' },
  { label: '早起日步行預算', pattern: /步行預算 150→(\d+)/, key: 'earlyDayWalkFactor', transform: (n) => Math.round((n / 150) * 100) / 100 },
  // 一日遊本身的倍率跟早起日同一句（profile §2.4「一日遊／早起日的 0.7 倍留著」，原話 #160）
  { label: '一日遊步行預算倍率', pattern: /一日遊／早起日的 (0\.\d+) 倍留著/, key: 'dayTripWalkFactor' },
  // 日照邊界「日出+30 到日落−30」：兩個數字都要等於 daylightMarginMin（profile 寫的減號是 U+2212，不是連字號）
  { label: '日照邊界（日出側）', pattern: /日出\+(\d+) 到日落−\d+/, key: 'daylightMarginMin' },
  { label: '日照邊界（日落側）', pattern: /日出\+\d+ 到日落−(\d+)/, key: 'daylightMarginMin' },
];

/** 純函式：回 { ok, mismatches[], notFound[] }，給測試與 CLI 共用。 */
export function checkRules(profileText, rulesJson) {
  const settings = rulesJson.settings ?? {};
  const mismatches = []; const notFound = [];
  for (const c of CHECKS) {
    const m = profileText.match(c.pattern);
    if (!m) { notFound.push(c.label); continue; }
    const fromProfile = c.transform ? c.transform(Number(m[1])) : Number(m[1]);
    const fromRules = settings[c.key];
    if (fromProfile !== fromRules) mismatches.push({ label: c.label, key: c.key, profile: fromProfile, rules: fromRules });
  }
  return { ok: mismatches.length === 0 && notFound.length === 0, mismatches, notFound };
}

async function main() {
  const profilePath = process.argv[2] ?? DEFAULT_PROFILE;
  if (!existsSync(profilePath)) { console.error(`找不到 profile.md：${profilePath}`); process.exit(2); }
  const [profileText, rulesText] = await Promise.all([readFile(profilePath, 'utf8'), readFile(RULES_PATH, 'utf8')]);
  const r = checkRules(profileText, JSON.parse(rulesText));
  for (const m of r.mismatches) console.log(`不一致  ${m.label}：profile ${m.profile}，rules.json ${m.rules}（${m.key}）`);
  for (const n of r.notFound) console.log(`沒找到  ${n}（profile 的句型變了，更新 CHECKS）`);
  console.log(r.ok ? `對帳一致：${CHECKS.length} 條` : `對帳失敗：${r.mismatches.length} 條不一致、${r.notFound.length} 條沒找到`);
  process.exit(r.ok ? 0 : 1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
