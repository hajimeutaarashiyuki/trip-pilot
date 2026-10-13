// 幫一城的知識庫查座標：有 Google 金鑰就先 Google（店名→Places API (New) 文字搜尋、地址→Geocoding API），沒結果再 OSM（Photon 優先、Nominatim 備援）。
// 金鑰：環境變數 GOOGLE_MAPS_API_KEY，或專案根目錄 .secrets/google-maps.key（不進倉庫）；沒有金鑰就只用 OSM。
// 範圍：只收 <城>/city.json 的 bbox 裡的結果（不然「山寺」會查到山西）；查詢字尾（「○○ 仙台」的仙台）預設 city.json 的 name_local，--city 可覆寫。沒有 city.json 就停，不退回仙台的值。
// 每個結果都要「落在該站的區」才收（區靠 zones.json 的 keywords 從 area 文字歸出來）；名字對得上才算 exact；
// 店本身不在 OSM 的，退而用 area 裡的地址查（confidence: address）。查不到的留 null，不猜。
// 人工補在 <城>/coords.manual.json（{ "<poiId>": { lat, lng, note } }），人工的優先。
// 用法：node tools/geocode.mjs <知識庫資料夾> [--city <查詢字尾>] [--retry | --force | --fill] [--dry-run]
//   預設只查還沒有的；--retry 重查 null 與非 exact 的（exact 但跑出該區的也重查）；--force 全部重查；
//   --fill 不打網路，只把還是 null 的站填成所屬區的區心（confidence: zone），讓步行矩陣有東西算；
//   --dry-run 不打網路、不寫檔，只印範圍與每站會怎麼處理（查／沿用／不查）。
// 輸出：<城>/coords.json  { "<poiId>": { lat, lng, source, query, display, confidence, zoneId, distM } | null }
//   confidence：exact（查到的地名含店名）、google（Google 用店名查到、在區內但名字比不出來，通常是對的）、address（靠地址查到）、fuzzy（OSM 在區內但名字對不上）、unzoned（歸不到區，只知道在範圍框內）、
//              zone（都查不到，先用該區的區心頂著，誤差是半徑；--fill 填的）、manual
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizePoi } from '../src/data/schema.js';
import { haversineM } from '../src/geo/matrix.js';
import { zoneOfPoi } from '../src/geo/zones.js';
import { loadCity, inBbox } from './lib/city.mjs';

const UA = 'trip-pilot/0.0 (personal trip planner; contact: see repo)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 這些店型不是地點（交通、實用資訊），不查；kb-check 算覆蓋率時也跳過
export const SKIP_CATEGORIES = new Set(['logistics']);
const RANK = { exact: 4, google: 3, address: 2, fuzzy: 1, unzoned: 0, zone: -1 };

/** 打網路的函式都要有框：沒給就是呼叫端忘了讀 city.json，直接擋下來，不給任何城市的預設框。 */
function requireBbox(bbox, who) {
  if (!bbox || !['west', 'south', 'east', 'north'].every((k) => Number.isFinite(bbox[k]))) throw new Error(`${who}：要給 bbox（city.json 的查座標範圍）`);
  return bbox;
}

