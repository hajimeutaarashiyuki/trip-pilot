// 桌機上的 Trip Pilot 伺服器（開機自啟，埠 18810）。三件事：
//   1. 打包檔：手機（tailscale 連回桌機）按「更新」來這裡抓 pack.json。只讀 packs/，只有 GET／HEAD。
//   2. 頁面：GET /app/ 供應 dist/ 的 PWA（index.html、sw.js、manifest、icons）。他在桌機開 http://127.0.0.1:18810/app/#/brief 填需求單
//      （原話 #186：需求單在電腦上填），頁面跟下面的 /brief 同源，不用跨來源打本機
//      （11-06 主控實測：從 GitHub Pages 的頁面打 http://127.0.0.1，Chrome 156 會卡在「允許連線區域網路」的權限提示）。
//   3. 需求單：POST /brief?name=<名字> 把頁面「提交」的文字寫成 trips/<名字>.brief.md（原話 #188「需求單在網頁輸出成一份MD檔到 trip-pilot 資料夾」）。
//      同名舊檔內容不同：先搬到 trips/_brief-history/<名字>-<YYYYMMDD-HHmmss>.brief.md 再寫（他提交後手改過的不會被蓋掉、要再提交也行）；內容相同就不動。
//      整支只有這裡會寫檔：檔首 ACCEPT_BRIEFS 是開關，命令列 --no-briefs 只關這一次。只收同源頁面（或 curl 這類不是瀏覽器的）送來的，別的網站的頁面寫不進來。
// 掛法：tailscale serve --bg --set-path /trip-pilot http://127.0.0.1:18810
//   → 手機用 https://<桌機>.ts.net/trip-pilot/pack.json；App 在 GitHub Pages，所以打包檔要給 CORS（tailnet 內才連得到，開 * 沒關係），/app/ 的靜態檔沿用同一組標頭；/brief 不給。
// 用法：node tools/serve-packs.mjs [--dir <packs>] [--port 18810] [--log <檔>] [--app <dist>] [--briefs <trips>] [--no-briefs]
//   --log：開機排程沒有 stdout，寫到檔。資料夾給相對路徑的話相對於 app/tools/（--dir 一直是這樣）。開機排程的命令列只帶 --log，其餘走檔首預設。
// 測試：createPackServer({ dir, appDir, briefDir, … }) 回一個還沒 listen 的 http.Server（test/tools/serve-packs.test.js）；這支被 import 時不會自己開埠。
import http from 'node:http';
import { stat, readFile, appendFile, writeFile, rename, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// === 需修改 ===
const DEFAULT_PORT = 18810;          // 2026-10-10 查過 WinNAT 排除區與其他專案的 DEFAULT_PORT（18765／18801／18802）
const DEFAULT_DIR = '../../packs';   // 相對於 app/tools/：專案根目錄的 packs/（打包工具的預設輸出處）
const DEFAULT_APP_DIR = '../dist';   // 相對於 app/tools/：建置出來的 PWA（npm run build）
const DEFAULT_BRIEF_DIR = '../../trips';   // 相對於 app/tools/：專案根目錄的 trips/，需求單寫成 <名字>.brief.md
const ACCEPT_BRIEFS = true;          // 收不收需求單（POST /brief 會寫檔）。false＝整支唯讀；--no-briefs 是只關這一次
const BRIEF_MAX_BYTES = 256 * 1024;  // 需求單本文上限（現有的 trips/2026-08-sendai-test.brief.md 是 3,676 bytes）
const BRIEF_NAME_MAX = 80;           // 名字最長幾個字（歷史檔名還要接時間，留餘裕給 NTFS 的 255）
const BRIEF_HISTORY_DIR = '_brief-history';   // 同名舊檔搬到 <需求單資料夾>/這裡
const BRIEF_TRUSTED_HOSTS = ['.ts.net'];      // 本機（127.0.0.1、localhost）以外，頁面還能從哪些主機名開來提交：tailscale serve 的網域。別的主機名一律拒收（擋 DNS rebinding）
const MOUNT_PREFIX = '/trip-pilot';  // tailscale serve --set-path 掛的路徑；有沒有帶這個前綴都接受
// === 以上 ===

const here = path.dirname(fileURLToPath(import.meta.url));
const TYPES = {
  '.json': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS', 'Access-Control-Allow-Headers': '*', 'Cache-Control': 'no-store' };
const NO_STORE = { 'Cache-Control': 'no-store' };
// Vary: * 的回應進不了 Cache Storage（Service Worker 規格：cache.put／addAll 遇到直接以 TypeError 拒絕，11-06 對過 w3c.github.io/ServiceWorker 的 put 步驟 7.2.1），
// 所以頁面的 service worker 存不住它、每次都走網路。給「永遠要最新」的回應用：打包檔、/brief 的探測。
const NEVER_STORED = { Vary: '*' };
const BRIEF_ALLOW = { Allow: 'GET, HEAD, POST, OPTIONS' };
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);
// /app/ 底下每一段路徑只收英數開頭與結尾、中間可以有 . _ -：dist 裡的檔都符合；..、反斜線、冒號（磁碟代號、資料流）、開頭的點、結尾的點都進不來
const APP_SEGMENT = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;
const DEVICE_NAME = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;   // Windows 的裝置名：接了副檔名還是可能被當成裝置
const BRIEF_ERRORS = {
  disabled: '這台伺服器現在不收需求單（ACCEPT_BRIEFS 關著，或啟動時帶了 --no-briefs）',
  'cross-origin': '只收同一個來源的頁面送來的需求單',
  'bad-type': '本文要是 text/markdown 或 text/plain（UTF-8）',
  'too-large': '需求單超過大小上限',
  empty: '本文是空的',
  'not-utf8': '本文不是 UTF-8',
  'write-failed': '寫檔失敗',
  method: '這個網址只收 GET、HEAD、POST',
};

const pad = (n) => String(n).padStart(2, '0');
const localDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/** 歷史檔名裡的時間：桌機當地時間 YYYYMMDD-HHmmss（搬走那一刻）。 */
export function historyStamp(d) {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/**
 * 需求單的名字 → 檔名能用的一段（不含 .brief.md）：各國文字與數字、-、_ 留著（中日文、英數都在內），其餘（路徑字元、空白、標點）連成一個 -；
 * 頭尾的 - _ 去掉、最長 BRIEF_NAME_MAX 個字；空的用 brief-<今天>；撞到 Windows 裝置名就加 brief- 前綴。傳整個檔名（結尾是 .brief.md 或 .md）也收。
 * 頁面那邊算名字的 briefMdName（src/data/brief.js）用同一套規則，測試對過兩邊一致——這支不 import src/，開機自啟不能被頁面的程式拖垮。
 * 11-06 試了三種寫法（scratch 的 exp-misc）：不合的字直接刪會把「仙台 松島」黏成一塊、只留漢字假名英數會把半形片假名的濁點與韓文拆掉，所以用這版。
 */
export function sanitizeBriefName(raw, today = localDate(new Date())) {
  let s = typeof raw === 'string' ? raw.normalize('NFC').trim() : '';
  s = s.replace(/\.(?:brief\.)?md$/i, '');
  s = s.replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/-{2,}/g, '-');
  s = [...s].slice(0, BRIEF_NAME_MAX).join('').replace(/^[-_]+|[-_]+$/g, '');
  if (!s) return `brief-${today}`;
  return DEVICE_NAME.test(s) ? `brief-${s}` : s;
}

/**
 * POST /brief 的來源檢查：瀏覽器的 POST 一定帶 Origin（同源也帶）；curl、node 不帶，放行（11-06 實測 node 24 的 fetch 與 curl 都不帶）。
 * 帶了就要 (1) 跟這個請求的 Host（或 tailscale 代理留的 X-Forwarded-Host）是同一個主機＋埠＝同源的頁面，
 * (2) 主機名是本機或 BRIEF_TRUSTED_HOSTS 裡的網域——不然別的網站把自己的網域指到 127.0.0.1（DNS rebinding）就能冒充同源。
 * 瀏覽器另外會帶 Sec-Fetch-Site：有帶就只收 same-origin（哪天遇到跨站表單不帶 Origin 的瀏覽器，這條還擋得住）。
 */
function originAllowed(req) {
  const site = req.headers['sec-fetch-site'];
  if (site !== undefined && site !== 'same-origin') return false;
  const origin = req.headers.origin;
  if (origin === undefined) return true;
  let o;
  try { o = new URL(origin); } catch { return false; }   // 'null'（沙盒 iframe、file://）也在這裡擋掉
  const hosts = [req.headers.host, req.headers['x-forwarded-host']]
    .flatMap((h) => (typeof h === 'string' ? h.split(',') : []))
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  if (!hosts.includes(o.host.toLowerCase())) return false;
  const name = o.hostname.toLowerCase();
  return LOOPBACK.has(name) || BRIEF_TRUSTED_HOSTS.some((suffix) => name.endsWith(suffix.startsWith('.') ? suffix : `.${suffix}`));
}

/**
 * 讀 POST 本文、最多留 limit bytes：超過的照樣讀完但不存，讀完才回 413——11-06 試過三種（scratch 的 exp-413）：一看到 Content-Length 就回、
 * 邊讀邊砍連線這兩種，5 MB 的本文客戶端拿到的是 ECONNRESET 不是 413；讀完再回四次都拿到 413。離譜的大小（上限的 16 倍、至少 4 MB）才直接砍連線。
 */
async function readBody(req, limit) {
  const hardCap = Math.max(limit * 16, 4 * 1024 * 1024);
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > hardCap) { req.destroy(); return { size, body: null, dropped: true }; }
    if (size <= limit) chunks.push(chunk); else chunks.length = 0;
  }
  return { size, body: size <= limit ? Buffer.concat(chunks) : null, dropped: false };
}

