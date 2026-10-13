// 核心搜尋（計畫 1b §2.2）：對一天的候選做「挑子集＋排順序」的深度優先搜尋，
// 每踏一站交給規則評（evaluateStop），走完交給整天規則（evaluateDay）。
// 目標＝Σ 站的價值 − Σ 罰款分鐘（單位都是分鐘）。核心不知道任何一條規則。
// 硬約束回 never 的候選在這條分支裡整個拿掉（再往後插也不可能）；回 no 的留著，晚一點可能可以。
// 有節點與時間預算：預算用完就回報目前最好的（anytime），stats.truncated 標 true。
import { evaluateStop, evaluateDay } from './evaluate.js';
import { SAME_TYPE_CATEGORIES } from '../rules/_helpers.js';   // 只借同類店型清單寫落選理由，不是規則邏輯
import { emptyAcc } from './dims.js';
import { placeStop } from './schedule.js';
import { warnText } from '../rules/index.js';

// rest＝引擎插的恢復站（trip.js restCandidates）、filler＝引擎填等開門空檔的任何站（trip.js fillCandidates，原話 #161）：
// 都沒有自己的價值，降得了罰分才排得進（DESIGN §1.3 走路連跑破 150 才插；§5.2 等開門才填）
export const PRIORITY_VALUE = Object.freeze({ must: 180, want: 90, maybe: 45, rest: 0, filler: 0, onway: 30 });   // onway＝順路站（trip.js onTheWayCandidates，原話 #170）：有一點價值才會被排進去，但低於他自己勾的 maybe

