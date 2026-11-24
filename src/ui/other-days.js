// 他只動了某一天，別天的行程有沒有跟著變（11-12 畫面審查）：純函式（可測，不碰 DOM）；寫回 state 在 app.js（接在復原列那一句後面）。
// 為什麼會變：規劃頁在沒釘住的日子按「不去了」「換一家」「讓引擎重排這天」、早餐的鍵，都是整趟重排——引擎自己插的站（恢復站、填站、順路站）是一天一天照日期挑的，
// 前面的日子用了哪幾家，後面的日子就不能再用；動了某一天，那天引擎挑的店會換，後面幾天能挑的店跟著不一樣。之前畫面一句話都沒有
// （待套用版七天包每一站各按一次「不去了」：50 次裡 17 次別天的站變了）。早餐另外由引擎沿用上一版（engine/breakfast.js keepBreakfasts），換一家清單也不列別天引擎排的站（ui/meals.js），
// 剩下的（50 次裡 15 次、都是引擎排的站換一家）在這裡講出來，他不要就按「復原」。釘住順序的日子不會動到別天（engine/trip.js lateIds）。
import { TEXT } from './text.js';
import { dateLabel } from './dom.js';
import { shortName } from './corridor.js';

/**
 * 一個動作前後，動到的那幾天（dates）以外哪幾天的行程變了。before／after 是 state.plans 那種 { [date]: { plan } }。
 * 回 [{ date, dropped, revived, breakfast, gone, came, reordered, warned }]（照日期由前到後；沒變的日子不在裡面）——
 * - dropped：動作後才落到排不進清單的勾選站（POI 陣列）；revived：動作前排不進、現在排進來的勾選站。
 * - breakfast：那天的早餐換了店 { from, to }（POI 或 null；from 是原本那一家而且已經不在序列裡、to 是新排進來的那一家）；早餐沒動是 null。
 * - gone／came：其餘少掉的與多出來的站（引擎排的恢復站、填站、順路站；POI 陣列）。
 * - reordered：兩版都有的那幾站，先後變了（那天重新搜尋過：引擎排的站換了，他勾的站的順序可能跟著換——待套用版公務包 133 個動作裡有 8 個）。
 * 只有時刻不一樣（站與先後都相同）不算。
 * moved（選填；11-24）＝{ date, poiId }：換一家把別天的一家店挪過來時，它原本那一天與那家店的 id——那家店自己不見了由復原列前半句講（app.js swapStop），這裡不重複算進 gone；
 * 那一天另外多一樣 warned：比動作前多出來的整天黃字與提示（日期下面那幾句，沒有 poiId 的：今天沒排晚餐、今晚沒排夜間站、今天沒排早餐…；只有這一天看，別天照舊不比黃字）。
 * 11-24 傍晚起那一天不整天重排（照畫面釘住、原順序少掉那一家；engine/choices.js swapInPlace）：會進這份清單的只剩那天多出來的提示（warned）與因為空出位置排進來的站（revived）。
 */
export function otherDayChanges({ before = {}, after = {}, dates = [], moved = null } = {}) {
  const skip = new Set((dates ?? []).filter(Boolean));
  const out = [];
  for (const date of Object.keys(after ?? {}).sort()) {
    if (skip.has(date)) continue;
    const a = before?.[date]?.plan; const b = after?.[date]?.plan;
    if (!a?.sequence || !b?.sequence) continue;
    const away = moved?.date === date ? moved.poiId : null;
    const idsA = a.sequence.map((s) => s.poi.id); const idsB = b.sequence.map((s) => s.poi.id);
    const inA = new Set(idsA); const inB = new Set(idsB);
    const wasDropped = new Set((a.dropped ?? []).map((x) => x.poi.id));
    const dropped = (b.dropped ?? []).filter((x) => !wasDropped.has(x.poi.id)).map((x) => x.poi);
    const fromId = a.meals?.breakfast ?? null; const toId = b.meals?.breakfast ?? null;
    const to = toId && toId !== fromId && !inA.has(toId) ? b.sequence.find((s) => s.poi.id === toId)?.poi ?? null : null;
    // 被挪走的那一家剛好是那天的早餐：有新的早餐才講「早餐換成 Y」；沒有就不重複講它沒排了（前半句講過了）
    const from = fromId && fromId !== toId && !inB.has(fromId) && !(fromId === away && !to) ? a.sequence.find((s) => s.poi.id === fromId)?.poi ?? null : null;
    const lost = a.sequence.filter((s) => !inB.has(s.poi.id) && s.poi.id !== from?.id && s.poi.id !== away && !dropped.some((p) => p.id === s.poi.id));
    const added = b.sequence.filter((s) => !inA.has(s.poi.id) && s.poi.id !== to?.id);
    const revived = added.filter((s) => !s.insertedBy).map((s) => s.poi);
    const came = added.filter((s) => s.insertedBy).map((s) => s.poi);
    const gone = lost.map((s) => s.poi);
    const reordered = idsA.filter((id) => inB.has(id)).join('\n') !== idsB.filter((id) => inA.has(id)).join('\n');
    const dayWarn = (p) => (p.warnings ?? []).filter((w) => !w.poiId && w.msg && w.code !== 'skipped-missing' && w.ruleId !== 'leg-suggest').map((w) => w.msg);
    const had = away ? new Set(dayWarn(a)) : null;
    const warned = away ? [...new Set(dayWarn(b))].filter((m) => !had.has(m)) : [];
    if (!dropped.length && !revived.length && !from && !to && !gone.length && !came.length && !reordered && !warned.length) continue;
    out.push({ date, dropped, revived, breakfast: from || to ? { from, to } : null, gone, came, reordered, warned });
  }
  return out;
}

