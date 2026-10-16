// 需求單（docs/brief-template.md v2：整趟一份骨架＋要辦的事、每人一段要去的／要買的／調整、代購是別人的；原話 #136、#147）的純資料層：
// 空單、容錯讀入（舊版或手打的 JSON 也讀得出一份合法的單子，總則 0）、輸出成研究要讀的文字。不碰 DOM。
// 清單欄位（要去的、一定要吃到的、要買的、例外品牌）畫面上是一行一項的 textarea，資料存陣列。
import { TEXT } from '../ui/text.js';

export const BRIEF_VERSION = 1;
export const PURPOSES = ['play', 'work'];
export const MODES = ['transit', 'car', 'moto'];
export const THEME_DAY_CATEGORIES = ['vintage', 'record', 'cafe'];
export const GO_THEMES = ['sakura', 'momiji', 'snow', 'matsuri', 'hanabi'];
export const STAMINAS = ['normal', 'easy', 'hard'];
export const NIGHT_SLOTS = ['default', 'less', 'none'];
export const ME_ID = 'me';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const HM_RE = /^\d{2}:\d{2}$/;
const DEADLINE_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/;   // datetime-local 的值；手打只寫日期也收

// 手打 JSON 常直接寫中文：畫面文字反查回鍵值
const flip = (labels) => Object.fromEntries(Object.entries(labels).map(([k, v]) => [v, k]));
const ALIASES = {
  purpose: { ...flip(TEXT.brief.purposes), '公務': 'work' },
  mode: { ...flip(TEXT.brief.modes), '自駕': 'car', '開車': 'car' },
  themeDay: { ...flip(TEXT.brief.themeCategories), '古著店': 'vintage', '唱片': 'record', '咖啡': 'cafe' },
  stamina: flip(TEXT.brief.staminas),
  nightSlot: { ...flip(TEXT.brief.nightSlots), '每晚': 'default' },
  goTheme: flip(TEXT.brief.themeList),
};

export function newId(prefix) { return `${prefix}-${Math.random().toString(36).slice(2, 8)}`; }

export function emptyPerson({ id = newId('p'), name = '', isMe = false } = {}) {
  return {
    id, name, isMe,
    partialDays: '',   // 只同行部分天數就寫哪幾天（brief-template §1 同行者列；空＝整趟）；他自己那段用不到、畫面不出
    go: { designated: [], mustEat: [], themes: [], themeOther: '' },
    buy: { own: [], brandExceptions: [] },
    adjustments: { stamina: 'normal', nightSlot: 'default', dislikes: '' },
  };
}
export function emptyErrand(patch = {}) { return { id: newId('e'), for: '', what: '', qty: '', note: '', consumable: false, ...patch }; }
export function emptyTask(patch = {}) { return { id: newId('t'), what: '', deadline: '', who: '', ...patch }; }
export function emptyFixedWindow() { return { date: '', startHM: '', endHM: '', label: '' }; }
export function emptyThemeDay() { return { date: '', category: 'vintage' }; }

/** 一份空的需求單：預設只有他一段（persons[0]，isMe）。 */
export function emptyBrief() {
  return {
    version: BRIEF_VERSION,
    city: '',
    dates: { from: '', to: '' },
    flights: { arriveHM: '', departHM: '' },
    lodging: '',
    purpose: 'play',
    workNote: '',
    fixedWindows: [],
    mode: 'transit',
    modeNote: '',
    dayTrips: { count: null, direction: '' },
    themeDays: [],
    departureNote: '',
    persons: [emptyPerson({ id: ME_ID, name: TEXT.brief.meName, isMe: true })],
    errands: [],
    tasks: [],
    updatedAt: '',
  };
}

const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v);
const arr = (v) => (Array.isArray(v) ? v : []);
const str = (v) => (typeof v === 'string' ? v.trim() : '');   // 自由文字：不是字串就丟掉那個值
const numStr = (v) => (typeof v === 'number' && Number.isFinite(v) ? String(v) : str(v));   // 數量：手打 2 也收
const matchRe = (v, re) => { const s = str(v); return re.test(s) ? s : ''; };
const oneOf = (v, list, aliases, fallback) => { const s = str(v); return list.includes(s) ? s : (aliases[s] ?? fallback); };
const count = (v) => { const n = typeof v === 'string' ? Number.parseInt(v, 10) : v; return Number.isInteger(n) && n >= 0 ? n : null; };

/** 清單欄位：陣列（只留字串、去空白）或一段文字（一行一項）都讀。 */
export function toList(v) {
  const list = Array.isArray(v) ? v : typeof v === 'string' ? v.split(/\r?\n/) : [];
  return list.filter((x) => typeof x === 'string').map((x) => x.trim()).filter(Boolean);
}