export async function geocodePhoton(query, bbox, limit = 5) {
  requireBbox(bbox, 'Photon');
  // Photon 的 lang 只有 en/de/fr/it 等，日文地名用預設（原文）即可
  const url = `https://photon.komoot.io/api/?limit=${limit}&bbox=${bbox.west},${bbox.south},${bbox.east},${bbox.north}&q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`Photon ${res.status}`);
  const data = await res.json();
  return (data.features ?? []).map((f) => {
    const p = f.properties ?? {};
    return { lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0], name: p.name ?? '', display: [p.name, p.street, p.district, p.city, p.state].filter(Boolean).join(', '), source: 'photon' };
  });
}

export async function geocodeNominatim(query, bbox, retries = 3, limit = 5) {
  requireBbox(bbox, 'Nominatim');
  const viewbox = `${bbox.west},${bbox.north},${bbox.east},${bbox.south}`;
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=${limit}&bounded=1&viewbox=${viewbox}&q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'ja,zh-TW,en' } });
  if (res.status === 429) {
    if (retries <= 0) throw new Error('Nominatim 429（被限流，稍後再跑）');
    await sleep(10000); return geocodeNominatim(query, bbox, retries - 1, limit);
  }
  if (!res.ok) throw new Error(`Nominatim ${res.status}`);
  const list = await res.json();
  return list.map((hit) => ({ lat: Number(hit.lat), lng: Number(hit.lon), name: hit.name ?? '', display: hit.display_name, source: 'nominatim' }));
}

/** 一個查詢字串 → 候選清單（Photon 有就不問 Nominatim；Nominatim 1 秒 1 次）。 */
export async function geocodeOne(query, bbox) {
  requireBbox(bbox, 'OSM');
  try { const p = await geocodePhoton(query, bbox); if (p.length) return p; } catch (err) { console.error(`Photon：${err.message}`); }
  await sleep(1100);
  return geocodeNominatim(query, bbox);
}

/** Google 金鑰：環境變數 GOOGLE_MAPS_API_KEY，或專案根目錄 .secrets/google-maps.key（gitignore）。沒有回 null。 */
export function googleKey() {
  if (process.env.GOOGLE_MAPS_API_KEY) return process.env.GOOGLE_MAPS_API_KEY.trim();
  const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '.secrets', 'google-maps.key');
  try { return readFileSync(file, 'utf8').trim() || null; } catch { return null; }
}

/** Google Places API (New) 文字搜尋：店名查店。有區就以區心為偏好圈（bias，不是硬限制；區內才收由 inZone 管、框內才收由 inBbox 管）。 */
export async function geocodeGooglePlaces(query, zone, key, bbox) {
  requireBbox(bbox, 'Google Places');
  const body = { textQuery: query, languageCode: 'ja', regionCode: 'JP', pageSize: 5 };
  body.locationBias = zone
    ? { circle: { center: { latitude: zone.lat, longitude: zone.lng }, radius: Math.max((zone.radiusM ?? 800) * 2, 1500) } }
    : { rectangle: { low: { latitude: bbox.south, longitude: bbox.west }, high: { latitude: bbox.north, longitude: bbox.east } } };
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.location' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Google Places ${res.status}`);
  const data = await res.json();
  return (data.places ?? [])
    .map((p) => ({ lat: p.location?.latitude, lng: p.location?.longitude, name: p.displayName?.text ?? '', display: [p.displayName?.text, p.formattedAddress].filter(Boolean).join(', '), source: 'google' }))
    .filter((c) => Number.isFinite(c.lat) && Number.isFinite(c.lng));
}

