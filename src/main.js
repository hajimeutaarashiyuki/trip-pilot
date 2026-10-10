// 進入點：畫出殼、註冊 Service Worker、新版本只出橫幅不自動換（決策樹 Q16）。
import { TEXT } from './ui/text.js';

// 建置時由 tools/build.mjs 以 define 注入；沒建置（直接開 src）就是 dev。
const VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return node;
}

function renderShell(root) {
  root.replaceChildren(
    el('h1', {}, TEXT.appName),
    el('p', { class: 'muted' }, TEXT.shellHint),
    el('p', { class: 'muted' }, TEXT.version(VERSION)),
  );
}

function showUpdateBanner(registration) {
  if (document.querySelector('.banner')) return;
  const banner = el('div', { class: 'banner', role: 'status' }, [
    el('span', {}, TEXT.updateBanner),
    el('button', {
      type: 'button',
      onclick: () => {
        // 使用者按了才換版：叫等待中的 SW 接手，接手後重新載入。
        registration.waiting?.postMessage({ type: 'SKIP_WAITING' });
      },
    }, TEXT.updateButton),
  ]);
  document.body.append(banner);
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const registration = await navigator.serviceWorker.register('./sw.js');
    if (registration.waiting) showUpdateBanner(registration);
    registration.addEventListener('updatefound', () => {
      const installing = registration.installing;
      installing?.addEventListener('statechange', () => {
        if (installing.state === 'installed' && navigator.serviceWorker.controller) showUpdateBanner(registration);
      });
    });
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading) return;
      reloading = true;
      location.reload();
    });
  } catch (err) {
    // 註冊失敗不影響使用；只是沒有離線快取。
    console.warn('service worker 註冊失敗', err);
  }
}

const root = document.getElementById('app');
if (root) {
  renderShell(root);
  registerServiceWorker();
}
