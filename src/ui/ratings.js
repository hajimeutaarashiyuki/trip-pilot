// 評分隔天補（profile §7、原話 #134「每站彈，忘記評分到的，到隔天早上再補彈一次」）：離站彈一次評分，沒按的隔天在現場頁補一張卡；
// 略過的有紀錄（skipped），不補。進度按日期記在 field.progress[date]（＝那天走到第幾站），換日期不歸零，昨天走到哪才記得住。
// 這裡只有純邏輯（可測）；畫面在 now.js、寫回在 app.js 的 setField。

/**
 * 合併一筆現場狀態更新（app.js 的 setField 用）：
 * 換日期、沒明講 index → 接那天的進度（progress[date] ?? 0）；任何一次更新 progress[date] 都跟 index 同步，舊版存的 field 沒有 progress 也會補上。
 */
export function mergeField(prev, partial) {
  const next = { ...prev, ...partial };
  const progress = { ...(prev?.progress ?? {}) };
  if (partial.date != null && partial.date !== prev?.date && partial.index == null) next.index = progress[partial.date] ?? 0;
  if (next.date) progress[next.date] = next.index ?? 0;
  next.progress = progress;
  return next;
}

/** 那天走到第幾站：progress 有就用它；舊版存的 field 沒有 progress，選的就是 field.date 時退回 field.index，別天是 0。 */
export function progressOf(field, date) {
  return field?.progress?.[date] ?? (date === field?.date ? field?.index ?? 0 : 0);
}

/**
 * 還沒評的站：日期在今天之前、走過（progress[date] > i）、ratings 沒紀錄的（略過有紀錄，不算）。
 * 依日期、再依當天順序回 [{ date, poi }]；today 是 'YYYY-MM-DD'（試走模式用選的那天，真的時間就是今天）。
 */
export function pendingRatings({ plans, field, today }) {
  const progress = field?.progress ?? {};
  const ratings = field?.ratings ?? {};
  const out = [];
  for (const date of Object.keys(progress).sort()) {
    if (!(date < today)) continue;
    const seq = plans?.[date]?.plan?.sequence ?? [];
    const n = Math.min(progress[date] ?? 0, seq.length);
    for (let i = 0; i < n; i++) if (!ratings[seq[i].poi.id]) out.push({ date, poi: seq[i].poi });
  }
  return out;
}

/**
 * 現場頁該停在哪一天：field.date 是這趟的一天就不動；不是（第一次裝好時 boot 填的今天、換了旅程）→ 今天是旅程日就今天，否則第一天。
 * 載入旅程時 app.js 用它正規化 field.date：畫面顯示的那天跟 progress 記的那天必須是同一個，不然出發按了進度記到別天底下。
 */
export function pickFieldDate(field, dates, today) {
  if (dates.includes(field?.date)) return field.date;
  return dates.includes(today) ? today : dates[0] ?? null;
}

/** 兩個 'YYYY-MM-DD' 差幾天（to − from；用 UTC 算，不受夏令時間影響）。 */
export function daysBetween(from, to) {
  const utc = (s) => { const [y, m, d] = String(s).split('-').map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((utc(to) - utc(from)) / 86400000);
}
