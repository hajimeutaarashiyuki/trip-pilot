// 打包檔：桌機把「知識庫＋旅程＋國家層＋步行矩陣」包成一個 JSON 給手機（決策樹 Q19；形狀借 case-lab：meta 在前、內容在後）。
// 手機用 meta 判斷要不要收；讀進來時每個 POI 過 normalizePoi（帶 pack.country：要準備的恢復站型的打包待辦從國家層來，T20），缺的補預設並留警告。純函式，Node 與瀏覽器共用。
import { normalizeAll } from './schema.js';

export const PACK_FORMAT = 'trip-pilot-pack';
export const PACK_VERSION = 1;

/** buildPack({ city, country, zones, pois, walk, trip, rulesJson, generatedAt }) → 打包物件（可直接 JSON.stringify）。 */
export function buildPack({ city, country, zones = {}, pois = [], walk = {}, trip, rulesJson = null, generatedAt = new Date().toISOString(), profileRev = null }) {
  if (!city?.id) throw new Error('打包要有 city.id');
  if (!trip?.id) throw new Error('打包要有 trip.id');
  return {
    meta: { format: PACK_FORMAT, version: PACK_VERSION, generatedAt, cityId: city.id, tripId: trip.id, poiCount: pois.length, profileRev },
    city, country: country ?? null, zones, pois, walk, trip, rules: rulesJson,
  };
}

/** readPack(json) → { pack, pois, warnings }；格式不對丟 Error（這是唯一會丟的地方，讓手機能明確說「這不是打包檔」）。 */
export function readPack(json) {
  const pack = typeof json === 'string' ? JSON.parse(json) : json;
  if (!pack || pack.meta?.format !== PACK_FORMAT) throw new Error('這不是 Trip Pilot 的打包檔');
  if (pack.meta.version > PACK_VERSION) throw new Error(`打包檔版本 ${pack.meta.version} 比 App 新，先更新 App`);
  if (!pack.trip?.id || !pack.city?.id) throw new Error('打包檔缺旅程或城市');
  const { pois, warnings } = normalizeAll(pack.pois ?? [], { country: pack.country ?? null });
  return { pack, pois, warnings };
}

/** 兩個打包檔誰新：generatedAt 字串比對（ISO 8601 可以直接比）。 */
export function isNewer(a, b) {
  return String(a?.meta?.generatedAt ?? '') > String(b?.meta?.generatedAt ?? '');
}
