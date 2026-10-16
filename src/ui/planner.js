// 規劃頁：看整趟、改不順眼的（總則 6）。每天一塊：主行程、站卡（時間、名字、走幾分、幾點關、一句話、黃字）、換一家、不去了、排不進的。
import { el, hm, dateLabel } from './dom.js';
import { TEXT, CATEGORY } from './text.js';
import { swapCandidates } from '../engine/swap.js';
import { openIntervals } from '../engine/time.js';
import { resolveHome } from '../engine/trip.js';
import { placeUrl, routeUrl, coordQuery, legMode, tripCityName } from './maps.js';
import { darkBeforeMinOf } from './daylight.js';
import { corridorOfLeg, legSuggestOf, corridorNames, corridorListNode, corridorDisclosure } from './corridor.js';

export function renderPlanner({ state, actions }) {
  const nodes = [el('h1', { text: state.trip.name ?? TEXT.appName })];
  // 剛按過「不去了」或「升級成站」：給一次反悔的機會（原話 #171），下一個動作前都在；列是 sticky 的，在長頁深處按了也看得到（10-16 審查：升級重排會翻動整天、之前沒有回頭路）
  if (state.undo) nodes.push(el('div', { class: 'undo-bar' }, [el('span', { text: state.undo.kind === 'upgrade' ? TEXT.undoUpgraded(state.undo.name, dateLabel(state.undo.date)) : TEXT.undoRemoved(state.undo.name, dateLabel(state.undo.date)) }), el('button', { class: 'btn', type: 'button', onclick: () => actions.undoLast() }, TEXT.undo)]));
  for (const d of state.trip.days) {
    const planned = state.plans[d.date];
    if (!planned) continue;
    nodes.push(dayBlock(d, planned, state, actions));
  }
  return nodes;
}

function dayBlock(d, planned, state, actions) {
  const { plan, day } = planned;
  const anchorLine = day.themeCategory ? `${TEXT.themeOf(day.themeCategory)}，${TEXT.anchorOf(day.anchorName)}` : TEXT.anchorOf(day.anchorName);
  // 長段提示（leg-suggest）畫在那一段的移動行上（legBlock），不再進日尾的黃字清單
  const dayWarnings = plan.warnings.filter((w) => !w.poiId && w.code !== 'skipped-missing' && w.ruleId !== 'leg-suggest');
  const block = el('section', { class: 'day' }, [
    el('header', { class: 'day-head' }, [el('h2', { text: dateLabel(d.date) }), el('p', { class: 'muted', text: anchorLine })]),
    // 現場套過改案的那天（plan.applied）：分數是整條序列重算的（走過的＋改案），前面標「現場改過」
    el('p', { class: 'muted small', text: plan.applied ? `${TEXT.appliedLine}，${TEXT.dayScore(plan.score, plan.penaltyMin)}` : TEXT.dayScore(plan.score, plan.penaltyMin) }),
    openSlotLine(plan, day),
    firstLegLine(plan, d, state, actions),
  ]);
  // 累積型警告（今天走路會到 N 分、連跑）每站都會再響一次，只在第一次超過的那站寫
  const seenCumulative = new Set();
  plan.sequence.forEach((s, i) => block.append(stopCard(s, i, plan, d, state, actions, seenCumulative)));
  if (dayWarnings.length) block.append(warnList(dayWarnings));
  if (plan.dropped.length) {
    block.append(el('details', { class: 'dropped' }, [
      el('summary', { text: `${TEXT.dropped}：${plan.dropped.length}` }),
      el('ul', {}, plan.dropped.map((x) => el('li', {}, [el('strong', { text: x.poi.name_zh }), ` ${x.reason}`]))),
    ]));
  }
  return block;
}

/**
 * 留白行（profile §8、DESIGN §4、§8）：這天的留白已從時窗尾端扣掉（trip.js dayWindow，排在最後），站與站之間等開門的分鐘算用掉（原話 #155「當成留白 但也要罰」）；
 * departure 日或這天設 0 寫「這天沒留白」；時窗太短沒扣的（抵達日很晚落地）寫出來，不假裝有留。
 */
function openSlotLine(plan, day) {
  const raw = day.windowRaw ?? day.window;
  if (day.openSlotSkipped) return el('p', { class: 'muted small', text: TEXT.openSlotSkipped(raw.endMin - raw.startMin) });
  if (!(day.openSlotMin > 0)) return el('p', { class: 'muted small', text: TEXT.openSlotNone });
  const used = Math.max(0, Math.round(plan.sequence.reduce((s, x) => s + (x.waitMin ?? 0), 0)));
  return el('p', { class: 'muted small', text: TEXT.openSlotLine(day.openSlotMin, used) });
}

