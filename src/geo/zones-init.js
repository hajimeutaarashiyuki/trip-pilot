// zones 草案：從有座標的站貪婪聚類（半徑預設 800 m），每群的 id／名字／keywords 取自群內 area 文字。
// 純函式（Node 與測試用），CLI 在 tools/zones-init.mjs。產出的是草案：區名、keywords、environment、links 都要人看過再用。
import { haversineM } from './matrix.js';

export const DEFAULT_RADIUS_M = 800;
export const MIN_RADIUS_M = 400;
// 一個詞出現在這麼多群以上就是「區」等級的字（青葉區、市中心），不是某一區的關鍵字，整個丟掉
export const GENERIC_MIN_CLUSTERS = 3;

const hasCoords = (p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lng);

function meanOf(members) {
  const n = members.length;
  return { lat: members.reduce((s, p) => s + p.lat, 0) / n, lng: members.reduce((s, p) => s + p.lng, 0) / n };
}

/**
 * clusterPois(pois, { radiusM }) → [{ center: { lat, lng }, members: [poi] }]
 * 依序把站放進「群心最近、且距群心在半徑內」的既有群，否則開新群；群心＝成員平均（每放一站重算）。沒座標的站跳過。
 */
export function clusterPois(pois, { radiusM = DEFAULT_RADIUS_M } = {}) {
  const clusters = [];
  for (const poi of pois) {
    if (!hasCoords(poi)) continue;
    let best = null; let bestD = Infinity;
    for (const c of clusters) {
      const d = haversineM(poi, c.center);
      if (d <= radiusM && d < bestD) { best = c; bestD = d; }
    }
    if (best) { best.members.push(poi); best.center = meanOf(best.members); }
    else clusters.push({ center: { lat: poi.lat, lng: poi.lng }, members: [poi] });
  }
  return clusters;
}

// area 文字的分隔：空白、各種括號、頓號逗號、斜線、中點、波浪、加號、箭頭、豎線、句號驚嘆問號
const SPLIT = /[\s（）()【】［］\[\]「」『』〈〉《》，,、；;：:／/・･～~＋+→←⇄⇔↔｜|。！!？?]+/u;
const PURE_NUMBER = /^[\d０-９.．\-－‐–]+$/u;
// 詞尾的地址號碼：「北町1-2-3」「中央2」「4丁目」「3F」
const ADDRESS_TAIL = /[\d０-９]+(?:[-－‐–][\d０-９]+)*(?:丁目|番地|番|号|號|F|f|階|樓)?$/u;

/** 城市名的各種寫法（原名、＋市、＋市區…），拆詞時整個拿掉或當前綴剝掉。 */
export function cityStopWords(cityNames = []) {
  const names = [...new Set(cityNames.filter(Boolean).map(String))];
  return [...new Set(names.flatMap((n) => [n, `${n}市`, `${n}市區`, `${n}市内`, `${n}市內`, `${n}全域`, `${n}近郊`]))].sort((a, b) => b.length - a.length);
}

/**
 * areaTokens(text, { cityNames }) → 這段 area 文字拆出的詞（去重、保留出現順序）。
 * 規則：照 SPLIT 拆；「仙台市青葉區」剝掉城市名前綴成「青葉區」；等於城市名的詞、純數字、剝掉地址號碼後不到 2 個字的都丟。
 */
export function areaTokens(text, { cityNames = [] } = {}) {
  const stops = cityStopWords(cityNames);
  const out = [];
  for (const raw of String(text ?? '').split(SPLIT)) {
    let t = raw.trim();
    if (!t) continue;
    if (stops.includes(t)) continue;
    const prefix = stops.find((s) => /市$/.test(s) && t.startsWith(s));
    if (prefix) t = t.slice(prefix.length);
    if (PURE_NUMBER.test(t)) continue;
    t = t.replace(ADDRESS_TAIL, '');
    if ([...t].length < 2) continue;
    if (!out.includes(t)) out.push(t);
  }
  return out;
}

