// 測試用的假瀏覽器（不是測試檔）：一棵記得標籤、類別、屬性、子節點、監聽的假 DOM，加上記憶體裡的 localStorage。
// 畫面的程式（ui/planner.js、now.js、corridor.js…）真的畫進去——畫的時候丟錯測試就紅；測試再從樹上找鍵來按、把整頁的字收起來比。
// 只做 src/ui 用到的那幾樣：el() 的屬性與監聽、classList、querySelector('.類別')、remove、textContent、dataset（data-* 屬性）。
// 用法：const dom = installDom()（在 import src/ui/app.js 之前呼叫，localStorage 才接得上）。

class FakeNode {
  constructor(tag) { this.tag = tag; this.className = ''; this.attrs = {}; this.listeners = {}; this.children = []; this.dataset = {}; this.parent = null; this.style = { setProperty() {} }; this.offsetHeight = 0; }
  setAttribute(k, v) { this.attrs[k] = v; if (k.startsWith('data-')) this.dataset[k.slice(5)] = v; }
  getAttribute(k) { return this.attrs[k] ?? null; }
  addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
  append(...nodes) { for (const n of nodes) { if (n && typeof n === 'object') n.parent = this; this.children.push(n); } }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this); this.parent = null; }
  /** 原位置換成別的節點（「再列 N 站」按了換成那幾個選項）。 */
  replaceWith(...nodes) {
    const p = this.parent;
    if (!p) return;
    const at = p.children.indexOf(this);
    for (const n of nodes) if (n && typeof n === 'object') n.parent = p;
    p.children.splice(at, 1, ...nodes);
    this.parent = null;
  }
  focus() { globalThis.document.activeElement = this; }
  get classList() {
    const node = this;
    const list = () => node.className.split(/\s+/).filter(Boolean);
    return {
      contains: (c) => list().includes(c),
      add: (c) => { if (!list().includes(c)) node.className = [...list(), c].join(' '); },
      remove: (c) => { node.className = list().filter((x) => x !== c).join(' '); },
      toggle: (c, on = !list().includes(c)) => { if (on) this.classList.add(c); else this.classList.remove(c); return on; },
    };
  }
  /** 只認 '.類別'、'標籤'、'標籤.類別' 三種寫法（畫面的程式只用到這些）。 */
  matches(sel) {
    const m = String(sel).match(/^([a-z0-9]*)(?:\.([\w-]+))?$/i);
    if (!m) throw new Error(`假 DOM 不認得的選擇器：${sel}`);
    return (!m[1] || this.tag === m[1]) && (!m[2] || this.classList.contains(m[2]));
  }
  querySelectorAll(sel) { const out = []; walk(this, (n) => { if (n.matches(sel)) out.push(n); }); return out; }
  querySelector(sel) { return this.querySelectorAll(sel)[0] ?? null; }
  click() { for (const fn of this.listeners.click ?? []) fn({ target: this }); }
  get textContent() { return this.children.map((c) => (typeof c === 'string' ? c : c.textContent)).join(''); }
  set textContent(v) { this.children = [String(v)]; }
}

function walk(node, visit) {
  for (const c of node.children) {
    if (typeof c === 'string') continue;
    visit(c);
    walk(c, visit);
  }
}

/** 裝上假的 document、Node、localStorage（已經有就換新的一份）。回 { root, storage, findAll, buttons, text, lines }。 */
export function installDom() {
  const root = new FakeNode('div');
  const store = new Map();
  globalThis.Node = FakeNode;
  globalThis.document = {
    getElementById: (id) => (id === 'app' ? root : null),
    createElement: (tag) => new FakeNode(tag),
    createTextNode: (s) => { const n = new FakeNode('#text'); n.children = [String(s)]; return n; },
    querySelectorAll: (sel) => root.querySelectorAll(sel),
    querySelector: (sel) => root.querySelector(sel),
    body: { append() {} },
  };
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
  };
  const findAll = (pred, node = root) => { const out = []; walk(node, (n) => { if (pred(n)) out.push(n); }); return out; };
  return {
    root,
    storage: store,
    findAll,
    /** 畫面上字剛好是 label 的鍵（button 與 a），可以限定在某個節點底下找。 */
    buttons: (label, node = root) => findAll((n) => (n.tag === 'button' || n.tag === 'a') && n.textContent === label, node),
    /** 整頁（或某個節點底下）的字。 */
    text: (node = root) => node.textContent,
    /** 某個類別的節點各自的字。 */
    lines: (cls, node = root) => node.querySelectorAll(`.${cls}`).map((n) => n.textContent),
  };
}