/** 出門那一段：幾點出門、從住宿到第一站走幾分（原本只畫站與站之間，第一段看不到）；路線從住宿出發，住宿沒座標就不帶起點。走廊清單的 legIndex 0 就是這段。 */
function firstLegLine(plan, d, state, actions) {
  const first = plan.sequence[0];
  if (!first) return null;
  const home = resolveHome(state.trip, d.date);
  const leg = state.legFn(home, first.poi);
  const legText = leg.rideMin > 0 ? TEXT.rideTo(leg.walkMin, leg.rideMin) : TEXT.walkTo(leg.walkMin);
  const travel = (leg.walkMin ?? 0) + (leg.rideMin ?? 0) + (leg.waitMin ?? 0);
  const line = el('p', { class: 'leg muted small' }, [
    `↓ ${TEXT.firstLeg(hm(first.arriveMin - travel), legText)}${waitText(first)}`,
    routeLink({ from: coordQuery(home) ? home : null, to: first.poi, leg, state }),
  ]);
  return legBlock({ line, legIndex: 0, plan, d, state, actions });
}

/**
 * 一段移動＋走廊清單（T15；原話 #57、#124；DESIGN §1.9「走廊清單不是站」）：這段會經過的店有就在移動那行多一顆小鍵「經過 N 家」，
 * 點開列每家（店名、店型、進去約幾分、離路線幾公尺）＋「升級成站」「我進去了」；長段（trip.js leg-suggest：走 ≥10 分又有店）改成整行提示鍵
 * 「這段走 N 分，經過 X、Y，可升級」——提示樣式（主色虛線框），不是黃字警告。legIndex 0＝住宿→第一站。
 * 開合記在 state.corridorOpen（corridorDisclosure）：按「我進去了」重畫後還開著；重排才收起。
 */
function legBlock({ line, legIndex, plan, d, state, actions }) {
  const pois = corridorOfLeg(plan, legIndex);
  if (!pois.length) return line;
  const suggest = legSuggestOf(plan, legIndex);
  const block = el('div', { class: 'leg-block' }, [line]);
  // 提示鍵只點名兩家、用短店名（規格的「經過 X、Y」；三家在 390px 會疊到三行，10-16 實測 119px 高；帶研究註記的全名兩家也疊到 98px），其餘寫「等 N 家」，點開才全列
  const { names, more } = corridorNames(pois, 2);
  const toggle = el('button', { class: suggest ? 'btn leg-hint' : 'btn tiny quiet', type: 'button' }, suggest ? TEXT.corridorSuggest(suggest.walkMin, TEXT.corridorList(names, more)) : TEXT.corridorCount(pois.length));
  if (suggest) block.append(toggle); else line.append(toggle);
  corridorDisclosure({ key: `plan:${d.date}:${legIndex}`, state, button: toggle, box: block, build: () => corridorListNode({ pois, date: d.date, state, actions, upgrade: true }) });
  return block;
}

/** 到了還沒開門要等的分鐘：超過 5 分才寫，讓他看得出中間那段空白是等開門、不是漏排。 */
function waitText(stop) {
  return stop?.waitMin > 5 ? `，${TEXT.waitOpen(Math.round(stop.waitMin))}` : '';
}

/** 黃字清單；hint 的（他拒絕過引擎插的站之後，連跑與等開門只提醒不催）用提示樣式。 */
function warnList(warns) {
  return el('ul', { class: 'warn-list' }, warns.map((w) => el('li', { class: w.hint ? 'hint' : null, text: w.msg })));
}

/** 這一段的 Google Maps 路線（新分頁）；from 不給就從現在位置出發。 */
function routeLink({ from, to, leg, state }) {
  return el('a', { href: routeUrl({ from, to, mode: legMode(leg), cityName: tripCityName(state) }), target: '_blank', rel: 'noopener' }, TEXT.routeLink);
}

const CUMULATIVE_RULES = new Set(['walk-budget', 'walk-run', 'shop-run']);

