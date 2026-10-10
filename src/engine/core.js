// 核心搜尋（計畫 1b §2.2）：對一天的候選做「挑子集＋排順序」的深度優先搜尋，
// 每踏一站交給規則評（evaluateStop），走完交給整天規則（evaluateDay）。
// 目標＝Σ 站的價值 − Σ 罰款分鐘（單位都是分鐘）。核心不知道任何一條規則。
// 硬約束回 never 的候選在這條分支裡整個拿掉（再往後插也不可能）；回 no 的留著，晚一點可能可以。
// 有節點與時間預算：預算用完就回報目前最好的（anytime），stats.truncated 標 true。
import { evaluateStop, evaluateDay } from './evaluate.js';
import { emptyAcc } from './dims.js';
import { placeStop } from './schedule.js';
import { warnText } from '../rules/index.js';

export const PRIORITY_VALUE = Object.freeze({ must: 180, want: 90, maybe: 45 });

/** 一個候選的價值（分鐘）：優先度＋星等加分。預設等級的數字。 */
export function candidateValue(c) {
  const base = PRIORITY_VALUE[c.priority] ?? PRIORITY_VALUE.maybe;
  const rating = c.poi?.my?.rating;
  const bonus = rating === 6 ? 60 : rating === 5 ? 30 : 0;
  return base + bonus;
}

function orderCandidates(list) {
  return [...list].sort((a, b) => {
    const fa = a.fixedWindow ? a.fixedWindow.startMin : Infinity;
    const fb = b.fixedWindow ? b.fixedWindow.startMin : Infinity;
    if (fa !== fb) return fa - fb;
    return candidateValue(b) - candidateValue(a);
  });
}

/**
 * planDay({ candidates, day, home, legFn, rules, settings, country, kb, options })
 * - candidates: [{ poi, dwellMin?, priority, designated?, isAnchor?, fixedWindow? }]
 * - home: 住宿據點（第一段移動的起點）
 * - legFn(fromPoi, toPoi) → { walkMin, rideMin, climbMin, backtrackMin?, mode }
 * 回 { sequence, score, penaltyMin, warnings, dropped, breakdown, stats }；永遠回得出東西（總則 0）。
 */
