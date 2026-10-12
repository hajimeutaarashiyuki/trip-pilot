// 只坐一下（降速的輕版；原話 #115「累了跟腳痛都是需要休息的」、總則 5 改案給 2–3 案由他選）：
// 插最近、現在進得去的恢復站，其他站都留著、設定不動。剩下的站裡本來就有一家 30 分內進得去的恢復站時不出案（降速那案會把它排前面）。
// 只給「累了／腳痛」那組用（strategies/index.js TIRED_STRATEGIES），不在硬時限受威脅的五種裡。
import { restSoon, pickRestNow } from './slow-down.js';

export default {
  id: 'rest-only',
  label: '只坐一下，其他照走',
  apply(input) {
    const { remaining, settings, day, nowMin = 0 } = input;
    if (restSoon(remaining, day, nowMin, settings.restSoonMin ?? 30)) return null;
    const rest = pickRestNow(input);
    if (!rest) return null;
    return { candidates: [rest, ...remaining], changes: [{ poiId: rest.poi.id, action: 'insert-rest' }], note: '找最近的地方坐一下，站都留著' };
  },
};
