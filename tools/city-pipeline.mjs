// 一條指令跑完一城的上線管線：kb-check → geocode → zones-init → walk-matrix → pack（原話 #167：換城市或國家只動資料不動程式）。
// 用法：node tools/city-pipeline.mjs <知識庫資料夾> [trip.json] [--apply] [--steps kb-check,geocode,zones,matrix,pack]
//   不帶 --apply：只印每步會做什麼與現況數字（kb-check 本來就唯讀所以照跑；其他步不打網路、不寫檔）。
//   --apply：真的跑；既有工具用 child_process 跑（不重寫），每步跑完印一行摘要。
//   geocode 預設只查缺的；沒有 zones.json 時先以無區模式查，zones-init 產出後再 --retry 重查一輪（null 與非 exact 的）。
//   zones-init 只在 zones.json 不存在時跑。walk-matrix 用 city.json 的埠，連不上就跳過並說怎麼建容器。pack 有給 trip.json 才跑。
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCity, valhallaUrl, valhallaHint } from './lib/city.mjs';
import { loadPois, planAction, zoneFor } from './geocode.mjs';
import { probeValhalla } from './walk-matrix.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const STEPS = ['kb-check', 'geocode', 'zones', 'matrix', 'pack'];
const TOOL = { 'kb-check': 'kb-check.mjs', geocode: 'geocode.mjs', zones: 'zones-init.mjs', matrix: 'walk-matrix.mjs', pack: 'pack.mjs' };

function readJson(file) { return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null; }

/** 跑一支既有工具（node tools/<x>.mjs …）：輸出照印，回 { code, lastLine }（lastLine 當摘要）。 */
export function runTool(name, args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(here, TOOL[name]), ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let buf = '';
    child.stdout.setEncoding('utf8'); child.stdout.on('data', (s) => { process.stdout.write(s); buf += s; });
    child.stderr.setEncoding('utf8'); child.stderr.on('data', (s) => { process.stderr.write(s); buf += s; });
    child.on('error', (err) => resolve({ code: 1, lastLine: err.message }));
    child.on('close', (code) => { const lines = buf.split(/\r?\n/).map((l) => l.trim()).filter(Boolean); resolve({ code: code ?? 1, lastLine: lines.at(-1) ?? '' }); });
  });
}

/** 現況數字：站數、座標、區、矩陣，以及 geocode 在 missing／retry 模式各會查幾站（跟 geocode --dry-run 同一套 planAction）。 */
export function snapshot(dir) {
  const data = readJson(path.join(dir, 'data.json'));
  if (!data) throw new Error(`${path.join(dir, 'data.json')} 不存在：研究產出先放進來`);
  const pois = loadPois(data);
  const zones = readJson(path.join(dir, 'zones.json'))?.zones ?? null;
  const coords = readJson(path.join(dir, 'coords.json'));
  const walk = readJson(path.join(dir, 'walk.json'));
  const manual = readJson(path.join(dir, 'coords.manual.json')) ?? {};
  const plan = (mode) => {
    const c = { manual: 0, skip: 0, keep: 0, fill: 0, query: 0 };
    for (const poi of pois) c[planAction({ poi, mode, cur: coords?.[poi.id], manual: manual[poi.id], zone: zoneFor(poi, zones ?? {}) })]++;
    return c;
  };
  const real = coords ? Object.values(coords).filter((c) => c && Number.isFinite(c.lat)).length : 0;
  return { pois: pois.length, zones: zones ? Object.keys(zones).length : null, coords: coords ? { have: real, nulls: Object.values(coords).filter((c) => c === null).length } : null, walkPairs: walk ? Object.keys(walk.pairs ?? {}).length : null, geocodeMissing: plan('missing'), geocodeRetry: plan('retry') };
}

export function parseArgs(argv) {
  const pos = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1] === '--steps'));
  const si = argv.indexOf('--steps');
  const steps = si >= 0 ? String(argv[si + 1] ?? '').split(',').map((s) => s.trim()).filter(Boolean) : [...STEPS];
  const bad = steps.filter((s) => !STEPS.includes(s));
  if (bad.length) throw new Error(`--steps 不認得 ${bad.join('、')}（可用：${STEPS.join('、')}）`);
  return { dir: pos[0], trip: pos[1] ?? null, apply: argv.includes('--apply'), steps };
}

