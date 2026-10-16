// 設定頁「同行：…」那行（T19；原話 #136、#144）：純函式，不碰 DOM——一個人、多人（名字、同行哪幾天、體力、夜間站、不去的店型）、來源是需求單時尾巴「（需求單）」。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { personsLine, dateRanges } from '../../src/ui/settings.js';

const home = { id: 'home', name_zh: '飯店', zoneId: 'town' };
const trip = (over = {}) => ({ id: 't', cityName: '仙台', party: 1, homeBases: [{ poi: home }], days: [{ date: '2026-08-13', type: 'normal', picks: [] }, { date: '2026-08-14', type: 'normal', picks: [] }, { date: '2026-08-15', type: 'normal', picks: [] }], ...over });
const adj = (over = {}) => ({ stamina: 'normal', nightSlot: 'default', dislikes: '', avoidCategories: [], ...over });

test('dateRanges：連續的日期合成一段、不連續用頓號；去重、排序；空＝空字串', () => {
  assert.equal(dateRanges(['2026-08-15', '2026-08-13', '2026-08-14', '2026-08-17', '2026-08-13']), '8/13–8/15、8/17');
  assert.equal(dateRanges(['2026-08-31', '2026-09-01']), '8/31–9/1', '跨月也算連續');
  assert.equal(dateRanges(['2026-08-14']), '8/14');
  assert.equal(dateRanges([]), '');
  assert.equal(dateRanges(undefined), '');
});

test('personsLine：一個人寫「一個人」（他自己有調整就括號寫出來）；沒 persons 的 party 2 是匿名同行者；旅程檔 persons 列名字、同行哪幾天、體力、夜間站、不去的店型', () => {
  assert.equal(personsLine(trip()), '同行：一個人');
  assert.equal(personsLine(trip({ party: 2 })), '同行：我、同行者');
  assert.equal(personsLine(trip({ persons: [{ id: 'me', isMe: true, adjustments: adj({ stamina: 'easy' }) }] })), '同行：一個人（輕鬆）');
  const gf = { id: 'gf', name: '女友', dates: ['2026-08-13', '2026-08-14', '2026-08-15'], adjustments: adj({ stamina: 'easy' }) };
  assert.equal(personsLine(trip({ persons: [{ id: 'me', isMe: true, adjustments: adj() }, gf] })), '同行：我、女友（8/13–8/15，輕鬆）');
  const full = { ...gf, dates: ['2026-08-14'], adjustments: adj({ stamina: 'hard', nightSlot: 'none', avoidCategories: ['onsen', 'shrine'] }) };
  assert.equal(personsLine(trip({ persons: [{ id: 'me', isMe: true, adjustments: adj({ nightSlot: 'less' }) }, full] })), '同行：我（少排夜間站）、女友（8/14，可以操，不排夜間站，不去溫泉、神社）');
  assert.equal(personsLine(trip({ persons: [{ id: 'me', isMe: true }, { id: 'x', name: '' }] })), '同行：我、同行者', '沒名字寫「同行者」');
  for (const line of [personsLine(trip({ party: 2 })), personsLine(trip({ persons: [{ id: 'me', isMe: true }, full] }))]) assert.doesNotMatch(line, /onsen|shrine|easy|hard|none|less|undefined/, `不露鍵值：${line}`);
});

test('personsLine：旅程檔沒 persons、需求單 city／dates 對得上 → 用需求單的同行者、尾巴「（需求單）」；「只同行哪幾天」讀得懂就印日期、讀不懂講明先整趟；對不上就不用、需求單有同行者時接一句為什麼沒算', () => {
  const brief = (over = {}) => ({ city: '仙台', dates: { from: '2026-08-13', to: '2026-08-15' }, persons: [
    { id: 'me', name: '我', isMe: true, partialDays: '', adjustments: { stamina: 'normal', nightSlot: 'default', dislikes: '' } },
    { id: 'p-1', name: '同學', isMe: false, partialDays: '8/14', adjustments: { stamina: 'easy', nightSlot: 'none', dislikes: '不想逛古著' } },
  ], ...over });
  const withDays = (partialDays) => brief({ persons: [brief().persons[0], { ...brief().persons[1], partialDays }] });
  assert.equal(personsLine(trip(), brief()), '同行：我、同學（8/14，輕鬆，不排夜間站）（需求單）', 'partialDays 讀得懂就印；dislikes 是文字，不進這行');
  assert.equal(personsLine(trip(), withDays('8/14–15')), '同行：我、同學（8/14–8/15，輕鬆，不排夜間站）（需求單）');
  assert.equal(personsLine(trip(), withDays('')), '同行：我、同學（輕鬆，不排夜間站）（需求單）', '沒寫＝整趟，不印日期');
  assert.equal(personsLine(trip(), withDays('8/14 晚上到')), '同行：我、同學（「8/14 晚上到」看不出是哪幾天，先整趟都算，輕鬆，不排夜間站）（需求單）');
  assert.equal(personsLine(trip(), brief({ city: '東京' })), '同行：一個人；需求單的城市或日期跟這趟對不上，裡面的同行者沒算');
  assert.equal(personsLine(trip(), brief({ dates: { from: '2026-08-12', to: '2026-08-15' } })), '同行：一個人；需求單的城市或日期跟這趟對不上，裡面的同行者沒算');
  assert.equal(personsLine(trip(), brief({ persons: [brief().persons[0]] })), '同行：一個人（需求單）', '需求單只有他自己、對得上：他的調整來自需求單，尾巴照標');
  assert.equal(personsLine(trip(), brief({ city: '東京', persons: [brief().persons[0]] })), '同行：一個人', '需求單只有他自己、對不上：不囉嗦（沒有同行者沒算）');
  assert.equal(personsLine(trip(), brief({ city: '仙台市' })), '同行：我、同學（8/14，輕鬆，不排夜間站）（需求單）', '城市包含比對');
  assert.equal(personsLine(trip(), brief({ city: 'Sendai' })), '同行：一個人；需求單的城市或日期跟這趟對不上，裡面的同行者沒算', '旅程檔只有 cityName、沒給打包檔的城市');
  assert.equal(personsLine(trip(), brief({ city: 'Sendai' }), ['sendai', '仙台']), '同行：我、同學（8/14，輕鬆，不排夜間站）（需求單）', '打包檔的城市 id 給了就對得上');
  assert.equal(personsLine(trip({ persons: [{ id: 'me', isMe: true }, { id: 'gf', name: '女友' }] }), brief()), '同行：我、女友', '旅程檔有 persons 以旅程檔為準');
  assert.equal(personsLine(trip({ persons: [{ id: 'me', isMe: true }, { id: 'gf', name: '女友' }] }), brief({ city: '東京' })), '同行：我、女友', '旅程檔有 persons 就不提需求單對不對得上');
});
