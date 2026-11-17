// 打包檔：桌機把「知識庫＋旅程＋國家層＋步行矩陣」包成一個 JSON 給手機（決策樹 Q19；形狀借 case-lab：meta 在前、內容在後）。
// 手機用 meta 判斷要不要收；讀進來時每個 POI 過 normalizePoi（帶 pack.country：要準備的恢復站型的打包待辦從國家層來，T20），缺的補預設並留警告。純函式，Node 與瀏覽器共用。
import { normalizeAll } from './schema.js';

export const PACK_FORMAT = 'trip-pilot-pack';
/**
 * 打包檔的版本（meta.version）：新打的包標這個數字；讀的時候比這個數字新的不收（readPack 丟「打包檔版本 N 比 App 新，先更新 App」），一樣或比較舊的都收。
 * - 1：到 2026-10-27 為止的包。
 * - 2（2026-11-17）：11-06 第二批起的包帶版本 1 的 App 看不懂的東西——國家層 mealSlots 多了 breakfast（舊版 App 會把這一段當成一餐、畫面露出「今天沒排breakfast」並每天扣分；
 *   11-12 審查實測）、zones.json 連結的末班 last 可以寫 { weekday, saturday, holiday }（舊版當成沒資料）、站多了 meals／closedDates／samePlace／closeRisk。
 *   舊版 App 本來就有下面那道門，所以把新包標成 2，舊版就會拒收、叫他先更新 App，不會靜靜排出錯的行程。
 * 新版 App 照樣讀版本 1 的舊包（沒有那些欄位＝沒有早餐段、末班照單一時刻、能當哪一餐照店型推導，行為跟之前一樣）。沒寫版本的（手組的測試包）當舊的收。
 * 之後打包檔再多出「舊版 App 讀了會排錯」的東西才加一；只是多一個舊版會忽略的欄位不用動。
 */
export const PACK_VERSION = 2;

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
