// 建容器的純邏輯：容器名、資料夾、tile_urls、docker 參數；衝突檢查（同名容器、埠被別的容器占）。不碰 docker。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPlan, checkConflicts } from '../../tools/valhalla/build.mjs';

test('buildPlan：容器名與資料夾取 region 最後一段，tile_urls 指到 Geofabrik，埠對到容器的 8002', () => {
  const p = buildPlan({ region: 'asia/japan/tohoku', port: 8002, dataRoot: 'D:/x/valhalla' });
  assert.equal(p.container, 'valhalla-tohoku');
  assert.equal(p.tileUrl, 'https://download.geofabrik.de/asia/japan/tohoku-latest.osm.pbf');
  assert.ok(p.dir.endsWith('tohoku'));
  assert.deepEqual(p.args.slice(0, 6), ['run', '-d', '--name', 'valhalla-tohoku', '-p', '8002:8002']);
  assert.ok(p.args.includes('build_elevation=True') && p.args.includes('serve_tiles=True') && p.args.includes('use_tiles_ignore_pbf=False'));
  assert.ok(p.args.some((a) => a === 'D:/x/valhalla/tohoku:/custom_files'));
  assert.equal(p.args.at(-1), 'ghcr.io/valhalla/valhalla-scripted:latest');
  const t = buildPlan({ region: '/asia/taiwan/', port: 8003 });
  assert.equal(t.container, 'valhalla-taiwan');
  assert.equal(t.args[5], '8003:8002');
  assert.match(t.command, /^docker run -d --name valhalla-taiwan -p 8003:8002 -v /);
  assert.throws(() => buildPlan({ region: 'Asia/Taiwan' }), /region/);
  assert.throws(() => buildPlan({ region: '' }), /region/);
  assert.throws(() => buildPlan({ region: 'asia/taiwan', port: 'x' }), /port/);
});

test('checkConflicts：同名容器已存在、埠被別的容器用了都報；沒衝突回空', () => {
  const psLines = ['valhalla-tohoku\t0.0.0.0:8002->8002/tcp, [::]:8002->8002/tcp\tUp 2 days', 'other\t0.0.0.0:18810->80/tcp\tExited (0) 3 days ago'];
  assert.deepEqual(checkConflicts({ container: 'valhalla-taiwan', port: 8003, psLines }), []);
  const same = checkConflicts({ container: 'valhalla-tohoku', port: 8002, psLines });
  assert.equal(same.length, 1);
  assert.match(same[0], /已存在.*Up 2 days/);
  const port = checkConflicts({ container: 'valhalla-taiwan', port: 8002, psLines });
  assert.equal(port.length, 1);
  assert.match(port[0], /埠 8002 已被容器 valhalla-tohoku/);
});
