// 候選池：這城所有候選，標排進哪天；照店型分組。
import { el, dateLabel } from './dom.js';
import { TEXT, CATEGORY } from './text.js';

export function renderPool({ state }) {
  const plannedOn = new Map();
  for (const [date, d] of Object.entries(state.plans)) for (const s of d.plan.sequence) plannedOn.set(s.poi.id, date);
  const groups = new Map();
  for (const c of state.pool) {
    const cat = c.poi.category;
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat).push(c.poi);
  }
  const nodes = [el('h1', { text: TEXT.poolTitle })];
  for (const [cat, list] of groups) {
    nodes.push(el('section', { class: 'group' }, [
      el('h2', { text: `${CATEGORY[cat] ?? cat}（${list.length}）` }),
      el('ul', { class: 'plain' }, list.map((p) => {
        const on = plannedOn.get(p.id);
        return el('li', {}, [el('strong', { text: p.name_zh }), el('span', { class: 'muted small', text: `　${on ? TEXT.plannedOn(dateLabel(on)) : TEXT.notPlanned}` })]);
      })),
    ]));
  }
  return nodes;
}
