// 同行者（T19；profile §9、DESIGN §4）：需求單以人為單位（原話 #136「需求單應該以人為單位，預設是我，如果有同行者，就再新增一位同行者然後填他的需求」），
// 整趟的需求單跟個人需求單分開（原話 #147），兩人的「調整」衝突時「取輕鬆的，取不嚴的那個」（原話 #144）。
// 純函式：旅程檔 trip.persons[] → 那天在場的人（presentOn）→ 合併後的調整（mergeAdjustments：stamina、nightSlot、avoidCategories）；
// 沒有 persons 的旅程檔從 trip.party 合成（他一段＋ party−1 段匿名同行者、預設調整），行為跟只有 party 時一模一樣（party 2 → 步行預算 ×0.85）；
// 旅程檔沒 persons、而手機需求單的 city 與 dates 跟這趟對得上時，需求單的 persons 當覆蓋層（stamina／nightSlot 生效；「只同行哪幾天」partialDays 讀得懂的轉成 dates、
// 讀不懂的當整趟並在設定頁標出來（10-16 審查後：只同行一天的同學整趟都算在場、七天都 ×0.85，設定頁又看不出來）；dislikes 是給人看的文字、不轉）。
// 旅程檔有 persons 就以旅程檔為準（打包檔是真相，原話 #154）。
// 人之間取最鬆（#144）：stamina easy > normal > hard、nightSlot none > less > default；avoidCategories 取聯集（推導：「個人不要的店型不排」是每個人的否決，不是鬆緊）。
// 日型之間的倍率仍取最嚴（#128，rules/_helpers.js budgetMultiplier）：兩條不衝突——日型之間取最嚴、人之間取最鬆。
import { CATEGORIES, classifyCategory } from '../data/schema.js';
import { STAMINAS, NIGHT_SLOTS, ME_ID } from '../data/brief.js';
import { TEXT, CATEGORY } from '../ui/text.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v);
const str = (v) => (typeof v === 'string' ? v.trim() : '');
const validDates = (list) => [...new Set((Array.isArray(list) ? list : []).filter((d) => typeof d === 'string' && DATE_RE.test(d)))].sort();

const ymd = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
/** y/m/d 真的是一天（2/30 不是）→ 'YYYY-MM-DD'，不是回 null。 */
function realDate(y, m, d) {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? ymd(y, m, d) : null;
}
const DAY_MS = 86400000;
const dayOf = (date) => Date.UTC(...date.split('-').map((x, i) => (i === 1 ? Number(x) - 1 : Number(x))));
const DATE_TOKEN = /^(?:(\d{4})\/)?(\d{1,2})\/(\d{1,2})$/;

/**
 * 需求單「只同行哪幾天」的自由文字 → 日期（10-16 審查後補；需求單頁的例子是「例：8/14–16」，需求單頁不改）。
 * 讀得懂：8/14、8/14–16、8/14–8/16、8/13、8/15（頓號、逗號、分號、空白分開）、8月14日、2026-08-14、8/14 起（到最後一天）、到 8/15（從第一天）；年取旅程那年（跨年的旅程挑落在旅程裡的那年）。
 * 回 []＝沒寫（整趟）；回 null＝寫了但讀不懂（呼叫端當整趟、設定頁標出來；不猜——「8/14 之後」只拿到 8/14 比整趟更錯）。
 */
