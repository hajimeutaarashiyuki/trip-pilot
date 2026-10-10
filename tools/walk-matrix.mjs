// 打本機 Valhalla 的 /sources_to_targets（pedestrian），把一城有座標的站兩兩之間的步行分鐘寫成 walk.json。
// 用法：node tools/walk-matrix.mjs ../kb/sendai [--url http://127.0.0.1:8002] [--batch 50]
// 輸出：<城>/walk.json  { "<a>|<b>": { "min": 12, "m": 950 } }，雙向各一筆；查不到（Valhalla 回 null）的不寫。
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export async function matrix({ url, locations, costing = 'pedestrian', options = {} }) {
  const body = { sources: locations, targets: locations, costing, costing_options: { pedestrian: { walking_speed: 5.1, use_hills: 0.5, ...options } }, units: 'kilometers' };
  const res = await fetch(`${url}/sources_to_targets`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`Valhalla ${res.status}：${(await res.text()).slice(0, 200)}`);
  return res.json();
}

async function main() {
  const dir = process.argv[2];
  if (!dir) { console.error('用法：node tools/walk-matrix.mjs <知識庫資料夾> [--url http://127.0.0.1:8002] [--batch 50]'); process.exit(2); }
  const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
  const url = arg('--url', 'http://127.0.0.1:8002');
  const batch = Number(arg('--batch', 50));
  const coords = JSON.parse(await readFile(path.join(dir, 'coords.json'), 'utf8'));
  const ids = Object.keys(coords).filter((id) => coords[id] && Number.isFinite(coords[id].lat));
  const out = {};
  let pairs = 0; let missing = 0;
  // Valhalla 預設 max_locations 有限；分批：每批 sources = 一段，targets = 全部（分段）
  for (let i = 0; i < ids.length; i += batch) {
    const src = ids.slice(i, i + batch);
    for (let j = 0; j < ids.length; j += batch) {
      const tgt = ids.slice(j, j + batch);
      const body = {
        sources: src.map((id) => ({ lat: coords[id].lat, lon: coords[id].lng })),
        targets: tgt.map((id) => ({ lat: coords[id].lat, lon: coords[id].lng })),
        costing: 'pedestrian', costing_options: { pedestrian: { walking_speed: 5.1, use_hills: 0.5 } }, units: 'kilometers',
      };
      const res = await fetch(`${url}/sources_to_targets`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error(`Valhalla ${res.status}：${(await res.text()).slice(0, 200)}`);
      const data = await res.json();
      data.sources_to_targets.forEach((row, si) => row.forEach((cell, ti) => {
        const a = src[si]; const b = tgt[ti];
        if (a === b) return;
        if (cell.time == null) { missing++; return; }
        out[`${a}|${b}`] = { min: Math.round(cell.time / 60), m: Math.round(cell.distance * 1000) };
        pairs++;
      }));
      console.log(`批 ${i / batch + 1}-${j / batch + 1} 完成，累計 ${pairs} 對`);
    }
  }
  const outPath = path.join(dir, 'walk.json');
  await writeFile(outPath, JSON.stringify({ _說明: 'Valhalla pedestrian（含坡度）站對站步行分鐘；由 tools/walk-matrix.mjs 產', generatedAt: new Date().toISOString(), pairs: out }, null, 0) + '\n', 'utf8');
  console.log(`寫入 ${pairs} 對、查不到 ${missing} 對、${ids.length} 站 → ${outPath}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
