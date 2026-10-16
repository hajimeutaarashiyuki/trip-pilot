// 需求單的記憶（原話 #87「可以有一個記憶的功能，像是睫毛膏和藥膏屬於消耗品，如果下一次去日本有人又跟我指名代購，那我就不用重新輸入一遍了」）：
// 存檔、複製、載入別份、清空需求單時，把代購裡勾了消耗品的（給誰、什麼、備註）與他自己「要買的」記下來；下一份需求單把還沒填進去的帶出來當建議。
// 同行者「要買的」不記：brief-template §3「這些不記進你的偏好檔、也不幫他另開一份」（10-16 審查後改，之前每個人的都記）。
// 存手機 localStorage（app.js，鍵 trip-pilot:brief-memory），不進旅程檔、不進打包。純資料，不碰 DOM。
export const MEMORY_VERSION = 1;

export function emptyMemory() { return { version: MEMORY_VERSION, consumables: [], ownItems: [] }; }

const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v);
const str = (v) => (typeof v === 'string' ? v.trim() : '');
// 同人同品項：大小寫與空白不算差異
const key = (s) => str(s).toLowerCase().replace(/\s+/g, ' ');
const at = (v) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? v : '');

export function normalizeMemory(raw) {
  const r = isObj(raw) ? raw : {};
  const consumables = (Array.isArray(r.consumables) ? r.consumables : []).filter(isObj)
    .map((c) => ({ for: str(c.for), what: str(c.what), note: str(c.note), lastAt: at(c.lastAt) })).filter((c) => c.what);
  const ownItems = (Array.isArray(r.ownItems) ? r.ownItems : []).filter(isObj)
    .map((o) => ({ what: str(o.what), lastAt: at(o.lastAt) })).filter((o) => o.what);
  return { version: MEMORY_VERSION, consumables, ownItems };
}

// 他那段：標 isMe 的，沒人標就第一段（跟 data/brief.js normalizePersons 的規則一樣）
const meOf = (brief) => { const persons = (Array.isArray(brief?.persons) ? brief.persons : []).filter(isObj); return persons.find((p) => p.isMe === true) ?? persons[0]; };
const ownOf = (brief) => (meOf(brief)?.buy?.own ?? []).filter((x) => typeof x === 'string');

/** 把這份需求單記進記憶：消耗品按（給誰＋什麼）、他自己要買的按品項，同一筆只留最新的（備註與時間蓋掉）。回新物件，不動傳進來的。 */
export function rememberFromBrief(memory, brief, now = new Date().toISOString()) {
  const m = normalizeMemory(memory);
  const consumables = [...m.consumables];
  for (const e of brief?.errands ?? []) {
    if (!isObj(e) || e.consumable !== true || !key(e.what)) continue;
    const entry = { for: str(e.for), what: str(e.what), note: str(e.note), lastAt: now };
    const i = consumables.findIndex((c) => key(c.for) === key(entry.for) && key(c.what) === key(entry.what));
    if (i >= 0) consumables[i] = entry; else consumables.push(entry);
  }
  const ownItems = [...m.ownItems];
  for (const what of ownOf(brief)) {
    if (!key(what)) continue;
    const entry = { what: str(what), lastAt: now };
    const i = ownItems.findIndex((o) => key(o.what) === key(what));
    if (i >= 0) ownItems[i] = entry; else ownItems.push(entry);
  }
  return { version: MEMORY_VERSION, consumables, ownItems };
}

/** 記憶裡還沒在這份需求單裡的：消耗品看（給誰＋什麼）有沒有在代購表，要買的看有沒有在他自己的「要買的」（按鈕只出現在他那段、也只加進他那段）。最近的排前面。 */
export function suggestionsFor(memory, brief) {
  const m = normalizeMemory(memory);
  const inErrands = new Set((brief?.errands ?? []).filter(isObj).map((e) => `${key(e.for)}|${key(e.what)}`));
  const inOwn = new Set(ownOf(brief).map(key));
  const newestFirst = (a, b) => b.lastAt.localeCompare(a.lastAt);
  return {
    consumables: m.consumables.filter((c) => !inErrands.has(`${key(c.for)}|${key(c.what)}`)).sort(newestFirst),
    ownItems: m.ownItems.filter((o) => !inOwn.has(key(o.what))).sort(newestFirst),
  };
}
