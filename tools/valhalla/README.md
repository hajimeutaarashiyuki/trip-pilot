# 步行分鐘矩陣（Valhalla）

桌機用 Docker 跑 Valhalla，把一城所有站對站的步行分鐘算好存進知識庫，手機離線讀（決策樹 Q6）。坡度：Valhalla 的 pedestrian costing 建圖時帶高程，秒數本身就含坡度。

## 一次性：建圖（每個地區一個容器）

```
# 東北（仙台）；資料與圖資放在專案根目錄的 valhalla/<區域>/，不進任何倉庫
docker run -d --name valhalla-tohoku -p 8002:8002 \
  -v "D:/App Design/igotanidea/trip-pilot/valhalla/tohoku:/custom_files" \
  -e tile_urls=https://download.geofabrik.de/asia/japan/tohoku-latest.osm.pbf \
  -e build_elevation=True -e serve_tiles=True -e use_tiles_ignore_pbf=False \
  ghcr.io/valhalla/valhalla-scripted:latest
docker logs -f valhalla-tohoku      # 看到 "Running valhalla service" 就好了
```

## 換區域（一區一容器一埠）

```
node tools/valhalla/build.mjs --region asia/taiwan --port 8003          # 只印 docker run 指令與衝突檢查（同名容器、埠被占）
node tools/valhalla/build.mjs --region asia/taiwan --port 8003 --apply  # 真的建：容器 valhalla-taiwan、圖資 valhalla/taiwan/、拉 asia/taiwan-latest.osm.pbf
docker logs -f valhalla-taiwan                                           # 看到 "Running valhalla service" 就好了
```

`--region` 是 Geofabrik 的分區路徑（台灣 asia/taiwan、關東 asia/japan/kanto、關西 asia/japan/kansai…）；容器名與資料夾都取最後一段。建完把 `{ "region", "container", "port" }` 寫進該城 `kb/<城>/city.json` 的 `valhalla`，`walk-matrix` 與 `city-pipeline` 就會打那個埠。選埠先避開 WinNAT 排除區（`netsh interface ipv4 show excludedportrange protocol=tcp`，PowerShell 跑）。

## 每次：產矩陣

```
node tools/geocode.mjs ../kb/sendai          # 先有座標：範圍與查詢字尾讀 ../kb/sendai/city.json；查不到留 null；人工補 coords.manual.json
node tools/walk-matrix.mjs ../kb/sendai      # 打 city.json 記的埠的 /sources_to_targets，寫 ../kb/sendai/walk.json；連不上會印怎麼建容器
```

一條指令跑完整條管線（kb-check → geocode → zones-init → walk-matrix → pack）是 `node tools/city-pipeline.mjs ../kb/<城> [trip.json] --apply`，步驟見 `docs/pipeline.md`。

`walk.json` 的形狀：`{ "<poiId>|<poiId>": { "min": 12, "m": 950 } }`，雙向各一筆。引擎 `geo/matrix.js` 先查它，沒有才用直線距離 ×1.3 並記警告。

## 未量

建圖時間、高程 tile 大小、矩陣與 Google Maps 的誤差，跑過才知道；量了寫進 DEVLOG。