function normalizePerson(raw, { isMe, fallbackId }) {
  const p = isObj(raw) ? raw : {};
  const go = isObj(p.go) ? p.go : {};
  const buy = isObj(p.buy) ? p.buy : {};
  const adj = isObj(p.adjustments) ? p.adjustments : {};
  const themes = toList(go.themes).map((t) => (GO_THEMES.includes(t) ? t : ALIASES.goTheme[t])).filter(Boolean);
  return {
    id: str(p.id) || fallbackId || newId('p'),
    name: str(p.name),
    isMe,
    partialDays: str(p.partialDays),
    go: {
      // DESIGN §4 草案的 night[]、areas[]、recommended[] 併進 designated：他想到什麼寫什麼、研究來分（brief-template 原則三）
      designated: [...new Set([...toList(go.designated), ...toList(go.night), ...toList(go.areas), ...toList(go.recommended)])],
      mustEat: toList(go.mustEat),
      themes: [...new Set(themes)],
      themeOther: str(go.themeOther),
    },
    buy: { own: toList(buy.own), brandExceptions: toList(buy.brandExceptions) },
    adjustments: {
      stamina: oneOf(adj.stamina, STAMINAS, ALIASES.stamina, 'normal'),
      nightSlot: oneOf(adj.nightSlot, NIGHT_SLOTS, ALIASES.nightSlot, 'default'),
      dislikes: str(adj.dislikes),
    },
  };
}

/** persons[]：他永遠在第一段（isMe）、沒名字就叫「我」；舊版（go／buy／adjustments 在頂層、party.designated 是同行者要去的）翻成一段一段。 */
function normalizePersons(r) {
  let list = arr(r.persons).filter(isObj);
  if (!list.length && (isObj(r.go) || isObj(r.buy) || isObj(r.adjustments))) {
    list = [{ id: ME_ID, isMe: true, go: r.go, buy: r.buy, adjustments: r.adjustments }];
    const partyGo = isObj(r.party) ? toList(r.party.designated) : [];
    if (partyGo.length) list.push({ go: { designated: partyGo } });
  }
  if (!list.length) return [emptyPerson({ id: ME_ID, name: TEXT.brief.meName, isMe: true })];
  const meIndex = Math.max(0, list.findIndex((p) => p.isMe === true));
  const persons = list.map((p, i) => normalizePerson(p, { isMe: i === meIndex, fallbackId: i === meIndex ? ME_ID : undefined }));
  const [me] = persons.splice(meIndex, 1);
  if (!me.name) me.name = TEXT.brief.meName;
  const seen = new Set([me.id]);
  for (const p of persons) { if (seen.has(p.id)) p.id = newId('p'); seen.add(p.id); }
  return [me, ...persons];
}

function uniqueIds(rows, prefix) {
  const seen = new Set();
  for (const row of rows) { if (!row.id || seen.has(row.id)) row.id = newId(prefix); seen.add(row.id); }
  return rows;
}

