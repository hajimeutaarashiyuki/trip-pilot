// 走廊清單「升級成站」＝安插的畫面邏輯（11-06 第二批；主控 11-06 定的落地 A）。原話：
// #192「順路站 升級成站時 不應該把原本的行程刪掉 應該是安插進來」
// #193「還有選項沒有簡介」
// #194「當然安插進來後 會壓縮到後面的行程 那就再跳一組選項問我 要壓縮哪個行程或是砍掉」
// 這裡只有純函式（可測，不碰 DOM）：試算的參數、按了之後走哪一步（直接套／問他／再問一輪）、復原列與選項上的字。
// 試算與套進旅程檔在 engine/insert.js（insertTrial、applyInsert）；寫回 state 在 app.js（upgradeCorridor、pickInsertOption）；畫在 planner.js（insertAskNode）。
import { insertTrial, INSERT_MAX_ROUNDS } from '../engine/insert.js';
import { resolveHome } from '../engine/trip.js';
import { TEXT, CATEGORY, introOf } from './text.js';
import { shortName } from './corridor.js';

const L = TEXT.insert;
const nameOfPoi = (poi) => shortName(poi?.name_zh ?? poi?.id ?? '');

/**
 * 試算的參數（engine/insert.js insertTrial）：那天畫面上的 plan 與 day、住宿、要插的店、插在第幾段（走廊清單掛在哪一段就是哪一段；0＝住宿→第一站）。
 * 那天沒排、知識庫沒有這家回 null。同一組參數在選項開著的期間重複用（再問一輪時 plan 要是同一份——任何重排都會把選項收掉，app.js replan）。
 */
export function trialArgs(state, date, poiId, legIndex) {
  const planned = state?.plans?.[date];
  const poi = state?.pois?.[poiId];
  if (!planned?.plan || !poi || !state.trip) return null;
  return { plan: planned.plan, day: planned.day, home: resolveHome(state.trip, date), poi, legIndex, legFn: state.legFn, rules: state.rules, settings: state.settings, country: state.country, kb: state.kb };
}

/**
 * 按了「升級成站」：先試算。回走哪一步——
 * { kind: 'none' }（輸入不成立：那家已經在這天的行程裡）｜{ kind: 'apply', result }（排得下，直接套）｜{ kind: 'ask', ask: { trial, chosen: [] } }（排不下，在那一家底下問他）。
 */
export function startInsert(args) {
  const trial = args ? insertTrial(args) : null;
  if (!trial) return { kind: 'none' };
  return trial.fits ? { kind: 'apply', result: trial } : { kind: 'ask', ask: { trial, chosen: [] } };
}

/**
 * 這是問他的第幾輪（1 起）：前面選過幾個還排不下的選項＋1。輪數由畫面數（engine 的 trial.round 是「套了幾個調整＋1」：
 * 先選某站少待、下一輪又選不去同一站時調整只算一個，拿它數的話會問超過三次）。
 */
export const askRound = (ask) => (ask?.chosen?.length ?? 0) + 1;

/**
 * 在選項裡選了一個：排得下 → 套（result＝那個選項，engine applyInsert 收）；還排不下 → 拿它當草稿再試算一輪（ask.chosen 累積選過的），
 * 最多問 INSERT_MAX_ROUNDS 輪（主控定三輪）——最後一輪畫面只列排得下的（askView），真的被叫到就原樣回。
 */
export function chooseInsertOption(args, ask, option) {
  if (!args || !ask?.trial || !option) return { kind: 'none' };
  if (option.fits) return { kind: 'apply', result: option };
  if (askRound(ask) >= INSERT_MAX_ROUNDS) return { kind: 'ask', ask };
  const next = insertTrial({ ...args, draft: option });
  if (!next) return { kind: 'none' };
  return next.fits ? { kind: 'apply', result: next } : { kind: 'ask', ask: { trial: next, chosen: [...ask.chosen, option] } };
}

/**
 * 這一版試算已經套了哪些調整（engine 的 result.adjust）→ 一句一句的字：「X 只待 190 分（原本 240 分）」「Y 少待 30 分（60→30）」「不去 Z」。
 * 同一站先少待、後來改成不去，engine 只留後面那一個。nameOf(poi id) → 店名（不去的那一站已經不在序列裡，要從知識庫查）。
 */
export function adjustLabels(result, nameOf = (id) => id, plan = null) {
  const r = result?.result ?? result;
  const short = dayNamer(r, plan, nameOf);
  return (r?.adjust ?? []).map((adj) => (adj.kind === 'drop' ? L.drop(short(adj.poiId)) : adj.poiId === r.poiId ? L.shortenNew(short(adj.poiId), adj.fromMin, adj.toMin) : L.shorten(short(adj.poiId), adj.fromMin, adj.toMin)));
}

