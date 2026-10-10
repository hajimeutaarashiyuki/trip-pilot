// 營業時間自由文字 → 結構化 { mon: [['11:30','22:00']], … }。研究寫的是人話：
//   「11:30～22:00；週一公休」「平日 8:00–22:00／日曜 9:00–22:00」「午11:30～14:30／晚17:00～22:30」
//   「週一～六 12:00–19:30、週日假日 11:00–19:00」「8:00～翌2:00」「24時間営業」「境內自由參拜；授與所 9:00-17:00」
// 原則：解析得出時段才給 hours；完全看不出時段回 null，讓規則跳過並警告（§5.12 要附備案）。
// 括號裡的字（最終入館、來源、備註）不看。日期範圍、祝日、月份縮短營業這些不處理，記在 note 讓人看。
// 沒被任何時段指定到的星期＝休（保守：寧可少排，不要排到沒開）；但「平日」沒提到「土」時，週六跟著平日走（日本店家常見寫法）。

const DOW = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const DAY_CHAR = { 一: 0, 二: 1, 三: 2, 四: 3, 五: 4, 六: 5, 日: 6, 月: 0, 火: 1, 水: 2, 木: 3, 金: 4, 土: 5 };
const RANGE_SEP = '[～〜~\\-–—]';
const TIME = '(\\d{1,2})[:：](\\d{2})';
const TIME_RANGE = new RegExp(`${TIME}\\s*${RANGE_SEP}\\s*(翌)?\\s*${TIME}`, 'g');
const CLOSED_WORD = /(公休|定休|休業|休館|休息|休日|休(?=\s|$|[、，。；）(（]))/;
const DAY_TOKEN = '[一二三四五六日月火水木金土]';

const pad = (n) => String(n).padStart(2, '0');
const hm = (h, m) => `${pad(h)}:${pad(m)}`;

/** 括號內容全部拿掉（含【】、〔〕、（）、()、[]）。 */
function stripParens(s) {
  return String(s ?? '').replace(/[（(【〔[][^）)】〕\]]*[）)】〕\]]/g, ' ');
}

/** 一段文字裡提到的星期集合（0=mon…6=sun）；平日、週末、土日、範圍、列舉都認。回 null 表示沒提到星期。 */
export function daysOf(text) {
  let s = String(text ?? '')
    .replace(/祝前日|祝日|祭日|假日|節日|祝/g, ' ')
    .replace(/年中無休|無休|毎日|每日|全日|月～日|月〜日|月~日/g, ' ALL ')
    .replace(/平日/g, ' WEEKDAY ')
    .replace(/週末|土日|週六日|六日/g, ' WEEKEND ');
  const out = new Set();
  if (/\bALL\b/.test(s)) for (let i = 0; i < 7; i++) out.add(i);
  if (/\bWEEKDAY\b/.test(s)) [0, 1, 2, 3, 4].forEach((d) => out.add(d));
  if (/\bWEEKEND\b/.test(s)) [5, 6].forEach((d) => out.add(d));
  // 範圍：週一～六、月～金、日～木（跨週日就繞回來）
  const range = new RegExp(`(?:週|毎週|每週)?(${DAY_TOKEN})(?:曜日?)?\\s*${RANGE_SEP}\\s*(?:週)?(${DAY_TOKEN})(?:曜日?)?`, 'g');
  s = s.replace(range, (_, a, b) => {
    let i = DAY_CHAR[a]; const j = DAY_CHAR[b];
    for (let k = 0; k < 7; k++) { out.add(i); if (i === j) break; i = (i + 1) % 7; }
    return ' ';
  });
  // 單日：週三、水曜日、毎週水曜
  s = s.replace(new RegExp(`(?:週|毎週|每週)(${DAY_TOKEN})(?:曜日?)?`, 'g'), (_, a) => { out.add(DAY_CHAR[a]); return ' '; });
  s = s.replace(new RegExp(`(${DAY_TOKEN})曜日?`, 'g'), (_, a) => { out.add(DAY_CHAR[a]); return ' '; });
  // 列舉：週一～三・五、週一・三・五 ——「・」「、」後面緊接的單字（後面不是漢字）也算
  s = s.replace(new RegExp(`(?<=[・、,])\\s*(${DAY_TOKEN})(?!\\p{Script=Han})`, 'gu'), (_, a) => { out.add(DAY_CHAR[a]); return ' '; });
  // 連寫：金土、火水木（兩個字以上、前後不是漢字才算，免得把「一番町」的「一」當星期一）
  s = s.replace(new RegExp(`(?<!\\p{Script=Han})(${DAY_TOKEN}{2,})(?!\\p{Script=Han})`, 'gu'), (_, run) => { for (const ch of run) out.add(DAY_CHAR[ch]); return ' '; });
  return out.size ? out : null;
}

