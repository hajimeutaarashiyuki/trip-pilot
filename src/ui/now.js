// 現場：照走時只有下一站（名字、走幾分、幾點關）；一顆「出發去下一站」；落後只在角落寫；硬時限受威脅才翻成選擇清單；
// 離站彈一次評分可略過；試走模式不靠 GPS、時間可快轉（原話 #140、#141、#153）。
import { el, hm, dateLabel, nowMinutes, todayStr } from './dom.js';
import { TEXT } from './text.js';
import { openIntervals } from '../engine/time.js';
import { replanDay } from '../strategies/index.js';
import { resolveHome } from '../engine/trip.js';

export function renderNow({ state, actions }) {
  const f = state.field;
  const dates = state.trip.days.map((d) => d.date);
  const date = dates.includes(f.date) ? f.date : dates[0];
  const planned = state.plans[date];
  const seq = planned?.plan.sequence ?? [];
  // 選的那天不是今天（示範、或提前看），真的時間沒有意義：自動用試走模式
  const simulate = f.simulate || date !== todayStr();
  const nowMin = simulate ? (f.simNowMin ?? planned?.day.window.startMin ?? 540) : nowMinutes();
  const idx = Math.min(f.index ?? 0, seq.length);
  const next = seq[idx] ?? null;
  const prev = idx > 0 ? seq[idx - 1] : null;
  const nodes = [];

  // 哪一天、試走
  nodes.push(el('div', { class: 'row top' }, [
    el('label', { class: 'muted small' }, [TEXT.pickDay, ' ', el('select', { onchange: (e) => actions.setField({ date: e.target.value, index: 0 }) }, dates.map((dt) => el('option', { value: dt, selected: dt === date }, dateLabel(dt))))]),
    el('button', { class: `btn quiet${simulate ? ' on' : ''}`, type: 'button', onclick: () => actions.setField({ simulate: !f.simulate, simNowMin: planned?.day.window.startMin ?? 540 }) }, simulate ? TEXT.simOff : TEXT.simulate),
  ]));
  if (simulate) {
    nodes.push(el('div', { class: 'row sim' }, [
      el('span', { class: 'time big', text: hm(nowMin) }),
      el('button', { class: 'btn', type: 'button', onclick: () => actions.setField({ simNowMin: nowMin + 15 }) }, TEXT.simPlus(15)),
      el('button', { class: 'btn', type: 'button', onclick: () => actions.setField({ simNowMin: nowMin + 60 }) }, TEXT.simPlus(60)),
      el('button', { class: 'btn quiet', type: 'button', onclick: () => actions.setField({ simNowMin: planned?.day.window.startMin ?? 540, index: 0 }) }, TEXT.simReset),
    ]));
  }

  if (!next) {
    nodes.push(el('section', { class: 'card big' }, [el('h2', { text: TEXT.dayDone })]));
    return nodes;
  }

  // 下一站卡
  const from = prev ? prev.poi : resolveHome(state.trip, date);
  const leg = state.legFn(from, next.poi);
  const legText = leg.rideMin > 0 ? TEXT.rideTo(leg.walkMin, leg.rideMin) : TEXT.walkTo(leg.walkMin);
  const closes = closeMin(next.poi, date);
  const lateMin = nowMin + leg.walkMin + leg.rideMin - next.startMin; // 現在出發會比排定晚幾分（負＝有餘裕）
  const arriveMin = nowMin + leg.walkMin + leg.rideMin;
  const threatened = closes != null && arriveMin + Math.min(next.dwellMin, 30) > closes;
  const status = lateMin > (state.settings.lateThresholdMin ?? 15) ? TEXT.late(lateMin) : lateMin < -5 ? TEXT.early(-lateMin) : '';

  nodes.push(el('section', { class: 'card big next' }, [
    el('p', { class: 'muted small', text: TEXT.nextStop + (status ? `　${status}` : '') }),
    el('h2', { text: next.poi.name_zh }),
    el('p', { class: 'big-line', text: `${legText}${closes != null ? `　${TEXT.closesAt(hm(closes))}` : ''}` }),
    el('p', { class: 'muted small', text: `${hm(next.startMin)} 到，待 ${next.dwellMin} 分` }),
    next.insertedBy === 'engine' ? el('p', { class: 'muted small', text: TEXT.restInserted }) : null,
  ]));

  if (threatened) nodes.push(proposalsBlock({ state, actions, date, planned, seq, idx, nowMin, next, closes }));

  nodes.push(el('button', { class: 'btn primary huge', type: 'button', onclick: () => leave({ state, actions, seq, idx, prev: next }) }, TEXT.leaveNow));
  nodes.push(el('details', { class: 'resync' }, [
    el('summary', { text: TEXT.arrivedHere }),
    el('div', { class: 'list' }, seq.map((s, i) => el('button', { class: 'btn alt', type: 'button', onclick: () => actions.setField({ index: i }) }, `${hm(s.startMin)} ${s.poi.name_zh}`))),
  ]));
  return nodes;
}

