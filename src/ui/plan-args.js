// 畫面叫 planTrip 時 trip、pois 以外的那一包（rules、settings、country、kb、legFn、restPool、brief、options.visited），從畫面的 state 取。
// 順延的試排（app.js chooseOption／deferStop）、釘住順序的日子換一家與二選一的試排（engine/choices.js pinnedSwapCheck、choicesFor；ui/meals.js、ui/choices.js）
// 都拿這一份：試排要跟真的按下去之後的重排（app.js replan）用同一組參數，試出來說沒事、按下去才會真的沒事。
// restPool：整個知識庫都給引擎挑；visited：走廊清單按過「我進去了」的（進去那天之後引擎不再插它，原話 #138）。
import { visitedDates } from './corridor.js';

export function planArgsOf(state) {
  return { rules: state.rules, settings: state.settings, country: state.country, kb: state.kb, legFn: state.legFn, restPool: Object.values(state.pois ?? {}), brief: state.brief, options: { visited: visitedDates(state.field?.visited) } };
}