/** 一個候選的價值（分鐘）：優先度＋星等加分。預設等級的數字。 */
export function candidateValue(c) {
  if (c.priority === 'rest' || c.priority === 'filler') return 0;   // 星等加分也不給：不然評分高的店沒觸發也會被塞進來
  if (c.priority === 'onway') return PRIORITY_VALUE.onway;           // 順路站：固定一點價值，不吃星等加分
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
 * - candidates: [{ poi, dwellMin?, priority, designated?, isAnchor?, fixedWindow?, optional?, insertedBy?, gap? }]
 *   optional：排不進不算落選（不進 dropped）、不佔 maxStopsPerDay 名額（rules/max-stops.js）；insertedBy：誰插的（'engine'），排進去的 stop 會帶著；
 *   gap：填站只能落在的那段空檔 { startMin, endMin }（trip.js fillCandidates，規則 filler-gap 擋），其他站 null
 * - home: 住宿據點（第一段移動的起點）
 * - legFn(fromPoi, toPoi) → { walkMin, rideMin, climbMin, backtrackMin?, mode }
 * 回 { sequence, score, penaltyMin, warnings, dropped, breakdown, stats }；永遠回得出東西（總則 0）。
 */
export function planDay({ candidates, day, home, legFn, rules, settings, country, kb, options = {} }) {
  const maxNodes = options.maxNodes ?? 200000;
  const maxMs = options.maxMs ?? 800;
  const maxOptional = settings.restInsertMaxPerDay ?? 2;   // 一天最多排幾個 optional（引擎插的恢復站與填站；rules.json settings.restInsertMaxPerDay）：價值 0 的站不受上界剪枝，不設上限會把節點吃光
  const explain = Boolean(options.explain);
  const started = Date.now();
  const cands = orderCandidates(candidates.map((c, i) => ({ ...c, _i: i, value: candidateValue(c), dwellMin: c.dwellMin ?? c.poi.dwellMin ?? settings.defaultDwellMin ?? 60 })));
  const stats = { nodes: 0, truncated: false, ms: 0 };
  const dead = new Map();   // _i → 第一次 never 的人話理由
  const placedEver = new Set();   // 在任何一條分支裡排進去過的候選：落選是分數取捨，不是硬約束擋的（理由不能拿 never 的那句誤導，例如「天黑」）
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
    // 上界：最多再放 (上限 − 已放) 站，取價值最高的那幾個（remaining 已按價值排序）；optional 的站不佔名額（max-stops 只數他勾的），不扣
    const slots = Math.max(0, (settings.maxStopsPerDay ?? 8) - seq.filter((s) => !s.optional).length);
    const optimistic = score + remaining.slice(0, slots).reduce((s, c) => s + c.value, 0);
    if (best && best.complete && optimistic <= best.total) return;
    const prev = seq.length ? seq[seq.length - 1] : null;
    const prevEnd = prev ? prev.endMin : day.window.startMin;
    const optionalPlaced = seq.reduce((n, s) => n + (s.optional ? 1 : 0), 0);
    const nowDead = [];
    for (const c of remaining) {
      if (nowDead.includes(c._i)) continue;
      if (c.optional && optionalPlaced >= maxOptional) continue;
      const leg = legBetween(legFn, seq, home, c.poi);
      // first：當天第一站開門前到就改成晚點出門（schedule.js）。現場改案（day.resumed）是從當下接著排，人已經在外面，
      // 第一個剩下的站等開門是真的在門口等，照站與站之間算、讓 wait-at-door 罰——不然引擎會把第一站推到 17:00 才開的酒吧、中間空四小時（2026-10-12 試走包 8/13 12:50 實測）
      const placed = placeStop({ prevEndMin: prevEnd, leg, poi: c.poi, dwellMin: c.dwellMin, date: day.date, fixedWindow: c.fixedWindow ?? null, dayStartMin: day.window.startMin, first: !prev && !day.resumed });
      const stop = { poi: c.poi, dwellMin: c.dwellMin, ...placed, isAnchor: Boolean(c.isAnchor), designated: Boolean(c.designated), priority: c.priority, fixedWindow: c.fixedWindow ?? null, candidateIndex: c._i, optional: Boolean(c.optional), insertedBy: c.insertedBy ?? null, gap: c.gap ?? null };
      const ctx = { ...dayCtxBase, stop, prev, next: null, leg, acc, sequence: seq };
      const r = evaluateStop(ctx, rules);
      if (r.verdict === 'never') {
        nowDead.push(c._i);
        if (!dead.has(c._i)) dead.set(c._i, r.warnings.find((w) => w.code === 'hard')?.msg ?? '今天排不進');
        continue;
      }
      if (r.verdict === 'no') continue;
      const nextRemaining = remaining.filter((o) => o._i !== c._i && !nowDead.includes(o._i));
      placedEver.add(c._i);
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
      const prevEnd = prev ? prev.endMin : day.window.startMin;
      let pick = null;
      const optionalPlaced = seq.reduce((n, s) => n + (s.optional ? 1 : 0), 0);
      for (const c of remaining) {
        if (c.optional && optionalPlaced >= maxOptional) continue;
        const leg = legBetween(legFn, seq, home, c.poi);
        const placed = placeStop({ prevEndMin: prevEnd, leg, poi: c.poi, dwellMin: c.dwellMin, date: day.date, fixedWindow: c.fixedWindow ?? null, dayStartMin: day.window.startMin, first: !prev && !day.resumed });
        const stop = { poi: c.poi, dwellMin: c.dwellMin, ...placed, isAnchor: Boolean(c.isAnchor), designated: Boolean(c.designated), priority: c.priority, fixedWindow: c.fixedWindow ?? null, candidateIndex: c._i, optional: Boolean(c.optional), insertedBy: c.insertedBy ?? null, gap: c.gap ?? null };
        const r = evaluateStop({ ...dayCtxBase, stop, prev, next: null, leg, acc, sequence: seq }, rules);
        if (r.verdict !== 'ok') continue;
        const gain = c.value - r.penaltyMin;
        if (!pick || gain > pick.gain || (gain === pick.gain && placed.startMin < pick.stop.startMin)) pick = { c, stop, r, gain };
      }
      if (!pick || pick.gain <= 0) break;
      placedEver.add(pick.c._i);
      seq = [...seq, pick.stop]; acc = pick.r.acc; score += pick.gain;
      path.push({ stop: pick.stop, penaltyMin: pick.r.penaltyMin, breakdown: pick.r.breakdown, warnings: pick.r.warnings });
      remaining = remaining.filter((o) => o._i !== pick.c._i);
    }
    tryEnd(seq, acc, score, path);
  }

  if (!best) best = { total: 0, complete: false, seq: [], path: [], dayEval: evaluateDay({ ...dayCtxBase, sequence: [], acc: emptyAcc(rules.dims) }, rules), acc: emptyAcc(rules.dims) };
  const placedIdx = new Set(best.seq.map((s) => s.candidateIndex));
  // optional 的候選（引擎插的恢復站與填站）排不進是常態，不算落選
  // 落選理由：排進去過的（placedEver）是取捨，再分是不是名額或同類上限造成；從沒排進去過的用硬約束記的那句
  const nonOptional = cands.filter((c) => !c.optional);
  const maxStops = settings.maxStopsPerDay ?? 8;
  const sameTypeMax = settings.sameTypeMaxPerDay ?? 2;
  const byCat = new Map();
  for (const c of nonOptional) byCat.set(c.poi.category, (byCat.get(c.poi.category) ?? 0) + 1);
  const placedNonOptional = best.seq.filter((s) => !s.optional).length;
  const reasonFor = (c) => {
    if (!placedEver.has(c._i)) return dead.get(c._i) ?? '時間或分數排不進';
    // 先看同類上限（主題日 3、非主題日 2），再看名額有沒有真的用滿，都不是才是分數取捨
    const n = byCat.get(c.poi.category) ?? 0;
    if (SAME_TYPE_CATEGORIES.includes(c.poi.category)) {
      const cap = day.themeCategory === c.poi.category ? (settings.themeDaySameTypeMax ?? 3) : sameTypeMax;
      if (n > cap) return day.themeCategory === c.poi.category ? `今天是主題日，同類的店最多 ${cap} 家、勾了 ${n} 家，它排在後面` : `同類的店一天最多 ${cap} 家、勾了 ${n} 家，它排在後面`;
    }
    if (placedNonOptional >= maxStops && nonOptional.length > maxStops) return `今天勾了 ${nonOptional.length} 站、上限 ${maxStops}，它排在後面`;
    return '排得進，但排進去整天的分數反而低';
  };
  const dropped = cands.filter((c) => !placedIdx.has(c._i) && !c.optional).map((c) => ({ poi: c.poi, priority: c.priority, reason: reasonFor(c) }));
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

/** 從序列最後一站（沒有就據點）到 toPoi 的移動段，含折返分鐘：搜尋與整條序列重算（sequence.js）共用，兩邊算出的 leg 才會一樣。 */
export function legBetween(legFn, seq, home, toPoi) {
  const prevPoi = seq.length ? seq[seq.length - 1].poi : home;
  return withBacktrack(normalizeLeg(legFn(prevPoi, toPoi)), seq, home, toPoi, legFn);
}

/**
 * 折返分鐘：這段走路比「從上上站直接走過來」多出來的部分。順路（上一站在路上）是 0；走回頭路就接近整段。
 * 第一站沒有上上站＝0；搭車段不算。沒座標時 legFn 回區域預設分鐘，差值是 0 或很小，規則不會被誤觸發。
 */
function withBacktrack(leg, seq, home, toPoi, legFn) {
  if (leg.backtrackMin != null) return leg;
  if (leg.mode !== 'walk') return { ...leg, backtrackMin: 0 };
  const beforePrev = seq.length >= 2 ? seq[seq.length - 2].poi : (seq.length === 1 ? home : null);
  if (!beforePrev) return { ...leg, backtrackMin: 0 };
  const direct = normalizeLeg(legFn(beforePrev, toPoi));
  const backtrackMin = direct.mode === 'walk' ? Math.max(0, leg.walkMin - direct.walkMin) : 0;
  return { ...leg, backtrackMin };
}

function normalizeLeg(leg) {
  const l = leg ?? {};
  return { walkMin: num(l.walkMin), rideMin: num(l.rideMin), climbMin: num(l.climbMin), waitMin: num(l.waitMin), backtrackMin: l.backtrackMin == null ? null : num(l.backtrackMin), mode: l.mode ?? (num(l.rideMin) > 0 ? 'ride' : 'walk') };
}
const num = (v) => (Number.isFinite(v) ? v : 0);

export function dedupeWarnings(list) {
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
