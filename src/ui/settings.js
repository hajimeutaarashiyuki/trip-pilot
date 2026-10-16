// 設定頁：四個數字（決策樹 Q17），改了立刻重排；加上旅程資料（桌機打包檔的網址、更新、從檔案載入、誰同行、本機改動與還原成打包版）。
import { el } from './dom.js';
import { TEXT, CATEGORY } from './text.js';
import { personsOf, briefApplies, cityNamesOf } from '../engine/persons.js';
import { diffTripEdits } from './trip-edits.js';

/** '2026-08-13' → '8/13'（同行哪幾天那串；dateLabel 帶星期太長）。 */
function md(date) {
  const m = String(date ?? '').match(/^\d{4}-(\d{2})-(\d{2})$/);
  return m ? `${Number(m[1])}/${Number(m[2])}` : String(date ?? '');
}

/** 連續的日期合成一段：['2026-08-13','2026-08-14','2026-08-15','2026-08-17'] → '8/13–8/15、8/17'。 */
export function dateRanges(dates) {
  const list = [...new Set(dates ?? [])].sort();
  const out = [];
  const dayOf = (d) => Date.UTC(...String(d).split('-').map((x, i) => (i === 1 ? Number(x) - 1 : Number(x))));
  for (const d of list) {
    const last = out[out.length - 1];
    if (last && dayOf(d) - dayOf(last.to) === 86400000) last.to = d;
    else out.push({ from: d, to: d });
  }
  return out.map((r) => (r.from === r.to ? md(r.from) : `${md(r.from)}–${md(r.to)}`)).join('、');
}

/**
 * 「同行：…」一行（T19；原話 #136、#144）：一個人寫「一個人」；多人列名字——他是「我」、同行者用名字（沒名字寫「同行者」），
 * 括號裡接同行哪幾天（有 dates 的；需求單「只同行哪幾天」讀不懂的寫「「…」看不出是哪幾天，先整趟都算」）、體力（不是正常才寫）、夜間站（不是預設才寫）、不去的店型；
 * 來源是需求單時尾巴「（需求單）」；旅程檔沒 persons、需求單有同行者、但城市或日期跟這趟對不上時接一句講明（不然只看到「一個人」，不知道為什麼；10-16 審查）。
 * 他自己有調整時一個人也寫出來（「一個人（輕鬆）」，推導：那會影響排程、不該藏）。cityNames：打包檔的城市 id 與名字（cityNamesOf(state.kb)）。
 */
export function personsLine(trip, brief = null, cityNames = []) {
  const L = TEXT.companions;
  const persons = personsOf(trip, brief, null, cityNames);
  const fromBrief = persons.some((p) => p.source === 'brief');
  const mismatch = persons[0]?.source === 'party' && Array.isArray(brief?.persons) && brief.persons.filter((p) => p && typeof p === 'object').length >= 2 && !briefApplies(trip, brief, cityNames);
  const details = (p) => {
    const a = p.adjustments ?? {};
    return [
      !p.isMe && p.datesUnread ? L.partialUnread(p.partialDays) : !p.isMe && p.dates?.length ? dateRanges(p.dates) : '',
      L.stamina[a.stamina] ?? '',
      L.nightSlot[a.nightSlot] ?? '',
      a.avoidCategories?.length ? L.avoid(a.avoidCategories.map((c) => CATEGORY[c] ?? c).join('、')) : '',
    ].filter(Boolean).join('，');
  };
  const one = (p, label) => { const d = details(p); return d ? `${label}（${d}）` : label; };
  const body = persons.length <= 1 ? one(persons[0] ?? {}, L.alone) : persons.map((p) => one(p, p.isMe ? L.me : (p.name || L.unnamed))).join('、');
  return `${L.label}：${body}${fromBrief ? L.fromBrief : ''}${mismatch ? L.briefMismatch : ''}`;
}

let resetArm = null;   // 「還原成打包版」第一下只武裝幾秒、再按一下才還原（比照需求單的清空）；記住是哪顆鍵：重畫出來的新鍵要重新武裝，不會一按就還原

/** 「本機改動：…」那行的字（T16b）：diff 是 trip-edits.js diffTripEdits 的結果——N 天有改；picks 沒動、只有順延紀錄（排到別天但別天排不進）寫「只有順延紀錄」；都沒有寫「沒有」。 */
export function tripEditsText(diff) {
  const L = TEXT.tripEdits;
  const body = diff?.dates?.length ? L.days(diff.dates.length) : diff?.deferredChanged ? L.deferredOnly : L.none;
  return `${L.label}：${body}`;
}

