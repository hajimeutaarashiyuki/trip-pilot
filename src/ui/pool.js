// 候選池：這城所有候選，標排進哪天；照店型分組。二選一沒選、別天也排不進的（trip.deferred 裡 unplaced、或順延到的那天又排不進）標「順延中」（T16）。
import { el, dateLabel } from './dom.js';
import { TEXT, CATEGORY } from './text.js';
import { deferredMark } from './choices.js';

export function renderPool({ state }) {
  const plannedOn = new Map();
  // 引擎插的站（insertedBy）不算他排的：候選池只標他自己勾進哪天
  for (const [date, d] of Object.entries(state.plans)) for (const s of d.plan.sequence) if (!s.insertedBy) plannedOn.set(s.poi.id, date);
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
        const pending = on ? null : deferredMark(state.trip, p.id, state.plans);
        return el('li', {}, [p.item ? el('span', { class: 'cat item', text: p.item }) : null, el('strong', { text: p.name_zh }), el('span', { class: 'muted small', text: `　${on ? TEXT.plannedOn(dateLabel(on)) : pending ?? TEXT.notPlanned}` })]);
      })),
    ]));
  }
  return nodes;
}