async function main() {
  const { dir: dirArg, trip: tripArg, apply, steps } = parseArgs(process.argv.slice(2));
  if (!dirArg) { console.error('用法：node tools/city-pipeline.mjs <知識庫資料夾> [trip.json] [--apply] [--steps kb-check,geocode,zones,matrix,pack]'); process.exit(2); }
  const dir = path.resolve(dirArg);
  const tripFile = tripArg ? path.resolve(tripArg) : null;
  const city = loadCity(dir);
  const trip = tripFile ? readJson(tripFile) : null;
  if (tripFile && !trip?.id) throw new Error(`${tripFile} 不是旅程檔（要有 id）`);
  const want = (s) => steps.includes(s);
  const url = valhallaUrl(city);
  console.log(`城市 ${city.id}（${city.name_zh}，國家 ${city.countryId}）　${apply ? '真的跑' : '試跑（不打網路、不寫檔）'}　步驟 ${steps.join(' → ')}`);
  const summary = [];
  const step = (name, text) => console.log(`\n【${name}】${text}`);
  const done = (name, text) => { summary.push(`${name}：${text}`); console.log(`　摘要 ${text}`); };
  const run = async (name, args) => { const r = await runTool(name, args); if (r.code !== 0) { console.error(`\n✗ ${name} 失敗（exit ${r.code}），停在這一步`); process.exit(r.code); } return r; };

  let snap = snapshot(dir);
  const zonesMissingAtStart = snap.zones === null;

  if (want('kb-check')) {
    step('kb-check', '驗 data.json（唯讀）');
    const r = await run('kb-check', [dir]);
    done('kb-check', r.lastLine);
  }

  if (want('geocode')) {
    const p = snap.geocodeMissing;
    const text = `查座標（只查缺的）：會查 ${p.query}、沿用 ${p.keep}、人工 ${p.manual}、不查（交通類）${p.skip}；共 ${snap.pois} 站${zonesMissingAtStart ? '；沒有 zones.json → 先無區模式查，zones-init 產出後再 --retry 重查' : `；區 ${snap.zones} 個`}`;
    step('geocode', text);
    if (apply) { const r = await run('geocode', [dir]); done('geocode', r.lastLine); snap = snapshot(dir); }
  }

  if (want('zones')) {
    if (!zonesMissingAtStart) step('zones-init', `已有 zones.json（${snap.zones} 區），跳過`);
    else {
      step('zones-init', `沒有 zones.json：從 coords.json 有座標的站聚類寫草案（半徑 800 m）；現在有座標 ${snap.coords?.have ?? 0} 站`);
      if (apply) {
        const r = await run('zones', [dir, '--apply']); done('zones-init', r.lastLine); snap = snapshot(dir);
        if (want('geocode')) {
          const p = snap.geocodeRetry;
          step('geocode --retry', `有區了，重查 null 與非 exact 的：會查 ${p.query}、沿用 ${p.keep}`);
          const r2 = await run('geocode', [dir, '--retry']); done('geocode --retry', r2.lastLine); snap = snapshot(dir);
        }
      } else if (want('geocode')) console.log('　之後 geocode --retry 重查 null 與非 exact 的（站數要等草案出來才知道）');
    }
  }

  if (want('matrix')) {
    const alive = url ? await probeValhalla(url) : null;
    if (!alive) {
      step('walk-matrix', `連不上 Valhalla${url ? ` ${url}` : ''}：跳過。${valhallaHint(city)}`);
      done('walk-matrix', '跳過（Valhalla 沒在跑）');
    } else {
      step('walk-matrix', `Valhalla ${url} 可連（${city.valhalla.container}）：會算 ${snap.coords?.have ?? 0} 站的步行矩陣${snap.walkPairs != null ? `（walk.json 現在 ${snap.walkPairs} 對）` : ''}`);
      if (apply) { const r = await run('matrix', [dir]); done('walk-matrix', r.lastLine); snap = snapshot(dir); }
    }
  }

  if (want('pack')) {
    if (!trip) step('pack', '沒給 trip.json，跳過（有旅程檔再跑：node tools/pack.mjs <城> <trip.json>）');
    else {
      step('pack', `打包 ${trip.id}（${trip.days?.length ?? 0} 天）→ packs/${trip.id}.json 與 packs/pack.json`);
      if (apply) { const r = await run('pack', [dir, tripFile]); done('pack', r.lastLine); }
    }
  }

  console.log(apply ? `\n跑完：\n${summary.map((s) => `- ${s}`).join('\n')}` : '\n試跑結束；加 --apply 真的跑');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((err) => { console.error(err.message); process.exit(1); });
