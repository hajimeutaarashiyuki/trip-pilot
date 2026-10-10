// 設定頁：只有四個數字（決策樹 Q17）。改了立刻重排。
import { el } from './dom.js';
import { TEXT } from './text.js';

export function renderSettings({ state, actions }) {
  const d = state.device;
  const s = state.settings;
  const num = (label, key, value, step = 15) => el('label', { class: 'field' }, [
    el('span', { text: label }),
    el('input', { type: 'number', inputmode: 'numeric', min: 0, step, value, onchange: (e) => actions.saveDevice({ [key]: Number(e.target.value) }) }),
  ]);
  return [
    el('h1', { text: TEXT.tabs.settings }),
    el('p', { class: 'muted', text: TEXT.settingsTitle }),
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
  ];
}
