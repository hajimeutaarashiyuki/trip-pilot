// 桌機上直接把一個打包檔丟給引擎排，印成人看的報告（T7 整合測試用；跟手機上看到的是同一套引擎、同一份資料）。
// 用法：node tools/plan-report.mjs <pack.json> [--explain]
// 唯讀：不寫任何檔。
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPack } from '../src/data/pack.js';
import { loadRules } from '../src/rules/index.js';
import { BUILTIN } from '../src/rules/builtin.js';
import { planTrip, resolveHome } from '../src/engine/trip.js';
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
  const kb = { zones: pack.zones?.zones ?? {} };
  const result = planTrip({ trip: pack.trip, pois: poiMap, rules, settings, country: pack.country, kb, legFn, restPool: pois, options });
  return { pack, pois, normalizeWarnings: warnings, result, legFn, rules, settings, kb };
}

export function formatReport({ pack, result, legFn }) {
  const lines = [];
  lines.push(`# ${pack.trip.name ?? pack.trip.id}（${pack.city?.name_zh ?? pack.city?.id}）打包於 ${pack.meta?.generatedAt ?? '?'}`);
  for (const d of result.days) {
    const { day, plan } = d;
    lines.push('');
    // 時窗印扣過留白的收工時刻（引擎用的），括號裡附原時窗；離境日沒留白、太短的沒扣
    const raw = day.windowRaw ?? day.window;
    const slot = day.openSlotMin > 0 ? `（原 ${minToHm(raw.startMin)}–${minToHm(raw.endMin)}，留白 ${day.openSlotMin} 分排在最後）` : day.openSlotSkipped ? '（時窗太短，留白沒扣）' : '（這天沒留白）';
    // 免稅緩衝（T20）：離境日真的扣了國家層 taxRefund.bufferMin 才印（仙台 2026-08 新制還沒生效，這段不印）；同行（T19）：那天在場 ≥2 人才印（一個人的旅程這行跟以前一樣）
    lines.push(`## ${d.date}（${day.type}${day.themeCategory ? `，${day.themeCategory} 主題` : ''}）主行程：${day.anchorName ?? '—'}　時窗 ${minToHm(day.window.startMin)}–${minToHm(day.window.endMin)}${slot}${day.taxRefundBufferMin > 0 ? `　免稅緩衝 ${day.taxRefundBufferMin} 分` : ''}${day.party >= 2 ? `　同行 ${day.party} 人` : ''}`);
    lines.push(`分數 ${plan.score}　罰分 ${Math.round(plan.penaltyMin)} 分鐘　${plan.complete ? '全排進' : '沒全排進'}　節點 ${plan.stats?.nodes ?? '?'}　${plan.stats?.ms ?? '?'} ms${plan.stats?.truncated ? '　（預算到了，截斷）' : ''}`);
    let prev = null;
    for (const s of plan.sequence) {
      const leg = prev ? legFn(prev.poi, s.poi) : null;
      const legText = leg ? `${leg.rideMin > 0 ? `車 ${leg.rideMin} 分、` : ''}走 ${leg.walkMin} 分${leg.source ? `（${leg.source}）` : ''}` : '';
      lines.push(`- ${minToHm(s.startMin)}–${minToHm(s.endMin)}　${s.poi.name_zh}　[${s.poi.category}]${s.isAnchor ? ' ★' : ''}${s.designated ? ' 指定' : ''}${s.waitMin > 5 ? `　等開門 ${s.waitMin}` : ''}${legText ? `　← ${legText}` : ''}${s.insertedBy ? '　（引擎插）' : ''}`);
      prev = s;
    }
    if (plan.dropped?.length) lines.push(`排不進：${plan.dropped.map((x) => `${x.poi.name_zh}（${x.reason}）`).join('；')}`);
    // 二選一（T16）：不是站、不進分數；「A 或 B（來源）」，來源＝今天排不進的同類勾選站／候選池
    if (plan.choices?.length) lines.push(`二選一：${plan.choices.map((c) => `${plan.sequence[c.slot]?.poi.name_zh ?? c.poiId} 或 ${c.altPoi?.name_zh ?? c.options[1]}（${c.source === 'dropped' ? '今天排不進的勾選站' : `候選池，${c.detourMin > 0 ? `多繞 ${c.detourMin} 分` : '順路'}`}）`).join('；')}`);
    // 走廊清單（T15）：不是站、不進分數；每段列「從→到：店（離路線幾公尺）」，長段提示（leg-suggest）另一行
    if (plan.corridor?.length) {
      const home = resolveHome(pack.trip, d.date);
      const legName = (i) => `${i === 0 ? home.name_zh ?? '住宿' : plan.sequence[i - 1].poi.name_zh}→${plan.sequence[i].poi.name_zh}`;
      lines.push(`走廊清單（不是站，不進分數）：${plan.corridor.map((c) => `${legName(c.legIndex)}：${c.pois.map((x) => `${x.poi.name_zh}（${x.distM} m${x.open === null ? '，營業時間不明' : ''}）`).join('、')}`).join('；')}`);
    }
    // person-avoid（T19，他勾了同行者不想去的店型）在畫面上是站卡的提示、不用寫店名；報告裡照一般警告印、前面補店名（兩家神社會印兩句一樣的），不混進「拒絕過引擎插的站」那行
    const warns = (plan.warnings ?? []).filter((w) => w.code !== 'skipped-missing' && (!w.hint || w.ruleId === 'person-avoid'));
    const warnText = (w) => (w.ruleId === 'person-avoid' ? `${plan.sequence.find((s) => s.poi.id === w.poiId)?.poi.name_zh ?? w.poiId}：${w.msg}` : w.msg);
    if (warns.length) lines.push(`警告：${warns.map(warnText).join('；')}`);
    const suggests = (plan.warnings ?? []).filter((w) => w.ruleId === 'leg-suggest');
    if (suggests.length) lines.push(`可升級（只提示，不罰、不自動插）：${suggests.map((w) => w.msg).join('；')}`);
    const hints = (plan.warnings ?? []).filter((w) => w.hint && w.ruleId !== 'leg-suggest' && w.ruleId !== 'person-avoid');
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
