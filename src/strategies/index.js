// 改案策略註冊表（DESIGN §6.3、計畫 1b §2.3）。每條策略一檔：{ id, label, apply(input) → { candidates, dayPatch, note, changes } }。
// 策略只改「要重排的候選」與當天的設定，重排本身一律交給核心 planDay；策略不知道規則內容。
// replanDay 把每條策略各跑一次，去重後依分數排，回前幾個給畫面（DESIGN §11 拍板 #3：五種都算、UI 只顯示前三）。
import { planDay } from '../engine/core.js';
import compress from './compress.js';
import cutTail from './cut-tail.js';
import swapAlt from './swap-alt.js';
import moveDay from './move-day.js';
import slowDown from './slow-down.js';
import restOnly from './rest-only.js';
import endDay from './end-day.js';

export const STRATEGIES = Object.freeze([compress, cutTail, swapAlt, moveDay, slowDown]);
/** 「累了／腳痛」那顆鍵（原話 #115、DESIGN §1.4 策略 5）只跑降速的三個深淺：只坐一下、坐一下再少走路、回住宿；每案都是休息，由他選（總則 5）。 */
export const TIRED_STRATEGIES = Object.freeze([restOnly, slowDown, endDay]);

/**
 * replanDay({ day, remaining, here, nowMin, rules, settings, country, kb, legFn, pool, strategies, options })
 * - remaining：還沒去的候選（planDay 的候選形狀；帶 startMin 就能比「跟目前剩下的排程一模一樣」）
 * - here：現在所在（POI 或據點），nowMin：現在時間（分鐘）
 * - pool：當天區域內可以拿來插的候選（恢復站、備案）；可空
 * 回 { proposals: [{ id, label, note, changes, plan, eatsSlackMin }], all }，proposals 依 plan.score 高到低、去重、
 * 跟目前剩下的排程一模一樣的拿掉（「照這個走」等於沒改）；all 是每條策略的原始出案（測試用）。
 * 收工時刻用原時窗（day.windowRaw）：留白是「現場落後先吃這裡」（profile §8），扣過留白的收工（day.window.endMin）只給出門前的排程用；
 * 每案記 eatsSlackMin＝最後一站超過扣過收工的分鐘，畫面寫「吃掉留白 N 分」（2026-10-12 對抗審查：8/17 21:05 剩 bar 按累了只剩「今天到此為止」）。
 */
export function replanDay(input) {
  const { strategies = STRATEGIES, options = {}, remaining = [] } = input;
  const top = options.top ?? 3;
  const closeMin = input.day.window.endMin;
  const rawEndMin = input.day.windowRaw?.endMin ?? closeMin;
  const proposals = [];
  for (const s of strategies) {
    let out;
    try { out = s.apply(input); } catch (err) { continue; }
    if (!out) continue;
    // resumed：從當下接著排、不是出門（late-departure 不罰第一個剩下的站）
    const day = { ...input.day, resumed: true, ...(out.dayPatch ?? {}), window: { ...input.day.window, startMin: input.nowMin, endMin: rawEndMin, ...(out.dayPatch?.window ?? {}) } };
    const settings = { ...input.settings, ...(out.settingsPatch ?? {}) };
    const plan = planDay({ candidates: out.candidates, day, home: input.here, legFn: input.legFn, rules: input.rules, settings, country: input.country, kb: input.kb, options: { maxMs: options.maxMs ?? 300 } });
    const last = plan.sequence[plan.sequence.length - 1];
    proposals.push({ id: s.id, label: s.label, note: out.note, changes: out.changes ?? [], plan, eatsSlackMin: last ? Math.max(0, last.endMin - closeMin) : 0 });
  }
  const seen = new Set();
  const unique = proposals.filter((p) => {
    if (sameAsRemaining(p.plan.sequence, remaining, input.nowMin)) return false;
    const key = p.plan.sequence.map((x) => x.poi.id).join('>'); if (seen.has(key)) return false; seen.add(key); return true;
  });
  unique.sort((a, b) => b.plan.score - a.plan.score);
  return { proposals: unique.slice(0, top), all: proposals };
}

/**
 * 這案跟目前剩下的排程一模一樣：逐站 poiId 與開始時刻都相同（remaining 沒帶 startMin 就不算一樣，寧可多出一案）。
 * 已經開始了的站（remaining 的 startMin 不晚於現在：研討會中途按改案，會場還在 remaining 裡）只比 poiId——它在改案裡的開始時刻只會是「現在」，不算改了（10-14 T23 審查）。
 */
function sameAsRemaining(sequence, remaining, nowMin = null) {
  if (sequence.length !== remaining.length) return false;
  return sequence.every((s, i) => {
    const r = remaining[i];
    if (s.poi.id !== r.poi.id || r.startMin == null) return false;
    return s.startMin === r.startMin || (nowMin != null && r.startMin <= nowMin);
  });
}