/** 選項那顆鍵上的字：「X 只待 30 分（原本 60 分）」「Y 少待 20 分（60→40）」「不去 Z」。店名用短的（括號裡的研究註記拿掉），下面另有那一站的簡介。 */
export function optionLabel(o) {
  const name = nameOfPoi(o.poi);
  if (o.kind === 'drop') return L.drop(name);
  return o.kind === 'shorten-new' ? L.shortenNew(name, o.fromMin, o.toMin) : L.shorten(name, o.fromMin, o.toMin);
}

/**
 * 這一版試算跟畫面上那一版（plan＝試算用的那一份 plan）比，原本的站開始時刻最多提早幾分；沒有站提早、沒給 plan 都是 0。
 * 引擎的 shiftMaxMin 只算「最多晚幾分」：選了「不去某站」時後面的站是提早，之前照它寫成「其餘各站的時刻不變」
 * （11-12 畫面審查：七天包 8/13 插 FLAT WHITE 選「不去 喫茶 Elbe」，後面最多早 64 分）。
 */
export function earlyMaxMin(result, plan = null) {
  const r = result?.result ?? result;
  const was = new Map((plan?.sequence ?? []).map((s) => [s.poi.id, s.startMin]));
  return Math.max(0, ...(r?.sequence ?? []).filter((s) => was.has(s.poi.id)).map((s) => Math.round(was.get(s.poi.id) - s.startMin)));
}

/**
 * 選項的後果：排得下的寫順延幾分（沒有站變晚而有站提早就寫最多提早幾分；有站變晚、也有站提早就兩個都寫——選了「不去」中間某一站時，它前面的被新插的那家推晚、後面的提早）、
 * 用掉幾分留白；還排不下的寫還差幾分（不是差幾分鐘的事——同類家數、一天站數——就只說還排不下）。
 * plan＝試算用的那一份 plan（算提早幾分用；沒給就只看有沒有站變晚）。
 */
export function optionNote(o, plan = null) {
  if (!o.fits) return L.needMore(o.shortMin ?? null);
  const r = o.result;
  return L.fits(r.shiftMaxMin, Math.max(0, r.openSlotUsedMin - r.openSlotUsedBeforeMin), earlyMaxMin(r, plan));
}

/**
 * 排得下的選項套了之後會多出來的事（鍵上第三行，有才寫）：整天的黃字或提示（今天沒排晚餐、今晚沒排夜間站——不去某一站常常就是這個後果；
 * 掛在某一站上的黃字套完看站卡，這裡不列，最多寫兩句）、原本排不進而會跟著排進來的勾選站。nameOf(poi id) → 店名。
 */
export function optionAdds(o, nameOf = (id) => id) {
  if (!o.fits) return null;
  const r = o.result;
  const parts = [];
  const dayMsgs = [...new Set((r.newWarnings ?? []).filter((w) => !w.poiId && w.msg).map((w) => w.msg))];
  if (dayMsgs.length) parts.push(L.adds(dayMsgs.slice(0, 2).join('、')));
  if (r.revived?.length) parts.push(L.revives(r.revived.map((id) => shortName(nameOf(id))).join('、')));
  return parts.length ? parts.join('；') : null;
}

/**
 * 同一塊選項裡哪幾家店的短店名會撞名（Set of poi id）：兩家不同的店短名一樣、或一家的短名是另一家的開頭——括號裡的註記拿掉之後分不出來
 * （七天包 8/15：引擎排的「瑞鳳殿（伊達政宗靈屋）」與主行程「瑞鳳殿 盂蘭盆特別御開帳」短名是「瑞鳳殿」與「瑞鳳殿 盂蘭盆特別御開帳」；
 * 「松本清 仙台Clis Road店」與它的「（matsukiyoLAB型態店）」那一筆短名完全一樣）。撞名的兩家在選項上都寫全名。同一家店的兩個選項（少待與不去）不算。
 */
function clashingNames(pois) {
  const list = [...new Map(pois.filter((p) => p?.id).map((p) => [p.id, nameOfPoi(p)])).entries()];
  const out = new Set();
  for (const [a, x] of list) for (const [b, y] of list) if (a !== b && x && y && (x === y || y.startsWith(x))) { out.add(a); out.add(b); }
  return out;
}

