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
import { mealAssignments, mealNoteOf, MEAL_NAMES } from '../src/rules/_slots.js';   // 每天哪一站是哪一餐（原話 #195）：跟規則 meal-slots、plan.meals 同一把尺
import rulesJson from '../src/rules.json' with { type: 'json' };

export async function planPackFile(file, options = {}) {
  return planPack(readPack(await readFile(file, 'utf8')), options);
}

/** 讀好的打包檔（readPack 的結果）→ 排整趟；tools/allocate.mjs 分配完也拿這個印同一份報告。 */
export function planPack({ pack, pois, warnings }, options = {}) {
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

/**
 * 只提醒一句的提示（engine/trip.js 排完掛的）：他勾的站照排的兩種——一日遊晚回城還排了市區夜間站、趕不上末班車；加上「今天沒排早餐」（原話 #196：他本來就可能吃飯店，不是黃字）
 * 與釘住的日子上引擎站被讓掉的那一句（engine/insert.js planPinnedDay，ruleId 'pinned-order'）。
 * 報告印在自己的一行「提示：…」。
 */
const NOTE_RULES = Object.freeze(['day-trip-night', 'last-train', 'breakfast-slot', 'pinned-order']);

/** '2026-08-13' → '8/13'。 */
const monthDay = (date) => { const m = String(date ?? '').match(/^\d{4}-(\d{2})-(\d{2})$/); return m ? `${Number(m[1])}/${Number(m[2])}` : String(date ?? ''); };

/**
 * 這天三餐各是誰（11-06 第二批；原話 #195）：「三餐：午餐 11:40 一隆；晚餐 沒排」。國家層有哪幾段餐就印哪幾餐（日本現在是午餐、晚餐；多了早餐段就多印早餐），沒有國家層餐段回 null（不印）。
 * 配到的那一站印時刻與店名，那家店的那一餐有說明（知識庫 meals 寫的那句、或酒場型的推導說明）就附在括號裡——報告上一眼看得出咖啡廳、酒吧是憑什麼算一餐；
 * 這天不需要的餐寫原因（不在這天的時窗裡、固定時段裡有供餐）；要卻沒有的寫「沒排」（午餐晚餐另有警告那一行的黃字，早餐是「提示」那一行）。
 * 早餐（原話 #196；國家層有早餐段才印）：引擎替他排的標「引擎排」、他指定的那一筆（換一家、按了「或 X」）標「你指定的」，他勾的站自己落在早餐時段的不標；
 * 他說這天不排的印「在飯店吃」「這天不排（X 改天去）」——nameOf(poi id) 給了才印得出原定那家的店名。
 */
export function mealsLine({ plan, day, country, settings, nameOf = null }) {
  const a = mealAssignments({ sequence: plan.sequence, day, settings, country });
  const named = (id) => (id ? (nameOf?.(id) ?? id) : null);
  const parts = Object.keys(a.meals).map((k) => {
    const name = MEAL_NAMES[k] ?? k;
    const s = a.stops[k];
    if (s) {
      const note = mealNoteOf(s.poi, k);
      const who = k !== 'breakfast' ? '' : s.insertedBy === 'engine' ? '〔引擎排〕' : s.breakfast === true ? '〔你指定的〕' : '';
      return `${name} ${minToHm(s.startMin)} ${s.poi.name_zh}${note ? `（${note}）` : ''}${who}`;
    }
    if (a.notNeeded[k] === 'hotel') return `${name} 在飯店吃${day?.breakfast?.poiId ? `（原定 ${named(day.breakfast.poiId)}）` : ''}`;
    if (a.notNeeded[k] === 'later') return `${name} 這天不排${day?.breakfast?.poiId ? `（${named(day.breakfast.poiId)} 改天去）` : ''}`;
    if (a.notNeeded[k]) return `${name} 不用（${a.notNeeded[k] === 'covered' ? '固定時段裡有供餐' : a.notNeeded[k] === 'stalls' ? '主行程會場的攤位' : '不在這天的時窗裡'}）`;
    return `${name} 沒排`;
  });
  return parts.length ? `三餐：${parts.join('；')}` : null;
}

export function formatReport({ pack, result, legFn, settings = null, pois = null }) {
  const lines = [];
  const nameById = new Map((pois ?? []).map((p) => [p.id, p.name_zh ?? p.id]));
  const nameOf = (id) => nameById.get(id) ?? id;
  const mealSettings = settings ?? pack.rules?.settings ?? rulesJson.settings;   // 餐段放寬量（mealGraceMin）照排的時候那一份設定；舊打包檔沒有這個鍵，尺自己走預設
  lines.push(`# ${pack.trip.name ?? pack.trip.id}（${pack.city?.name_zh ?? pack.city?.id}）打包於 ${pack.meta?.generatedAt ?? '?'}`);
  for (const d of result.days) {
    const { day, plan } = d;
    lines.push('');
    // 時窗印扣過留白的收工時刻（引擎用的），括號裡附原時窗；離境日沒留白、太短的沒扣
    const raw = day.windowRaw ?? day.window;
    const slot = day.openSlotMin > 0 ? `（原 ${minToHm(raw.startMin)}–${minToHm(raw.endMin)}，留白 ${day.openSlotMin} 分排在最後）` : day.openSlotSkipped ? '（時窗太短，留白沒扣）' : '（這天沒留白）';
    // 免稅緩衝（T20）：離境日真的扣了國家層 taxRefund.bufferMin 才印（仙台 2026-08 新制還沒生效，這段不印）；同行（T19）：那天在場 ≥2 人才印（一個人的旅程這行跟以前一樣）
    lines.push(`## ${d.date}（${day.type}${day.themeCategory ? `，${day.themeCategory} 主題` : ''}）主行程：${day.anchorName ?? '—'}　時窗 ${minToHm(day.window.startMin)}–${minToHm(day.window.endMin)}${slot}${day.taxRefundBufferMin > 0 ? `　免稅緩衝 ${day.taxRefundBufferMin} 分` : ''}${day.party >= 2 ? `　同行 ${day.party} 人` : ''}`);
    // 釘住順序的日子（旅程檔 days[].pinned；原話 #192 升級成站＝安插之後）：沒跑搜尋，節點與毫秒那一段換成「照你調過的順序排」，用到留白就寫幾分
    const how = plan.pinned
      ? `　照你調過的順序排（沒重新搜尋）${plan.openSlotUsedMin > 0 ? `，用掉留白 ${plan.openSlotUsedMin} 分` : ''}`
      : `　節點 ${plan.stats?.nodes ?? '?'}　${plan.stats?.ms ?? '?'} ms${plan.stats?.truncated ? '　（預算到了，截斷）' : ''}`;
    lines.push(`分數 ${plan.score}　罰分 ${Math.round(plan.penaltyMin)} 分鐘　${plan.complete ? '全排進' : '沒全排進'}${how}`);
    let prev = null;
    for (const s of plan.sequence) {
      const leg = prev ? legFn(prev.poi, s.poi) : null;
      const legText = leg ? `${leg.rideMin > 0 ? `車 ${leg.rideMin} 分、` : ''}走 ${leg.walkMin} 分${leg.source ? `（${leg.source}）` : ''}` : '';
      lines.push(`- ${minToHm(s.startMin)}–${minToHm(s.endMin)}　${s.poi.name_zh}　[${s.poi.category}]${s.isAnchor ? ' ★' : ''}${s.designated ? ' 指定' : ''}${s.waitMin > 5 ? `　等開門 ${s.waitMin}` : ''}${legText ? `　← ${legText}` : ''}${s.insertedBy ? (s.priority === 'breakfast' ? '　（引擎排的早餐）' : '　（引擎插）') : s.breakfast === true ? '　（你指定的早餐）' : ''}`);
      prev = s;
    }
    const meals = mealsLine({ plan, day, country: pack.country, settings: mealSettings, nameOf });
    if (meals) lines.push(meals);
    // 早餐的推薦（原話 #197）：他沒去到的那家可以排在這天——不自動換，他按了才換
    if (plan.breakfastOffers?.length) lines.push(`早餐推薦（不自動換）：${plan.breakfastOffers.map((o) => `或 ${nameOf(o.poiId)}（${monthDay(o.fromDate)} 沒去的${o.mode === 'later' ? '，他說要改天去' : ''}；${o.replaces ? `換掉 ${nameOf(o.replaces)}` : '排在第一站'}，其餘各站最多晚 ${o.shiftMin} 分）`).join('；')}`);
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
    // 他勾的站照排、只提醒一句的兩種（NOTE_RULES；句子裡已有店名）自己一行，不混進「拒絕過引擎插的站」那行——那行是他拒絕過恢復站／填站之後降成提示的連跑與等開門警告
    const notes = (plan.warnings ?? []).filter((w) => w.hint && NOTE_RULES.includes(w.ruleId));
    if (notes.length) lines.push(`提示：${notes.map((w) => w.msg).join('；')}`);
    const hints = (plan.warnings ?? []).filter((w) => w.hint && w.ruleId !== 'leg-suggest' && w.ruleId !== 'person-avoid' && !NOTE_RULES.includes(w.ruleId));
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
