// 現場：照走時只有下一站（名字、走幾分、幾點關）；一顆「出發去下一站」；落後只在角落寫；硬時限受威脅才翻成選擇清單；
// 「累了／腳痛」一顆次要鍵，按了才展開降速改案、他選了才套（原話 #115、總則 5）；
// 離站彈一次評分可略過，沒按的隔天在頂端補一張卡（原話 #134）；試走模式不靠 GPS、時間可快轉（原話 #140、#141、#153）；
// 套用的改案整天重算、存快照活過重排與重開（applied.js）；引擎插的站可以略過；停在別天時一顆「切到今天」。
import { el, hm, dateLabel, nowMinutes, todayStr } from './dom.js';
import { TEXT } from './text.js';
import { openIntervals } from '../engine/time.js';
import { replanDay, TIRED_STRATEGIES } from '../strategies/index.js';
import { resolveHome, engineMayInsert } from '../engine/trip.js';
import { routeUrl, legMode, tripCityName } from './maps.js';
import { darkBeforeMinOf } from './daylight.js';
import { pendingRatings, progressOf, daysBetween, skipStopPatch } from './ratings.js';
import { remainingFrom, lostStops, appliedPlan, snapshotPlan } from './applied.js';

export function renderNow({ state, actions }) {
  const f = state.field;
  const dates = state.trip.days.map((d) => d.date);
  const date = dates.includes(f.date) ? f.date : dates[0];
  const planned = state.plans[date];
  const seq = planned?.plan.sequence ?? [];
  const today = todayStr();
  // 選的那天不是今天（示範、或提前看），真的時間沒有意義：自動用試走模式
  const simulate = f.simulate || date !== today;
  const nowMin = simulate ? (f.simNowMin ?? planned?.day.window.startMin ?? 540) : nowMinutes();
  const idx = Math.min(progressOf(f, date), seq.length);   // 那天走到第幾站（按日期記，換日期不歸零）
  const next = seq[idx] ?? null;
  const prev = idx > 0 ? seq[idx - 1] : null;
  const nodes = [];

  // 哪一天、試走；停在別天而今天是旅程日時一顆「切到今天」（自動切日只在打開 App 那一刻做，app.js catchUpToday）
  nodes.push(el('div', { class: 'row top' }, [
    el('label', { class: 'muted small' }, [TEXT.pickDay, ' ', el('select', { onchange: (e) => actions.setField({ date: e.target.value }) }, dates.map((dt) => el('option', { value: dt, selected: dt === date }, dateLabel(dt))))]),
    dates.includes(today) && date !== today ? el('button', { class: 'btn quiet', type: 'button', onclick: () => actions.setField({ date: today }) }, TEXT.jumpToday) : null,
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

  // 補評卡：前幾天走過、沒按評分的站（略過的不補）；今天＝試走模式選的那天、真的時間就是今天
  nodes.push(rateLaterCard({ state, actions, today: simulate ? date : todayStr() }));

  if (!next) {
    nodes.push(el('section', { class: 'card big' }, [el('h2', { text: TEXT.dayDone })]));
    return nodes;
  }

  // 下一站卡
  const from = prev ? prev.poi : resolveHome(state.trip, date);
  const leg = state.legFn(from, next.poi);
  const legText = leg.rideMin > 0 ? TEXT.rideTo(leg.walkMin, leg.rideMin) : TEXT.walkTo(leg.walkMin);
  // 釘起訖的固定時段（研討會、演唱會；stop.fixedWindow.endMin）：硬時限是散場時刻，不是場地的營業時間（會場寫 19:30 關、排程卻是 20:00）；
  // 到場時它已經散了才算受威脅——研討會中途卡片一整天都是這一站，不能 19:00 一過就翻成改案清單（10-14 T23 審查）
  const ends = Number.isFinite(next.fixedWindow?.endMin) ? next.fixedWindow.endMin : null;
  const closes = ends == null ? closeMin(next.poi, date) : null;
  const dark = ends == null && closes == null ? darkBeforeMinOf(next.poi, date, state) : null;   // 白天站沒有幾點關，寫天黑前；天黑也是硬時限（原話 #159）
  const limitMin = ends ?? closes ?? dark;
  const lateMin = nowMin + leg.walkMin + leg.rideMin - next.startMin; // 現在出發會比排定晚幾分（負＝有餘裕）
  const arriveMin = nowMin + leg.walkMin + leg.rideMin;
  const threatened = limitMin != null && (ends != null ? arriveMin > ends : arriveMin + Math.min(next.dwellMin, 30) > limitMin);
  const status = lateMin > (state.settings.lateThresholdMin ?? 15) ? TEXT.late(lateMin) : lateMin < -5 ? TEXT.early(-lateMin) : '';

  nodes.push(el('section', { class: 'card big next' }, [
    el('p', { class: 'muted small', text: TEXT.nextStop + (status ? `　${status}` : '') }),
    el('h2', { text: next.poi.name_zh }),
    el('p', { class: 'big-line', text: `${legText}${ends != null ? `　${TEXT.endsAt(hm(ends))}` : closes != null ? `　${TEXT.closesAt(hm(closes))}` : dark != null ? `　${TEXT.darkBefore(hm(dark))}` : ''}` }),
    el('p', { class: 'muted small', text: `${hm(next.startMin)} 到，待 ${next.dwellMin} 分` }),
    next.insertedBy === 'engine' ? el('p', { class: 'muted small', text: next.poi.category === 'spot' ? TEXT.spotInsertedNow(hm(next.endMin)) : next.priority === 'filler' ? TEXT.fillerInsertedNow : next.priority === 'onway' ? TEXT.onTheWayInsertedNow : TEXT.restInsertedNow }) : null,
    // 路線深連結：不帶 origin（Google Maps 用現在位置），搭車段 transit、其餘 walking（原話 #157）
    // 引擎插的站多一顆「略過這站」：記成略過（跟略過評分同形，補評卡不問）、進度前進、不彈評分；一般站沒有（跳過一般站走「我現在在這站」）
    el('div', { class: 'actions' }, [
      el('a', { class: 'btn', href: routeUrl({ to: next.poi, mode: legMode(leg), cityName: tripCityName(state) }), target: '_blank', rel: 'noopener' }, TEXT.openMaps),
      next.insertedBy === 'engine' ? el('button', { class: 'btn quiet', type: 'button', onclick: () => actions.setField(skipStopPatch(f, date, next.poi.id, new Date().toISOString())) }, TEXT.skipStop) : null,
    ]),
  ]));

  if (threatened) nodes.push(proposalsBlock({ state, actions, date, planned, seq, idx, nowMin, title: TEXT.proposals, tone: 'warn', limitText: ends != null ? TEXT.hardLimitEnds(next.poi.name_zh, hm(ends)) : closes != null ? TEXT.hardLimit(next.poi.name_zh, hm(closes)) : TEXT.hardLimitDark(next.poi.name_zh, hm(dark)) }));

  nodes.push(el('button', { class: 'btn primary huge', type: 'button', onclick: () => leave({ state, actions, idx, prev: next }) }, TEXT.leaveNow));
  nodes.push(tiredToggle({ state, actions, date, planned, seq, idx, nowMin }));
  nodes.push(el('details', { class: 'resync' }, [
    el('summary', { text: TEXT.arrivedHere }),
    el('div', { class: 'list' }, seq.map((s, i) => el('button', { class: 'btn alt', type: 'button', onclick: () => actions.setField({ index: i }) }, `${hm(s.startMin)} ${s.poi.name_zh}`))),
  ]));
  return nodes;
}

/**
 * 離開這一站：先前進（出發不等評分；progress[date] 跟著記），再彈一次評分（1–6 或略過）。
 * 沒按就留著——任何重畫（快轉、換頁）都會把 sheet 收掉，那站就成了「忘了評」，隔天現場頁的補評卡再問一次；略過的有紀錄、不再問（profile §7）。
 */
function leave({ state, actions, idx, prev }) {
  actions.setField({ index: idx + 1 });
  document.getElementById('app').append(el('div', { class: 'sheet' }, [
    el('h3', { text: TEXT.rateTitle(prev.poi.name_zh) }),
    starButtons((n) => rate({ state, actions, poi: prev.poi, rating: n })),
    el('button', { class: 'btn quiet', type: 'button', onclick: () => rate({ state, actions, poi: prev.poi, rating: null }) }, TEXT.rateSkip),
  ]));
}

/**
 * 補評卡（profile §7、原話 #134）：日期在今天之前、走過、沒按評分的站（略過的不補），放在日期列下面；
 * 每站一列六顆星＋略過，評了或略過就從卡上消失，全部處理完卡就不出現。只在現場頁。標題依日期分組：昨天／前天／日期。
 */
function rateLaterCard({ state, actions, today }) {
  const pending = pendingRatings({ plans: state.plans, field: state.field, today });
  if (!pending.length) return null;
  const byDate = new Map();
  for (const { date, poi } of pending) byDate.set(date, [...(byDate.get(date) ?? []), poi]);
  const card = el('section', { class: 'card ratelater' });
  for (const [date, pois] of byDate) {
    card.append(el('h3', { text: TEXT.rateLater(TEXT.rateLaterWhen(daysBetween(date, today), dateLabel(date)), pois.map((p) => p.name_zh).join('、')) }));
    for (const poi of pois) {
      card.append(el('div', { class: 'rate-item' }, [
        el('p', {}, [el('strong', { text: poi.name_zh })]),
        starButtons((n) => rate({ state, actions, poi, rating: n })),
        el('button', { class: 'btn quiet', type: 'button', onclick: () => rate({ state, actions, poi, rating: null }) }, TEXT.rateLaterSkip),
      ]));
    }
  }
  return card;
}

/** 六顆星（1 踩雷 … 6 必去）；離站的 sheet 與補評卡共用。 */
function starButtons(onPick) {
  return el('div', { class: 'stars' }, [1, 2, 3, 4, 5, 6].map((n) => el('button', { class: 'btn star', type: 'button', onclick: () => onPick(n) }, `${n} ${TEXT.stars[n]}`)));
}

/** 寫一筆評分（1–6）或略過（null）到 field.ratings[poiId]；重畫後 sheet 收掉、補評卡少一列。 */
function rate({ state, actions, poi, rating }) {
  const at = new Date().toISOString();
  actions.setField({ ratings: { ...(state.field.ratings ?? {}), [poi.id]: rating ? { rating, at } : { skipped: true, at } } });
}

/**
 * 「累了／腳痛」（原話 #115、DESIGN §1.4 策略 5、profile §8）：出發鍵下面一顆次要鍵，不跟出發搶視覺；按了才在下面展開降速那組改案
 * （TIRED_STRATEGIES：只坐一下、坐一下再少走路、回住宿），再按一次收起；他點「照這個走」才套，不自動套（總則 5）。
 * 展開收合只動 DOM（跟規劃頁的換一家一樣），任何重畫（快轉、套用改案）就收起。
 */
function tiredToggle({ state, actions, date, planned, seq, idx, nowMin }) {
  const btn = el('button', { class: 'btn quiet wide', type: 'button' }, TEXT.tired);
  const box = el('div', { class: 'tired' }, [btn]);
  btn.addEventListener('click', () => {
    const open = box.querySelector('.card');
    if (open) { open.remove(); btn.textContent = TEXT.tired; btn.classList.remove('on'); return; }
    box.append(proposalsBlock({ state, actions, date, planned, seq, idx, nowMin, title: TEXT.tiredTitle, tone: 'rest', strategies: TIRED_STRATEGIES, pool: tiredPool(state, planned, seq) }));
    btn.textContent = TEXT.tiredClose; btn.classList.add('on');
  });
  return box;
}

/**
 * 累了時可以拿來坐的站：當日區域內整個知識庫（原話 #126），扣掉今天排了的、別天排進去的（同一家不在兩天出現）、任何一天按過「不去了」的；
 * 今天勾了但排不進的（示範 8/13 的火星の庭）留著——它就在附近、他本來就想去，正好拿來坐。錢湯要準備、不臨時提（profile §5.9）。形狀同 state.pool（{ poi }）。
 * 知識庫裡本來就不主動排的店（挖寶型、2 星、落選兩次、未解鎖、代購研究站）也不拿：跟引擎插的恢復站、填站、順路站同一道門（trip.js engineMayInsert，10-14 T22）。
 */
function tiredPool(state, planned, seq) {
  const zones = new Set(planned.day.regionZones ?? []);
  const skip = new Set(seq.map((s) => s.poi.id));
  for (const other of Object.values(state.plans)) if (other !== planned) for (const s of other.plan.sequence) skip.add(s.poi.id);
  for (const d of state.trip.days) for (const r of d.removed ?? []) if (r?.poiId) skip.add(r.poiId);
  return Object.values(state.pois).filter((p) => engineMayInsert(p) && zones.has(p.zoneId) && !skip.has(p.id) && p.category !== 'onsen').map((poi) => ({ poi }));
}

/**
 * 改案清單（DESIGN §6.3）：每案寫標題、一句話、新的時間表、插了哪家休息、會少掉什麼、吃掉多少留白；他點了才套。
 * strategies 不給就跑五種（硬時限受威脅）；pool 不給就用整個候選池。跟目前剩下的排程一模一樣的案 replanDay 已拿掉，一案都沒有就寫一句。
 */
function proposalsBlock({ state, actions, date, planned, seq, idx, nowMin, title, tone = 'warn', limitText = null, strategies, pool }) {
  const remaining = remainingFrom(seq, idx);
  const here = idx > 0 ? seq[idx - 1].poi : resolveHome(state.trip, date);
  const { proposals } = replanDay({ day: planned.day, remaining, here, nowMin, rules: state.rules, settings: state.settings, country: state.country, kb: state.kb, legFn: state.legFn, pool: pool ?? state.pool, strategies });
  const slackMin = planned.day.openSlotMin ?? 0;
  const block = el('section', { class: `card ${tone}` }, [
    limitText ? el('p', { class: 'warn-line', text: limitText }) : null,
    el('h3', { text: title }),
  ]);
  if (!proposals.length) block.append(el('p', { class: 'muted small', text: TEXT.proposalsNone }));
  for (const p of proposals) {
    const rest = restInsertedIn(p);
    const lost = lostStops(p, remaining).map((l) => l.poi.name_zh);
    block.append(el('div', { class: 'proposal' }, [
      el('strong', { text: p.label }), el('span', { class: 'muted small', text: `　${p.note}` }),
      el('p', { class: 'small', text: p.plan.sequence.map((s) => `${hm(s.startMin)} ${s.poi.name_zh}`).join(' → ') || TEXT.proposalEmpty }),
      rest ? el('p', { class: 'muted small', text: rest.pinned ? TEXT.tiredRestPinned(rest.stop.poi.name_zh) : TEXT.tiredRestInserted(rest.stop.poi.name_zh) }) : null,
      lost.length ? el('p', { class: 'muted small', text: TEXT.proposalLost(lost.join('、')) }) : null,
      // 最後一站超過扣過留白的收工＝吃掉留白（留白本來就是給現場落後吃的，profile §8）；留白用完的案照出，句子寫超過多少
      p.eatsSlackMin > 0 ? el('p', { class: 'muted small', text: p.eatsSlackMin > slackMin ? TEXT.proposalOverSlack(p.eatsSlackMin - slackMin) : TEXT.proposalEatsSlack(p.eatsSlackMin) }) : null,
      el('button', { class: 'btn', type: 'button', onclick: () => applyProposal({ state, actions, date, planned, idx, proposal: p }) }, TEXT.takeThis),
    ]));
  }
  return block;
}

/** 這案先去坐的那站：插進來的（insert-rest）或釘到最前面的既有恢復站（pin-rest），而且真的排進去了；排不進就不寫。 */
function restInsertedIn(p) {
  const ins = p.changes.find((c) => c.action === 'insert-rest' || c.action === 'pin-rest');
  const stop = ins ? p.plan.sequence.find((s) => s.poi.id === ins.poiId) : null;
  return stop ? { stop, pinned: ins.action === 'pin-rest' } : null;
}

/**
 * 套用改案：走過的留著、後面換成這案，整天重算（分數、罰分、警告、排不進都對整條序列算，applied.js appliedPlan），
 * 快照存進 field.applied[date]（setField → localStorage），任何重排與 App 重開都由 app.js replanAll 還原（restoreApplied）。
 * 同一天套第二次：appliedIndex 取最早接上的那次、lost 累積，前面走過的前綴才一直算「早上出門」。
 */
function applyProposal({ state, actions, date, planned, idx, proposal }) {
  const sequence = [...planned.plan.sequence.slice(0, idx), ...proposal.plan.sequence];
  const before = state.field.applied?.[date] ?? null;
  const lost = [...(before?.lost ?? []), ...lostStops(proposal, remainingFrom(planned.plan.sequence, idx)).map((l) => ({ poiId: l.poi.id, reason: l.reason }))];
  const appliedIndex = Math.min(idx, before?.appliedIndex ?? idx);
  const next = appliedPlan({ planned, sequence, appliedIndex, lost, trip: state.trip, legFn: state.legFn, rules: state.rules, settings: state.settings, country: state.country, kb: state.kb });
  state.plans[date] = next;
  actions.setField({ index: idx, applied: { ...(state.field.applied ?? {}), [date]: snapshotPlan(next.plan, appliedIndex, { packAt: state.packMeta?.generatedAt ?? null, lost }) } });
}

function closeMin(poi, date) {
  const iv = openIntervals(poi, date);
  if (!iv || !iv.length) return null;
  return Math.max(...iv.map(([, c]) => c));
}
