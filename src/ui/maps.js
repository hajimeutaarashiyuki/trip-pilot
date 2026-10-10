// Google Maps 深連結（原話 #157「可不可以再加一個超連結的功能 讓我從程式轉到GOOGLE MAPS 看路線」）。
// 不內嵌地圖、不接路線 API（DESIGN §3.1、§10），只拼網址；純函式，Node 與瀏覽器共用。
// 座標只有查到店本身（exact／address）或人工釘（manual）才拿來當地點；區心頂替（zone）、歸不到區（unzoned）、名字對不上（fuzzy）
// 的座標會指到別的地方，改用文字查：知識庫寫的 maps_query 優先，沒有才用 當地名＋城市名。
// Google Maps URLs（developers.google.com/maps/documentation/urls/get-started）：search 的 query、dir 的 origin／destination
// 都收「地名、地址、或逗號分隔的經緯度」；dir 不給 origin 就從裝置現在位置出發；travelmode 用 walking／transit。
const SEARCH = 'https://www.google.com/maps/search/?api=1';
const DIR = 'https://www.google.com/maps/dir/?api=1';
const TRUSTED = new Set(['exact', 'address', 'manual']);

const isNum = (v) => Number.isFinite(v);

/** 可信的座標 → 'lat,lng'（小數五位）；沒有 coordConfidence 但有數字座標（示範資料、住宿）也算可信；其餘回 null。 */
export function coordQuery(poi) {
  if (!poi || !isNum(poi.lat) || !isNum(poi.lng)) return null;
  const conf = poi.coordConfidence;
  if (conf != null && !TRUSTED.has(conf)) return null;
  return `${poi.lat.toFixed(5)},${poi.lng.toFixed(5)}`;
}

/** 這一站在 Google Maps 要怎麼查：可信座標用座標，否則用文字（maps_query → 當地名＋城市名）。 */
export function placeQuery(poi, cityName = '') {
  const byCoord = coordQuery(poi);
  if (byCoord) return byCoord;
  if (typeof poi?.maps_query === 'string' && poi.maps_query.trim()) return poi.maps_query.trim();
  const name = String(poi?.name_local || poi?.name_zh || '').trim();
  const city = String(cityName ?? '').trim();
  return [name, city].filter(Boolean).join(' ');
}

/** 看這一站的地點。 */
export function placeUrl(poi, cityName = '') {
  return `${SEARCH}&query=${encodeURIComponent(placeQuery(poi, cityName))}`;
}

/**
 * routeUrl({ from, to, mode, cityName }) → 從 from 到 to 的路線；from 不給就不帶 origin（Google Maps 用現在位置）。
 * mode 'ride' → transit，其餘 → walking。
 */
export function routeUrl({ from = null, to, mode = 'walk', cityName = '' }) {
  const origin = from ? `&origin=${encodeURIComponent(placeQuery(from, cityName))}` : '';
  return `${DIR}${origin}&destination=${encodeURIComponent(placeQuery(to, cityName))}&travelmode=${mode === 'ride' ? 'transit' : 'walking'}`;
}

/** 這一段是搭車還是走路：legFn 有給 mode 就照它，沒有看 rideMin。 */
export function legMode(leg) {
  return leg?.mode === 'ride' || (leg?.rideMin ?? 0) > 0 ? 'ride' : 'walk';
}

/** 文字查詢要帶的城市名：打包檔的 city.name_zh → 旅程的 cityName → 旅程的 cityId；都沒有就空字串（只用店名）。 */
export function tripCityName(state) {
  return state?.packMeta?.city?.name_zh ?? state?.trip?.cityName ?? state?.trip?.cityId ?? '';
}
