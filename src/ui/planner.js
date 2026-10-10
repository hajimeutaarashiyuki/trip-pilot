// 規劃頁：看整趟、改不順眼的（總則 6）。每天一塊：主行程、站卡（時間、名字、走幾分、幾點關、一句話、黃字）、換一家、不去了、排不進的。
import { el, hm, dateLabel } from './dom.js';
import { TEXT, CATEGORY } from './text.js';
import { swapCandidates } from '../engine/swap.js';
import { openIntervals } from '../engine/time.js';

export function renderPlanner({ state, actions }) {
  const nodes = [el('h1', { text: state.trip.name ?? TEXT.appName })];
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
  const dayWarnings = plan.warnings.filter((w) => !w.poiId && w.code !== 'skipped-missing');
  const block = el('section', { class: 'day' }, [
    el('header', { class: 'day-head' }, [el('h2', { text: dateLabel(d.date) }), el('p', { class: 'muted', text: anchorLine })]),
    el('p', { class: 'muted small', text: TEXT.dayScore(plan.score, plan.penaltyMin) }),
  ]);
  plan.sequence.forEach((s, i) => block.append(stopCard(s, i, plan, d, state, actions)));
  if (dayWarnings.length) block.append(el('ul', { class: 'warn-list' }, dayWarnings.map((w) => el('li', { text: w.msg }))));
  if (plan.dropped.length) {
    block.append(el('details', { class: 'dropped' }, [
      el('summary', { text: `${TEXT.dropped}：${plan.dropped.length}` }),
      el('ul', {}, plan.dropped.map((x) => el('li', {}, [el('strong', { text: x.poi.name_zh }), ` ${x.reason}`]))),
    ]));
  }
  return block;
}

function stopCard(s, i, plan, d, state, actions) {
  const poi = s.poi;
  const next = plan.sequence[i + 1];
  const legNext = next ? state.legFn(poi, next.poi) : null;
  const closes = closeHm(poi, d.date);
  const warns = plan.warnings.filter((w) => w.poiId === poi.id && w.code !== 'skipped-missing');
  const card = el('article', { class: `card${s.isAnchor ? ' anchor' : ''}${poi.recovery ? ' rest' : ''}` }, [
    el('div', { class: 'row' }, [
      el('span', { class: 'time', text: `${hm(s.startMin)}–${hm(s.endMin)}` }),
      el('span', { class: 'cat', text: CATEGORY[poi.category] ?? '' }),
    ]),
    el('h3', { text: poi.name_zh }),
    el('p', { class: 'muted small', text: [poi.guide?.intro ?? poi.highlight ?? '', closes ? TEXT.closesAt(closes) : ''].filter(Boolean).join('　') }),
    warns.length ? el('ul', { class: 'warn-list' }, warns.map((w) => el('li', { text: w.msg }))) : null,
    el('div', { class: 'actions' }, [
      el('button', { class: 'btn', type: 'button', onclick: () => toggleSwap(card, s, plan, d, state, actions) }, TEXT.swap),
      s.designated || s.isAnchor ? null : el('button', { class: 'btn quiet', type: 'button', onclick: () => actions.removeStop(d.date, poi.id) }, TEXT.remove),
    ]),
  ]);
  if (legNext) {
    const legText = legNext.rideMin > 0 ? TEXT.rideTo(legNext.walkMin, legNext.rideMin) : TEXT.walkTo(legNext.walkMin);
    card.append(el('p', { class: 'leg muted small', text: `↓ ${legText}` }));
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
