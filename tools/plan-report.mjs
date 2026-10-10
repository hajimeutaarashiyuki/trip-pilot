// 桌機上直接把一個打包檔丟給引擎排，印成人看的報告（T7 整合測試用；跟手機上看到的是同一套引擎、同一份資料）。
// 用法：node tools/plan-report.mjs <pack.json> [--explain]
// 唯讀：不寫任何檔。
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPack } from '../src/data/pack.js';
import { loadRules } from '../src/rules/index.js';
import { BUILTIN } from '../src/rules/builtin.js';
import { planTrip } from '../src/engine/trip.js';
import { makeLegFn } from '../src/geo/matrix.js';
import { minToHm } from '../src/engine/time.js';
import rulesJson from '../src/rules.json' with { type: 'json' };

export async function planPackFile(file, options = {}) {
  const { pack, pois, warnings } = readPack(await readFile(file, 'utf8'));
  const src = pack.rules ?? rulesJson;
  const settings = { ...src.settings };
  const rules = loadRules(BUILTIN, src.rules);
  const legFn = makeLegFn({ walk: pack.walk?.pairs ?? {}, settings, zoneLinks: pack.zones?.links ?? {} });
  const poiMap = Object.fromEntries(pois.map((p) => [p.id, p]));
  // restPool 給整個知識庫，跟手機上一樣（引擎插的站在報告行尾標「（引擎插）」）
  const result = planTrip({ trip: pack.trip, pois: poiMap, rules, settings, country: pack.country, kb: { zones: pack.zones?.zones ?? {} }, legFn, restPool: pois, options });
  return { pack, pois, normalizeWarnings: warnings, result, legFn };
}

export function formatReport({ pack, result, legFn }) {
  const lines = [];
  lines.push(`# ${pack.trip.name ?? pack.trip.id}（${pack.city?.name_zh ?? pack.city?.id}）打包於 ${pack.meta?.generatedAt ?? '?'}`);
  for (const d of result.days) {
    const { day, plan } = d;
    lines.push('');
    lines.push(`## ${d.date}（${day.type}${day.themeCategory ? `，${day.themeCategory} 主題` : ''}）主行程：${day.anchorName ?? '—'}　時窗 ${minToHm(day.window.startMin)}–${minToHm(day.window.endMin)}`);
    lines.push(`分數 ${plan.score}　罰分 ${Math.round(plan.penaltyMin)} 分鐘　${plan.complete ? '全排進' : '沒全排進'}　節點 ${plan.stats?.nodes ?? '?'}　${plan.stats?.ms ?? '?'} ms${plan.stats?.truncated ? '　（預算到了，截斷）' : ''}`);
    let prev = null;
    for (const s of plan.sequence) {
      const leg = prev ? legFn(prev.poi, s.poi) : null;
      const legText = leg ? `${leg.rideMin > 0 ? `車 ${leg.rideMin} 分、` : ''}走 ${leg.walkMin} 分${leg.source ? `（${leg.source}）` : ''}` : '';
      lines.push(`- ${minToHm(s.startMin)}–${minToHm(s.endMin)}　${s.poi.name_zh}　[${s.poi.category}]${s.isAnchor ? ' ★' : ''}${s.designated ? ' 指定' : ''}${s.waitMin > 5 ? `　等開門 ${s.waitMin}` : ''}${legText ? `　← ${legText}` : ''}${s.insertedBy ? '　（引擎插）' : ''}`);
      prev = s;
    }
    if (plan.dropped?.length) lines.push(`排不進：${plan.dropped.map((x) => `${x.poi.name_zh}（${x.reason}）`).join('；')}`);
    const warns = (plan.warnings ?? []).filter((w) => w.code !== 'skipped-missing' && !w.hint);
    if (warns.length) lines.push(`警告：${warns.map((w) => w.msg).join('；')}`);
    const hints = (plan.warnings ?? []).filter((w) => w.hint);
    if (hints.length) lines.push(`提示（拒絕過引擎插的站，不再插）：${hints.map((w) => w.msg).join('；')}`);
    const skipped = (plan.warnings ?? []).filter((w) => w.code === 'skipped-missing');
    if (skipped.length) lines.push(`規則因缺欄位跳過：${skipped.length} 次（${[...new Set(skipped.map((w) => w.ruleId ?? w.rule ?? '?'))].join('、')}）`);
  }
  if (result.warnings?.length) { lines.push(''); lines.push(`整趟警告：${result.warnings.map((w) => w.msg).join('；')}`); }
  return lines.join('\n');
}

async function main() {
  const file = process.argv[2];
  if (!file) { console.error('用法：node tools/plan-report.mjs <pack.json> [--explain]'); process.exit(2); }
  const r = await planPackFile(file, { explain: process.argv.includes('--explain') });
  console.log(formatReport(r));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((err) => { console.error(err); process.exit(1); });
