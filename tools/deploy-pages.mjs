// 把 dist 推到 gh-pages（GitHub Pages）。預設只演練：建置、列出會上傳的檔、對照遠端 gh-pages 現在的版本；--apply 才真的提交並推。
// 用法：npm run deploy             （演練，不推）
//       npm run deploy -- --apply  （真的推；Pages 一兩分鐘後更新）
// 做法：在 %TEMP% 開一個暫時 worktree 指到 origin/gh-pages，清空、把 dist 整個複製進去、提交、推 HEAD:gh-pages、拆掉 worktree。
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, cpSync, readdirSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from './build.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const app = path.resolve(here, '..');
const git = (args, cwd = app) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function listFiles(dir, prefix = '') {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? listFiles(full, `${prefix}${name}/`) : [`${prefix}${name}`];
  });
}

const apply = process.argv.includes('--apply');
const r = await build();
const files = listFiles(path.join(app, 'dist'));
console.log(`建置 ${r.version}，index.html ${r.bytes} bytes；會上傳：${files.join('、')}`);
git(['fetch', 'origin', 'gh-pages']);
console.log(`遠端 gh-pages 現在：${git(['log', '-1', '--format=%h %s', 'origin/gh-pages'])}`);
if (!apply) { console.log('演練結束，沒有推。要真的推：npm run deploy -- --apply'); process.exit(0); }

const wt = mkdtempSync(path.join(os.tmpdir(), 'trip-pilot-gh-pages-'));
git(['worktree', 'add', '--detach', wt, 'origin/gh-pages']);
try {
  for (const name of readdirSync(wt)) if (name !== '.git') rmSync(path.join(wt, name), { recursive: true, force: true });
  cpSync(path.join(app, 'dist'), wt, { recursive: true });
  git(['add', '-A'], wt);
  if (!git(['status', '--porcelain'], wt)) {
    console.log('跟遠端一樣，不用推');
  } else {
    git(['commit', '-q', '-m', `deploy ${r.version}`], wt);
    git(['push', 'origin', 'HEAD:gh-pages'], wt);
    console.log(`推上去了：${git(['log', '-1', '--format=%h', 'HEAD'], wt)} → https://hajimeutaarashiyuki.github.io/trip-pilot/ （Pages 建置要等一兩分鐘）`);
  }
} finally {
  git(['worktree', 'remove', '--force', wt]);
}