/** 任何東西都讀得出一份合法的需求單：缺欄位補預設、型別錯就丟掉那個值；舊版草案（DESIGN §4 的 go／buy／party／adjustments）也翻得過來。 */
export function normalizeBrief(raw) {
  const r = isObj(raw) ? raw : {};
  const dates = isObj(r.dates) ? r.dates : {};
  const flights = isObj(r.flights) ? r.flights : {};
  const legacyAdj = isObj(r.adjustments) ? r.adjustments : {};   // 草案把 dayTrips、departureNote 放在 adjustments
  const dayTrips = isObj(r.dayTrips) ? r.dayTrips : { count: r.dayTrips ?? legacyAdj.dayTrips, direction: '' };
  const persons = normalizePersons(r);
  const personIds = new Set(persons.map((p) => p.id));
  const idByName = new Map(persons.filter((p) => p.name).map((p) => [p.name, p.id]));
  const errandsRaw = Array.isArray(r.errands) ? r.errands : isObj(r.party) ? arr(r.party.errands) : [];
  const tasksRaw = arr(r.tasks).map((t) => (typeof t === 'string' ? { what: t } : t)).filter(isObj);
  return {
    version: BRIEF_VERSION,
    city: str(r.city),
    dates: { from: matchRe(dates.from, DATE_RE), to: matchRe(dates.to, DATE_RE) },
    flights: { arriveHM: matchRe(flights.arriveHM, HM_RE), departHM: matchRe(flights.departHM, HM_RE) },
    lodging: str(r.lodging),
    purpose: oneOf(r.purpose, PURPOSES, ALIASES.purpose, 'play'),
    workNote: str(r.workNote),
    fixedWindows: arr(r.fixedWindows).filter(isObj).map((w) => ({ date: matchRe(w.date, DATE_RE), startHM: matchRe(w.startHM, HM_RE), endHM: matchRe(w.endHM, HM_RE), label: str(w.label) })),
    mode: oneOf(r.mode, MODES, ALIASES.mode, 'transit'),
    modeNote: str(r.modeNote) || str(r.routeIdea),
    dayTrips: { count: count(dayTrips.count), direction: str(dayTrips.direction) },
    // 主題日的類別就是那天的排程指令（整天逛那一類）：沒寫補預設（第一個選項，跟畫面新增一列一樣）；寫了但認不得（例如「書店」）整列丟掉，不默默變成古著
    themeDays: arr(r.themeDays).filter(isObj).map((t) => ({ date: matchRe(t.date, DATE_RE), category: t.category == null || t.category === '' ? 'vintage' : oneOf(t.category, THEME_DAY_CATEGORIES, ALIASES.themeDay, null) })).filter((t) => t.category),
    departureNote: str(r.departureNote) || str(legacyAdj.departureNote),
    persons,
    errands: uniqueIds(errandsRaw.filter(isObj).map((e) => ({ id: str(e.id), for: str(e.for), what: str(e.what), qty: numStr(e.qty), note: str(e.note), consumable: e.consumable === true })), 'e'),
    tasks: uniqueIds(tasksRaw.map((t) => { const who = str(t.who); return { id: str(t.id), what: str(t.what), deadline: matchRe(t.deadline, DEADLINE_RE), who: personIds.has(who) ? who : (idByName.get(who) ?? '') }; }), 't'),
    updatedAt: typeof r.updatedAt === 'string' && !Number.isNaN(Date.parse(r.updatedAt)) ? r.updatedAt : '',
  };
}

// 「從檔案載入」的門檻：normalizeBrief 對任何物件都回得出一份單（認不得的全丟＝空單），所以選錯檔（旅程檔、打包檔、{}）不能靠它擋——
// 設定頁的打包檔按鈕也叫「從檔案載入」，同一支手機的下載夾兩種 .json 並存。需求單的頂層鍵（現在的欄位＋DESIGN §4 草案的 go／buy／party／adjustments）
// 至少要有一個，而且不能帶旅程檔或打包檔的鍵。
const BRIEF_KEYS = ['version', 'city', 'dates', 'flights', 'lodging', 'purpose', 'workNote', 'fixedWindows', 'mode', 'modeNote', 'dayTrips', 'themeDays', 'departureNote', 'persons', 'errands', 'tasks', 'updatedAt', 'go', 'buy', 'party', 'adjustments', 'routeIdea', 'holiday'];
const FOREIGN_KEYS = ['days', 'homeBases', 'pois', 'zones', 'walk', 'trip'];   // 旅程檔（days、homeBases）與打包檔（pois、zones、walk、trip）才有的鍵
export function looksLikeBrief(raw) {
  if (!isObj(raw)) return false;
  if (FOREIGN_KEYS.some((k) => k in raw)) return false;
  return BRIEF_KEYS.some((k) => k in raw);
}

/** 這份單子跟空單一樣（updatedAt 不算）：載入或清空前用它決定要不要留一份給「復原上一份」。 */
export function isBriefEmpty(brief) {
  return JSON.stringify({ ...normalizeBrief(brief), updatedAt: '' }) === JSON.stringify({ ...emptyBrief(), updatedAt: '' });
}

