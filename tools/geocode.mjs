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

// bbox：只收這個範圍內的結果（Nominatim 的 viewbox + bounded），不然「山寺」會查到山西。預設東北地方。
export async function geocodeOne(query, bbox = { west: 139.5, south: 37.0, east: 142.2, north: 40.5 }) {
  const viewbox = `${bbox.west},${bbox.north},${bbox.east},${bbox.south}`;
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&bounded=1&viewbox=${viewbox}&q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'ja,zh-TW,en' } });
  if (res.status === 429) { await sleep(5000); return geocodeOne(query, bbox); }
  if (!res.ok) throw new Error(`Nominatim ${res.status}`);
  const list = await res.json();
  if (!list.length) return null;
  const hit = list[0];
  return { lat: Number(hit.lat), lng: Number(hit.lon), display: hit.display_name, source: 'nominatim' };
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
    out[poi.id] = found ? { ...found, query: used } : null;
    if (found) hit++; else miss++;
    console.log(`${found ? '○' : '×'} ${poi.name_zh}${found ? `　${found.lat.toFixed(5)},${found.lng.toFixed(5)}　${found.display.slice(0, 60)}` : ''}`);
  }
  await writeFile(outPath, JSON.stringify(out, null, 2) + '\n', 'utf8');
  console.log(`座標：命中 ${hit}、沒查到 ${miss}、人工 ${manualN}、沿用 ${skipped}；共 ${pois.length} 站 → ${outPath}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
