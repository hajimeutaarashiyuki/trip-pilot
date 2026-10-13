// 建一個區域的 Valhalla 容器（一區一容器一埠；埠記進 <城>/city.json 的 valhalla.port）。做法照 tools/valhalla/README.md 與 DEVLOG 10-10。
// 用法：node tools/valhalla/build.mjs --region asia/japan/tohoku [--port 8002] [--apply]
//   不帶 --apply 只印 docker run 指令與衝突檢查；--apply 真的跑 docker run -d，之後 docker logs -f <容器> 看進度（看到 "Running valhalla service" 就好了）。
//   容器名 valhalla-<region 最後一段>、圖資放專案根目錄 valhalla/<region 最後一段>/（不進倉庫）。同名容器已存在、同一埠已被占就報、不跑。
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// === 需修改 ===
const IMAGE = 'ghcr.io/valhalla/valhalla-scripted:latest';
const DEFAULT_PORT = 8002;
const GEOFABRIK = 'https://download.geofabrik.de';
// 圖資根目錄：專案根目錄的 valhalla/（app/tools/valhalla → app/tools → app → 專案根）
const DATA_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'valhalla');
// === 以上 ===

/** buildPlan({ region, port, dataRoot, image }) → { name, container, dir, port, tileUrl, args, command }（純函式，可測）。 */
export function buildPlan({ region, port = DEFAULT_PORT, dataRoot = DATA_ROOT, image = IMAGE }) {
  const clean = String(region ?? '').trim().replace(/^\/+|\/+$/g, '');
  if (!clean || !/^[a-z0-9-]+(\/[a-z0-9-]+)*$/.test(clean)) throw new Error('--region 要是 Geofabrik 的分區路徑（小寫、斜線分層），例 asia/japan/tohoku、asia/taiwan');
  if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error('--port 要是埠號整數');
  const name = clean.split('/').at(-1);
  const container = `valhalla-${name}`;
  const dir = path.join(dataRoot, name);
  const tileUrl = `${GEOFABRIK}/${clean}-latest.osm.pbf`;
  const args = [
    'run', '-d', '--name', container, '-p', `${port}:8002`,
    '-v', `${dir.replaceAll('\\', '/')}:/custom_files`,
    '-e', `tile_urls=${tileUrl}`, '-e', 'build_elevation=True', '-e', 'serve_tiles=True', '-e', 'use_tiles_ignore_pbf=False',
    image,
  ];
  const quote = (a) => (/[\s"]/.test(a) ? `"${a.replaceAll('"', '\\"')}"` : a);
  return { name, container, dir, port, tileUrl, args, command: ['docker', ...args.map(quote)].join(' ') };
}

/** 衝突檢查（純函式）：psLines 是 docker ps -a --format '{{.Names}}\t{{.Ports}}\t{{.Status}}' 的每一行。 */
export function checkConflicts({ container, port, psLines = [] }) {
  const problems = [];
  for (const line of psLines) {
    const [name, ports = '', status = ''] = line.split('\t');
    if (!name) continue;
    if (name === container) problems.push(`容器 ${container} 已存在（${status.trim() || '狀態不明'}）：要重建先 docker rm -f ${container}；只是停了就 docker start ${container}`);
    else if (new RegExp(`:${port}->`).test(ports)) problems.push(`埠 ${port} 已被容器 ${name} 用了（${ports.trim()}）：換 --port，並把新埠寫進 city.json 的 valhalla.port`);
  }
  return problems;
}

function dockerPs() {
  const r = spawnSync('docker', ['ps', '-a', '--format', '{{.Names}}\t{{.Ports}}\t{{.Status}}'], { encoding: 'utf8' });
  if (r.error || r.status !== 0) return { error: r.error?.message ?? ((r.stderr || '').trim() || `docker ps 失敗（exit ${r.status}）`), lines: [] };
  return { error: null, lines: r.stdout.split(/\r?\n/).filter(Boolean) };
}

/** 埠有沒有東西在聽（不是容器也算，例如別的服務）。 */
export function portBusy(port, timeoutMs = 1000) {
  return new Promise((resolve) => {
    const sock = net.connect({ host: '127.0.0.1', port });
    const done = (v) => { sock.destroy(); resolve(v); };
    sock.setTimeout(timeoutMs, () => done(false));
    sock.on('connect', () => done(true));
    sock.on('error', () => done(false));
  });
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
  const region = opt('--region');
  if (!region) { console.error('用法：node tools/valhalla/build.mjs --region <geofabrik 路徑> [--port 8002] [--apply]'); process.exit(2); }
  const port = opt('--port') ? Number(opt('--port')) : DEFAULT_PORT;
  const apply = args.includes('--apply');
  const plan = buildPlan({ region, port });
  console.log(`容器 ${plan.container}　埠 ${plan.port}　圖資 ${plan.dir}\n來源 ${plan.tileUrl}\n${plan.command}`);
  const ps = dockerPs();
  const problems = ps.error ? [`查不到 docker：${ps.error}`] : checkConflicts({ container: plan.container, port: plan.port, psLines: ps.lines });
  // docker 那邊沒問題才探埠：有別的程式（不是容器）在聽也不能用
  if (!problems.length && await portBusy(plan.port)) problems.push(`埠 ${plan.port} 本機已有程式在聽（不是 docker 容器）：換 --port`);
  if (problems.length) { console.error(problems.map((p) => `✗ ${p}`).join('\n')); process.exit(1); }
  if (!apply) { console.log('試跑：沒跑。加 --apply 真的建（下載 pbf＋建圖＋高程；東北 10-10 量到約 8 分鐘、資料夾 1.7 GB）'); return; }
  mkdirSync(plan.dir, { recursive: true });
  const r = spawnSync('docker', plan.args, { stdio: 'inherit' });
  if (r.status !== 0) { console.error(`docker run 失敗（exit ${r.status}）`); process.exit(1); }
  console.log(`已啟動 ${plan.container}：docker logs -f ${plan.container} 看進度；建完把 { "region": "${region}", "container": "${plan.container}", "port": ${plan.port} } 寫進該城 city.json 的 valhalla`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((err) => { console.error(err.message); process.exit(1); });
