// 現場套過的改案要活過重畫與 App 重開（原話 #165 出國後手機要自己調整；iOS 常殺背景分頁；2026-10-12 對抗審查）：
// 套用時把整條序列（走過的前綴＋新的）存成快照進 field.applied[date]（app.js saveJSON 進 localStorage），
// replanAll 跑完 planTrip 後再把它還原回 plan.sequence、整天重算分數（engine/sequence.js）；
// 打包時間（packAt）不同＝手機更新了新打包，快照丟掉並在那天警告一行；他在規劃頁改了勾選（不去了、換一家）就清掉那天的快照、回到引擎排。
// 這裡只有純邏輯（可測）；寫回在 app.js、畫面在 now.js／planner.js。
import { evaluateSequence } from '../engine/sequence.js';
import { resolveHome } from '../engine/trip.js';
import { TEXT } from './text.js';

/** 快照每站存的欄位（POI 本體不存，還原時從 state.pois 對回；跟 planDay 排出的 stop 同名） */
const STOP_KEYS = ['startMin', 'endMin', 'dwellMin', 'waitMin', 'arriveMin', 'fixedWindow', 'insertedBy', 'priority', 'optional', 'gap', 'isAnchor', 'designated', 'errand'];

/**
 * 還沒去的站翻成 planDay 的候選（現場改案的 remaining）。optional、insertedBy、gap 要帶著：引擎插的站重排時還是價值 0、排不進不算落選、
 * 不算餐段與夜間站、填站還是只能在它的空檔（採用改案後才不會變成他排的）；startMin 帶著給 replanDay 比「跟目前剩下的一模一樣的案」用。
 * 降速釘的「現在就去坐」時刻（fixedWindow.pinned）只對那一次改案有效，再重排就拿掉，不然時間一過它就排不進；他自己的固定時段（訂位、花火）留著。
 */
export function remainingFrom(seq, idx) {
  return seq.slice(idx).map((s) => ({ poi: s.poi, priority: s.priority ?? 'want', dwellMin: s.dwellMin, designated: s.designated, isAnchor: s.isAnchor, fixedWindow: s.fixedWindow?.pinned ? null : s.fixedWindow ?? null, optional: Boolean(s.optional), insertedBy: s.insertedBy ?? null, gap: s.gap ?? null, errand: Boolean(s.errand), startMin: s.startMin }));
}

/**
 * 這案會少掉的站（他勾的；引擎插的不算）：remaining 裡沒排進這案的。理由先用核心的 dropped（排不進的那句）、再用策略 cut 的 why、都沒有就一句「現場改案拿掉的」。
 * 回 [{ poi, reason }]，畫面寫「少掉：…」、快照記進 lost。
 */
export function lostStops(proposal, remaining) {
  const placed = new Set(proposal.plan.sequence.map((s) => s.poi.id));
  const reason = (id) => proposal.plan.dropped?.find((d) => d.poi.id === id)?.reason ?? proposal.changes?.find((c) => c.poiId === id && c.action === 'cut')?.why ?? TEXT.appliedLost;
  return remaining.filter((c) => !c.insertedBy && !placed.has(c.poi.id)).map((c) => ({ poi: c.poi, reason: reason(c.poi.id) }));
}

/** 快照：{ packAt, appliedIndex（改案從第幾站接上，前面是走過的）, stops（每站 poiId＋時刻、旗標）, lost（這案少掉的站與理由） }。 */
export function snapshotPlan(plan, idx, { packAt = null, lost = [] } = {}) {
  return {
    packAt,
    appliedIndex: idx,
    stops: plan.sequence.map((s) => ({ poiId: s.poi.id, ...Object.fromEntries(STOP_KEYS.map((k) => [k, s[k] ?? null])) })),
    lost: lost.map((l) => ({ poiId: l.poiId ?? l.poi?.id, reason: l.reason })),
  };
}

/** 還原：快照的站對回 pois 裡的 POI，成 planDay 排出的 stop 形狀；知識庫裡沒有的站跳過（同一份打包不會發生，packAt 相同才還原）。 */
export function restorePlan(snapshot, pois) {
  return (snapshot?.stops ?? []).filter((s) => pois[s.poiId]).map(({ poiId, ...rest }) => ({ poi: pois[poiId], ...rest, optional: Boolean(rest.optional), isAnchor: Boolean(rest.isAnchor), designated: Boolean(rest.designated), errand: Boolean(rest.errand) }));
}