export function parsePartialDays(text, tripDates = []) {
  const raw = str(text);
  if (!raw) return [];
  const span = validDates(tripDates);
  const first = span[0] ?? null; const last = span[span.length - 1] ?? null;
  const years = [...new Set(span.map((d) => Number(d.slice(0, 4))))];
  if (!years.length) years.push(new Date().getUTCFullYear());
  const s = raw
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/／/g, '/')
    .replace(/(\d{4})[-./年]\s*(\d{1,2})[-./月]\s*(\d{1,2})\s*(?:日|號)?/g, '$1/$2/$3')   // 2026-08-14、2026年8月14日 → 2026/8/14
    .replace(/(\d{1,2})\s*月\s*(\d{1,2})/g, '$1/$2').replace(/(\d)\s*(?:日|號)/g, '$1')   // 8月14日、8月14–16日 → 8/14、8/14–16
    .replace(/((?:\d{4}\/)?\d{1,2}\/\d{1,2})\s*(?:起|開始|之後|以後|後)/g, '$1–')   // 8/14 起 → 8/14–（到最後一天）
    .replace(/((?:\d{4}\/)?\d{1,2}\/\d{1,2})\s*(?:為止|以前|之前|前|止)/g, '–$1')   // 8/15 前 → –8/15（從第一天）
    .replace(/\s*(?:–|—|−|－|-|~|〜|～|到|至)\s*/g, '–');
  const resolve = (y, m, d) => {
    if (y) return realDate(y, m, d);
    const cands = years.map((yy) => realDate(yy, m, d)).filter(Boolean);
    return cands.find((c) => first && last && c >= first && c <= last) ?? cands[0] ?? null;
  };
  const parseDate = (tok) => { const m = tok.match(DATE_TOKEN); return m ? resolve(m[1] ? Number(m[1]) : null, Number(m[2]), Number(m[3])) : null; };
  const out = new Set();
  const addRange = (from, to) => {
    if (!from || !to || from > to || (dayOf(to) - dayOf(from)) / DAY_MS > 400) return false;
    for (let t = dayOf(from); t <= dayOf(to); t += DAY_MS) { const x = new Date(t); out.add(ymd(x.getUTCFullYear(), x.getUTCMonth() + 1, x.getUTCDate())); }
    return true;
  };
  for (const tok of s.split(/[、,，;；\s]+/).filter(Boolean)) {
    const parts = tok.split('–');
    if (parts.length === 1) { const d = parseDate(tok); if (!d) return null; out.add(d); continue; }
    if (parts.length !== 2) return null;
    const [a, b] = parts;
    if (a && !b) { if (!last || !addRange(parseDate(a), last)) return null; continue; }   // 8/14–：到最後一天
    if (!a && b) { if (!first || !addRange(first, parseDate(b))) return null; continue; }   // –8/15：從第一天
    const from = parseDate(a);
    // 右邊只寫日（8/14–16）：跟左邊同年同月
    const to = /^\d{1,2}$/.test(b) ? (from ? resolve(Number(from.slice(0, 4)), Number(from.slice(5, 7)), Number(b)) : null) : parseDate(b);
    if (!addRange(from, to)) return null;
  }
  return [...out].sort();
}

/**
 * 旅程檔 persons[] 的一段 → 規範形狀 { id, name, isMe, dates[]（空＝整趟）, partialDays, datesUnread, adjustments: { stamina, nightSlot, dislikes, avoidCategories[] }, source }。
 * dates 沒有、只寫了 partialDays（需求單的自由文字）就用 parsePartialDays 轉；讀不懂的 dates 空（整趟）、datesUnread true（設定頁那行標出來）。
 * avoidCategories 要是店型鍵（schema.js CATEGORIES）；寫成中文（溫泉、神社）照知識庫店型的對照表翻（跟 themeCategoryOf 同一張），翻不出的丟掉、記整趟警告 person-avoid-unknown（總則 0）。
 * source 'brief'（需求單覆蓋層）：avoidCategories 一律空——dislikes 是文字，不轉。
 */
function normalizePerson(raw, { isMe, fallbackId, source, warnings, tripDates }) {
  const p = isObj(raw) ? raw : {};
  const adj = isObj(p.adjustments) ? p.adjustments : {};
  const name = str(p.name);
  const partialDays = str(p.partialDays);
  const explicit = validDates(p.dates);
  const parsed = explicit.length || !partialDays ? explicit : parsePartialDays(partialDays, tripDates);
  const avoid = [];
  if (source !== 'brief') {
    for (const raw of Array.isArray(adj.avoidCategories) ? adj.avoidCategories : []) {
      const key = CATEGORIES.includes(raw) ? raw : classifyCategory(raw).key;
      if (key === 'other' || !CATEGORIES.includes(key)) {
        if (Array.isArray(warnings)) warnings.push({ code: 'person-avoid-unknown', personId: str(p.id) || fallbackId, msg: `${name || (isMe ? TEXT.companions.me : TEXT.companions.unnamed)} 不想去的「${String(raw)}」看不出是哪一類店（寫溫泉、神社這種類別），這條先不管` });
        continue;
      }
      if (!avoid.includes(key)) avoid.push(key);
    }
  }
  return {
    id: str(p.id) || fallbackId,
    name,
    isMe,
    dates: parsed ?? [],
    partialDays,
    datesUnread: parsed === null,
    adjustments: {
      stamina: STAMINAS.includes(adj.stamina) ? adj.stamina : 'normal',
      nightSlot: NIGHT_SLOTS.includes(adj.nightSlot) ? adj.nightSlot : 'default',
      dislikes: str(adj.dislikes),
      avoidCategories: avoid,
    },
    source,
  };
}

