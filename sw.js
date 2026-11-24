// Service Worker：App 殼 cache-first、版本化快取名、新版只在使用者按了橫幅後接手（決策樹 Q16）。
// __APP_VERSION__ 由 tools/build.mjs 注入；每次建置換一個快取名。
// 只管自己範圍裡的 App 殼（index.html、manifest、圖示）：之前對同源的 GET 一律 cache-first、拿到 200 就存，頁面改由桌機伺服器供應（/app/）之後，
// 同源的打包檔（../pack.json）與需求單端點（../brief）也會被攔——伺服器那邊靠 Vary: * 讓 cache.put 失敗才沒存住，每次留一筆沒接住的錯（11-06 上一批審查）。
// 現在殼以外的請求這裡不接手（沒呼叫 respondWith＝照瀏覽器平常的方式走網路），打包檔與 /brief 不會進快取。
const VERSION = "202611241235-ceb55c10";
const CACHE = `trip-pilot-${VERSION}`;
const PRECACHE = ['./', './index.html', './manifest.webmanifest'];
// 殼：範圍根（導覽）、index.html、manifest、icons/ 底下的 png。相對於註冊的範圍（GitHub Pages 是 /trip-pilot/、桌機伺服器是 /app/ 或 /trip-pilot/app/）
const SHELL = /^(?:|index\.html|manifest\.webmanifest|icons\/[A-Za-z0-9._-]+\.png)$/;

/** 這個請求是不是自己範圍裡的 App 殼（同源、路徑在範圍底下、而且是殼的那幾個檔）。 */
function isShell(url) {
  const scope = new URL(self.registration.scope);
  return url.origin === scope.origin && url.pathname.startsWith(scope.pathname) && SHELL.test(url.pathname.slice(scope.pathname.length));
}

self.addEventListener('install', (event) => {
  // 不呼叫 skipWaiting：舊版繼續服務，直到使用者按「重新載入」。
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET' || !isShell(new URL(event.request.url))) return;
  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then((hit) => hit || fetch(event.request).then((res) => {
      if (res.ok) {
        const copy = res.clone();
        // 存不進去（配額滿、回應帶 Vary: *）不影響這次的回應，也不留一筆沒接住的錯
        caches.open(CACHE).then((cache) => cache.put(event.request, copy)).catch(() => {});
      }
      return res;
    })),
  );
});