/** Google Geocoding：地址查點（限日本、偏好 bbox 範圍）。 */
export async function geocodeGoogleAddress(address, key, bbox) {
  requireBbox(bbox, 'Google Geocoding');
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&language=ja&region=jp&components=country:JP&bounds=${bbox.south},${bbox.west}%7C${bbox.north},${bbox.east}&key=${encodeURIComponent(key)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Google Geocoding ${res.status}`);
  const data = await res.json();
  if (data.status && data.status !== 'OK' && data.status !== 'ZERO_RESULTS') throw new Error(`Google Geocoding ${data.status}`);
  return (data.results ?? []).map((r) => ({ lat: r.geometry.location.lat, lng: r.geometry.location.lng, name: '', display: r.formatted_address, source: 'google' }));
}

/** 預設查法：有金鑰先 Google（店名→Places、地址→Geocoding），沒結果或出錯再 OSM。bbox 是 city.json 的框；呼叫端另給的框優先。 */
export function makeLookup(key, bbox) {
  requireBbox(bbox, 'makeLookup');
  return async (query, kind = 'name', zone = null, box = bbox) => {
    if (key) {
      try {
        const g = kind === 'address' ? await geocodeGoogleAddress(query, key, box) : await geocodeGooglePlaces(query, zone, key, box);
        await sleep(150);
        if (g.length) return g;
      } catch (err) { console.error(`Google：${err.message}`); }
    }
    return geocodeOne(query, box);
  };
}

/** 複合名拆段：「ハピナ名掛丁＋クリスロード＋マーブルロードおおまち」→ 三段；括號裡的也算一段。 */
export function splitName(name) {
  const s = String(name ?? '').replace(/[（(]([^）)]*)[)）]/g, '／$1');
  return [...new Set(s.split(/[／/＋+・、，,]/).map((x) => x.trim()).filter((x) => x.length >= 2 && x !== name))];
}

/** area 文字裡的地址：「青葉区中央2-2-24」→ 整個地址、再丁目層（去掉號）。 */
export function addressesOf(area, city) {
  const out = [];
  const found = String(area ?? '').match(/(?:\p{Script=Han}{1,4}[区區])?[\p{Script=Han}ヶ]{1,6}\d+(?:-\d+){0,3}/gu) ?? [];
  for (const a of found) {
    const full = a.replace('區', '区');
    out.push(`${city}市${full}`);
    const chome = full.replace(/(\d+)(?:-\d+)+$/, '$1');
    if (chome !== full) out.push(`${city}市${chome}丁目`);
  }
  return [...new Set(out)];
}

/** 一站要試的查詢，照順序：maps_query、原文名、拆段、中文名、地址。 */
export function queriesFor(poi, city) {
  const qs = [];
  const push = (q, kind) => { const s = String(q ?? '').trim(); if (s && !qs.some((x) => x.q === s)) qs.push({ q: s, kind }); };
  push(poi.maps_query, 'name');
  if (poi.name_local) push(`${poi.name_local} ${city}`, 'name');
  for (const part of splitName(poi.name_local)) push(`${part} ${city}`, 'name');
  if (poi.name_zh) push(`${poi.name_zh} ${city}`, 'name');
  for (const a of addressesOf(poi.area, city)) push(a, 'address');
  return qs;
}

const norm = (s) => String(s ?? '').replace(/[（(].*?[)）]/g, '').replace(/\s+/g, '').toLowerCase();
/** 查到的地名有沒有店名（去括號與空白後，比對前 4 個字；拆段後的每一段也算）。 */
export function nameMatches(hit, poi) {
  const hay = norm(hit.display) + '|' + norm(hit.name);
  const names = [poi.name_local, poi.name_zh, ...splitName(poi.name_local), ...splitName(poi.name_zh)];
  return names.some((n) => { const stem = norm(n).slice(0, 4); return stem.length >= 2 && hay.includes(stem); });
}

export function inZone(hit, zone) {
  if (!zone) return true;
  return haversineM(hit, zone) <= Math.max((zone.radiusM ?? 800) * 2, 1500);
}

/** 查不到時的區心頂替：誤差是該區半徑，distM 記 0、query 記 null，讓人一眼看出是頂替的。 */
export function zoneCenter(zone) {
  return zone ? { lat: zone.lat, lng: zone.lng, source: 'zone', query: null, display: `區心 ${zone.id}`, confidence: 'zone', zoneId: zone.id, distM: 0 } : null;
}

export function zoneFor(poi, zones) {
  const id = zoneOfPoi(poi, zones);
  return id && zones[id] ? { id, ...zones[id] } : null;
}

/**
 * 一站：照查詢順序找，exact 立刻收；否則留等級最高的（google ＞ address ＞ fuzzy ＞ unzoned）。
 * lookup(query, kind, zone, bbox) 回候選清單；候選要在區內（inZone）也要在框內（inBbox；bbox 給 null 就不擋）。
 * delayMs：每個查詢之間的間隔（對 OSM 的禮貌；測試用假 lookup 時給 0）。
 */
export async function geocodePoi(poi, city, zone, lookup, bbox = null, { delayMs = 700 } = {}) {
  if (typeof lookup !== 'function') throw new Error('geocodePoi 要給 lookup（makeLookup(key, bbox) 或測試用的假查詢）');
  let best = null;
  for (const { q, kind } of queriesFor(poi, city)) {
    let cands = [];
    try { cands = await lookup(q, kind, zone, bbox); } catch (err) { console.error(`${poi.name_zh}：${err.message}`); }
    if (delayMs > 0) await sleep(delayMs);
    const hit = cands.find((c) => inZone(c, zone) && inBbox(c, bbox));
    if (!hit) continue;
    const confidence = nameMatches(hit, poi) ? 'exact' : kind === 'address' ? 'address' : hit.source === 'google' ? 'google' : zone ? 'fuzzy' : 'unzoned';
    const r = { lat: hit.lat, lng: hit.lng, source: hit.source, query: q, display: hit.display, confidence, zoneId: zone?.id ?? null, distM: zone ? Math.round(haversineM(hit, zone)) : null };
    if (confidence === 'exact') return r;
    if (!best || RANK[confidence] > RANK[best.confidence]) best = r;
  }
  return best;
}

export function loadPois(kb) {
  const list = Object.values(kb.categories ?? {}).flatMap((v) => (Array.isArray(v) ? v : v.items ?? []));
  const seen = new Set();
  // 同一家店列在多個類別會得到同一個 id（例：仙台ロフト ×3），座標只查一次
  return list.map((raw) => normalizePoi(raw).poi).filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)));
}

/** 一站在這個模式下會怎麼處理：manual／skip（交通類）／keep（沿用）／fill（區心頂替）／query（打網路）。--dry-run 與 city-pipeline 的現況數字都用這個。 */
export function planAction({ poi, mode, cur, manual, zone }) {
  if (manual) return 'manual';
  if (SKIP_CATEGORIES.has(poi.category)) return 'skip';
  if (mode === 'missing' && cur !== undefined) return 'keep';
  if (mode === 'fill') return cur ? 'keep' : 'fill';
  if (mode === 'retry' && cur && cur.confidence === 'exact' && inZone(cur, zone)) return 'keep';
  return 'query';
}

const MARK = { exact: '○', google: '◇', address: '▢', fuzzy: '△', unzoned: '？', zone: '◎' };

async function main() {
  const args = process.argv.slice(2);
  const dir = args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1] === '--city'));
  if (!dir) { console.error('用法：node tools/geocode.mjs <知識庫資料夾> [--city <查詢字尾>] [--retry | --force | --fill] [--dry-run]'); process.exit(2); }
  const cityCfg = loadCity(dir);
  const cityArg = args.indexOf('--city');
  const city = cityArg >= 0 ? args[cityArg + 1] : cityCfg.name_local;
  const bbox = cityCfg.bbox;
  const dryRun = args.includes('--dry-run');
  const mode = args.includes('--force') ? 'force' : args.includes('--retry') ? 'retry' : args.includes('--fill') ? 'fill' : 'missing';
  const kb = JSON.parse(await readFile(path.join(dir, 'data.json'), 'utf8'));
  const zonesPath = path.join(dir, 'zones.json');
  const zones = existsSync(zonesPath) ? (JSON.parse(await readFile(zonesPath, 'utf8')).zones ?? {}) : {};
  const pois = loadPois(kb);
  const outPath = path.join(dir, 'coords.json');
  const manualPath = path.join(dir, 'coords.manual.json');
  const out = existsSync(outPath) && mode !== 'force' ? JSON.parse(await readFile(outPath, 'utf8')) : {};
  const manual = existsSync(manualPath) ? JSON.parse(await readFile(manualPath, 'utf8')) : {};
  const counts = { exact: 0, google: 0, address: 0, fuzzy: 0, unzoned: 0, zone: 0, none: 0, manual: 0, kept: 0, skipped: 0 };
  console.log(`城市 ${cityCfg.id}（查詢字尾「${city}」）；範圍 ${bbox.west},${bbox.south} – ${bbox.east},${bbox.north}${cityCfg.bboxDerived ? '（由 center 推）' : ''}；區 ${Object.keys(zones).length} 個${Object.keys(zones).length ? '' : '（沒有 zones.json：無區模式，之後有了區再 --retry）'}`);
  if (dryRun) {
    const plan = { manual: 0, skip: 0, keep: 0, fill: 0, query: 0 };
    for (const poi of pois) {
      const zone = zoneFor(poi, zones);
      const action = planAction({ poi, mode, cur: out[poi.id], manual: manual[poi.id], zone });
      plan[action]++;
      if (action === 'query' || action === 'fill') console.log(`${action === 'query' ? '查' : '◎'} ${poi.name_zh}${zone ? `［${zone.id}］` : '［無區］'}${action === 'query' ? `　${queriesFor(poi, city).length} 個查詢` : '　區心頂替'}`);
    }
    console.log(`試跑（${mode}）：會查 ${plan.query}、區心頂替 ${plan.fill}、沿用 ${plan.keep}、人工 ${plan.manual}、不查（交通類）${plan.skip}；共 ${pois.length} 站；沒打網路、沒寫檔`);
    return;
  }
  const key = googleKey();
  const lookup = makeLookup(key, bbox);
  console.log(key ? 'Google 金鑰有：店名走 Places、地址走 Geocoding，沒結果再 OSM' : '沒有 Google 金鑰：只用 OSM');
  for (const poi of pois) {
    const zone = zoneFor(poi, zones);
    const cur = out[poi.id];
    const action = planAction({ poi, mode, cur, manual: manual[poi.id], zone });
    if (action === 'manual') { out[poi.id] = { ...manual[poi.id], source: 'manual', confidence: 'manual' }; counts.manual++; continue; }
    if (action === 'skip') { out[poi.id] = null; counts.skipped++; continue; }
    if (action === 'keep') { counts.kept++; continue; }
    if (action === 'fill') {
      const z = zoneCenter(zone);
      out[poi.id] = z; counts[z ? 'zone' : 'none']++;
      console.log(`${z ? '◎' : '×'} ${poi.name_zh}${zone ? `［${zone.id}］區心頂替` : '［無區］'}`);
      continue;
    }
    const r = await geocodePoi(poi, city, zone, lookup, bbox);
    // 重查（--retry／--force）時新結果比舊的差或根本查不到，就保留舊命中；不然新城市的區草案一擋就把好命中蓋成 null（10-13 對抗審查）
    const prevHit = cur && cur.confidence ? cur : null;
    const keepOld = Boolean(prevHit) && (!r || (RANK[r.confidence] ?? -9) < (RANK[prevHit.confidence] ?? -9));
    if (keepOld) { counts.kept++; console.log(`＝ ${poi.name_zh}：重查沒比較好，保留舊的（${prevHit.confidence}）`); continue; }
    out[poi.id] = r;
    counts[r ? r.confidence : 'none']++;
    console.log(`${r ? MARK[r.confidence] : '×'} ${poi.name_zh}${zone ? `［${zone.id}］` : '［無區］'}${r ? `　${r.lat.toFixed(5)},${r.lng.toFixed(5)}　${r.display.slice(0, 60)}${r.distM != null ? `　距區心 ${r.distM} m` : ''}` : ''}`);
  }
  await writeFile(outPath, JSON.stringify(out, null, 2) + '\n', 'utf8');
  console.log(`座標：exact ${counts.exact}、google ${counts.google}、address ${counts.address}、fuzzy ${counts.fuzzy}、unzoned ${counts.unzoned}、區心頂替 ${counts.zone}、沒查到 ${counts.none}、人工 ${counts.manual}、沿用 ${counts.kept}、不查（交通類）${counts.skipped}；共 ${pois.length} 站 → ${outPath}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((err) => { console.error(err.message); process.exit(1); });
