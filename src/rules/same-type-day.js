// 硬約束：非主題日古著、唱片行、咖啡廳各最多 N 家／天（原話 #123「除非我特地提主題日，不然不應該一天內那麼多間古著或唱片行或咖啡廳」、#143「也比照」）。
// 他特地提的主題日那一類不設上限（原話 #20「只要順路的話並沒有上限，假設我規劃一天要去下北澤，那我一定是整天逛唱片行跟黑膠店」），家數只由逛店連跑（shop-run：maxShopRunCount 4／maxShopRunMin 240）與一天 maxStopsPerDay 8 管；其他類仍 ≤N。
// 主題日只有他提才算，規劃者不能自己標（原話 #169「那天又不是主題日」）；10-13 為 #168 加的主題日 3 家是預設，#169 證明 8/17 不是主題日後失去理由，10-14 T25 拿掉。
// 順路站也算進同類的家數：引擎插的順路站（priority 'onway'）跟他勾的站一樣受 ≤N 管、也數進去（他 10-24 更正，原話 #185「順路站也會被算進同類站裡面 理論上順路這件事 應該只是一個排行程順序的邏輯方式」；
// 10-24 中午 2e36cbd 的放行作廢）。
import { SAME_TYPE_CATEGORIES, SAME_TYPE_NAMES } from './_helpers.js';

export default {
  id: 'same-type-day',
  kind: 'hard',
  reads: ['stop.poi.category', 'acc.dim-cat-count'],
  defaults: {},
  apply(ctx) {
    const cat = ctx.stop.poi.category;
    if (!SAME_TYPE_CATEGORIES.includes(cat)) return 'ok';
    if (ctx.day.themeCategory === cat) return 'ok';   // 主題日那一類無上限（原話 #20）
    return (ctx.acc['dim-cat-count'][cat] ?? 0) <= (ctx.settings.sameTypeMaxPerDay ?? 2) ? 'ok' : 'no';
  },
  // 只有「不是這一類的主題日」才會走到這裡（主題日那一類 apply 永遠 ok）
  warn(ctx) {
    const name = SAME_TYPE_NAMES[ctx.stop.poi.category] ?? '同類的店';
    return `今天${name}已經 ${ctx.settings.sameTypeMaxPerDay ?? 2} 家，不是${name}主題日不再排`;
  },
};