export function planDay({ candidates, day, home, legFn, rules, settings, country, kb, options = {} }) {
  const maxNodes = options.maxNodes ?? 200000;
  const maxMs = options.maxMs ?? 800;
  const explain = Boolean(options.explain);
  const started = Date.now();
  const cands = orderCandidates(candidates.map((c, i) => ({ ...c, _i: i, value: candidateValue(c), dwellMin: c.dwellMin ?? c.poi.dwellMin ?? settings.defaultDwellMin ?? 60 })));
  const stats = { nodes: 0, truncated: false, ms: 0 };
  const dead = new Map();   // _i → 最後一次 never 的人話理由
  let best = null;

  const dayCtxBase = { day, settings, country, kb };

  function tryEnd(seq, acc, score, path) {
    const dayEval = evaluateDay({ ...dayCtxBase, sequence: seq, acc }, rules);
    const total = score - dayEval.penaltyMin;
    const complete = dayEval.verdict === 'ok';
    if (!best || (complete && !best.complete) || (complete === best.complete && total > best.total)) {
      best = { total, complete, seq: [...seq], path: [...path], dayEval, acc };
    }
  }

  function search(seq, remaining, acc, score, path) {
    if (stats.nodes++ > maxNodes || Date.now() - started > maxMs) { stats.truncated = true; return; }
    tryEnd(seq, acc, score, path);
    if (!remaining.length) return;
    // 上界：最多再放 (上限 − 已放) 站，取價值最高的那幾個（remaining 已按價值排序）
    const slots = Math.max(0, (settings.maxStopsPerDay ?? 8) - seq.length);
    const optimistic = score + remaining.slice(0, slots).reduce((s, c) => s + c.value, 0);
    if (best && best.complete && optimistic <= best.total) return;
    const prev = seq.length ? seq[seq.length - 1] : null;
    const prevPoi = prev ? prev.poi : home;
    const prevEnd = prev ? prev.endMin : day.window.startMin;
    const nowDead = [];
    for (const c of remaining) {
      if (nowDead.includes(c._i)) continue;
      const leg = normalizeLeg(legFn(prevPoi, c.poi));
      const placed = placeStop({ prevEndMin: prevEnd, leg, poi: c.poi, dwellMin: c.dwellMin, date: day.date, fixedWindow: c.fixedWindow ?? null, dayStartMin: day.window.startMin });
      const stop = { poi: c.poi, dwellMin: c.dwellMin, ...placed, isAnchor: Boolean(c.isAnchor), designated: Boolean(c.designated), priority: c.priority, fixedWindow: c.fixedWindow ?? null, candidateIndex: c._i };
      const ctx = { ...dayCtxBase, stop, prev, next: null, leg, acc, sequence: seq };
      const r = evaluateStop(ctx, rules);
      if (r.verdict === 'never') {
        nowDead.push(c._i);
        if (!dead.has(c._i)) dead.set(c._i, r.warnings.find((w) => w.code === 'hard')?.msg ?? '今天排不進');
        continue;
      }
      if (r.verdict === 'no') continue;
      const nextRemaining = remaining.filter((o) => o._i !== c._i && !nowDead.includes(o._i));
      search([...seq, stop], nextRemaining, r.acc, score + c.value - r.penaltyMin, [...path, { stop, penaltyMin: r.penaltyMin, breakdown: r.breakdown, warnings: r.warnings }]);
      if (stats.truncated) return;
    }
  }

  // 先用貪婪法湊一個可行解當下界，深度優先才剪得動（候選 10 家以上差很多）。
  greedySeed();
  search([], cands, emptyAcc(rules.dims), 0, []);
  stats.ms = Date.now() - started;

  function greedySeed() {
    let seq = []; let remaining = cands; let acc = emptyAcc(rules.dims); let score = 0; const path = [];
    for (;;) {
      const prev = seq.length ? seq[seq.length - 1] : null;
      const prevPoi = prev ? prev.poi : home;
      const prevEnd = prev ? prev.endMin : day.window.startMin;
      let pick = null;
      for (const c of remaining) {
        const leg = normalizeLeg(legFn(prevPoi, c.poi));
        const placed = placeStop({ prevEndMin: prevEnd, leg, poi: c.poi, dwellMin: c.dwellMin, date: day.date, fixedWindow: c.fixedWindow ?? null, dayStartMin: day.window.startMin });
        const stop = { poi: c.poi, dwellMin: c.dwellMin, ...placed, isAnchor: Boolean(c.isAnchor), designated: Boolean(c.designated), priority: c.priority, fixedWindow: c.fixedWindow ?? null, candidateIndex: c._i };
        const r = evaluateStop({ ...dayCtxBase, stop, prev, next: null, leg, acc, sequence: seq }, rules);
        if (r.verdict !== 'ok') continue;
        const gain = c.value - r.penaltyMin;
        if (!pick || gain > pick.gain || (gain === pick.gain && placed.startMin < pick.stop.startMin)) pick = { c, stop, r, gain };
      }
      if (!pick || pick.gain <= 0) break;
      seq = [...seq, pick.stop]; acc = pick.r.acc; score += pick.gain;
      path.push({ stop: pick.stop, penaltyMin: pick.r.penaltyMin, breakdown: pick.r.breakdown, warnings: pick.r.warnings });
      remaining = remaining.filter((o) => o._i !== pick.c._i);
    }
    tryEnd(seq, acc, score, path);
  }

  if (!best) best = { total: 0, complete: false, seq: [], path: [], dayEval: evaluateDay({ ...dayCtxBase, sequence: [], acc: emptyAcc(rules.dims) }, rules), acc: emptyAcc(rules.dims) };
  const placedIdx = new Set(best.seq.map((s) => s.candidateIndex));
  const dropped = cands.filter((c) => !placedIdx.has(c._i)).map((c) => ({ poi: c.poi, priority: c.priority, reason: dead.get(c._i) ?? '時間或分數排不進' }));
  const stopPenalty = best.path.reduce((s, p) => s + p.penaltyMin, 0);
  const warnings = [
    ...best.path.flatMap((p) => p.warnings),
    ...best.dayEval.warnings,
  ];
  return {
    sequence: best.seq,
    score: best.total,
    complete: best.complete,
    penaltyMin: stopPenalty + best.dayEval.penaltyMin,
    warnings: dedupeWarnings(warnings),
    dropped,
    breakdown: explain ? { stops: best.path.map((p) => ({ poiId: p.stop.poi.id, penaltyMin: p.penaltyMin, items: p.breakdown })), day: best.dayEval.breakdown } : null,
    stats,
  };
}

function normalizeLeg(leg) {
  const l = leg ?? {};
  return { walkMin: num(l.walkMin), rideMin: num(l.rideMin), climbMin: num(l.climbMin), waitMin: num(l.waitMin), backtrackMin: l.backtrackMin == null ? null : num(l.backtrackMin), mode: l.mode ?? (num(l.rideMin) > 0 ? 'ride' : 'walk') };
}
const num = (v) => (Number.isFinite(v) ? v : 0);

function dedupeWarnings(list) {
  const seen = new Set(); const out = [];
  for (const w of list) {
    const key = `${w.ruleId}|${w.code}|${w.poiId ?? ''}|${w.msg}`;
    if (seen.has(key)) continue;
    seen.add(key); out.push(w);
  }
  return out;
}

/** 給畫面與測試用：warnText 的對外出口（規則的人話一句）。 */
export { warnText };
