// 設定頁：四個數字（決策樹 Q17），改了立刻重排；加上旅程資料（桌機打包檔的網址、更新、從檔案載入）。
import { el } from './dom.js';
import { TEXT } from './text.js';

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
