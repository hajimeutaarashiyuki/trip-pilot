// 管線：參數解析、現況數字（假城市）、試跑用子程序跑真的 CLI → exit 0、印五步、不寫任何檔。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs, snapshot, STEPS } from '../../tools/city-pipeline.mjs';

const DIR = fileURLToPath(new URL('../fixtures/kb/fakecity/', import.meta.url));
const TOOL = fileURLToPath(new URL('../../tools/city-pipeline.mjs', import.meta.url));

test('parseArgs：位置參數、--steps 過濾、不認得的步驟報錯', () => {
  assert.deepEqual(parseArgs(['../kb/x', 't.json', '--apply', '--steps', 'kb-check,pack']), { dir: '../kb/x', trip: 't.json', apply: true, steps: ['kb-check', 'pack'] });
  assert.deepEqual(parseArgs(['../kb/x']), { dir: '../kb/x', trip: null, apply: false, steps: STEPS });
  assert.throws(() => parseArgs(['../kb/x', '--steps', 'kb-check,foo']), /不認得 foo/);
});

test('snapshot：假城市還沒有座標與區 → geocode 會查 5 站、區 null、矩陣 null', () => {
  const s = snapshot(DIR);
  assert.equal(s.pois, 5);
  assert.equal(s.zones, null);
  assert.equal(s.coords, null);
  assert.equal(s.walkPairs, null);
  assert.deepEqual(s.geocodeMissing, { manual: 0, skip: 0, keep: 0, fill: 0, query: 5 });
});

test('試跑：子程序跑假城市，exit 0、五步都印、Valhalla 連不上就說怎麼建、不寫任何檔', () => {
  const before = readdirSync(DIR).sort();
  const r = spawnSync(process.execPath, [TOOL, DIR], { encoding: 'utf8', timeout: 60000 });
  assert.equal(r.status, 0, r.stderr);
  for (const name of ['kb-check', 'geocode', 'zones-init', 'walk-matrix', 'pack']) assert.ok(r.stdout.includes(`【${name}】`), `要印 ${name}`);
  assert.match(r.stdout, /會查 5/);
  assert.match(r.stdout, /沒有 zones\.json/);
  assert.match(r.stdout, /連不上 Valhalla.*valhalla-fakecity/);
  assert.match(r.stdout, /沒給 trip\.json/);
  assert.match(r.stdout, /試跑結束/);
  assert.deepEqual(readdirSync(DIR).sort(), before);
});