/**
 * 這天的站裡短店名會撞名的店（Set of poi id）：畫面上那一版（plan，試算用的那一份）與這一版試算的序列（result）裡的每一站一起比（clashingNames）。
 * 選項那一列、「已選：…」那一行、套用後的復原列都用這一份（11-17 畫面審查：之前只有選項那一列看撞名、而且只比列出來的選項——
 * 七天包 8/15 同時有引擎排的「瑞鳳殿（伊達政宗靈屋）」與主行程「瑞鳳殿 盂蘭盆特別御開帳」，第二輪寫「已選：瑞鳳殿 少待 15 分」、套用後寫「不去 瑞鳳殿」，分不出是哪一個）。
 * 選了「不去」的那一站已經不在試算的序列裡，所以要連畫面上那一版一起看；沒給 plan 就只比試算的序列。
 */
function dayClash(result, plan = null) {
  const r = result?.result ?? result;
  return clashingNames([...(plan?.sequence ?? []), ...(r?.sequence ?? [])].map((s) => s?.poi));
}

/** (poi id) → 寫在句子裡的店名：短名（括號裡的研究註記拿掉），這天撞名的用全名（dayClash）。nameOf(poi id) → 全名。 */
function dayNamer(result, plan, nameOf) {
  const clash = dayClash(result, plan);
  return (id) => (clash.has(id) ? nameOf(id) : shortName(nameOf(id)));
}

/**
 * 那一家底下那組選項要畫的東西（ask＝{ trial, chosen }）：
 * { round, last, chosen: [已經套了的調整的字], why, prompt, groups: [{ key, head, rows }], fits: [列], more: [列], dead }
 * - round：問他的第幾輪（askRound）；last：最後一輪（INSERT_MAX_ROUNDS，主控定三輪）。
 * - chosen：前幾輪選下來、現在已經套著的調整（adjustLabels；第一輪是空的）。
 * - why：第一輪「插進 X 之後排不下：…（差 N 分）」、之後「還是排不下：…（還差 N 分）」。卡住的每一句（engine conflicts）都印、重複的只印一次——
 *   一站同時撞「超過關門」與「今天已經 8 站」時，決定要不要少去一站的是後面那一句。
 * - fits：選了就排得下的；more：選了還不夠、要再問一輪的（最後一輪不列——不能再問了）。
 * - groups：畫面照這個畫（11-17；主控定的版面，原話 #194「要壓縮哪個行程或是砍掉」的兩類）——「少待一點」（key 'shorten'：要插的這家自己少待放第一個，再來是後面某一站少待）
 *   與「這站不去」（key 'drop'）；組內照引擎給的先後（排得下的在前），某一組沒有選項就沒有那一組。之前是「排得下的／選了還不夠的」兩段、每顆鍵一整行粗體把動作與後果混在一起，
 *   390×844 上 28 組選項的高度中位數 1,122px、17 組超過一個螢幕（11-17 用當天重打的待套用版七天包重量，跟 11-12 量的相同）。
 * - 列＝{ option, label, name, mine, side, cat, engine, note, adds, intro }：
 *   name＝第一行粗體的店名（短名；同一塊裡撞名的用全名，clashingNames）；mine＝這是要插的這家（名字後面標「（要插的這家）」）；
 *   side＝右邊的重點，少待的寫「90 → 80 分」、不去的是 null；cat＝不去的那一站的店型（畫成小標）、少待的是 null；
 *   engine＝這一站是引擎排進來的（多一個小標「引擎排的」——他要挑犧牲誰的時候，這是依據）；
 *   note＝後果（optionNote）；adds＝選了會多出來的黃字與會跟著排進來的站（optionAdds，另起一行）；
 *   intro＝那一站的簡介（原話 #193；畫面收成兩行，完整的在那一站自己的卡上），要插的這家不重複附（它的簡介就在上面那一列）；
 *   label＝一句話講這個選項（「Y 少待 20 分（60→40）」「不去 Z」；已選那一行用同一種寫法）。
 * - dead：一個能選的都沒有＝這一段插不進這家，畫面只剩「算了，不插」。
 * - prompt：第一輪沒有任何一個選了就排得下的選項時寫「單選一項不夠：先選一項，下一輪再調…」（每顆鍵都寫「還差 N 分，要再調一項」，上面不能還寫「選一個讓它排得下」）。
 * plan（選填）＝試算用的那一份 plan：選項的後果要寫「後面最多提早幾分」時拿它比（optionNote）。
 */