async function exists(file) {
  try { await stat(file); return true; } catch { return false; }
}

/**
 * 建伺服器（還沒 listen）。dir＝packs 資料夾；appDir＝dist（null 就不供應 /app/）；briefDir＝需求單寫到哪（null 或 acceptBriefs false 就不收）；
 * log(line)＝每個請求一行；now()＝現在時間（測試釘住歷史檔名用）。路徑都先 resolve 成絕對路徑。
 */
export function createPackServer({ dir, appDir = null, briefDir = null, acceptBriefs = ACCEPT_BRIEFS, briefMaxBytes = BRIEF_MAX_BYTES, log = () => {}, now = () => new Date() } = {}) {
  if (!dir) throw new Error('createPackServer：要給 dir（packs 資料夾）');
  const packsRoot = path.resolve(dir);
  const appRoot = appDir ? path.resolve(appDir) : null;
  const briefRoot = briefDir ? path.resolve(briefDir) : null;
  const accepting = Boolean(acceptBriefs && briefRoot);
  const briefLabel = briefRoot ? path.basename(briefRoot) : '';   // 回給頁面與 log 的資料夾名（「trips」），不露絕對路徑
  let writing = Promise.resolve();   // 寫需求單一次一份：連按兩下「提交」不會互踩
  const logLine = (req, status, extra = '') => log(`${now().toISOString()} ${req.method} ${req.url} ${status}${extra === '' ? '' : ` ${extra}`}`);
  const plain = (req, res, status, headers = CORS, body = undefined) => { res.writeHead(status, headers); res.end(body); logLine(req, status); };

  async function sendFile(req, res, file, extra = {}) {
    try {
      const s = await stat(file);
      if (!s.isFile()) throw new Error('not a file');
      const body = await readFile(file);
      res.writeHead(200, { ...CORS, ...extra, 'Content-Type': TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream', 'Content-Length': body.length, 'Last-Modified': s.mtime.toUTCString() });
      res.end(req.method === 'HEAD' ? undefined : body);
      logLine(req, 200, body.length);
    } catch {
      plain(req, res, 404, CORS, 'not found');
    }
  }

  // 打包檔：packs/ 底下的檔，/ 就是 pack.json（10-10 起的行為）。11-06 多一個標頭 Vary: *（NEVER_STORED）：頁面改由這支供應之後，頁面跟打包檔可能同源，
  // 而頁面的 service worker 對同源 GET 是 cache-first、還把 200 存起來——存住的話按「更新」永遠拿到第一次那包。/app/ 的靜態檔不能帶（SW 要預先快取它們）。
  function servePack(req, res, p) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return plain(req, res, 405);
    const rel = p === '/' ? '/pack.json' : p;
    const file = path.resolve(packsRoot, `.${rel}`);
    if (!file.startsWith(packsRoot + path.sep) || rel.includes('..')) return plain(req, res, 403);
    return sendFile(req, res, file, NEVER_STORED);
  }

  // 頁面：/app/ → dist/index.html，/app/<檔> → dist/<檔>；/app（沒斜線）轉到 app/——相對轉址，帶不帶 /trip-pilot 前綴都落在對的地方（頁面裡的 ./sw.js、../brief 都靠這個斜線）
  function serveApp(req, res, rest, search) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return plain(req, res, 405);
    if (!appRoot) return plain(req, res, 404, CORS, 'not found');
    if (rest === '') return plain(req, res, 302, { ...CORS, Location: `app/${search}` });
    const segments = rest === '/' ? ['index.html'] : rest.slice(1).split('/');
    if (!segments.every((s) => APP_SEGMENT.test(s))) return plain(req, res, 403);
    const file = path.join(appRoot, ...segments);
    if (!file.startsWith(appRoot + path.sep)) return plain(req, res, 403);
    return sendFile(req, res, file);
  }

  /** 寫一份需求單（在 writing 佇列裡跑）：同內容不動；同名不同內容先搬進歷史再寫；寫失敗把舊檔搬回來。回 { replaced, history, unchanged }。 */
  async function writeBrief(name, body) {
    await mkdir(briefRoot, { recursive: true });
    const file = path.join(briefRoot, `${name}.brief.md`);
    if (path.dirname(file) !== briefRoot) throw new Error('名字淨化後還是跑出資料夾');   // sanitizeBriefName 之後不會發生；多一道保險
    let old = null;
    try { old = await readFile(file); } catch (err) { if (err.code !== 'ENOENT') throw err; }
    if (old && old.equals(body)) return { replaced: false, history: null, unchanged: true };
    let moved = null;
    if (old) {
      const historyRoot = path.join(briefRoot, BRIEF_HISTORY_DIR);
      await mkdir(historyRoot, { recursive: true });
      const stamp = historyStamp(now());
      // 同一秒內換兩次：第二份接 -2、-3…，歷史檔永遠不蓋掉歷史檔
      for (let i = 1; ; i += 1) {
        moved = path.join(historyRoot, `${name}-${stamp}${i > 1 ? `-${i}` : ''}.brief.md`);
        if (!(await exists(moved))) break;
      }
      await rename(file, moved);
    }
    try {
      await writeFile(file, body, { flag: 'wx' });   // wx：這一瞬間又冒出同名檔就失敗，不蓋
    } catch (err) {
      if (moved) await rename(moved, file).catch(() => {});
      throw err;
    }
    return { replaced: Boolean(old), history: moved ? `${briefLabel}/${BRIEF_HISTORY_DIR}/${path.basename(moved)}` : null, unchanged: false };
  }

  // 需求單：GET／HEAD 給頁面探測「交不交得出去」，POST 寫檔。不給 CORS——別的來源讀不到探測結果，帶自訂標頭的跨來源請求也過不了預檢。
  async function serveBrief(req, res, url) {
    const json = (status, obj, extra = {}, note = '') => {
      const body = Buffer.from(JSON.stringify(obj));
      res.writeHead(status, { ...NO_STORE, 'Content-Type': TYPES['.json'], 'Content-Length': body.length, ...extra });
      res.end(req.method === 'HEAD' ? undefined : body);
      logLine(req, status, note);
    };
    const refuse = (status, error, extra = {}, more = {}) => json(status, { ok: false, error, message: BRIEF_ERRORS[error], ...more }, extra, error);
    if (req.method === 'OPTIONS') return plain(req, res, 204, { ...NO_STORE, ...BRIEF_ALLOW });
    if (req.method === 'GET' || req.method === 'HEAD') {
      if (!accepting) return json(404, { accepts: false });
      // NEVER_STORED：探測結果被 service worker 存住的話，伺服器關了它還是說收（頁面自己用 HEAD 探測，SW 不攔非 GET；這個標頭是給直接 GET 的人的保險）。
      // X-Trip-Pilot-Brief 讓頁面認得是這支，不是哪個對什麼路徑都回 200 的主機。
      return json(200, { accepts: true, dir: briefLabel }, { ...NEVER_STORED, 'X-Trip-Pilot-Brief': 'accepts' });
    }
    if (req.method !== 'POST') return refuse(405, 'method', BRIEF_ALLOW);
    // 先把本文讀完再回任何拒絕（理由見 readBody）
    const { size, body, dropped } = await readBody(req, briefMaxBytes);
    if (dropped) { logLine(req, 413, `too-large ${size}+ 直接斷線`); return undefined; }
    if (!accepting) return refuse(403, 'disabled');
    if (!originAllowed(req)) return refuse(403, 'cross-origin');
    if (!/^text\/(?:markdown|plain)\s*(?:;|$)/i.test(req.headers['content-type'] ?? '')) return refuse(415, 'bad-type');
    if (!body) return refuse(413, 'too-large', {}, { limit: briefMaxBytes, size });
    const content = body.length >= 3 && body[0] === 0xef && body[1] === 0xbb && body[2] === 0xbf ? body.subarray(3) : body;   // BOM 不寫進檔
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(content); } catch { return refuse(400, 'not-utf8'); }
    if (!text.trim()) return refuse(400, 'empty');
    const name = sanitizeBriefName(url.searchParams.get('name'), localDate(now()));
    const run = writing.then(() => writeBrief(name, content));
    writing = run.catch(() => {});
    let r;
    try { r = await run; } catch (err) { return refuse(500, 'write-failed', {}, { detail: err.code ?? err.message }); }
    const file = `${briefLabel}/${name}.brief.md`;
    const what = r.unchanged ? '內容相同，沒動' : r.replaced ? `取代，舊的搬到 ${r.history}` : '新檔';
    return json(200, { ok: true, file, replaced: r.replaced, history: r.history, unchanged: r.unchanged, bytes: content.length }, {}, `${content.length} → ${file}（${what}）`);
  }

  async function handle(req, res) {
    let url;
    let p;
    // 壞掉的 % 編碼 decodeURIComponent 會丟 URIError：11-06 之前沒接，一個 GET /% 就讓整支當掉（等排程一分鐘後重啟）
    try { url = new URL(req.url, 'http://x'); p = decodeURIComponent(url.pathname); } catch { return plain(req, res, 400, CORS, 'bad request'); }
    if (p.includes('\0')) return plain(req, res, 400, CORS, 'bad request');
    if (p === MOUNT_PREFIX) p = '/';
    else if (p.startsWith(`${MOUNT_PREFIX}/`)) p = p.slice(MOUNT_PREFIX.length);
    if (p === '/brief') return serveBrief(req, res, url);
    if (req.method === 'OPTIONS') return plain(req, res, 204);
    if (p === '/app' || p.startsWith('/app/')) return serveApp(req, res, p.slice('/app'.length), url.search);
    return servePack(req, res, p);
  }

  return http.createServer((req, res) => {
    req.on('error', () => {});
    res.on('error', () => {});
    handle(req, res).catch((err) => {
      try { if (!res.headersSent) res.writeHead(500, NO_STORE); res.end(); } catch { /* 連線已經沒了 */ }
      logLine(req, 500, err?.message ?? String(err));
    });
  });
}

