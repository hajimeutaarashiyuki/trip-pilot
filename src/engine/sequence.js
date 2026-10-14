// 整條序列重算（現場套用改案、App 重開後還原時用）：不重新搜尋、不改順序、時刻用序列裡存的，
// 照 core.js 搜尋時的作法逐站 evaluateStop 累積 acc、走完 evaluateDay，算出整天的 score／penaltyMin／warnings。
// 沒有這條的話，套用改案後 plan 裡的分數只算剩下的站：走過的前綴裡的主行程、指定站、午餐都被當成「沒排」（2026-10-12 對抗審查）。
// 對 planDay 排出的序列算，結果要跟 planDay 一模一樣（test/engine/sequence.test.js 拿示範與試走包對）。
import { evaluateStop, evaluateDay } from './evaluate.js';
import { emptyAcc } from './dims.js';
import { candidateValue, legBetween, dedupeWarnings } from './core.js';
import { placeStop } from './schedule.js';

/** 整條序列從頭重定時刻（插站、換位後用）：照 core.js 的 placeStop 鏈，時刻重算、其他欄位照舊。 */
export function retimeSequence({ sequence, day, home, legFn }) {
  const out = [];
  for (const stop of sequence) {
    const prev = out.length ? out[out.length - 1] : null;
    const leg = legBetween(legFn, out, home, stop.poi);
    const placed = placeStop({ prevEndMin: prev ? prev.endMin : day.window.startMin, leg, poi: stop.poi, dwellMin: stop.dwellMin, date: day.date, fixedWindow: stop.fixedWindow ?? null, dayStartMin: day.window.startMin, first: !prev && !day.resumed });
    out.push({ ...stop, ...placed });
  }
  return out;
}

/**
 * evaluateSequence({ sequence, day, home, legFn, rules, settings, country, kb })
 * → { score, penaltyMin, complete, warnings, breakdown: { stops: [{ poiId, penaltyMin, items, verdict }], day } }
 * sequence 的每站是 planDay 排出的 stop 形狀（poi、priority、startMin、endMin、dwellMin、waitMin、arriveMin、fixedWindow、optional、insertedBy、gap）。
 * 硬規則回 no／never 的站不拿掉（序列是他走的或選的），只留警告。
 */
export function evaluateSequence({ sequence, day, home, legFn, rules, settings, country, kb }) {
  const base = { day, settings, country, kb };
  const seq = []; const stops = []; const warnings = [];
  let acc = emptyAcc(rules.dims); let value = 0; let stopPenalty = 0;
  for (const stop of sequence) {
    const prev = seq.length ? seq[seq.length - 1] : null;
    const leg = legBetween(legFn, seq, home, stop.poi);
    const r = evaluateStop({ ...base, stop, prev, next: null, leg, acc, sequence: seq }, rules);
    acc = r.acc; value += candidateValue(stop, settings); stopPenalty += r.penaltyMin;
    warnings.push(...r.warnings);
    stops.push({ poiId: stop.poi.id, penaltyMin: r.penaltyMin, items: r.breakdown, verdict: r.verdict });
    seq.push(stop);
  }
  const dayEval = evaluateDay({ ...base, sequence: seq, acc }, rules);
  return {
    score: value - stopPenalty - dayEval.penaltyMin,
    penaltyMin: stopPenalty + dayEval.penaltyMin,
    complete: dayEval.verdict === 'ok',
    warnings: dedupeWarnings([...warnings, ...dayEval.warnings]),
    breakdown: { stops, day: dayEval.breakdown },
  };
}
