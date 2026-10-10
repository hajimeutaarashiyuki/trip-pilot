// 累積量：恢復站連排的長度（連續幾個恢復站，中間只有移動）。非恢復站就歸零。
import { isRecovery } from './_helpers.js';

export default {
  id: 'dim-rec-run',
  kind: 'dimension',
  reads: ['stop.poi.recovery'],
  defaults: { initial: 0 },
  apply(ctx) {
    return isRecovery(ctx.stop) ? ctx.acc['dim-rec-run'] + 1 : 0;
  },
};
