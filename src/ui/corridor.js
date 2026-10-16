// 走廊清單的畫面邏輯（T15；原話 #57、#124；DESIGN §1.9「走廊清單不是站」）：前半是純函式（可測），後半畫清單給規劃頁與現場頁共用；寫回在 app.js。
// 升級成站＝加進那天的 picks（priority want）再重排（原話 #124「有興趣的話，應該是可以升級成大站」）；
// 「我進去了」只記在這支手機的 field.visited[poiId]（原話 #57「如果我有進去我再從那裡面填寫我有進去」；DESIGN §4 live），回國回灌進 KB my.visits[] 還沒接。
import { el } from './dom.js';
import { TEXT, CATEGORY } from './text.js';

/** 這天第 legIndex 段（0＝住宿→第一站）會經過的店：plan.corridor 裡那段的 pois（[{ poi, distM }]），沒有就空陣列。 */
export function corridorOfLeg(plan, legIndex) {
  return plan?.corridor?.find((c) => c.legIndex === legIndex)?.pois ?? [];
}

/** 這一段的長段提示（trip.js attachCorridor 的 leg-suggest）；沒有回 null。 */
export function legSuggestOf(plan, legIndex) {
  return plan?.warnings?.find((w) => w.ruleId === 'leg-suggest' && w.legIndex === legIndex) ?? null;
}

/**
 * 升級成站：回那天要改的欄位——picks 多一筆 { poiId, priority: 'want' }（已經在就不重複）；
 * 之前按過「不去了」的那筆從 removed 拿掉（走廊清單本來就不列拒絕過的，這是保險：留著的話 trip.js 會當拒絕過）。不改傳入的 day。
 */
export function upgradePick(day, poiId) {
  const picks = day?.picks ?? [];
  return {
    picks: picks.some((p) => p.poiId === poiId) ? picks : [...picks, { poiId, priority: 'want' }],
    removed: (day?.removed ?? []).filter((r) => r?.poiId !== poiId),
  };
}

/** 「我進去了」：回 setField 用的更新——field.visited[poiId] = { date, at }（只存裝置；再按一次就蓋成新的時刻）。 */
export function visitedPatch(field, date, poiId, at) {
  return { visited: { ...(field?.visited ?? {}), [poiId]: { date, at } } };
}

/** 引擎吃的去過表：field.visited { poiId: { date, at } } → { poiId: date }（trip.js visitedBefore：進去那天之後引擎不插、走廊不列；原話 #138）。沒日期的那筆跳過。 */
export function visitedDates(visited) {
  return Object.fromEntries(Object.entries(visited ?? {}).filter(([, v]) => typeof v?.date === 'string').map(([id, v]) => [id, v.date]));
}

/** 清單裡前 max 家的短店名與剩下幾家（畫面寫「會經過：X、Y、Z 等 5 家」）。 */
export function corridorNames(pois, max = 3) {
  const names = pois.slice(0, max).map((x) => shortName(x.poi.name_zh ?? x.poi.id));
  return { names, more: Math.max(0, pois.length - names.length) };
}

/**
 * 點名用的短店名：知識庫的店名常帶研究註記——「味的牛舌 喜助 發祥店一番町店（老舖・米其林）」「一番町拱廊商店街群（サンモール／ぶらんどーむ／一番町四丁目）」「…【待確認】」，
 * 提示鍵與現場頁「會經過」那行把括號、【】裡的拿掉（10-16 審查：390px 三顆提示鍵疊到 77–98px 高），點開的清單才寫全名。整個名字都是括號就照原樣。
 */
export function shortName(name) {
  const raw = String(name ?? '');
  const cut = raw.replace(/[（(][^（）()]*[）)]|【[^】]*】/g, ' ').replace(/\s{2,}/g, ' ').trim();   // 拿掉的位置留一個空白：「閣（Kaku）布蘭多姆本店」→「閣 布蘭多姆本店」
  return cut || raw;
}

/**
 * 展開／收合（規劃頁的「經過 N 家」與提示鍵、現場頁的「會經過」那行共用）：開合狀態記在 state.corridorOpen[key]（只在記憶體，不存），
 * 重畫時照它重開同一段——按「我進去了」會整頁重畫，之前只動 DOM、一按清單就收起、看不到打勾（10-16 審查）；重排（升級、不去了、換一家）由 app.js 清掉。
 * 鍵帶 aria-expanded，開著加 .on；build() 回清單節點，開的時候才建。
 */
export function corridorDisclosure({ key, state, button, box, build }) {
  const mark = (open) => {
    button.classList.toggle('on', open);
    button.setAttribute('aria-expanded', String(open));
    if (!state.corridorOpen) state.corridorOpen = {};
    if (open) state.corridorOpen[key] = true; else delete state.corridorOpen[key];
  };
  button.addEventListener('click', () => {
    const open = box.querySelector('.corridor-list');
    if (open) { open.remove(); mark(false); return; }
    box.append(build()); mark(true);
  });
  if (state.corridorOpen?.[key]) { box.append(build()); mark(true); } else button.setAttribute('aria-expanded', 'false');
}

/**
 * 清單本體（規劃頁與現場頁共用）：每家一列——店名（進去過的打勾）、店型、進去約幾分、離路線幾公尺（沒有營業時間資料的多寫「營業時間沒查到」）；
 * 鍵：「升級成站」（upgrade 才有：規劃頁有、現場頁沒有，現場重排會把整天翻掉）、「我進去了」（按過就寫「進去過了」）。
 * 開合狀態在 corridorDisclosure：按「我進去了」重畫後清單還開著、列上有勾；升級會重排、清單收起、頂端出復原列。
 */
export function corridorListNode({ pois, date, state, actions, upgrade = false }) {
  const visited = state.field?.visited ?? {};
  return el('div', { class: 'corridor-list' }, [
    el('p', { class: 'muted small', text: TEXT.corridorTitle }),
    ...pois.map(({ poi, distM, open = true }) => {
      const seen = Boolean(visited[poi.id]);
      return el('div', { class: `corridor-item${seen ? ' visited' : ''}` }, [
        el('span', { class: 'name' }, [el('strong', { text: poi.name_zh }), ' ', el('span', { class: 'cat', text: CATEGORY[poi.category] ?? '' })]),
        el('span', { class: 'muted small', text: `${TEXT.corridorDwell(poi.dwellMin ?? state.settings?.defaultDwellMin ?? 60)}，${TEXT.corridorDist(distM)}${open === null ? `，${TEXT.openUnknown}` : ''}` }),
        el('div', { class: 'actions' }, [
          upgrade ? el('button', { class: 'btn', type: 'button', onclick: () => actions.upgradeCorridor(date, poi.id) }, TEXT.upgradeStop) : null,
          seen ? el('span', { class: 'muted small', text: TEXT.visitedDone }) : el('button', { class: 'btn quiet', type: 'button', onclick: () => actions.markVisited(date, poi.id) }, TEXT.visitedMark),
        ]),
      ]);
    }),
  ]);
}
