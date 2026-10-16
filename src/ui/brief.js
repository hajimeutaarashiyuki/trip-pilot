// 需求單頁（T26；原話 #172「記得要做需求單的頁面」、#87 網頁或視窗、勾選、記憶）：docs/brief-template.md v2 的五段做成可勾可填的一頁，出發前填、不是隨身用（不進底部分頁）。
// 每改一個欄位就存手機（app.js setBrief）。打字、勾選、下拉的欄位存了不重畫——重畫會把焦點踢掉、手機鍵盤收起來——
// 只有結構變了才重畫：加列、刪列、加／移除同行者、記憶按鈕加進表、純玩／有公務與移動方式的 radio（多一欄要出現或收掉）、載入、清空、復原。
// 改資料一律從 updater 收到的現況算（x），不拿畫面當下的物件，不然沒重畫的期間會蓋掉剛打的字。
// 存成檔案／複製文字／載入別份／清空時 app.js 順手把消耗品與他要買的記進記憶（data/brief-memory.js），下一份需求單在 §4 與「要買的」上方帶出來一排按鈕。
import { el } from './dom.js';
import { TEXT } from './text.js';
import { emptyPerson, emptyErrand, emptyTask, emptyFixedWindow, emptyThemeDay, GO_THEMES, PURPOSES, MODES, THEME_DAY_CATEGORIES, STAMINAS, NIGHT_SLOTS } from '../data/brief.js';
import { suggestionsFor } from '../data/brief-memory.js';

const L = TEXT.brief;
let clearTimer = null;   // 「清空」第一下只武裝幾秒，再按一下才清

export function renderBrief({ state, actions }) {
  const b = state.brief;
  const me = b.persons.find((p) => p.isMe) ?? b.persons[0];
  const companions = b.persons.filter((p) => p !== me);
  const sugg = suggestionsFor(state.briefMemory, b);
  const put = (fn) => actions.setBrief(fn, { rerender: false });   // 打字中：存、不重畫
  const putRender = (fn) => actions.setBrief(fn);                   // 結構變了：存、重畫
  disarmClear();
  return [el('div', { class: 'brief' }, [
    el('h1', { text: L.title }),
    el('p', { class: 'muted small intro', text: L.intro }),
    actionBar(actions),
    // 載入別份或清空後留一次「復原上一份」（跟「不去了」的一次性復原同一個想法，原話 #171）
    state.briefStatus ? el('p', { class: 'small status' }, [state.briefStatus, state.briefUndo ? el('button', { class: 'btn quiet sm', type: 'button', onclick: () => actions.undoBrief() }, L.undo) : null]) : null,
    state.briefCopyText ? el('textarea', { class: 'copy-box', readonly: true, onfocus: (e) => e.target.select() }, state.briefCopyText) : null,
    skeletonSection(b, put, putRender),
    personSection(me, put, putRender, sugg.ownItems),
    // 沒有同行者也留「3. 同行者」這一節（編號不跳 2 → 4，他看得到這段是給誰填的）；有的話每位一段、標題帶名字
    ...(companions.length ? companions.map((c) => personSection(c, put, putRender, [])) : [el('section', { class: 'group' }, [el('h2', { text: L.s3 }), el('p', { class: 'muted small', text: L.companionsHint })])]),
    el('div', { class: 'actions' }, [el('button', { class: 'btn', type: 'button', onclick: () => putRender((x) => ({ ...x, persons: [...x.persons, emptyPerson()] })) }, L.addPerson)]),
    errandsSection(b, sugg.consumables, put, putRender),
    tasksSection(b, put, putRender),
  ])];
}