/** 一串段落 → 他永遠在第一段（isMe；沒有人標 isMe 就當第一段是他）、id 不重複。tripDates 給 partialDays 補年。 */
function normalizePersons(list, source, warnings, tripDates) {
  const meIndex = Math.max(0, list.findIndex((p) => p?.isMe === true));
  const persons = list.map((p, i) => normalizePerson(p, { isMe: i === meIndex, fallbackId: i === meIndex ? ME_ID : `p${i}`, source, warnings, tripDates }));
  const [me] = persons.splice(meIndex, 1);
  const seen = new Set([me.id]);
  persons.forEach((p, i) => { if (seen.has(p.id)) p.id = `p${i + 1}`; seen.add(p.id); });
  return [me, ...persons];
}

const tripDatesOf = (trip) => (Array.isArray(trip?.days) ? trip.days.map((d) => d?.date) : []);

/** 打包檔的城市（pack.city → state.kb.city：{ id: 'sendai', name_zh: '仙台' }）也算這趟的名字：需求單寫 Sendai 也對得上。 */
export function cityNamesOf(kb) {
  const c = kb?.city;
  return isObj(c) ? [c.id, c.name_zh, c.name].filter((v) => typeof v === 'string' && v.trim()) : [];
}

/**
 * 手機需求單跟這趟對得上才當覆蓋層（避免拿上一趟的需求單）：city 的每一段（頓號、逗號分開）跟這趟的名字（trip.cityName／trip.city／trip.cityId、打包檔的 cityNames）
 * 一邊包含另一邊就算（10-16 審查後：之前只拿第一段做完全比對，「仙台市」「日本仙台」「仙台（宮城）」都對不上、覆蓋層靜靜不生效）；不分大小寫；
 * dates.from／to 對 trip.days 首尾；需求單要有 persons。
 */
export function briefApplies(trip, brief, cityNames = []) {
  if (!isObj(trip) || !isObj(brief) || !Array.isArray(brief.persons) || !brief.persons.length) return false;
  const days = Array.isArray(trip.days) ? trip.days : [];
  if (!days.length) return false;
  const norm = (v) => (typeof v === 'string' ? v.trim().toLowerCase() : '');
  const cities = str(brief.city).split(/[、,，/／]+/).map(norm).filter(Boolean);
  const names = [trip.cityName, trip.city, trip.cityId, ...(Array.isArray(cityNames) ? cityNames : [])].map(norm).filter(Boolean);
  const overlap = (a, b) => Math.min(a.length, b.length) >= 2 && (a.includes(b) || b.includes(a));   // 短的那邊至少兩個字：「台」不算對上「仙台」
  if (!cities.some((c) => names.some((n) => overlap(c, n)))) return false;
  return brief.dates?.from === days[0]?.date && brief.dates?.to === days[days.length - 1]?.date;
}

/**
 * personsOf(trip, brief = null, warnings = null, cityNames = []) → 這趟的人（persons[0] 是他）。
 * 來源依序：旅程檔 trip.persons[]（source 'trip'）→ 對得上的需求單 brief.persons[]（source 'brief'；cityNames 是打包檔的城市 id 與名字，cityNamesOf(kb)）
 * → 從 trip.party 合成（source 'party'：他＋ party−1 段匿名同行者、預設調整；party 缺或壞當 1）。
 * warnings 給了就把 avoidCategories 翻不出的記進去（planTrip 的整趟警告）。
 */