function stopCard(s, i, plan, d, state, actions, seenCumulative = new Set()) {
  const poi = s.poi;
  const next = plan.sequence[i + 1];
  const legNext = next ? state.legFn(poi, next.poi) : null;
  // 釘起訖的固定時段站（研討會、演唱會）寫「HH:MM 散場」，跟現場頁一樣（10-14 T23）；其他站寫幾點關
  const ends = Number.isFinite(s.fixedWindow?.endMin) ? hm(s.fixedWindow.endMin) : null;
  const closes = ends ? null : closeHm(poi, d.date);
  // 白天站沒有幾點關：在同一個位置寫「天黑 HH:MM 前」（原話 #159）；位置不明就不寫
  const dark = ends || closes ? null : darkBeforeMinOf(poi, d.date, state);
  const limitText = ends ? TEXT.endsAt(ends) : closes ? TEXT.closesAt(closes) : dark != null ? TEXT.darkBefore(hm(dark)) : '';
  // 等開門那段已在站間那行寫「等開門 N 分（算留白）」，wait-at-door 的黃字不再寫一次
  const warns = plan.warnings.filter((w) => {
    if (w.poiId !== poi.id || w.code === 'skipped-missing' || w.ruleId === 'wait-at-door') return false;
    if (CUMULATIVE_RULES.has(w.ruleId)) { if (seenCumulative.has(w.ruleId)) return false; seenCumulative.add(w.ruleId); }
    return true;
  });
  const card = el('article', { class: `card${s.isAnchor ? ' anchor' : ''}${poi.recovery ? ' rest' : ''}` }, [
    el('div', { class: 'row' }, [
      el('span', { class: 'time', text: `${hm(s.startMin)}–${hm(s.endMin)}` }),
      el('span', { class: 'cat', text: CATEGORY[poi.category] ?? '' }),
      poi.item ? el('span', { class: 'cat item', text: poi.item }) : null,
    ]),
    el('h3', { text: poi.name_zh }),
    el('p', { class: 'muted small', text: [poi.guide?.intro ?? poi.highlight ?? '', limitText].filter(Boolean).join('　') }),
    warns.length ? warnList(warns) : null,
    // 哪一種引擎插的站看 stop.priority（'filler' 填空檔、'rest' 恢復站），不看店型：恢復型的店也可能是填站
    s.insertedBy === 'engine' ? el('p', { class: 'muted small', text: poi.category === 'spot' ? TEXT.spotInserted(hm(s.endMin)) : s.priority === 'filler' ? TEXT.fillerInserted : s.priority === 'onway' ? TEXT.onTheWayInserted : TEXT.restInserted }) : null,
    el('div', { class: 'actions' }, [
      // 引擎插的站不在 picks 裡，「換一家」接不上；「不去了」會記進 day.removed，下次重排就不再插＝拒絕（原話 #126）
      // 引擎插的站不是 designated 也不是 anchor（core 只從候選帶這兩個旗標），所以「不去了」照這個條件一定會出現
      s.insertedBy === 'engine' ? null : el('button', { class: 'btn', type: 'button', onclick: () => toggleSwap(card, s, plan, d, state, actions) }, TEXT.swap),
      s.designated || s.isAnchor ? null : el('button', { class: 'btn quiet', type: 'button', onclick: () => actions.removeStop(d.date, poi.id, s.insertedBy, s.priority) }, TEXT.remove),
      el('a', { class: 'btn quiet', href: placeUrl(poi, tripCityName(state)), target: '_blank', rel: 'noopener' }, TEXT.mapLink),
    ]),
  ]);
  if (legNext) {
    const legText = legNext.rideMin > 0 ? TEXT.rideTo(legNext.walkMin, legNext.rideMin) : TEXT.walkTo(legNext.walkMin);
    const line = el('p', { class: 'leg muted small' }, [`↓ ${legText}${waitText(next)}`, routeLink({ from: poi, to: next.poi, leg: legNext, state })]);
    // 這段是第 i+1 段（0＝住宿→第一站），走廊清單掛在它旁邊
    card.append(legBlock({ line, legIndex: i + 1, plan, d, state, actions }));
  }
  return card;
}

function toggleSwap(card, s, plan, d, state, actions) {
  const existing = card.querySelector('.swap-list');
  if (existing) { existing.remove(); return; }
  const cands = swapCandidates({ plan, stopId: s.poi.id, pool: state.pool, legFn: state.legFn, date: d.date, settings: state.settings });
  const list = el('div', { class: 'swap-list' });
  if (!cands.length) list.append(el('p', { class: 'muted small', text: TEXT.noSwap }));
  for (const c of cands.slice(0, 6)) {
    list.append(el('button', { class: 'btn alt', type: 'button', onclick: () => actions.swapStop(d.date, s.poi.id, c.poi) }, [
      el('strong', { text: c.poi.name_zh }), ` · ${TEXT.swapNote(c.detourMin)}`, c.open === null ? ` · ${TEXT.openUnknown}` : '',
    ]));
  }
  card.append(list);
}

function closeHm(poi, date) {
  const iv = openIntervals(poi, date);
  if (!iv || !iv.length) return null;
  return hm(Math.max(...iv.map(([, c]) => c)));
}
