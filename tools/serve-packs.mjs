// 桌機上的打包檔伺服器：手機（tailscale 連回桌機）按「更新」就是來這裡抓 pack.json。只讀 packs/ 這一個資料夾，只有 GET／HEAD。
// 掛法：tailscale serve --bg --set-path /trip-pilot http://127.0.0.1:18810
//   → 手機用 https://<桌機>.ts.net/trip-pilot/pack.json；App 在 GitHub Pages，所以要給 CORS（tailnet 內才連得到，開 * 沒關係）。
// 用法：node tools/serve-packs.mjs [--dir ../packs] [--port 18810] [--log <檔>]（--log：開機排程沒有 stdout，寫到檔）
import http from 'node:http';
import { stat, readFile, appendFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// === 需修改 ===
const DEFAULT_PORT = 18810;          // 2026-10-10 查過 WinNAT 排除區與其他專案的 DEFAULT_PORT（18765／18801／18802）
const DEFAULT_DIR = '../../packs';   // 相對於 app/tools/：專案根目錄的 packs/（打包工具的預設輸出處）
const MOUNT_PREFIX = '/trip-pilot';  // tailscale serve --set-path 掛的路徑；有沒有帶這個前綴都接受
// === 以上 ===

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const port = Number(opt('--port', DEFAULT_PORT));
const dir = path.resolve(here, opt('--dir', DEFAULT_DIR));
const logFile = opt('--log', null);
const log = (line) => { console.log(line); if (logFile) appendFile(logFile, line + '\n').catch(() => {}); };
const TYPES = { '.json': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8' };

const server = http.createServer(async (req, res) => {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS', 'Access-Control-Allow-Headers': '*', 'Cache-Control': 'no-store' };
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, cors); res.end(); return; }
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.startsWith(MOUNT_PREFIX + '/')) p = p.slice(MOUNT_PREFIX.length);
  if (p === MOUNT_PREFIX || p === '/') p = '/pack.json';
  const file = path.resolve(dir, '.' + p);
  if (!file.startsWith(dir + path.sep) || p.includes('..')) { res.writeHead(403, cors); res.end(); return; }
  try {
    const s = await stat(file);
    if (!s.isFile()) throw new Error('not a file');
    const body = await readFile(file);
    res.writeHead(200, { ...cors, 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'Content-Length': body.length, 'Last-Modified': s.mtime.toUTCString() });
    res.end(req.method === 'HEAD' ? undefined : body);
    log(`${new Date().toISOString()} ${req.method} ${req.url} 200 ${body.length}`);
  } catch {
    res.writeHead(404, cors); res.end('not found');
    log(`${new Date().toISOString()} ${req.method} ${req.url} 404`);
  }
});

server.listen(port, '127.0.0.1', () => log(`${new Date().toISOString()} packs 伺服器 http://127.0.0.1:${port}/pack.json ← ${dir}`));