// ---- 小零件 ----
const splitLines = (s) => s.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
const field = (label, input, cls = '') => el('label', { class: `field${cls ? ` ${cls}` : ''}` }, [el('span', { text: label }), input]);
const textInput = (value, onInput, attrs = {}) => el('input', { type: 'text', value, autocomplete: 'off', autocapitalize: 'off', oninput: (e) => onInput(e.target.value), ...attrs });
const dateInput = (value, onChange) => el('input', { type: 'date', value, onchange: (e) => onChange(e.target.value) });
const timeInput = (value, onChange) => el('input', { type: 'time', value, onchange: (e) => onChange(e.target.value) });
const linesInput = (value, onInput, placeholder = '') => el('textarea', { rows: 4, placeholder, autocapitalize: 'off', oninput: (e) => onInput(splitLines(e.target.value)) }, value.join('\n'));
const select = (value, options, onChange, attrs = {}) => el('select', { onchange: (e) => onChange(e.target.value), ...attrs }, options.map(([v, label]) => el('option', { value: v, selected: v === value }, label)));
const radios = (name, value, options, onChange) => el('div', { class: 'choices' }, options.map(([v, label]) => el('label', { class: 'choice' }, [el('input', { type: 'radio', name, value: v, checked: v === value, onchange: () => onChange(v) }), label])));
const checkbox = (label, checked, onChange) => el('label', { class: 'choice' }, [el('input', { type: 'checkbox', checked, onchange: (e) => onChange(e.target.checked) }), label]);
const delButton = (onclick) => el('button', { class: 'btn quiet sm del', type: 'button', 'aria-label': L.remove, onclick }, L.remove);
const addButton = (onclick, label = L.addRow) => el('div', { class: 'actions' }, [el('button', { class: 'btn sm', type: 'button', onclick }, label)]);
const chips = (label, items) => el('div', { class: 'field' }, [el('span', { text: label }), el('div', { class: 'chips' }, items.map(([text, onclick]) => el('button', { class: 'btn quiet sm', type: 'button', onclick }, text)))]);

function actionBar(actions) {
  const clearBtn = el('button', { class: 'btn quiet', type: 'button' }, L.clear);
  clearBtn.addEventListener('click', () => {
    if (clearTimer) { disarmClear(); actions.clearBrief(); return; }
    clearBtn.textContent = L.clearConfirm;
    clearTimer = setTimeout(() => { clearTimer = null; clearBtn.textContent = L.clear; }, 4000);
  });
  return el('div', { class: 'actions' }, [
    el('button', { class: 'btn primary', type: 'button', onclick: () => actions.exportBrief() }, L.export),
    el('button', { class: 'btn', type: 'button', onclick: () => actions.copyBrief() }, L.copy),
    el('label', { class: 'btn' }, [
      L.import,
      el('input', { type: 'file', accept: '.json,application/json', class: 'hidden-input', onchange: (e) => { const f = e.target.files?.[0]; if (f) actions.importBrief(f); e.target.value = ''; } }),
    ]),
    clearBtn,
  ]);
}
function disarmClear() { if (clearTimer) clearTimeout(clearTimer); clearTimer = null; }

// ---- §1 骨架 ----
function skeletonSection(b, put, putRender) {
  const setTop = (k) => (v) => put((x) => ({ ...x, [k]: v }));
  const setIn = (k, sub) => (v) => put((x) => ({ ...x, [k]: { ...x[k], [sub]: v } }));
  const setRow = (k, i, sub) => (v) => put((x) => ({ ...x, [k]: x[k].map((r, j) => (j === i ? { ...r, [sub]: v } : r)) }));
  const dropRow = (k, i) => () => putRender((x) => ({ ...x, [k]: x[k].filter((_, j) => j !== i) }));
  const addRow = (k, make) => () => putRender((x) => ({ ...x, [k]: [...x[k], make()] }));
  return el('section', { class: 'group' }, [
    el('h2', { text: L.s1 }),
    field(L.city, textInput(b.city, setTop('city'))),
    el('div', { class: 'pair' }, [field(L.dateFrom, dateInput(b.dates.from, setIn('dates', 'from'))), field(L.dateTo, dateInput(b.dates.to, setIn('dates', 'to')))]),
    el('div', { class: 'pair' }, [field(L.arriveHM, timeInput(b.flights.arriveHM, setIn('flights', 'arriveHM'))), field(L.departHM, timeInput(b.flights.departHM, setIn('flights', 'departHM')))]),
    el('p', { class: 'muted small hint', text: L.flightsHint }),
    field(L.lodging, textInput(b.lodging, setTop('lodging'))),
    el('div', { class: 'field' }, [el('span', { text: L.purpose }), radios('purpose', b.purpose, PURPOSES.map((v) => [v, L.purposes[v]]), (v) => putRender((x) => ({ ...x, purpose: v })))]),
    b.purpose === 'work' ? field(L.workNote, textInput(b.workNote, setTop('workNote'))) : null,
    el('div', { class: 'field rows' }, [
      el('span', { text: L.fixedWindows }),
      ...b.fixedWindows.map((w, i) => el('div', { class: 'brief-row fixed' }, [
        field(L.fwDate, dateInput(w.date, setRow('fixedWindows', i, 'date')), 'wide'),   // 窄螢幕日期占整行（三個日期時間欄並排會爆寬）
        field(L.fwStart, timeInput(w.startHM, setRow('fixedWindows', i, 'startHM'))),
        field(L.fwEnd, timeInput(w.endHM, setRow('fixedWindows', i, 'endHM'))),
        field(L.fwLabel, textInput(w.label, setRow('fixedWindows', i, 'label')), 'wide'),
        delButton(dropRow('fixedWindows', i)),
      ])),
      addButton(addRow('fixedWindows', emptyFixedWindow)),
    ]),
    el('div', { class: 'field' }, [el('span', { text: L.mode }), radios('mode', b.mode, MODES.map((v) => [v, L.modes[v]]), (v) => putRender((x) => ({ ...x, mode: v })))]),
    b.mode !== 'transit' ? field(L.modeNote, textInput(b.modeNote, setTop('modeNote'))) : null,
    el('div', { class: 'pair' }, [
      field(L.dayTrips, el('input', { type: 'number', inputmode: 'numeric', min: 0, step: 1, value: b.dayTrips.count ?? '', onchange: (e) => { const n = Number.parseInt(e.target.value, 10); setIn('dayTrips', 'count')(Number.isInteger(n) && n >= 0 ? n : null); } })),
      field(L.dayTripsDirection, textInput(b.dayTrips.direction, setIn('dayTrips', 'direction'))),
    ]),
    el('div', { class: 'field rows' }, [
      el('span', { text: L.themeDays }),
      ...b.themeDays.map((t, i) => el('div', { class: 'brief-row theme' }, [
        field(L.themeDate, dateInput(t.date, setRow('themeDays', i, 'date'))),
        field(L.themeCategory, select(t.category, THEME_DAY_CATEGORIES.map((v) => [v, L.themeCategories[v]]), setRow('themeDays', i, 'category'))),
        delButton(dropRow('themeDays', i)),
      ])),
      addButton(addRow('themeDays', emptyThemeDay)),
    ]),
    field(L.departureNote, textInput(b.departureNote, setTop('departureNote'))),
  ]);
}