/** 存成檔案的檔名：brief-<城市（第一個；多字的城市名空白換成 -）>-<起日>.json；沒填的寫「未填」。 */
export function briefFileName(brief) {
  const city = str(brief?.city).split(/[、,，/]+/)[0].trim().replace(/\s+/g, '-') || TEXT.brief.unset;
  const from = str(brief?.dates?.from) || TEXT.brief.unset;
  return `brief-${city}-${from}.json`.replace(/[\\/:*?"<>|]/g, '-');
}

// 表格的格子：直欄線換成全形、換行換成空白，不然 md 表會散掉
const cell = (s) => String(s ?? '').replace(/\|/g, '｜').replace(/\r?\n/g, ' ');
const bullets = (list) => (list.length ? list.map((x) => `  - ${x}`) : ['  -']);

function personSection(p, n) {
  const L = TEXT.brief; const M = L.md;
  const themeLine = [
    ...GO_THEMES.map((t) => `${p.go.themes.includes(t) ? '☑' : '☐'} ${L.themeList[t]}`),
    `${p.go.themeOther ? '☑' : '☐'} ${M.themeOther}：${p.go.themeOther || '＿＿'}`,
  ].join(' ');
  return [
    `### ${M.goHead(n)}`, '',
    `- ${M.go}：`, ...bullets(p.go.designated),
    `- ${M.mustEat}：`, ...bullets(p.go.mustEat),
    `- ${M.themes}：${themeLine}`, '',
    `### ${M.buyHead(n)}`, '',
    `- ${M.buyOwn}：`, ...bullets(p.buy.own),
    `- ${M.brandExceptions}：`, ...bullets(p.buy.brandExceptions), '',
    `### ${M.adjustHead(n)}`, '',
    `| ${M.table[0]} | ${M.table[1]} |`, '|---|---|',
    `| ${M.stamina} | ${L.staminas[p.adjustments.stamina]} |`,
    `| ${M.nightSlot} | ${L.nightSlots[p.adjustments.nightSlot]} |`,
    `| ${M.dislikes} | ${cell(p.adjustments.dislikes)} |`, '',
  ];
}

/** 照 docs/brief-template.md 的標題與段落順序輸出；空的欄位留空、列不省略——這份文字是研究 workflow 的輸入。 */
export function briefToMarkdown(input) {
  const b = normalizeBrief(input);
  const L = TEXT.brief; const M = L.md;
  const me = b.persons.find((p) => p.isMe) ?? b.persons[0];
  const companions = b.persons.filter((p) => p !== me);
  const nameOf = (p) => p.name || M.blank;   // 沒填名字就照模板的空格「＿＿」，不印成「同行者：同行者」
  const byId = new Map(b.persons.map((p) => [p.id, p]));
  const lines = [`# ${M.title}`, ''];
  if (b.updatedAt) lines.push(`${M.updatedAt}${b.updatedAt}`, '');
  lines.push(`## ${L.s1}`, '', `| ${M.table[0]} | ${M.table[1]} |`, '|---|---|');
  const row = (k, v) => lines.push(`| ${k} | ${cell(v)} |`);
  row(M.city, b.city);
  row(M.dates, b.dates.from || b.dates.to ? `${b.dates.from || M.blank}–${b.dates.to || M.blank}` : '');
  row(M.flights, [b.flights.arriveHM && `${L.arriveHM} ${b.flights.arriveHM}`, b.flights.departHM && `${L.departHM} ${b.flights.departHM}`].filter(Boolean).join('、'));
  row(M.lodging, b.lodging);
  row(M.companions, companions.map((c) => `${nameOf(c)}${c.partialDays ? `（${c.partialDays}）` : ''}`).join('、'));
  row(M.purpose, b.purpose === 'work' ? `${L.purposes.work}${b.workNote ? `：${b.workNote}` : ''}` : L.purposes.play);
  row(M.fixedWindows, b.fixedWindows.map((w) => [w.date, w.startHM && w.endHM ? `${w.startHM}–${w.endHM}` : (w.startHM || w.endHM), w.label].filter(Boolean).join(' ')).join('；'));
  row(M.mode, `${L.modes[b.mode]}${b.modeNote ? `：${b.modeNote}` : ''}`);
  row(M.dayTrips, b.dayTrips.count != null ? M.dayTripsLine(b.dayTrips.count, b.dayTrips.direction) : b.dayTrips.direction);
  row(M.themeDays, b.themeDays.map((t) => [t.date, L.themeCategories[t.category]].filter(Boolean).join(' ')).join('；'));
  row(M.departureNote, b.departureNote);
  lines.push('', `## ${L.s2}`, '', ...personSection(me, 2));
  if (companions.length) for (const c of companions) lines.push(`## ${M.companionHead(nameOf(c))}`, '', ...personSection(c, 3));
  else lines.push(`## ${L.s3}`, '', M.noCompanion, '');
  lines.push(`## ${L.s4}`, '', `| ${M.errandsTable.join(' | ')} |`, '|---|---|---|---|---|');
  if (b.errands.length) for (const e of b.errands) lines.push(`| ${cell(e.for)} | ${cell(e.what)} | ${cell(e.qty)} | ${cell(e.note)} | ${e.consumable ? M.yes : ''} |`);
  else lines.push('| | | | | |');
  lines.push('', `## ${L.s5}`, '');
  if (b.tasks.length) {
    for (const t of b.tasks) {
      const who = byId.get(t.who);
      const extra = [t.deadline && M.deadline(t.deadline), who && M.who(nameOf(who))].filter(Boolean);
      lines.push(`- ${t.what || M.blank}${extra.length ? `（${extra.join('；')}）` : ''}`);
    }
  } else lines.push('-');
  lines.push('');
  return lines.join('\n');
}