/** area 的前綴：第一個括號、逗號、分號、斜線之前的那段（「八幡（仙台市青葉區…）」→「八幡」）。 */
export function areaPrefix(text) {
  return String(text ?? '').split(/[（(【\[，,；;／/]/u)[0].trim();
}

/** 跟 data/schema.js 的 slugId 同規則：小寫、字母數字以外轉連字號（CJK 留著）。 */
export function slugify(text) {
  return String(text ?? '').trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '');
}

/** 出現最多的（同票取先出現）；空清單回 null。 */
export function mostCommon(list) {
  const count = new Map();
  for (const x of list) count.set(x, (count.get(x) ?? 0) + 1);
  let best = null;
  for (const [x, n] of count) if (!best || n > best.n) best = { x, n };
  return best?.x ?? null;
}

export const DRAFT_NOTE = (radiusM) =>
  `zones 草案：tools/zones-init.mjs 從 coords.json 有座標的站貪婪聚類（半徑 ${radiusM} m）產出。每區 id、name_zh、keywords 取自群內 area 文字（去掉城市名與純數字；出現在 ${GENERIC_MIN_CLUSTERS} 群以上的詞當作區等級的字丟掉；其餘一個詞只歸出現最多的那區，沒有獨有關鍵字的區要手動補），radiusM＝群內最遠站距群心（至少 ${MIN_RADIUS_M}）。environment 全部先標 urban（推導）：山區、溫泉、海邊改 nature 或 town（引擎的正午規則只罰 urban）。跨區搭車連結先留空，引擎會退直線估；要補就照仙台 zones.json 的形狀：{ "<區A>|<區B>": { "mode": "subway", "rideMin": 8, "walkMin": 5 } }。`;

/**
 * zoneDraft(clusters, { cityNames, radiusM, minRadiusM }) → { _說明, zones, links: {} }（zones.json 的形狀）
 * - id＝群內 area 文字最常見的詞做 slug（撞名加 -2、-3…）；name_zh＝最常見的 area 前綴
 * - keywords＝群內 area 拆出的詞；散在 GENERIC_MIN_CLUSTERS 群以上的詞丟掉；其餘同一個詞出現在多群時只歸出現最多的那群（同票取先出現的群），免得歸區時曖昧
 * - radiusM＝群內最遠站距群心，至少 minRadiusM；environment 先標 urban
 */
export function zoneDraft(clusters, { cityNames = [], radiusM = DEFAULT_RADIUS_M, minRadiusM = MIN_RADIUS_M } = {}) {
  // 每群的詞與詞頻
  const perCluster = clusters.map((c) => {
    const freq = new Map();
    for (const p of c.members) for (const t of areaTokens(p.area, { cityNames })) freq.set(t, (freq.get(t) ?? 0) + 1);
    return freq;
  });
  // 一個詞只歸一群：出現次數最多的那群，同票取先出現的群；散在太多群的詞是區等級的字，不歸任何群
  const owner = new Map(); const spread = new Map();
  perCluster.forEach((freq, i) => {
    for (const [t, n] of freq) {
      spread.set(t, (spread.get(t) ?? 0) + 1);
      const cur = owner.get(t); if (!cur || n > cur.n) owner.set(t, { i, n });
    }
  });
  for (const [t, k] of spread) if (k >= GENERIC_MIN_CLUSTERS) owner.delete(t);

  const zones = {}; const used = new Set();
  clusters.forEach((c, i) => {
    const freq = perCluster[i];
    const ranked = [...freq].sort((a, b) => b[1] - a[1]).map(([t]) => t);
    const base = slugify(ranked[0] ?? areaPrefix(c.members[0]?.area) ?? '') || `zone-${i + 1}`;
    let id = base; for (let k = 2; used.has(id); k++) id = `${base}-${k}`;
    used.add(id);
    const keywords = ranked.filter((t) => owner.get(t)?.i === i);
    const far = Math.max(0, ...c.members.map((p) => haversineM(p, c.center)));
    zones[id] = {
      name_zh: mostCommon(c.members.map((p) => areaPrefix(p.area)).filter(Boolean)) ?? ranked[0] ?? id,
      lat: Math.round(c.center.lat * 1e5) / 1e5,
      lng: Math.round(c.center.lng * 1e5) / 1e5,
      radiusM: Math.max(minRadiusM, Math.ceil(far / 10) * 10),
      environment: 'urban',
      keywords,
    };
  });
  return { _說明: DRAFT_NOTE(radiusM), zones, links: {} };
}
