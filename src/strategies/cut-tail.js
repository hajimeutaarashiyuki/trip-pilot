// 砍尾：照裁砍順序由低往高砍，直到塞得回硬時限前（DESIGN §1.4 策略 2、§5.3）。
// 這裡不自己砍——把候選原樣交給核心，核心會依價值與硬時限丟掉塞不下的；差別在於停留不縮、不換備案。
export default {
  id: 'cut-tail',
  label: '塞不下的砍掉',
  apply({ remaining }) {
    return { candidates: remaining, changes: [], note: '停留不變，排不進的站由後往前砍，指定的最後才動' };
  },
};
