// 幫一城的知識庫查座標：Nominatim（OSM）免費、1 秒 1 次、要帶 User-Agent。
// 查不到的留 null，不猜；人工補在 <城>/coords.manual.json（{ "<poiId>": { lat, lng, note } }），人工的優先。
// 用法：node tools/geocode.mjs ../kb/sendai [--city 仙台] [--force]
// 輸出：<城>/coords.json  { "<poiId>": { lat, lng, source: "nominatim"|"manual", query, display } | null }
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizePoi } from '../src/data/schema.js';

const UA = 'trip-pilot/0.0 (personal trip planner; contact: see repo)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// bbox：只收這個範圍內的結果，不然「山寺」會查到山西。預設東北地方。
// 先問 Photon（komoot，OSM 資料、沒有嚴格的每秒限制、支援日文），沒結果再問 Nominatim（1 秒 1 次；429 最多退讓三次就放棄）。
const BBOX = { west: 139.5, south: 37.0, east: 142.2, north: 40.5 };

export async function geocodePhoton(query, bbox = BBOX) {
  // Photon 的 lang 只有 en/de/fr/it 等，日文地名用預設（原文）即可
  const url = `https://photon.komoot.io/api/?limit=1&bbox=${bbox.west},${bbox.south},${bbox.east},${bbox.north}&q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`Photon ${res.status}`);
  const data = await res.json();
  const f = data.features?.[0];
  if (!f) return null;
  const p = f.properties ?? {};
  const display = [p.name, p.street, p.district, p.city, p.state].filter(Boolean).join(', ');
  return { lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0], display, source: 'photon' };
}

export async function geocodeNominatim(query, bbox = BBOX, retries = 3) {
  const viewbox = `${bbox.west},${bbox.north},${bbox.east},${bbox.south}`;
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&bounded=1&viewbox=${viewbox}&q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'ja,zh-TW,en' } });
  if (res.status === 429) {
    if (retries <= 0) throw new Error('Nominatim 429（被限流，稍後再跑）');
    await sleep(10000); return geocodeNominatim(query, bbox, retries - 1);
  }
  if (!res.ok) throw new Error(`Nominatim ${res.status}`);
  const list = await res.json();
  if (!list.length) return null;
  const hit = list[0];
  return { lat: Number(hit.lat), lng: Number(hit.lon), display: hit.display_name, source: 'nominatim' };
}

export async function geocodeOne(query, bbox = BBOX) {
  try { const p = await geocodePhoton(query, bbox); if (p) return p; } catch (err) { console.error(`Photon：${err.message}`); }
  await sleep(1100);
  return geocodeNominatim(query, bbox);
}

function loadPois(kb) {
  const list = Object.values(kb.categories ?? {}).flatMap((v) => (Array.isArray(v) ? v : v.items ?? []));
  return list.map((raw) => normalizePoi(raw).poi);
}

async function main() {
  const dir = process.argv[2];
  if (!dir) { console.error('用法：node tools/geocode.mjs <知識庫資料夾> [--city 仙台] [--force]'); process.exit(2); }
  const cityArg = process.argv.indexOf('--city');
  const city = cityArg > 0 ? process.argv[cityArg + 1] : '仙台';
  const force = process.argv.includes('--force');
  const kb = JSON.parse(await readFile(path.join(dir, 'data.json'), 'utf8'));
  const pois = loadPois(kb);
  const outPath = path.join(dir, 'coords.json');
  const manualPath = path.join(dir, 'coords.manual.json');
  const out = existsSync(outPath) && !force ? JSON.parse(await readFile(outPath, 'utf8')) : {};
  const manual = existsSync(manualPath) ? JSON.parse(await readFile(manualPath, 'utf8')) : {};
  let hit = 0; let miss = 0; let skipped = 0; let manualN = 0;
  for (const poi of pois) {
    if (manual[poi.id]) { out[poi.id] = { ...manual[poi.id], source: 'manual' }; manualN++; continue; }
    if (out[poi.id] !== undefined && !force) { skipped++; continue; }
    const queries = [poi.maps_query, poi.name_local && `${poi.name_local} ${city}`, poi.name_zh && `${poi.name_zh} ${city}`].filter(Boolean);
    let found = null; let used = null;
    for (const q of queries) {
      try { found = await geocodeOne(q); } catch (err) { console.error(`${poi.name_zh}：${err.message}`); }
      await sleep(1100);
      if (found) { used = q; break; }
    }
    // 信心：查到的地名裡有沒有出現店名（去掉括號與空白後比對前 4 個字）；沒有就標 fuzzy，要人工看（例：一隆 查到「たん焼き 山梨」）
    const stem = (s) => String(s ?? '').replace(/[（(].*?[)）]/g, '').replace(/\s+/g, '').slice(0, 4);
    const confidence = found && [poi.name_local, poi.name_zh].some((n) => stem(n) && found.display.replace(/\s+/g, '').includes(stem(n))) ? 'exact' : 'fuzzy';
    out[poi.id] = found ? { ...found, query: used, confidence } : null;
    if (found) hit++; else miss++;
    console.log(`${found ? (confidence === 'exact' ? '○' : '？') : '×'} ${poi.name_zh}${found ? `　${found.lat.toFixed(5)},${found.lng.toFixed(5)}　${found.display.slice(0, 60)}` : ''}`);
  }
  await writeFile(outPath, JSON.stringify(out, null, 2) + '\n', 'utf8');
  console.log(`座標：命中 ${hit}、沒查到 ${miss}、人工 ${manualN}、沿用 ${skipped}；共 ${pois.length} 站 → ${outPath}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
