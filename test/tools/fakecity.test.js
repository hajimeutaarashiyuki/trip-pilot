// 假城市走完整條管線，不打網路、不建容器、不改程式（原話 #167）：
// geocode 純函式（假 lookup、city.json 的 bbox）→ zones-init 草案 → 查不到的站區心頂替 → kb-check → buildPack → 手機端 readPack → 引擎排一天。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCity } from '../../tools/lib/city.mjs';
import { loadPois, geocodePoi, zoneFor, zoneCenter, planAction } from '../../tools/geocode.mjs';
import { poisWithCoords } from '../../tools/zones-init.mjs';
import { checkKb } from '../../tools/kb-check.mjs';
import { clusterPois, zoneDraft } from '../../src/geo/zones-init.js';
import { zoneOfPoi } from '../../src/geo/zones.js';
import { buildPack, readPack } from '../../src/data/pack.js';
import { planPackFile } from '../../tools/plan-report.mjs';
import rulesJson from '../../src/rules.json' with { type: 'json' };

const DIR = fileURLToPath(new URL('../fixtures/kb/fakecity/', import.meta.url));
// 國家層用真的 jp.json（文件倉庫）；這台機器沒有就用同形狀的內建值
const JP = fileURLToPath(new URL('../../../kb/country/jp.json', import.meta.url));
const country = existsSync(JP)
  ? JSON.parse(readFileSync(JP, 'utf8'))
  : { id: 'jp', name_zh: '日本', mealSlots: { lunch: ['11:30', '13:30'], dinner: ['18:00', '20:30'] }, nightSlot: ['20:00', '24:00'], climate: { summerMonths: [6, 7, 8, 9] }, utcOffsetMin: 540 };

// 假的查詢結果（座標是假的）；幻の喫茶故意沒有
const HITS = {
  北町神社: { lat: 35.012, lng: 135.000 },
  北町珈琲: { lat: 35.013, lng: 135.003 },
  南町天満宮: { lat: 34.990, lng: 135.000 },
  南町カフェ: { lat: 34.989, lng: 135.004 },
};

test('假城市：查座標（假 lookup）→ 聚類出區 → 歸區率 100% → 打包得出來 → 引擎排得出一天', async () => {
  const city = loadCity(DIR);
  const data = JSON.parse(readFileSync(path.join(DIR, 'data.json'), 'utf8'));
  const pois = loadPois(data);
  assert.equal(pois.length, 5);
  assert.deepEqual([...new Set(pois.map((p) => p.category))].sort(), ['cafe', 'shrine']);

  // 1. geocode：每個查詢的第一個候選故意放在框外（別城的同名店），要被 city.json 的 bbox 擋掉；幻の喫茶查不到
  const seen = [];
  const lookup = async (q, kind, zone, bbox) => {
    seen.push({ q, bbox });
    const key = Object.keys(HITS).find((k) => q.startsWith(k));
    if (!key) return [];
    const hit = { ...HITS[key], name: key, display: `${key}, ${city.name_local}`, source: 'photon' };
    return [{ ...hit, lat: hit.lat + 1, display: `${key}, 別的城` }, hit];
  };
  const coords = {};
  for (const poi of pois) coords[poi.id] = await geocodePoi(poi, city.name_local, null, lookup, city.bbox, { delayMs: 0 });
  assert.ok(seen.length > 0 && seen.every((s) => s.bbox === city.bbox), 'lookup 收到 city.json 的 bbox');
  assert.equal(Object.values(coords).filter(Boolean).length, 4);
  assert.equal(coords['幻の喫茶'], null);
  assert.ok(Object.values(coords).filter(Boolean).every((c) => c.confidence === 'exact' && c.lat < 35.1), '框外的候選被擋掉');

  // 2. zones-init：兩群（北町、南町）；沒座標的幻の喫茶靠 area 的「南町」歸得到 → 100%
  const clusters = clusterPois(poisWithCoords(pois, coords), { radiusM: 800 });
  const draft = zoneDraft(clusters, { cityNames: [city.name_zh, city.name_local] });
  assert.deepEqual(Object.keys(draft.zones), ['北町', '南町']);
  const zoned = pois.map((p) => zoneOfPoi(p, draft.zones));
  assert.ok(zoned.every(Boolean), `歸區率要 100%：${JSON.stringify(zoned)}`);

  // 3. 查不到的站用區心頂替（geocode --fill 的做法）
  const toFill = pois.filter((p) => planAction({ poi: p, mode: 'fill', cur: coords[p.id], manual: undefined, zone: zoneFor(p, draft.zones) }) === 'fill');
  assert.deepEqual(toFill.map((p) => p.id), ['幻の喫茶']);
  for (const p of toFill) coords[p.id] = zoneCenter(zoneFor(p, draft.zones));
  assert.equal(coords['幻の喫茶'].confidence, 'zone');
  assert.equal(coords['幻の喫茶'].zoneId, '南町');

  // 4. kb-check：有區有座標 → 可以打包
  const check = checkKb({ data, zones: draft.zones, coords });
  assert.equal(check.verdict.ok, true, check.verdict.blocking.join(' / '));
  assert.equal(check.zones.zoned, 5);
  assert.equal(check.coords.covered, 5);

  // 5. 打包（跟 tools/pack.mjs 同一條路：規範化 → 歸區 → 套座標 → buildPack）→ 手機端 readPack
  const packed = pois.map((p) => ({ ...p, zoneId: zoneOfPoi(p, draft.zones), lat: coords[p.id].lat, lng: coords[p.id].lng, coordConfidence: coords[p.id].confidence }));
  const trip = {
    id: 'fake-trial', name: '假城試走', cityName: city.name_zh, countryId: 'jp', party: 1,
    homeBases: [{ poi: { id: 'home', name_zh: '飯店', zoneId: '北町', lat: 35.012, lng: 135.001, coordConfidence: 'zone' } }],
    days: [{
      date: '2026-11-01', type: 'normal', earlyDay: false, anchor: { poiId: '北町神社' },
      picks: [
        { poiId: '北町神社', priority: 'must', dwellMin: 30 }, { poiId: '北町珈琲', priority: 'want', dwellMin: 60 },
        { poiId: '南町天満宮', priority: 'want', dwellMin: 30 }, { poiId: '南町カフェ', priority: 'maybe', dwellMin: 45 }, { poiId: '幻の喫茶', priority: 'maybe', dwellMin: 60 },
      ],
    }],
  };
  const pack = buildPack({ city: { id: city.id, name_zh: city.name_zh }, country, zones: { zones: draft.zones, links: draft.links }, pois: packed, walk: { pairs: {} }, trip, rulesJson });
  const read = readPack(JSON.stringify(pack));
  assert.equal(read.pack.meta.cityId, 'fakecity');
  assert.equal(read.pack.meta.poiCount, 5);
  assert.equal(read.pois.length, 5);
  assert.ok(read.pois.every((p) => p.zoneId && Number.isFinite(p.lat)));

  // 6. 引擎排一天（plan-report 走的同一條路；沒有 walk.json 就退直線估）
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'tp-fakecity-')), 'pack.json');
  writeFileSync(file, JSON.stringify(pack), 'utf8');
  const r = await planPackFile(file);
  assert.equal(r.result.days.length, 1);
  const seq = r.result.days[0].plan.sequence;
  assert.ok(seq.length >= 1);
  assert.ok(seq.some((s) => s.poi.id === '北町神社'), '主行程要排進去');
});
