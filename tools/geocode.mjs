// 幫一城的知識庫查座標：Photon（komoot，OSM 資料）優先、Nominatim 備援。
// 每個結果都要「落在該站的區」才收（區靠 zones.json 的 keywords 從 area 文字歸出來）；名字對得上才算 exact；
// 店本身不在 OSM 的，退而用 area 裡的地址查（confidence: address）。查不到的留 null，不猜。
// 人工補在 <城>/coords.manual.json（{ "<poiId>": { lat, lng, note } }），人工的優先。
// 用法：node tools/geocode.mjs <知識庫資料夾> [--city 仙台] [--retry | --force]
//   預設只查還沒有的；--retry 重查 null 與非 exact 的（exact 但跑出該區的也重查）；--force 全部重查。
// 輸出：<城>/coords.json  { "<poiId>": { lat, lng, source, query, display, confidence, zoneId, distM } | null }
//   confidence：exact（查到的地名含店名）、address（靠地址查到，店不在 OSM）、fuzzy（在該區內但名字對不上）、unzoned（歸不到區，只知道在範圍框內）、manual
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizePoi } from '../src/data/schema.js';
import { haversineM } from '../src/geo/matrix.js';
import { zoneOfPoi } from '../src/geo/zones.js';

const UA = 'trip-pilot/0.0 (personal trip planner; contact: see repo)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// bbox：只收這個範圍內的結果，不然「山寺」會查到山西。預設東北地方。
const BBOX = { west: 139.5, south: 37.0, east: 142.2, north: 40.5 };
// 這些店型不是地點（交通、實用資訊），不查
const SKIP_CATEGORIES = new Set(['logistics']);
const RANK = { exact: 3, address: 2, fuzzy: 1, unzoned: 0 };

export async function geocodePhoton(query, bbox = BBOX, limit = 5) {
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

export async function geocodeNominatim(query, bbox = BBOX, retries = 3, limit = 5) {
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
export async function geocodeOne(query, bbox = BBOX) {
  try { const p = await geocodePhoton(query, bbox); if (p.length) return p; } catch (err) { console.error(`Photon：${err.message}`); }
  await sleep(1100);
  return geocodeNominatim(query, bbox);
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

export function zoneFor(poi, zones) {
  const id = zoneOfPoi(poi, zones);
  return id && zones[id] ? { id, ...zones[id] } : null;
}

/** 一站：照查詢順序找，exact 立刻收；否則留等級最高的（address ＞ fuzzy ＞ unzoned）。 */
export async function geocodePoi(poi, city, zone, lookup = geocodeOne) {
  let best = null;
  for (const { q, kind } of queriesFor(poi, city)) {
    let cands = [];
    try { cands = await lookup(q); } catch (err) { console.error(`${poi.name_zh}：${err.message}`); }
    await sleep(700);
    const hit = cands.find((c) => inZone(c, zone));
    if (!hit) continue;
    const confidence = nameMatches(hit, poi) ? 'exact' : kind === 'address' ? 'address' : zone ? 'fuzzy' : 'unzoned';
    const r = { lat: hit.lat, lng: hit.lng, source: hit.source, query: q, display: hit.display, confidence, zoneId: zone?.id ?? null, distM: zone ? Math.round(haversineM(hit, zone)) : null };
    if (confidence === 'exact') return r;
    if (!best || RANK[confidence] > RANK[best.confidence]) best = r;
  }
  return best;
}

function loadPois(kb) {
  const list = Object.values(kb.categories ?? {}).flatMap((v) => (Array.isArray(v) ? v : v.items ?? []));
  const seen = new Set();
  // 同一家店列在多個類別會得到同一個 id（例：仙台ロフト ×3），座標只查一次
  return list.map((raw) => normalizePoi(raw).poi).filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)));
}

const MARK = { exact: '○', address: '▢', fuzzy: '△', unzoned: '？' };

async function main() {
  const args = process.argv.slice(2);
  const dir = args.find((a) => !a.startsWith('--'));
  if (!dir) { console.error('用法：node tools/geocode.mjs <知識庫資料夾> [--city 仙台] [--retry | --force]'); process.exit(2); }
  const cityArg = args.indexOf('--city');
  const city = cityArg >= 0 ? args[cityArg + 1] : '仙台';
  const mode = args.includes('--force') ? 'force' : args.includes('--retry') ? 'retry' : 'missing';
  const kb = JSON.parse(await readFile(path.join(dir, 'data.json'), 'utf8'));
  const zonesPath = path.join(dir, 'zones.json');
  const zones = existsSync(zonesPath) ? (JSON.parse(await readFile(zonesPath, 'utf8')).zones ?? {}) : {};
  const pois = loadPois(kb);
  const outPath = path.join(dir, 'coords.json');
  const manualPath = path.join(dir, 'coords.manual.json');
  const out = existsSync(outPath) && mode !== 'force' ? JSON.parse(await readFile(outPath, 'utf8')) : {};
  const manual = existsSync(manualPath) ? JSON.parse(await readFile(manualPath, 'utf8')) : {};
  const counts = { exact: 0, address: 0, fuzzy: 0, unzoned: 0, none: 0, manual: 0, kept: 0, skipped: 0 };
  for (const poi of pois) {
    if (manual[poi.id]) { out[poi.id] = { ...manual[poi.id], source: 'manual', confidence: 'manual' }; counts.manual++; continue; }
    if (SKIP_CATEGORIES.has(poi.category)) { out[poi.id] = null; counts.skipped++; continue; }
    const zone = zoneFor(poi, zones);
    const cur = out[poi.id];
    if (mode === 'missing' && cur !== undefined) { counts.kept++; continue; }
    if (mode === 'retry' && cur && cur.confidence === 'exact' && inZone(cur, zone)) { counts.kept++; continue; }
    const r = await geocodePoi(poi, city, zone);
    out[poi.id] = r;
    counts[r ? r.confidence : 'none']++;
    console.log(`${r ? MARK[r.confidence] : '×'} ${poi.name_zh}${zone ? `［${zone.id}］` : '［無區］'}${r ? `　${r.lat.toFixed(5)},${r.lng.toFixed(5)}　${r.display.slice(0, 60)}${r.distM != null ? `　距區心 ${r.distM} m` : ''}` : ''}`);
  }
  await writeFile(outPath, JSON.stringify(out, null, 2) + '\n', 'utf8');
  console.log(`座標：exact ${counts.exact}、address ${counts.address}、fuzzy ${counts.fuzzy}、unzoned ${counts.unzoned}、沒查到 ${counts.none}、人工 ${counts.manual}、沿用 ${counts.kept}、不查（交通類）${counts.skipped}；共 ${pois.length} 站 → ${outPath}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
