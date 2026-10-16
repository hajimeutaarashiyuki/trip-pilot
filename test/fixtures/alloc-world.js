// 多日分配器（T17）的小世界：四個區（town 據點、hill 走路 10 分、sea 搭 JR 35 分、far 搭車 65 分）、四天（兩個普通日、一個一日遊、離境日）、三十來家店。
// test/engine/allocate.test.js 與 test/tools/allocate.test.js 共用。日期：2026-08-13 週四、14 週五、15 週六、16 週日。
export const ALL = Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, [['09:00', '23:00']]]));
const hours = (open, close) => Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, [[open, close]]]));

export const COUNTRY = { mealSlots: { lunch: ['11:30', '13:30'], dinner: ['18:00', '20:30'] }, nightSlot: ['20:00', '24:00'], climate: { summerMonths: [6, 7, 8, 9] }, utcOffsetMin: 540 };
export const ZONES = {
  town: { name_zh: '小鎮', environment: 'urban', lat: 38.26, lng: 140.87 },
  hill: { name_zh: '山丘', environment: 'town', lat: 38.27, lng: 140.86 },
  sea: { name_zh: '海邊', environment: 'town', lat: 38.37, lng: 141.06 },
  far: { name_zh: '遠方', environment: 'nature', lat: 38.5, lng: 140.5 },
};
export const LINKS = {
  'town|hill': { mode: 'walk', rideMin: 0, walkMin: 10 },
  'town|sea': { mode: 'jr', rideMin: 30, walkMin: 5 },
  'town|far': { mode: 'bus', rideMin: 60, walkMin: 5 },
};
export const KB = { zones: ZONES, links: LINKS };
export const HOME = { id: 'home', name_zh: '旅館', zoneId: 'town' };

const poi = (id, over = {}) => ({ id, name_zh: over.name_zh ?? id, name_local: over.name_local ?? id, category: 'street', walkFactor: 1, recovery: false, cafeLike: false, climb: false, climbMin: 0, deepDig: false, seated: null, zoneId: 'town', hours: ALL, dwellMin: 60, daylightOnly: false, my: {}, ...over });
const cafe = (id, over = {}) => poi(id, { category: 'cafe', recovery: true, cafeLike: true, walkFactor: 0, dwellMin: 50, ...over });
const food = (id, over = {}) => poi(id, { category: 'food', recovery: true, walkFactor: 0, dwellMin: 60, ...over });
const bar = (id, over = {}) => poi(id, { category: 'bar', recovery: true, walkFactor: 0, dwellMin: 75, hours: hours('17:00', '24:00'), ...over });

