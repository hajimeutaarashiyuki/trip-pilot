// 測試共用的小工具（不是測試檔）：讓測試用的 server 聽一個 fetch 連得上的埠。test/ui/brief-submit.test.js 與 test/tools/serve-packs.test.js 用。
// 這台桌機的 TCP 動態埠從 1024 起發（netsh int ipv4 show dynamicport tcp：1024 起 13977 個；Windows 預設是 49152 起），listen(0) 會輪到 fetch 規範禁用的埠。
// Node 的 fetch 對這些埠直接拒連（TypeError: fetch failed，cause 是 bad port），提交程式就當成伺服器沒回應、改走下載，測試的期待對不上——
// 11-17 引擎段查到的根因（完整測試跑 9 次遇到 1 次）；同日用 Node 24.14.1 對下面每一個埠實測都是 bad port、鄰近的埠是連線被拒。拿到這種埠就關掉換一個。
export const FETCH_BAD_PORTS = new Set([1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6679, 6697, 10080]);

/** 讓 server 聽一個 fetch 連得上的埠（系統挑；挑到禁用的就關掉重挑），回埠號。isBad 是給測試自己驗這個函式用的。 */
export async function listenSafe(server, isBad = (port) => FETCH_BAD_PORTS.has(port)) {
  for (let i = 0; i < 50; i += 1) {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); }); });
    const { port } = server.address();
    if (!isBad(port)) return port;
    await new Promise((resolve) => server.close(resolve));
  }
  throw new Error('一直拿到 fetch 禁用的埠');
}