/** 一天變了什麼，寫成一段：「8/15（六） 引擎排的 Room-9 換成 TRUE VINTAGE」「8/16（日） 早餐換成 そばの神田」「8/13（四） 火星の庭 排不進了」。店名用短的。 */
function dayText(c) {
  const L = TEXT.otherDays;
  const names = (list) => list.map((p) => shortName(p.name_zh ?? p.id)).join('、');
  const parts = [];
  if (c.dropped.length) parts.push(L.dropped(names(c.dropped)));
  if (c.revived.length) parts.push(L.revived(names(c.revived)));
  if (c.breakfast?.from && c.breakfast.to) parts.push(L.breakfastTo(names([c.breakfast.to])));
  else if (c.breakfast?.from) parts.push(L.breakfastGone(names([c.breakfast.from])));
  else if (c.breakfast?.to) parts.push(L.breakfastNew(names([c.breakfast.to])));
  if (c.gone.length === 1 && c.came.length === 1) parts.push(L.swapped(names(c.gone), names(c.came)));
  else {
    if (c.gone.length) parts.push(L.gone(names(c.gone)));
    if (c.came.length) parts.push(L.came(names(c.came)));
  }
  if (c.reordered) parts.push(parts.length ? L.reorderedToo : L.reordered);
  if (c.warned?.length) parts.push(c.warned.join('、'));   // 那幾句黃字與提示照原文寫（「今天沒排早餐」）
  return L.day(dateLabel(c.date), parts.join('、'));
}

/**
 * 那一句（接在復原列後面）：「別天跟著變了：8/15（六） 引擎排的 Room-9 換成 TRUE VINTAGE；8/18（二） 少了引擎排的 ふじや千舟」。
 * 最多細講 max 天（預設 2；復原列貼在手機頂端，寫太長會佔掉畫面），其餘的只點日期：「；另外 8/18（二） 也變了」。沒有變回空字串。
 * originDate（選填；11-24 傍晚主控定）＝換一家把一家店挪過來時它原本那一天：那一天的事前半句的括號已經點過日期，直接接「8/12（三） 今天沒排晚餐」「8/13（四） 火星之庭 排進來了」，
 * 不掛「別天跟著變了：」；其餘的日子（照理不會有）照舊掛那個開頭、排在後面。
 */
export function otherDaysText(changes = [], max = 2, originDate = null) {
  if (!changes?.length) return '';
  const L = TEXT.otherDays;
  const own = changes.filter((c) => c.date === originDate).map(dayText);
  const others = originDate ? changes.filter((c) => c.date !== originDate) : changes;
  if (!others.length) return own.join('；');
  const rest = others.slice(max).map((c) => dateLabel(c.date));
  return [...own, L.lead([...others.slice(0, max).map(dayText), ...(rest.length ? [L.more(rest.join('、'))] : [])].join('；'))].join('；');
}

/** 累積型的黃字（今天走路會到 N 分、連跑）每站都會再響一次，畫面只在第一次超過的那站寫（planner.js stopCard）。 */
export const CUMULATIVE_RULES = new Set(['walk-budget', 'walk-run', 'shop-run']);

/**
 * 一天畫面上的黃字與提示，各算一筆的鍵（跟 planner.js 畫的同一批：日期下面整天的＋每站卡上的；「到 X 要在門口等」寫在移動那一行、累積型一天只寫一次、長段提示不是黃字，都照畫面算）。
 * 整天的那幾句連字一起比（數字不比：「今天走路 132 分」變成 140 分是同一句）；每站的看是哪一條規則掛在哪一站。as：{ [poi id]: 當成哪一站 }。
 */
function shownWarnKeys(plan, as = {}) {
  const inSeq = new Set((plan?.sequence ?? []).map((s) => s.poi.id));
  const keys = []; const once = new Set();
  for (const w of plan?.warnings ?? []) {
    if (!w?.msg || w.code === 'skipped-missing' || w.ruleId === 'leg-suggest') continue;
    if (!w.poiId) { keys.push(`${w.ruleId}||${String(w.msg).replace(/\d+/g, '#')}`); continue; }
    if (!inSeq.has(w.poiId) || w.ruleId === 'wait-at-door') continue;
    if (!CUMULATIVE_RULES.has(w.ruleId)) keys.push(`${w.ruleId}|${as[w.poiId] ?? w.poiId}`);
    else if (!once.has(w.ruleId)) { once.add(w.ruleId); keys.push(w.ruleId); }
  }
  return keys;
}

/**
 * 換一家、「或 B」之後，這天畫面上比動作前多出幾句黃字與提示（11-24 傍晚主控定：復原列最後接「；這天多 N 句提醒」，只寫句數——黃字本身在那天看得到）。
 * before／after＝那天動作前後的 plan；as＝{ [換進來那一站的 id]: 被換掉那一站的 id }：同一條黃字只是換了店名（A 有「走回頭路」、換成 B 也有）不算多出來的。
 * 原位置換掉、其餘先後不動的代價就是這些（對抗審查量七天包 100 次換一家，50 次別站多出黃字：多半是走回頭路、兩個坐下來的站連著）；
 * 換掉主行程、必去、指定的站多出來的「今天的主行程沒排進去」「指定的 1 站今天排不進」也算在裡面（不另外擋：原話 #90 講的是「某一個行程」「點那個行程」，沒有排除哪一種站——主行程、必去、指定的站也能換是推導，他沒講過）。
 */
export function addedWarnings(before, after, as = {}) {
  const had = new Map();
  for (const k of shownWarnKeys(before)) had.set(k, (had.get(k) ?? 0) + 1);
  let n = 0;
  for (const k of shownWarnKeys(after, as)) { const left = had.get(k) ?? 0; if (left > 0) had.set(k, left - 1); else n += 1; }
  return n;
}
