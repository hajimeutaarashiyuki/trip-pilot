// 畫面文字集中在這裡。程式鍵值不得直接印到畫面（UX 鐵律）；店型、優先度、狀態都在這裡翻成人話。
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

  // 現場
  nextStop: '下一站',
  leaveNow: '出發去下一站',
  arrivedHere: '我現在在這站',
  dayDone: '今天走完了',
  late: (min) => `落後 ${min} 分`,
  early: (min) => `早到 ${min} 分`,
  hardLimit: (name, hm) => `${name} ${hm} 關門，這樣走會趕不上`,
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
  restInserted: '引擎插的休息站，不想休息可以略過',

  // 設定
  settingsTitle: '這四個數字你旅途中會想動',
  walkBudget: '一天走路上限（分鐘）',
  openSlot: '每天留白（分鐘）',
  departHM: '預設幾點出門',
  nightSlot: '每晚排夜間站',
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