function leave({ state, actions, seq, idx, prev }) {
  // 離開這一站：先問一次評分（可略過），再前進
  const root = document.getElementById('app');
  const box = el('div', { class: 'sheet' }, [
    el('h3', { text: TEXT.rateTitle(prev.poi.name_zh) }),
    el('div', { class: 'stars' }, [1, 2, 3, 4, 5, 6].map((n) => el('button', { class: 'btn star', type: 'button', onclick: () => done(n) }, `${n} ${TEXT.stars[n]}`))),
    el('button', { class: 'btn quiet', type: 'button', onclick: () => done(null) }, TEXT.rateSkip),
  ]);
  root.append(box);
  function done(rating) {
    const ratings = { ...(state.field.ratings ?? {}) };
    if (rating) ratings[prev.poi.id] = { rating, at: new Date().toISOString() };
    else ratings[prev.poi.id] = { skipped: true, at: new Date().toISOString() };
    actions.setField({ index: idx + 1, ratings });
  }
}

function proposalsBlock({ state, actions, date, planned, seq, idx, nowMin, next, closes }) {
  const remaining = seq.slice(idx).map((s) => ({ poi: s.poi, priority: s.priority ?? 'want', dwellMin: s.dwellMin, designated: s.designated, isAnchor: s.isAnchor, fixedWindow: s.fixedWindow }));
  const here = idx > 0 ? seq[idx - 1].poi : resolveHome(state.trip, date);
  const { proposals } = replanDay({ day: planned.day, remaining, here, nowMin, rules: state.rules, settings: state.settings, country: state.country, kb: state.kb, legFn: state.legFn, pool: state.pool });
  const block = el('section', { class: 'card warn' }, [
    el('p', { class: 'warn-line', text: TEXT.hardLimit(next.poi.name_zh, hm(closes)) }),
    el('h3', { text: TEXT.proposals }),
  ]);
  for (const p of proposals) {
    block.append(el('div', { class: 'proposal' }, [
      el('strong', { text: p.label }), el('span', { class: 'muted small', text: `　${p.note}` }),
      el('p', { class: 'small', text: p.plan.sequence.map((s) => `${hm(s.startMin)} ${s.poi.name_zh}`).join(' → ') || '（今天到此為止）' }),
      el('button', { class: 'btn', type: 'button', onclick: () => applyProposal({ state, actions, date, planned, idx, proposal: p }) }, TEXT.takeThis),
    ]));
  }
  return block;
}

function applyProposal({ state, actions, date, planned, idx, proposal }) {
  const done = planned.plan.sequence.slice(0, idx);
  planned.plan = { ...proposal.plan, sequence: [...done, ...proposal.plan.sequence] };
  actions.setField({ index: idx });
}

function closeMin(poi, date) {
  const iv = openIntervals(poi, date);
  if (!iv || !iv.length) return null;
  return Math.max(...iv.map(([, c]) => c));
}
