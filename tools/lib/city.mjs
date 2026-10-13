// 城市設定：kb/<城>/city.json 一份管一城（原話 #167：換城市或國家只動資料不動程式）。
// 形狀：{ id, name_zh, name_local, countryId, center: { lat, lng }, bbox?: { west, south, east, north }, bboxKm?, valhalla?: { region, container, port }, notes }
//   bbox：查座標只收這個範圍；缺就用 center ± bboxKm（預設 DEFAULT_BBOX_KM）推。
//   valhalla：一區一容器一埠；walk-matrix 打 http://127.0.0.1:<port>，city-pipeline 連不上時用 region 提示怎麼建。
// 沒有 city.json 就明確報錯要人先建，不退回任何城市的預設值。
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

export const CITY_FILE = 'city.json';
export const DEFAULT_BBOX_KM = 30;

export function cityPath(dir) { return path.join(dir, CITY_FILE); }

const round5 = (n) => Math.round(n * 1e5) / 1e5;

/** 由中心與公里數推 bbox：緯度 1 度約 111 km，經度照 cos(緯度) 縮。 */
export function bboxAround(center, km = DEFAULT_BBOX_KM) {
  const dLat = km / 111;
  const dLng = km / (111 * Math.cos((center.lat * Math.PI) / 180));
  return { west: round5(center.lng - dLng), south: round5(center.lat - dLat), east: round5(center.lng + dLng), north: round5(center.lat + dLat) };
}

/** 點在不在框內；沒有框就不擋。 */
export function inBbox(point, bbox) {
  if (!bbox) return true;
  return point.lng >= bbox.west && point.lng <= bbox.east && point.lat >= bbox.south && point.lat <= bbox.north;
}

const isNum = (n) => typeof n === 'number' && Number.isFinite(n);

/** 驗形狀、補推導欄位（bbox、name_local、valhalla.container）；錯的欄位直接丟 Error 說哪一欄。 */
export function parseCity(raw, file = CITY_FILE) {
  if (!raw || typeof raw !== 'object') throw new Error(`${file} 不是物件`);
  const bad = (what) => new Error(`${file}：${what}`);
  if (!raw.id || typeof raw.id !== 'string') throw bad('缺 id（小寫英文，例 sendai；打包檔的 cityId 用這個）');
  if (!raw.name_zh) throw bad('缺 name_zh（畫面用的城市名）');
  if (!raw.countryId) throw bad('缺 countryId（對應 kb/country/<countryId>.json）');
  if (!raw.center || !isNum(raw.center.lat) || !isNum(raw.center.lng)) throw bad('缺 center.lat／center.lng（市中心或主要車站）');
  let bbox;
  if (raw.bbox) {
    const b = raw.bbox;
    if (!['west', 'south', 'east', 'north'].every((k) => isNum(b[k]))) throw bad('bbox 要有 west、south、east、north 四個數字');
    if (!(b.west < b.east && b.south < b.north)) throw bad('bbox 的 west 要小於 east、south 要小於 north');
    if (!inBbox(raw.center, b)) throw bad('center 不在 bbox 裡');
    bbox = { west: b.west, south: b.south, east: b.east, north: b.north };
  } else {
    const km = raw.bboxKm ?? DEFAULT_BBOX_KM;
    if (!isNum(km) || km <= 0) throw bad('bboxKm 要是正數（公里）');
    bbox = bboxAround(raw.center, km);
  }
  let valhalla = null;
  if (raw.valhalla) {
    const v = raw.valhalla;
    if (!Number.isInteger(v.port) || v.port <= 0) throw bad('valhalla.port 要是埠號整數');
    if (!v.region) throw bad('valhalla.region 要填 Geofabrik 分區路徑（例 asia/japan/tohoku）');
    valhalla = { region: v.region, container: v.container ?? `valhalla-${String(v.region).split('/').at(-1)}`, port: v.port };
  }
  return {
    id: raw.id,
    name_zh: raw.name_zh,
    name_local: raw.name_local ?? raw.name_zh,
    countryId: raw.countryId,
    center: { lat: raw.center.lat, lng: raw.center.lng },
    bbox,
    bboxDerived: !raw.bbox,
    valhalla,
    notes: raw.notes ?? null,
  };
}

/** loadCity(dir) → 解析後的城市設定；沒有 city.json 丟 Error（訊息說要先建）。 */
export function loadCity(dir) {
  const file = cityPath(dir);
  if (!existsSync(file)) {
    throw new Error(`${file} 不存在：先建 city.json（照 kb/sendai/city.json 的形狀：id、name_zh、name_local、countryId、center、bbox 或 bboxKm、valhalla）`);
  }
  return parseCity(JSON.parse(readFileSync(file, 'utf8')), file);
}

/** Valhalla 服務網址（本機、一區一埠）；city.json 沒寫 valhalla 回 null。 */
export function valhallaUrl(city) {
  return city?.valhalla?.port ? `http://127.0.0.1:${city.valhalla.port}` : null;
}

/** 建容器的指令提示（walk-matrix 連不上、city-pipeline 跳過矩陣時印）。 */
export function valhallaHint(city) {
  const v = city?.valhalla;
  if (!v) return 'city.json 沒寫 valhalla：補 { region, container, port } 再跑 node tools/valhalla/build.mjs --region <region> --port <port> --apply';
  return `容器 ${v.container} 沒在跑？已建過就 docker start ${v.container}；還沒建：node tools/valhalla/build.mjs --region ${v.region} --port ${v.port} --apply`;
}