/** 一段文字裡的時段 [[open, close], …]；「翌2:00」或結束比開始早＝跨日（26:00）；「24時間」＝整天。 */
export function rangesOf(text) {
  const s = String(text ?? '');
  const out = [];
  if (/24\s*(時間|小時|h)/i.test(s)) out.push(['00:00', '24:00']);
  for (const m of s.matchAll(TIME_RANGE)) {
    const open = Number(m[1]) * 60 + Number(m[2]);
    let close = Number(m[4]) * 60 + Number(m[5]);
    if (m[3] || close <= open) close += 24 * 60;
    if (close - open <= 0 || close - open > 24 * 60) continue;
    out.push([hm(Math.floor(open / 60), open % 60), hm(Math.floor(close / 60), close % 60)]);
  }
  return out;
}

/**
 * parseHoursText(text) → { hours: { mon: [[o, c]], … } | null, closedDays: ['mon'], note: string | null, partial: boolean }
 */
export function parseHoursText(text) {
  const raw = String(text ?? '').trim();
  if (!raw) return { hours: null, closedDays: [], note: null, partial: false };
  const clean = stripParens(raw);
  const assigned = new Map();   // dow → ranges
  const closed = new Set();
  let firstRanges = null; let firstScoped = false;
  let mentionsWeekday = false; let mentionsSat = false;
  const notes = [];
  if (/不定休/.test(clean)) notes.push('不定休');
  if (/未確認|兩說|各店不一|衝突|視.*狀況|售完/.test(raw)) notes.push('時間有不確定的地方，看原文');

  for (const clause of clean.split(/[；;。]/)) {
    let scope = null;   // 這一句目前的星期範圍；沒寫就沿用上一段
    for (const rawSeg of clause.split(/[／/、，,]/)) {
      const seg = rawSeg.trim();
      if (!seg) continue;
      const ranges = rangesOf(seg);
      // 時段前面的字決定星期；整段沒時段就看是不是休日
      const at = seg.search(TIME_RANGE);
      const prefix = ranges.length && at >= 0 ? seg.slice(0, at) : seg;
      const days = daysOf(prefix);
      if (/平日/.test(prefix)) mentionsWeekday = true;
      if (/土|週六|六曜|週末/.test(prefix)) mentionsSat = true;
      if (!ranges.length) {
        if (days && CLOSED_WORD.test(seg) && !/無休/.test(seg)) for (const d of days) closed.add(d);
        continue;
      }
      if (days) scope = days;
      const target = scope ?? new Set([0, 1, 2, 3, 4, 5, 6]);
      if (!firstRanges) { firstRanges = ranges; firstScoped = Boolean(scope); }
      for (const d of target) assigned.set(d, [...(assigned.get(d) ?? []), ...ranges]);
    }
  }
  if (!firstRanges) return { hours: null, closedDays: [...closed].sort().map((d) => DOW[d]), note: notes.join('；') || null, partial: false };

  // 「平日」沒提到「土」：週六跟平日走
  if (mentionsWeekday && !mentionsSat && !assigned.has(5)) {
    const weekday = assigned.get(0) ?? assigned.get(1) ?? assigned.get(2) ?? assigned.get(3) ?? assigned.get(4);
    if (weekday) assigned.set(5, [...weekday]);
  }
  const hours = {};
  for (let d = 0; d < 7; d++) {
    const list = closed.has(d) ? [] : (assigned.get(d) ?? []);
    hours[DOW[d]] = dedupe(list);
  }
  const unassigned = DOW.filter((k, d) => !closed.has(d) && !assigned.has(d));
  const partial = firstScoped && unassigned.length > 0;
  if (partial) notes.push(`沒寫到的星期（${unassigned.join('、')}）當作休`);
  return { hours, closedDays: [...closed].sort().map((d) => DOW[d]), note: notes.join('；') || null, partial };
}

function dedupe(list) {
  const seen = new Set(); const out = [];
  for (const r of list) { const k = r.join('-'); if (!seen.has(k)) { seen.add(k); out.push(r); } }
  return out.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
}