// ---- §2 我、§3 同行者（同一組欄位；同行者多名字欄與移除鍵） ----
function personSection(p, put, putRender, ownSuggestions) {
  const setP = (fn) => put((x) => ({ ...x, persons: x.persons.map((q) => (q.id === p.id ? fn(q) : q)) }));
  const setGo = (k) => (v) => setP((q) => ({ ...q, go: { ...q.go, [k]: v } }));
  const setBuy = (k) => (v) => setP((q) => ({ ...q, buy: { ...q.buy, [k]: v } }));
  const setAdj = (k) => (v) => setP((q) => ({ ...q, adjustments: { ...q.adjustments, [k]: v } }));
  const n = p.isMe ? 2 : 3;
  const titleOf = (name) => (p.isMe ? L.s2 : name ? `${L.s3}：${name}` : L.s3);   // 沒填名字就只寫「3. 同行者」，不印成「同行者：同行者」
  const head = el('h2', { text: titleOf(p.name) });
  const nodes = [el('div', { class: 'person-head' }, [
    head,
    p.isMe ? null : el('button', { class: 'btn quiet sm', type: 'button', onclick: () => putRender((x) => ({ ...x, persons: x.persons.filter((q) => q.id !== p.id), tasks: x.tasks.map((t) => (t.who === p.id ? { ...t, who: '' } : t)) })) }, L.removePerson),
  ])];
  if (!p.isMe) {
    nodes.push(el('p', { class: 'muted small', text: L.companionIntro }));
    // 名字改了不重畫：標題與 §5「誰」的選項直接改字
    nodes.push(el('div', { class: 'pair' }, [
      field(L.personName, textInput(p.name, (v) => { setP((q) => ({ ...q, name: v })); head.textContent = titleOf(v); renameWhoOption(p.id, v || L.personUnnamed); })),
      field(L.partialDays, textInput(p.partialDays, (v) => setP((q) => ({ ...q, partialDays: v })), { placeholder: L.partialDaysPlaceholder })),
    ]));
  }
  nodes.push(
    el('h3', { text: `${n}.1 ${L.goTitle}` }),
    field(L.go, linesInput(p.go.designated, setGo('designated'), L.goPlaceholder)),
    field(L.mustEat, linesInput(p.go.mustEat, setGo('mustEat'))),
    el('div', { class: 'field' }, [el('span', { text: L.themes }), el('div', { class: 'choices' }, [
      ...GO_THEMES.map((t) => checkbox(L.themeList[t], p.go.themes.includes(t), (on) => setP((q) => ({ ...q, go: { ...q.go, themes: on ? [...new Set([...q.go.themes, t])] : q.go.themes.filter((x) => x !== t) } })))),
      el('label', { class: 'choice other' }, [L.themeOther, textInput(p.go.themeOther, setGo('themeOther'))]),
    ])]),
    el('h3', { text: `${n}.2 ${L.buyTitle}` }),
    ownSuggestions.length ? chips(L.lastOwn, ownSuggestions.map((s) => [s.what, () => putRender((x) => ({ ...x, persons: x.persons.map((q) => (q.id === p.id ? { ...q, buy: { ...q.buy, own: [...q.buy.own, s.what] } } : q)) }))])) : null,
    field(L.buyOwn, linesInput(p.buy.own, setBuy('own'), L.buyOwnPlaceholder)),
    field(L.brandExceptions, linesInput(p.buy.brandExceptions, setBuy('brandExceptions'))),
    el('h3', { text: `${n}.3 ${L.adjustTitle}` }),
    el('div', { class: 'pair' }, [
      field(L.stamina, select(p.adjustments.stamina, STAMINAS.map((v) => [v, L.staminas[v]]), setAdj('stamina'))),
      field(L.nightSlot, select(p.adjustments.nightSlot, NIGHT_SLOTS.map((v) => [v, L.nightSlots[v]]), setAdj('nightSlot'))),
    ]),
    field(L.dislikes, textInput(p.adjustments.dislikes, setAdj('dislikes'))),
  );
  return el('section', { class: 'group person' }, nodes);
}

