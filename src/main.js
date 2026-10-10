// 進入點：啟動控制器、註冊 Service Worker、新版本只出橫幅不自動換（決策樹 Q16）。
import { el } from './ui/dom.js';
import { TEXT } from './ui/text.js';
import { boot } from './ui/app.js';

// 建置時由 tools/build.mjs 以 define 注入；沒建置（直接開 src）就是 dev。
const VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';

function showUpdateBanner(registration) {
  if (document.querySelector('.banner')) return;
  const banner = el('div', { class: 'banner', role: 'status' }, [
    el('span', {}, TEXT.updateBanner),
    el('button', { class: 'btn', type: 'button', onclick: () => registration.waiting?.postMessage({ type: 'SKIP_WAITING' }) }, TEXT.updateButton),
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
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloading) { reloading = true; location.reload(); } });
  } catch (err) {
    console.warn('service worker 註冊失敗', err);
  }
  // iOS 主畫面 PWA：要求持久儲存，避免被 LRU 淘汰（研究報告 §五）
  try { await navigator.storage?.persist?.(); } catch { /* 不支援就算了 */ }
}

document.title = TEXT.appName;
const footer = el('p', { class: 'muted small version', text: TEXT.version(VERSION) });
document.body.append(footer);
boot();
registerServiceWorker();
