// 回住宿（降速的底線：DESIGN §1.4 策略 5「必要時直接回住宿據點」）：剩下的都不去了，今天到此為止。
// 分數一定最低（指定站、餐段、夜間站都缺席），排在清單最後；他真的不行了才會選。只給「累了／腳痛」那組用。
export default {
  id: 'end-day',
  label: '回住宿，今天到此為止',
  apply({ remaining }) {
    return { candidates: [], changes: remaining.map((c) => ({ poiId: c.poi.id, action: 'cut', why: '今天到此為止' })), note: '剩下的都不去了，回住宿休息' };
  },
};
