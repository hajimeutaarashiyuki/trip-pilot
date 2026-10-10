// 硬約束：非主題日古著、唱片行、咖啡廳各最多 N 家／天（原話 #123、#143）；主題日只放開主題那一類。
import { SAME_TYPE_CATEGORIES } from './_helpers.js';

export default {
  id: 'same-type-day',
  kind: 'hard',
  reads: ['stop.poi.category', 'acc.dim-cat-count'],
  defaults: {},
  apply(ctx) {
    const cat = ctx.stop.poi.category;
    if (!SAME_TYPE_CATEGORIES.includes(cat)) return 'ok';
    if (ctx.day.themeCategory === cat) return 'ok';
    const max = ctx.settings.sameTypeMaxPerDay ?? 2;
    return (ctx.acc['dim-cat-count'][cat] ?? 0) <= max ? 'ok' : 'no';
  },
  warn(ctx) {
    const names = { vintage: '古著店', record: '唱片行', cafe: '咖啡廳' };
    return `今天${names[ctx.stop.poi.category] ?? ctx.stop.poi.category}已經 ${ctx.settings.sameTypeMaxPerDay ?? 2} 家，不是主題日不再排`;
  },
};