/**
 * 「本機改動：N 天有改」＋「還原成打包版」（T16b；原話 #154 手機是操作端、#121 改了要留著）：規劃頁的改動跟打包那版（state.tripBase）比；有改才給還原鍵，
 * 按兩次才還原（app.js resetTripEdits：刪鍵、三個陣列與 deferred 放回打包那版、改過那幾天的現場改案也清掉、重排）。
 */
function tripEditsRow(state, actions) {
  const diff = diffTripEdits(state.trip, state.tripBase);
  const L = TEXT.tripEdits;
  const btn = diff.any ? el('button', { class: 'btn quiet sm', type: 'button' }, L.reset) : null;
  btn?.addEventListener('click', () => {
    if (resetArm?.btn === btn) { disarmReset(); actions.resetTripEdits(); return; }
    disarmReset();
    btn.textContent = L.resetConfirm;
    resetArm = { btn, timer: setTimeout(() => { if (resetArm?.btn === btn) resetArm = null; btn.textContent = L.reset; }, 4000) };
  });
  return el('p', { class: 'muted small edits' }, [tripEditsText(diff), btn]);
}
function disarmReset() { if (resetArm) clearTimeout(resetArm.timer); resetArm = null; }

export function renderSettings({ state, actions }) {
  const d = state.device;
  const s = state.settings;
  const num = (label, key, value, step = 15) => el('label', { class: 'field' }, [
    el('span', { text: label }),
    el('input', { type: 'number', inputmode: 'numeric', min: 0, step, value, onchange: (e) => actions.saveDevice({ [key]: Number(e.target.value) }) }),
  ]);
  const meta = state.packMeta;
  const packLine = meta ? TEXT.lastPack(meta.tripName ?? meta.tripId ?? '', meta.generatedAt) : TEXT.noPack;
  return [
    el('h1', { text: TEXT.tabs.settings }),
    el('section', { class: 'group' }, [
      el('h2', { text: TEXT.packSection }),
      el('p', { class: 'muted small', text: packLine }),
      // 誰同行（T19）：旅程檔的 persons、沒有就對得上的需求單、再沒有就 party；沒旅程就不寫
      state.trip ? el('p', { class: 'muted small', text: personsLine(state.trip, state.brief, cityNamesOf(state.kb)) }) : null,
      // 規劃頁的改動存在手機（T16b）：跟打包那版比有幾天改過、「還原成打包版」按兩次
      state.trip ? tripEditsRow(state, actions) : null,
      el('label', { class: 'field' }, [
        el('span', { text: TEXT.packUrl }),
        el('input', { type: 'url', inputmode: 'url', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', value: d.packUrl ?? '', placeholder: 'https://…/trip-pilot/pack.json', onchange: (e) => actions.saveDevice({ packUrl: e.target.value.trim() }) }),
      ]),
      el('div', { class: 'actions' }, [
        el('button', { class: 'btn primary', type: 'button', onclick: () => actions.updateFromUrl() }, TEXT.update),
        el('label', { class: 'btn' }, [
          TEXT.importFile,
          el('input', { type: 'file', accept: '.json,application/json', class: 'hidden-input', onchange: (e) => { const f = e.target.files?.[0]; if (f) actions.importFile(f); e.target.value = ''; } }),
        ]),
        el('a', { class: 'btn', href: '#/brief' }, TEXT.brief.entry),   // 需求單頁（T26）：出發前填的，不進底部分頁
      ]),
      state.packStatus ? el('p', { class: 'small status', text: state.packStatus }) : null,
    ]),
    el('section', { class: 'group' }, [
      el('h2', { text: TEXT.settingsTitle }),
      num(TEXT.walkBudget, 'walkBudgetMin', d.walkBudgetMin ?? s.walkBudgetMin),
      num(TEXT.openSlot, 'openSlotMinPerDay', d.openSlotMinPerDay ?? s.openSlotMinPerDay),
      el('label', { class: 'field' }, [
        el('span', { text: TEXT.departHM }),
        el('input', { type: 'time', value: d.departHM ?? s.dayWindow[0], onchange: (e) => actions.saveDevice({ departHM: e.target.value }) }),
      ]),
      el('label', { class: 'field row' }, [
        el('span', { text: TEXT.nightSlot }),
        el('input', { type: 'checkbox', checked: d.nightSlotOn !== false, onchange: (e) => actions.saveDevice({ nightSlotOn: e.target.checked }) }),
      ]),
    ]),
  ];
}