/**
 * 套用或還原後的「排不進」清單：引擎原本的 dropped ∪ 引擎排了但最後序列裡沒有的站（他勾的；引擎插的不算），都只列不在最後序列裡的；
 * 理由先用這案記的 lost（砍的原因），再用引擎的。
 */
export function mergeDropped({ engine, sequence, lost = [] }) {
  const placed = new Set(sequence.map((s) => s.poi.id));
  const why = new Map(lost.map((l) => [l.poiId ?? l.poi?.id, l.reason]));
  const out = []; const seen = new Set();
  const add = (poi, priority, reason) => {
    if (placed.has(poi.id) || seen.has(poi.id)) return;
    seen.add(poi.id); out.push({ poi, priority, reason: why.get(poi.id) ?? reason });
  };
  for (const d of engine.dropped ?? []) add(d.poi, d.priority, d.reason);
  for (const s of engine.sequence ?? []) if (!s.optional && !s.insertedBy) add(s.poi, s.priority, TEXT.appliedLost);
  return out;
}

/**
 * 把一條現場序列套上一天：整天重算（evaluateSequence）、dropped 合併、標 plan.applied、day.resumed；回新的 { date, day, plan }。
 * 重算時第一站的「出門」語意看 appliedIndex：改案從第 0 站就接上才是從當下接著排（late-departure 不罰、等開門照罰，跟 replanDay 算這案時一樣）；
 * 走過的前綴還在時第一站是早上真的出門，照原本算，分數才不會因為套了案少掉一筆太晚出門。
 * 收工時刻用原時窗：改案本來就准吃留白（strategies/index.js），用扣過的收工會冒出「超過收工」的硬警告。
 */
export function appliedPlan({ planned, sequence, appliedIndex, lost = [], trip, legFn, rules, settings, country, kb }) {
  const day = { ...planned.day, resumed: true };
  const evalDay = { ...day, resumed: appliedIndex === 0, window: { ...day.window, endMin: day.windowRaw?.endMin ?? day.window.endMin } };
  const ev = evaluateSequence({ sequence, day: evalDay, home: resolveHome(trip, day.date), legFn, rules, settings, country, kb });
  return { ...planned, day, plan: { ...planned.plan, ...ev, sequence, dropped: mergeDropped({ engine: planned.plan, sequence, lost }), applied: true } };
}

/**
 * replanAll 跑完後：每個套過的日期（field.applied[date]），打包時間相同就還原整條序列、整天重算；
 * 不同（手機更新了新打包）就丟掉那筆、那天的警告多一行（TEXT.appliedDropped）；日期不在這趟裡的也丟（舊旅程留下的，不警告）。
 * 不改傳入的 plans／applied，回 { plans, applied, dropped: [date] }。
 */
export function restoreApplied({ plans, applied = {}, packAt = null, pois, trip, legFn, rules, settings, country, kb }) {
  const nextPlans = { ...plans }; const nextApplied = { ...(applied ?? {}) }; const dropped = [];
  for (const [date, snap] of Object.entries(applied ?? {})) {
    const planned = plans[date];
    if (!planned || snap?.packAt !== packAt) {
      delete nextApplied[date]; dropped.push(date);
      if (planned) nextPlans[date] = { ...planned, plan: { ...planned.plan, warnings: [...planned.plan.warnings, { code: 'applied-dropped', msg: TEXT.appliedDropped }] } };
      continue;
    }
    nextPlans[date] = appliedPlan({ planned, sequence: restorePlan(snap, pois), appliedIndex: snap.appliedIndex ?? 0, lost: snap.lost ?? [], trip, legFn, rules, settings, country, kb });
  }
  return { plans: nextPlans, applied: nextApplied, dropped };
}

/** 他在規劃頁改了那天的勾選（不去了、換一家）：清掉那天的快照、回到引擎排。沒有那天的快照就回原物件（呼叫端比 identity 決定要不要存）。 */
export function withoutApplied(applied, date) {
  if (!applied?.[date]) return applied;
  const next = { ...applied }; delete next[date]; return next;
}