export const POIS = {
  // 骨架：主行程與指定站
  shrinea: poi('shrinea', { name_zh: '山丘神社', category: 'shrine', zoneId: 'hill', walkFactor: 0.5 }),
  gardeng: poi('gardeng', { name_zh: '小鎮庭園', category: 'garden', walkFactor: 0.5 }),
  templet: poi('templet', { name_zh: '小鎮寺', category: 'temple', walkFactor: 0.5, dwellMin: 30 }),
  templesea: poi('templesea', { name_zh: '海邊寺', category: 'temple', zoneId: 'sea', walkFactor: 0.5, dwellMin: 90 }),
  // 咖啡廳（非主題日 ≤2）
  cafe1: cafe('cafe1', { name_zh: '喫茶一' }), cafe2: cafe('cafe2', { name_zh: '喫茶二' }), cafe3: cafe('cafe3', { name_zh: '喫茶三' }),
  cafesea: cafe('cafesea', { name_zh: '海邊喫茶', zoneId: 'sea' }),
  // 吃的（午餐、晚餐各一）
  foodl: food('foodl', { name_zh: '午餐食堂', hours: hours('11:00', '14:00') }),
  foodd: food('foodd', { name_zh: '晚餐食堂', hours: hours('17:00', '22:00') }),
  foodx: food('foodx', { name_zh: '整天食堂' }),
  foodsea: food('foodsea', { name_zh: '海邊食堂', zoneId: 'sea' }),
  // 研究標備案的吃的站（店名括號裡「保底備案」）：不主動排當一餐；「A vs B」比較條目連池都不進
  foodback: food('foodback', { name_zh: '保底食堂（保底備案）' }),
  foodvs: food('foodvs', { name_zh: '食堂甲 vs 食堂乙（站內比較吃）' }),
  // 甜點攤：店型對照表 food 的「甜點」對到的（categoryMatched），可以當一站、不佔餐段
  foodsweet: food('foodsweet', { name_zh: '麻糬攤', categoryMatched: '甜點', dwellMin: 30 }),
  // 夜間站
  barn1: bar('barn1', { name_zh: '酒吧一' }), barn2: bar('barn2', { name_zh: '酒吧二' }), barn3: bar('barn3', { name_zh: '酒吧三' }),
  // 購物類（只在購物日）
  depts: poi('depts', { name_zh: '百貨', category: 'department', walkAround: true, hours: hours('10:00', '20:00') }),
  // 古著
  vint1: poi('vint1', { name_zh: '古著一', category: 'vintage', walkFactor: 0, dwellMin: 40 }),
  vint2: poi('vint2', { name_zh: '古著二', category: 'vintage', walkFactor: 0, dwellMin: 40 }),
  // 街區（填站數用）
  street1: poi('street1', { name_zh: '街區一' }), street2: poi('street2', { name_zh: '街區二' }), street3: poi('street3', { name_zh: '街區三' }),
  // 分不進的：整趟都沒開、區域外、活動（主行程不是活動）
  closedpoi: poi('closedpoi', { name_zh: '週一限定', hours: { mon: [['09:00', '18:00']] } }),
  far1: poi('far1', { name_zh: '遠方小屋', zoneId: 'far' }),
  evente: poi('evente', { name_zh: '小鎮祭', category: 'event', walkFactor: 0.5 }),
  // 品項落點（同一品項兩家，只落一家；研究標「首選」的那家先，就算兩家一樣近）
  itema1: poi('itema1', { name_zh: '藥妝一', category: 'drugstore', item: '香水', dwellMin: 15, walkFactor: 0 }),
  itema2: poi('itema2', { name_zh: '藥妝二（首選）', category: 'drugstore', item: '香水', dwellMin: 15, walkFactor: 0 }),
  // 門：挖寶型、研究判可略過、兩星、未解鎖、落選兩次
  gatecurated: poi('gatecurated', { name_zh: '挖寶倉庫', category: 'vintage', curated: false }),
  gateskip: poi('gateskip', { name_zh: '查證結果：無貨，可略過', category: 'drugstore', item: '香水' }),
  gaterating: poi('gaterating', { name_zh: '踩雷店', my: { rating: 2 } }),
  gateunlock: poi('gateunlock', { name_zh: '下次再說', unlockWhen: '牛舌吃無可吃' }),
  gatelosses: poi('gatelosses', { name_zh: '落選兩次', poolLosses: 2 }),
};

export const TRIP = {
  id: 'alloc-world', name: '小世界四天', cityName: '小鎮', party: 1,
  homeBases: [{ poi: HOME }],
  days: [
    { date: '2026-08-13', type: 'normal', anchor: { poiId: 'shrinea' }, picks: [{ poiId: 'shrinea', priority: 'must', dwellMin: 60 }, { poiId: 'cafe1', priority: 'want' }, { poiId: 'far1', priority: 'maybe' }] },
    { date: '2026-08-14', type: 'normal', anchor: { poiId: 'gardeng' }, designated: ['templet'], picks: [] },
    { date: '2026-08-15', type: 'normal', dayTrip: true, anchor: { poiId: 'templesea' }, picks: [] },
    { date: '2026-08-16', type: 'departure', departAirportMin: 16 * 60, picks: [] },
  ],
};
