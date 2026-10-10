// 畫面文字集中在這裡。程式鍵值不得直接印到畫面（UX 鐵律）；店型、優先度、狀態都在這裡翻成人話。
const fmtAt = (at) => (at ? new Date(at).toLocaleString('zh-TW', { hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '不明');

export const TEXT = {
  appName: 'Trip Pilot',
  shellHint: '還沒有旅程。出發前在電腦上排好、打包，手機按一次「更新」就會出現在這裡。',
  loadDemo: '載入仙台示範',
  updateBanner: '有新版本',
  updateButton: '重新載入',
  version: (v) => `版本 ${v}`,
  tabs: { plan: '整趟', now: '現場', pool: '候選', settings: '設定' },

  // 規劃頁
  anchorOf: (name) => (name ? `主行程：${name}` : '主行程：還沒選'),
  themeOf: (cat) => `${CATEGORY[cat] ?? cat}主題日`,
  walkTo: (min) => `走 ${min} 分`,
  rideTo: (walk, ride) => `車 ${ride} 分、走 ${walk} 分`,
  closesAt: (hm) => `${hm} 關`,
  dropped: '今天排不進',
  swap: '換一家',
  remove: '不去了',
  noSwap: '附近沒有同類型、順路又開著的店',
  swapNote: (d) => (d > 0 ? `多繞 ${d} 分` : '順路'),
  openUnknown: '營業時間沒查到，要先確認',
  replan: '重排',
  dayScore: (score, penalty) => (penalty > 0 ? `這天有 ${Math.round(penalty)} 分鐘的勉強` : '這天沒有勉強的地方'),
  openSlotLine: (left, used) => (used > 0 ? `留白：還剩 ${left} 分（等開門用掉 ${used} 分）` : `留白 ${left} 分`),
  darkBefore: (hm) => `天黑 ${hm} 前`,
  mapLink: '地圖',
  routeLink: '路線',
  restInserted: '引擎插的休息站，不要就按『不去了』',

  // 現場
  nextStop: '下一站',
  leaveNow: '出發去下一站',
  arrivedHere: '我現在在這站',
  dayDone: '今天走完了',
  late: (min) => `落後 ${min} 分`,
  early: (min) => `不急，還有 ${min} 分`,
  waitOpen: (min) => `等開門 ${min} 分（算留白）`,
  firstLeg: (time, t) => `${time} 出門，${t}`,
  hardLimit: (name, hm) => `${name} ${hm} 關門，這樣走會趕不上`,
  hardLimitDark: (name, hm) => `${name} ${hm} 天黑，這樣走會趕不上`,
  proposals: '接下來可以這樣走',
  takeThis: '照這個走',
  keepGoing: '照原本的走',
  simulate: '試走模式',
  simOff: '用真的時間',
  simPlus: (m) => `＋${m} 分`,
  simReset: '回到出門',
  pickDay: '哪一天',
  rateTitle: (name) => `${name} 怎麼樣？`,
  rateSkip: '略過',
  stars: ['', '踩雷', '留著', '順路才排', '備案', '優先', '必去'],
  restInsertedNow: '引擎插的休息站，不想休息可以略過',
  openMaps: 'Google Maps 路線',

  // 設定
  settingsTitle: '這四個數字你旅途中會想動',
  walkBudget: '一天走路上限（分鐘）',
  openSlot: '每天留白（分鐘）',
  departHM: '預設幾點出門',
  nightSlot: '每晚排夜間站',
  packSection: '旅程資料',
  packUrl: '打包檔網址（桌機）',
  update: '更新',
  updating: '更新中…',
  updated: (name, at) => `更新好了：${name}（${fmtAt(at)}）`,
  updateFailed: (msg) => `更新失敗：${msg}。沒網路的話，手機裡原本的旅程還在。`,
  needUrl: '先填桌機的打包檔網址',
  importFile: '從檔案載入',
  noPack: '手機裡還沒有旅程',
  lastPack: (name, at) => `手機裡的旅程：${name}（打包於 ${fmtAt(at)}）`,
  goUpdate: '去更新',
  saved: '已存',

  // 候選
  poolTitle: '候選',
  plannedOn: (label) => `已排 ${label}`,
  notPlanned: '沒排進',

  // 警告（規則的 warn 已是人話；這裡只給分類標題）
  warnTitle: '注意',
};

export const CATEGORY = {
  shrine: '神社', temple: '寺院', mausoleum: '靈廟', museum: '博物館', garden: '庭園', arcade: '商店街', market: '市場', event: '活動', experience: '體驗', daytrip: '一日遊',
  vintage: '古著店', record: '唱片行', store: '店', bookstore: '書店', drugstore: '藥妝', gift: '伴手禮', department: '百貨', electronics: '電器', outlet: 'Outlet', street: '街區',
  food: '吃的', cafe: '咖啡廳', bar: '酒吧', brewery: '酒藏', onsen: '溫泉', cruise: '遊覽船', logistics: '交通', other: '其他',
};

export const PRIORITY = { must: '必去', want: '想去', maybe: '可去' };