/** 命令列 → 設定。資料夾的相對路徑相對於 app/tools/；旗標後面沒接值就丟錯（不默默拿下一個旗標當值）。 */
export function parseArgs(argv) {
  const value = (name, fallback) => {
    const i = argv.indexOf(name);
    if (i < 0) return fallback;
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) throw new Error(`${name} 後面要接一個值`);
    return v;
  };
  return {
    port: Number(value('--port', DEFAULT_PORT)),
    dir: path.resolve(here, value('--dir', DEFAULT_DIR)),
    appDir: path.resolve(here, value('--app', DEFAULT_APP_DIR)),
    briefDir: path.resolve(here, value('--briefs', DEFAULT_BRIEF_DIR)),
    acceptBriefs: ACCEPT_BRIEFS && !argv.includes('--no-briefs'),
    logFile: value('--log', null),
  };
}

// 直接執行才開埠（被測試 import 時不開）。import.meta.main 是 node 24.2 起有的；舊版退回比路徑（Windows 不分大小寫）。
// 11-06 在這台（node 24.14.1）用絕對路徑、小寫磁碟代號、相對路徑、8.3 短路徑、被 import 五種方式試過，兩種判法結果都一樣。
const isMain = typeof import.meta.main === 'boolean'
  ? import.meta.main
  : Boolean(process.argv[1]) && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();

if (isMain) {
  const o = parseArgs(process.argv.slice(2));
  const log = (line) => { console.log(line); if (o.logFile) appendFile(o.logFile, `${line}\n`).catch(() => {}); };
  const server = createPackServer({ ...o, log });
  server.listen(o.port, '127.0.0.1', () => {
    const at = `http://127.0.0.1:${server.address().port}`;
    const t = new Date().toISOString();
    log(`${t} packs 伺服器 ${at}/pack.json ← ${o.dir}`);
    log(`${t} 頁面 ${at}/app/ ← ${o.appDir}`);
    log(o.acceptBriefs ? `${t} 需求單 POST ${at}/brief → ${o.briefDir}` : `${t} 需求單：不收（ACCEPT_BRIEFS 關著或帶了 --no-briefs）`);
  });
}