export function askView(ask, nameOf = (id) => id, plan = null) {
  const { trial } = ask;
  const round = askRound(ask);
  const last = round >= INSERT_MAX_ROUNDS;
  const msgs = [...new Set((trial.conflicts ?? []).map((c) => c.msg).filter(Boolean))].join('；');
  const short = trial.blocked?.shortMin;
  const x = nameOfPoi(trial.sequence?.[trial.index]?.poi);
  const why = round > 1 ? `${L.still(msgs)}${short != null ? L.stillShort(short) : ''}` : `${L.why(x, msgs)}${short != null ? L.short(short) : ''}`;
  const shown = (trial.options ?? []).filter((o) => o.fits || !last);   // 照引擎給的先後；最後一輪只留選了就排得下的
  // 撞名：這一塊列出來的選項彼此比，再加上這天的每一站（dayClash）——另一個同名的站不在選項裡、但在這天的行程裡，照樣要寫全名
  const clash = new Set([...clashingNames(shown.map((o) => o.poi)), ...dayClash(trial, plan)]);
  const engineIds = new Set((trial.sequence ?? []).filter((s) => s?.insertedBy === 'engine' && s.poi?.id).map((s) => s.poi.id));
  const row = (o) => {
    const drop = o.kind === 'drop';
    const mine = o.kind === 'shorten-new';
    return {
      option: o, label: optionLabel(o),
      name: clash.has(o.poi?.id) ? (o.poi.name_zh ?? o.poi.id) : nameOfPoi(o.poi), mine,
      side: drop ? null : L.dwellChange(o.fromMin, o.toMin), cat: drop ? (CATEGORY[o.poi?.category] ?? null) : null, engine: engineIds.has(o.poiId),
      note: optionNote(o, plan), adds: optionAdds(o, nameOf), intro: mine ? null : introOf(o.poi),
    };
  };
  const rows = shown.map(row);
  const fits = rows.filter((r) => r.option.fits);
  const more = rows.filter((r) => !r.option.fits);
  const shorten = [...rows.filter((r) => r.mine), ...rows.filter((r) => !r.mine && r.option.kind !== 'drop')];
  const drops = rows.filter((r) => r.option.kind === 'drop');
  const groups = [{ key: 'shorten', head: L.groupShorten, rows: shorten }, { key: 'drop', head: L.groupDrop, rows: drops }].filter((g) => g.rows.length);
  const dead = !rows.length;
  const prompt = dead ? (round > 1 ? L.deadLater : L.dead) : last ? L.pickLast : round > 1 ? L.pickMore(round, INSERT_MAX_ROUNDS) : fits.length ? L.pick : L.pickNone;
  return { round, last, chosen: adjustLabels(trial, nameOf, plan), why, prompt, groups, fits, more, dead };
}

/**
 * 套完之後頂端復原列那一句（result＝排得下的試算結果，或選好的那個選項）：
 * 「已把 X 插在 A 和 B 之間，後面順延 N 分（用掉留白 M 分）」，有別的事再用分號接：「；Y 少待 20 分（60→40）；不去 Z；F 縮短成 15 分；原本排不進的 W 也排進來了」。
 * 插在最前面寫「排成第一站（B 之前）」、最後面寫「接在 A 之後」。調整（少待、不去）是他在選項裡選的；縮短的是讓位的填站（engine shrunk）。nameOf(poi id) → 店名。
 * plan（選填）＝試算用的那一份 plan：沒有站變晚、卻有站提早時（選了「不去某站」）寫「後面最多提早 N 分」，不寫「其餘各站的時刻不變」。
 */
export function insertDoneText(result, nameOf = (id) => id, plan = null) {
  const r = result?.result ?? result;
  // 店名：短名，這天撞名的用全名（dayClash；跟選項那一列、「已選」那一行同一套）。插的那家、前後兩站拿 POI 自己的名字，其餘（調整、縮短、排進來的）拿 nameOf 查
  const clash = dayClash(r, plan);
  const ofPoi = (poi) => (poi?.id && clash.has(poi.id) ? (poi.name_zh ?? poi.id) : nameOfPoi(poi));
  const short = (id) => (clash.has(id) ? nameOf(id) : shortName(nameOf(id)));
  const x = ofPoi(r.sequence?.[r.index]?.poi);
  const a = r.between?.prev ? ofPoi(r.between.prev) : null;
  const b = r.between?.next ? ofPoi(r.between.next) : null;
  const where = a && b ? L.between(x, a, b) : b ? L.first(x, b) : a ? L.last(x, a) : L.only(x);
  const slack = Math.max(0, (r.openSlotUsedMin ?? 0) - (r.openSlotUsedBeforeMin ?? 0));
  return [
    `${where}，${L.shift(r.shiftMaxMin ?? 0, earlyMaxMin(r, plan))}${slack > 0 ? L.slack(slack) : ''}`,
    ...adjustLabels(r, nameOf, plan),
    ...(r.shrunk ?? []).map((s) => L.shrunk(short(s.poiId), s.toMin)),
    ...(r.revived ?? []).map((id) => L.revived(short(id))),
  ].join('；');
}
