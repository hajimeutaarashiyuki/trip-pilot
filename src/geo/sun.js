// 日出日落：NOAA 的太陽位置公式（Solar Calculator 試算表那一版），自己算、不接 API（DESIGN §1.8 日照：公式算、不接 API）。
// 回的都是「當地時間、當天 00:00 起算的分鐘數」，跟 engine/time.js 同一套單位；精度約 ±2 分，白天站的 30 分邊界夠用。
// 極夜回 sunrise＝sunset（沒有白天）、極晝回整天（noon±720），都不丟例外。
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

/** 'YYYY-MM-DD' → 儒略日數（整數＝當天 12:00 UT）。 */
function julianDayNumber(dateStr) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  const a = Math.floor((14 - m) / 12);
  const yy = y + 4800 - a;
  const mm = m + 12 * a - 3;
  return d + Math.floor((153 * mm + 2) / 5) + 365 * yy + Math.floor(yy / 4) - Math.floor(yy / 100) + Math.floor(yy / 400) - 32045;
}

/**
 * sunTimes(dateStr, lat, lng, utcOffsetMin) → { sunriseMin, sunsetMin }（當地時間的分鐘數）
 * - lat／lng 十進位度，東經為正；utcOffsetMin 當地時區（日本 540）
 */
export function sunTimes(dateStr, lat, lng, utcOffsetMin = 0) {
  // 以當地正午為基準時刻算太陽位置：JDN 是當天 12:00 UT，減掉時區就是當地正午
  const jd = julianDayNumber(dateStr) - utcOffsetMin / 1440;
  const jc = (jd - 2451545) / 36525;
  const L0 = (((280.46646 + jc * (36000.76983 + jc * 0.0003032)) % 360) + 360) % 360;   // 太陽平黃經
  const M = 357.52911 + jc * (35999.05029 - 0.0001537 * jc);                             // 太陽平近點角
  const e = 0.016708634 - jc * (0.000042037 + 0.0000001267 * jc);                          // 地球軌道離心率
  const C = Math.sin(rad(M)) * (1.914602 - jc * (0.004817 + 0.000014 * jc)) + Math.sin(rad(2 * M)) * (0.019993 - 0.000101 * jc) + Math.sin(rad(3 * M)) * 0.000289;
  const omega = 125.04 - 1934.136 * jc;
  const appLong = L0 + C - 0.00569 - 0.00478 * Math.sin(rad(omega));                      // 視黃經
  const obliq = 23 + (26 + (21.448 - jc * (46.815 + jc * (0.00059 - jc * 0.001813))) / 60) / 60 + 0.00256 * Math.cos(rad(omega));
  const decl = deg(Math.asin(Math.sin(rad(obliq)) * Math.sin(rad(appLong))));             // 赤緯
  const y = Math.tan(rad(obliq / 2)) ** 2;
  const eqTime = 4 * deg(y * Math.sin(2 * rad(L0)) - 2 * e * Math.sin(rad(M)) + 4 * e * y * Math.sin(rad(M)) * Math.cos(2 * rad(L0)) - 0.5 * y * y * Math.sin(4 * rad(L0)) - 1.25 * e * e * Math.sin(2 * rad(M)));   // 均時差（分）
  // 日出日落的時角：太陽中心在地平線下 0.833°（視半徑＋大氣折射）
  const cosHA = Math.cos(rad(90.833)) / (Math.cos(rad(lat)) * Math.cos(rad(decl))) - Math.tan(rad(lat)) * Math.tan(rad(decl));
  const ha = deg(Math.acos(Math.max(-1, Math.min(1, cosHA))));   // 極夜 cosHA>1 → 0；極晝 cosHA<−1 → 180
  const noonMin = 720 - 4 * lng - eqTime + utcOffsetMin;         // 當地太陽正午
  return { sunriseMin: noonMin - 4 * ha, sunsetMin: noonMin + 4 * ha };
}

/**
 * daylightWindow(dateStr, at, marginMin, utcOffsetMin) → { startMin: 日出+margin, endMin: 日落−margin }
 * - at：{ lat, lng }；margin 兩頭各留的分鐘（profile §3.1「日出+30 到日落−30」）
 */
export function daylightWindow(dateStr, at, marginMin = 30, utcOffsetMin = 0) {
  const { sunriseMin, sunsetMin } = sunTimes(dateStr, at.lat, at.lng, utcOffsetMin);
  return { startMin: sunriseMin + marginMin, endMin: sunsetMin - marginMin };
}
