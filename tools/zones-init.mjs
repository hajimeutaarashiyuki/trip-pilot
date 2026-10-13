// 從 coords.json 有座標的站聚類出 zones.json 草案（原話 #167：新城市先有區，geocode 才能驗位置、引擎才能歸區）。
// 用法：node tools/zones-init.mjs <知識庫資料夾> [--radius 800] [--apply] [--force]
//   不帶 --apply 只印摘要與前幾群；--apply 寫 <城>/zones.json（已存在就拒絕，除非 --force）。
//   聚類與命名的純函式在 src/geo/zones-init.js。區心頂替（confidence: zone）的座標不是真位置，不拿來聚類。
// 產出是草案：區名、keywords、environment（全標 urban）、links（空）都要人看過；跨區搭車連結照仙台 zones.json 的形狀補。
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCity } from './lib/city.mjs';
import { loadPois } from './geocode.mjs';
import { clusterPois, zoneDraft, DEFAULT_RADIUS_M } from '../src/geo/zones-init.js';

const PREVIEW = 5;

/** 有真座標的站（跳過 null 與區心頂替）套上 lat/lng，給聚類用。 */
export function poisWithCoords(pois, coords) {
  const out = [];
  for (const poi of pois) {
    const c = coords[poi.id];
    if (!c || !Number.isFinite(c.lat) || !Number.isFinite(c.lng) || c.confidence === 'zone') continue;
    out.push({ ...poi, lat: c.lat, lng: c.lng });
  }
  return out;
}

export function summarize(draft, clusters) {
  const ids = Object.keys(draft.zones);
  const noKeywords = ids.filter((id) => draft.zones[id].keywords.length === 0);
  const lines = [`${clusters.reduce((s, c) => s + c.members.length, 0)} 站 → ${ids.length} 區${noKeywords.length ? `；${noKeywords.length} 區沒有獨有關鍵字（${noKeywords.join('、')}），要手動補` : ''}`];
  ids.slice(0, PREVIEW).forEach((id, i) => {
    const z = draft.zones[id]; const c = clusters[i];
    lines.push(`- ${id}　${z.name_zh}　${c.members.length} 站　半徑 ${z.radiusM} m　keywords ${z.keywords.slice(0, 6).join('、')}${z.keywords.length > 6 ? '…' : ''}`);
    lines.push(`  ${c.members.slice(0, 4).map((p) => p.name_zh).join('、')}${c.members.length > 4 ? `…（共 ${c.members.length}）` : ''}`);
  });
  if (ids.length > PREVIEW) lines.push(`…另 ${ids.length - PREVIEW} 區`);
  return lines.join('\n');
}

async function main() {
  const args = process.argv.slice(2);
  const dir = args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1] === '--radius'));
  if (!dir) { console.error('用法：node tools/zones-init.mjs <知識庫資料夾> [--radius 800] [--apply] [--force]'); process.exit(2); }
  const ri = args.indexOf('--radius');
  const radiusM = ri >= 0 ? Number(args[ri + 1]) : DEFAULT_RADIUS_M;
  if (!Number.isFinite(radiusM) || radiusM <= 0) throw new Error('--radius 要是正數（公尺）');
  const apply = args.includes('--apply'); const force = args.includes('--force');
  const city = loadCity(dir);
  const coordsPath = path.join(dir, 'coords.json');
  if (!existsSync(coordsPath)) throw new Error(`${coordsPath} 不存在：先跑 node tools/geocode.mjs ${dir}（沒有 zones.json 時是無區模式，查完再回來聚類）`);
  const outPath = path.join(dir, 'zones.json');
  if (apply && existsSync(outPath) && !force) throw new Error(`${outPath} 已存在：不覆蓋（確定要重產就加 --force，手改過的區名與 links 會不見）`);
  const kb = JSON.parse(await readFile(path.join(dir, 'data.json'), 'utf8'));
  const coords = JSON.parse(await readFile(coordsPath, 'utf8'));
  const pois = poisWithCoords(loadPois(kb), coords);
  if (!pois.length) throw new Error('coords.json 沒有任何真座標（null 或區心頂替不算），聚不出區');
  const clusters = clusterPois(pois, { radiusM });
  const draft = zoneDraft(clusters, { cityNames: [city.name_zh, city.name_local], radiusM });
  console.log(`城市 ${city.id}：半徑 ${radiusM} m，${summarize(draft, clusters)}`);
  if (!apply) { console.log(`試跑：沒寫檔；加 --apply 寫 ${outPath}`); return; }
  await writeFile(outPath, JSON.stringify(draft, null, 1) + '\n', 'utf8');
  console.log(`寫入 ${Object.keys(draft.zones).length} 區 → ${outPath}（草案：區名、keywords、environment、links 要人看過）`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((err) => { console.error(err.message); process.exit(1); });
