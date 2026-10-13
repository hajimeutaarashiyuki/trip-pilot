// 硬約束：非主題日古著、唱片行、咖啡廳各最多 N 家／天（原話 #123、#143）；他特地提的主題日那一類放寬到 themeDaySameTypeMax（預設 3，推導）；主題日只有他提才算，規劃者不能自己標（原話 #169「那天又不是主題日」）。
import { SAME_TYPE_CATEGORIES } from './_helpers.js';

export default {
  id: 'same-type-day',
  kind: 'hard',
  reads: ['stop.poi.category', 'acc.dim-cat-count'],
  defaults: {},
  apply(ctx) {
    const cat = ctx.stop.poi.category;
    if (!SAME_TYPE_CATEGORIES.includes(cat)) return 'ok';
    const max = ctx.day.themeCategory === cat ? (ctx.settings.themeDaySameTypeMax ?? 3) : (ctx.settings.sameTypeMaxPerDay ?? 2);
    return (ctx.acc['dim-cat-count'][cat] ?? 0) <= max ? 'ok' : 'no';
  },
  warn(ctx) {
    const names = { vintage: '古著店', record: '唱片行', cafe: '咖啡廳' };
    const name = names[ctx.stop.poi.category] ?? '同類的店';
    if (ctx.day.themeCategory === ctx.stop.poi.category) return `今天是${name}主題日，已經 ${ctx.settings.themeDaySameTypeMax ?? 3} 家，再多就被行程追著跑`;
    return `今天${name}已經 ${ctx.settings.sameTypeMaxPerDay ?? 2} 家，不是主題日不再排`;
  },
};