export function personsOf(trip, brief = null, warnings = null, cityNames = []) {
  const own = Array.isArray(trip?.persons) ? trip.persons.filter(isObj) : [];
  const tripDates = tripDatesOf(trip);
  if (own.length) return normalizePersons(own, 'trip', warnings, tripDates);
  if (briefApplies(trip, brief, cityNames)) return normalizePersons(brief.persons.filter(isObj), 'brief', warnings, tripDates);
  const party = Math.max(1, Math.floor(Number(trip?.party)) || 1);
  const list = [{ id: ME_ID, isMe: true }];
  for (let i = 1; i < party; i++) list.push({ id: `p${i}`, isMe: false });
  return normalizePersons(list, 'party', warnings, tripDates);
}

/** 那天在場的人：他永遠在；同行者 dates 空＝整趟、有 dates 只算那幾天。 */
export function presentOn(persons, date) {
  return (persons ?? []).filter((p) => p && (p.isMe || !p.dates?.length || p.dates.includes(date)));
}

/**
 * 合併在場的人的調整（原話 #144 取不嚴的）：stamina 有人 easy 就 easy、否則有人 normal 就 normal、全 hard 才 hard（沒人＝normal）；
 * nightSlot 有人 none 就 none、否則有人 less 就 less、否則 default；avoidCategories 取聯集（推導），avoidBy 記每個店型是誰不想去（畫面那句用）。
 * 回 { stamina, nightSlot, avoidCategories[], avoidBy: { [category]: [person] } }。
 */
export function mergeAdjustments(persons) {
  const list = (persons ?? []).filter(Boolean);
  const staminas = list.map((p) => (STAMINAS.includes(p.adjustments?.stamina) ? p.adjustments.stamina : 'normal'));
  const nights = list.map((p) => (NIGHT_SLOTS.includes(p.adjustments?.nightSlot) ? p.adjustments.nightSlot : 'default'));
  const stamina = staminas.includes('easy') ? 'easy' : staminas.includes('normal') || !staminas.length ? 'normal' : 'hard';
  const nightSlot = nights.includes('none') ? 'none' : nights.includes('less') ? 'less' : 'default';
  const avoidBy = {};
  for (const p of list) for (const c of p.adjustments?.avoidCategories ?? []) if (CATEGORIES.includes(c)) avoidBy[c] = [...(avoidBy[c] ?? []), p];
  return { stamina, nightSlot, avoidCategories: Object.keys(avoidBy), avoidBy };
}

/** 這家店是不是在場的人不想去的店型（看 category 與 alsoCategories）：引擎自己插的站（恢復站、填站、順路站、坐下來的地方、現場改案的池——累了、硬時限受威脅）與走廊清單都不拿；「換一家」不同店型的候選也不列。 */
export function personAvoids(adjust, poi) {
  const avoid = adjust?.avoidCategories;
  if (!Array.isArray(avoid) || !avoid.length || !poi) return false;
  return avoid.includes(poi.category) || (Array.isArray(poi.alsoCategories) && poi.alsoCategories.some((c) => avoid.includes(c)));
}

/** 畫面上這個人叫什麼：他自己是「你」（提示那句的主詞）、同行者用名字、沒名字寫「同行者」。 */
function personLabel(p) {
  return p?.isMe ? TEXT.companions.you : (p?.name || TEXT.companions.unnamed);
}

/**
 * 他勾的站是在場的人不想去的店型：照排（總則 3 指定行程凌駕偏好），但那站多一條提示 { ruleId: 'person-avoid', code: 'person-avoid', hint: true, poiId, msg }——
 * 不進規則檔、不罰分，跟 leg-suggest 同一種後處理（trip.js planTrip 每天排完掛、applied.js 現場改案重算也掛）。引擎插的站不會是這些店型（池已過濾），不出。
 */
export function personAvoidWarnings(sequence, adjust) {
  const by = adjust?.avoidBy ?? {};
  const out = [];
  for (const s of sequence ?? []) {
    if (!s?.poi || s.insertedBy) continue;
    const cats = [s.poi.category, ...(Array.isArray(s.poi.alsoCategories) ? s.poi.alsoCategories : [])].filter((c) => by[c]?.length);
    if (!cats.length) continue;
    const who = [...new Set(cats.flatMap((c) => by[c]).map(personLabel))].join('、');
    const what = [...new Set(cats.map((c) => CATEGORY[c] ?? c))].join('、');
    out.push({ ruleId: 'person-avoid', code: 'person-avoid', hint: true, poiId: s.poi.id, msg: TEXT.personAvoid(who, what) });
  }
  return out;
}
