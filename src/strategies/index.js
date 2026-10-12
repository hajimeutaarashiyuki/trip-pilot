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
 * - remaining：還沒去的候選（planDay 的候選形狀）
 * - here：現在所在（POI 或據點），nowMin：現在時間（分鐘）
 * - pool：當天區域內可以拿來插的候選（恢復站、備案）；可空
 * 回 { proposals: [{ id, label, note, changes, plan }] }，依 plan.score 高到低；永遠至少一個（總則 0）。
 */
export function replanDay(input) {
  const { strategies = STRATEGIES, options = {} } = input;
  const top = options.top ?? 3;
  const proposals = [];
  for (const s of strategies) {
    let out;
    try { out = s.apply(input); } catch (err) { continue; }
    if (!out) continue;
    // resumed：從當下接著排、不是出門（late-departure 不罰第一個剩下的站）
    const day = { ...input.day, resumed: true, ...(out.dayPatch ?? {}), window: { ...input.day.window, startMin: input.nowMin, ...(out.dayPatch?.window ?? {}) } };
    const settings = { ...input.settings, ...(out.settingsPatch ?? {}) };
    const plan = planDay({ candidates: out.candidates, day, home: input.here, legFn: input.legFn, rules: input.rules, settings, country: input.country, kb: input.kb, options: { maxMs: options.maxMs ?? 300 } });
    proposals.push({ id: s.id, label: s.label, note: out.note, changes: out.changes ?? [], plan });
  }
  const seen = new Set();
  const unique = proposals.filter((p) => { const key = p.plan.sequence.map((x) => x.poi.id).join('>'); if (seen.has(key)) return false; seen.add(key); return true; });
  unique.sort((a, b) => b.plan.score - a.plan.score);
  return { proposals: unique.slice(0, top), all: proposals };
}
