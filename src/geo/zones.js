// 區（Zone）工具：靠 zones.json 每區的 keywords 把 area 文字歸區。
// 規則：最早出現的關鍵字優先、同一位置取較長的（「仙台站東口」贏過「仙台站」）。關鍵字是城市資料，不在程式裡。

/** zoneOf(text, zones) → zoneId | null */
export function zoneOf(text, zones) {
  const s = String(text ?? '');
  if (!s) return null;
  let best = null;
  for (const [id, z] of Object.entries(zones ?? {})) {
    for (const kw of z.keywords ?? []) {
      const i = s.indexOf(kw);
      if (i < 0) continue;
      if (!best || i < best.i || (i === best.i && kw.length > best.len)) best = { id, i, len: kw.length };
    }
  }
  return best?.id ?? null;
}

/** 一站歸哪區：明寫的 zoneId 優先；再看 area；最後看名字（山寺的 area 寫「山形縣山形市」，名字才有山寺）。 */
export function zoneOfPoi(poi, zones) {
  return poi?.zoneId ?? zoneOf(poi?.area, zones) ?? zoneOf(poi?.name_local, zones) ?? zoneOf(poi?.name_zh, zones);
}