function renameWhoOption(personId, label) {
  for (const sel of document.querySelectorAll('.brief select.who')) {
    for (const opt of sel.options) if (opt.value === personId) opt.textContent = label;
  }
}

// ---- §4 別人的（代購） ----
function errandsSection(b, suggestions, put, putRender) {
  const setRow = (id, k) => (v) => put((x) => ({ ...x, errands: x.errands.map((r) => (r.id === id ? { ...r, [k]: v } : r)) }));
  return el('section', { class: 'group' }, [
    el('h2', { text: L.s4 }),
    el('p', { class: 'muted small', text: L.errandsIntro }),
    // 記憶裡上次的消耗品，還沒在表裡的才出現；全加完這排就不見
    suggestions.length ? chips(L.lastConsumables, suggestions.map((s) => [s.for ? `${s.for}：${s.what}` : s.what, () => putRender((x) => ({ ...x, errands: [...x.errands, emptyErrand({ for: s.for, what: s.what, note: s.note, consumable: true })] }))])) : null,
    ...b.errands.map((e) => el('div', { class: 'brief-row errand' }, [
      field(L.errandFor, textInput(e.for, setRow(e.id, 'for'))),
      field(L.errandWhat, textInput(e.what, setRow(e.id, 'what'))),
      field(L.errandQty, textInput(e.qty, setRow(e.id, 'qty'), { inputmode: 'numeric' })),
      field(L.errandNote, textInput(e.note, setRow(e.id, 'note'))),
      checkbox(L.consumable, e.consumable, setRow(e.id, 'consumable')),
      delButton(() => putRender((x) => ({ ...x, errands: x.errands.filter((r) => r.id !== e.id) }))),
    ])),
    addButton(() => putRender((x) => ({ ...x, errands: [...x.errands, emptyErrand()] }))),
  ]);
}

// ---- §5 要辦的事 ----
function tasksSection(b, put, putRender) {
  const me = b.persons.find((p) => p.isMe) ?? b.persons[0];
  const whoOptions = [['', L.nobody], ...b.persons.map((p) => [p.id, p.name || (p.isMe ? L.meName : L.personUnnamed)])];
  const setRow = (id, k) => (v) => put((x) => ({ ...x, tasks: x.tasks.map((r) => (r.id === id ? { ...r, [k]: v } : r)) }));
  return el('section', { class: 'group' }, [
    el('h2', { text: L.s5 }),
    el('p', { class: 'muted small', text: L.tasksIntro }),
    ...b.tasks.map((t) => el('div', { class: 'brief-row task' }, [
      field(L.taskWhat, textInput(t.what, setRow(t.id, 'what')), 'wide'),
      field(L.taskDeadline, el('input', { type: 'datetime-local', value: t.deadline, onchange: (e) => setRow(t.id, 'deadline')(e.target.value) }), 'wide'),
      field(L.taskWho, select(t.who, whoOptions, setRow(t.id, 'who'), { class: 'who' })),
      delButton(() => putRender((x) => ({ ...x, tasks: x.tasks.filter((r) => r.id !== t.id) }))),
    ])),
    addButton(() => putRender((x) => ({ ...x, tasks: [...x.tasks, emptyTask({ who: me?.id ?? '' })] }))),
  ]);
}
