// 打包：把一城的知識庫＋座標＋區＋步行矩陣＋一趟旅程＋規則參數＋國家層，打成手機要收的一個 JSON（DESIGN §3.2、計畫 1b T9）。
// 城市 id／名稱讀 <城>/city.json（沒有就停）；國家層照 city.json 的 countryId 找 kb/country/<id>.json。
// 用法：node tools/pack.mjs <知識庫資料夾> <trip.json> [--city <畫面用城市名>] [--country <country.json>] [--out <檔案>]
//   預設輸出 <知識庫資料夾>/../../packs/<tripId>.json，並複製一份成 packs/pack.json（伺服器給手機抓的就是這個）。
// 來源唯讀，只寫 packs/。
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizePoi } from '../src/data/schema.js';
import { buildPack } from '../src/data/pack.js';
import { zoneOfPoi } from '../src/geo/zones.js';
import { loadCity } from './lib/city.mjs';
import rulesJson from '../src/rules.json' with { type: 'json' };

async function readJson(file) { return existsSync(file) ? JSON.parse(await readFile(file, 'utf8')) : null; }

/** 讀一城：data.json 的 POI 全部規範化、同店多類別合併成一筆（alsoCategories）、歸區、套座標。 */
export async function loadCityKb(dir) {
  const data = await readJson(path.join(dir, 'data.json'));
  if (!data) throw new Error(`${dir} 沒有 data.json`);
  const zonesFile = (await readJson(path.join(dir, 'zones.json'))) ?? { zones: {}, links: {} };
  const coords = (await readJson(path.join(dir, 'coords.json'))) ?? {};
  const walk = (await readJson(path.join(dir, 'walk.json'))) ?? { pairs: {} };
  const list = Object.values(data.categories ?? {}).flatMap((v) => (Array.isArray(v) ? v : v.items ?? []));
  const byId = new Map(); const warnings = [];
  for (const raw of list) {
    const { poi, warnings: w } = normalizePoi(raw);
    for (const x of w) warnings.push(typeof x === 'string' ? { poiId: poi.id, msg: x } : { poiId: poi.id, ...x });
    if (byId.has(poi.id)) {
      const prev = byId.get(poi.id);
      if (poi.category && poi.category !== prev.category) prev.alsoCategories = [...new Set([...(prev.alsoCategories ?? []), poi.category])];
      continue;
    }
    poi.zoneId = zoneOfPoi(poi, zonesFile.zones);
    const c = coords[poi.id];
    if (c && Number.isFinite(c.lat) && Number.isFinite(c.lng)) { poi.lat = c.lat; poi.lng = c.lng; poi.coordConfidence = c.confidence ?? 'unknown'; }
    byId.set(poi.id, poi);
  }
  return { data, zones: { zones: zonesFile.zones ?? {}, links: zonesFile.links ?? {} }, pois: [...byId.values()], walk, warnings };
}

function count(list, fn) { const c = {}; for (const x of list) { const k = fn(x); c[k] = (c[k] ?? 0) + 1; } return c; }

async function main() {
  const args = process.argv.slice(2);
  const pos = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
  const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
  const [dir, tripFile] = pos;
  if (!dir || !tripFile) { console.error('用法：node tools/pack.mjs <知識庫資料夾> <trip.json> [--city <畫面用城市名>] [--country <country.json>] [--out <檔案>]'); process.exit(2); }
  const trip = await readJson(tripFile);
  if (!trip?.id) throw new Error(`${tripFile} 不是旅程檔（要有 id）`);
  const cityCfg = loadCity(dir);
  // 打包檔的 city 只放 id 與畫面名；其他城市設定（範圍、Valhalla）是桌機工具的事，手機不用
  const city = { id: cityCfg.id, name_zh: opt('--city') ?? cityCfg.name_zh };
  if (trip.countryId && trip.countryId !== cityCfg.countryId) console.warn(`旅程寫 countryId ${trip.countryId}、city.json 寫 ${cityCfg.countryId}：照 city.json`);
  const countryFile = opt('--country') ?? path.join(dir, '..', 'country', `${cityCfg.countryId}.json`);
  const country = await readJson(countryFile);
  if (!country) console.warn(`沒有國家層檔 ${countryFile}：餐段、夜間站、夏季規則會跳過並警告（範本在 kb/country/_template.json）`);
  const kb = await loadCityKb(dir);
  const pack = buildPack({ city, country, zones: kb.zones, pois: kb.pois, walk: kb.walk, trip, rulesJson });
  const outFile = opt('--out') ?? path.join(dir, '..', '..', 'packs', `${trip.id}.json`);
  await mkdir(path.dirname(outFile), { recursive: true });
  await writeFile(outFile, JSON.stringify(pack) + '\n', 'utf8');
  const latest = path.join(path.dirname(outFile), 'pack.json');
  if (path.resolve(latest) !== path.resolve(outFile)) await copyFile(outFile, latest);
  const withCoords = kb.pois.filter((p) => Number.isFinite(p.lat));
  const unknownPicks = (trip.days ?? []).flatMap((d) => (d.picks ?? []).map((p) => p.poiId)).filter((id) => !kb.pois.some((p) => p.id === id));
  console.log(`打包 ${trip.id}（${city.id}）：${kb.pois.length} 站（有座標 ${withCoords.length}：${JSON.stringify(count(withCoords, (p) => p.coordConfidence))}、歸區 ${kb.pois.filter((p) => p.zoneId).length}）、步行矩陣 ${Object.keys(kb.walk.pairs ?? {}).length} 對、${Object.keys(kb.zones.zones).length} 區、旅程 ${trip.days?.length ?? 0} 天、規範化警告 ${kb.warnings.length} 條 → ${outFile}`);
  if (unknownPicks.length) console.warn(`旅程裡有 ${unknownPicks.length} 個 poiId 不在知識庫：${unknownPicks.join('、')}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((err) => { console.error(err.message); process.exit(1); });
