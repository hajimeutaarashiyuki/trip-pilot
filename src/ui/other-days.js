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
 * 回 [{ date, dropped, revived, breakfast, gone, came, reordered }]（照日期由前到後；沒變的日子不在裡面）——
 * - dropped：動作後才落到排不進清單的勾選站（POI 陣列）；revived：動作前排不進、現在排進來的勾選站。
 * - breakfast：那天的早餐換了店 { from, to }（POI 或 null；from 是原本那一家而且已經不在序列裡、to 是新排進來的那一家）；早餐沒動是 null。
 * - gone／came：其餘少掉的與多出來的站（引擎排的恢復站、填站、順路站；POI 陣列）。
 * - reordered：兩版都有的那幾站，先後變了（那天重新搜尋過：引擎排的站換了，他勾的站的順序可能跟著換——待套用版公務包 133 個動作裡有 8 個）。
 * 只有時刻不一樣（站與先後都相同）不算。
 */
export function otherDayChanges({ before = {}, after = {}, dates = [] } = {}) {
  const skip = new Set((dates ?? []).filter(Boolean));
  const out = [];
  for (const date of Object.keys(after ?? {}).sort()) {
    if (skip.has(date)) continue;
    const a = before?.[date]?.plan; const b = after?.[date]?.plan;
    if (!a?.sequence || !b?.sequence) continue;
    const idsA = a.sequence.map((s) => s.poi.id); const idsB = b.sequence.map((s) => s.poi.id);
    const inA = new Set(idsA); const inB = new Set(idsB);
    const wasDropped = new Set((a.dropped ?? []).map((x) => x.poi.id));
    const dropped = (b.dropped ?? []).filter((x) => !wasDropped.has(x.poi.id)).map((x) => x.poi);
    const fromId = a.meals?.breakfast ?? null; const toId = b.meals?.breakfast ?? null;
    const from = fromId && fromId !== toId && !inB.has(fromId) ? a.sequence.find((s) => s.poi.id === fromId)?.poi ?? null : null;
    const to = toId && toId !== fromId && !inA.has(toId) ? b.sequence.find((s) => s.poi.id === toId)?.poi ?? null : null;
    const lost = a.sequence.filter((s) => !inB.has(s.poi.id) && s.poi.id !== from?.id && !dropped.some((p) => p.id === s.poi.id));
    const added = b.sequence.filter((s) => !inA.has(s.poi.id) && s.poi.id !== to?.id);
    const revived = added.filter((s) => !s.insertedBy).map((s) => s.poi);
    const came = added.filter((s) => s.insertedBy).map((s) => s.poi);
    const gone = lost.map((s) => s.poi);
    const reordered = idsA.filter((id) => inB.has(id)).join('\n') !== idsB.filter((id) => inA.has(id)).join('\n');
    if (!dropped.length && !revived.length && !from && !to && !gone.length && !came.length && !reordered) continue;
    out.push({ date, dropped, revived, breakfast: from || to ? { from, to } : null, gone, came, reordered });
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
  return L.day(dateLabel(c.date), parts.join('、'));
}

/**
 * 那一句（接在復原列後面）：「別天跟著變了：8/15（六） 引擎排的 Room-9 換成 TRUE VINTAGE；8/18（二） 少了引擎排的 ふじや千舟」。
 * 最多細講 max 天（預設 2；復原列貼在手機頂端，寫太長會佔掉畫面），其餘的只點日期：「；另外 8/18（二） 也變了」。沒有變回空字串。
 */
export function otherDaysText(changes = [], max = 2) {
  if (!changes?.length) return '';
  const L = TEXT.otherDays;
  const shown = changes.slice(0, max).map(dayText);
  const rest = changes.slice(max).map((c) => dateLabel(c.date));
  return L.lead([...shown, ...(rest.length ? [L.more(rest.join('、'))] : [])].join('；'));
}
